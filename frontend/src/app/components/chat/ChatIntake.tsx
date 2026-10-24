import React, { useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import type { IntakeProfile } from "./types";

/**
 * ChatIntake — the 5-step deterministic questionnaire (no LLM) shown the
 * first time a customer reaches the chat, i.e. when the server has no
 * profile for them yet.
 *
 * The widget owns the phase and the persistence: this component only collects
 * the answers and reports them through `onComplete`, which resolves `true`
 * only after the profile was saved. A `false` answer keeps the user on the
 * final step with an inline error so they can retry without losing data.
 */

interface ChatIntakeProps {
  profile: IntakeProfile;
  onChange: (next: IntakeProfile) => void;
  onComplete: (profile: IntakeProfile) => Promise<boolean>;
}

const TOTAL_STEPS = 6;

const AGE_PLACEHOLDER = "Ej: 34";
const WEIGHT_PLACEHOLDER = "Ej: 70";
const HEIGHT_PLACEHOLDER = "Ej: 1,70";
const ALLERGY_PLACEHOLDER = "¿Alergia a qué?";
const OPEN_NOTE_PLACEHOLDER = "¿Hay algo que te preocupe hoy? (opcional)";

const GOALS = ["Energía", "Inmunidad", "Huesos", "Piel y cabello", "Digestión", "Sueño"];
const DIETS = ["Omnívora", "Vegetariana", "Vegana"];
// intake-health-data S2 — the chips read everyday language; the wire VALUE
// stays "Omnívora" (stored rows, prompt and upsert semantics untouched).
const DIET_LABELS: Record<string, string> = {
  Omnívora: "Como de todo (carne, pescado, verduras)",
};
const ACTIVITIES = ["Sedentaria", "Leve", "Moderada", "Intensa"];
const SLEEP_RANGES = ["<5 h", "5-6 h", "7-8 h", "+8 h"];
const STRESS_LEVELS = ["Bajo", "Medio", "Alto"];
// intake-health-data S3 — health conditions (multi-select) + allergies.
// "Ninguna" is exclusive both ways (see handleSelect below).
const CONDITIONS = [
  "Tensión alta",
  "Tiroides",
  "Problemas de colon",
  "Diabetes",
  "Hipoglisemia",
  "Fatiga muscular",
  "Ninguna",
  "Alergias",
];
const NO_CONDITION = "Ninguna";
const ALLERGY_CONDITION = "Alergias";

const inputCls =
  "w-full px-3 py-2 bg-white border border-stone-200 rounded-lg text-base md:text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-emerald-900 transition-shadow";

/**
 * S4 — the sex chips read "Mujer"/"Hombre" instead of the bare letters, but
 * the option VALUE stays F/M so the `POST /api/assistant/profile` wire
 * contract and every stored row are untouched.
 */
const SEX_CHIP_LABELS: Record<string, string> = { F: "Mujer", M: "Hombre" };

const chipCls = (selected: boolean) =>
  [
    "px-3 py-1.5 text-xs rounded-full border transition-colors",
    selected
      ? "bg-emerald-900 border-emerald-900 text-white"
      : "bg-white border-stone-200 text-stone-600 hover:border-emerald-400 hover:text-emerald-800",
  ].join(" ");

const footerBtnCls =
  "flex-1 py-2.5 text-sm font-medium rounded-full transition-colors flex items-center justify-center gap-1";
const nextBtnCls = `${footerBtnCls} bg-emerald-900 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-800`;
const backBtnCls = `${footerBtnCls} border border-stone-300 text-stone-700 hover:bg-stone-100`;

/** Step 1 gate: integer age in the 1-120 range + a sex chip. */
function isValidAge(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 && n <= 120;
}

/**
 * intake-health-data S1 — optional numeric fields. Empty is always valid
 * (they must never block the flow); a filled value must parse (comma or
 * point decimal) and fall inside its range.
 */
function isValidWeight(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) && n >= 30 && n <= 300;
}

function isValidHeight(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) && n >= 1 && n <= 2.3;
}

/**
 * What each gated step still needs, phrased for the customer. The disabled
 * `Siguiente` button and the visible nudge both read this list, so they can
 * never disagree (S3 — "no deja avanzar"): the button was grey with no clue
 * about what was missing.
 */
