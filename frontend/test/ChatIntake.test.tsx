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

async function fillStep1(user: ReturnType<typeof userEvent.setup>, age = "34", sex: "M" | "F" = "F") {
  await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), age);
  // S4 — the chips read "Mujer"/"Hombre" but still store the F/M wire value.
  await user.click(screen.getByRole("button", { name: sex === "F" ? "Mujer" : "Hombre" }));
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

    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();
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
    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();

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

  it("greets with the saved profile and asks which ailments to talk about (S5)", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, postProfileOk: true });

    await openWidget(user);
    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();
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
    expect(screen.queryByText(/Paso \d de 5/)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/Paso \d de 5/)).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Hombre" }));
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
    expect(screen.getByRole("button", { name: "Hombre" })).toHaveAttribute("aria-pressed", "true");
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

    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Omnívora" }));
    await user.click(screen.getByRole("button", { name: "Sedentaria" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    await user.click(screen.getByRole("button", { name: "Medio" }));
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
    expect(await screen.findByText("Paso 2 de 5")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("tu objetivo principal");
    await user.click(screen.getByRole("button", { name: "Energía" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 3 — dieta y actividad, una por una
    expect(await screen.findByText("Paso 3 de 5")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("tu dieta");
    expect(screen.getByRole("status").textContent).toContain("tu actividad física");
    await user.click(screen.getByRole("button", { name: "Vegetariana" }));
    expect(screen.getByRole("status").textContent).toContain("tu actividad física");
    expect(screen.getByRole("status").textContent).not.toContain("tu dieta");
    await user.click(screen.getByRole("button", { name: "Leve" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 4 — sueño y estrés
    expect(await screen.findByText("Paso 4 de 5")).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toContain("tu horario de sueño");
    await user.click(screen.getByRole("button", { name: "7-8 h" }));
    expect(screen.getByRole("status").textContent).toContain("tu nivel de estrés");
    await user.click(screen.getByRole("button", { name: "Medio" }));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    // Step 5 — nothing is required, so there is no nag.
    expect(await screen.findByText("Paso 5 de 5")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mis recomendaciones" })).toBeEnabled();
  });

  it("renders 'Objetivo principal' once, as the heading and the group name", async () => {
    const user = userEvent.setup();
    render(<IntakeHarness onComplete={vi.fn().mockResolvedValue(true)} />);

    await user.type(screen.getByPlaceholderText(AGE_PLACEHOLDER), "34");
    await user.click(screen.getByRole("button", { name: "Mujer" }));
    await user.click(screen.getByRole("button", { name: /Siguiente/ }));

    expect(await screen.findByText("Paso 2 de 5")).toBeInTheDocument();
    expect(screen.getAllByText("Objetivo principal")).toHaveLength(1);
    // The chip group keeps its accessible name for screen readers.
    expect(screen.getByRole("group", { name: "Objetivo principal" })).toBeInTheDocument();
  });

  it("places the age rule next to the age field, above the Sexo group", async () => {
    render(<IntakeHarness onComplete={vi.fn().mockResolvedValue(true)} />);
    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();

    const ageRule = screen.getByText("Edad entre 1 y 120 años.");
    const afterAgeRule = ageRule.nextElementSibling as HTMLElement;
    expect(afterAgeRule).not.toBeNull();
    expect(within(afterAgeRule).getByRole("group", { name: "Sexo" })).toBeInTheDocument();
  });

  it("keeps the form in a centered bounded column with the button next to it", async () => {
    render(<IntakeHarness onComplete={vi.fn().mockResolvedValue(true)} />);
    expect(await screen.findByText("Paso 1 de 5")).toBeInTheDocument();

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
