// ─── Types ───────────────────────────────────────────────────────────

export interface Symptom {
  id: number;
  nameEs: string;
}

export interface Nutrient {
  id: string;
  name: string;
  type: string;
}

export interface ScoringResult {
  nutrientId: string;
  nutrientName: string;
  nutrientType: string;
  matchedWeight: number;
  maxWeight: number;
  ratio: number;
  status: "OK" | "deficient" | "urgent";
}

export interface QuestionnaireData {
  symptoms: Symptom[];
  nutrients: Nutrient[];
}

export interface AddressedNutrient {
  nutrientId: string;
  nutrientName: string;
  status: "deficient" | "urgent";
}

export interface ProductRecommendation {
  reference: string;
  name: string;
  category: string;
  size: string;
  price: number;
  benefits: string;
  dosage: string;
  addressesNutrients: AddressedNutrient[];
}

export interface CalculateResponse {
  results: ScoringResult[];
  recommendations: ScoringResult[];
  productRecommendations: ProductRecommendation[];
}

export interface AssessmentSaved {
  id: string;
  status: string;
}

// ─── Constants ───────────────────────────────────────────────────────

export const SYMPTOMS_PER_STEP = 12;

export const STATUS_CONFIG = {
  OK: {
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: null as never,
    label: "OK",
  },
  deficient: {
    color: "bg-amber-100 text-amber-800 border-amber-200",
    icon: null as never,
    label: "En Falta",
  },
  urgent: {
    color: "bg-red-100 text-red-800 border-red-200",
    icon: null as never,
    label: "Urgente",
  },
} as const;

export const TYPE_LABELS: Record<string, string> = {
  vitamin: "Vitaminas",
  mineral: "Minerales",
  fatty_acid: "Ácidos Grasos",
  supplement: "Suplementos",
};
