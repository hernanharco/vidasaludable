/**
 * External-process access for the video pipeline: yt-dlp and ffmpeg.
 *
 * Every external process goes through an injectable `CommandRunner`, so tests
 * exercise the real client logic (argument construction, error handling) with
 * a fake runner and never spawn a subprocess or touch the network.
 *
 * Failure messages are in Spanish (CLI contract) and are thrown, not printed:
 * `runCli` is responsible for rendering them and choosing the exit code.
 */

import { execFile } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseVideoId } from "./parsers.js";

/** Result of a single external command invocation. */
export interface CommandResult {
  code: number; // process exit code (127-style when the binary is missing)
  stdout: string;
  stderr: string;
}

/**
 * Runs `cmd args...` and resolves with its outcome.
 *
 * ENOENT (binary missing) resolves with `code: 127` instead of rejecting, so
 * every caller handles "binary unavailable" uniformly through `code !== 0`.
 */
export type CommandRunner = (cmd: string, args: string[]) => Promise<CommandResult>;

/** Default runner backed by `node:child_process.execFile`. */
export const execCommandRunner: CommandRunner = (cmd, args) =>
  new Promise<CommandResult>((resolve) => {
    execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        const rawCode: unknown = (err as { code?: unknown }).code;
        // err.code is a number for non-zero exits, the string 'ENOENT' when
        // the binary does not exist → report 127 (command not found).
        const code = typeof rawCode === "number" ? rawCode : 127;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? err.message ?? "") });
        return;
      }
      resolve({ code: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

/** Last few lines of stderr — enough context without dumping full yt-dlp logs. */
function tailStderr(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(-3).join(" | ") || "sin detalles";
}

/** Normalized `yt-dlp -J` metadata. */
export interface YtDlpMetadata {
  id: string;
  title: string;
  durationS: number | null; // integer seconds, null when unknown
  speaker: string; // from `uploader`
}

/** Injectable yt-dlp access. Tests inject fakes; production uses createYtdlpClient. */
export interface YtdlpClient {
  /** `yt-dlp --version` preflight — throws a Spanish error when missing. */
  getVersion(): Promise<string>;
  /** `yt-dlp -J <url>` → title / duration / uploader (speaker). */
  getMetadata(url: string): Promise<YtDlpMetadata>;
  /**
   * `yt-dlp --skip-download --write-auto-subs --sub-langs es --sub-format
   * json3 -o <tmpdir>/%(id)s <url>` → the raw json3 payload. Owns the temp
   * dir lifecycle (created with mkdtemp, removed after reading).
   */
  getTranscript(url: string): Promise<unknown>;
  /** `yt-dlp -f "bv*+ba/b" -o <output> <url>` — download the original once. */
  downloadVideo(url: string, output: string): Promise<void>;
}

/** Real yt-dlp client. `runner` is injectable for tests. */
export function createYtdlpClient(runner: CommandRunner = execCommandRunner): YtdlpClient {
  // yt-dlp ≥2026.10 needs a JS runtime to solve YouTube's challenges
  // (EJS); without it extraction fails with "No supported JavaScript
  // runtime" (the I2 finding of the admin-video-analyze verification, which
  // surfaced as a real prod failure). `node` ships in the image and is on
  // PATH; --version needs no runtime, extraction calls all get the flag.
  const jsRuntime = ["--js-runtimes", "node"] as const;
  // yt-dlp plan B for datacenter IPs (prod incident 2026-10-25): YouTube
  // bot-checks Hetzner's IP and impersonation alone does NOT pass it —
  // verified probes; only authenticated sessions work.
  //
  // COOKIE-JAR TRAP (prod incident 2026-10-26): `--cookies FILE` is a
  // read-AND-DUMP target — on exit yt-dlp rewrites the jar and the dump
  // PRUNES the Google auth family (26 → 13 cookies on the first successful
  // run; SID, __Secure-1PSID, LOGIN_INFO… silently gone → the next run is
  // bot-checked again). A read-only file crashes instead (OSError 30). So
  // the master file (env YT_COOKIES_PATH, rw volume, NEVER in git) must
  // NEVER be the --cookies target: every extraction copies it to a
  // disposable "<path>.run" sibling, passes that, and removes the copy
  // afterwards — the master stays byte-identical run after run. Unset env →
  // no flag, behavior unchanged.
  const prepareCookies = (): { args: string[]; dispose: () => void } => {
    const path = process.env.YT_COOKIES_PATH?.trim();
    if (!path) return { args: [], dispose: () => {} };
    const run = `${path}.run`;
    try {
      copyFileSync(path, run);
    } catch (err) {
      // Master unreadable/missing: run WITHOUT cookies (the honest
      // bot-check error surfaces in the CRM) instead of letting yt-dlp
      // create or prune anything at the master path.
      console.error("[ytdlp] cookies master no copiable; se omite --cookies:", err);
      return { args: [], dispose: () => {} };
    }
    return {
      args: ["--cookies", run],
      dispose: () => {
        try {
          rmSync(run, { force: true });
        } catch {
          // best effort — a leftover .run is overwritten next run
        }
      },
    };
  };
  return {
    async getVersion(): Promise<string> {
      const res = await runner("yt-dlp", ["--version"]);
      if (res.code !== 0) {
        throw new Error(
          `No se encontró el binario 'yt-dlp' o no respondió (--version). Instálalo (p. ej. \"python3 -m pip install yt-dlp\") e inténtalo de nuevo. Detalle: ${tailStderr(res.stderr)}`,
        );
      }
      return res.stdout.trim();
    },

    async getMetadata(url: string): Promise<YtDlpMetadata> {
      const cookies = prepareCookies();
      let res: CommandResult;
      try {
        res = await runner("yt-dlp", [...jsRuntime, ...cookies.args, "-J", url]);
      } finally {
        cookies.dispose();
      }
      if (res.code !== 0) {
        throw new Error(
          `yt-dlp falló al leer los metadatos de ${url}. Verifica que la URL sea válida y que yt-dlp esté instalado. Detalle: ${tailStderr(res.stderr)}`,
        );
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(res.stdout) as Record<string, unknown>;
      } catch {
        throw new Error("yt-dlp devolvió metadatos ilegibles (JSON inválido).");
      }

      const id =
        typeof data.id === "string" && data.id.trim()
          ? data.id.trim()
          : parseVideoId(url);
      if (!id) throw new Error("yt-dlp no devolvió el id del video.");

      const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : "Sin título";
      const durationRaw = Number(data.duration);
      const durationS = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null;
      const speaker =
        typeof data.uploader === "string" && data.uploader.trim() ? data.uploader.trim() : "Desconocido";

      return { id, title, durationS, speaker };
    },

    async getTranscript(url: string): Promise<unknown> {
      const dir = await mkdtemp(join(tmpdir(), "video-subs-"));
      const cookies = prepareCookies();
      try {
        const res = await runner("yt-dlp", [
          ...jsRuntime,
          ...cookies.args,
          "--skip-download",
          "--write-auto-subs",
          "--sub-langs",
          "es",
          "--sub-format",
          "json3",
          "-o",
          join(dir, "%(id)s"),
          url,
        ]);
        if (res.code !== 0) {
          throw new Error(
            `yt-dlp falló al descargar los subtítulos de ${url}. Detalle: ${tailStderr(res.stderr)}`,
          );
        }
        const files = await readdir(dir);
        const subFile = files.find((f) => f.endsWith(".json3"));
        if (!subFile) {
          throw new Error(
            "No se encontró transcripción: el video no tiene subtítulos automáticos en español (formato json3).",
          );
        }
        const rawText = await readFile(join(dir, subFile), "utf8");
        try {
          return JSON.parse(rawText);
        } catch {
          throw new Error("El archivo de subtítulos json3 está dañado y no se pudo interpretar.");
        }
      } finally {
        cookies.dispose();
        await rm(dir, { recursive: true, force: true });
      }
    },

    async downloadVideo(url: string, output: string): Promise<void> {
      await mkdir(dirname(output), { recursive: true });
      const cookies = prepareCookies();
      let res: CommandResult;
      try {
        res = await runner("yt-dlp", [
          ...jsRuntime,
          ...cookies.args,
          "-f",
          "bv*+ba/b",
          "-o",
          output,
          url,
        ]);
      } finally {
        cookies.dispose();
      }
      if (res.code !== 0) {
        throw new Error(
          `yt-dlp falló al descargar el video original a ${output}. Detalle: ${tailStderr(res.stderr)}`,
        );
      }
      if (!existsSync(output)) {
        throw new Error(`yt-dlp terminó pero el archivo ${output} no existe.`);
      }
    },
  };
}

/**
 * Exact ffmpeg argument array for a frame-accurate re-encode cut
 * (`-y` overwrite first — re-cuts never prompt/fail on an existing clip —
 * then `-ss`/`-to` before `-i`, libx264 + aac). Pure — asserted verbatim by
 * backend/test/video-pipeline.test.ts.
 */
export function buildFfmpegArgs(input: string, output: string, startS: number, endS: number): string[] {
  return [
    "-y",
    "-ss",
    String(startS),
    "-to",
    String(endS),
    "-i",
    input,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    output,
  ];
}

/** Injectable ffmpeg access. Tests inject fakes; production uses createFfmpegClient. */
export interface FfmpegClient {
  /** `ffmpeg -version` preflight — throws a Spanish error when missing. */
  getVersion(): Promise<string>;
  /** Cut `input` between `startS`/`endS` into `output` (creates the output dir). */
  cut(input: string, output: string, startS: number, endS: number): Promise<void>;
}

/** Real ffmpeg client. `runner` is injectable for tests. */
export function createFfmpegClient(runner: CommandRunner = execCommandRunner): FfmpegClient {
  return {
    async getVersion(): Promise<string> {
      const res = await runner("ffmpeg", ["-version"]);
      if (res.code !== 0) {
        throw new Error(
          `No se encontró el binario 'ffmpeg' o no respondió (-version). Instálalo e inténtalo de nuevo. Detalle: ${tailStderr(res.stderr)}`,
        );
      }
      return res.stdout.trim();
    },

    async cut(input: string, output: string, startS: number, endS: number): Promise<void> {
      await mkdir(dirname(output), { recursive: true });
      const res = await runner("ffmpeg", buildFfmpegArgs(input, output, startS, endS));
      if (res.code !== 0) {
        throw new Error(
          `ffmpeg falló al recortar [${startS}s–${endS}s] de ${input}. Detalle: ${tailStderr(res.stderr)}`,
        );
      }
    },
  };
}
