import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  api,
  BODY_METRIC_FIELDS,
  type Appointment,
  type AppointmentStatus,
  type BodyMetric,
  type BodyMetricField,
  type BodyMetricInput,
  type CustomerImage,
  type ImageKind,
} from "./api";
import { ErrorBanner, toErrorState, type ErrorState } from "./ErrorBanner";
import { ImageWithFallback } from "../components/figma/ImageWithFallback";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

/**
 * T3 (tamizaje-images, S2/S3) — the three screening sections appended to the
 * customer ficha: Cloudinary image history (grid + lightbox + base64 upload),
 * body-metrics (latest/newest-first record + quick form) and the appointment
 * requests with their CRM status machine.
 *
 * Loading precedent: the per-customer lists come from their own endpoints and
 * the appointments from the GLOBAL `GET /admin/appointments` filtered here by
 * customerId — the same client-side filtering the ficha uses for
 * recommendations/purchases/conversations (there is no per-customer
 * appointments endpoint).
 */

const PRIMARY_BUTTON =
  "px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed";
const INPUT = "mt-1 w-full border border-stone-300 px-3 py-2 text-sm bg-white";

const KIND_LABEL: Record<ImageKind, string> = {
  tamizaje: "Tamizaje",
  evolucion: "Evolución",
  otro: "Otro",
};
const KIND_BADGE: Record<ImageKind, string> = {
  tamizaje: "bg-emerald-100 text-emerald-800",
  evolucion: "bg-blue-100 text-blue-700",
  otro: "bg-stone-100 text-stone-600",
};

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
/** Badge colors per the task spec: amber / blue / green / stone. */
const STATUS_BADGE: Record<AppointmentStatus, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  contactada: "bg-blue-100 text-blue-700",
  agendada: "bg-green-100 text-green-700",
  cancelada: "bg-stone-100 text-stone-600",
};

/** Row property (camelCase, GET) for one of the 17 wire fields. */
type MetricValueKey = Exclude<
  keyof BodyMetric,
  "id" | "customerId" | "measuredAt" | "source" | "notes" | "createdAt"
>;

interface MetricFieldDef {
  field: BodyMetricField; // wire name (snake_case, POST body)
  key: MetricValueKey; // row property (camelCase, GET response)
  label: string;
  unit?: string;
}

/** Spanish labels for the 17 RENPHO-style fields (badge + form share them). */
const METRIC_FIELDS: MetricFieldDef[] = [
  { field: "weight_kg", key: "weightKg", label: "Peso", unit: "kg" },
  { field: "bmi", key: "bmi", label: "IMC" },
  { field: "body_fat_pct", key: "bodyFatPct", label: "Grasa corporal", unit: "%" },
  { field: "fat_mass_kg", key: "fatMassKg", label: "Masa de grasa", unit: "kg" },
  {
    field: "subcutaneous_fat_pct",
    key: "subcutaneousFatPct",
    label: "Grasa subcutánea",
    unit: "%",
  },
  { field: "visceral_fat", key: "visceralFat", label: "Grasa visceral" },
  { field: "muscle_pct", key: "musclePct", label: "Músculo", unit: "%" },
  { field: "muscle_mass_kg", key: "muscleMassKg", label: "Masa muscular", unit: "kg" },
  {
    field: "skeletal_muscle_pct",
    key: "skeletalMusclePct",
    label: "Músculo esquelético",
    unit: "%",
  },
  {
    field: "skeletal_muscle_mass_kg",
    key: "skeletalMuscleMassKg",
    label: "Masa muscular esquelética",
    unit: "kg",
  },
  { field: "bone_pct", key: "bonePct", label: "Hueso", unit: "%" },
  { field: "bone_mass_kg", key: "boneMassKg", label: "Masa ósea", unit: "kg" },
  {
    field: "fat_free_mass_kg",
    key: "fatFreeMassKg",
    label: "Masa libre de grasa",
    unit: "kg",
  },
  { field: "metabolic_age", key: "metabolicAge", label: "Edad metabólica" },
  { field: "bmr_kcal", key: "bmrKcal", label: "BMR", unit: "kcal" },
  { field: "water_pct", key: "waterPct", label: "Agua", unit: "%" },
  { field: "protein_pct", key: "proteinPct", label: "Proteína", unit: "%" },
];

