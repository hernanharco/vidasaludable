import { describe, it, expect } from "vitest";
import {
  createCloudinaryClient,
  cloudinarySignature,
  CloudinaryNotConfiguredError,
  CloudinaryRequestError,
} from "../src/services/cloudinaryService.js";

/**
 * tamizaje-images T1 — server-side Cloudinary upload proxy (S2).
 *
 * The client follows the geminiClient DI pattern: config, `fetch` and the
 * clock are injectable, so every test runs with a fake transport — no
 * network, no credentials, and the suite passes with no CLOUDINARY_* env set.
 *
 * Covered:
 *  1. SIGNATURE — Cloudinary's documented SHA-1 algorithm: the parameters to
 *     sign sorted alphabetically as `key=value` joined by `&`, concatenated
 *     with the API secret, hashed with SHA-1 (hex). Verified against
 *     PRECOMPUTED vectors, not against the implementation under test.
 *  2. UPLOAD REQUEST — POST to /v1_1/<cloud>/image/upload with api_key,
 *     timestamp, signature and folder in the body; `resource_type` is the
 *     `image` segment of the URL. data URIs pass through; raw base64 gets a
 *     sniffed `data:<mime>;base64,` prefix.
 *  3. UPLOAD OUTCOME — success returns {public_id, secure_url}; an HTTP
 *     failure throws CloudinaryRequestError carrying the status and
 *     Cloudinary's own error message.
 *  4. DESTROY — signed POST for deletions (used best-effort by
 *     DELETE /admin/customers/:id); true on ok/not-found, false on failure.
 *  5. UNCONFIGURED — the factory never throws (no boot crash) but every call
 *     fails at call time with a clear error naming the env vars.
 *  6. ENV — CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET / _FOLDER are read
 *     when no config is injected.
 */

/** Precomputed vectors: sha1(sorted-params + api_secret), computed offline. */
const UPLOAD_SIGNATURE_WITH_FOLDER = "fe295095afc0fed8c4917496e5435c5ef8c2e6a2"; // folder=tamizaje&timestamp=1700000000topsecret
const UPLOAD_SIGNATURE_NO_FOLDER = "8e1a09a828985352cd753768412e637cf52f1734"; // timestamp=1700000000topsecret
const DESTROY_SIGNATURE = "4f8ebf6345bd86ffac10041904c4be9c760a604f"; // public_id=demo/old_image&timestamp=1700000000topsecret

const FIXED_NOW_MS = 1700000000000; // → timestamp 1700000000

