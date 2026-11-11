import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { toast } from "sonner";
import { ChatPage } from "../src/app/components/chat";
import { ChatMessages } from "../src/app/components/chat/ChatMessages";
import { accessCodeFetch, passAccessCodeGate } from "./helpers/accessCode";

/**
 * T4 (odd/tasks/tamizaje-images.md) — chat UI:
 *
 * 1. Attach button in ChatInput: hidden file input → FileReader dataURL →
 *    8MB client cap (toast before the API) → POST /api/assistant/images
 *    {customer_id, data, kind:"tamizaje", taken_at}. Success/error toasts;
 *    the upload POST is LIFTED to ChatSession (it owns every chat fetch and
 *    the /ask 401 re-consent plumbing), so a 401 surfaces the re-consent
 *    gate exactly like /ask and the file UX stays in ChatInput.
 * 2. `[CITA]` marker in ChatMessages → appointment card → confirm dialog →
 *    POST /api/assistant/appointments {customer_id, reason} (NO consent
 *    gate: 400/404 only; 404 → toast pointing at a new conversation).
 *
 * Style: MemoryRouter + mocked fetch + in-memory localStorage helpers (see
 * ChatConversations.test.tsx / ChatPage.test.tsx); sonner is mocked — the
 * toast CALL is the contract, not the portal UI (AdminDeleteToast.test.tsx).
 */

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

function installMemoryLocalStorage() {
  // jsdom under vitest runs with an opaque origin; see ChatPage.test.tsx.
  const store = new Map<string, string>();
  const impl = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: impl });
}

installMemoryLocalStorage();

const CUSTOMER_ID = 42;
const CONVERSATION_ID = 7;
const REFERRER_ID = 5;

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

/** Default thread for the gateless boot (see HISTORY in ChatConversations). */
const DEFAULT_HISTORY: Array<{ role: string; content: string }> = [
  { role: "user", content: "Hola, quiero cuidarme mejor" },
  { role: "assistant", content: "¡Hola! Empecemos cuando quieras." },
];

/** Thread with the agent's `[CITA]` marker (restored from history). */
const CITA_HISTORY: Array<{ role: string; content: string }> = [
  { role: "user", content: "¿Puedo hacerme un tamizaje?" },
  { role: "assistant", content: "¡Claro! Puedo solicitar tu cita presencial.\n[CITA]" },
];

/** A configured endpoint reply, or "network-error" for a transport failure. */
type EndpointReply = { status: number; body: Record<string, unknown> } | "network-error";

interface FetchOptions {
  profile: typeof SERVER_PROFILE | null;
  history: Array<{ role: string; content: string }>;
  /** POST /api/assistant/images reply — default 201 {image}. */
  image?: EndpointReply;
  /** POST /api/assistant/appointments reply — default 201 {appointment}. */
  appointment?: EndpointReply;
}

/** Bodies of the two T4 POSTs, reset per test. */
let imagePostCalls: Array<Record<string, unknown>> = [];
let appointmentPostCalls: Array<Record<string, unknown>> = [];

