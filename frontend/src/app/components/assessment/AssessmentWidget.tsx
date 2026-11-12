import React, { useState, useEffect, useCallback } from "react";
import { ClipboardCheck, X, ChevronRight, ChevronLeft, Check, Loader2, Mail, User, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Progress } from "../ui/progress";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "../ui/dialog";
import { CheckCircle2 } from "lucide-react";

import { AssessmentWelcome } from "./AssessmentWelcome";
import { AssessmentSymptoms } from "./AssessmentSymptoms";
import { AssessmentResults } from "./AssessmentResults";
import { AccessCodeGate } from "../AccessCodeGate";
import { CitaAppointmentButton } from "../chat/CitaAppointmentButton";
import { QuestionnaireData, CalculateResponse, AssessmentSaved, SYMPTOMS_PER_STEP } from "./types";

/**
 * Prevention Assessment Widget — controlled wizard modal.
 *
 * T4: the widget no longer owns an `isOpen` state nor renders the floating
 * "Prevenición" button (single-button UX — the chat owns the entry point).
 * The parent passes `open` and receives `onClose`; when `open === false`
 * nothing is rendered.
 *
 * Flow:
 * 0. Access code gate (referrer tracking)
 * 1. Welcome: patient data (name, sex, age)
 * 2. Symptoms: grouped ~12 per step, checkbox SI/NO
 * 3. Results: nutrient scores + recommendations + PDF/email
 */

export interface AssessmentWidgetProps {
  /** Whether the wizard modal is visible. */
  open: boolean;
  /** Requested by the X button and the backdrop click. */
  onClose: () => void;
}

/**
 * Access-code-once: keys shared with the chat gate (ChatSession STORAGE).
 * Once a referrer has been validated in this browser, neither widget asks
 * again; the assessment still attaches `referrer_id` to its saves from here.
 */
const REFERRER_STORAGE = { id: "vr_referrer_id", name: "vr_referrer_name" };

/**
 * localStorage may be unavailable (opaque test origins, privacy modes) —
 * never crash the wizard over it: an unreadable store just means "ask the
 * code again" (read) or "the gate stays one-time-less" (write).
 */
function readStoredReferrer(): { id: number; name: string | null } | null {
  try {
    const raw = window.localStorage?.getItem(REFERRER_STORAGE.id);
    if (raw == null) return null;
    const id = Number(raw);
    if (!Number.isFinite(id)) return null;
    return { id, name: window.localStorage?.getItem(REFERRER_STORAGE.name) ?? null };
  } catch {
    return null;
  }
}

function persistReferrer(id: number, name: string): void {
  try {
    window.localStorage?.setItem(REFERRER_STORAGE.id, String(id));
    window.localStorage?.setItem(REFERRER_STORAGE.name, name);
  } catch {
    // Degrades to asking the code again on the next visit — never blocks.
  }
}

/**
 * T6c — stored chat identity for the results CTA. Same read contract as
 * ChatSession's `readStoredNumber` (positive integer): a missing or corrupt
 * `vr_customer_id` degrades to the no-identity branch (link to the landing
 * booking form), never to a broken dialog.
 */
