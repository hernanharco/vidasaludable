import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MessageCircle, X } from "lucide-react";
import { COUNTRY_CODES, DEFAULT_COUNTRY_CODE, formatPhone } from "../../lib/countryCodes";

import { ChatHeader } from "./ChatHeader";
import { ChatMessages, ChatMessage } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { RegistrationGate } from "./RegistrationGate";
import { ConsentInfo, Phase } from "./types";

/**
 * Preventive vitamin recommender — real client.
 *
 * First use shows a registration + informed-consent gate (the exact legal text
 * is fetched from `GET /assistant/consent`, never hardcoded). Once registered,
 * chat goes through `POST /assistant/ask`; returning customers reload their
 * persisted conversation via `GET /assistant/history`. If the backend flags a
 * stale consent version (`401 CONSENT_REQUIRED`), the gate is shown again with
 * the current text.
 */

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

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("boot");
  const [consent, setConsent] = useState<ConsentInfo | null>(null);
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentReentry, setConsentReentry] = useState(false);

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

  const scrollRef = useRef<HTMLDivElement>(null);

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

  // On first open: decide between consent gate or chat
  useEffect(() => {
    if (!isOpen || phase !== "boot") return;
    if (customerId == null) {
      setConsentReentry(false);
      setPhase("gate");
      void loadConsent();
    } else {
      setPhase("chat");
      setMessages([{ sender: "agent", text: "¡Hola! ¿En qué te puedo ayudar hoy con tu bienestar?" }]);
      if (conversationId != null) void loadHistory();
    }
  }, [isOpen, phase, customerId, conversationId, loadConsent]);

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
          consent_version: consent.version,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { customer_id: number };
        window.localStorage.setItem("vr_consent_version", String(consent.version));
        consentedVersion.current = consent.version;
        const keepConv = consentReentry && conversationId != null ? conversationId : null;
        persistIdentity(data.customer_id, keepConv);
        if (keepConv == null) {
          setMessages([{ sender: "agent", text: "¡Hola! ¿En qué te puedo ayudar hoy con tu bienestar?" }]);
        }
        setChatError(null);
        setPhase("chat");
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || sending) return;

    if (customerId == null) {
      setConsentReentry(false);
      setPhase("gate");
      void loadConsent();
      return;
    }

    setInputValue("");
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

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-16 right-0 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl overflow-hidden border border-stone-200 flex flex-col h-[440px]"
          >
            <ChatHeader onClose={() => setIsOpen(false)} />

            {phase === "gate" ? (
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
            ) : (
              <>
                <ChatMessages
                  messages={messages}
                  sending={sending}
                  chatError={chatError}
                  scrollRef={scrollRef}
                />
                <ChatInput
                  inputValue={inputValue}
                  sending={sending}
                  onInputChange={setInputValue}
                  onSend={handleSend}
                />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-emerald-900 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-emerald-800 transition-colors focus:outline-none focus:ring-4 focus:ring-emerald-900/30"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </motion.button>
    </div>
  );
}
