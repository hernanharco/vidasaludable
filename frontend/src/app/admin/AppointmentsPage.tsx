import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { api, type Appointment, type AppointmentStatus } from "./api";
import { DataTable, type DataTableColumn } from "./DataTable";
import { ErrorBanner, toErrorState, type ErrorState } from "./ErrorBanner";

/**
 * T7 (tamizaje-images scope gap) — the GLOBAL "Citas" CRM page.
 *
 * T3 only added the per-customer "Citas" section inside CustomerDetailPage,
 * which filters `GET /admin/appointments` by customerId: rows created from
 * the PUBLIC landing Booking form (`customer_id` NULL) were visible nowhere
 * in the CRM. This page lists EVERY request from the same endpoint, with the
 * CRM status machine (optimistic PATCH + toast) and follow-up notes.
 *
 * Linked customer: rows created from the chat carry only `customerId`, so
 * the backend enriches the payload with `customerName`/`customerPhone`/
 * `customerEmail` (additive fields) and these columns fall back to them —
 * chat rows show the real contact data; landing rows render "—". The
 * "Cliente vinculado" column still links to the ficha.
 *
 * Status labels/colors mirror CustomerScreening (pendiente amber,
 * contactada blue, agendada green, cancelada stone).
 */

const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "pendiente",
  "contactada",
  "agendada",
  "cancelada",
];
const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pendiente: "Pendiente",
  contactada: "Contactada",
  agendada: "Agendada",
  cancelada: "Cancelada",
};
/** Same badge mapping as CustomerScreening: amber / blue / green / stone. */
const STATUS_BADGE: Record<AppointmentStatus, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  contactada: "bg-blue-100 text-blue-700",
  agendada: "bg-green-100 text-green-700",
  cancelada: "bg-stone-100 text-stone-600",
};

type StatusFilter = AppointmentStatus | "todos";

