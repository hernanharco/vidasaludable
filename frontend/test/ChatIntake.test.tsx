import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatIntake, ChatWidget } from "../src/app/components/chat";
import type { IntakeProfile } from "../src/app/components/chat/types";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function installMemoryLocalStorage() {
  // jsdom 30 under vitest runs with an opaque origin (about:blank), where
  // jsdom refuses to expose localStorage. ChatWidget reads it at render time,
  // so the widget-level tests install a tiny in-memory stand-in.
  const store = new Map<string, string>();
  const impl = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: impl });
}

installMemoryLocalStorage();

const CUSTOMER_ID = 42;

const SERVER_PROFILE = {
  customer_id: CUSTOMER_ID,
  sex: "F",
  age: 34,
  goal: "Sueño",
  diet: "Vegetariana",
  activity: "Leve",
  sleep: "7-8 h",
  stress: "Medio",
  open_note: "Me canso por la noche.",
  updated_at: "2026-01-01T00:00:00.000Z",
};

interface FetchOptions {
  /** Profile returned by GET /api/assistant/profile (null → intake). */
  profile: typeof SERVER_PROFILE | null;
  /** Mutable so a test can flip the POST answer mid-flight (retry case). */
  postProfileOk: boolean;
}

function installFetch(options: FetchOptions) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/assistant/profile")) {
      if (init?.method === "POST") {
        return options.postProfileOk
          ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
          : Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ profile: options.profile }),
      });
    }
    // videos / products / consent / history — not needed by these tests
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

function profilePostCalls(): Array<[string, RequestInit]> {
  return mockFetch.mock.calls.filter(
    (call: unknown[]) => String(call[0]) === "/api/assistant/profile" && (call[1] as RequestInit)?.method === "POST",
  ) as Array<[string, RequestInit]>;
}

async function openWidget(user: ReturnType<typeof userEvent.setup>) {
  render(<ChatWidget />);
  await user.click(screen.getByRole("button"));
}

const AGE_PLACEHOLDER = "Ej: 34";
const OPEN_NOTE_PLACEHOLDER = "¿Hay algo que te preocupe hoy? (opcional)";

async function fillStep1(user: ReturnType<typeof userEvent.setup>, age = "34", sex: "M" | "F" = "F") {
  await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), age);
  await user.click(screen.getByRole("button", { name: sex }));
  await user.click(screen.getByRole("button", { name: /Siguiente/ }));
}

async function fillSteps2to4(user: ReturnType<typeof userEvent.setup>) {
  // Step 2 — objetivo
  expect(await screen.findByText("Paso 2 de 5")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sueño" }));
  await user.click(screen.getByRole("button", { name: /Siguiente/ }));
  // Step 3 — hábitos
  expect(await screen.findByText("Paso 3 de 5")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Vegetariana" }));
  await user.click(screen.getByRole("button", { name: "Leve" }));
  await user.click(screen.getByRole("button", { name: /Siguiente/ }));
  // Step 4 — sueño y estrés
  expect(await screen.findByText("Paso 4 de 5")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "7-8 h" }));
  await user.click(screen.getByRole("button", { name: "Medio" }));
  await user.click(screen.getByRole("button", { name: /Siguiente/ }));
  expect(await screen.findByText("Paso 5 de 5")).toBeInTheDocument();
}