function installFetch(options: FetchOptions) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    // access-code-always: the gate validates + attributes before chat
    const gate = accessCodeFetch(u);
    if (gate) return Promise.resolve(gate);
    if (u.includes("/api/assistant/profile")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ profile: options.profile }),
      });
    }
    if (u.includes("/api/assistant/history")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: options.history }),
      });
    }
    if (u.includes("/api/assistant/images") && init?.method === "POST") {
      const reply = options.image ?? { status: 201, body: { image: { id: 1 } } };
      if (reply === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
      imagePostCalls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Promise.resolve({
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: () => Promise.resolve(reply.body),
      });
    }
    if (u.includes("/api/assistant/appointments") && init?.method === "POST") {
      const reply = options.appointment ?? { status: 201, body: { appointment: { id: 1 } } };
      if (reply === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
      appointmentPostCalls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Promise.resolve({
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: () => Promise.resolve(reply.body),
      });
    }
    // videos / products / consent / conversations — best-effort, not under test
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
}

function renderChatPage() {
  return render(
    <MemoryRouter initialEntries={["/chat"]}>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Gateless boot (access-code-once): stored referrer + identity → straight
 * into chat with the persisted thread already rendered.
 */
async function bootIntoChat(
  history: Array<{ role: string; content: string }> = DEFAULT_HISTORY,
  overrides: Partial<FetchOptions> = {},
) {
  window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
  window.localStorage.setItem("vr_conversation_id", String(CONVERSATION_ID));
  window.localStorage.setItem("vr_referrer_id", String(REFERRER_ID));
  window.localStorage.setItem("vr_referrer_name", "Referente Test");
  window.localStorage.setItem("vr_consent_version", "2");
  installFetch({ profile: SERVER_PROFILE, history, ...overrides });
  const user = userEvent.setup();
  renderChatPage();
  await screen.findByPlaceholderText("Escribe un mensaje...");
  return user;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function selectFile(name = "reporte.png", content: string | Uint8Array = "hola-tamizaje") {
  const file = new File([content as BlobPart], name, { type: "image/png" });
  fireEvent.change(fileInput(), { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  imagePostCalls = [];
  appointmentPostCalls = [];
});

describe("chat image attach (T4 tamizaje)", () => {
  it("reads the file as a dataURL and POSTs the tamizaje contract body, toasts success and clears the input", async () => {
    await bootIntoChat();

    const attach = screen.getByRole("button", { name: "Adjuntar imagen" });
    expect(attach).toBeEnabled();
    const input = fileInput();
    expect(input).toHaveAttribute("accept", "image/*");

    selectFile();

    await waitFor(() => expect(imagePostCalls).toHaveLength(1));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/assistant/images",
      expect.objectContaining({ method: "POST" }),
    );
    const body = imagePostCalls[0] ?? {};
    expect(body.customer_id).toBe(CUSTOMER_ID);
    expect(body.kind).toBe("tamizaje");
    // Today's date as YYYY-MM-DD (the admin `<input type="date">` wire shape).
    expect(body.taken_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.data).toBe(`data:image/png;base64,${btoa("hola-tamizaje")}`);

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Imagen guardada en tu historial"),
    );
    expect(toast.error).not.toHaveBeenCalled();
    // The file input hands back clean so the same report can be re-selected.
    expect(input).toHaveValue("");
  });

  it("rejects a file over the 8MB cap client-side, with a toast and NO API call", async () => {
    await bootIntoChat();

    selectFile("enorme.png", new Uint8Array(8 * 1024 * 1024 + 1));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/8 MB/)),
    );
    expect(imagePostCalls).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalledWith("/api/assistant/images", expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a 401 surfaces the re-consent gate exactly like /ask (lifted handler), keeping identity and toasting nothing", async () => {
    await bootIntoChat([], {
      image: {
        status: 401,
        body: {
          error: "CONSENT_REQUIRED",
          consent: { version: 3, text: "Consentimiento vigente v3" },
        },
      },
    });

    selectFile();

    // Same re-consent pattern as /ask: gate re-opens with the fresh consent.
    expect(await screen.findByText("Actualiza tu consentimiento")).toBeInTheDocument();
    expect(screen.getByText("Consentimiento vigente v3")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Escribe un mensaje...")).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // Stale consent is not a corrupt identity — storage keys stay untouched.
    expect(window.localStorage.getItem("vr_customer_id")).toBe(String(CUSTOMER_ID));
    expect(window.localStorage.getItem("vr_conversation_id")).toBe(String(CONVERSATION_ID));
    expect(window.localStorage.getItem("vr_consent_version")).toBe("2");
  });

  it.each([
    [413, "image exceeds the 8MB limit"],
    [500, "cloudinary not configured"],
    [502, "cloudinary upload failed"],
  ])("a %s upload failure toasts the server message and keeps the chat open", async (status, serverError) => {
    await bootIntoChat([], { image: { status, body: { error: serverError } } });

    selectFile();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(serverError)),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
  });

  it("triangulate: a transport failure toasts the generic connection error", async () => {
    await bootIntoChat([], { image: "network-error" });

    selectFile();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/conectar con el servidor/i),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Escribe un mensaje...")).toBeInTheDocument();
  });

  it("offers the attach affordance only in the chat phase — absent at the access-code gate, present after it", async () => {
    // Registered identity but no validated referrer yet: access-code-always
    // boots into the gate, and clearing it routes this customer to chat.
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: SERVER_PROFILE, history: [] });
    const user = userEvent.setup();
    renderChatPage();

    await screen.findByText("Código de acceso");
    expect(
      screen.queryByRole("button", { name: "Adjuntar imagen" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    await passAccessCodeGate(user);
    await screen.findByPlaceholderText("Escribe un mensaje...");
    expect(screen.getByRole("button", { name: "Adjuntar imagen" })).toBeInTheDocument();
    expect(fileInput()).toBeInTheDocument();
  });

  it("keeps the attach affordance out of the intake questionnaire", async () => {
    window.localStorage.setItem("vr_customer_id", String(CUSTOMER_ID));
    installFetch({ profile: null, history: [] });
    const user = userEvent.setup();
    renderChatPage();
    await passAccessCodeGate(user);

    await screen.findByText("Cuéntanos sobre ti");
    expect(
      screen.queryByRole("button", { name: "Adjuntar imagen" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

/** Direct ChatMessages renders for the marker contract (AssessmentCard style). */
function renderCita(
  text: string,
  sender: "user" | "agent" = "agent",
  onRequestAppointment?: (reason: string) => Promise<boolean>,
) {
  return render(
    <ChatMessages
      messages={[{ sender, text }]}
      sending={false}
      scrollRef={{ current: null } as React.RefObject<HTMLDivElement>}
      videos={new Map()}
      onRequestAppointment={onRequestAppointment}
    />,
  );
}

/** Handler stand-in for the render-level tests (never asserted here). */
const acceptRequest = () => Promise.resolve(true);

describe("[CITA] appointment card (T4 tamizaje)", () => {
  it("renders one card and strips the [CITA] token from the visible text", () => {
    const { container } = renderCita(
      "Podemos agendar tu tamizaje.\n[CITA]",
      "agent",
      acceptRequest,
    );

    const card = screen.getByRole("button", { name: /Solicitar cita para tamizaje/ });
    expect(card).toBeEnabled();
    expect(screen.getByText(/Podemos agendar tu tamizaje/)).toBeInTheDocument();
    // Marker stripped from the rendered output (persisted text is untouched).
    expect(container.textContent).not.toContain("[CITA");
    expect(screen.queryByText(/\[CITA\]/)).not.toBeInTheDocument();
  });

  it("renders ONE card for repeated markers within a message", () => {
    renderCita("Si quieres [CITA] o si no [CITA] quedo atento!", "agent", acceptRequest);

    expect(
      screen.getAllByRole("button", { name: /Solicitar cita para tamizaje/ }),
    ).toHaveLength(1);
    expect(screen.getByText(/quedo atento/)).toBeInTheDocument();
  });

  it("never parses user messages (plain text, no card)", () => {
    renderCita("¿Qué es el [CITA]?", "user", acceptRequest);
    expect(
      screen.queryByRole("button", { name: /Solicitar cita para tamizaje/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("¿Qué es el [CITA]?")).toBeInTheDocument();
  });

  it("keeps the card disabled when no handler is provided (backward compat)", () => {
    renderCita("Puedo solicitar tu cita.\n[CITA]");
    expect(
      screen.getByRole("button", { name: /Solicitar cita para tamizaje/ }),
    ).toBeDisabled();
  });
});

describe("[CITA] confirm dialog → POST /assistant/appointments", () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    const card = await screen.findByRole("button", { name: /Solicitar cita para tamizaje/ });
    await user.click(card);
    return screen.findByRole("dialog");
  }

  it("prefills the reason, POSTs {customer_id, reason} on confirm, toasts success and flips the card to the confirmed state", async () => {
    const user = await bootIntoChat(CITA_HISTORY);

    const dialog = await openDialog(user);
    const reason = within(dialog).getByRole("textbox", { name: "Motivo" });
    expect(reason).toHaveValue("Quiero agendar un tamizaje");

    await user.clear(reason);
    await user.type(reason, "Prefiero por la mañana");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(appointmentPostCalls).toEqual([
        { customer_id: CUSTOMER_ID, reason: "Prefiero por la mañana" },
      ]),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Solicitud de cita enviada"),
    );
    expect(toast.error).not.toHaveBeenCalled();

    // Dialog closed and the card replaced by the confirmed state.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("Solicitud enviada")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Solicitar cita para tamizaje/ }),
    ).not.toBeInTheDocument();
  });

  it("a 404 toasts the start-a-new-conversation hint and keeps the dialog open for retry", async () => {
    const user = await bootIntoChat(CITA_HISTORY, {
      appointment: { status: 404, body: { error: "customer no encontrado" } },
    });

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(appointmentPostCalls).toHaveLength(1));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/conversación nueva/i),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    // Identity repair lives elsewhere: no confirmed state, dialog stays open.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Solicitud enviada")).not.toBeInTheDocument();
  });

  it("triangulate: a transport failure toasts the generic connection error and keeps the dialog open", async () => {
    const user = await bootIntoChat(CITA_HISTORY, { appointment: "network-error" });

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/conectar con el servidor/i),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Solicitud enviada")).not.toBeInTheDocument();
  });
});
