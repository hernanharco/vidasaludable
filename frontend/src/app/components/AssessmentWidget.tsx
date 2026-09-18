import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ClipboardCheck,
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Download,
  Mail,
  User,
  Calendar,
  Users,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { ScrollArea } from "../components/ui/scroll-area";

/**
 * Prevention Assessment Widget — floating button + wizard modal.
 *
 * Flow:
 * 1. Welcome: patient data (name, sex, age)
 * 2. Symptoms: grouped ~10 per step, checkbox SI/NO
 * 3. Results: nutrient scores + recommendations + PDF/email
 *
 * Consumes /assessment/* endpoints via /api proxy.
 */

// ─── Types ───────────────────────────────────────────────────────────

interface Symptom {
  id: number;
  nameEs: string;
}

interface Nutrient {
  id: string;
  name: string;
  type: string;
}

interface ScoringResult {
  nutrientId: string;
  nutrientName: string;
  nutrientType: string;
  matchedWeight: number;
  maxWeight: number;
  ratio: number;
  status: "OK" | "deficient" | "urgent";
}

interface QuestionnaireData {
  symptoms: Symptom[];
  nutrients: Nutrient[];
}

interface CalculateResponse {
  results: ScoringResult[];
  recommendations: ScoringResult[];
}

interface AssessmentSaved {
  id: string;
  status: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const SYMPTOMS_PER_STEP = 12;

const STATUS_CONFIG = {
  OK: {
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: CheckCircle2,
    label: "OK",
  },
  deficient: {
    color: "bg-amber-100 text-amber-800 border-amber-200",
    icon: AlertTriangle,
    label: "En Falta",
  },
  urgent: {
    color: "bg-red-100 text-red-800 border-red-200",
    icon: AlertCircle,
    label: "Urgente",
  },
} as const;

const TYPE_LABELS: Record<string, string> = {
  vitamin: "Vitaminas",
  mineral: "Minerales",
  fatty_acid: "Ácidos Grasos",
  supplement: "Suplementos",
};

// ─── Main Component ──────────────────────────────────────────────────

export function AssessmentWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<
    "loading" | "welcome" | "symptoms" | "calculating" | "results"
  >("loading");
  const [questionnaire, setQuestionnaire] =
    useState<QuestionnaireData | null>(null);

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

  // Load questionnaire on mount
  useEffect(() => {
    fetch("/api/assessment/questionnaire")
      .then((r) => r.json())
      .then((data: QuestionnaireData) => {
        setQuestionnaire(data);
        setPhase("welcome");
      })
      .catch(() => {
        // Retry or show error
        setTimeout(() => window.location.reload(), 2000);
      });
  }, []);

  // Calculate steps
  const symptomSteps = questionnaire
    ? Array.from(
        { length: Math.ceil(questionnaire.symptoms.length / SYMPTOMS_PER_STEP) },
        (_, i) =>
          questionnaire.symptoms.slice(
            i * SYMPTOMS_PER_STEP,
            (i + 1) * SYMPTOMS_PER_STEP,
          ),
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
      // Calculate
      const calcRes = await fetch("/api/assessment/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: responseArray }),
      });
      const calcData: CalculateResponse = await calcRes.json();
      setResults(calcData);

