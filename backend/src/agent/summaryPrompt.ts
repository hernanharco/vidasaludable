/**
 * Spanish prompt for the advisor executive summary (advisor-summary, S1/S2/S4).
 *
 * The PUBLIC of this summary is the asesora/nutricionista — a technical person
 * who advises and sells — so the persona is her analyst: the output must be
 * concrete, actionable and sales-aware, never a chat reply for the customer.
 *
 * The context is gathered server-side by summaryService (customer row, intake
 * profile, ALL chat messages chronological, recommendations log, purchases)
 * and rendered here into labeled sections. The instruction is explicit: never
 * invent data that is not in the context (same defensive rule as the agent's
 * catalog-anchored citations).
 */

/** Context gathered by the service; consumed verbatim by the prompt builder. */
export interface SummaryPromptContext {
  customer: { name: string; phone: string };
  /** Intake profile row, or null when the customer never answered it. */
  profile: {
    sex: string | null;
    age: number | null;
    goal: string | null;
    diet: string | null;
    activity: string | null;
    sleep: string | null;
    stress: string | null;
    openNote: string | null;
  } | null;
  /** ALL chat messages, chronological, across every conversation. */
  chatMessages: Array<{ role: string; content: string }>;
  /** Recommendations audit log (symptom + referenced products + rationale). */
  recommendations: Array<{
    symptom: string;
    productReferences: string[];
    rationale: string;
  }>;
  /** Purchase history (product name, qty, date). */
  purchases: Array<{ productName: string; qty: number; purchasedAt: string }>;
}

/** Fixed persona + output contract — the service sends it as the system prompt. */
export const SUMMARY_SYSTEM_PROMPT = [
  "Eres la analista de la asesora/nutricionista. Preparas un resumen ejecutivo",
  "TÉCNICO para ella: ella asesora y vende, y necesita entender rápido qué",
  "busca el cliente, qué se le dijo ya y cuál es el mejor siguiente paso.",
  "",
  "Respondé SIEMPRE en español, en secciones markdown cortas, exactamente con",
  "estos títulos:",
  "## Qué consulta",
  "## Dolores y objeciones",
  "## Qué se le recomendó",
  "## Señales de venta y productos de interés",
  "## Siguiente paso sugerido",
  "",
  "Reglas: concreto y accionable (fechas, nombres de productos, objeciones",
  "textuales); máximo ~300 palabras en total; NO inventes datos que no estén",
  "en el contexto — si algo falta, no lo menciones.",
].join("\n");

/** Renders "— field: value (sin registro)" lines for an optional block. */
function lines(fields: Array<[string, string | number | null | undefined]>): string {
  const rendered = fields.map(
    ([label, value]) => `- ${label}: ${value == null || value === "" ? "(sin registro)" : String(value)}`,
  );
  return rendered.length > 0 ? rendered.join("\n") : "(sin registro)";
}

/**
 * Builds the Spanish user prompt carrying the customer's FULL history (S4):
 * customer data, intake profile, every chat message chronological with its
 * role, the recommendations log and the purchases. Empty sections degrade to
 * "(sin registro)" instead of being omitted, so the analyst sees what is
 * missing at a glance.
 */
export function buildSummaryPrompt(context: SummaryPromptContext): string {
  const { customer, profile, chatMessages, recommendations, purchases } = context;

  const chatBlock =
    chatMessages.length > 0
      ? chatMessages.map((m) => `[${m.role}] ${m.content}`).join("\n")
      : "(sin registro)";

  const recommendationsBlock =
    recommendations.length > 0
      ? recommendations
          .map(
            (r) =>
              `- Síntoma/consulta: ${r.symptom}\n` +
              `  Productos referenciados: ${r.productReferences.length > 0 ? r.productReferences.join(", ") : "(ninguno)"}\n` +
              `  Fundamento: ${r.rationale}`,
          )
          .join("\n")
      : "(sin registro)";

  const purchasesBlock =
    purchases.length > 0
      ? purchases
          .map((p) => `- ${p.productName} — cantidad ${p.qty} — ${p.purchasedAt}`)
          .join("\n")
      : "(sin registro)";

  return [
    "DATOS DEL CLIENTE",
    lines([
      ["Nombre", customer.name],
      ["Teléfono", customer.phone],
    ]),
    "",
    "PERFIL DE LA ENCUESTA DE INTAKE",
    profile
      ? lines([
          ["Sexo", profile.sex],
          ["Edad", profile.age],
          ["Objetivo", profile.goal],
          ["Dieta", profile.diet],
          ["Actividad física", profile.activity],
          ["Sueño", profile.sleep],
          ["Estrés", profile.stress],
          ["Nota abierta", profile.openNote],
        ])
      : "(sin registro)",
    "",
    "HISTORIAL DE CHAT (todos los mensajes, orden cronológico, rol entre corchetes)",
    chatBlock,
    "",
    "RECOMENDACIONES DEL LOG",
    recommendationsBlock,
    "",
    "COMPRAS",
    purchasesBlock,
    "",
    "Generá ahora el resumen ejecutivo para la asesora siguiendo el formato del system prompt.",
  ].join("\n");
}
