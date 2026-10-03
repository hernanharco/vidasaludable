import type { Product } from "../db/schema.js";

/**
 * Agent prompt module.
 *
 * The system prompt enforces the LEGAL HARD LIMIT: the assistant is a
 * preventive/lifestyle recommender only. It MUST NOT diagnose, prescribe,
 * treat, or promise cures, and it MUST defer to a medical professional. The
 * catalog references injected here are valid rows from the database — the
 * agent only ever talks about products that actually exist (never invents).
 */

export interface CatalogContext {
  products: Product[];
}

export interface PurchaseContext {
  /** Product references the customer actually purchased, in insertion order. */
  refs: string[];
}

export interface GuidanceContext {
  /** Enabled, doctor-authored guidance entries (title + content + catalog refs). */
  items: Array<{ title: string; content: string; productReferences: string[] }>;
}

export interface VideoSegmentsContext {
  /** Enabled, admin-approved video segments the agent may cite in chat. */
  items: Array<{ id: number; title: string; condition: string | null; summary: string }>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const HARD_LIMIT = `ERES UN ASISTENTE PREVENTIVO DE NUTRILITE™. LÍMITE DURO E INVIOLABLE:

1. SOLO PREVENCIÓN Y ESTILO DE VIDA. Tu función es ofrecer orientación general de
   prevención y apoyo al estilo de vida con productos Nutrilite™. NUNCA diagnostiques,
   trates, prescribas, cures ni prometas curación de ninguna enfermedad, síntoma o
   condición de salud.
2. NUNCA digas qué enfermedad "padece" o "tiene" el usuario. NUNCA uses palabras como
   "diagnóstico", "tratamiento", "cura", "curación" ni "prescripción" referidas a su salud.
3. DERIVA SIEMPRE A CONSULTA MÉDICA. Ante cualquier síntoma, dolor o sospecha de
   enfermedad, recomienda consultar a un médico o profesional sanitario.
4. PRODUCTOS EXISTENTES SOLO. Solo puedes mencionar los productos del catálogo que se
   te inyectan a continuación. Si el usuario pide un producto que NO está en la lista,
   responde que no puedes recomendarlo porque no está en tu catálogo actual. NUNCA
   inventes productos, referencias, dosis, precios ni beneficios.
5. DATOS DE COMPRAS. Usa el historial de compras del usuario (si existe) para
   personalizar sugerencias preventivas, pero nunca lo cites de forma alarmante.
6. IDIOMA. Responde SIEMPRE en español, de forma clara y empática.
7. FORMATO. Cita las referencias de los productos que recomiendas entre corchetes,
   p. ej. [100305].
8. VIDEOS. Cita los videos educativos con su marcador exacto [VIDEO:id],
   usando SOLO los ids de la lista de videos inyectada a continuación: NUNCA
   inventes ids de video. Preséntalos SIEMPRE como contenido educativo sobre un
   tema, NUNCA como diagnóstico, tratamiento ni prescripción de la condición del
   usuario. Si ningún video coincide con el tema del usuario, simplemente no
   cites ninguno.`;

function catalogBlock(ctx: CatalogContext): string {
  if (ctx.products.length === 0) {
    return "CATÁLOGO DISPONIBLE: (vacío en este momento — no recomiendes ningún producto).";
  }
  const lines = ctx.products.map(
    (p) =>
      `- [${p.reference}] ${p.name} — ${p.category}. Dosis: ${p.dosage}. Beneficios: ${p.benefits}. ${p.disclaimer}`,
  );
  return `CATÁLOGO DISPONIBLE (referencias válidas):\n${lines.join("\n")}`;
}

function purchasesBlock(purchases: PurchaseContext | null): string {
  if (!purchases || purchases.refs.length === 0) {
    return "HISTORIAL DE COMPRAS DEL USUARIO: (sin compras registradas).";
  }
  return `HISTORIAL DE COMPRAS DEL USUARIO (referencias compradas, para personalizar sugerencias preventivas): ${purchases.refs.join(", ")}`;
}

/**
 * Doctor-authored guidance block. Omitted entirely when no guidance is
 * enabled — an empty knowledge base must never look like an empty context.
 */
function guidanceBlock(ctx: GuidanceContext): string {
  if (ctx.items.length === 0) {
    return "";
  }
  const lines = ctx.items.map(
    (g) => `- [${g.title}]: ${g.content} (productos: [${g.productReferences.join(", ")}])`,
  );
  return `GUÍAS DE LA DOCTORA (conocimiento clínico del profesional — úsalas para enriquecer las recomendaciones preventivas):\n${lines.join("\n")}`;
}

/**
 * Educational video segments block. Omitted entirely when no segment is
 * enabled — an empty knowledge base must never look like an empty context
 * (same convention as guidanceBlock: no stale header).
 */
export function videoSegmentsBlock(ctx: VideoSegmentsContext): string {
  if (ctx.items.length === 0) {
    return "";
  }
  const lines = ctx.items.map(
    (v) =>
      `- [VIDEO:${v.id}] ${v.title} — tema: ${v.condition ?? "(sin tema asignado)"} — ${v.summary}`,
  );
  return `VIDEOS EDUCATIVOS DISPONIBLES (cuando el tema del usuario coincida con un video, cita su marcador exacto):\n${lines.join("\n")}`;
}

/**
 * Builds the full system prompt, injecting only valid catalog rows, the
 * user's purchase history, the doctor's guidance and the enabled video
 * segments (server-side injection — never tool-calling). Empty blocks are
 * filtered out so no stale headers leak into the prompt.
 */
export function buildSystemPrompt(
  ctx: CatalogContext,
  purchases: PurchaseContext | null,
  guidance: GuidanceContext,
  video: VideoSegmentsContext,
): string {
  const blocks = [
    HARD_LIMIT,
    "",
    "CONTEXTO DE ESTA CONVERSACIÓN:",
    purchasesBlock(purchases),
    "",
    catalogBlock(ctx),
    guidanceBlock(guidance),
    videoSegmentsBlock(video),
  ].filter((block) => block.length > 0);
  return blocks.join("\n");
}

/**
 * Builds the concatenated chat history to send to Gemini so the model keeps
 * continuity across turns. The most recent user message is appended last.
 */
export function buildHistoryMessages(history: ChatMessage[], userMessage: string): ChatMessage[] {
  const tail = history.slice(-10);
  return [...tail, { role: "user", content: userMessage }];
}

/** Scans a reply for catalog references written as `[REF]` and returns them. */
export function extractProductRefs(reply: string): string[] {
  const matches = reply.match(/\[(\d{4,6})\]/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/[\[\]]/g, "")))];
}

/**
 * Scans a reply for video markers written as `[VIDEO:id]` and returns the
 * unique numeric ids in first-appearance order (mirrors extractProductRefs;
 * non-numeric or empty ids like `[VIDEO:abc]` never match).
 */
export function extractVideoRefs(reply: string): number[] {
  const matches = reply.match(/\[VIDEO:(\d+)\]/g) ?? [];
  return [...new Set(matches.map((m) => Number(m.replace("[VIDEO:", "").replace("]", ""))))];
}