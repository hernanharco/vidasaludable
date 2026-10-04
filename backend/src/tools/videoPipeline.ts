/**
 * Video pipeline CLI — `video:analyze` and `video:cut`.
 *
 * Usage (via package scripts, from the backend directory):
 *   pnpm video:analyze <youtube-url>   yt-dlp metadata + auto-subs (es, json3),
 *                                      Gemini segment analysis, persist
 *                                      `videos` + `video_segments` (status=analyzed).
 *   pnpm video:cut <videoId>           download the original once, cut every
 *                                      segment with ffmpeg (status=cut).
 *
 * All external processes (yt-dlp, ffmpeg) and the Gemini call go through
 * injectable dependencies (`runCli(argv, deps)`), so
 * backend/test/video-pipeline.test.ts runs the whole flow without network,
 * subprocesses or a real model.
 *
 * License gate (docs/video-permissions.md): cutting locally is allowed before
 * permission is granted; RE-UPLOADING clips to YouTube is not. The `cut`
 * command prints that reminder on every run.
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDatabase } from "../db/client.js";
import type { Db } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { assessmentSymptoms } from "../db/assessmentSchema.js";
import { products } from "../db/schema.js";
import { createVideoService, parseSegmentProductList } from "../services/videoService.js";
import type { SymptomCandidate } from "../services/symptomMatcher.js";
import { matchSymptom } from "../services/symptomMatcher.js";
import type { Video, VideoSegment } from "../db/schema.js";
import { createGeminiClient } from "../agent/gemini.js";
import type { GeminiClient } from "../agent/gemini.js";
import { parseJson3Transcript, parseGeminiSegments, parseVideoId } from "./parsers.js";
import type { TimedCue } from "./parsers.js";
import { createFfmpegClient, createYtdlpClient } from "./media.js";
import type { FfmpegClient, YtdlpClient } from "./media.js";

/**
 * backend package root, resolved from this file (src/tools → ../..). First
 * `..` consumes this file's own name; robust to cwd whether run via
 * `pnpm --dir backend` or `pnpm video:*`.
 */
const BACKEND_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const DEFAULT_CACHE_DIR = join(BACKEND_ROOT, "data", "cache");
export const DEFAULT_CLIPS_ROOT = join(BACKEND_ROOT, "data", "clips");

// ─── Prompt builders (pure, exported for tests) ───────────────────────

/** Catalog product injected into the analyze prompt (name + reference). */
export interface AnalyzeCatalogProduct {
  name: string;
  reference: string;
}

/**
 * System prompt for the segment analyzer:
 * (a) injects the full condition vocabulary (the 95 `assessment_symptoms.name_es`
 *     rows read from the DB), (b) injects the CATALOG (T5: name + reference per
 *     product, read from the `products` table of the same DB), (c) demands
 *     STRICT JSON only, no fences, with the exact `segments[]` shape — now
 *     including the per-segment `products[]` array, (d) requires boundaries
 *     aligned to the timed transcript lines passed in the user message,
 *     (e) Spanish output, no diagnosis language.
 */