export function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState<ErrorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  // One status select in flight at a time (same pattern as CustomerScreening)
  const [savingStatusId, setSavingStatusId] = useState<number | null>(null);
  // Inline notes editor (one row at a time)
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .listAppointments()
      .then((res) => {
        if (cancelled) return;
        // Newest first (the wire may send any order), like the ficha section.
        setAppointments(
          [...res.appointments].sort(
            (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
          ),
        );
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(toErrorState(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const changeStatus = async (id: number, next: AppointmentStatus) => {
    const previous = appointments.find((a) => a.id === id)?.status;
    // Optimistic: recolor the badge immediately, reconcile with the server
    // response below, roll back on error.
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: next } : a)),
    );
    setSavingStatusId(id);
    try {
      const res = await api.updateAppointment(id, { status: next });
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? res.appointment : a)),
      );
      toast.success("Estado de la cita actualizado");
    } catch (e) {
      if (previous != null) {
        setAppointments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: previous } : a)),
        );
      }
      toast.error(`No se pudo actualizar la cita: ${toErrorState(e).detail}`);
    } finally {
      setSavingStatusId(null);
    }
  };

  const saveNotes = async (id: number) => {
    const draft = notesDraft;
    const previous = appointments.find((a) => a.id === id)?.notes ?? null;
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, notes: draft } : a)),
    );
    setEditingNotesId(null);
    try {
      const res = await api.updateAppointment(id, { notes: draft });
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? res.appointment : a)),
      );
      toast.success("Notas actualizadas");
    } catch (e) {
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, notes: previous } : a)),
      );
      toast.error(`No se pudo actualizar las notas: ${toErrorState(e).detail}`);
    }
  };

  if (loading) return <p className="text-stone-500">Cargando…</p>;
  if (error) {
    return (
      <ErrorBanner
        status={error.status}
        detail={error.detail}
        title={error.title}
        onRetry={() => {
          setLoading(true);
          setReload((n) => n + 1);
        }}
      />
    );
  }

  const visible =
    statusFilter === "todos"
      ? appointments
      : appointments.filter((a) => a.status === statusFilter);

  const columns: DataTableColumn<Appointment>[] = [
    {
      key: "fecha",
      header: "Fecha",
      sortable: true,
      sortValue: (a) => a.createdAt,
      cellClassName: "text-xs text-stone-500 whitespace-nowrap",
      render: (a) => new Date(a.createdAt).toLocaleString(),
    },
    {
      key: "nombre",
      header: "Nombre",
      truncate: true,
      render: (a) =>
        a.name ?? a.customerName ?? <span className="text-stone-400">—</span>,
    },
    {
      key: "telefono",
      header: "Teléfono",
      render: (a) => (
        <span className="text-stone-500">{a.phone ?? a.customerPhone ?? "—"}</span>
      ),
    },
    {
      key: "email",
      header: "Email",
      truncate: true,
      render: (a) => (
        <span className="text-stone-500">{a.email ?? a.customerEmail ?? "—"}</span>
      ),
    },
    {
      key: "motivo",
      header: "Motivo",
      truncate: true,
      render: (a) => a.reason,
    },
    {
      key: "estado",
      header: "Estado",
      render: (a) => (
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.status] ?? STATUS_BADGE.pendiente}`}
        >
          {STATUS_LABEL[a.status] ?? a.status}
        </span>
      ),
    },
    {
      key: "notas",
      header: "Notas",
      render: (a) =>
        editingNotesId === a.id ? (
          <span className="flex items-center gap-1">
            <input
              aria-label={`Notas de la cita ${a.id}`}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              className="w-40 border border-stone-300 px-2 py-1 text-xs bg-white"
            />
            <button
              type="button"
              onClick={() => void saveNotes(a.id)}
              className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setEditingNotesId(null)}
              className="text-xs text-stone-500 hover:text-stone-700"
            >
              Cancelar
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="text-xs text-stone-600">{a.notes || "—"}</span>
            <button
              type="button"
              onClick={() => {
                setEditingNotesId(a.id);
                setNotesDraft(a.notes ?? "");
              }}
              className="text-xs text-emerald-700 hover:text-emerald-900 hover:underline"
            >
              Editar notas
            </button>
          </span>
        ),
    },
    {
      key: "cliente",
      header: "Cliente vinculado",
      render: (a) =>
        a.customerId == null ? (
          // Landing row: no customer behind it (customer_id NULL)
          <span
            className="text-stone-400"
            title="Solicitud pública del landing — sin cliente vinculado"
          >
            —
          </span>
        ) : (
          // The payload has no customer NAME (raw select, no join) → id link
          <Link
            to={`/admin/customers/${a.customerId}`}
            className="text-xs text-emerald-700 hover:text-emerald-900 hover:underline"
          >
            Cliente #{a.customerId}
          </Link>
        ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      render: (a) => (
        <select
          aria-label={`Cambiar estado de la cita ${a.id}`}
          value={a.status}
          disabled={savingStatusId === a.id}
          onChange={(e) =>
            void changeStatus(a.id, e.target.value as AppointmentStatus)
          }
          className="border border-stone-300 px-2 py-1 text-xs bg-white"
        >
          {APPOINTMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      ),
    },
  ];

  return (
    <div>
      <h1 className="font-serif text-2xl">Citas</h1>
      <p className="mt-1 text-sm text-stone-500">
        Solicitudes de cita de tamizaje: las que llegan desde el formulario
        del landing, las del chat del cliente y cualquier cambio hecho en la
        ficha. Cambiá el estado o agregá notas de seguimiento.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label
          htmlFor="appt-status-filter"
          className="text-xs font-medium text-stone-600"
        >
          Filtrar por estado
        </label>
        <select
          id="appt-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="border border-stone-300 px-3 py-2 text-sm bg-white"
        >
          <option value="todos">Todos</option>
          {APPOINTMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="text-xs text-stone-400">
          {visible.length} de {appointments.length} citas
        </span>
      </div>

      {appointments.length === 0 ? (
        <div className="mt-6 bg-stone-50 rounded-xl border border-stone-200 p-8 text-center">
          <p className="text-stone-500">No hay citas solicitadas todavía.</p>
          <p className="text-xs text-stone-400 mt-1">
            Las solicitudes que llegan desde el formulario del landing
            (Booking) y las del chat del cliente aparecen aquí.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-6 text-sm text-stone-500">
          No hay citas con estado «{STATUS_LABEL[statusFilter as AppointmentStatus]}».
        </p>
      ) : (
        <div className="mt-6">
          <DataTable
            columns={columns}
            rows={visible}
            getRowKey={(a) => String(a.id)}
            emptyMessage="No hay citas solicitadas todavía."
            containerClassName="bg-white border border-stone-200"
            tableClassName="min-w-[1040px]"
          />
        </div>
      )}
    </div>
  );
}
