import { useEffect, useState } from "react";
import { api, Customer } from "./api";

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listCustomers()
      .then((res) => {
        setCustomers(res.customers);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error de red"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-stone-500">Cargando…</p>;
  if (error) {
    return (
      <div className="max-w-2xl p-6 bg-amber-50 border border-amber-300 text-amber-900">
        <h2 className="font-serif text-xl">Acceso restringido</h2>
        <p className="mt-2 text-sm">Respuesta del backend: {error}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">Clientes</h1>
      <p className="mt-1 text-sm text-stone-500">
        Clientes registrados a través de la puerta de consentimiento del chat.
      </p>
      <div className="mt-6 overflow-x-auto bg-white border border-stone-200">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-stone-600 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">ID</th>
              <th className="px-4 py-3 text-left">Nombre</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Teléfono</th>
              <th className="px-4 py-3 text-left">Referido por</th>
              <th className="px-4 py-3 text-right">Consent v</th>
              <th className="px-4 py-3 text-right">Registrado</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-stone-200">
                <td className="px-4 py-3">{c.id}</td>
                <td className="px-4 py-3">{c.name}</td>
                <td className="px-4 py-3">{c.email}</td>
                <td className="px-4 py-3">{c.phone}</td>
                <td className="px-4 py-3">
                  {c.referrerName ? (
                    <span className="text-emerald-700 font-medium">{c.referrerName}</span>
                  ) : c.referrerPhone ? (
                    <span className="text-stone-500">{c.referrerPhone}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-right">{c.consentVersion}</td>
                <td className="px-4 py-3 text-right text-xs text-stone-500">
                  {new Date(c.registeredAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={async () => {
                      if (!confirm(`¿Eliminar a ${c.name}?`)) return;
                      try {
                        await api.deleteCustomer(c.id);
                        setCustomers((prev) => prev.filter((x) => x.id !== c.id));
                      } catch (e) {
                        alert("Error al eliminar: " + (e instanceof Error ? e.message : "error desconocido"));
                      }
                    }}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}