/** "2026-01-10" → fecha local; un timestamp ISO → fecha y hora local. */
function formatDateTime(value: string): string {
  const dateOnly = value.length <= 10;
  const date = dateOnly ? new Date(`${value}T00:00:00`) : new Date(value);
  return dateOnly ? date.toLocaleDateString() : date.toLocaleString();
}

/** File → data URI (the wire `data` field the backend proxy accepts). */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function emptyMetricForm(): Record<BodyMetricField, string> {
  return Object.fromEntries(
    BODY_METRIC_FIELDS.map((f) => [f, ""]),
  ) as Record<BodyMetricField, string>;
}

interface ScreeningData {
  images: CustomerImage[];
  bodyMetrics: BodyMetric[];
  appointments: Appointment[];
}

export function CustomerScreening({ customerId }: { customerId: number }) {
  const [data, setData] = useState<ScreeningData | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [reload, setReload] = useState(0);

  // Upload form
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadKind, setUploadKind] = useState<ImageKind>("tamizaje");
  const [uploadTakenAt, setUploadTakenAt] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Lightbox
  const [lightbox, setLightbox] = useState<CustomerImage | null>(null);

  // Quick metrics form
  const [metricDate, setMetricDate] = useState("");
  const [metricForm, setMetricForm] = useState<Record<BodyMetricField, string>>(
    emptyMetricForm,
  );
  const [savingMetric, setSavingMetric] = useState(false);

  // Status changer (one select in flight at a time)
  const [savingStatusId, setSavingStatusId] = useState<number | null>(null);

  // All three lists together; appointments filtered client-side (see docblock).
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.listCustomerImages(customerId),
      api.listCustomerBodyMetrics(customerId),
      api.listAppointments(),
    ])
      .then(([images, metrics, appointments]) => {
        if (cancelled) return;
        setData({
          images: [...images.images].sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
          ),
          // Newest measured_at first (the wire may send any order).
          bodyMetrics: [...metrics.bodyMetrics].sort(
            (a, b) => b.measuredAt.localeCompare(a.measuredAt) || b.id - a.id,
          ),
          appointments: appointments.appointments
            .filter((a) => a.customerId === customerId)
            .sort((a, b) => b.id - a.id),
        });
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(toErrorState(e));
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, reload]);

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    try {
      const payload = await readAsDataUrl(uploadFile);
      await api.uploadCustomerImage(customerId, {
        data: payload,
        kind: uploadKind,
        ...(uploadTakenAt ? { taken_at: uploadTakenAt } : {}),
        ...(uploadNotes.trim() ? { notes: uploadNotes.trim() } : {}),
      });
      toast.success("Imagen subida");
      setUploadFile(null);
      setUploadTakenAt("");
      setUploadNotes("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(`No se pudo subir la imagen: ${toErrorState(e).detail}`);
    } finally {
      setUploading(false);
    }
  };

  const handleMetricSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload: BodyMetricInput = { measured_at: metricDate };
    for (const { field } of METRIC_FIELDS) {
      const raw = metricForm[field].trim();
      if (raw === "") continue; // partial records are valid by design
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        toast.error(`No se pudo guardar la medición: ${field} debe ser un número`);
        return;
      }
      payload[field] = num;
    }
    setSavingMetric(true);
    try {
      await api.createCustomerBodyMetric(customerId, payload);
      toast.success("Medición guardada");
      setMetricDate("");
      setMetricForm(emptyMetricForm());
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(`No se pudo guardar la medición: ${toErrorState(e).detail}`);
    } finally {
      setSavingMetric(false);
    }
  };

  const changeStatus = async (id: number, status: AppointmentStatus) => {
    setSavingStatusId(id);
    try {
      const res = await api.updateAppointment(id, { status });
      setData((prev) =>
        prev
          ? {
              ...prev,
              appointments: prev.appointments.map((a) =>
                a.id === id ? res.appointment : a,
              ),
            }
          : prev,
      );
      toast.success("Estado de la cita actualizado");
    } catch (e) {
      toast.error(`No se pudo actualizar la cita: ${toErrorState(e).detail}`);
    } finally {
      setSavingStatusId(null);
    }
  };

  if (error) {
    return (
      <div className="mt-6">
        <ErrorBanner
          status={error.status}
          detail={error.detail}
          title={error.title}
          onRetry={() => setReload((n) => n + 1)}
        />
      </div>
    );
  }
  if (!data) {
    return <p className="mt-6 text-sm text-stone-500">Cargando tamizaje…</p>;
  }

  return (
    <div className="mt-6 space-y-6">
      {/* S2 — Cloudinary history: thumbnails + lightbox + base64 upload */}
      <section>
        <h2 className="font-serif text-lg">Tamizaje e imágenes</h2>
        {data.images.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            Sin imágenes registradas.
          </p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {data.images.map((img) => {
              const label = KIND_LABEL[img.kind] ?? img.kind;
              return (
                <li
                  key={img.id}
                  className="border border-stone-200 bg-white overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setLightbox(img)}
                    className="block w-full"
                  >
                    <ImageWithFallback
                      src={img.cloudinarySecureUrl}
                      alt={`Imagen de ${label}`}
                      className="w-full h-32 object-cover bg-stone-100"
                    />
                  </button>
                  <div className="p-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${KIND_BADGE[img.kind] ?? KIND_BADGE.otro}`}
                    >
                      {label}
                    </span>
                    <p className="mt-1 text-xs text-stone-500">
                      {formatDateTime(img.takenAt ?? img.createdAt)}
                    </p>
                    {img.notes && (
                      <p className="mt-1 text-xs text-stone-600 break-words">
                        {img.notes}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={handleUpload}
          noValidate
          className="mt-3 p-4 border border-stone-200 bg-stone-50 space-y-3"
        >
          <div className="flex flex-wrap items-end gap-3">
            <label
              htmlFor="screening-image-file"
              className="block text-xs font-medium text-stone-600"
            >
              Imagen (JPG/PNG, máx. 8 MB)
            </label>
            <input
              ref={fileInputRef}
              id="screening-image-file"
              type="file"
              accept="image/*"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              className="block w-56 text-sm text-stone-700"
            />
            <label
              htmlFor="screening-image-kind"
              className="block text-xs font-medium text-stone-600"
            >
              Tipo
            </label>
            <select
              id="screening-image-kind"
              value={uploadKind}
              onChange={(e) => setUploadKind(e.target.value as ImageKind)}
              className="w-36 border border-stone-300 px-3 py-2 text-sm bg-white"
            >
              <option value="tamizaje">Tamizaje</option>
              <option value="evolucion">Evolución</option>
              <option value="otro">Otro</option>
            </select>
            <label
              htmlFor="screening-image-taken"
              className="block text-xs font-medium text-stone-600"
            >
              Fecha del reporte (opcional)
            </label>
            <input
              id="screening-image-taken"
              type="date"
              value={uploadTakenAt}
              onChange={(e) => setUploadTakenAt(e.target.value)}
              className={`${INPUT} w-40`}
            />
            <label
              htmlFor="screening-image-notes"
              className="block grow text-xs font-medium text-stone-600"
            >
              Notas (opcional)
            </label>
            <input
              id="screening-image-notes"
              type="text"
              value={uploadNotes}
              onChange={(e) => setUploadNotes(e.target.value)}
              placeholder="Ej. Escaneo RENPHO del 10/01"
              className={INPUT}
            />
          </div>
          <button
            type="submit"
            disabled={!uploadFile || uploading}
            className={PRIMARY_BUTTON}
          >
            {uploading ? "Subiendo…" : "Subir imagen"}
          </button>
        </form>

        {lightbox && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setLightbox(null);
            }}
          >
            <DialogContent className="sm:max-w-3xl bg-white">
              <DialogHeader>
                <DialogTitle>{`Imagen de ${KIND_LABEL[lightbox.kind] ?? lightbox.kind}`}</DialogTitle>
              </DialogHeader>
              <ImageWithFallback
                src={lightbox.cloudinarySecureUrl}
                alt={`Imagen de ${KIND_LABEL[lightbox.kind] ?? lightbox.kind}`}
                className="w-full max-h-[65vh] object-contain bg-stone-100"
              />
              <p className="text-xs text-stone-500">
                {formatDateTime(lightbox.takenAt ?? lightbox.createdAt)}
              </p>
              {lightbox.notes && (
                <p className="text-sm text-stone-600">{lightbox.notes}</p>
              )}
            </DialogContent>
          </Dialog>
        )}
      </section>

      {/* S1 — optional, never-blocking record: newest-first list + alta rápida */}
      <section>
        <h2 className="font-serif text-lg">Métricas corporales</h2>
        {data.bodyMetrics.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            Sin métricas registradas.
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {data.bodyMetrics.map((metric, index) => (
              <li
                key={metric.id}
                className="p-3 bg-white border border-stone-200"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3">
                  <span className="text-sm font-medium">
                    {formatDateTime(metric.measuredAt)}
                    {index === 0 && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                        Última
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-stone-500">
                    Fuente: {metric.source}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {METRIC_FIELDS.map(({ key, label, unit }) => {
                    const value = metric[key];
                    if (value == null) return null; // nulls skipped by design
                    return (
                      <span
                        key={key}
                        className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 text-xs font-medium"
                      >
                        {label}
                        {unit ? ` (${unit})` : ""}: {value}
                      </span>
                    );
                  })}
                  {METRIC_FIELDS.every(({ key }) => metric[key] == null) && (
                    <span className="text-xs text-stone-500">
                      Sin datos numéricos en este registro.
                    </span>
                  )}
                </div>
                {metric.notes && (
                  <p className="mt-1 text-xs text-stone-600">{metric.notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={handleMetricSubmit}
          noValidate
          className="mt-3 p-4 border border-stone-200 bg-stone-50 space-y-3"
        >
          <h3 className="text-sm font-semibold text-stone-700">
            Registrar medición
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="block text-xs font-medium text-stone-600">
              Fecha de medición
              <input
                type="date"
                required
                value={metricDate}
                onChange={(e) => setMetricDate(e.target.value)}
                className={INPUT}
              />
            </label>
            {METRIC_FIELDS.map(({ field, label, unit }) => (
              <label
                key={field}
                className="block text-xs font-medium text-stone-600"
              >
                {label}
                {unit ? ` (${unit})` : ""}
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={metricForm[field]}
                  onChange={(e) =>
                    setMetricForm((f) => ({ ...f, [field]: e.target.value }))
                  }
                  placeholder="—"
                  className={INPUT}
                />
              </label>
            ))}
          </div>
          <button
            type="submit"
            disabled={savingMetric}
            className={PRIMARY_BUTTON}
          >
            {savingMetric ? "Guardando…" : "Guardar medición"}
          </button>
        </form>
      </section>

      {/* S3 — global list filtered here + the CRM status machine */}
      <section>
        <h2 className="font-serif text-lg">Citas</h2>
        {data.appointments.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Sin citas solicitadas.</p>
        ) : (
          <ul className="mt-2 border border-stone-200 divide-y divide-stone-100">
            {data.appointments.map((a) => (
              <li key={a.id} className="px-4 py-3 bg-white text-sm">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">{a.reason}</span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.status] ?? STATUS_BADGE.pendiente}`}
                  >
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
                {a.notes && (
                  <p className="mt-1 text-xs text-stone-600">{a.notes}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs text-stone-500">
                    Solicitada el {formatDateTime(a.createdAt)}
                  </span>
                  <label
                    htmlFor={`appt-status-${a.id}`}
                    className="text-xs text-stone-500"
                  >
                    Estado
                  </label>
                  <select
                    id={`appt-status-${a.id}`}
                    value={a.status}
                    disabled={savingStatusId === a.id}
                    onChange={(e) =>
                      changeStatus(a.id, e.target.value as AppointmentStatus)
                    }
                    className="border border-stone-300 px-2 py-1 text-xs bg-white"
                  >
                    {APPOINTMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
