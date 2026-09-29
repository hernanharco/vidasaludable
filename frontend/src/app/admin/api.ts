// Dev-only CRM client for the /admin pages.
//
// Every request goes through the Vite dev proxy (`/api/*` → backend, prefix
// stripped). The backend returns 403 outside NODE_ENV=development — the admin
// UI surfaces that guard as a friendly message rather than assuming access.

export interface Product {
  reference: string;
  name: string;
  category: string;
  size: string;
  price: number;
  benefits: string;
  dosage: string;
  ingredients: string;
  disclaimer: string;
}

export type ProductInput = Omit<Product, "reference"> & { reference: string };

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  referrerPhone: string | null;
  referrerId: number | null;
  referrerName?: string | null;
  consentVersion: number;
  consentTimestamp: string;
  registeredAt: string;
  createdAt: string;
}

export interface Conversation {
  id: number;
  customerId: number;
  createdAt: string;
}

export interface Message {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Purchase {
  id: number;
  customerId: number;
  productReference: string;
  qty: number;
  purchasedAt: string;
}

export interface PurchaseInput {
  customerId: number;
  productReference: string;
  qty: number;
}

export interface Recommendation {
  id: number;
  conversationId: number;
  customerId: number;
  symptom: string;
  productReferences: string; // JSON array of valid catalog refs
  rationale: string;
  consentVersion: number;
  guardBlocked: boolean;
  createdAt: string;
}

export interface Guidance {
  id: number;
  title: string;
  content: string;
  productReferences: string; // JSON array of catalog refs
  enabled: number; // 0 | 1
  createdAt: string;
  updatedAt: string;
}

export interface Referrer {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: number; // 0 | 1
  createdAt: string;
}

export interface ReferrerWithStats extends Referrer {
  customerCount: number;
  customers: Array<{ id: number; name: string; email: string; phone: string; registeredAt: string }>;
}

export interface GuidanceInput {
  title: string;
  content: string;
  product_references: string[];
}

export type GuidancePatch = Partial<GuidanceInput> & { enabled?: number };

// ─── Assessment types ──────────────────────────────────────────────

export interface AssessmentSymptom {
  id: number;
  nameEs: string;
}

export interface AssessmentNutrient {
  id: string;
  name: string;
  type: string;
}

export interface AssessmentMapping {
  symptomId: number;
  nutrientId: string;
  weight: number;
  symptomName: string;
  nutrientName: string;
}

export interface AssessmentResult {
  id: string;
  patientName: string;
  patientSex: string;
  patientAge: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export class AdminError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminError";
    this.status = status;
  }
}

// Basic-auth session for the /admin CRM in non-dev environments.
// In development the backend is open; in production the browser stores the
// credentials (sessionStorage only — never persisted) and sends them on every
// admin request.
let adminAuth: string | null = (() => {
  try {
    return sessionStorage.getItem("vr_admin_auth");
  } catch {
    return null;
  }
})();

export function setAdminAuth(user: string, pass: string): void {
  adminAuth = btoa(`${user}:${pass}`);
  try {
    sessionStorage.setItem("vr_admin_auth", adminAuth);
  } catch {
    /* storage unavailable */
  }
}

export function clearAdminAuth(): void {
  adminAuth = null;
  try {
    sessionStorage.removeItem("vr_admin_auth");
  } catch {
    /* storage unavailable */
  }
}

export function hasAdminAuth(): boolean {
  return adminAuth !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(adminAuth ? { Authorization: `Basic ${adminAuth}` } : {}),
    },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new AdminError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  return body as unknown as T;
}

