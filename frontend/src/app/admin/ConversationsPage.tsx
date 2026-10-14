import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, Conversation, Customer } from "./api";
import { DataTable, type DataTableColumn } from "./DataTable";
import { ErrorBanner, toErrorState, type ErrorState } from "./ErrorBanner";

export function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<ErrorState | null>(null);
  const [deleteError, setDeleteError] = useState<ErrorState | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [co, cu] = await Promise.all([api.listConversations(), api.listCustomers()]);
      setConversations(co.conversations);
      setCustomers(cu.customers);
      setError(null);
    } catch (e) {
      setError(toErrorState(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const customerName = (id: number) =>
    customers.find((c) => c.id === id)?.name ?? `cliente #${id}`;

  const columns: DataTableColumn<Conversation>[] = [
    { key: "id", header: "ID", sortable: true, render: (c) => c.id },
    {
      key: "cliente",
      header: "Cliente",
      sortable: true,
      sortValue: (c) => customerName(c.customerId),
      render: (c) => customerName(c.customerId),
    },
    {
      key: "creada",
      header: "Creada",
      align: "right",
      sortable: true,
      cellClassName: "text-xs text-stone-500",
      render: (c) => new Date(c.createdAt).toLocaleString(),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      cellClassName: "space-x-2",
      render: (c) => (
        <>
          <Link to={`/admin/conversations/${c.id}`} className="text-emerald-800 hover:underline">
            Ver mensajes
          </Link>
          <button
            onClick={async () => {
              if (!confirm(`¿Eliminar la conversación #${c.id}?`)) return;
              try {
                await api.deleteConversation(c.id);
                setDeleteError(null);
                await load();
              } catch (err) {
                setDeleteError(toErrorState(err));
              }
            }}
            className="text-red-500 hover:text-red-700"
          >
            Eliminar
          </button>
        </>
      ),
    },
  ];

  if (loading) return <p className="text-stone-500">Cargando…</p>;
  if (error) {
    return (
      <ErrorBanner status={error.status} detail={error.detail} title={error.title} onRetry={load} />
    );
  }

  return (
    <div>
      {deleteError && (
        <ErrorBanner status={deleteError.status} detail={deleteError.detail} title={deleteError.title} />
      )}
      <h1 className="font-serif text-2xl">Conversaciones</h1>
      <p className="mt-1 text-sm text-stone-500">
        Hilos del chat con memoria. Haz clic para ver los mensajes.
      </p>
      <DataTable
        columns={columns}
        rows={conversations}
        getRowKey={(c) => String(c.id)}
        emptyMessage="No hay conversaciones todavía."
        containerClassName="mt-6 bg-white border border-stone-200"
      />
    </div>
  );
}