      // Save
      const saveRes = await fetch("/api/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName,
          patientSex,
          patientAge: Number(patientAge),
          responses: responseArray,
        }),
      });
      const saveData: AssessmentSaved = await saveRes.json();
      setSavedId(saveData.id);

      setPhase("results");
    } catch {
      setPhase("welcome");
    }
  }, [responses, patientName, patientSex, patientAge]);

  // Can proceed from welcome?
  const canStart =
    patientName.trim().length > 0 && patientSex !== "" && patientAge !== "";

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
      if (res.ok) {
        setEmailSent(true);
      }
    } catch {
      // ignore
    } finally {
      setEmailSending(false);
    }
  }, [savedId, email]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-emerald-600 text-white px-4 py-3 rounded-full shadow-lg hover:bg-emerald-700 transition-colors"
      >
        <ClipboardCheck size={20} />
        <span className="font-medium hidden sm:inline">Prevenión</span>
      </button>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={() => setIsOpen(false)}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[500px] sm:max-h-[85vh] bg-white rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={20} className="text-emerald-600" />
                <h2 className="font-semibold text-lg">Evaluación de Prevención</h2>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-full hover:bg-stone-100"
              >
                <X size={20} />
              </button>
            </div>

            {/* Progress bar */}
            {phase === "symptoms" && (
              <div className="px-6 pt-4">
                <div className="flex justify-between text-sm text-stone-500 mb-2">
                  <span>
                    Paso {currentStep + 1} de {totalSteps}
                  </span>
                  <span>
                    {Array.from(responses.values()).filter(Boolean).length} /
                    {questionnaire?.symptoms.length} síntomas
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {/* LOADING */}
              {phase === "loading" && (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="animate-spin text-emerald-600" size={32} />
                </div>
              )}

              {/* WELCOME */}
              {phase === "welcome" && (
                <div className="p-6 space-y-6">
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-semibold text-stone-800">
                      Evaluación de Deficiencias
                    </h3>
                    <p className="text-stone-600 text-sm">
                      Responda sobre sus síntomas para obtener recomendaciones
                      personalizadas de prevención.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name">Nombre</Label>
                      <Input
                        id="name"
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        placeholder="Su nombre"
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label>Sexo</Label>
                      <RadioGroup
                        value={patientSex}
                        onValueChange={(v) => setPatientSex(v as "M" | "F")}
                        className="flex gap-4 mt-2"
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="M" id="sex-m" />
                          <Label htmlFor="sex-m" className="font-normal">
                            Masculino
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="F" id="sex-f" />
                          <Label htmlFor="sex-f" className="font-normal">
                            Femenino
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div>
                      <Label htmlFor="age">Edad</Label>
                      <Input
                        id="age"
                        type="number"
                        value={patientAge}
                        onChange={(e) => setPatientAge(e.target.value)}
                        placeholder="Ej: 35"
                        min={1}
                        max={120}
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* SYMPTOMS */}
              {phase === "symptoms" && symptomSteps[currentStep] && (
                <ScrollArea className="h-full px-6 py-4">
                  <div className="space-y-3">
                    {symptomSteps[currentStep].map((symptom) => {
                      const isChecked = responses.get(symptom.id) ?? false;
                      return (
                        <label
                          key={symptom.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            isChecked
                              ? "bg-emerald-50 border-emerald-200"
                              : "hover:bg-stone-50 border-stone-200"
                          }`}
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleSymptom(symptom.id)}
                          />
                          <span className="text-sm text-stone-700">
                            {symptom.nameEs}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}

              {/* CALCULATING */}
              {phase === "calculating" && (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                  <Loader2 className="animate-spin text-emerald-600" size={40} />
                  <p className="text-stone-600">Calculando resultados...</p>
                </div>
              )}

              {/* RESULTS */}
              {phase === "results" && results && (
                <ScrollArea className="h-full px-6 py-4">
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-3 bg-emerald-50 rounded-lg">
                        <div className="text-2xl font-bold text-emerald-600">
                          {results.results.filter((r) => r.status === "OK").length}
                        </div>
                        <div className="text-xs text-emerald-700">OK</div>
                      </div>
                      <div className="p-3 bg-amber-50 rounded-lg">
                        <div className="text-2xl font-bold text-amber-600">
                          {
                            results.results.filter((r) => r.status === "deficient")
                              .length
                          }
                        </div>
                        <div className="text-xs text-amber-700">En Falta</div>
                      </div>
                      <div className="p-3 bg-red-50 rounded-lg">
                        <div className="text-2xl font-bold text-red-600">
                          {
                            results.results.filter((r) => r.status === "urgent")
                              .length
                          }
                        </div>
                        <div className="text-xs text-red-700">Urgente</div>
                      </div>
                    </div>

                    {/* Patient info */}
                    <div className="flex items-center gap-2 text-sm text-stone-500">
                      <User size={14} />
                      <span>
                        {patientName} · {patientSex === "M" ? "Masculino" : "Femenino"} · {patientAge} años
                      </span>
                    </div>

                    {/* Recommendations */}
                    {results.recommendations.length > 0 && (
                      <div>
                        <h4 className="font-medium text-stone-800 mb-2">
                          Recomendaciones
                        </h4>
                        <div className="space-y-2">
                          {results.recommendations.map((rec) => {
                            const config = STATUS_CONFIG[rec.status];
                            const Icon = config.icon;
                            return (
                              <div
                                key={rec.nutrientId}
                                className="flex items-center justify-between p-3 bg-stone-50 rounded-lg"
                              >
                                <div className="flex items-center gap-2">
                                  <Icon size={16} className={
                                    rec.status === "urgent"
                                      ? "text-red-600"
                                      : "text-amber-600"
                                  } />
                                  <span className="text-sm font-medium text-stone-700">
                                    {rec.nutrientName}
                                  </span>
                                </div>
                                <Badge className={config.color}>
                                  {config.label} ({Math.round(rec.ratio * 100)}%)
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* All nutrients */}
                    <div>
                      <h4 className="font-medium text-stone-800 mb-2">
                        Todos los Nutrientes
                      </h4>
                      <div className="space-y-1">
                        {results.results
                          .sort((a, b) => {
                            const order = { urgent: 0, deficient: 1, OK: 2 };
                            return order[a.status] - order[b.status];
                          })
                          .map((r) => {
                            const config = STATUS_CONFIG[r.status];
                            const isExpanded = expandedNutrient === r.nutrientId;
                            return (
                              <div key={r.nutrientId}>
                                <button
                                  onClick={() =>
                                    setExpandedNutrient(
                                      isExpanded ? null : r.nutrientId,
                                    )
                                  }
                                  className="w-full flex items-center justify-between p-2 rounded hover:bg-stone-50 text-sm"
                                >
                                  <span className="text-stone-700">
                                    {r.nutrientName}
                                  </span>
                                  <Badge className={`${config.color} text-xs`}>
                                    {config.label}
                                  </Badge>
                                </button>
                                {isExpanded && (
                                  <div className="px-4 pb-2 text-xs text-stone-500">
                                    Score: {r.matchedWeight}/{r.maxWeight} ={" "}
                                    {Math.round(r.ratio * 100)}%
                                    <div className="mt-1 h-2 bg-stone-200 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${
                                          r.status === "urgent"
                                            ? "bg-red-500"
                                            : r.status === "deficient"
                                              ? "bg-amber-500"
                                              : "bg-emerald-500"
                                        }`}
                                        style={{
                                          width: `${Math.min(r.ratio * 100, 100)}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t bg-stone-50">
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
                  {/* Email input */}
                  {savedId && !emailSent && (
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Su email para recibir el reporte"
                        className="flex-1"
                      />
                      <Button
                        onClick={handleSendEmail}
                        disabled={emailSending || !email.includes("@")}
                        variant="outline"
                        size="sm"
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
                        setPhase("welcome");
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
                        onClick={() =>
                          window.open(
                            `/api/assessment/${savedId}/pdf`,
                            "_blank",
                          )
                        }
                        className="flex-1"
                      >
                        <Download size={16} className="mr-2" />
                        PDF
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
