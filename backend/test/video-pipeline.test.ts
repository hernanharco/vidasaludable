import { describe, it, expect } from "vitest";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { assessmentSymptoms } from "../src/db/assessmentSchema.js";
import { createVideoService } from "../src/services/videoService.js";
import type { GeminiClient } from "../src/agent/gemini.js";
import seedData from "../src/seed/assessment_seed_data.json";
import { parseVideoId, parseJson3Transcript, parseGeminiSegments } from "../src/tools/parsers.js";
import {
  buildFfmpegArgs,
  createFfmpegClient,
  createYtdlpClient,
  type CommandRunner,
  type YtdlpClient,
} from "../src/tools/media.js";
import {
  analyzeVideo,
  buildAnalyzeSystemPrompt,
  cutVideo,
  runCli,
} from "../src/tools/videoPipeline.js";

/** Real 95-symptom vocabulary — accented Spanish, source of truth for `condition`. */
const seedSymptoms = seedData.symptoms as { id: number; name_es: string }[];

const ANXIETY = 3; // "Ansiedad o tensión"
const BACK_PAIN = 29; // "Dolor de espalda"

const YOUTUBE_URL = "https://www.youtube.com/watch?v=0RYeUT3Yl0Q";

/**
 * Small realistic YouTube json3 subtitle fixture: two real cues + one cue
 * whose segs only carry the line-break separator (must be skipped) + one
 * empty whitespace cue + one event without segs (window marker).
 */
const json3Fixture = {
  wireMagic: "pb3",
  events: [
    {
      tStartMs: 0,
      dDurationMs: 1500,
      segs: [{ utf8: "Hola, bienvenidos " }, { utf8: "al canal." }],
    },
    { tStartMs: 1500, dDurationMs: 400, segs: [{ utf8: "\n" }] },
    {
      tStartMs: 1900,
      dDurationMs: 2300,
      segs: [{ utf8: "Hoy hablamos de la vitamina C." }],
    },
    { tStartMs: 4200, dDurationMs: 100, segs: [{ utf8: "   " }] },
    { tStartMs: 4300, dDurationMs: 2000 },
    {
      tStartMs: 6300,
      dDurationMs: 1800,
      segs: [{ utf8: "Eso es todo, " }, { utf8: "gracias." }],
    },
  ],
};

/** Fake Gemini client. `capture` records the prompts the analyzer sent. */
function fakeGemini(reply: string, capture?: { systemPrompt?: string; userMessage?: string }): GeminiClient {
  return {
    isConfigured: () => true,
    async generate(input) {
      if (capture) {
        capture.systemPrompt = input.systemPrompt;
        capture.userMessage = input.messages[0]?.content ?? "";
      }
      return reply;
    },
  };
}

/** Fake yt-dlp client — never spawns a process, never touches the network. */
function fakeYtdlp(overrides: Partial<YtdlpClient> = {}): YtdlpClient {
  return {
    getVersion: async () => "2024.01.01",
    getMetadata: async () => ({
      id: "0RYeUT3Yl0Q",
      title: "Vitaminas y energía",
      durationS: 120,
      speaker: "Luis Collantes",
    }),
    getTranscript: async () => json3Fixture,
    downloadVideo: async () => undefined,
    ...overrides,
  };
}

/** Fake ffmpeg client — records cut invocations, never spawns a process. */
function fakeFfmpeg(cuts: Array<{ input: string; output: string; startS: number; endS: number }>) {
  return {
    getVersion: async () => "6.1",
    cut: async (input: string, output: string, startS: number, endS: number) => {
      cuts.push({ input, output, startS, endS });
    },
  };
}

/** In-memory DB migrated with production DDL + the real 95-symptom vocabulary. */
async function seededDb(): Promise<Db> {
  const db = createDatabase(":memory:");
  await migrate(db);
  for (const s of seedSymptoms) {
    db.insert(assessmentSymptoms).values({ id: s.id, nameEs: s.name_es }).run();
  }
  return db;
}