describe("ChatWidget intake flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders step 1 and blocks Siguiente until age is valid and sex chosen", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true });

    await openWidget(user);

    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: /Siguiente/ });
    expect(next).toBeDisabled();

    // Age out of range (0) still blocks, even with a sex selected
    const ageInput = screen.getByPlaceholderText(AGE_PLACEHOLDER);
    await user.type(ageInput, "0");
    await user.click(screen.getByRole("button", { name: "F" }));
    expect(next).toBeDisabled();

    // Non-numeric age blocks too
    await user.clear(ageInput);
    await user.type(ageInput, "abc");
    expect(next).toBeDisabled();

    // Age over the 1-120 range blocks too
    await user.clear(ageInput);
    await user.type(ageInput, "150");
    expect(next).toBeDisabled();

    // Both valid (age 34 + sex F) → the button enables
    await user.clear(ageInput);
    await user.type(ageInput, "34");
    expect(next).toBeEnabled();
  });

  it("blocks step 1 without a sex selection", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true });

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();

    const next = screen.getByRole("button", { name: /Siguiente/ });
    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "34");
    expect(next).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "M" }));
    expect(next).toBeEnabled();
  });

  it("completes the 5 steps, POSTs the snake_case profile once and opens chat", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true });

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();

    await fillStep1(user, "34", "F");
    await fillSteps2to4(user);

    await user.type(screen.getByPlaceholderText(OPEN_NOTE_PLACEHOLDER), "Me preocupa el cansancio.");
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));

    // Chat phase: input visible, questionnaire gone
    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    expect(screen.queryByText(/Paso \d de 5/)).not.toBeInTheDocument();

    const posts = profilePostCalls();
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
      customer_id: CUSTOMER_ID,
      sex: "F",
      age: 34,
      goal: "Sueño",
      diet: "Vegetariana",
      activity: "Leve",
      sleep: "7-8 h",
      stress: "Medio",
      open_note: "Me preocupa el cansancio.",
    });
  });

  it("finishes without typing the optional open question", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true });

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();

    await fillStep1(user, "29", "M");
    await fillSteps2to4(user);

    // Step 5 text stays empty on purpose
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));

    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    const posts = profilePostCalls();
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
      customer_id: CUSTOMER_ID,
      sex: "M",
      age: 29,
      goal: "Sueño",
      diet: "Vegetariana",
      activity: "Leve",
      sleep: "7-8 h",
      stress: "Medio",
      open_note: "",
    });
  });

  it("boots straight into chat when the profile already exists", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: SERVER_PROFILE, postProfileOk: true });

    await openWidget(user);

    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    expect(screen.queryByText(/Paso \d de 5/)).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/assistant/profile?customer_id=42");
    expect(profilePostCalls()).toHaveLength(0);
  });

  it("stays on step 5 with an inline error when the POST fails, then retries", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    const options: FetchOptions = { profile: null, postProfileOk: false };
    installFetch(options);

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();

    await fillStep1(user, "41", "F");
    await fillSteps2to4(user);
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));

    // Failure must NOT open chat with an unsaved profile
    expect(await screen.findByText(/No pudimos guardar/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Escribe un mensaje...")).not.toBeInTheDocument();
    expect(screen.getByText("Paso 5 de 5")).toBeInTheDocument();

    // Server recovers → the same button retries and succeeds
    options.postProfileOk = true;
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));
    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos guardar/)).not.toBeInTheDocument();
    expect(profilePostCalls()).toHaveLength(2);
  });
});

function IntakeHarness({ onComplete }: { onComplete: (p: IntakeProfile) => Promise<boolean> }) {
  const [profile, setProfile] = useState<IntakeProfile>({
    sex: "",
    age: "",
    goal: "",
    diet: "",
    activity: "",
    sleep: "",
    stress: "",
    openNote: "",
  });
  return <ChatIntake profile={profile} onChange={setProfile} onComplete={onComplete} />;
}

describe("ChatIntake component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves selections when navigating back and forward", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<IntakeHarness onComplete={onComplete} />);

    // Step 1: age + sex
    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "37");
    await user.click(screen.getByRole("button", { name: "M" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 2: single-select goal (Energía first, then switch to Huesos)
    expect(await screen.findByText("Paso 2 de 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Energía" }));
    expect(screen.getByRole("button", { name: "Energía" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Huesos" }));
    expect(screen.getByRole("button", { name: "Huesos" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Energía" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 3: habits
    expect(await screen.findByText("Paso 3 de 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Omnívora" }));
    await user.click(screen.getByRole("button", { name: "Intensa" }));

    // Back to step 2 → Huesos still selected
    await user.click(screen.getByRole("button", { name: /Atrás/ }));
    expect(await screen.findByText("Paso 2 de 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Huesos" })).toHaveAttribute("aria-pressed", "true");

    // Back to step 1 → age and sex preserved
    await user.click(screen.getByRole("button", { name: /Atrás/ }));
    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(AGE_PLACEHOLDER)).toHaveValue("37");
    expect(screen.getByRole("button", { name: "M" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();

    // Forward again → step 3 selections still there
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 3 de 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Omnívora" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Intensa" })).toHaveAttribute("aria-pressed", "true");

    // Finish the flow → the parent receives the full profile
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 4 de 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    await user.click(screen.getByRole("button", { name: "Medio" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 5 de 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith({
      sex: "M",
      age: "37",
      goal: "Huesos",
      diet: "Omnívora",
      activity: "Intensa",
      sleep: "7-8 h",
      stress: "Medio",
      openNote: "",
    });
  });
});
