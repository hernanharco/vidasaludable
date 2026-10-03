import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  buildSystemPrompt,
  extractVideoRefs,
  pairSegmentProducts,
  videoSegmentsBlock,
} from "../src/agent/prompt.js";
import { createDatabase } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { seedProducts } from "../src/seed/seedProducts.js";
import { seedGuidance } from "../src/seed/seedGuidance.js";
import { buildApp } from "../src/index.js";
import { createVideoService } from "../src/services/videoService.js";
import type { VideoSegment } from "../src/db/schema.js";
import type { Hono } from "hono";

/**
 * T6 — agent integration for educational video segments.
 *
 * Unit level: `extractVideoRefs` (the `[VIDEO:id]` mirror of
 * `extractProductRefs`), `videoSegmentsBlock` (empty ⇒ "", exactly like
 * `guidanceBlock`) and `buildSystemPrompt`'s fourth parameter (block appended
 * after guidance, no stale header when empty).
 *
 * Route level: follows `assistant.integration.test.ts` — the Gemini HTTP
 * boundary is stubbed at `fetch`, so the real request body (systemInstruction)
 * and the real response JSON are both observable without a key or network.
 */
describe("extractVideoRefs", () => {
  it("extracts a single marker as a number", () => {
    expect(extractVideoRefs("Mira este video [VIDEO:12] sobre el sueño.")).toEqual([12]);
  });

  it("extracts several markers in first-appearance order", () => {
    expect(extractVideoRefs("[VIDEO:9] y también [VIDEO:2]")).toEqual([9, 2]);
  });

  it("deduplicates repeated ids keeping first appearance", () => {
    expect(extractVideoRefs("[VIDEO:5] ... de nuevo [VIDEO:5]")).toEqual([5]);
    expect(extractVideoRefs("[VIDEO:7] [VIDEO:3] [VIDEO:7]")).toEqual([7, 3]);
  });

  it("ignores non-numeric and empty ids", () => {
    expect(extractVideoRefs("[VIDEO:abc]")).toEqual([]);
    expect(extractVideoRefs("[VIDEO:]")).toEqual([]);
    expect(extractVideoRefs("[VIDEO: 4] espaciado")).toEqual([]);
    expect(extractVideoRefs("[VIDEO:2] válida y [VIDEO:abc] inválida")).toEqual([2]);
  });

  it("returns [] when the reply carries no markers", () => {
    expect(extractVideoRefs("Sin videos citados [100305].")).toEqual([]);
    expect(extractVideoRefs("")).toEqual([]);
  });
});

describe("videoSegmentsBlock", () => {
  it("renders the header plus one exact line per item", () => {
    const block = videoSegmentsBlock({
      items: [
        { id: 12, title: "Ejercicios para la espalda", condition: "Dolor de espalda", summary: "Movilidad suave.", startS: 5, endS: 109 },
        { id: 3, title: "Sueño saludable", condition: null, summary: "Hábitos de descanso.", startS: 0, endS: 300 },
      ],
    });
    expect(block).toContain(
      "VIDEOS EDUCATIVOS DISPONIBLES (cuando el tema del usuario coincida con un video, cita su marcador exacto):",
    );
    // T4 Phase A: each line carries the YouTube-style time range after the topic.
    expect(block).toContain(
      "- [VIDEO:12] Ejercicios para la espalda — tema: Dolor de espalda (0:05–1:49) — Movilidad suave.",
    );
    expect(block).toContain(
      "- [VIDEO:3] Sueño saludable — tema: (sin tema asignado) (0:00–5:00) — Hábitos de descanso.",
    );
    // Exactly one line per item (header + 2 lines).
    expect(block.split("\n")).toHaveLength(3);
  });

  it("returns \"\" for empty items (no stale header, same as guidanceBlock)", () => {
    expect(videoSegmentsBlock({ items: [] })).toBe("");
  });

  it("añade la cláusula productos después del rango horario cuando hay productos", () => {
    const block = videoSegmentsBlock({
      items: [
        {
          id: 12,
          title: "Ejercicios para la espalda",
          condition: "Dolor de espalda",
          summary: "Movilidad suave.",
          startS: 5,
          endS: 109,
          products: [
            { mention: "Cal Mag D Plus", ref: "110606" },
            { mention: "Double X", ref: "121576" },
          ],
        },
      ],
    });
    expect(block).toContain(
      "- [VIDEO:12] Ejercicios para la espalda — tema: Dolor de espalda (0:05–1:49) — productos: Cal Mag D Plus [110606], Double X [121576] — Movilidad suave.",
    );
  });

  it("omite la cláusula productos cuando la lista está vacía o el item no la trae", () => {
    const withEmpty = videoSegmentsBlock({
      items: [
        { id: 1, title: "T", condition: null, summary: "s", startS: 0, endS: 30, products: [] },
      ],
    });
    expect(withEmpty).toContain("- [VIDEO:1] T — tema: (sin tema asignado) (0:00–0:30) — s");
    expect(withEmpty).not.toContain("productos:");

    const withoutField = videoSegmentsBlock({
      items: [{ id: 2, title: "T2", condition: null, summary: "s", startS: 0, endS: 30 }],
    });
    expect(withoutField).not.toContain("productos:");
  });

  it("renderiza la mención sin corchetes cuando no hay ref enlazado", () => {
    const block = videoSegmentsBlock({
      items: [
        {
          id: 5,
          title: "T",
          condition: null,
          summary: "s",
          startS: 0,
          endS: 30,
          products: [{ mention: "Vitamina C", ref: "" }],
        },
      ],
    });
    expect(block).toContain("— productos: Vitamina C — s");
  });
});