describe("parseVideoId", () => {
  it("soporta las 4 formas de URL de YouTube", () => {
    expect(parseVideoId("https://www.youtube.com/watch?v=0RYeUT3Yl0Q")).toBe("0RYeUT3Yl0Q");
    expect(parseVideoId("youtube.com/watch?v=0RYeUT3Yl0Q")).toBe("0RYeUT3Yl0Q");
    expect(parseVideoId("https://youtu.be/0RYeUT3Yl0Q")).toBe("0RYeUT3Yl0Q");
    expect(parseVideoId("youtu.be/0RYeUT3Yl0Q")).toBe("0RYeUT3Yl0Q");
    expect(parseVideoId("https://www.youtube.com/shorts/0RYeUT3Yl0Q")).toBe("0RYeUT3Yl0Q");
    expect(parseVideoId("youtube.com/shorts/0RYeUT3Yl0Q")).toBe("0RYeUT3Yl0Q");
    expect(parseVideoId("https://www.youtube.com/embed/0RYeUT3Yl0Q")).toBe("0RYeUT3Yl0Q");
    expect(parseVideoId("youtube.com/embed/0RYeUT3Yl0Q")).toBe("0RYeUT3Yl0Q");
  });

  it("tolera parámetros extra (t=, list=) y recorta el id en el primer separador", () => {
    expect(parseVideoId("https://www.youtube.com/watch?v=0RYeUT3Yl0Q&t=90s")).toBe("0RYeUT3Yl0Q");
    expect(parseVideoId("https://www.youtube.com/watch?list=PL123&v=0RYeUT3Yl0Q")).toBe("0RYeUT3Yl0Q");
    expect(parseVideoId("https://www.youtube.com/watch?v=0RYeUT3Yl0Q#t=10")).toBe("0RYeUT3Yl0Q");
  });

  it("devuelve null para entradas que no son URL de YouTube", () => {
    expect(parseVideoId("https://vimeo.com/123456789")).toBeNull();
    expect(parseVideoId("no soy una url")).toBeNull();
    expect(parseVideoId("")).toBeNull();
    expect(parseVideoId("0RYeUT3Yl0Q")).toBeNull();
  });
});

describe("parseJson3Transcript", () => {
  it("extrae cues temporizadas, fusiona segs y omite cues vacías", () => {
    const cues = parseJson3Transcript(json3Fixture);
    expect(cues).toEqual([
      { startMs: 0, durMs: 1500, text: "Hola, bienvenidos al canal." },
      { startMs: 1900, durMs: 2300, text: "Hoy hablamos de la vitamina C." },
      { startMs: 6300, durMs: 1800, text: "Eso es todo, gracias." },
    ]);
  });

  it("devuelve [] ante payloads que no son json3 utilizable", () => {
    expect(parseJson3Transcript(null)).toEqual([]);
    expect(parseJson3Transcript("texto")).toEqual([]);
    expect(parseJson3Transcript({})).toEqual([]);
    expect(parseJson3Transcript({ events: "no-array" })).toEqual([]);
  });
});