export const api = {
  listProducts: () => request<{ products: Product[] }>("/catalog"),
  createProduct: (input: ProductInput) =>
    request<{ product: Product }>("/catalog", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProduct: (reference: string, patch: Partial<ProductInput>) =>
    request<{ product: Product }>(`/catalog/${encodeURIComponent(reference)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteProduct: (reference: string) =>
    request<null>(`/catalog/${encodeURIComponent(reference)}`, { method: "DELETE" }),
  listCustomers: () => request<{ customers: Customer[] }>("/customers"),
  deleteCustomer: (id: number) => request<null>(`/customers/${id}`, { method: "DELETE" }),
  listConversations: () =>
    request<{ conversations: Conversation[] }>("/conversations"),
  deleteConversation: (id: number) =>
    request<null>(`/conversations/${id}`, { method: "DELETE" }),
  listMessages: (id: number) =>
    request<{ messages: Message[] }>(`/conversations/${id}/messages`),
  listPurchases: () => request<{ purchases: Purchase[] }>("/purchases"),
  createPurchase: (input: PurchaseInput) =>
    request<{ purchase: Purchase }>("/purchases", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listRecommendations: () =>
    request<{ recommendations: Recommendation[] }>("/recommendations"),
  listGuidance: () => request<{ guidance: Guidance[] }>("/guidance"),
  createGuidance: (input: GuidanceInput) =>
    request<{ guidance: Guidance }>("/guidance", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateGuidance: (id: number, patch: GuidancePatch) =>
    request<{ guidance: Guidance }>(`/guidance/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  toggleGuidance: (id: number, enabled: number) =>
    request<{ guidance: Guidance }>(`/guidance/${id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  deleteGuidance: (id: number) =>
    request<null>(`/guidance/${id}`, { method: "DELETE" }),

  // ─── Assessment CRUD ──────────────────────────────────────────
  listAssessmentSymptoms: () =>
    request<{ symptoms: AssessmentSymptom[] }>("/assessment/symptoms"),
  createAssessmentSymptom: (input: { id: number; nameEs: string }) =>
    request<{ symptom: AssessmentSymptom }>("/assessment/symptoms", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAssessmentSymptom: (id: number, patch: { nameEs: string }) =>
    request<{ symptom: AssessmentSymptom }>(`/assessment/symptoms/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteAssessmentSymptom: (id: number) =>
    request<null>(`/assessment/symptoms/${id}`, { method: "DELETE" }),

  listAssessmentNutrients: () =>
    request<{ nutrients: AssessmentNutrient[] }>("/assessment/nutrients"),
  createAssessmentNutrient: (input: { id: string; name: string; type: string }) =>
    request<{ nutrient: AssessmentNutrient }>("/assessment/nutrients", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAssessmentNutrient: (id: string, patch: { name?: string; type?: string }) =>
    request<{ nutrient: AssessmentNutrient }>(`/assessment/nutrients/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteAssessmentNutrient: (id: string) =>
    request<null>(`/assessment/nutrients/${id}`, { method: "DELETE" }),

  listAssessmentMappings: () =>
    request<{ mappings: AssessmentMapping[] }>("/assessment/mappings"),
  createAssessmentMapping: (input: { symptomId: number; nutrientId: string; weight: number }) =>
    request<{ mapping: AssessmentMapping }>("/assessment/mappings", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAssessmentMapping: (input: { symptomId: number; nutrientId: string; weight: number }) =>
    request<{ mapping: AssessmentMapping }>("/assessment/mappings", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteAssessmentMapping: (input: { symptomId: number; nutrientId: string }) =>
    request<null>("/assessment/mappings", {
      method: "DELETE",
      body: JSON.stringify(input),
    }),

  listAssessmentResults: () =>
    request<{ assessments: AssessmentResult[] }>("/assessment/results"),

  // Referrers
  listReferrers: () => request<{ referrers: ReferrerWithStats[] }>("/referrers"),
  createReferrer: (input: { code: string; name: string; phone?: string; email?: string }) =>
    request<{ referrer: Referrer }>("/referrers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateReferrer: (id: number, patch: Partial<{ code: string; name: string; phone: string | null; email: string | null; active: number }>) =>
    request<{ referrer: Referrer }>(`/referrers/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteReferrer: (id: number) =>
    request<null>(`/referrers/${id}`, { method: "DELETE" }),
};