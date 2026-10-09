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
  items: Array<{
    id: number;
    title: string;
    condition: string | null;
    summary: string;
    // T4 Phase A: raw integer seconds (YouTube &t= contract) — formatted
    // to mm:ss only in the human-facing prompt line, never in storage.
    startS: number;
    endS: number;
    // T5: products the educator mentions in the segment, paired with the
    // catalog ref when the mention matches a linked product (see
    // pairSegmentProducts). Omitted/empty ⇒ no `productos:` clause.
    products?: Array<{ mention: string; ref: string }>;
  }>;
}

/**
 * T2 chat-intake — the customer's intake profile (T1's `customer_profile`
 * row) as prompt context. All fields optional: a missing/empty field is
 * simply not rendered (never an "undefined" label in the prompt).
 */
export interface ProfileContext {
  sex?: string | number | null;
  age?: string | number | null;
  goal?: string | number | null;
  diet?: string | number | null;
  activity?: string | number | null;
  sleep?: string | number | null;
  stress?: string | number | null;
  openNote?: string | number | null;
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

/**
 * T2 chat-intake — guided flow over the injected profile. Always present in
 * the prompt (legal HARD_LIMIT rules above stay untouched); its steps apply
 * only when the "PERFIL DEL USUARIO" block is actually injected. The
 * [ASSESSMENT] marker must be written literally, once, on its own line —
 * the frontend matches it to render the 95-symptom check as a button.
 */
const GUIDED_FLOW = `FLUJO GUIADO CON EL PERFIL INICIAL DEL USUARIO (aplica solo cuando se inyecte el bloque de perfil inicial a continuación):
1. ABRE tu respuesta con 2-3 preguntas cortas y abiertas de seguimiento basadas
   en el perfil (p. ej. su rutina, sus horarios o sus preferencias). NO vuelvas a
   preguntar datos que el perfil ya responde.
2. DESPUÉS da tus recomendaciones preventivas personalizadas con el perfil,
   citando las referencias [REF] y los videos [VIDEO:id] con las mismas reglas
   de siempre.
3. AL FINAL de tu primera recomendación completa, ofrece de forma OPCIONAL el
   chequeo completo de 95 síntomas escribiendo el marcador exacto [ASSESSMENT]
   en una línea propia (el frontend lo renderiza como botón). Escríbelo
   exactamente así, una sola vez, sin texto adicional en esa línea.
Cuando NO haya bloque de perfil, omite este flujo guiado y responde directamente.`;

/**
 * Normalizes a profile field for display: null/undefined/blank-string all
 * degrade to null so empty intake answers never render a label.
 */
function presentProfileField(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/**
 * T2 chat-intake — human-readable Spanish block with the customer's intake
 * profile, so Gemini personalizes every recommendation. Same convention as
 * guidanceBlock/videoSegmentsBlock: null OR an all-empty profile returns ""
 * (no stale header). Only lines with at least one present field are rendered.
 */
export function profileBlock(profile: ProfileContext | null): string {
  if (!profile) return "";
  const sex = presentProfileField(profile.sex);
  const age = presentProfileField(profile.age);
  const goal = presentProfileField(profile.goal);
  const diet = presentProfileField(profile.diet);
  const activity = presentProfileField(profile.activity);
  const sleep = presentProfileField(profile.sleep);
  const stress = presentProfileField(profile.stress);
  const openNote = presentProfileField(profile.openNote);

  const lines: string[] = [];
  const identity = [age ? `Edad: ${age}` : null, sex ? `Sexo: ${sex}` : null].filter(
    (part): part is string => part !== null,
  );
  if (identity.length > 0) lines.push(`- ${identity.join(" · ")}`);
  if (goal) lines.push(`- Objetivo: ${goal}`);
  const habits = [diet ? `dieta ${diet}` : null, activity ? `actividad ${activity}` : null].filter(
    (part): part is string => part !== null,
  );
  if (habits.length > 0) lines.push(`- Hábitos: ${habits.join(", ")}`);
  const recovery = [sleep ? `Sueño: ${sleep}` : null, stress ? `Estrés: ${stress}` : null].filter(
    (part): part is string => part !== null,
  );
  if (recovery.length > 0) lines.push(`- ${recovery.join(" · ")}`);
  if (openNote) lines.push(`- Me contó: "${openNote}"`);

  if (lines.length === 0) return "";
  return `PERFIL DEL USUARIO (datos de su ficha inicial — personaliza siempre tus recomendaciones con ellos):\n${lines.join("\n")}`;
}

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
 * Local YouTube-style timestamp for the prompt's human-readable segment
 * lines (T4 Phase A). Storage and API payloads keep integer seconds; only
 * display layers format. Invalid input degrades to 0:00 (mirrors the
 * frontend `formatTime` in frontend/src/app/lib/format.ts).
 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Segment time range in YouTube style: `0:05–1:49` (no spaces). */
function formatTimeRange(startS: number, endS: number): string {
  return `${formatTime(startS)}–${formatTime(endS)}`;
}

/**
 * T5 — pairs a segment's raw product mentions with catalog refs for the
 * prompt's `productos:` clause. Linking is catalog-anchored (ODD Decision):
 * a mention pairs with a product when it matches the catalog product NAME
 * (containment rules mirroring matchSymptom — accent/brand-insensitive) AND
 * that product's ref is among the segment's stored `product_references`.
 * Mentions that match nothing linked stay raw (no ref); stored refs with no
 * matching mention (admin-linked by hand) render with the catalog name.
 *
 * Pure: no DB access. The catalog is the same product list the chat already
 * injects, so an unlinked or unknown mention never gains an invented ref.
 */
export function pairSegmentProducts(
  mentions: string[],
  refs: string[],
  catalog: Array<{ name: string; reference: string }>,
): Array<{ mention: string; ref: string }> {
  const refSet = new Set(refs);
  const out: Array<{ mention: string; ref: string }> = [];
  const consumed = new Set<string>();
  for (const mention of mentions) {
    const hit = matchCatalogProduct(mention, catalog);
    if (hit && refSet.has(hit.reference)) {
      out.push({ mention, ref: hit.reference });
      consumed.add(hit.reference);
    } else {
      out.push({ mention, ref: "" });
    }
  }
  for (const ref of refs) {
    if (!consumed.has(ref)) {
      const name = catalog.find((p) => p.reference === ref)?.name ?? ref;
      out.push({ mention: name, ref });
    }
  }
  return out;
}

/**
 * Accent/brand-insensitive normalization for product-name matching: the same
 * rules as normalizeSymptomText (lowercase → strip diacritics → punctuation
 * and symbols such as ™ collapse to single spaces → trim), so "Cal Mag D
 * Plus" matches "Nutrilite™ Cal Mag D Plus".
 */
function normalizeProductName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best catalog product for a raw mention (mirrors matchSymptom's containment
 * rules, over names instead of symptom vocabulary):
 * - exact post-normalization match wins;
 * - name contains the mention (the mention is a fragment) → prefer the
 *   SHORTEST name (most specific product that still fits);
 * - mention contains the whole name → prefer the LONGEST name (most
 *   informative product carried by the mention).
 * Nothing comparable → null.
 */
function matchCatalogProduct(
  mention: string,
  catalog: Array<{ name: string; reference: string }>,
): { name: string; reference: string } | null {
  const needle = normalizeProductName(mention);
  if (!needle) return null;
  let best: { name: string; reference: string } | null = null;
  let bestScore = -Infinity;
  for (const product of catalog) {
    const name = normalizeProductName(product.name);
    if (!name) continue;
    let score: number;
    if (name === needle) {
      score = 3;
    } else if (name.includes(needle)) {
      score = 2 - name.length / 1e6;
    } else if (needle.includes(name)) {
      score = 1 + name.length / 1e6;
    } else {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return best;
}

/**
 * Educational video segments block. Omitted entirely when no segment is
 * enabled — an empty knowledge base must never look like an empty context
 * (same convention as guidanceBlock: no stale header).
 *
 * T5: when a segment carries products, the line gains the `productos:` clause
 * AFTER the time range — `… (0:05–1:49) — productos: Cal Mag D Plus [110606],
 * Double X [121576] — <summary>`; the clause is omitted entirely when the
 * product list is empty (or the item carries none).
 */
export function videoSegmentsBlock(ctx: VideoSegmentsContext): string {
  if (ctx.items.length === 0) {
    return "";
  }
  const lines = ctx.items.map((v) => {
    const products = v.products ?? [];
    const productsClause =
      products.length > 0
        ? ` — productos: ${products.map((p) => (p.ref ? `${p.mention} [${p.ref}]` : p.mention)).join(", ")}`
        : "";
    return `- [VIDEO:${v.id}] ${v.title} — tema: ${v.condition ?? "(sin tema asignado)"} (${formatTimeRange(v.startS, v.endS)})${productsClause} — ${v.summary}`;
  });
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
  // T2 chat-intake: optional (backwards-compatible) so existing 4-arg calls
  // keep working; null/undefined ⇒ no profile block injected.
  profile?: ProfileContext | null,
): string {
  const blocks = [
    HARD_LIMIT,
    GUIDED_FLOW,
    "",
    "CONTEXTO DE ESTA CONVERSACIÓN:",
    profileBlock(profile ?? null),
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