export function buildAnalyzeSystemPrompt(
  vocabulary: string[],
  catalog: AnalyzeCatalogProduct[],
): string {
  const vocabBlock =
    vocabulary.length > 0 ? vocabulary.map((name) => `- ${name}`).join("\n") : "(vacío)";
  const catalogBlock =
    catalog.length > 0
      ? catalog.map((p) => `- [${p.reference}] ${p.name}`).join("\n")
      : "(vacío)";
  return [
    "Eres un analizador de videos educativos de salud.",
    "Tu ÚNICA salida debe ser JSON válido (un solo objeto, sin explicaciones, sin texto antes o después, SIN cercas de Markdown tipo ```).",
    'Formato exacto: {"segments":[{"start_s":<enteros>,"end_s":<enteros>,"title":"...","summary":"...","condition":"<una entrada del vocabulario o vacío>","products":[{"mention":"<nombre verbatim del producto>","ref":"<referencia del catálogo o vacío>"}]}]}',
    "Cada segmento debe empezar y terminar EXACTAMENTE en las marcas de tiempo de las líneas de la transcripción temporizada que te pasan en el mensaje del usuario: usa esos valores enteros en segundos como start_s/end_s, con 0 <= start_s < end_s <= duración del video.",
    "Escribe title, summary y condition en español.",
    "No uses lenguaje diagnóstico ni de tratamiento médico: describe de qué habla cada segmento.",
    'En "condition" usa EXACTAMENTE una entrada de este vocabulario (sin añadir ni quitar texto) o cadena vacía si el segmento no corresponde a ninguna:',
    vocabBlock,
    'En "products" lista SOLO los productos que el educador mencione de forma oral en el segmento: "mention" es el nombre EXACTAMENTE como él lo dice (verbatim, sin inventar). Para "ref": si el producto mencionado CORRESPONDE a uno de la lista de abajo — aunque el educador use un nombre corto o coloquial, p. ej. "Cal Mag" o "doble X" — copia EXACTAMENTE su referencia de la lista; si NO corresponde a ningún producto de la lista, deja "ref" vacío. NO inventes productos ni referencias.',
    "PRODUCTOS DEL CATÁLOGO (referencias válidas):",
    catalogBlock,
  ].join("\n");
}

/**
 * User message for the analyzer: the full timed transcript, line by line, so
 * the model can align segment boundaries to real transcript timestamps.
 */
export function buildTranscriptMessage(cues: TimedCue[], durationS: number): string {
  const lines = cues.map((cue) => `[${(cue.startMs / 1000).toFixed(1)}s] ${cue.text}`);
  return [
    `Video educativo de salud. Duración total: ${durationS > 0 ? `${durationS} segundos` : "desconocida"}.`,
    "",
    "Transcripción temporizada (línea a línea, con su marca de tiempo en segundos):",
    ...lines,
    "",
    "Devuelve el JSON de segmentos alineado a estas marcas de tiempo.",
  ].join("\n");
}

// ─── analyze orchestration ────────────────────────────────────────────

export interface AnalyzeVideoOptions {
  url: string;
  db: Db;
  gemini: GeminiClient;
  ytdlp: YtdlpClient;
  /** The assessment_symptoms vocabulary (the 95 rows), read from the DB. */
  vocabulary: SymptomCandidate[];
}

export interface AnalyzeResult {
  video: Video;
  segments: VideoSegment[];
}

/**
 * Full `analyze` flow (pure orchestration over injected deps):
 * parse URL → yt-dlp metadata + json3 transcript → timed transcript →
 * Gemini → parseGeminiSegments (catalog refs injected, defensive product
 * validation) → matchSymptom per condition → persist one `videos` row
 * (status=analyzed) + one `video_segments` row per segment (enabled=0),
 * carrying the segment's product mentions + linked catalog refs (T5).
 *
 * Re-running on an existing youtubeId replaces its metadata and segments
 * (idempotent, mirroring the seed scripts) instead of failing on the unique
 * `youtube_id` index.
 */