function readStoredCustomerId(): number | null {
  try {
    const raw = window.localStorage?.getItem("vr_customer_id");
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** The server's `{error}` string from a failed reply, or null when absent (ChatSession copy). */
async function readServerError(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data?.error === "string" && data.error !== "" ? data.error : null;
  } catch {
    return null;
  }
}

/** Transport-failure copy for the T6c appointment POST (ChatSession copy, identical). */
const CONNECTION_ERROR =
  "No pudimos conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.";

export function AssessmentWidget({ open, onClose }: AssessmentWidgetProps) {
  const [phase, setPhase] = useState<"access_code" | "loading" | "welcome" | "symptoms" | "calculating" | "results">("access_code");
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireData | null>(null);

  // S3a — control that had focus when the dialog opened; focus returns to
  // it on close (Radix's built-in restore targets DialogTrigger, which a
  // controlled dialog with an external trigger does not have).
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  // Access code state
  const [referrerId, setReferrerId] = useState<number | null>(null);
  const [referrerName, setReferrerName] = useState<string | null>(null);

  // Patient data
  const [patientName, setPatientName] = useState("");
  const [patientSex, setPatientSex] = useState<"M" | "F" | "">("");
  const [patientAge, setPatientAge] = useState("");

  // Symptoms
  const [currentStep, setCurrentStep] = useState(0);
  const [responses, setResponses] = useState<Map<number, boolean>>(new Map());

  // Results
  const [results, setResults] = useState<CalculateResponse | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [expandedNutrient, setExpandedNutrient] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Load questionnaire after access code validation
  const loadQuestionnaire = useCallback(() => {
    setPhase("loading");
    fetch("/api/assessment/questionnaire")
      .then((r) => {
        // A non-2xx body must NOT be stored as the questionnaire — it used
        // to crash the wizard on render (questionnaire.symptoms undefined).
        if (r.ok === false) throw new Error(`questionnaire HTTP ${r.status}`);
        return r.json();
      })
      .then((data: QuestionnaireData) => {
        setQuestionnaire(data);
        setPhase("welcome");
      })
      .catch(() => {
        setTimeout(() => window.location.reload(), 2000);
      });
  }, []);

  // Access code validated → remember the code (one-time gate) and load the
  // questionnaire. Persisted so future visits — chat or assessment — skip
  // the gate entirely.
  const handleAccessCodeValidated = (id: number, name: string) => {
    setReferrerId(id);
    setReferrerName(name);
    persistReferrer(id, name);
    loadQuestionnaire();
  };

  // Access-code-once: with a validated referrer stored in this browser the
  // gate never shows again — boot straight into the questionnaire. Only
  // when the wizard is actually open (ChatPage mounts it closed).
  useEffect(() => {
    if (!open || phase !== "access_code") return;
    const stored = readStoredReferrer();
    if (!stored) return;
    setReferrerId(stored.id);
    setReferrerName(stored.name);
    loadQuestionnaire();
  }, [phase, loadQuestionnaire, open]);

  // Calculate steps
  const symptomSteps = questionnaire
    ? Array.from(
        { length: Math.ceil(questionnaire.symptoms.length / SYMPTOMS_PER_STEP) },
        (_, i) => questionnaire.symptoms.slice(i * SYMPTOMS_PER_STEP, (i + 1) * SYMPTOMS_PER_STEP),
      )
    : [];
  const totalSteps = symptomSteps.length;
  const progress = ((currentStep + 1) / (totalSteps + 1)) * 100;

  // Toggle symptom
  const toggleSymptom = useCallback((symptomId: number) => {
    setResponses((prev) => {
      const next = new Map(prev);
      next.set(symptomId, !next.get(symptomId));
      return next;
    });
  }, []);

  // Calculate scores
  const handleCalculate = useCallback(async () => {
    setPhase("calculating");
    const responseArray = Array.from(responses.entries()).map(
      ([symptomId, answered]) => ({ symptomId, answered }),
    );

    try {
      const calcRes = await fetch("/api/assessment/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: responseArray }),
      });
      const calcData: CalculateResponse = await calcRes.json();
      setResults(calcData);

      const saveRes = await fetch("/api/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName,
          patientSex,
          patientAge: Number(patientAge),
          responses: responseArray,
          referrer_id: referrerId,
        }),
      });
      const saveData: AssessmentSaved = await saveRes.json();
      setSavedId(saveData.id);

      setPhase("results");
    } catch {
      setPhase("welcome");
    }
  }, [responses, patientName, patientSex, patientAge, referrerId]);

  // Can proceed from welcome?
  const canStart = patientName.trim().length > 0 && patientSex !== "" && patientAge !== "";

  // Send email
  const handleSendEmail = useCallback(async () => {
    if (!savedId || !email.includes("@")) return;
    setEmailSending(true);
    try {
      const res = await fetch(`/api/assessment/${savedId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) setEmailSent(true);
    } catch {
      // ignore
    } finally {
      setEmailSending(false);
    }
  }, [savedId, email]);

  /**
   * T6c — appointment POST behind the results CTA: same endpoint, payload
   * ({customer_id, reason}) and toast copy as ChatSession's lifted `[CITA]`
   * handler (chat behavior untouched). The wizard owns its own fetches, so
   * the request lives here with a fresh identity read at click time.
   * Resolves true on 2xx — the card flips to its confirmed state.
   */
  const handleRequestAppointment = useCallback(async (reason: string): Promise<boolean> => {
    const customerId = readStoredCustomerId();
    if (customerId == null) return false;
    try {
      const res = await fetch("/api/assistant/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, reason }),
      });
      if (res.ok) {
        toast.success("Solicitud de cita enviada");
        return true;
      }
      if (res.status === 404) {
        toast.error(
          "No encontramos tu registro. Inicia una conversación nueva e inténtalo de nuevo.",
        );
        return false;
      }
      const serverError = await readServerError(res);
      toast.error(
        serverError
          ? `No se pudo enviar la solicitud. (${serverError})`
          : "No se pudo enviar la solicitud. Inténtalo de nuevo.",
      );
      return false;
    } catch {
      toast.error(CONNECTION_ERROR);
      return false;
    }
  }, []);

  // T6c — discovery: with a stored chat identity the results CTA reuses the
  // chat's appointment dialog; without one it links to /#booking (the landing
  // form that offers the tamizaje motive after T6a). Read per render so a
  // stale/corrupt key can never route into a dead dialog.
  const storedCustomerId = readStoredCustomerId();

  // T4 — controlled: closed means no DOM at all (the parent owns the open
  // state; the standalone floating button was removed).
  if (!open) {
    return null;
  }

  // S3 (feature ui-optimization) — the hand-rolled motion.div modal becomes
  // an accessible dialog on the existing Radix primitive (ui/dialog.tsx):
  // role="dialog", aria-modal, focus trap, Escape-to-close and focus
  // restoration to the triggering control come from Radix. Adaptations to
  // the wrapper, all class-level, keep the visible layout identical:
  // - positioning classes mirror the old motion.div (mobile inset-4,
  //   centered 500px card on sm+); the wrapper's translate is neutralized
  //   on mobile and re-applied under sm:
  // - the wrapper's built-in absolute X (English sr-only label, unstyleable
  //   tap area) is hidden via [&>button]:hidden — the header renders its own
  //   DialogClose with the Spanish label "Cerrar evaluación" and a ~44px
  //   tap area (p-3 around the 20px icon, negative margins keep the header
  //   rhythm unchanged).
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        aria-modal="true"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Dispatched before focus moves into the dialog: document.activeElement
          // is still the control that opened the wizard.
          returnFocusRef.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={(event) => {
          // Restore focus to the opener and skip Radix's trigger-only restore.
          returnFocusRef.current?.focus?.();
          event.preventDefault();
        }}
        className="fixed top-4 right-4 bottom-4 left-4 translate-x-0 translate-y-0 bg-white rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden p-0 gap-0 border-0 max-w-none [&>button]:hidden sm:top-1/2 sm:left-1/2 sm:right-auto sm:bottom-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[500px] sm:max-h-[85vh] sm:max-w-none"
      >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={20} className="text-emerald-600" aria-hidden="true" />
                <DialogTitle asChild>
                  <h2 className="font-semibold text-lg">Evaluación de Prevención</h2>
                </DialogTitle>
              </div>
              <DialogClose asChild>
                <button
                  aria-label="Cerrar evaluación"
                  className="p-3 -my-2 -mr-2 rounded-full hover:bg-stone-100 flex items-center justify-center"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </DialogClose>
            </div>

            {/* Progress bar */}
            {phase === "symptoms" && (
              <div className="px-6 pt-4 shrink-0">
                <div className="flex justify-between text-sm text-stone-500 mb-2">
                  <span>Paso {currentStep + 1} de {totalSteps}</span>
                  <span>
                    {Array.from(responses.values()).filter(Boolean).length} /
                    {questionnaire?.symptoms.length} síntomas
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {phase === "access_code" && (
                <AccessCodeGate onValidated={handleAccessCodeValidated} />
              )}

              {phase === "loading" && (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="animate-spin text-emerald-600" size={32} />
                </div>
              )}

              {phase === "welcome" && (
                <AssessmentWelcome
                  patientName={patientName}
                  patientSex={patientSex}
                  patientAge={patientAge}
                  onNameChange={setPatientName}
                  onSexChange={setPatientSex}
                  onAgeChange={setPatientAge}
                />
              )}

              {phase === "symptoms" && symptomSteps[currentStep] && (
                <AssessmentSymptoms
                  symptoms={symptomSteps[currentStep]}
                  responses={responses}
                  onToggle={toggleSymptom}
                />
              )}

              {phase === "calculating" && (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                  <Loader2 className="animate-spin text-emerald-600" size={40} />
                  <p className="text-stone-600">Calculando resultados...</p>
                </div>
              )}

              {phase === "results" && results && (
                <AssessmentResults
                  results={results.results}
                  recommendations={results.recommendations}
                  productRecommendations={results.productRecommendations}
                  expandedNutrient={expandedNutrient}
                  onToggleNutrient={(id) =>
                    setExpandedNutrient(expandedNutrient === id ? null : id)
                  }
                />
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t bg-stone-50 shrink-0">
              {phase === "welcome" && (
                <Button
                  onClick={() => setPhase("symptoms")}
                  disabled={!canStart}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  Comenzar Evaluación
                  <ChevronRight size={16} className="ml-2" />
                </Button>
              )}

              {phase === "symptoms" && (
                <div className="flex gap-2">
                  {currentStep > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => setCurrentStep((s) => s - 1)}
                      className="flex-1"
                    >
                      <ChevronLeft size={16} className="mr-2" />
                      Anterior
                    </Button>
                  )}
                  {currentStep < totalSteps - 1 ? (
                    <Button
                      onClick={() => setCurrentStep((s) => s + 1)}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      Siguiente
                      <ChevronRight size={16} className="ml-2" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleCalculate}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Check size={16} className="mr-2" />
                      Ver Resultados
                    </Button>
                  )}
                </div>
              )}

              {phase === "results" && (
                <div className="space-y-3">
                  {savedId && !emailSent && (
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Su email para recibir el reporte"
                        aria-label="Su email para recibir el reporte"
                        className="flex-1"
                      />
                      <Button
                        onClick={handleSendEmail}
                        disabled={emailSending || !email.includes("@")}
                        variant="outline"
                        size="sm"
                        aria-label={emailSending ? "Enviando reporte" : "Enviar reporte"}
                      >
                        {emailSending ? (
                          <Loader2 className="animate-spin" size={14} />
                        ) : (
                          <Mail size={14} />
                        )}
                      </Button>
                    </div>
                  )}
                  {emailSent && (
                    <div className="flex items-center gap-2 text-sm text-emerald-600">
                      <CheckCircle2 size={14} />
                      <span>Reporte enviado a {email}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPhase("access_code");
                        setReferrerId(null);
                        setReferrerName(null);
                        setCurrentStep(0);
                        setResponses(new Map());
                        setResults(null);
                        setSavedId(null);
                        setEmail("");
                        setEmailSent(false);
                      }}
                      className="flex-1"
                    >
                      Nueva Evaluación
                    </Button>
                    {savedId && (
                      <Button
                        variant="outline"
                        onClick={() => window.open(`/api/assessment/${savedId}/pdf`, "_blank")}
                        className="flex-1"
                      >
                        PDF
                      </Button>
                    )}
                  </div>
                  {/* T6c — discovery channel: the in-person body-composition
                      screening, next to the PDF/email actions. With a stored
                      chat identity the CTA opens the chat's OWN appointment
                      dialog (shared CitaAppointmentButton → POST
                      /assistant/appointments); without one it links to the
                      landing booking form (T6a added the tamizaje motive).
                      The assessment dialog STAYS open behind the nested cita
                      dialog — cancelling returns to these results with no
                      state loss. */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-stone-700">
                      ¿Querés medir tu composición corporal en persona?
                    </p>
                    {storedCustomerId != null ? (
                      <CitaAppointmentButton onRequestAppointment={handleRequestAppointment} />
                    ) : (
                      <a
                        href="/#booking"
                        className="mt-1 w-full flex items-center gap-3 rounded-xl border border-emerald-600 bg-emerald-50 px-3 py-2.5 text-left transition-colors hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
                      >
                        <Calendar className="w-5 h-5 shrink-0 text-emerald-700" aria-hidden="true" />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold text-emerald-800">
                            Solicitar cita para tamizaje
                          </span>
                          <span className="text-xs text-emerald-700">
                            Agenda presencial con un especialista
                          </span>
                        </span>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
      </DialogContent>
    </Dialog>
  );
}
