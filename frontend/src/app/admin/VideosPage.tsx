import { useCallback, useEffect, useState } from "react";
import { formatTime } from "../lib/format";
import { DataTable, type DataTableColumn } from "./DataTable";
import {
  api,
  Video,
  VideoSegment,
  SegmentPatch,
  VideoStatus,
} from "./api";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

const STATUS_LABELS: Record<VideoStatus, string> = {
  draft: "Borrador",
  analyzed: "Analizado",
  cut: "Cortado",
  published: "Publicado",
};

const STATUS_CHIPS: Record<VideoStatus, string> = {
  draft: "bg-stone-100 text-stone-600",
  analyzed: "bg-blue-100 text-blue-700",
  cut: "bg-amber-100 text-amber-700",
  published: "bg-emerald-100 text-emerald-800",
};

interface VideoFormState {
  speaker: string;
  url: string;
  title: string;
}

const EMPTY_VIDEO_FORM: VideoFormState = { speaker: "", url: "", title: "" };

interface SegmentFormState {
  videoId: string;
  startS: string;
  endS: string;
  title: string;
  summary: string;
  condition: string;
  symptomId: string;
  clipYoutubeId: string; // solo en edición
}

function emptySegmentForm(videoId: number | null): SegmentFormState {
  return {
    videoId: videoId == null ? "" : String(videoId),
    startS: "",
    endS: "",
    title: "",
    summary: "",
    condition: "",
    symptomId: "",
    clipYoutubeId: "",
  };
}

/**
 * "Vídeos educativos": biblioteca de vídeos analizados por el pipeline y sus
 * segmentos por condición. Los segmentos `enabled=1` se inyectan en el chat
 * (citados con [VIDEO:id]); los `condition=null` necesitan asignación de
 * síntoma antes de aprobarse. Mantenimiento interno: tablas + formularios
 * simples, sin estado elaborado.
 */
