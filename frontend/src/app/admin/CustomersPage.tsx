import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api, Customer } from "./api";
import { DataTable, type DataTableColumn } from "./DataTable";
import { ErrorBanner, toErrorState, type ErrorState } from "./ErrorBanner";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<ErrorState | null>(null);
  const [deleteError, setDeleteError] = useState<ErrorState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api
      .listCustomers()
      .then((res) => {
        setCustomers(res.customers);
        setError(null);
      })
      .catch((e) => setError(toErrorState(e)))
      .finally(() => setLoading(false));
  }, [reload]);

  if (loading) return <p className="text-stone-500">Cargando…</p>;
  if (error) {
    return (
      <ErrorBanner
        status={error.status}
        detail={error.detail}
        title={error.title}
        onRetry={() => setReload((n) => n + 1)}
      />
    );
  }

  const columns: DataTableColumn<Customer>[] = [
    { key: "id", header: "ID", sortable: true, render: (c) => c.id },
    { key: "name", header: "Nombre", sortable: true, truncate: true, render: (c) => c.name },
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
        <span className="flex items-center justify-end gap-3">
          <Link
            to={`/admin/customers/${c.id}`}
            className="text-xs text-emerald-700 hover:text-emerald-900 hover:underline"
          >
            Ver ficha
          </Link>
          <button
            onClick={() => setConfirmDelete(c)}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Eliminar
          </button>
        </span>
      ),
    },
  ];

  return (
    <div>
      {deleteError && (
        <ErrorBanner
          status={deleteError.status}
          detail={deleteError.detail}
          title={deleteError.title}
        />
      )}
      <h1 className="font-serif text-2xl">Clientes</h1>
      <p className="mt-1 text-sm text-stone-500">
        Clientes registrados a través de la puerta de consentimiento del chat.
      </p>
      <DataTable
        columns={columns}
        rows={customers}
        getRowKey={(c) => String(c.id)}
        emptyMessage="No hay clientes registrados todavía."
        searchable
        searchText={(c) =>
          `${c.name} ${c.email} ${c.phone} ${c.referrerName ?? ""}`
        }
        containerClassName="mt-6 bg-white border border-stone-200"
      />
      <ConfirmActionDialog
        open={confirmDelete !== null}
        title={confirmDelete ? `¿Eliminar a ${confirmDelete.name}?` : ""}
        description="Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => {
          const row = confirmDelete;
          setConfirmDelete(null);
          if (!row) return;
          void (async () => {
            try {
              await api.deleteCustomer(row.id);
              setCustomers((prev) => prev.filter((x) => x.id !== row.id));
              setDeleteError(null);
              toast.success("Cliente eliminado");
            } catch (e) {
              setDeleteError(toErrorState(e));
            }
          })();
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}