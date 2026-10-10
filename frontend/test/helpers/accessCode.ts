import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

/**
 * Shared plumbing for the access-code-always boot (feature
 * access-code-always): EVERY visitor — including a returning customer with a
 * stored `vr_customer_id` — lands on the access-code gate, so session-level
 * tests must walk through it before reaching gate/intake/chat.
 */

export const ACCESS_CODE = "1906432239";
export const ACCESS_REFERRER_ID = 5;

/**
 * Answer for the two endpoints the always-on gate hits, or `null` when the
 * URL does not match. Spread into a test's fetch mock router as the FIRST
 * branch:
 *
 *   const gate = accessCodeFetch(u);
 *   if (gate) return Promise.resolve(gate);
 */
export function accessCodeFetch(url: string): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
} | null {
  const u = String(url);
  if (u.includes("/api/referrer/validate")) {
    return {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ valid: true, referrerId: ACCESS_REFERRER_ID, referrerName: "Referente Test" }),
    };
  }
  if (u.includes("/api/assistant/attribution")) {
    return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
  }
  return null;
}

/** Types the code, validates it and confirms — the session leaves the gate. */
export async function passAccessCodeGate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Código de acceso");
  await user.type(screen.getByPlaceholderText("Ej: 1906432239"), ACCESS_CODE);
  await user.click(screen.getByRole("button", { name: "Validar código" }));
  await screen.findByText("Código válido");
  await user.click(screen.getByRole("button", { name: "Continuar" }));
}
