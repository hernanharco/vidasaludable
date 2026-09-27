import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ClipboardCheck, X, ChevronRight, ChevronLeft, Check, Loader2, Mail, User } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Progress } from "../ui/progress";
import { CheckCircle2 } from "lucide-react";

import { AssessmentWelcome } from "./AssessmentWelcome";
import { AssessmentSymptoms } from "./AssessmentSymptoms";
import { AssessmentResults } from "./AssessmentResults";
import { QuestionnaireData, CalculateResponse, AssessmentSaved, SYMPTOMS_PER_STEP } from "./types";

/**
 * Prevention Assessment Widget — floating button + wizard modal.
 *
 * Flow:
 * 1. Welcome: patient data (name, sex, age)
 * 2. Symptoms: grouped ~12 per step, checkbox SI/NO
 * 3. Results: nutrient scores + recommendations + PDF/email
 */

export function AssessmentWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<"loading" | "welcome" | "symptoms" | "calculating" | "results">("loading");
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireData | null>(null);

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
        setTimeout(() => window.location.reload(), 2000);
      });
  }, []);

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

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-emerald-600 text-white px-4 py-3 rounded-full shadow-lg hover:bg-emerald-700 transition-colors"
      >
        <ClipboardCheck size={20} />
        <span className="font-medium hidden sm:inline">Prevenición</span>
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
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
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
                        onClick={() => window.open(`/api/assessment/${savedId}/pdf`, "_blank")}
                        className="flex-1"
                      >
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