function missingFields(step: number, profile: IntakeProfile): string[] {
  switch (step) {
    case 1: {
      const missing: string[] = [];
      if (!isValidAge(profile.age)) missing.push("tu edad (entre 1 y 120 años)");
      if (profile.sex !== "M" && profile.sex !== "F") missing.push("tu sexo (Mujer u Hombre)");
      // intake-health-data S1 — optional, but a filled value must be valid.
      if (!isValidWeight(profile.weight)) missing.push("tu peso en kg (entre 30 y 300)");
      if (!isValidHeight(profile.height)) missing.push("tu altura en metros (entre 1,00 y 2,30)");
      return missing;
    }
    case 2:
      return profile.goal === "" ? ["tus objetivos principales"] : [];
    case 3: {
      const missing: string[] = [];
      if (profile.diet === "") missing.push("tu dieta");
      if (profile.activity === "") missing.push("tu actividad física");
      return missing;
    }
    case 4: {
      const missing: string[] = [];
      if (profile.sleep === "") missing.push("tu horario de sueño");
      if (profile.stress === "") missing.push("tu nivel de estrés");
      return missing;
    }
    case 5: {
      // intake-health-data S4 — the ONLY gated field of the health step:
      // choosing the "Alergias" chip obliges the customer to say what to.
      const selected = profile.conditions.split(", ").filter(Boolean);
      if (selected.includes(ALLERGY_CONDITION) && profile.allergies.trim() === "") {
        return ["la alergia a qué (escribe el detalle)"];
      }
      return [];
    }
    default:
      return []; // step 6: free text is optional
  }
}

/** Every step except the last requires its selections before advancing. */
function isStepComplete(step: number, profile: IntakeProfile): boolean {
  return missingFields(step, profile).length === 0;
}

/** S3 — the line rendered next to the button while a step is incomplete. */
function missingHint(step: number, profile: IntakeProfile): string | null {
  const missing = missingFields(step, profile);
  if (missing.length === 0) return null;
  return `Para continuar, completa ${missing.join(" y ")}.`;
}

