import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { customerImages } from "../db/schema.js";
import type { CustomerImage } from "../db/schema.js";
import type { CloudinaryClient, CloudinaryUploadResult } from "./cloudinaryService.js";
import { CloudinaryNotConfiguredError } from "./cloudinaryService.js";

/**
 * Image ingest service (tamizaje-images, S2) — the SHARED upload proxy used
 * by BOTH image surfaces: `POST /admin/customers/:id/images` (T1) and the
 * customer-facing `POST /assistant/images` (T2).
 *
 * The wire validation (kind enum, base64/data-URI shape, the 8 MB decoded
 * cap), the Cloudinary upload call and its error mapping (500 not configured
 * / 502 upload failed) live HERE exactly once, so the two routes cannot drift:
 * each route only resolves its own customer conventions (400/404, consent)
 * and stamps its own `uploaded_by`. Only `public_id`/`secure_url` are stored
 * — the binaries never touch SQLite (design constraint).
 *
 * Constants exported for the routes' validation surface reuse.
 */

/** Allowed `customer_images.kind` values (design: tamizaje|evolucion|otro). */
export const IMAGE_KINDS = ["tamizaje", "evolucion", "otro"] as const;
/** Upload cap: 8 MB DECODED (design: "Límite de carga: 8 MB — rechazar 413/400"). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Who pushed the image — recorded in `customer_images.uploaded_by`. */
export type ImageUploader = "customer" | "admin";

export interface ImageIngestInput {
  customerId: number;
  uploadedBy: ImageUploader;
  /** The already-parsed JSON body ({data|base64, kind, taken_at?, notes?}). */
  body: Record<string, unknown>;
}

/**
 * Result of one ingest: the stored row, or the HTTP error the route replies
 * with (status + message moved verbatim from T1's admin endpoint, so its
 * contract is unchanged).
 */
export type ImageIngestResult =
  | { ok: true; image: CustomerImage }
  | { ok: false; status: 400 | 413 | 500 | 502; error: string };

export interface ImageService {
  /** Validates → uploads via Cloudinary → records the refs. Never throws. */
  ingest(input: ImageIngestInput): Promise<ImageIngestResult>;
  /** The customer's image history, newest first (customer GET /images). */
  listByCustomer(customerId: number): CustomerImage[];
}

export function createImageService(db: Db, deps: { cloudinary: CloudinaryClient }): ImageService {
  return {
    async ingest({ customerId, uploadedBy, body }: ImageIngestInput): Promise<ImageIngestResult> {
      const kind = body.kind != null ? String(body.kind) : "";
      if (!kind) return { ok: false, status: 400, error: "missing field: kind" };
      if (!(IMAGE_KINDS as readonly string[]).includes(kind)) {
        return { ok: false, status: 400, error: "kind must be tamizaje, evolucion u otro" };
      }

      // `data` (canonical) or `base64` (alias): raw base64 or a full data URI.
      const rawData = body.data ?? body.base64;
      if (rawData == null || String(rawData).trim() === "") {
        return { ok: false, status: 400, error: "missing field: data" };
      }
      const payload = String(rawData).trim();
      const base64Part = payload.startsWith("data:")
        ? payload.slice(payload.indexOf(",") + 1)
        : payload;
      const compact = base64Part.replace(/\s+/g, "");
      if (compact === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
        return { ok: false, status: 400, error: "data must be valid base64" };
      }
      // Size cap on the DECODED payload, computed from the base64 length (no
      // decode needed): len*3/4 minus padding. Over → 413 (design: 8MB limit).
      const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
      const decodedBytes = Math.floor((compact.length * 3) / 4) - padding;
      if (decodedBytes > MAX_IMAGE_BYTES) {
        return { ok: false, status: 413, error: "image exceeds the 8MB limit" };
      }

      const takenAt = body.taken_at != null ? String(body.taken_at) : null;
      const notes = body.notes != null ? String(body.notes) : null;

      let uploaded: CloudinaryUploadResult;
      try {
        uploaded = await deps.cloudinary.upload(payload);
      } catch (err) {
        if (err instanceof CloudinaryNotConfiguredError) {
          return { ok: false, status: 500, error: "cloudinary not configured" };
        }
        return { ok: false, status: 502, error: "cloudinary upload failed" };
      }

      const image = db
        .insert(customerImages)
        .values({
          customerId,
          kind,
          cloudinaryPublicId: uploaded.public_id,
          cloudinarySecureUrl: uploaded.secure_url,
          takenAt,
          uploadedBy, // route decides: 'admin' | 'customer' (design)
          notes,
        })
        .returning()
        .get();
      return { ok: true, image };
    },

    listByCustomer(customerId: number): CustomerImage[] {
      return db
        .select()
        .from(customerImages)
        .where(eq(customerImages.customerId, customerId))
        // Newest first: createdAt (second precision) then id breaks same-second ties.
        .orderBy(desc(customerImages.createdAt), desc(customerImages.id))
        .all();
    },
  };
}
