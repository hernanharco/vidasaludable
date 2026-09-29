import React, { useState } from "react";
import { Key, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

const inputCls =
  "w-full px-3 py-2 bg-stone-100 border border-stone-200 rounded-lg text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-emerald-900 transition-shadow";

interface AccessCodeGateProps {
  onValidated: (referrerId: number, referrerName: string) => void;
}

/**
 * Access code gate — shown before chat or assessment.
 * User must enter a valid access code to proceed.
 * The code identifies who referred them to the site.
 */
export function AccessCodeGate({ onValidated }: AccessCodeGateProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState<{
    referrerId: number;
    referrerName: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Por favor, ingresá tu código de acceso.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/referrer/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          valid: boolean;
          referrerId: number;
          referrerName: string;
        };
        setValidated({
          referrerId: data.referrerId,
          referrerName: data.referrerName,
        });
      } else {
        setError("Código inválido. Contactá a quien te recomendó para obtener uno válido.");
      }
    } catch {
      setError("No pudimos conectar con el servidor. Intentalo de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (validated) {
      onValidated(validated.referrerId, validated.referrerName);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-stone-50">
      <h4 className="font-semibold text-stone-800 text-sm mb-1">
        Código de acceso
      </h4>
      <p className="text-xs text-stone-500 mb-3">
        Ingresá el código que te dieron para acceder a este servicio.
      </p>

      {validated ? (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-stone-800">
              Código válido
            </p>
            <p className="text-xs text-stone-500 mt-1">
              Te recomendó: <span className="font-medium text-stone-700">{validated.referrerName}</span>
            </p>
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-2.5 bg-emerald-900 text-white text-sm font-medium rounded-full hover:bg-emerald-800 transition-colors"
          >
            Continuar
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="text-xs text-stone-600">
            Tu código de acceso
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError(null);
                }}
                className={`${inputCls} pl-9`}
                placeholder="Ej: 190643239"
                autoFocus
                disabled={loading}
              />
            </div>
          </label>

          {error && (
            <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="w-full py-2.5 bg-emerald-900 text-white text-sm font-medium rounded-full disabled:opacity-50 hover:bg-emerald-800 transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Verificando...
              </span>
            ) : (
              "Validar código"
            )}
          </button>
        </form>
      )}
    </div>
  );
}
