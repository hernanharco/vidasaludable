import React from "react";
import { AlertCircle } from "lucide-react";
import { COUNTRY_CODES, DEFAULT_COUNTRY_CODE } from "../../lib/countryCodes";
import { ConsentInfo } from "./types";

interface RegistrationGateProps {
  consent: ConsentInfo | null;
  consentLoading: boolean;
  consentError: string | null;
  consentReentry: boolean;
  name: string;
  email: string;
  phone: string;
  phoneCode: string;
  referrerPhone: string;
  referrerCode: string;
  agreed: boolean;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onPhoneCodeChange: (v: string) => void;
  onReferrerPhoneChange: (v: string) => void;
  onReferrerCodeChange: (v: string) => void;
  onAgreedChange: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
}

const inputCls =
  "w-full px-3 py-2 bg-stone-100 border border-stone-200 rounded-lg text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-emerald-900 transition-shadow";

const codeSelectCls =
  "w-[112px] shrink-0 px-2 py-2 bg-stone-100 border border-stone-200 rounded-lg text-sm text-stone-800 focus:outline-none focus:ring-1 focus:ring-emerald-900 transition-shadow";

export function RegistrationGate({
  consent,
  consentLoading,
  consentError,
  consentReentry,
  name,
  email,
  phone,
  phoneCode,
  referrerPhone,
  referrerCode,
  agreed,
  onNameChange,
  onEmailChange,
  onPhoneChange,
  onPhoneCodeChange,
  onReferrerPhoneChange,
  onReferrerCodeChange,
  onAgreedChange,
  onSubmit,
}: RegistrationGateProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4 bg-stone-50">
      <h4 className="font-semibold text-stone-800 text-sm mb-1">
        {consentReentry ? "Actualiza tu consentimiento" : "Antes de empezar"}
      </h4>
      <p className="text-xs text-stone-500 mb-3">
        {consentReentry
          ? "Necesitamos tu consentimiento actualizado para continuar la conversación."
          : "Por favor, lee y acepta el consentimiento informado para recibir recomendaciones."}
      </p>

      {consentLoading && !consent ? (
        <p className="text-xs text-stone-500">Cargando términos...</p>
      ) : consent ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="max-h-44 overflow-y-auto rounded-lg border border-stone-200 bg-white p-3">
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-stone-600 font-sans">
              {consent.text}
            </pre>
          </div>

          <label className="text-xs text-stone-600">
            Nombre
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className={inputCls}
              placeholder="Tu nombre"
            />
          </label>
          <label className="text-xs text-stone-600">
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              className={inputCls}
              placeholder="correo@ejemplo.com"
            />
          </label>
          <label className="text-xs text-stone-600">
            Teléfono
            <div className="flex gap-2">
              <select
                value={phoneCode}
                onChange={(e) => onPhoneCodeChange(e.target.value)}
                className={codeSelectCls}
                aria-label="Indicativo del país"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={`${c.code}-${c.name}`} value={c.code}>
                    {c.code} {c.name}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={phone}
                onChange={(e) => onPhoneChange(e.target.value)}
                className={inputCls}
                placeholder="Número de contacto"
              />
            </div>
          </label>
          <label className="text-xs text-stone-600">
            Teléfono de referido (opcional)
            <div className="flex gap-2">
              <select
                value={referrerCode}
                onChange={(e) => onReferrerCodeChange(e.target.value)}
                className={codeSelectCls}
                aria-label="Indicativo del país del referido"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={`${c.code}-${c.name}`} value={c.code}>
                    {c.code} {c.name}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={referrerPhone}
                onChange={(e) => onReferrerPhoneChange(e.target.value)}
                className={inputCls}
                placeholder="Quién te recomendó"
              />
            </div>
          </label>

          <label className="flex items-start gap-2 text-xs text-stone-600 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => onAgreedChange(e.target.checked)}
              className="mt-0.5 accent-emerald-900"
            />
            <span>
              He leído y acepto el consentimiento informado (versión {consent.version}).
            </span>
          </label>

          {consentError && (
            <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{consentError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={consentLoading}
            className="w-full py-2.5 bg-emerald-900 text-white text-sm font-medium rounded-full disabled:opacity-50 hover:bg-emerald-800 transition-colors"
          >
            {consentLoading ? "Procesando..." : "Aceptar y continuar"}
          </button>
        </form>
      ) : (
        <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{consentError ?? "No pudimos cargar el consentimiento."}</span>
        </div>
      )}
    </div>
  );
}