interface FakeCall {
  url: string;
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

/** Scripted transport: records every call and replays a fixed response. */
function scriptedFetch(response: {
  status: number;
  body?: unknown;
  reject?: unknown;
}): { fetch: (url: string, init: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetch = async (url: string, init: unknown) => {
    calls.push({ url, init: init as FakeCall["init"] });
    if (response.reject !== undefined) throw response.reject;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body ?? {},
    };
  };
  return { fetch, calls };
}

const baseConfig = {
  cloudName: "testcloud",
  apiKey: "key123",
  apiSecret: "topsecret",
  folder: "tamizaje",
};

/** Minimal valid-looking base64 payload (raw, no data-URI prefix). */
const RAW_BASE64 = Buffer.from("fake-image-bytes").toString("base64");

describe("cloudinaryService — signed upload proxy (tamizaje-images T1)", () => {
  it("signs the upload with Cloudinary's documented SHA-1 algorithm (precomputed vector)", async () => {
    const { fetch, calls } = scriptedFetch({
      status: 200,
      body: { public_id: "tamizaje/img1", secure_url: "https://res.cloudinary.com/testcloud/image/upload/img1.png" },
    });
    const client = createCloudinaryClient({ ...baseConfig, fetch, now: () => FIXED_NOW_MS });

    await client.upload(RAW_BASE64);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    // resource_type = image via the URL path (`/image/upload`).
    expect(call.url).toBe("https://api.cloudinary.com/v1_1/testcloud/image/upload");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers?.["Content-Type"]).toContain("application/x-www-form-urlencoded");

    const form = new URLSearchParams(call.init.body ?? "");
    expect(form.get("api_key")).toBe("key123");
    expect(form.get("timestamp")).toBe("1700000000");
    expect(form.get("folder")).toBe("tamizaje");
    expect(form.get("signature")).toBe(UPLOAD_SIGNATURE_WITH_FOLDER);
    expect(form.get("file")).toBe(`data:image/png;base64,${RAW_BASE64}`);
  });

  it("omits the folder from the signature and the body when none is configured", async () => {
    const { fetch, calls } = scriptedFetch({
      status: 200,
      body: { public_id: "x", secure_url: "https://res.cloudinary.com/testcloud/image/upload/x.png" },
    });
    const client = createCloudinaryClient({
      cloudName: "testcloud",
      apiKey: "key123",
      apiSecret: "topsecret",
      fetch,
      now: () => FIXED_NOW_MS,
    });

    await client.upload(RAW_BASE64);

    const form = new URLSearchParams(calls[0]!.init.body ?? "");
    expect(form.has("folder")).toBe(false);
    expect(form.get("signature")).toBe(UPLOAD_SIGNATURE_NO_FOLDER);
  });

  it("cloudinarySignature sorts parameters alphabetically regardless of insertion order", () => {
    // The signed string is `folder=...&timestamp=...` + api_secret — key order
    // in the caller's object must not change the digest.
    expect(
      cloudinarySignature({ timestamp: 1700000000, folder: "tamizaje" }, "topsecret"),
    ).toBe(UPLOAD_SIGNATURE_WITH_FOLDER);
    expect(cloudinarySignature({ timestamp: 1700000000 }, "topsecret")).toBe(
      UPLOAD_SIGNATURE_NO_FOLDER,
    );
    expect(
      cloudinarySignature({ public_id: "demo/old_image", timestamp: 1700000000 }, "topsecret"),
    ).toBe(DESTROY_SIGNATURE);
  });

  it("returns {public_id, secure_url} on upload success", async () => {
    const { fetch } = scriptedFetch({
      status: 200,
      body: { public_id: "tamizaje/abc", secure_url: "https://res.cloudinary.com/testcloud/image/upload/abc.png" },
    });
    const client = createCloudinaryClient({ ...baseConfig, fetch, now: () => FIXED_NOW_MS });

    const result = await client.upload(RAW_BASE64);

    expect(result).toEqual({
      public_id: "tamizaje/abc",
      secure_url: "https://res.cloudinary.com/testcloud/image/upload/abc.png",
    });
  });

  it("throws CloudinaryRequestError with status and Cloudinary's message on a failed upload", async () => {
    const { fetch } = scriptedFetch({
      status: 400,
      body: { error: { message: "Invalid Signature" } },
    });
    const client = createCloudinaryClient({ ...baseConfig, fetch, now: () => FIXED_NOW_MS });

    const failure = client.upload(RAW_BASE64);
    await expect(failure).rejects.toBeInstanceOf(CloudinaryRequestError);
    await expect(failure).rejects.toMatchObject({ status: 400 });
    await expect(failure).rejects.toThrow(/Invalid Signature/);
  });

  it("keeps data URIs verbatim and sniffs the format of raw base64", async () => {
    const { fetch, calls } = scriptedFetch({
      status: 200,
      body: { public_id: "p", secure_url: "https://res.cloudinary.com/testcloud/image/upload/p.png" },
    });
    const client = createCloudinaryClient({ ...baseConfig, fetch, now: () => FIXED_NOW_MS });

    const dataUri = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    await client.upload(dataUri);
    expect(new URLSearchParams(calls[0]!.init.body ?? "").get("file")).toBe(dataUri);

    // Raw base64 starting with the PNG magic bytes → prefixed as image/png.
    const rawPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest")]).toString("base64");
    await client.upload(rawPng);
    expect(new URLSearchParams(calls[1]!.init.body ?? "").get("file")).toBe(
      `data:image/png;base64,${rawPng}`,
    );
  });

  it("destroy signs a POST to /image/destroy and reports the outcome", async () => {
    const ok = scriptedFetch({ status: 200, body: { result: "ok" } });
    const client = createCloudinaryClient({ ...baseConfig, fetch: ok.fetch, now: () => FIXED_NOW_MS });
    await expect(client.destroy("demo/old_image")).resolves.toBe(true);

    const form = new URLSearchParams(ok.calls[0]!.init.body ?? "");
    expect(ok.calls[0]!.url).toBe("https://api.cloudinary.com/v1_1/testcloud/image/destroy");
    expect(ok.calls[0]!.init.method).toBe("POST");
    expect(form.get("public_id")).toBe("demo/old_image");
    expect(form.get("api_key")).toBe("key123");
    expect(form.get("signature")).toBe(DESTROY_SIGNATURE);

    // Cloudinary already deleted it (or it never existed) → still "done".
    const missing = scriptedFetch({ status: 200, body: { result: "not found" } });
    const missingClient = createCloudinaryClient({ ...baseConfig, fetch: missing.fetch, now: () => FIXED_NOW_MS });
    await expect(missingClient.destroy("demo/gone")).resolves.toBe(true);

    // HTTP failure and transport failure → false (best-effort callers decide).
    const failed = scriptedFetch({ status: 404, body: { error: { message: "not found" } } });
    const failedClient = createCloudinaryClient({ ...baseConfig, fetch: failed.fetch, now: () => FIXED_NOW_MS });
    await expect(failedClient.destroy("demo/x")).resolves.toBe(false);

    const offline = scriptedFetch({ status: 0, reject: new Error("ECONNREFUSED") });
    const offlineClient = createCloudinaryClient({ ...baseConfig, fetch: offline.fetch, now: () => FIXED_NOW_MS });
    await expect(offlineClient.destroy("demo/x")).resolves.toBe(false);
  });

  it("fails at call time with a clear error when unconfigured — the factory itself never throws", async () => {
    // Empty strings win over any ambient env, so this is deterministic even
    // on a machine that has CLOUDINARY_* set.
    const client = createCloudinaryClient({
      cloudName: "",
      apiKey: "",
      apiSecret: "",
      fetch: async () => {
        throw new Error("network must not be touched when unconfigured");
      },
    });

    // Boot safety: constructing the client (as buildApp does) must not throw.
    expect(client.isConfigured()).toBe(false);

    const upload = client.upload(RAW_BASE64);
    await expect(upload).rejects.toBeInstanceOf(CloudinaryNotConfiguredError);
    await expect(upload).rejects.toThrow(/CLOUDINARY_CLOUD_NAME/);

    const destroy = client.destroy("demo/anything");
    await expect(destroy).rejects.toBeInstanceOf(CloudinaryNotConfiguredError);
    await expect(destroy).rejects.toThrow(/CLOUDINARY_API_SECRET/);
  });

  it("reads CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET / _FOLDER from the environment", async () => {
    const ENV_KEYS = [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
      "CLOUDINARY_FOLDER",
    ] as const;
    const previous = ENV_KEYS.map((key) => [key, process.env[key]] as const);
    process.env.CLOUDINARY_CLOUD_NAME = "envcloud";
    process.env.CLOUDINARY_API_KEY = "envkey";
    process.env.CLOUDINARY_API_SECRET = "envsecret";
    process.env.CLOUDINARY_FOLDER = "env-folder";
    try {
      const { fetch, calls } = scriptedFetch({
        status: 200,
        body: { public_id: "e", secure_url: "https://res.cloudinary.com/envcloud/image/upload/e.png" },
      });
      const client = createCloudinaryClient({ fetch, now: () => FIXED_NOW_MS });

      await client.upload(RAW_BASE64);

      expect(calls[0]!.url).toBe("https://api.cloudinary.com/v1_1/envcloud/image/upload");
      const form = new URLSearchParams(calls[0]!.init.body ?? "");
      expect(form.get("api_key")).toBe("envkey");
      expect(form.get("folder")).toBe("env-folder");
      expect(form.get("signature")).toBe(
        cloudinarySignature({ folder: "env-folder", timestamp: 1700000000 }, "envsecret"),
      );
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