export function VideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [videoForm, setVideoForm] = useState<VideoFormState | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [segmentForm, setSegmentForm] = useState<SegmentFormState | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const [confirmVideo, setConfirmVideo] = useState<Video | null>(null);
  const [confirmSegment, setConfirmSegment] = useState<VideoSegment | null>(null);

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([api.listVideos(), api.listVideoSegments()]);
      setVideos(v.videos);
      setSegments(s.segments);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const videoTitle = (id: string) =>
    videos.find((v) => String(v.id) === id)?.title ?? `vídeo #${id}`;

  const visibleSegments =
    selectedVideoId == null
      ? segments
      : segments.filter((s) => s.videoId === selectedVideoId);

  // ─── Vídeos ──────────────────────────────────────────────────────

  function startVideoCreate() {
    setVideoForm(EMPTY_VIDEO_FORM);
    setError(null);
  }

  async function handleVideoSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoForm) return;
    const speaker = videoForm.speaker.trim();
    const url = videoForm.url.trim();
    const title = videoForm.title.trim();
    if (!speaker || !url || !title) {
      setError("Ponente, URL y título son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      await api.createVideo({ speaker, url, title });
      setVideoForm(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear el vídeo");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteVideo(row: Video) {
    try {
      await api.deleteVideo(row.id);
      await load();
      // El vídeo filtrado ya no existe: limpiar el filtro para no dejar una
      // selección fantasma (el select y la cabecera «para este vídeo»).
      if (selectedVideoId === row.id) setSelectedVideoId(null);
    } catch (err) {
      // El 409 (el vídeo aún tiene segmentos) se muestra tal cual, sin tragarse
      setError(err instanceof Error ? err.message : "Error al eliminar el vídeo");
    }
  }

  // ─── Segmentos ───────────────────────────────────────────────────

  function startSegmentCreate() {
    setEditingSegmentId(null);
    setSegmentForm(emptySegmentForm(selectedVideoId));
    setError(null);
  }

  function startSegmentEdit(row: VideoSegment) {
    setEditingSegmentId(row.id);
    setSegmentForm({
      videoId: String(row.videoId),
      startS: String(row.startS),
      endS: String(row.endS),
      title: row.title,
      summary: row.summary,
      condition: row.condition ?? "",
      symptomId: row.symptomId == null ? "" : String(row.symptomId),
      clipYoutubeId: row.clipYoutubeId ?? "",
    });
    setError(null);
  }

  async function handleSegmentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!segmentForm) return;
    const title = segmentForm.title.trim();
    const startS = Number(segmentForm.startS);
    const endS = Number(segmentForm.endS);
    if (!title) {
      setError("El título del segmento es obligatorio.");
      return;
    }
    if (!Number.isInteger(startS) || !Number.isInteger(endS) || startS < 0 || endS <= startS) {
      setError("Las marcas deben cumplir 0 ≤ inicio < fin (segundos enteros).");
      return;
    }
    const videoId = Number(segmentForm.videoId);
    if (editingSegmentId == null && !Number.isInteger(videoId)) {
      setError("Selecciona el vídeo al que pertenece el segmento.");
      return;
    }
    const symptomRaw = segmentForm.symptomId.trim();
    if (symptomRaw && !/^\d+$/.test(symptomRaw)) {
      setError("El ID de síntoma debe ser un número entero.");
      return;
    }
    setSaving(true);
    try {
      if (editingSegmentId == null) {
        await api.createVideoSegment({
          videoId,
          startS,
          endS,
          title,
          summary: segmentForm.summary,
          ...(segmentForm.condition.trim() ? { condition: segmentForm.condition.trim() } : {}),
          ...(symptomRaw ? { symptomId: Number(symptomRaw) } : {}),
        });
      } else {
        const patch: SegmentPatch = { title, startS, endS, summary: segmentForm.summary };
        if (symptomRaw) {
          // El backend da prioridad a symptomId sobre el texto libre
          patch.symptomId = Number(symptomRaw);
        } else {
          // Texto vacío al editar → se envía "" y el backend limpia la condición (null)
          patch.condition = segmentForm.condition.trim();
        }
        // Clip: vacío → null explícito (borra el clip y vuelve al enlace profundo)
        patch.clipYoutubeId = segmentForm.clipYoutubeId.trim() || null;
        await api.updateVideoSegment(editingSegmentId, patch);
      }
      setSegmentForm(null);
      setEditingSegmentId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el segmento");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleSegment(row: VideoSegment) {
    try {
      await api.updateVideoSegment(row.id, { enabled: row.enabled === 1 ? 0 : 1 });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cambiar el estado");
    }
  }

  async function handleDeleteSegment(row: VideoSegment) {
    try {
      await api.deleteVideoSegment(row.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar el segmento");
    }
  }

  if (loading) return <p className="text-stone-500">Cargando…</p>;

  const videoColumns: DataTableColumn<Video>[] = [
    { key: "speaker", header: "Ponente", sortable: true, render: (v) => v.speaker },
    {
      key: "title",
      header: "Título",
      sortable: true,
      cellClassName: "font-medium",
      render: (v) => (
        <>
          {v.title}
          <span className="block text-xs text-stone-400 font-mono">{v.url}</span>
        </>
      ),
    },
    {
      key: "status",
      header: "Estado",
      sortable: true,
      render: (v) => (
        <span
          className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
            STATUS_CHIPS[v.status] ?? "bg-stone-100 text-stone-600"
          }`}
        >
          {STATUS_LABELS[v.status] ?? v.status}
        </span>
      ),
    },
    {
      key: "license",
      header: "Licencia",
      sortable: true,
      cellClassName: "max-w-xs",
      render: (v) =>
        v.licenseNote ? (
          <span className="text-stone-600">{v.licenseNote}</span>
        ) : (
          <span className="text-stone-400">—</span>
        ),
    },
    {
      key: "accion",
      header: "Acción",
      align: "right",
      render: (v) => (
        <button
          onClick={() => setConfirmVideo(v)}
          className="text-red-700 hover:underline"
        >
          Eliminar
        </button>
      ),
    },
  ];

  const segmentColumns: DataTableColumn<VideoSegment>[] = [
    {
      key: "video",
      header: "Vídeo",
      sortable: true,
      sortValue: (s) => videoTitle(String(s.videoId)),
      render: (s) => videoTitle(String(s.videoId)),
    },
    {
      key: "title",
      header: "Título",
      sortable: true,
      cellClassName: "font-medium",
      render: (s) => s.title,
    },
    {
      key: "condition",
      header: "Condición",
      sortable: true,
      render: (s) =>
        s.condition ? (
          <span>{s.condition}</span>
        ) : (
          <span className="text-amber-700 font-medium">sin condición</span>
        ),
    },
    {
      key: "marca",
      header: "Marca",
      sortable: true,
      sortValue: (s) => s.startS,
      cellClassName: "font-mono text-xs",
      render: (s) => (
        <>
          {formatTime(s.startS)} – {formatTime(s.endS)}
        </>
      ),
    },
    {
      key: "enabled",
      header: "Estado",
      sortable: true,
      render: (s) => (
        <button
          onClick={() => handleToggleSegment(s)}
          title={
            s.enabled === 1
              ? "Desactivar segmento (no se inyecta en el chat)"
              : "Activar segmento (se inyecta en el chat)"
          }
          className={`px-2 py-1 text-xs ${
            s.enabled === 1
              ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
              : "bg-stone-200 text-stone-500 hover:bg-stone-300"
          }`}
        >
          {s.enabled === 1 ? "Activo" : "Inactivo"}
        </button>
      ),
    },
    {
      key: "clip",
      header: "Clip",
      sortable: true,
      cellClassName: "font-mono text-xs",
      render: (s) =>
        s.clipYoutubeId ? (
          s.clipYoutubeId
        ) : (
          <span className="text-stone-400">—</span>
        ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      cellClassName: "whitespace-nowrap",
      render: (s) => (
        <>
          <button
            onClick={() => startSegmentEdit(s)}
            className="text-emerald-800 hover:underline mr-3"
          >
            Editar
          </button>
          <button
            onClick={() => setConfirmSegment(s)}
            className="text-red-700 hover:underline"
          >
            Eliminar
          </button>
        </>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl">Vídeos educativos</h1>
          <p className="mt-1 text-sm text-stone-500">
            Biblioteca de vídeos analizados y sus segmentos por condición. Solo los segmentos
            activos se citan en el chat; sin permiso de uso el enlace apunta al vídeo original.
          </p>
        </div>
        <button
          onClick={startVideoCreate}
          className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800"
        >
          Nuevo vídeo
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {videoForm && (
        <form
          onSubmit={handleVideoSubmit}
          noValidate
          className="mt-6 p-6 bg-white border border-stone-200 space-y-4"
        >
          <h2 className="font-serif text-lg">Nuevo vídeo</h2>
          <label className="block text-sm">
            Ponente
            <input
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              value={videoForm.speaker}
              onChange={(e) => setVideoForm((f) => (f ? { ...f, speaker: e.target.value } : f))}
              placeholder="Ej. Luis Collantes"
            />
          </label>
          <label className="block text-sm">
            URL de YouTube
            <input
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              value={videoForm.url}
              onChange={(e) => setVideoForm((f) => (f ? { ...f, url: e.target.value } : f))}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </label>
          <label className="block text-sm">
            Título
            <input
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              value={videoForm.title}
              onChange={(e) => setVideoForm((f) => (f ? { ...f, title: e.target.value } : f))}
              placeholder="Título del vídeo original"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Crear vídeo"}
            </button>
            <button
              type="button"
              onClick={() => {
                setVideoForm(null);
                setError(null);
              }}
              className="px-4 py-2 border border-stone-300 text-stone-600 text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <DataTable
        columns={videoColumns}
        rows={videos}
        getRowKey={(v) => String(v.id)}
        emptyMessage="No hay vídeos registrados. Crea el primero para empezar a analizar segmentos."
        containerClassName="mt-6 bg-white border border-stone-200"
        rowClassName="align-top"
      />

      {/* Segmentos */}
      <div className="mt-8">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-serif text-xl">Segmentos</h2>
            <p className="mt-1 text-sm text-stone-500">
              Excerpts temporizados por condición. Los segmentos <strong>activos</strong> se
              inyectan en el chat; los que están <em>sin condición</em> necesitan asignación de
              síntoma antes de aprobarse.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <label className="block text-xs text-stone-600">
              Filtrar por vídeo
              <select
                value={selectedVideoId == null ? "" : String(selectedVideoId)}
                onChange={(e) => {
                  setSelectedVideoId(e.target.value === "" ? null : Number(e.target.value));
                  setError(null);
                }}
                className="mt-1 block border border-stone-300 px-3 py-2 bg-white text-sm text-stone-800"
              >
                <option value="">Todos los vídeos</option>
                {videos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={startSegmentCreate}
              className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800"
            >
              Nuevo segmento
            </button>
          </div>
        </div>

        {segmentForm && (
          <form
            onSubmit={handleSegmentSubmit}
            noValidate
            className="mt-4 p-6 bg-white border border-stone-200 space-y-4"
          >
            <h3 className="font-serif text-lg">
              {editingSegmentId == null ? "Nuevo segmento" : `Editar segmento #${editingSegmentId}`}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {editingSegmentId == null ? (
                <label className="block text-sm">
                  Vídeo
                  <select
                    value={segmentForm.videoId}
                    onChange={(e) =>
                      setSegmentForm((f) => (f ? { ...f, videoId: e.target.value } : f))
                    }
                    className="mt-1 w-full border border-stone-300 px-3 py-2 bg-white"
                  >
                    <option value="">Seleccionar…</option>
                    {videos.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.speaker} — {v.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-sm text-stone-600">
                  Vídeo: <span className="font-medium">{videoTitle(segmentForm.videoId)}</span>
                </p>
              )}
              <label className="block text-sm">
                Título del segmento
                <input
                  className="mt-1 w-full border border-stone-300 px-3 py-2"
                  value={segmentForm.title}
                  onChange={(e) =>
                    setSegmentForm((f) => (f ? { ...f, title: e.target.value } : f))
                  }
                  placeholder="Ej. Introducción a la vitamina D"
                />
              </label>
              <label className="block text-sm">
                Inicio (s)
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full border border-stone-300 px-3 py-2"
                  value={segmentForm.startS}
                  onChange={(e) =>
                    setSegmentForm((f) => (f ? { ...f, startS: e.target.value } : f))
                  }
                />
              </label>
              <label className="block text-sm">
                Fin (s)
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full border border-stone-300 px-3 py-2"
                  value={segmentForm.endS}
                  onChange={(e) =>
                    setSegmentForm((f) => (f ? { ...f, endS: e.target.value } : f))
                  }
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                Resumen
                <textarea
                  rows={2}
                  className="mt-1 w-full border border-stone-300 px-3 py-2"
                  value={segmentForm.summary}
                  onChange={(e) =>
                    setSegmentForm((f) => (f ? { ...f, summary: e.target.value } : f))
                  }
                />
              </label>
              <label className="block text-sm">
                Condición (texto libre)
                <input
                  className="mt-1 w-full border border-stone-300 px-3 py-2"
                  value={segmentForm.condition}
                  onChange={(e) =>
                    setSegmentForm((f) => (f ? { ...f, condition: e.target.value } : f))
                  }
                  placeholder="Ej. dolor óseo"
                />
                <span className="block mt-1 text-xs text-stone-400">
                  Se normaliza contra el vocabulario de la evaluación. Vaciar y guardar borra la
                  condición (queda «sin condición»).
                </span>
              </label>
              <label className="block text-sm">
                ID síntoma (opcional)
                <input
                  type="number"
                  className="mt-1 w-full border border-stone-300 px-3 py-2"
                  value={segmentForm.symptomId}
                  onChange={(e) =>
                    setSegmentForm((f) => (f ? { ...f, symptomId: e.target.value } : f))
                  }
                  placeholder="Ej. 12"
                />
                <span className="block mt-1 text-xs text-stone-400">
                  Tiene prioridad sobre el texto libre.
                </span>
              </label>
              {editingSegmentId != null && (
                <label className="block text-sm sm:col-span-2">
                  ID clip en YouTube (opcional)
                  <input
                    className="mt-1 w-full border border-stone-300 px-3 py-2"
                    value={segmentForm.clipYoutubeId}
                    onChange={(e) =>
                      setSegmentForm((f) => (f ? { ...f, clipYoutubeId: e.target.value } : f))
                    }
                    placeholder="Sin clip — enlace al vídeo original"
                  />
                  <span className="block mt-1 text-xs text-stone-400">
                    Solo sube clips tras permiso escrito (docs/video-permissions.md). Guardar
                    vacío borra el clip.
                  </span>
                </label>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800 disabled:opacity-50"
              >
                {saving
                  ? "Guardando…"
                  : editingSegmentId == null
                    ? "Crear segmento"
                    : "Guardar cambios"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSegmentForm(null);
                  setEditingSegmentId(null);
                  setError(null);
                }}
                className="px-4 py-2 border border-stone-300 text-stone-600 text-sm"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        <DataTable
          columns={segmentColumns}
          rows={visibleSegments}
          getRowKey={(s) => String(s.id)}
          emptyMessage={
            selectedVideoId != null
              ? "No hay segmentos para este vídeo. El analizador del pipeline los crea; aquí se revisan y aprueban."
              : "No hay segmentos. El analizador del pipeline los crea; aquí se revisan y aprueban."
          }
          containerClassName="mt-4 bg-white border border-stone-200"
          rowClassName="align-top"
        />
      </div>
      <ConfirmActionDialog
        open={confirmVideo !== null}
        title={confirmVideo ? `¿Eliminar el vídeo "${confirmVideo.title}"?` : ""}
        description="Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => {
          const row = confirmVideo;
          setConfirmVideo(null);
          if (row) void handleDeleteVideo(row);
        }}
        onCancel={() => setConfirmVideo(null)}
      />
      <ConfirmActionDialog
        open={confirmSegment !== null}
        title={confirmSegment ? `¿Eliminar el segmento "${confirmSegment.title}"?` : ""}
        description="Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => {
          const row = confirmSegment;
          setConfirmSegment(null);
          if (row) void handleDeleteSegment(row);
        }}
        onCancel={() => setConfirmSegment(null)}
      />
    </div>
  );
}