describe("pairSegmentProducts", () => {
  const catalog = [
    { name: "Nutrilite™ Cal Mag D Plus", reference: "110606" },
    { name: "Nutrilite™ Double X™ Multivitaminas / Multiminerales / Fitonutrientes", reference: "121576" },
    { name: "Nutrilite™ Proteína Vegetal", reference: "110415" },
  ];

  it("vincula cada mención con su ref de catálogo (match por nombre, insensible a marca/mayúsculas)", () => {
    expect(
      pairSegmentProducts(["Cal Mag D Plus", "Double X"], ["110606", "121576"], catalog),
    ).toEqual([
      { mention: "Cal Mag D Plus", ref: "110606" },
      { mention: "Double X", ref: "121576" },
    ]);
  });

  it("mención sin ref enlazado se queda cruda; ref sin mención se renderiza con el nombre del catálogo", () => {
    // "Vitamina C" no está en el catálogo → mention cruda; "Proteína Vegetal"
    // sí coincide con un producto cuyo ref está enlazado → pareada.
    expect(
      pairSegmentProducts(["Vitamina C", "Proteína Vegetal"], ["110415"], catalog),
    ).toEqual([
      { mention: "Vitamina C", ref: "" },
      { mention: "Proteína Vegetal", ref: "110415" },
    ]);
    // Ref administrativa sin mención asociada → nombre del catálogo + ref.
    expect(pairSegmentProducts([], ["110606"], catalog)).toEqual([
      { mention: "Nutrilite™ Cal Mag D Plus", ref: "110606" },
    ]);
  });

  it("arrays vacíos → [] (la cláusula productos se omite)", () => {
    expect(pairSegmentProducts([], [], catalog)).toEqual([]);
  });
});

describe("buildSystemPrompt (video context parameter)", () => {
  const catalog = { products: [] as never[] };
  const guidance = {
    items: [
      { title: "Paquete Vitalidad", content: "Energía diaria.", productReferences: ["100305"] },
    ],
  };

  it("appends the video block after the guidance block", () => {
    const prompt = buildSystemPrompt(catalog, null, guidance, {
      items: [
        { id: 8, title: "Estiramientos matutinos", condition: "Dolor muscular", summary: "Rutina breve.", startS: 0, endS: 120 },
      ],
    });
    const guidanceIdx = prompt.indexOf("GUÍAS DE LA DOCTORA");
    const videoIdx = prompt.indexOf("VIDEOS EDUCATIVOS DISPONIBLES");
    expect(guidanceIdx).toBeGreaterThanOrEqual(0);
    expect(videoIdx).toBeGreaterThan(guidanceIdx);
    expect(prompt).toContain("- [VIDEO:8] Estiramientos matutinos — tema: Dolor muscular (0:00–2:00) — Rutina breve.");
  });

  it("omits the video block entirely when the video context is empty", () => {
    const prompt = buildSystemPrompt(catalog, null, guidance, { items: [] });
    expect(prompt).not.toContain("VIDEOS EDUCATIVOS");
    expect(prompt).not.toContain("- [VIDEO:"); // no injected marker lines
    // The rest of the context still arrives intact.
    expect(prompt).toContain("GUÍAS DE LA DOCTORA");
    expect(prompt).toContain("CATÁLOGO DISPONIBLE");
  });

  it("keeps the HARD_LIMIT video citation rule in the prompt", () => {
    const prompt = buildSystemPrompt(catalog, null, guidance, { items: [] });
    expect(prompt).toContain("8.");
    expect(prompt).toContain("[VIDEO:id]");
  });
});

