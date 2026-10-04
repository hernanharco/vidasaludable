import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { setToken } from "../lib/auth";

// /auth/callback — authCore redirects here after a successful Google login:
//   /auth/callback?token={jwt}
// Stores the JWT in the `token` cookie (7d, SameSite=Lax) and continues into
// the CRM. No fetch involved: token validity is verified server-side on the
// first admin request.
export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const token = searchParams.get("token");
    if (!token) {
      setError("No se recibió ningún token de autenticación.");
      return;
    }
    setToken(token);
    // Strip the token from the address bar before entering the CRM.
    window.history.replaceState({}, "", "/auth/callback");
    navigate("/admin", { replace: true });
  }, [navigate, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4 font-sans text-stone-900">
        <div className="max-w-md bg-white border border-stone-200 p-8 text-center">
          <h1 className="font-serif text-xl">Error de autenticación</h1>
          <p className="mt-2 text-sm text-stone-500">{error}</p>
          <Link
            to="/admin/login"
            className="mt-6 inline-block px-4 py-2 bg-emerald-900 text-white text-sm font-medium rounded-lg hover:bg-emerald-800 transition-colors"
          >
            Volver al inicio de sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center font-sans">
      <p className="text-stone-500">Comprobando acceso…</p>
    </div>
  );
}