export async function analyzeVideo(opts: AnalyzeVideoOptions): Promise<AnalyzeResult> {
  const { url, db, gemini, ytdlp, vocabulary } = opts;

  const youtubeId = parseVideoId(url);
  if (!youtubeId) {
    throw new Error(
      `URL de YouTube no válida: "${url}". Ejemplo: https://www.youtube.com/watch?v=XXXXXXXXXXX`,
    );
  }

  const meta = await ytdlp.getMetadata(url);
  const rawTranscript = await ytdlp.getTranscript(url);
  const cues = parseJson3Transcript(rawTranscript);
  if (cues.length === 0) {
    throw new Error("No se encontró transcripción utilizable en el video (json3 vacío o ilegible).");
  }

  // T5: el catálogo (products table de ESTA base) se inyecta en el prompt y
  // ancla la validación de refs del parser (defensa anti-invención).
  const catalogProducts: AnalyzeCatalogProduct[] = db
    .select()
    .from(products)
    .all()
    .map((p) => ({ name: p.name, reference: p.reference }));

  const durationS = meta.durationS ?? 0;
  const systemPrompt = buildAnalyzeSystemPrompt(
    vocabulary.map((s) => s.name_es),
    catalogProducts,
  );
  const userMessage = buildTranscriptMessage(cues, durationS);

  let raw: string;
  try {
    raw = await gemini.generate({ systemPrompt, messages: [{ role: "user", content: userMessage }] });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini falló al analizar la transcripción: ${detail}`);
  }

  const parsed = parseGeminiSegments(
    raw,
    durationS,
    catalogProducts.map((p) => p.reference),
  );
  if (parsed.length === 0) {
    throw new Error(
      "Gemini devolvió una respuesta sin segmentos utilizables (JSON inválido o todos los segmentos descartados).",
    );
  }

  // Normalize each condition against the same vocabulary that was injected.
  const resolved = parsed.map((seg) => {
    const hit = seg.condition ? matchSymptom(seg.condition, vocabulary) : null;
    return {
      startS: seg.startS,
      endS: seg.endS,
      title: seg.title,
      summary: seg.summary,
      condition: hit ? hit.name_es : null,
      symptomId: hit ? hit.id : null,
      // T5: menciones crudas (todas) + solo las refs válidas del catálogo.
      mentionedProducts: seg.products.map((p) => p.mention),
      productReferences: seg.products.filter((p) => p.ref).map((p) => p.ref),
    };
  });

  const svc = createVideoService(db);
  let video = svc.getVideoByYoutubeId(youtubeId);
  if (video) {
    // Re-análisis: reemplaza los segmentos previos para no duplicar filas.
    for (const prev of svc.listSegments().filter((s) => s.videoId === video!.id)) {
      svc.removeSegment(prev.id);
    }
    video =
      svc.updateVideo(video.id, {
        speaker: meta.speaker,
        url,
        title: meta.title,
        durationS: durationS > 0 ? durationS : null,
        status: "analyzed",
      }) ?? video;
  } else {
    video = svc.createVideo({
      speaker: meta.speaker,
      youtubeId,
      url,
      title: meta.title,
      durationS: durationS > 0 ? durationS : null,
      status: "analyzed",
    });
  }

  const segments = resolved.map((seg) =>
    svc.createSegment({
      videoId: video!.id,
      condition: seg.condition,
      symptomId: seg.symptomId,
      startS: seg.startS,
      endS: seg.endS,
      title: seg.title,
      summary: seg.summary,
      enabled: 0,
      // T5: service stringifies arrays → JSON columns.
      mentionedProducts: seg.mentionedProducts,
      productReferences: seg.productReferences,
    }),
  );

  return { video, segments };
}

// ─── cut orchestration ────────────────────────────────────────────────

export interface CutVideoDeps {
  db: Db;
  ytdlp: YtdlpClient;
  ffmpeg: FfmpegClient;
  /** Directory for the cached originals (default: backend/data/cache). */
  cacheDir?: string;
  /** Root for generated clips (default: backend/data/clips). */
  clipsRoot?: string;
}

export interface CutVideoResult {
  video: Video;
  clips: Array<{ segmentId: number; path: string }>;
}

/**
 * Full `cut` flow (pure orchestration over injected deps): load video +
 * segments (refuse when none), preflight binaries, download the original ONCE
 * to `<cacheDir>/<youtubeId>.mp4`, cut each segment to
 * `<clipsRoot>/<videoId>/<segmentId>.mp4` via `buildFfmpegArgs`, then promote
 * the video to `status=cut`.
 */
export async function cutVideo(videoId: number, deps: CutVideoDeps): Promise<CutVideoResult> {
  const { db, ytdlp, ffmpeg } = deps;
  const cacheDir = deps.cacheDir ?? DEFAULT_CACHE_DIR;
  const clipsRoot = deps.clipsRoot ?? DEFAULT_CLIPS_ROOT;

  const svc = createVideoService(db);
  const video = svc.listVideos().find((v) => v.id === videoId);
  if (!video) {
    throw new Error(`No existe el video con id ${videoId}. Ejecuta primero video:analyze.`);
  }
  const segments = svc
    .listSegments()
    .filter((s) => s.videoId === videoId)
    .sort((a, b) => a.startS - b.startS || a.id - b.id);
  if (segments.length === 0) {
    throw new Error(`El video ${videoId} no tiene segmentos para recortar (ejecuta primero video:analyze).`);
  }

  // Preflight: fallar pronto y con mensaje claro si falta un binario.
  await ytdlp.getVersion();
  await ffmpeg.getVersion();

  const inputPath = join(cacheDir, `${video.youtubeId}.mp4`);
  await ytdlp.downloadVideo(video.url, inputPath);

  const clips: Array<{ segmentId: number; path: string }> = [];
  for (const seg of segments) {
    const output = join(clipsRoot, String(videoId), `${seg.id}.mp4`);
    await ffmpeg.cut(inputPath, output, seg.startS, seg.endS);
    clips.push({ segmentId: seg.id, path: output });
  }

  svc.updateVideo(videoId, { status: "cut" });
  const updated = svc.getVideoByYoutubeId(video.youtubeId) ?? video;
  return { video: updated, clips };
}

// ─── CLI ──────────────────────────────────────────────────────────────

export interface CliDeps {
  /** Injected DB (tests use :memory:). Default: SQLITE_PATH ?? ./data/dev.sqlite. */
  db?: Db;
  /** Injected Gemini client. Default: createGeminiClient() (reads GEMINI_API_KEY). */
  gemini?: GeminiClient;
  /** Injected yt-dlp client. Default: createYtdlpClient(). */
  ytdlp?: YtdlpClient;
  /** Injected ffmpeg client. Default: createFfmpegClient(). */
  ffmpeg?: FfmpegClient;
  /** Injected env (tests). Default: process.env. */
  env?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  cacheDir?: string;
  clipsRoot?: string;
}

const HELP_LINES = [
  "Uso: videoPipeline.ts <comando> [argumentos]",
  "",
  "Comandos:",
  '  analyze <youtube-url>   Metadatos + transcripción (yt-dlp), análisis con Gemini',
  "                          y persistencia de videos + video_segments (status=analyzed).",
  "  cut <videoId>           Descarga el original una vez y recorta cada segmento",
  "                          con ffmpeg (status=cut).",
  "",
  "Opciones:",
  "  -h, --help, help        Muestra esta ayuda.",
  "",
  "Variables de entorno:",
  "  SQLITE_PATH             Ruta de la base SQLite (default ./data/dev.sqlite)",
  "  GEMINI_API_KEY          Obligatoria para analyze.",
  "",
  "Recordatorio: subir clips a YouTube exige permiso escrito del titular",
  "(docs/video-permissions.md). El corte local está permitido.",
];

function printHelp(out: (line: string) => void): void {
  for (const line of HELP_LINES) out(line);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * CLI entry. `argv` = process.argv.slice(2) when invoked as a script.
 * Returns the process exit code (0 ok, 1 runtime failure, 2 usage error)
 * instead of exiting, so tests drive it in-process.
 */
export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const out = deps.stdout ?? console.log;
  const err = deps.stderr ?? console.error;
  const env = deps.env ?? process.env;
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp(out);
    return 0;
  }

  if (cmd === "analyze") {
    const url = rest[0];
    if (!url) {
      err("Falta la URL del video de YouTube.");
      err("Uso: video:analyze <youtube-url>");
      return 2;
    }
    if (!parseVideoId(url)) {
      err(`video:analyze — error: URL de YouTube no válida: "${url}". Ejemplo: https://www.youtube.com/watch?v=XXXXXXXXXXX`);
      return 1;
    }
    try {
      const gemini = deps.gemini ?? createGeminiClient({ apiKey: env.GEMINI_API_KEY });
      if (!gemini.isConfigured()) {
        err(
          "video:analyze — error: falta la variable de entorno GEMINI_API_KEY. Configúrala (ver .env.example) para usar video:analyze.",
        );
        return 1;
      }
      const db = deps.db ?? createDatabase(env.SQLITE_PATH ?? "./data/dev.sqlite");
      const ownsDb = !deps.db;
      try {
        await migrate(db);
        const vocabulary = db
          .select()
          .from(assessmentSymptoms)
          .all()
          .map((r) => ({ id: r.id, name_es: r.nameEs }));
        const ytdlp = deps.ytdlp ?? createYtdlpClient();
        const { video, segments } = await analyzeVideo({ url, db, gemini, ytdlp, vocabulary });
        out(`video:analyze — video id=${video.id} (${video.status}) "${video.title}"`);
        out(`  YouTube: ${video.url}`);
        out(`  Speaker: ${video.speaker}${video.durationS ? ` · ${video.durationS}s` : ""}`);
        for (const seg of segments) {
          const cond = seg.condition
            ? ` (${seg.condition}${seg.symptomId != null ? `, symptomId=${seg.symptomId}` : ""})`
            : " (sin condición asignada)";
          // T5: productos mencionados en el segmento (menciones crudas y
          // refs válidas del catálogo) — visibles en la salida del CLI.
          const mentions = parseSegmentProductList(seg.mentionedProducts);
          const refs = parseSegmentProductList(seg.productReferences);
          const prod =
            mentions.length > 0 || refs.length > 0
              ? ` · productos: ${mentions.join(", ")}${refs.length > 0 ? ` · refs: ${refs.join(", ")}` : ""}`
              : "";
          out(`  - #${seg.id} [${seg.startS}–${seg.endS}s] ${seg.title}${cond}${prod}`);
        }
        out(
          `video:analyze — ${segments.length} segmento(s) creados con enabled=0 (aprueba en el CRM para habilitarlos en chat).`,
        );
      } finally {
        if (ownsDb) db.$client.close();
      }
      return 0;
    } catch (e) {
      err(`video:analyze — error: ${errorMessage(e)}`);
      return 1;
    }
  }

  if (cmd === "cut") {
    const idArg = rest[0];
    if (!idArg) {
      err("Falta el id del video.");
      err("Uso: video:cut <videoId>");
      return 2;
    }
    if (!/^\d+$/.test(idArg)) {
      err(`"${idArg}" no es un id de video válido (se espera un número entero).`);
      err("Uso: video:cut <videoId>");
      return 2;
    }
    try {
      const db = deps.db ?? createDatabase(env.SQLITE_PATH ?? "./data/dev.sqlite");
      const ownsDb = !deps.db;
      try {
        await migrate(db);
        const ytdlp = deps.ytdlp ?? createYtdlpClient();
        const ffmpeg = deps.ffmpeg ?? createFfmpegClient();
        const { video, clips } = await cutVideo(Number(idArg), {
          db,
          ytdlp,
          ffmpeg,
          cacheDir: deps.cacheDir,
          clipsRoot: deps.clipsRoot,
        });
        for (const clip of clips) out(`Recorte generado: ${clip.path}`);
        out(`video:cut — video ${video.id} → status=${video.status} (${clips.length} clip(s)).`);
        out(
          "RECORDATORIO: la subida de clips a YouTube exige permiso escrito del titular del contenido (docs/video-permissions.md). El corte local está permitido.",
        );
      } finally {
        if (ownsDb) db.$client.close();
      }
      return 0;
    } catch (e) {
      err(`video:cut — error: ${errorMessage(e)}`);
      return 1;
    }
  }

  err(`Subcomando desconocido: "${cmd}".`);
  printHelp(err);
  return 2;
}

// Allow `tsx src/tools/videoPipeline.ts …` to run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
