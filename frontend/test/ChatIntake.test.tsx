import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatIntake, ChatSession } from "../src/app/components/chat";
import type { IntakeProfile } from "../src/app/components/chat/types";
import { accessCodeFetch, passAccessCodeGate } from "./helpers/accessCode";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function installMemoryLocalStorage() {
  // jsdom 30 under vitest runs with an opaque origin (about:blank), where
  // jsdom refuses to expose localStorage. ChatSession reads it at render time,
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
  /** POST /api/assistant/register answer (default: 200 + a customer id). */
  registerOk?: boolean;
  /** POST /api/assistant/ask reply text (default: handled error via 404). */
  askReply?: string;
  /** When true, POST /api/assistant/ask answers 500 (failure path). */
  askFail?: boolean;
}

function installFetch(options: FetchOptions) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    // access-code-always: the gate validates + attributes before intake/chat
    const gate = accessCodeFetch(u);
    if (gate) return Promise.resolve(gate);
    // Fresh-visitor registration gate: consent text + the register upsert.
    if (u.includes("/api/assistant/consent")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ version: 1, text: "Consentimiento informado." }),
      });
    }
    if (u.includes("/api/assistant/register")) {
      return options.registerOk === false
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ customer_id: CUSTOMER_ID }),
          });
    }
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
    if (u.includes("/api/assistant/ask")) {
      if (options.askFail) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            conversation_id: 77,
            reply: options.askReply ?? "Respuesta del agente",
          }),
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
  render(<ChatSession />);
  // access-code-always: every boot passes the access-code gate first.
  await passAccessCodeGate(user);
}

const AGE_PLACEHOLDER = "Ej: 34";
const OPEN_NOTE_PLACEHOLDER = "¿Hay algo que te preocupe hoy? (opcional)";
// intake-health-data S1/S4 — placeholders shared by every describe below.
const WEIGHT_PLACEHOLDER = "Ej: 70";
const HEIGHT_PLACEHOLDER = "Ej: 1,70";
const ALLERGY_PLACEHOLDER = "¿Alergia a qué?";

async function fillStep1(user: ReturnType<typeof userEvent.setup>, age = "34", sex: "M" | "F" = "F") {
  await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), age);
  // S4 — the chips read "Mujer"/"Hombre" but still store the F/M wire value.
  await user.click(screen.getByRole("button", { name: sex === "F" ? "Mujer" : "Hombre" }));
  await user.click(screen.getByRole("button", { name: /Siguiente/ }));
}

async function fillSteps2to4(user: ReturnType<typeof userEvent.setup>) {
  // Step 2 — objetivo
  expect(await screen.findByText("Paso 2 de 6")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sueño" }));
  await user.click(screen.getByRole("button", { name: /Siguiente/ }));
  // Step 3 — hábitos
  expect(await screen.findByText("Paso 3 de 6")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Vegetariana" }));
  await user.click(screen.getByRole("button", { name: "Leve" }));
  await user.click(screen.getByRole("button", { name: /Siguiente/ }));
  // Step 4 — sueño y estrés
  expect(await screen.findByText("Paso 4 de 6")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "7-8 h" }));
  await user.click(screen.getByRole("button", { name: "Medio" }));
  await user.click(screen.getByRole("button", { name: /Siguiente/ }));
  // Step 5 — salud: every field is optional, advance untouched.
  expect(await screen.findByText("Paso 5 de 6")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Siguiente/ }));
  expect(await screen.findByText("Paso 6 de 6")).toBeInTheDocument();
}

