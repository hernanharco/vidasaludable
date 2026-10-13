import { useEffect, useState } from "react";
import { api, Customer } from "./api";
import { DataTable, type DataTableColumn } from "./DataTable";

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

  const columns: DataTableColumn<Customer>[] = [
    { key: "id", header: "ID", sortable: true, render: (c) => c.id },
    { key: "name", header: "Nombre", sortable: true, render: (c) => c.name },
    { key: "email", header: "Email", sortable: true, render: (c) => c.email },
    { key: "phone", header: "Teléfono", sortable: true, render: (c) => c.phone },
    {
      key: "referrer",
      header: "Referido por",
      sortable: true,
      sortValue: (c) => c.referrerName ?? c.referrerPhone ?? null,
      render: (c) =>
        c.referrerName ? (
          <span className="text-emerald-700 font-medium">{c.referrerName}</span>
        ) : c.referrerPhone ? (
          <span className="text-stone-500">{c.referrerPhone}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "consent",
      header: "Consent v",
      align: "right",
      sortable: true,
      render: (c) => c.consentVersion,
    },
    {
      key: "registered",
      header: "Registrado",
      align: "right",
      sortable: true,
      cellClassName: "text-xs text-stone-500",
      render: (c) => new Date(c.registeredAt).toLocaleString(),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      render: (c) => (
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
      ),
    },
  ];

  return (
    <div>
      <h1 className="font-serif text-2xl">Clientes</h1>
      <p className="mt-1 text-sm text-stone-500">
        Clientes registrados a través de la puerta de consentimiento del chat.
      </p>
      <DataTable
        columns={columns}
        rows={customers}
        getRowKey={(c) => String(c.id)}
        emptyMessage="No hay clientes registrados todavía."
        containerClassName="mt-6 bg-white border border-stone-200"
      />
    </div>
  );
}