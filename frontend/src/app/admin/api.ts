// Dev-only CRM client for the /admin pages.
//
// Every request goes through the Vite dev proxy (`/api/*` → backend, prefix
// stripped). The backend returns 401/403 outside NODE_ENV=development — the
// admin UI surfaces that guard as a friendly message rather than assuming
// access. In production the authCore JWT rides along as `Authorization:
// Bearer` (the Vercel rewrite is same-origin, so the cookie would too — the
// explicit header keeps the dev proxy honest).

import { getToken, clearToken } from "../lib/auth";

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

// ─── Educational videos + segments (T9 admin CRM) ──────────────────

export type VideoStatus = "draft" | "analyzed" | "cut" | "published";

export interface Video {
  id: number;
  speaker: string;
  youtubeId: string;
  url: string;
  title: string;
  durationS: number | null;
  status: VideoStatus;
  licenseNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoInput {
  speaker: string;
  url: string;
  title: string;
  durationS?: number;
  status?: VideoStatus;
}

export type VideoPatch = Partial<Pick<VideoInput, "title" | "speaker" | "status" | "durationS">> & {
  licenseNote?: string | null;
};

export interface VideoSegment {
  id: number;
  videoId: number;
  condition: string | null; // normalized symptom text; null → needs assignment
  symptomId: number | null;
  startS: number;
  endS: number;
  title: string;
  summary: string;
  clipYoutubeId: string | null; // null → deep link into the original video
  enabled: number; // 0 | 1 — approved for chat injection
  createdAt: string;
  updatedAt: string;
}

export interface SegmentInput {
  videoId: number;
  startS: number;
  endS: number;
  title: string;
  summary?: string;
  condition?: string | null;
  symptomId?: number | null;
}

export type SegmentPatch = Partial<Omit<SegmentInput, "videoId">> & {
  enabled?: number;
  clipYoutubeId?: string | null; // null clears the clip (falls back to the deep link)
};

export class AdminError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api/admin${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (
      res.status === 401 &&
      (body.error === "token_requerido" || body.error === "token_invalido")
    ) {
      // Session expired or token rejected: drop the cookie and return to the
      // login screen. 403 (role) is left to the caller — never a redirect loop.
      clearToken();
      window.location.assign("/admin/login");
    }
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

  // ─── Educational videos + segments (T9 admin CRM) ──────────────
  listVideos: () => request<{ videos: Video[] }>("/videos"),
  createVideo: (input: VideoInput) =>
    request<{ video: Video }>("/videos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateVideo: (id: number, patch: VideoPatch) =>
    request<{ video: Video }>(`/videos/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  // 409 { error, count } when segments still reference the video → AdminError
  deleteVideo: (id: number) => request<null>(`/videos/${id}`, { method: "DELETE" }),
  listVideoSegments: (videoId?: number) =>
    request<{ segments: VideoSegment[] }>(
      videoId == null ? "/video-segments" : `/video-segments?video_id=${videoId}`,
    ),
  createVideoSegment: (input: SegmentInput) =>
    request<{ segment: VideoSegment }>("/video-segments", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateVideoSegment: (id: number, patch: SegmentPatch) =>
    request<{ segment: VideoSegment }>(`/video-segments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteVideoSegment: (id: number) =>
    request<null>(`/video-segments/${id}`, { method: "DELETE" }),
};