function ChipGroup({
  label,
  options,
  value,
  onSelect,
  labels,
  hideLabel,
  multi,
  exclusiveTag,
}: {
  label: string;
  options: string[];
  value: string;
  onSelect: (option: string) => void;
  /** Optional answer text per option value (the value itself stays the wire value). */
  labels?: Record<string, string>;
  /** Skips the visible caption; the group keeps `aria-label={label}` (S4). */
  hideLabel?: boolean;
  /** Multi-select: `value` is a comma-joined list (", ") that toggles per chip. */
  multi?: boolean;
  /**
   * intake-health-data S3 — a multi-select option that excludes every other
   * selection both ways: choosing it clears the rest, choosing any other
   * clears it. ("Ninguna" vs the health conditions.)
   */
  exclusiveTag?: string;
}) {
  const selected = multi ? new Set(value.split(", ").filter(Boolean)) : null;
  const isSelected = (option: string) => (multi ? selected!.has(option) : value === option);
  const handleSelect = (option: string) => {
    if (!multi) {
      onSelect(option);
      return;
    }
    const next = new Set(selected!);
    if (next.has(option)) {
      next.delete(option);
    } else {
      next.add(option);
      if (exclusiveTag && option === exclusiveTag) {
        // "Ninguna" wipes every other selection.
        for (const other of options) {
          if (other !== exclusiveTag) next.delete(other);
        }
      } else if (exclusiveTag) {
        // Any real condition wipes "Ninguna".
        next.delete(exclusiveTag);
      }
    }
    // Options order, not click order: the stored list stays stable.
    const joined = options.filter((o) => next.has(o)).join(", ");
    onSelect(joined);
  };
  return (
    <div className="mb-3">
      {!hideLabel && <p className="text-xs text-stone-600 mb-1.5">{label}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={isSelected(option)}
            onClick={() => handleSelect(option)}
            className={chipCls(isSelected(option))}
          >
            {labels?.[option] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatIntake({ profile, onChange, onComplete }: ChatIntakeProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<IntakeProfile>) => onChange({ ...profile, ...patch });
  const hint = missingHint(step, profile);

  const handleComplete = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const saved = await onComplete(profile);
    if (!saved) {
      setError("No pudimos guardar tus respuestas. Comprueba la conexión e inténtalo de nuevo.");
    }
    setSaving(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-stone-50 flex flex-col">
      {/* S2 — bounded, centered column. At 1440×900 the old full-width panel
          rendered a thin strip of form, ~700px of empty background and
          "Siguiente" anchored to the bottom of the viewport. */}
      <div className="w-full max-w-lg mx-auto my-auto flex flex-col">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold text-stone-800 text-sm">Cuéntanos sobre ti</h2>
          <span className="text-[11px] text-stone-400">
            Paso {step} de {TOTAL_STEPS}
          </span>
        </div>

        {step === 1 && (
          <div>
            <label className="text-xs text-stone-600">
              Tu edad
              <input
                type="text"
                inputMode="numeric"
                value={profile.age}
                onChange={(e) => update({ age: e.target.value })}
                placeholder={AGE_PLACEHOLDER}
                className={inputCls}
              />
            </label>
            {/* S4 — this rule belongs to the age field; it used to sit under
                the Sexo chips, where it read as a non sequitur. */}
            <p className="mt-1 text-[11px] text-stone-400">Edad entre 1 y 120 años.</p>
            {/* intake-health-data S1 — optional body data, same input style.
                A filled value must be in range (see missingFields), empty is
                always valid: these fields never block the flow. */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs text-stone-600">
                Peso (kg)
                <input
                  type="text"
                  inputMode="decimal"
                  value={profile.weight}
                  onChange={(e) => update({ weight: e.target.value })}
                  placeholder={WEIGHT_PLACEHOLDER}
                  className={inputCls}
                />
              </label>
              <label className="text-xs text-stone-600">
                Altura (m)
                <input
                  type="text"
                  inputMode="decimal"
                  value={profile.height}
                  onChange={(e) => update({ height: e.target.value })}
                  placeholder={HEIGHT_PLACEHOLDER}
                  className={inputCls}
                />
              </label>
            </div>
            <p className="mt-1 text-[11px] text-stone-400">Peso y altura opcionales.</p>
            <div className="mt-3">
              <ChipGroup
                label="Sexo"
                options={["F", "M"]}
                labels={SEX_CHIP_LABELS}
                value={profile.sex}
                onSelect={(option) => update({ sex: option as IntakeProfile["sex"] })}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 className="text-sm font-medium text-stone-800 mb-1">Objetivos principales</h3>
            <p className="text-xs text-stone-500 mb-3">¿Qué te gustaría mejorar?</p>
            {/* S4 — the heading already says "Objetivos principales", so the chip
                group keeps it as aria-label only (it used to print it twice). */}
            <ChipGroup
              label="Objetivos principales"
              hideLabel
              multi
              options={GOALS}
              value={profile.goal}
              onSelect={(option) => update({ goal: option })}
            />
          </div>
        )}

        {step === 3 && (
          <div>
            <h3 className="text-sm font-medium text-stone-800 mb-3">Hábitos</h3>
            <ChipGroup
              label="Dieta"
              options={DIETS}
              labels={DIET_LABELS}
              value={profile.diet}
              onSelect={(option) => update({ diet: option })}
            />
            <ChipGroup
              label="Actividad física"
              options={ACTIVITIES}
              value={profile.activity}
              onSelect={(option) => update({ activity: option })}
            />
          </div>
        )}

        {step === 4 && (
          <div>
            <h3 className="text-sm font-medium text-stone-800 mb-3">Sueño y estrés</h3>
            <ChipGroup
              label="Sueño"
              options={SLEEP_RANGES}
              value={profile.sleep}
              onSelect={(option) => update({ sleep: option })}
            />
            <ChipGroup
              label="Estrés"
              options={STRESS_LEVELS}
              value={profile.stress}
              onSelect={(option) => update({ stress: option })}
            />
          </div>
        )}

        {step === 5 && (
          <div>
            <h3 className="text-sm font-medium text-stone-800 mb-1">Salud</h3>
            <p className="text-xs text-stone-500 mb-3">
              ¿Tienes alguna de estas condiciones? (opcional, puedes elegir varias)
            </p>
            <ChipGroup
              label="Condiciones de salud"
              hideLabel
              multi
              exclusiveTag={NO_CONDITION}
              options={CONDITIONS}
              value={profile.conditions}
              onSelect={(option) => update({ conditions: option })}
            />
            {/* intake-health-data S4 — the detail field only exists while the
                "Alergias" chip is selected, and the health step refuses to
                advance without it (missingFields case 5). */}
            {profile.conditions.split(", ").includes(ALLERGY_CONDITION) && (
              <label className="text-xs text-stone-600 block mt-1">
                ¿Alergia a qué?
                <input
                  type="text"
                  value={profile.allergies}
                  onChange={(e) => update({ allergies: e.target.value })}
                  placeholder={ALLERGY_PLACEHOLDER}
                  className={inputCls}
                />
              </label>
            )}
          </div>
        )}

        {step === 6 && (
          <div>
            <h3 className="text-sm font-medium text-stone-800 mb-1">Pregunta abierta</h3>
            <p className="text-xs text-stone-500 mb-3">
              Cuéntanos con tus palabras si algo te preocupa.
            </p>
            <textarea
              value={profile.openNote}
              onChange={(e) => update({ openNote: e.target.value })}
              placeholder={OPEN_NOTE_PLACEHOLDER}
              rows={4}
              className={inputCls}
            />
            {error && (
              <div className="flex items-start gap-1.5 mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {/* S3 — while a step cannot advance, say what is missing right next
            to the greyed-out button instead of leaving a dead screen. */}
        {hint && (
          <p
            role="status"
            className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2"
          >
            {hint}
          </p>
        )}

        <div className="pt-4 flex gap-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              disabled={saving}
              className={backBtnCls}
            >
              <ChevronLeft className="w-4 h-4" />
              Atrás
            </button>
          )}
          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!isStepComplete(step, profile)}
              className={nextBtnCls}
            >
              Siguiente
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" onClick={handleComplete} disabled={saving} className={nextBtnCls}>
              {saving ? "Guardando..." : "Mis recomendaciones"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
