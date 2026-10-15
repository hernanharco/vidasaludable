import React, { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_COUNTRY_CODE, formatPhone } from "../../lib/countryCodes";

import { ChatHeader } from "./ChatHeader";
import { ChatMessages, ChatMessage } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { RegistrationGate } from "./RegistrationGate";
import { AccessCodeGate } from "../AccessCodeGate";
import { ConsentInfo, IntakeProfile, Phase, ProductCardInfo, VideoCardInfo } from "./types";
import { ChatIntake } from "./ChatIntake";

/**
 * Preventive vitamin recommender — real client.
 *
 * First use shows an access code gate, then registration + informed-consent gate.
 * Once registered, chat goes through POST /assistant/ask; returning customers
 * reload their persisted conversation via GET /assistant/history.
 *
 * T access-code-always: the access code is requested on EVERY visit — a
 * returning customer with a stored identity also boots into the gate and, on
 * validation, records last-touch attribution via POST /assistant/attribution
 * before the profile check routes intake vs chat.
 *
 * T3 chat-intake: a first-time customer (or a returning one without a saved
 * profile) runs the 5-step `intake` questionnaire before chat. The decision is
 * made from the server (GET /assistant/profile), never from localStorage.
 *
 * T4: `onOpenAssessment` is forwarded to ChatMessages so the `[ASSESSMENT]`
 * button-card in an agent reply opens the prevention wizard. Optional — the
 * chat works without it (the card renders disabled).
 */

interface ChatSessionProps {
  /** T4 — Opens the prevention wizard from the `[ASSESSMENT]` card. */
  onOpenAssessment?: () => void;
  /** Closes the host surface — wired by ChatPage to navigate back to the landing. */
  onClose?: () => void;
}

const GREETING = "¡Hola! ¿En qué te puedo ayudar hoy con tu bienestar?";

/**
 * S5 (odd/tasks/chat-intake-ux.md) — the first agent message once the
 * questionnaire is finished. A fixed, profile-aware opener written by the
 * frontend (no `/assistant/ask` round-trip, so it cannot fail or stall) that
 * asks which ailments the customer wants to talk about, in a friendly and
 * plain tone.
 */
function buildIntakeGreeting(profile: IntakeProfile): string {
  const facts: string[] = [];
  const age = profile.age.trim();
  if (age !== "") facts.push(`${age} años`);
  const goals = profile.goal.split(",").map((goal) => goal.trim()).filter(Boolean);
  if (goals.length > 0) {
    facts.push(`${goals.length > 1 ? "objetivos" : "objetivo"} ${goals.join(", ")}`);
  }
  const detail = facts.length > 0 ? ` (${facts.join(" · ")})` : "";
  const base = `¡Hola! Ya guardé tu ficha inicial${detail}. `;
  if (profile.openNote.trim() !== "") {
    // With a note the hand-off is conversational: the greeting stays short,
    // the note is appended as the customer's first message and the agent
    // replies through /assistant/ask (see handleIntakeComplete).
    return base + "Gracias por contarme tu preocupación; la tengo en cuenta.";
  }
  return (
    base +
    "¿Qué dolencias o molestias te gustaría conversar conmigo? " +
    "Cuéntamelo con tus palabras y arrancamos."
  );
}

const EMPTY_PROFILE: IntakeProfile = {
  sex: "",
  age: "",
  goal: "",
  diet: "",
  activity: "",
  sleep: "",
  stress: "",
  openNote: "",
};

/**
 * Asks the server whether the customer already has an intake profile.
 * Returns `true` (profile exists), `false` (server explicitly answered
 * `{profile: null}`) or `null` when the answer is unknown (network error or
 * unexpected status).
 */