describe("parseGeminiSegments", () => {
  it("acepta JSON cercado con ``` (con o sin lang json)", () => {
    const fenced =
      '```json\n{"segments":[{"start_s":0,"end_s":60,"title":"Intro","summary":"s1","condition":"Acné"}]}\n```';
    expect(parseGeminiSegments(fenced, 120)).toEqual([
      { startS: 0, endS: 60, title: "Intro", summary: "s1", condition: "Acné" },
    ]);
    const plainFence =
      '```\n{"segments":[{"start_s":10,"end_s":30,"title":"T","summary":"","condition":""}]}\n```';
    expect(parseGeminiSegments(plainFence, 120)).toEqual([
      { startS: 10, endS: 30, title: "T", summary: "", condition: "" },
    ]);
  });

  it("JSON malformado → []", () => {
    expect(parseGeminiSegments("esto no es json {", 120)).toEqual([]);
    expect(parseGeminiSegments("", 120)).toEqual([]);
    expect(parseGeminiSegments('{"segments":[{"start_s":0,', 120)).toEqual([]);
  });

  it("payload no-array (sin segments o segments no-array) → []", () => {
    expect(parseGeminiSegments('{"segments":{"a":1}}', 120)).toEqual([]);
    expect(parseGeminiSegments('{"foo":1}', 120)).toEqual([]);
    expect(parseGeminiSegments('{"segments":null}', 120)).toEqual([]);
  });

  it("recorta end_s fuera de rango al final del video", () => {
    const segs = parseGeminiSegments(
      '{"segments":[{"start_s":100,"end_s":500,"title":"T","summary":"","condition":""}]}',
      120,
    );
    expect(segs).toEqual([{ startS: 100, endS: 120, title: "T", summary: "", condition: "" }]);
  });

  it("descarta límites invertidos o inválidos", () => {
    // Intercambiados: start > end
    expect(
      parseGeminiSegments(
        '{"segments":[{"start_s":100,"end_s":50,"title":"T","summary":"","condition":""}]}',
        120,
      ),
    ).toEqual([]);
    // start más allá de la duración
    expect(
      parseGeminiSegments(
        '{"segments":[{"start_s":120,"end_s":130,"title":"T","summary":"","condition":""}]}',
        120,
      ),
    ).toEqual([]);
    // start negativo
    expect(
      parseGeminiSegments(
        '{"segments":[{"start_s":-5,"end_s":20,"title":"T","summary":"","condition":""}]}',
        120,
      ),
    ).toEqual([]);
    // start_s no numérico
    expect(
      parseGeminiSegments(
        '{"segments":[{"start_s":"abc","end_s":10,"title":"T","summary":"","condition":""}]}',
        120,
      ),
    ).toEqual([]);
  });

  it("descarta segmentos sin título y normaliza campos no-string", () => {
    expect(
      parseGeminiSegments(
        '{"segments":[{"start_s":0,"end_s":10,"title":"   ","summary":"s","condition":"c"}]}',
        120,
      ),
    ).toEqual([]);
    const segs = parseGeminiSegments(
      '{"segments":[{"start_s":10.9,"end_s":30.7,"title":"T","summary":null,"condition":42}]}',
      120,
    );
    expect(segs).toEqual([{ startS: 10, endS: 30, title: "T", summary: "", condition: "" }]);
  });
});

describe("buildFfmpegArgs", () => {
  it("devuelve el array exacto de ffmpeg (re-encode frame-accurate)", () => {
    expect(buildFfmpegArgs("/in.mp4", "/out.mp4", 5, 40)).toEqual([
      "-ss",
      "5",
      "-to",
      "40",
      "-i",
      "/in.mp4",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "/out.mp4",
    ]);
  });
});

describe("buildAnalyzeSystemPrompt", () => {
  it("inyecta el vocabulario y exige JSON estricto en español, sin lenguaje diagnóstico", () => {
    const prompt = buildAnalyzeSystemPrompt(["Acné", "Ansiedad o tensión"]);
    expect(prompt).toContain("Acné");
    expect(prompt).toContain("Ansiedad o tensión");
    expect(prompt).toContain('{"segments":[');
    expect(prompt).toContain("start_s");
    expect(prompt.toLowerCase()).toContain("sin cercas");
    expect(prompt.toLowerCase()).toContain("diagnóstico");
  });
});

