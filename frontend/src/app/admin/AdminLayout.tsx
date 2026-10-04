import { useEffect, useState } from "react";
import { NavLink, Outlet, Link } from "react-router";
import {
  Leaf,
  Home,
  LayoutDashboard,
  Package,
  Users,
  MessagesSquare,
  BookOpen,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  Key,
  Stethoscope,
  Clapperboard,
} from "lucide-react";
import { api, AdminError } from "./api";
import { getToken, clearToken } from "../lib/auth";
import { LoginScreen } from "./LoginScreen";

const sections = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/catalog", label: "Catálogo", icon: Package, end: false },
  { to: "/admin/customers", label: "Clientes", icon: Users, end: false },
  { to: "/admin/conversations", label: "Conversaciones", icon: MessagesSquare, end: false },
  { to: "/admin/guidance", label: "Guías", icon: BookOpen, end: false },
  { to: "/admin/recommendations", label: "Recomendaciones", icon: ClipboardList, end: false },
  { to: "/admin/referrers", label: "Referentes", icon: Key, end: false },
  { to: "/admin/assessment", label: "Evaluación", icon: Stethoscope, end: false },
  { to: "/admin/videos", label: "Vídeos", icon: Clapperboard, end: false },
];

const STORAGE_KEY = "vr_admin_sidebar_collapsed";

type AuthState = "checking" | "ok" | "login" | "restricted" | "error";

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const probe = async () => {
    try {
      await api.listProducts();
      setAuthState("ok");
      setAuthMessage(null);
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) {
        // request() already cleared the cookie and redirected to the login
        clearToken();
        setAuthState("login");
      } else if (e instanceof AdminError && e.status === 403) {
        // Valid token, wrong role — static message, never re-probe
        setAuthState("restricted");
      } else {
        setAuthState("error");
        setAuthMessage(e instanceof Error ? e.message : "Error de red");
      }
    }
  };

  useEffect(() => {
    if (getToken()) {
      void probe();
      return;
    }
    // No cookie: probe ONCE without auth to tell an open dev backend
    // (200 → enter the CRM with no ceremony, per the feature decision) from
    // production's JWT guard (401 → Google login screen). Raw fetch on
    // purpose — api.request would side-track the 401 into a redirect before
    // this gate could decide.
    void (async () => {
      try {
        const res = await fetch("/api/admin/catalog", {
          headers: { "Content-Type": "application/json" },
        });
        if (res.ok) {
          setAuthState("ok");
          return;
        }
      } catch {
        // Network error → fall through to the login screen
      }
      setAuthState("login");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  // No token cookie → the whole layout is replaced by the Google login screen
  if (authState === "login") {
    return <LoginScreen />;
  }

  return (
    <div className="h-screen bg-stone-50 text-stone-900 font-sans flex overflow-hidden">
      {/* Sidebar — fixed viewport height; nav scrolls internally if needed */}
      <aside
        className={`shrink-0 bg-emerald-950 text-stone-100 flex flex-col transition-all duration-200 ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <div
          className={`flex items-center gap-2 py-5 ${collapsed ? "justify-center px-0" : "px-6"}`}
        >
          <Leaf className="w-6 h-6 shrink-0" />
          {!collapsed && (
            <span className="font-serif text-lg tracking-wide whitespace-nowrap">
              Salud Preventiva · Admin
            </span>
          )}
        </div>
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {sections.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.end}
              title={collapsed ? s.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md py-2 text-sm tracking-wide transition-colors ${
                  collapsed ? "justify-center px-0" : "px-3"
                } ${
                  isActive
                    ? "bg-emerald-900 text-white"
                    : "text-stone-300 hover:bg-emerald-900/60 hover:text-white"
                }`
              }
            >
              <s.icon className="w-4 h-4 shrink-0" />
              {!collapsed && s.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-emerald-900/60 py-3 shrink-0">
          {!collapsed && (
            <p className="px-4 pb-2 text-[11px] text-stone-500">
              {getToken()
                ? "Panel protegido · authCore (Google)"
                : "Panel dev-only · sin autenticación"}
            </p>
          )}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expandir menú" : "Plegar menú"}
            className={`flex items-center gap-2 text-xs text-stone-400 hover:text-white transition-colors ${
              collapsed ? "justify-center w-full" : "px-4"
            }`}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <>
                <PanelLeftClose className="w-4 h-4" />
                Plegar menú
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Content — the only area that scrolls */}
      <main className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-8 py-4 bg-white border-b border-stone-200">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-stone-600 hover:text-emerald-900"
          >
            <Home className="w-4 h-4" /> Volver a la landing
          </Link>
          <span className="text-xs uppercase tracking-wider text-stone-400">
            CRM interno
          </span>
        </div>
        <div className="px-8 py-8">
          {authState === "checking" ? (
            <p className="text-stone-500">Comprobando acceso…</p>
          ) : authState === "ok" ? (
            <Outlet />
          ) : authState === "restricted" ? (
            <div className="max-w-2xl p-6 bg-amber-50 border border-amber-300 text-amber-900">
              <h2 className="font-serif text-xl">Acceso restringido</h2>
              <p className="mt-2 text-sm">
                Tu cuenta no tiene permisos de administración (se requiere rol
                ADMIN o SUPERADMIN). Contacta con el administrador del panel.
              </p>
            </div>
          ) : (
            <div className="max-w-2xl p-6 bg-amber-50 border border-amber-300 text-amber-900">
              <h2 className="font-serif text-xl">El panel no está disponible</h2>
              <p className="mt-2 text-sm">
                Respuesta del backend: {authMessage ?? "error desconocido"}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}