describe("ask route: video block injection + video_refs filtering", () => {
  let db: Db;
  let app: Hono;
  let capturedBodies: Array<{ systemInstruction?: unknown }>;
  let cannedReply = "";
  let enabledSegment: VideoSegment;
  let disabledSegment: VideoSegment;

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const register = async (email: string) => {
    const res = await post("/assistant/register", {
      name: "Cliente Video",
      email,
      phone: "3007",
      consent_version: 1,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { customer_id: number }).customer_id;
  };

  const ask = async (customerId: number, message: string) => {
    const res = await post("/assistant/ask", { customer_id: customerId, message });
    expect(res.status).toBe(200);
    return (await res.json()) as { reply: string; video_refs: number[] };
  };

  beforeAll(async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-test";
    capturedBodies = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body?: string }) => {
      capturedBodies.push(JSON.parse(init?.body ?? "{}"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: cannedReply }] } }],
        }),
      };
    });

    db = createDatabase(":memory:");
    await migrate(db);
    await seedProducts(db);
    await seedGuidance(db);

    // One approved (enabled) segment and one not yet approved (enabled=0).
    const videos = createVideoService(db);
    const video = videos.createVideo({
      speaker: "Luis Collantes",
      youtubeId: "yt-video-t6",
      url: "https://www.youtube.com/watch?v=yt-video-t6",
      title: "Salud natural",
    });
    enabledSegment = videos.createSegment({
      videoId: video.id,
      condition: "Dolor de espalda",
      startS: 10,
      endS: 70,
      title: "Ejercicios para la espalda",
      summary: "Movilidad suave para el día a día.",
      enabled: 1,
    });
    disabledSegment = videos.createSegment({
      videoId: video.id,
      startS: 100,
      endS: 150,
      title: "Video sin aprobar",
      summary: "No debe inyectarse en el chat.",
      enabled: 0,
    });

    app = buildApp(db);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it("injects the video block in the system prompt and returns valid video_refs", async () => {
    cannedReply =
      `Puedes ver este video educativo [VIDEO:${enabledSegment.id}] sobre la espalda ` +
      "como complemento a tus hábitos. Consulta a tu médico si tienes dudas.";
    const customerId = await register("video@x.com");

    const data = await ask(customerId, "¿qué puedo hacer para mi espalda?");

    // The marker itself is kept in the reply (persisted like product [REF]s).
    expect(data.reply).toContain(`[VIDEO:${enabledSegment.id}]`);
    expect(data.video_refs).toEqual([enabledSegment.id]);

    // The system prompt sent to Gemini carried the video block with the
    // ENABLED segment only — the disabled one never reaches the agent.
    const sent = capturedBodies[capturedBodies.length - 1];
    const sysPrompt = (sent.systemInstruction as { parts: { text: string }[] }).parts[0].text;
    expect(sysPrompt).toContain("VIDEOS EDUCATIVOS DISPONIBLES");
    // T4 Phase A: the injected line carries the segment's mm:ss time range
    // (segment created with startS 10, endS 70 → 0:10–1:10).
    expect(sysPrompt).toContain(
      `[VIDEO:${enabledSegment.id}] Ejercicios para la espalda — tema: Dolor de espalda (0:10–1:10)`,
    );
    expect(sysPrompt).toContain("tema: Dolor de espalda");
    expect(sysPrompt).not.toContain(disabledSegment.title);
    // Video block comes after the guidance block, per spec.
    expect(sysPrompt.indexOf("VIDEOS EDUCATIVOS DISPONIBLES")).toBeGreaterThan(
      sysPrompt.indexOf("GUÍAS DE LA DOCTORA"),
    );
  });

  it("filters unknown and non-enabled ids out of video_refs (reply keeps its text)", async () => {
    cannedReply =
      `Video [VIDEO:${disabledSegment.id}] sin aprobar y otro [VIDEO:999] inexistente. ` +
      "Consulta a tu médico ante dudas.";
    const customerId = await register("video2@x.com");

    const data = await ask(customerId, "muéstrame videos");

    // Defensive filtering: neither the disabled segment nor the invented id
    // survives into video_refs — same pattern as product refs + catalog.lookup.
    expect(data.video_refs).toEqual([]);
    expect(data.video_refs).not.toContain(disabledSegment.id);
    expect(data.video_refs).not.toContain(999);
    // The reply text itself is untouched (markers persist as written).
    expect(data.reply).toContain("[VIDEO:999]");
  });

  it("returns video_refs [] when the reply cites no video at all", async () => {
    cannedReply = "Cuida tu alimentación equilibrada. Consulta a tu médico ante dudas.";
    const customerId = await register("video3@x.com");

    const data = await ask(customerId, "hola");
    expect(data.video_refs).toEqual([]);
  });

  it("inyecta la cláusula productos (mención [ref]) cuando el segmento tiene productos", async () => {
    // Segment with product mentions linked to the seeded catalog
    // (seedProducts: "Nutrilite™ Cal Mag D Plus" 110606, Double X 121576).
    const productSegment = createVideoService(db).createSegment({
      videoId: enabledSegment.videoId,
      condition: "Dolor de espalda",
      startS: 0,
      endS: 120,
      title: "Nutrición para la espalda",
      summary: "El educador menciona productos.",
      enabled: 1,
      mentionedProducts: ["Cal Mag D Plus", "Double X"],
      productReferences: ["110606", "121576"],
    });
    cannedReply =
      `Mira este video educativo [VIDEO:${productSegment.id}] y consulta a tu médico ante dudas.`;
    const customerId = await register("video-products@x.com");

    await ask(customerId, "¿qué productos para la espalda?");

    const sent = capturedBodies[capturedBodies.length - 1];
    const sysPrompt = (sent.systemInstruction as { parts: { text: string }[] }).parts[0].text;
    // T5: la línea lleva la cláusula productos DESPUÉS del rango horario.
    expect(sysPrompt).toContain(
      `[VIDEO:${productSegment.id}] Nutrición para la espalda — tema: Dolor de espalda (0:00–2:00) — productos: Cal Mag D Plus [110606], Double X [121576] — El educador menciona productos.`,
    );
  });
});