describe("ChatSession intake flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders step 1 and blocks Siguiente until age is valid and sex chosen", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true });

    await openWidget(user);

    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: /Siguiente/ });
    expect(next).toBeDisabled();

    // Age out of range (0) still blocks, even with a sex selected
    const ageInput = screen.getByPlaceholderText(AGE_PLACEHOLDER);
    await user.type(ageInput, "0");
    await user.click(screen.getByRole("button", { name: "Mujer" }));
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
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();

    const next = screen.getByRole("button", { name: /Siguiente/ });
    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "34");
    expect(next).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Hombre" }));
    expect(next).toBeEnabled();
  });

  it("completes the 5 steps, POSTs the snake_case profile once and opens chat", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true });

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();

    await fillStep1(user, "34", "F");
    await fillSteps2to4(user);

    await user.type(screen.getByPlaceholderText(OPEN_NOTE_PLACEHOLDER), "Me preocupa el cansancio.");
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));

    // Chat phase: input visible, questionnaire gone
    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    expect(screen.queryByText(/Paso \d de 6/)).not.toBeInTheDocument();

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
      // intake-health-data — optional fields empty → null on the wire.
      weight: null,
      height: null,
      conditions: "",
      allergies: "",
    });
  });

  it("finishes without typing the optional open question", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true });

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();

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
      // intake-health-data — optional fields empty → null on the wire.
      weight: null,
      height: null,
      conditions: "",
      allergies: "",
    });
  });

  it("greets with the saved profile and asks which ailments to talk about (S5)", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true });

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();
    await fillStep1(user, "34", "F");
    await fillSteps2to4(user);
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));

    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    const transcript = screen.getByRole("log").textContent ?? "";

    // Fixed message (no LLM round-trip) built from the profile just saved.
    expect(transcript).toContain(
      "¿Qué dolencias o molestias te gustaría conversar conmigo?",
    );
    expect(transcript).toContain("34 años");
    expect(transcript).toContain("objetivo Sueño");
    expect(transcript).toContain("Cuéntamelo con tus palabras");
    expect(
      mockFetch.mock.calls.filter((call) => String(call[0]).includes("/assistant/ask")),
    ).toHaveLength(0);
  });

  it("opens chat without intake when the profile already exists", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: SERVER_PROFILE, postProfileOk: true });

    await openWidget(user);

    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    expect(screen.queryByText(/Paso \d de 6/)).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/assistant/profile?customer_id=42");
    expect(profilePostCalls()).toHaveLength(0);
    // Untouched path pinned: chat that skips the questionnaire still opens
    // with the generic greeting (the questionnaire path has its own, S5).
    expect(screen.getByRole("log").textContent).toContain(
      "¡Hola! ¿En qué te puedo ayudar hoy con tu bienestar?",
    );
  });

  it("keeps the generic greeting when a fresh registration finds a saved profile", async () => {
    const user = userEvent.setup();
    // No stored identity → full registration gate, then the profile check
    // routes straight to chat (the upsert re-registers an existing customer).
    installFetch({ profile: SERVER_PROFILE, postProfileOk: true });

    render(<ChatSession />);
    await passAccessCodeGate(user);

    await user.type(screen.getByPlaceholderText("Tu nombre"), "Ana Prueba");
    await user.type(screen.getByPlaceholderText("correo@ejemplo.com"), "ana@example.com");
    await user.type(screen.getByPlaceholderText("Número de contacto"), "612345678");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /Aceptar y continuar/ }));

    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    expect(screen.queryByText(/Paso \d de 6/)).not.toBeInTheDocument();
    expect(screen.getByRole("log").textContent).toContain(
      "¡Hola! ¿En qué te puedo ayudar hoy con tu bienestar?",
    );
    expect(profilePostCalls()).toHaveLength(0);
  });

  it("stays on step 5 with an inline error when the POST fails, then retries", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    const options: FetchOptions = { profile: null, postProfileOk: false };
    installFetch(options);

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();

    await fillStep1(user, "41", "F");
    await fillSteps2to4(user);
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));

    // Failure must NOT open chat with an unsaved profile
    expect(await screen.findByText(/No pudimos guardar/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Escribe un mensaje...")).not.toBeInTheDocument();
    expect(screen.getByText("Paso 6 de 6")).toBeInTheDocument();

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
    weight: "",
    height: "",
    conditions: "",
    allergies: "",
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
    await user.click(screen.getByRole("button", { name: "Hombre" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 2: multi-select goals — Energía and Huesos stay pressed together
    expect(await screen.findByText("Paso 2 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Energía" }));
    expect(screen.getByRole("button", { name: "Energía" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Huesos" }));
    expect(screen.getByRole("button", { name: "Huesos" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Energía" })).toHaveAttribute("aria-pressed", "true");
    // Toggling one off leaves the other selected
    await user.click(screen.getByRole("button", { name: "Energía" }));
    expect(screen.getByRole("button", { name: "Energía" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Huesos" })).toHaveAttribute("aria-pressed", "true");
    // Re-select it so the profile carries both
    await user.click(screen.getByRole("button", { name: "Energía" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 3: habits — diet chips read the plain-language label (S2).
    expect(await screen.findByText("Paso 3 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Como de todo/ }));
    await user.click(screen.getByRole("button", { name: "Intensa" }));

    // Back to step 2 → both selections preserved
    await user.click(screen.getByRole("button", { name: /Atrás/ }));
    expect(await screen.findByText("Paso 2 de 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Huesos" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Energía" })).toHaveAttribute("aria-pressed", "true");

    // Back to step 1 → age and sex preserved
    await user.click(screen.getByRole("button", { name: /Atrás/ }));
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(AGE_PLACEHOLDER)).toHaveValue("37");
    expect(screen.getByRole("button", { name: "Hombre" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();

    // Forward again → step 3 selections still there
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 3 de 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Como de todo/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Intensa" })).toHaveAttribute("aria-pressed", "true");

    // Finish the flow → the parent receives the full profile
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 4 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    await user.click(screen.getByRole("button", { name: "Medio" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 5 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 6 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith({
      sex: "M",
      age: "37",
      goal: "Energía, Huesos",
      diet: "Omnívora",
      activity: "Intensa",
      sleep: "7-8 h",
      stress: "Medio",
      openNote: "",
      // intake-health-data — new optional fields default to empty.
      weight: "",
      height: "",
      conditions: "",
      allergies: "",
    });
  });
});

/**
 * S2-S4 (odd/tasks/chat-intake-ux.md) — the desktop repro showed a thin form
 * strip, ~700px of empty background and a disabled "Siguiente" pinned to the
 * bottom with no explanation of what was missing.
 */
describe("ChatIntake copy, layout and guidance (S2-S4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("labels the sex chips Mujer/Hombre and keeps the F/M wire values", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<IntakeHarness onComplete={onComplete} />);

    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mujer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hombre" })).toBeInTheDocument();
    // The raw letters are no longer offered as answers.
    expect(screen.queryByRole("button", { name: "M" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "F" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mujer" }));
    expect(screen.getByRole("button", { name: "Mujer" })).toHaveAttribute("aria-pressed", "true");

    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "34");
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "Sueño" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: /Como de todo/ }));
    await user.click(screen.getByRole("button", { name: "Sedentaria" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    await user.click(screen.getByRole("button", { name: "Medio" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    // Step 5 — salud is fully optional.
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    // Wire contract unchanged: the stored value is still "F".
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ sex: "F", age: "34" }),
    );
  });

  it("says what is missing while Siguiente is disabled and hides it once complete", async () => {
    const user = userEvent.setup();
    render(<IntakeHarness onComplete={vi.fn().mockResolvedValue(true)} />);

    const next = await screen.findByRole("button", { name: /Siguiente/ });
    expect(next).toBeDisabled();

    // Step 1 with nothing filled: both requirements are announced.
    const hint = await screen.findByRole("status");
    expect(hint.textContent).toContain("completa tu edad");
    expect(hint.textContent).toContain("tu sexo");

    // Age only → the hint narrows down to the missing sex chip.
    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "34");
    expect(screen.getByRole("status").textContent).toContain("tu sexo");
    expect(screen.getByRole("status").textContent).not.toContain("tu edad");

    await user.click(screen.getByRole("button", { name: "Mujer" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(next).toBeEnabled();
  });

  it("nudges every gated step with its own missing answers", async () => {
    const user = userEvent.setup();
    render(<IntakeHarness onComplete={vi.fn().mockResolvedValue(true)} />);

    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "41");
    await user.click(screen.getByRole("button", { name: "Hombre" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 2 — objetivo
    expect(await screen.findByText("Paso 2 de 6")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("tus objetivos principales");
    await user.click(screen.getByRole("button", { name: "Energía" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 3 — dieta y actividad, una por una
    expect(await screen.findByText("Paso 3 de 6")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("tu dieta");
    expect(screen.getByRole("status").textContent).toContain("tu actividad física");
    await user.click(screen.getByRole("button", { name: "Vegetariana" }));
    expect(screen.getByRole("status").textContent).toContain("tu actividad física");
    expect(screen.getByRole("status").textContent).not.toContain("tu dieta");
    await user.click(screen.getByRole("button", { name: "Leve" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 4 — sueño y estrés
    expect(await screen.findByText("Paso 4 de 6")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("tu horario de sueño");
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    expect(screen.getByRole("status").textContent).toContain("tu nivel de estrés");
    await user.click(screen.getByRole("button", { name: "Medio" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 5 — salud: nothing is required (unless "Alergias" is selected),
    // so there is no nag.
    expect(await screen.findByText("Paso 5 de 6")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 6 — la pregunta abierta es opcional.
    expect(await screen.findByText("Paso 6 de 6")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mis recomendaciones" })).toBeEnabled();
  });

  it("renders 'Objetivos principales' once, as the heading and the group name", async () => {
    const user = userEvent.setup();
    render(<IntakeHarness onComplete={vi.fn().mockResolvedValue(true)} />);

    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "34");
    await user.click(screen.getByRole("button", { name: "Mujer" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    expect(await screen.findByText("Paso 2 de 6")).toBeInTheDocument();
    expect(screen.getAllByText("Objetivos principales")).toHaveLength(1);
    // The chip group keeps its accessible name for screen readers.
    expect(screen.getByRole("group", { name: "Objetivos principales" })).toBeInTheDocument();
  });

  it("hands the saved note to the agent as the first user message and shows its reply", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({
      profile: null,
      postProfileOk: true,
      askReply: "Revisemos: ¿a qué horas del día sientes ese cansancio?",
    });

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();
    await fillStep1(user, "34", "F");

    // Step 2 — two goals selected together (multi-select)
    expect(await screen.findByText("Paso 2 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Energía" }));
    await user.click(screen.getByRole("button", { name: "Sueño" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    // Step 3 — habits
    expect(await screen.findByText("Paso 3 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Vegetariana" }));
    await user.click(screen.getByRole("button", { name: "Leve" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    // Step 4 — sleep + stress
    expect(await screen.findByText("Paso 4 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    await user.click(screen.getByRole("button", { name: "Medio" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    // Step 5 — salud (opcional, avanzamos sin tocar nada)
    expect(await screen.findByText("Paso 5 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    // Step 6 — the open note becomes the conversation topic
    expect(await screen.findByText("Paso 6 de 6")).toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText(OPEN_NOTE_PLACEHOLDER),
      "Me preocupa el cansancio de la tarde",
    );
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));

    expect(await screen.findByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
    const transcript = screen.getByRole("log").textContent ?? "";

    // The note becomes the customer's first message and the agent engages
    // with its own (LLM) reply — exactly one automatic ask, carrying the note.
    const askCalls = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes("/assistant/ask"),
    );
    expect(askCalls).toHaveLength(1);
    expect(JSON.parse(String((askCalls[0]![1] as RequestInit).body))).toMatchObject({
      customer_id: CUSTOMER_ID,
      message: "Me preocupa el cansancio de la tarde",
    });
    expect(
      await screen.findByText("Revisemos: ¿a qué horas del día sientes ese cansancio?"),
    ).toBeInTheDocument();

    // The greeting no longer quotes the note (the user bubble carries it).
    expect(transcript).toContain("Me preocupa el cansancio de la tarde");
    expect(transcript).not.toContain("Veo que esto te preocupa");
    expect(transcript).not.toContain(
      "¿Qué dolencias o molestias te gustaría conversar conmigo?",
    );
    // Multiple goals are pluralized in the greeting.
    expect(transcript).toContain("objetivos Energía, Sueño");
  });

  it("keeps the chat usable when the automatic opener ask fails", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true, askFail: true });

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();
    await fillStep1(user, "34", "F");
    await fillSteps2to4(user);
    await user.type(
      screen.getByPlaceholderText(OPEN_NOTE_PLACEHOLDER),
      "Me preocupa el cansancio de la tarde",
    );
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));

    // The ask was attempted once and its failure degrades to the standard
    // agent error line — the conversation stays open and usable.
    const askCalls = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes("/assistant/ask"),
    );
    expect(askCalls).toHaveLength(1);
    expect(
      await screen.findByText("Algo salió mal al procesar tu mensaje. Por favor, inténtalo de nuevo."),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
  });

  it("places the age rule next to the age field, above the Sexo group", async () => {
    render(<IntakeHarness onComplete={vi.fn().mockResolvedValue(true)} />);
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();

    const ageRule = screen.getByText("Edad entre 1 y 120 años.");
    // intake-health-data S1 — the optional weight/height row sits between
    // the age rule and the Sexo chips; both remain below the age field.
    const afterAgeRule = ageRule.nextElementSibling as HTMLElement;
    expect(afterAgeRule).not.toBeNull();
    expect(within(afterAgeRule).getByPlaceholderText(WEIGHT_PLACEHOLDER)).toBeInTheDocument();
    expect(within(afterAgeRule).getByPlaceholderText(HEIGHT_PLACEHOLDER)).toBeInTheDocument();
    // The "optional" hint paragraph follows the inputs; Sexo comes after it.
    const hint = afterAgeRule.nextElementSibling as HTMLElement;
    expect(hint.textContent).toContain("Peso y altura opcionales.");
    const sexoGroup = hint.nextElementSibling as HTMLElement;
    expect(within(sexoGroup).getByRole("group", { name: "Sexo" })).toBeInTheDocument();
  });

  it("keeps the form in a centered bounded column with the button next to it", async () => {
    render(<IntakeHarness onComplete={vi.fn().mockResolvedValue(true)} />);
    expect(await screen.findByText("Paso 1 de 6")).toBeInTheDocument();

    const column = document.querySelector(".max-w-lg") as HTMLElement | null;
    expect(column).not.toBeNull();
    expect(column?.className).toContain("mx-auto");

    const next = screen.getByRole("button", { name: /Siguiente/ });
    expect(column?.contains(next)).toBe(true);
    // No auto margin pushing the footer to the far bottom of the viewport:
    // that is what left ~700px of blank background on desktop.
    expect(document.querySelector(".mt-auto")).toBeNull();
  });
});

/**
 * intake-health-data (odd/tasks/intake-health-data.md) — S1 peso/altura
 * opcionales en el paso 1, S2 etiqueta cotidiana de la dieta (valor wire
 * intacto), S3 paso Salud con multi-selección y "Ninguna" exclusiva,
 * S4 "Alergias" exige escribir "¿Alergia a qué?".
 */
describe("ChatIntake health data (S1-S4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers optional weight/height on step 1 and advances without them", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<IntakeHarness onComplete={onComplete} />);

    expect(screen.getByPlaceholderText(WEIGHT_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(HEIGHT_PLACEHOLDER)).toBeInTheDocument();
    // Optional: age+sex alone unlock Siguiente (weight/height stay empty).
    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "38");
    await user.click(screen.getByRole("button", { name: "Mujer" }));
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 2 de 6")).toBeInTheDocument();
  });

  it("blocks Siguiente on an out-of-range weight or height and accepts a Spanish decimal comma", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<IntakeHarness onComplete={onComplete} />);

    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "38");
    await user.click(screen.getByRole("button", { name: "Mujer" }));
    await user.type(screen.getByPlaceholderText(WEIGHT_PLACEHOLDER), "25");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
    await user.clear(screen.getByPlaceholderText(WEIGHT_PLACEHOLDER));
    await user.type(screen.getByPlaceholderText(WEIGHT_PLACEHOLDER), "70");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();

    await user.type(screen.getByPlaceholderText(HEIGHT_PLACEHOLDER), "2,50");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
    await user.clear(screen.getByPlaceholderText(HEIGHT_PLACEHOLDER));
    await user.type(screen.getByPlaceholderText(HEIGHT_PLACEHOLDER), "1,70");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();
  });

  it("shows the plain-language diet labels and keeps the 'Omnívora' wire value", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<IntakeHarness onComplete={onComplete} />);

    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "38");
    await user.click(screen.getByRole("button", { name: "Mujer" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 2 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Energía" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    expect(await screen.findByText("Paso 3 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Como de todo/ }));
    await user.click(screen.getByRole("button", { name: "Moderada" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 4 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    await user.click(screen.getByRole("button", { name: "Medio" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(await screen.findByText("Paso 5 de 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]![0]).toMatchObject({ diet: "Omnívora" });
  });

  it("renders the Salud step with condition chips; 'Ninguna' is exclusive", async () => {
    const user = userEvent.setup();
    render(<IntakeHarness onComplete={vi.fn().mockResolvedValue(true)} />);

    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "38");
    await user.click(screen.getByRole("button", { name: "Mujer" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "Energía" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: /Como de todo/ }));
    await user.click(screen.getByRole("button", { name: "Moderada" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    await user.click(screen.getByRole("button", { name: "Medio" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    expect(await screen.findByText("Paso 5 de 6")).toBeInTheDocument();
    for (const chip of ["Tensión alta", "Tiroides", "Problemas de colon", "Diabetes", "Hipoglisemia", "Fatiga muscular", "Ninguna", "Alergias"]) {
      expect(screen.getByRole("button", { name: chip })).toBeInTheDocument();
    }
    // Selecting a condition unselects "Ninguna" and vice versa.
    await user.click(screen.getByRole("button", { name: "Ninguna" }));
    expect(screen.getByRole("button", { name: "Ninguna" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Tiroides" }));
    expect(screen.getByRole("button", { name: "Ninguna" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Tiroides" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Ninguna" }));
    expect(screen.getByRole("button", { name: "Tiroides" })).toHaveAttribute("aria-pressed", "false");
  });

  it("requires '¿Alergia a qué?' only when the Alergias chip is selected (S4)", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<IntakeHarness onComplete={onComplete} />);

    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "38");
    await user.click(screen.getByRole("button", { name: "Mujer" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "Energía" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: /Como de todo/ }));
    await user.click(screen.getByRole("button", { name: "Moderada" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    await user.click(screen.getByRole("button", { name: "Medio" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    expect(await screen.findByText("Paso 5 de 6")).toBeInTheDocument();
    // No allergies field until the chip is pressed.
    expect(screen.queryByPlaceholderText(ALLERGY_PLACEHOLDER)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Alergias" }));
    expect(screen.getByPlaceholderText(ALLERGY_PLACEHOLDER)).toBeInTheDocument();
    // Selected without the detail → Siguiente blocked with a nudge.
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/alergia a qué/i);

    await user.type(screen.getByPlaceholderText(ALLERGY_PLACEHOLDER), "frutos secos");
    expect(screen.getByRole("button", { name: /Siguiente/ })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "Mis recomendaciones" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      conditions: "Alergias",
      allergies: "frutos secos",
    });
  });
});