async function fetchProfileExists(customerId: number): Promise<boolean | null> {
  try {
    const res = await fetch(`/api/assistant/profile?customer_id=${customerId}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { profile?: unknown };
    return data.profile != null;
  } catch {
    return null;
  }
}

const STORAGE = {
  customerId: "vr_customer_id",
  conversationId: "vr_conversation_id",
};

function readStoredNumber(key: string): number | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readStoredConsentVersion(): number | null {
  const raw = window.localStorage.getItem("vr_consent_version");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export function ChatSession({ onOpenAssessment, onClose }: ChatSessionProps) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [consent, setConsent] = useState<ConsentInfo | null>(null);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentReentry, setConsentReentry] = useState(false);

  // Access code state
  const [referrerId, setReferrerId] = useState<number | null>(null);
  const [referrerName, setReferrerName] = useState<string | null>(null);

  // Registration form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState(DEFAULT_COUNTRY_CODE);
  const [referrerPhone, setReferrerPhone] = useState("");
  const [referrerCode, setReferrerCode] = useState(DEFAULT_COUNTRY_CODE);
  const [agreed, setAgreed] = useState(false);

  // Session identity
  const [customerId, setCustomerId] = useState<number | null>(() => readStoredNumber(STORAGE.customerId));
  const [conversationId, setConversationId] = useState<number | null>(() =>
    readStoredNumber(STORAGE.conversationId),
  );
  const consentedVersion = useRef<number | null>(readStoredConsentVersion());

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // T3 chat-intake — the 5-step questionnaire answers (client-side shape).
  const [profile, setProfile] = useState<IntakeProfile>(EMPTY_PROFILE);

  // ENABLED video segments for `[VIDEO:<id>]` cards — fetched once the
  // access-code gate is cleared (see the catalog effect below).
  const [videos, setVideos] = useState<Map<number, VideoCardInfo>>(() => new Map());

  // T6 — Catalog products for `[REF]` citations — same deferred load as the
  // videos. Best-effort contract unchanged: failure → empty map, never blocks chat.
  const [products, setProducts] = useState<Map<string, ProductCardInfo>>(() => new Map());

  const scrollRef = useRef<HTMLDivElement>(null);

  // T1/S2d — resolve the persisted `[VIDEO:<id>]` markers in assistant replies
  // (live and reloaded history) into clickable cards. Deferred until
  // `phase === "chat"`: a visit that never clears the access-code gate must not
  // pay for this request. Best-effort only — a failure here must never block
  // consent, gates, or chat.
  useEffect(() => {
    if (phase !== "chat") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/assistant/videos");
        if (!res.ok) return;
        const data = (await res.json()) as { videos?: unknown };
        const list = Array.isArray(data?.videos) ? data.videos : [];
        const map = new Map<number, VideoCardInfo>();
        for (const item of list) {
          if (item == null || typeof item !== "object") continue;
          const v = item as Partial<VideoCardInfo>;
          if (typeof v.id !== "number" || typeof v.title !== "string" || typeof v.url !== "string") {
            continue;
          }
          map.set(v.id, {
            id: v.id,
            title: v.title,
            condition: typeof v.condition === "string" ? v.condition : null,
            summary: typeof v.summary === "string" ? v.summary : "",
            url: v.url,
            speaker: typeof v.speaker === "string" ? v.speaker : "",
            // T4 Phase A: optional raw seconds (numbers only; the card
            // formats them to mm:ss; absent times → no chip, no crash).
            ...(typeof v.startS === "number" ? { startS: v.startS } : {}),
            ...(typeof v.endS === "number" ? { endS: v.endS } : {}),
          });
        }
        if (!cancelled) setVideos(map);
      } catch {
        // Video cards are best-effort; chat keeps working without them
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  // T1/S2d — resolve the `[REF]` citations in agent replies into ProductCards,
  // deferred to `phase === "chat"` for the same reason as the videos.
  // Best-effort only — a failure here must never block consent, gates, or chat.
  useEffect(() => {
    if (phase !== "chat") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/assistant/products");
        if (!res.ok) return;
        const data = (await res.json()) as { products?: unknown };
        const list = Array.isArray(data?.products) ? data.products : [];
        const map = new Map<string, ProductCardInfo>();
        for (const item of list) {
          if (item == null || typeof item !== "object") continue;
          const p = item as Partial<ProductCardInfo>;
          if (
            typeof p.reference !== "string" ||
            typeof p.name !== "string" ||
            typeof p.price !== "number"
          ) {
            continue;
          }
          map.set(p.reference, {
            reference: p.reference,
            name: p.name,
            price: p.price,
            category: typeof p.category === "string" ? p.category : "",
            benefits: typeof p.benefits === "string" ? p.benefits : "",
            disclaimer: typeof p.disclaimer === "string" ? p.disclaimer : "",
          });
        }
        if (!cancelled) setProducts(map);
      } catch {
        // Product cards are best-effort; chat keeps working without them
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  const fetchConsent = useCallback(async (): Promise<ConsentInfo | null> => {
    try {
      const res = await fetch("/api/assistant/consent");
      if (!res.ok) return null;
      return (await res.json()) as ConsentInfo;
    } catch {
      return null;
    }
  }, []);

  const loadConsent = useCallback(async () => {
    setConsentLoading(true);
    const info = await fetchConsent();
    if (info) {
      setConsent(info);
      setConsentError(null);
    } else {
      setConsentError(
        "No pudimos cargar el consentimiento informado. Comprueba que el servidor esté disponible e inténtalo de nuevo.",
      );
    }
    setConsentLoading(false);
  }, [fetchConsent]);

  const loadHistory = useCallback(async () => {
    if (customerId == null || conversationId == null) return;
    try {
      const res = await fetch(
        `/api/assistant/history?conversation_id=${conversationId}&customer_id=${customerId}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { messages: Array<{ role: string; content: string }> };
      const restored: ChatMessage[] = data.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ sender: m.role === "user" ? "user" : "agent", text: m.content }));
      if (restored.length > 0) setMessages(restored);
    } catch {
      // History is best-effort memory
    }
  }, [customerId, conversationId]);

  // On first mount (the host shows the session): access-code-always.
  // The access code is requested on EVERY visit — including returning
  // customers with a stored identity — so boot always lands on the access
  // code gate. The returning-user routing (attribution → profile check →
  // intake|chat) happens in handleAccessCodeValidated after the code is
  // validated.
  useEffect(() => {
    if (phase !== "boot") return;
    setConsentReentry(false);
    setPhase("access_code");
  }, [phase]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  const persistIdentity = (id: number, convId: number | null) => {
    window.localStorage.setItem(STORAGE.customerId, String(id));
    setCustomerId(id);
    if (convId != null) {
      window.localStorage.setItem(STORAGE.conversationId, String(convId));
      setConversationId(convId);
    } else {
      window.localStorage.removeItem(STORAGE.conversationId);
      setConversationId(null);
    }
  };

  // Drops the persisted identity — used when the server proves it is
  // corrupt/unknown (attribution 400/404), so the full registration gate
  // starts from a clean slate.
  const clearIdentity = () => {
    window.localStorage.removeItem(STORAGE.customerId);
    window.localStorage.removeItem(STORAGE.conversationId);
    setCustomerId(null);
    setConversationId(null);
  };

  /**
   * Access code validated (access-code-always).
   *
   * - Fresh visitor (no customer_id): full registration gate, unchanged.
   * - Returning visitor: POST /assistant/attribution (last-touch). Branches:
   *   200 → consent is current and the referrer was recorded → profile
   *   check decides `intake` vs `chat` (same degraded rule as before: only
   *   an explicit "no profile" routes to intake, an errored check keeps
   *   chat so a flaky server never blocks a returning customer);
   *   401 → CONSENT_REQUIRED → re-consent gate, identity KEPT (stale
   *   consent is not a corrupt identity);
   *   400/404 → corrupt identity → clear localStorage → full gate;
   *   network error → the code was asked and entered, but recording it is
   *   best-effort: degrade to the profile check instead of blocking (same
   *   philosophy as the profile/history fetches) — decision recorded in
   *   odd/tasks/access-code-always.md.
   */
  const handleAccessCodeValidated = async (id: number, name: string) => {
    // Last-touch: the freshly validated referrer REPLACES the previous one.
    setReferrerId(id);
    setReferrerName(name);

    if (customerId == null) {
      setConsentReentry(false);
      setPhase("gate");
      void loadConsent();
      return;
    }

    let res: Response;
    try {
      res = await fetch("/api/assistant/attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, referrer_id: id }),
      });
    } catch {
      // Network error: attribution is best-effort for this visit; never
      // block a returning customer over it (see docblock above).
      const exists = await fetchProfileExists(customerId);
      if (exists === false) {
        setPhase("intake");
        return;
      }
      setPhase("chat");
      setMessages([{ sender: "agent", text: GREETING }]);
      if (conversationId != null) void loadHistory();
      return;
    }

    if (res.ok) {
      const exists = await fetchProfileExists(customerId);
      if (exists === false) {
        setPhase("intake");
        return;
      }
      setPhase("chat");
      setMessages([{ sender: "agent", text: GREETING }]);
      if (conversationId != null) void loadHistory();
      return;
    }

    if (res.status === 401) {
      // Stale consent → re-consent before any attribution is written.
      // The identity stays: the customer exists, only the consent text
      // moved on.
      setConsentReentry(true);
      setPhase("gate");
      void loadConsent();
      return;
    }

    // 400 (invalid customer_id) / 404 (unknown customer): the stored
    // identity is corrupt — clear it and start the full registration.
    clearIdentity();
    setConsentReentry(false);
    setPhase("gate");
    void loadConsent();
  };

  const handleConsentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (consent == null) return;
    setConsentError(null);

    if (!agreed) {
      setConsentError("Debes aceptar el consentimiento informado para continuar.");
      return;
    }
    if (!name.trim() || !email.trim() || !phone.trim()) {
      setConsentError("Nombre, correo electrónico y teléfono son obligatorios.");
      return;
    }

    setConsentLoading(true);
    try {
      const res = await fetch("/api/assistant/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: formatPhone(phoneCode, phone),
          referrer_phone: referrerPhone.trim() ? formatPhone(referrerCode, referrerPhone) : null,
          referrer_id: referrerId,
          consent_version: consent.version,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { customer_id: number };
        window.localStorage.setItem("vr_consent_version", String(consent.version));
        consentedVersion.current = consent.version;
        const keepConv = consentReentry && conversationId != null ? conversationId : null;
        persistIdentity(data.customer_id, keepConv);
        setChatError(null);
        // A freshly registered customer has no intake profile yet, so the
        // questionnaire runs next; only a confirmed profile skips it. If the
        // check fails we still run the intake: a new registration cannot have
        // a profile and re-submitting one is a harmless upsert. The opening
        // bubble is seeded only when chat opens directly — the questionnaire
        // path posts its own profile-aware greeting (S5).
        const hasProfile = await fetchProfileExists(data.customer_id);
        if (hasProfile === true && keepConv == null) {
          setMessages([{ sender: "agent", text: GREETING }]);
        }
        setPhase(hasProfile === true ? "chat" : "intake");
      } else if (res.status === 409) {
        setConsentError(
          "Ya existe una cuenta con ese correo o teléfono y el consentimiento no pudo renovarse automáticamente. Contáctanos para actualizar tus datos o inténtalo con otro correo.",
        );
      } else {
        setConsentError(
          "No pudimos completar el registro. Revisa los datos e inténtalo de nuevo.",
        );
      }
    } catch {
      setConsentError("No pudimos conectar con el servidor. Inténtalo de nuevo en unos momentos.");
    } finally {
      setConsentLoading(false);
    }
  };

  const appendMessage = (msg: ChatMessage) => setMessages((prev) => [...prev, msg]);

  /**
   * T3 — persists the completed intake (snake_case wire shape) and only then
   * opens the chat. On failure it resolves `false`: we must NOT enter chat
   * with an unsaved profile, because the answers would be lost and every
   * reply would be generated without the PERFIL DEL USUARIO prompt block.
   */
  const handleIntakeComplete = async (next: IntakeProfile): Promise<boolean> => {
    if (customerId == null) return false;
    try {
      const res = await fetch("/api/assistant/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          sex: next.sex,
          age: next.age === "" ? null : Number(next.age),
          goal: next.goal,
          diet: next.diet,
          activity: next.activity,
          sleep: next.sleep,
          stress: next.stress,
          open_note: next.openNote,
        }),
      });
      if (!res.ok) return false;
    } catch {
      return false;
    }
    setProfile(next);
    setChatError(null);
    const note = next.openNote.trim();
    const fresh = messages.length === 0;
    // Keep an already-restored conversation; otherwise open with the
    // profile-aware S5 greeting that asks about the customer's ailments.
    setMessages((prev) =>
      prev.length > 0 ? prev : [{ sender: "agent", text: buildIntakeGreeting(next) }],
    );
    setPhase("chat");
    if (fresh && note !== "") {
      // The concern they just typed becomes their first message: the agent
      // engages from the full profile (the note rides in profileBlock),
      // either asking follow-up questions or recommending — degraded to the
      // standard error line if /assistant/ask fails, never blocking the chat.
      void sendMessage(note);
    }
    return true;
  };

  /**
   * One conversation turn: appends the customer's bubble and runs the
   * /assistant/ask round-trip with its 401/503/error degradation. Shared by
   * the input form and the automatic post-intake opener (note hand-off).
   */
  const sendMessage = async (text: string) => {
    if (!text || sending) return;

    if (customerId == null) {
      setConsentReentry(false);
      setPhase("gate");
      void loadConsent();
      return;
    }

    setChatError(null);
    appendMessage({ sender: "user", text });
    setSending(true);

    try {
      const res = await fetch("/api/assistant/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          conversation_id: conversationId ?? undefined,
          message: text,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          conversation_id: number;
          reply: string;
        };
        persistIdentity(customerId, data.conversation_id);
        appendMessage({ sender: "agent", text: data.reply });
      } else if (res.status === 401) {
        let info = consent;
        try {
          const data = (await res.json()) as { consent?: ConsentInfo };
          if (data.consent) info = data.consent;
        } catch {
          /* fall back to cached consent */
        }
        if (!info) info = await fetchConsent();
        if (info) {
          setConsent(info);
          setConsentError(null);
        }
        setConsentReentry(true);
        setPhase("gate");
      } else if (res.status === 503) {
        appendMessage({
          sender: "agent",
          text: "El motor de recomendación está temporalmente no disponible. Por favor, inténtalo de nuevo en unos momentos.",
        });
      } else {
        appendMessage({
          sender: "agent",
          text: "Algo salió mal al procesar tu mensaje. Por favor, inténtalo de nuevo.",
        });
      }
    } catch {
      appendMessage({
        sender: "agent",
        text: "No pudimos conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.",
      });
    } finally {
      setSending(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || sending) return;
    setInputValue("");
    void sendMessage(text);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ChatHeader onClose={() => onClose?.()} />

      {phase === "access_code" && (
        <AccessCodeGate onValidated={handleAccessCodeValidated} />
      )}

      {phase === "gate" && (
        <RegistrationGate
          consent={consent}
          consentLoading={consentLoading}
          consentError={consentError}
          consentReentry={consentReentry}
          name={name}
          email={email}
          phone={phone}
          phoneCode={phoneCode}
          referrerPhone={referrerPhone}
          referrerCode={referrerCode}
          agreed={agreed}
          onNameChange={setName}
          onEmailChange={setEmail}
          onPhoneChange={setPhone}
          onPhoneCodeChange={setPhoneCode}
          onReferrerPhoneChange={setReferrerPhone}
          onReferrerCodeChange={setReferrerCode}
          onAgreedChange={setAgreed}
          onSubmit={handleConsentSubmit}
        />
      )}

      {phase === "intake" && (
        <ChatIntake profile={profile} onChange={setProfile} onComplete={handleIntakeComplete} />
      )}

      {phase === "chat" && (
        <>
          <ChatMessages
            messages={messages}
            sending={sending}
            chatError={chatError}
            scrollRef={scrollRef}
            videos={videos}
            products={products}
            onOpenAssessment={onOpenAssessment}
          />
          <ChatInput
            inputValue={inputValue}
            sending={sending}
            onInputChange={setInputValue}
            onSend={handleSend}
          />
        </>
      )}
    </div>
  );
}
