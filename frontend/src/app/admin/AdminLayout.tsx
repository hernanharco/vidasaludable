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
  Lock,
} from "lucide-react";
import { api, AdminError, setAdminAuth, clearAdminAuth } from "./api";

const sections = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/catalog", label: "Catálogo", icon: Package, end: false },
  { to: "/admin/customers", label: "Clientes", icon: Users, end: false },
  { to: "/admin/conversations", label: "Conversaciones", icon: MessagesSquare, end: false },
  { to: "/admin/guidance", label: "Guías", icon: BookOpen, end: false },
  { to: "/admin/recommendations", label: "Recomendaciones", icon: ClipboardList, end: false },
];

const STORAGE_KEY = "vr_admin_sidebar_collapsed";

type AuthState = "checking" | "ok" | "login" | "error";

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
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  const probe = async () => {
    try {
      await api.listProducts();
      setAuthState("ok");
      setAuthMessage(null);
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) {
        clearAdminAuth();
        setAuthState("login");
        setAuthMessage(null);
      } else {
        setAuthState("error");
        setAuthMessage(e instanceof Error ? e.message : "Error de red");
      }
    }
  };

  useEffect(() => {
    void probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user.trim() || !pass) {
      setAuthMessage("Usuario y contraseña son obligatorios.");
      return;
    }
    setAdminAuth(user.trim(), pass);
    setAuthMessage("Verificando…");
    await probe();
    if (authState === "ok") {
      setUser("");
      setPass("");
    }
  };

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
              {authState === "ok"
                ? "Panel protegido · basic auth"
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
          ) : authState === "login" ? (
            <div className="max-w-md mx-auto mt-16 bg-white border border-stone-200 p-8">
              <div className="flex items-center gap-2 text-emerald-900">
                <Lock className="w-5 h-5" />
                <h2 className="font-serif text-xl">Acceso al CRM</h2>
              </div>
              <p className="mt-2 text-sm text-stone-500">
                El panel está protegido. Introduce las credenciales de administración.
              </p>
              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <label className="block text-xs text-stone-600">
                  Usuario
                  <input
                    type="text"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    autoComplete="username"
                    className="mt-1 w-full px-3 py-2 bg-stone-100 border border-stone-200 rounded-lg text-sm text-stone-800 focus:outline-none focus:ring-1 focus:ring-emerald-900"
                  />
                </label>
                <label className="block text-xs text-stone-600">
                  Contraseña
                  <input
                    type="password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    autoComplete="current-password"
                    className="mt-1 w-full px-3 py-2 bg-stone-100 border border-stone-200 rounded-lg text-sm text-stone-800 focus:outline-none focus:ring-1 focus:ring-emerald-900"
                  />
                </label>
                {authMessage && <p className="text-xs text-red-600">{authMessage}</p>}
                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-900 text-white text-sm font-medium rounded-lg hover:bg-emerald-800 transition-colors"
                >
                  Entrar
                </button>
              </form>
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