describe("analyzeVideo (analyzer wiring)", () => {
  it("persiste videos + segmentos con symptomId resuelto desde el vocabulario acentuado", async () => {
    const db = await seededDb();
    const svc = createVideoService(db);
    const vocabulary = db
      .select()
      .from(assessmentSymptoms)
      .all()
      .map((r) => ({ id: r.id, name_es: r.nameEs }));
    expect(vocabulary.length).toBe(95);

    const capture: { systemPrompt?: string; userMessage?: string } = {};
    // Gemini devuelve una entrada del vocabulario ACENTUADA ("Ansiedad o tensión").
    const gemini = fakeGemini(
      JSON.stringify({
        segments: [
          {
            start_s: 0,
            end_s: 30,
            title: "Ansiedad o tensión",
            summary: "Hablamos de la ansiedad diaria.",
            condition: "Ansiedad o tensión",
          },
        ],
      }),
      capture,
    );
    const ytdlp = fakeYtdlp();

    const result = await analyzeVideo({ url: YOUTUBE_URL, db, gemini, ytdlp, vocabulary });

    // Prompt: vocabulario completo inyectado + transcripción temporizada pasada.
    expect(capture.systemPrompt).toContain("Ansiedad o tensión");
    expect(capture.systemPrompt).toContain("Acné");
    expect(capture.userMessage).toContain("[0.0s] Hola, bienvenidos al canal.");
    expect(capture.userMessage).toContain("[1.9s] Hoy hablamos de la vitamina C.");

    // Persistencia: una fila videos (status=analyzed) + una por segmento.
    expect(result.video.status).toBe("analyzed");
    expect(result.video.youtubeId).toBe("0RYeUT3Yl0Q");
    expect(result.video.url).toBe(YOUTUBE_URL);
    expect(result.video.speaker).toBe("Luis Collantes");
    expect(result.video.durationS).toBe(120);
    expect(result.segments).toHaveLength(1);

    const seg = svc.listSegments().find((s) => s.videoId === result.video.id);
    expect(seg).toBeDefined();
    expect(seg!.enabled).toBe(0);
    expect(seg!.startS).toBe(0);
    expect(seg!.endS).toBe(30);
    // Normalización: symptomId + nombre acentuado del vocabulario persistidos.
    expect(seg!.symptomId).toBe(ANXIETY);
    expect(seg!.condition).toBe("Ansiedad o tensión");
  });

  it("condición sin match → condition y symptomId null (asignación manual pendiente)", async () => {
    const db = await seededDb();
    const vocabulary = seedSymptoms;
    const gemini = fakeGemini(
      JSON.stringify({
        segments: [
          { start_s: 0, end_s: 10, title: "T", summary: "", condition: "zzz no existe" },
        ],
      }),
    );
    const { segments } = await analyzeVideo({ url: YOUTUBE_URL, db, gemini, ytdlp: fakeYtdlp(), vocabulary });
    expect(segments[0]!.condition).toBeNull();
    expect(segments[0]!.symptomId).toBeNull();
  });

  it("respuesta de Gemini sin segmentos utilizables → error claro", async () => {
    const db = await seededDb();
    await expect(
      analyzeVideo({
        url: YOUTUBE_URL,
        db,
        gemini: fakeGemini("lo siento, no puedo"),
        ytdlp: fakeYtdlp(),
        vocabulary: seedSymptoms,
      }),
    ).rejects.toThrow(/segmentos/);
  });

  it("URL no válida → error claro, sin tocar yt-dlp ni Gemini", async () => {
    const db = await seededDb();
    let geminiCalled = false;
    const gemini: GeminiClient = {
      isConfigured: () => true,
      generate: async () => {
        geminiCalled = true;
        return "";
      },
    };
    let ytdlpCalled = false;
    const ytdlp = fakeYtdlp({
      getMetadata: async () => {
        ytdlpCalled = true;
        throw new Error("no debería llamarse");
      },
    });
    await expect(
      analyzeVideo({ url: "https://vimeo.com/123", db, gemini, ytdlp, vocabulary: seedSymptoms }),
    ).rejects.toThrow(/URL de YouTube no válida/);
    expect(geminiCalled).toBe(false);
    expect(ytdlpCalled).toBe(false);
  });
});

describe("createYtdlpClient (con runner falso, sin subprocess)", () => {
  it("getVersion usa --version y getMetadata parsea título/duración/uploader", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const runner: CommandRunner = async (cmd, args) => {
      calls.push({ cmd, args });
      return {
        code: 0,
        stdout: JSON.stringify({
          id: "0RYeUT3Yl0Q",
          title: "Vitaminas y energía",
          duration: 123.7,
          uploader: "Luis Collantes",
        }),
        stderr: "",
      };
    };
    const client = createYtdlpClient(runner);
    const meta = await client.getMetadata(YOUTUBE_URL);
    expect(meta).toEqual({
      id: "0RYeUT3Yl0Q",
      title: "Vitaminas y energía",
      durationS: 124, // redondeado a enteros
      speaker: "Luis Collantes",
    });
    expect(calls[0]!.args).toEqual(["-J", YOUTUBE_URL]);

    const versionRunner: CommandRunner = async (cmd, args) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: "2024.01.01\n", stderr: "" };
    };
    expect(await createYtdlpClient(versionRunner).getVersion()).toBe("2024.01.01");
    expect(calls[1]!.args).toEqual(["--version"]);
  });

  it("getTranscript construye los args json3, parsea el archivo y limpia el temporal", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    let writtenDir = "";
    const runner: CommandRunner = async (cmd, args) => {
      calls.push({ cmd, args });
      const oIdx = args.indexOf("-o");
      const template = args[oIdx + 1] ?? "";
      writtenDir = dirname(template);
      await mkdir(writtenDir, { recursive: true });
      await writeFile(join(writtenDir, "0RYeUT3Yl0Q.es.json3"), JSON.stringify(json3Fixture), "utf8");
      return { code: 0, stdout: "", stderr: "" };
    };
    const client = createYtdlpClient(runner);
    const raw = await client.getTranscript(YOUTUBE_URL);
    expect(parseJson3Transcript(raw)).toHaveLength(3);
    expect(calls[0]!.args).toEqual([
      "--skip-download",
      "--write-auto-subs",
      "--sub-langs",
      "es",
      "--sub-format",
      "json3",
      "-o",
      join(writtenDir, "%(id)s"),
      YOUTUBE_URL,
    ]);
    // Temporal eliminado tras la lectura.
    await expect(access(writtenDir)).rejects.toThrow();
  });

  it("sin archivo json3 → error 'No se encontró transcripción'", async () => {
    const runner: CommandRunner = async () => ({ code: 0, stdout: "", stderr: "" });
    await expect(createYtdlpClient(runner).getTranscript(YOUTUBE_URL)).rejects.toThrow(
      /No se encontró transcripción/,
    );
  });

  it("binary ausente (ENOENT → código 127) → error claro en español", async () => {
    const runner: CommandRunner = async () => ({ code: 127, stdout: "", stderr: "command not found" });
    await expect(createYtdlpClient(runner).getVersion()).rejects.toThrow(/yt-dlp/);
  });

  it("downloadVideo usa -f 'bv*+ba/b' y verifica el archivo de salida", async () => {
    const root = await mkdtemp(join(tmpdir(), "vp-cache-"));
    const output = join(root, "0RYeUT3Yl0Q.mp4");
    const calls: Array<{ cmd: string; args: string[] }> = [];
    try {
      const runner: CommandRunner = async (cmd, args) => {
        calls.push({ cmd, args });
        await writeFile(output, "fake-mp4", "utf8");
        return { code: 0, stdout: "", stderr: "" };
      };
      await createYtdlpClient(runner).downloadVideo(YOUTUBE_URL, output);
      expect(calls[0]!.args).toEqual(["-f", "bv*+ba/b", "-o", output, YOUTUBE_URL]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("createFfmpegClient (con runner falso, sin subprocess)", () => {
  it("cut invoca ffmpeg con buildFfmpegArgs exactos y crea el directorio de salida", async () => {
    const root = await mkdtemp(join(tmpdir(), "vp-clips-"));
    const output = join(root, "nested", "1.mp4");
    const calls: Array<{ cmd: string; args: string[] }> = [];
    try {
      const runner: CommandRunner = async (cmd, args) => {
        calls.push({ cmd, args });
        return { code: 0, stdout: "", stderr: "" };
      };
      await createFfmpegClient(runner).cut("/cache/0RYeUT3Yl0Q.mp4", output, 5, 40);
      expect(calls[0]!.cmd).toBe("ffmpeg");
      expect(calls[0]!.args).toEqual(buildFfmpegArgs("/cache/0RYeUT3Yl0Q.mp4", output, 5, 40));
      expect(calls[0]!.args).toEqual([
        "-ss", "5", "-to", "40", "-i", "/cache/0RYeUT3Yl0Q.mp4",
        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", output,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("getVersion usa -version y ffmpeg ausente da error claro", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const runner: CommandRunner = async (cmd, args) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: "ffmpeg version 6.1", stderr: "" };
    };
    expect(await createFfmpegClient(runner).getVersion()).toBe("ffmpeg version 6.1");
    expect(calls[0]!.args).toEqual(["-version"]);

    const missing: CommandRunner = async () => ({ code: 127, stdout: "", stderr: "" });
    await expect(createFfmpegClient(missing).getVersion()).rejects.toThrow(/ffmpeg/);
  });
});

describe("cutVideo (orquestación con clientes inyectados)", () => {
  it("descarga el original UNA vez y recorta cada segmento; status → cut", async () => {
    const db = await seededDb();
    const svc = createVideoService(db);
    const video = svc.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "0RYeUT3Yl0Q",
      url: YOUTUBE_URL,
      title: "Vitaminas y energía",
      durationS: 120,
    });
    const segA = svc.createSegment({
      videoId: video.id,
      condition: "Ansiedad o tensión",
      symptomId: ANXIETY,
      startS: 0,
      endS: 30,
      title: "Ansiedad o tensión",
    });
    const segB = svc.createSegment({
      videoId: video.id,
      condition: "Dolor de espalda",
      symptomId: BACK_PAIN,
      startS: 45,
      endS: 90,
      title: "Dolor de espalda",
    });

    const downloads: Array<{ url: string; output: string }> = [];
    const cuts: Array<{ input: string; output: string; startS: number; endS: number }> = [];
    const ytdlp = fakeYtdlp({
      downloadVideo: async (url, output) => {
        downloads.push({ url, output });
      },
    });
    const ffmpeg = fakeFfmpeg(cuts);

    const res = await cutVideo(video.id, {
      db,
      ytdlp,
      ffmpeg,
      cacheDir: "/cache",
      clipsRoot: "/clips",
    });

    // Descarga única al cache.
    expect(downloads).toEqual([{ url: YOUTUBE_URL, output: "/cache/0RYeUT3Yl0Q.mp4" }]);
    // Un recorte por segmento, en clips/<videoId>/<segmentId>.mp4.
    expect(cuts).toEqual([
      { input: "/cache/0RYeUT3Yl0Q.mp4", output: `/clips/${video.id}/${segA.id}.mp4`, startS: 0, endS: 30 },
      { input: "/cache/0RYeUT3Yl0Q.mp4", output: `/clips/${video.id}/${segB.id}.mp4`, startS: 45, endS: 90 },
    ]);
    expect(res.clips.map((c) => c.path)).toEqual([
      `/clips/${video.id}/${segA.id}.mp4`,
      `/clips/${video.id}/${segB.id}.mp4`,
    ]);
    // Estado promovido a cut.
    expect(svc.getVideoByYoutubeId("0RYeUT3Yl0Q")?.status).toBe("cut");
  });

  it("pre-fallback de binarios: pide versiones antes de descargar", async () => {
    const db = await seededDb();
    const svc = createVideoService(db);
    const video = svc.createVideo({
      speaker: "Luis",
      youtubeId: "0RYeUT3Yl0Q",
      url: YOUTUBE_URL,
      title: "t",
    });
    svc.createSegment({ videoId: video.id, startS: 0, endS: 10, title: "T" });
    const order: string[] = [];
    const ytdlp = fakeYtdlp({
      getVersion: async () => {
        order.push("yt-dlp");
        return "x";
      },
      downloadVideo: async () => {
        order.push("download");
      },
    });
    const ffmpeg = {
      getVersion: async () => {
        order.push("ffmpeg");
        return "x";
      },
      cut: async () => undefined,
    };
    await cutVideo(video.id, { db, ytdlp, ffmpeg, cacheDir: "/c", clipsRoot: "/k" });
    expect(order).toEqual(["yt-dlp", "ffmpeg", "download"]);
  });

  it("se niega sin video o sin segmentos", async () => {
    const db = await seededDb();
    const svc = createVideoService(db);
    const ytdlp = fakeYtdlp();
    const ffmpeg = fakeFfmpeg([]);
    const base = { db, ytdlp, ffmpeg, cacheDir: "/c", clipsRoot: "/k" };
    await expect(cutVideo(99999, base)).rejects.toThrow(/No existe el video/);
    const empty = svc.createVideo({ speaker: "s", youtubeId: "sin-segmentos", url: "u", title: "t" });
    await expect(cutVideo(empty.id, base)).rejects.toThrow(/no tiene segmentos/);
  });
});

describe("runCli", () => {
  it("--help no crashea, imprime uso y sale con 0", async () => {
    const out: string[] = [];
    const errOut: string[] = [];
    const code = await runCli(["--help"], { stdout: (l) => out.push(l), stderr: (l) => errOut.push(l) });
    expect(code).toBe(0);
    expect(errOut).toEqual([]);
    const text = out.join("\n");
    expect(text).toContain("analyze");
    expect(text).toContain("cut");
  });

  it("subcomando desconocido → sale con 2 y mensaje en stderr", async () => {
    const out: string[] = [];
    const errOut: string[] = [];
    const code = await runCli(["nope"], { stdout: (l) => out.push(l), stderr: (l) => errOut.push(l) });
    expect(code).toBe(2);
    expect(errOut.join("\n")).toMatch(/Desconocido|desconocido/);
  });

  it("analyze sin argumento → sale con 2 (uso)", async () => {
    const errOut: string[] = [];
    const code = await runCli(["analyze"], { stdout: () => undefined, stderr: (l) => errOut.push(l) });
    expect(code).toBe(2);
    expect(errOut.join("\n")).toContain("Uso");
  });

  it("analyze con URL no válida → sale con 1 y mensaje en español", async () => {
    const errOut: string[] = [];
    const code = await runCli(["analyze", "https://vimeo.com/123"], {
      db: await seededDb(),
      ytdlp: fakeYtdlp(),
      gemini: fakeGemini("{}"),
      stdout: () => undefined,
      stderr: (l) => errOut.push(l),
    });
    expect(code).toBe(1);
    expect(errOut.join("\n")).toContain("URL de YouTube no válida");
  });

  it("analyze sin GEMINI_API_KEY configurado → sale con 1 y mensaje claro", async () => {
    const errOut: string[] = [];
    const db = await seededDb();
    const code = await runCli(["analyze", YOUTUBE_URL], {
      db,
      ytdlp: fakeYtdlp(),
      gemini: {
        isConfigured: () => false,
        generate: async () => {
          throw new Error("no debería llamarse");
        },
      },
      stdout: () => undefined,
      stderr: (l) => errOut.push(l),
    });
    expect(code).toBe(1);
    expect(errOut.join("\n")).toContain("GEMINI_API_KEY");
  });

  it("analyze end-to-end con fakes → 0, filas persistidas y salida en español", async () => {
    const db = await seededDb();
    const out: string[] = [];
    const gemini = fakeGemini(
      JSON.stringify({
        segments: [
          {
            start_s: 0,
            end_s: 30,
            title: "Ansiedad o tensión",
            summary: "Hablamos de la ansiedad diaria.",
            condition: "Ansiedad o tensión",
          },
        ],
      }),
    );
    const code = await runCli(["analyze", YOUTUBE_URL], {
      db,
      gemini,
      ytdlp: fakeYtdlp(),
      stdout: (l) => out.push(l),
      stderr: (l) => out.push(l),
    });
    expect(code).toBe(0);
    const svc = createVideoService(db);
    const video = svc.getVideoByYoutubeId("0RYeUT3Yl0Q");
    expect(video?.status).toBe("analyzed");
    const segs = svc.listSegments().filter((s) => s.videoId === video!.id);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.symptomId).toBe(ANXIETY);
    expect(segs[0]!.condition).toBe("Ansiedad o tensión");
    expect(out.join("\n")).toContain("segmento(s) creados");
  });

  it("cut end-to-end con fakes → 0, imprime rutas + recordatorio de permiso y status=cut", async () => {
    const db = await seededDb();
    const svc = createVideoService(db);
    const video = svc.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "0RYeUT3Yl0Q",
      url: YOUTUBE_URL,
      title: "Vitaminas y energía",
    });
    svc.createSegment({ videoId: video.id, startS: 0, endS: 30, title: "T1" });
    const out: string[] = [];
    const code = await runCli(["cut", String(video.id)], {
      db,
      ytdlp: fakeYtdlp(),
      ffmpeg: fakeFfmpeg([]),
      cacheDir: "/cache",
      clipsRoot: "/clips",
      stdout: (l) => out.push(l),
      stderr: (l) => out.push(l),
    });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Recorte generado");
    expect(text).toContain(`status=cut`);
    expect(text.toLowerCase()).toContain("permiso escrito");
    expect(svc.getVideoByYoutubeId("0RYeUT3Yl0Q")?.status).toBe("cut");
  });

  it("cut sin id o con id no numérico → sale con 2", async () => {
    const errOut: string[] = [];
    const noArg = await runCli(["cut"], { stdout: () => undefined, stderr: (l) => errOut.push(l) });
    expect(noArg).toBe(2);
    const bad = await runCli(["cut", "abc"], { stdout: () => undefined, stderr: (l) => errOut.push(l) });
    expect(bad).toBe(2);
    expect(errOut.join("\n")).toContain("Uso");
  });
});
