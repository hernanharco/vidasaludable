import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatTime, youtubeTimestampUrl } from "../lib/format";
import { DataTable, type DataTableColumn } from "./DataTable";
import {
  api,
  Video,
  VideoSegment,
  SegmentPatch,
  VideoStatus,
} from "./api";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

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

/**
 * Error copy for the analyze endpoints — shared by the plain path
 * (`runAnalyze`) and the transcript dialog so both fail identically: the
 * backend messages are already Spanish and ride through verbatim; only the
 * legacy English 409 string is reworded (fix L6).
 */
function analyzeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Error al iniciar el análisis";
  return raw === "analysis already running"
    ? "Ya hay un análisis en curso: espera a que termine antes de reintentar."
    : raw;
}

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
  const [confirmAnalyzeVideo, setConfirmAnalyzeVideo] = useState<Video | null>(null);
  // Option B (json3 transcript): dialog state for analyzing from a
  // pre-acquired transcript instead of server-side yt-dlp acquisition.
  const [transcriptVideo, setTranscriptVideo] = useState<Video | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  // True after the FIRST successful list load — scopes the error-retry poll
  // (fix r2): only a load that never succeeded keeps polling, so inline
  // banners (409, form validation) are never silently eaten by a refresh.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [confirmSegment, setConfirmSegment] = useState<VideoSegment | null>(null);
  // Bulk delete: ids selected via the row checkboxes. Only ids the user
  // actually ticked can be selected — select-all is scoped to the rows the
  // table renders (video filter AND search AND current page, via
  // onRenderedRowsChange), and the selection is pruned on every reload so a
  // deleted/stale id can never inflate the count.
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<number[]>([]);
  const [renderedSegmentIds, setRenderedSegmentIds] = useState<number[]>([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([api.listVideos(), api.listVideoSegments()]);
      setVideos(v.videos);
      setSegments(s.segments);
      // Prune the bulk selection against the fresh list (verify #4): a row
      // deleted singly (or elsewhere) must not linger as a phantom id.
      setSelectedSegmentIds((ids) =>
        ids.filter((id) => s.segments.some((seg) => seg.id === id)),
      );
      setError(null);
      setLoadedOnce(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // admin-video-analyze S1: while any row is 'running', poll the list every
  // 4s until the backend finishes (interval keyed on the boolean, not the
  // videos array — no re-subscribe per refresh; effect cleanup clears it the
  // moment no row reports running).
  const anyAnalysisRunning = videos.some((v) => v.analysisState === "running");
  useEffect(() => {
    // Two reasons to poll in the background:
    // 1. any row is 'running' → until the backend finishes (S1);
    // 2. fix L5: the FIRST load failed (never loaded) → retry until it lands,
    //    so a server-side running job can't stay invisible forever.
    // A set error alone does NOT poll once the list has loaded (fix r2):
    // a background success calls setError(null) and would auto-clear inline
    // banners (409, form validation) seconds after the user read them.
    const needsInitialRecovery = error !== null && !loadedOnce;
    if (!anyAnalysisRunning && !needsInitialRecovery) return;
    const timer = setInterval(() => {
      void load();
    }, 4000);
    return () => clearInterval(timer);
  }, [anyAnalysisRunning, error, loadedOnce, load]);

  const videoTitle = (id: string) =>
    videos.find((v) => String(v.id) === id)?.title ?? `vídeo #${id}`;

  // Marca → deep link into the original video at the segment's start minute,
  // so the operator can watch it in place before deciding its condition.
  // Videos without a youtubeId keep the plain, unlinked range.
  const segmentVideoLink = (seg: VideoSegment): string | null => {
    const video = videos.find((v) => v.id === seg.videoId);
    return video ? youtubeTimestampUrl(video.youtubeId, seg.startS) : null;
  };

  const visibleSegments =
    selectedVideoId == null
      ? segments
      : segments.filter((s) => s.videoId === selectedVideoId);

  // Scoped to what the table ACTUALLY renders (filter + search + page) —
  // never to `visibleSegments`, which ignores the DataTable's internals.
  const allVisibleSelected =
    renderedSegmentIds.length > 0 &&
    renderedSegmentIds.every((id) => selectedSegmentIds.includes(id));

  function toggleSegmentSelection(id: number) {
    setSelectedSegmentIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  function toggleSelectAllVisible() {
    setSelectedSegmentIds(
      renderedSegmentIds.length > 0 &&
        renderedSegmentIds.every((id) => selectedSegmentIds.includes(id))
        ? []
        : renderedSegmentIds,
    );
  }

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

  // ─── admin-video-analyze (S1/S2) ─────────────────────────────────────

  /** Draft → straight to the endpoint; analyzed → confirm first, because a
   * re-analysis replaces every existing segment (S2). */
  function handleAnalyzeClick(v: Video) {
    if (v.status === "analyzed") {
      setConfirmAnalyzeVideo(v);
      return;
    }
    void runAnalyze(v);
  }

  async function runAnalyze(v: Video) {
    try {
      await api.analyzeVideo(v.id);
      await load(); // row shows "Analizando…" → polling takes over
    } catch (err) {
      // 409 single-flight and runtime failures land inline, never silent.
      setError(analyzeErrorMessage(err));
    }
  }

  // ─── admin-video-analyze: transcripción (json3 o panel de YouTube) ────
  // The operator pastes (or uploads) whatever transcript they have — a
  // pre-acquired json3 payload OR the human-readable panel copy — and the
  // dialog routes it automatically, without a mode toggle; yt-dlp is never
  // invoked. The dialog owns its own state: cancelling just drops it, so the
  // video is never touched.

  function openTranscriptDialog(v: Video) {
    setTranscriptVideo(v);
    setTranscriptText("");
    setTranscriptError(null);
  }

  function closeTranscriptDialog() {
    setTranscriptVideo(null);
    setTranscriptText("");
    setTranscriptError(null);
  }

  // A line that is nothing but a YouTube-panel timestamp: M:SS (0:18) or
  // H:MM:SS (1:02:33) — the discriminator for the human-readable panel copy.
  const TIMESTAMP_LINE = /^\d+:\d{2}(:\d{2})?$/;

  type TranscriptInput =
    | { transcript: unknown } // parsed json3 → analyzeVideo(id, parsed)
    | { text: string }; // panel copy → analyzeVideoFromText(id, raw)

  // Client-side decision mirroring the backend's 400s: the operator pastes
  // whatever they have and never picks a mode. A non-null JSON object with an
  // 'events' array takes the json3 payload path (unchanged); otherwise any
  // line that is only a timestamp marks the text as YouTube panel copy (sent
  // verbatim); anything else shows an inline error naming both accepted
  // formats and never reaches the endpoint (the video stays untouched).
  function resolveTranscriptInput(raw: string): TranscriptInput | { error: string } {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {
        error:
          "Pega la transcripción json3 o el texto copiado del panel de YouTube, o carga un archivo.",
      };
    }
    let parsed: unknown;
    let isJson = false;
    try {
      parsed = JSON.parse(trimmed);
      isJson = true;
    } catch {
      // Not JSON — maybe panel copy; decided by the timestamp check below.
    }
    if (
      isJson &&
      parsed !== null &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { events?: unknown }).events)
    ) {
      return { transcript: parsed };
    }
    const looksLikePanelText = trimmed
      .split(/\r?\n/)
      .some((line) => TIMESTAMP_LINE.test(line.trim()));
    if (looksLikePanelText) {
      return { text: raw }; // verbatim — the backend extracts the cues
    }
    return {
      error: isJson
        ? // Mirrors the server's wording: "se espera un objeto json3 con 'events'".
          "Transcripción inválida: se espera un objeto json3 con 'events' — o, en su lugar, el texto del panel de YouTube con líneas de marca de tiempo (M:SS o H:MM:SS)."
        : "El contenido no es JSON válido: pega el json3 (un objeto con 'events') o el texto del panel de YouTube con líneas de marca de tiempo (M:SS o H:MM:SS).",
    };
  }

  // File picker → fills the textarea, so paste and upload share one source.
  async function handleTranscriptFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setTranscriptText(await file.text());
      setTranscriptError(null);
    } catch {
      setTranscriptError("No se pudo leer el archivo. Inténtalo de nuevo.");
    }
  }

  async function handleTranscriptSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transcriptVideo || transcriptBusy) return;
    const check = resolveTranscriptInput(transcriptText);
    if ("error" in check) {
      setTranscriptError(check.error); // inline only — the API is NOT called
      return;
    }
    setTranscriptError(null);
    setTranscriptBusy(true);
    try {
      // Kind decided above: parsed json3 object → today's payload path;
      // panel copy → the raw text posted as { transcriptText }.
      if ("transcript" in check) {
        await api.analyzeVideo(transcriptVideo.id, check.transcript);
      } else {
        await api.analyzeVideoFromText(transcriptVideo.id, check.text);
      }
      closeTranscriptDialog(); // 202 → claimed; load() shows "Analizando…"
      await load();
    } catch (err) {
      // Same treatment as runAnalyze: the server's Spanish message is
      // surfaced verbatim. It is shown in the dialog (readable under the
      // overlay, where the operator can retry) and recorded in the page
      // banner through setError, exactly like the plain path.
      const message = analyzeErrorMessage(err);
      setTranscriptError(message);
      setError(message);
    } finally {
      setTranscriptBusy(false);
    }
  }

  async function handleDeleteVideo(row: Video) {
    try {
      await api.deleteVideo(row.id);
      await load();
      toast.success("Vídeo eliminado");
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
      toast.success("Segmento eliminado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar el segmento");
    }
  }

  async function handleBulkDeleteSelected() {
    const ids = selectedSegmentIds;
    // In-flight guard: a second confirm (or a re-click while the POST runs)
    // must never re-send the same ids and overwrite the toast with a
    // "0 segmentos eliminados" from the duplicate's zero-row result.
    if (ids.length === 0 || saving) return;
    setSaving(true);
    // Close before awaiting, mirroring the single-delete dialogs: the open
    // state must not linger on fetch latency (verify #2).
    setConfirmBulkDelete(false);
    try {
      const { deleted } = await api.bulkDeleteVideoSegments(ids);
      setSelectedSegmentIds([]);
      await load();
      toast.success(deleted === 1 ? "1 segmento eliminado" : `${deleted} segmentos eliminados`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar los segmentos");
    } finally {
      setSaving(false);
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
        <span className="inline-block">
          <span
            className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
              STATUS_CHIPS[v.status] ?? "bg-stone-100 text-stone-600"
            }`}
          >
            {STATUS_LABELS[v.status] ?? v.status}
          </span>
          {v.analysisState === "running" && (
            <span className="ml-1 inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 animate-pulse">
              Analizando…
            </span>
          )}
          {v.analysisError && (
            <span className="block mt-1 text-xs text-red-600">{v.analysisError}</span>
          )}
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
          <span className="text-stone-600 line-clamp-2">{v.licenseNote}</span>
        ) : (
          <span className="text-stone-400">—</span>
        ),
    },
    {
      key: "accion",
      header: "Acción",
      align: "right",
      cellClassName: "whitespace-nowrap",
      render: (v) => (
        <>
          {v.analysisState !== "running" &&
            (v.status === "draft" || v.status === "analyzed") && (
              <>
                <button
                  onClick={() => handleAnalyzeClick(v)}
                  className="text-emerald-800 hover:underline mr-3"
                >
                  {v.status === "draft" ? "Analizar" : "Re-analizar"}
                </button>
                <button
                  onClick={() => openTranscriptDialog(v)}
                  title="Analizar con una transcripción json3 ya descargada (sin yt-dlp)"
                  className="text-emerald-800 hover:underline mr-3"
                >
                  Con transcripción…
                </button>
              </>
            )}
          <button
            onClick={() => setConfirmVideo(v)}
            className="text-red-700 hover:underline"
          >
            Eliminar
          </button>
        </>
      ),
    },
  ];

  const segmentColumns: DataTableColumn<VideoSegment>[] = [
    {
      // Non-sortable on purpose: the header hosts the select-all checkbox.
      key: "select",
      header: (
        <input
          type="checkbox"
          aria-label="Seleccionar todos los segmentos"
          checked={allVisibleSelected}
          disabled={renderedSegmentIds.length === 0}
          onChange={toggleSelectAllVisible}
        />
      ),
      align: "center",
      render: (s) => (
        <input
          type="checkbox"
          aria-label={`Seleccionar segmento: ${s.title}`}
          checked={selectedSegmentIds.includes(s.id)}
          onChange={() => toggleSegmentSelection(s.id)}
        />
      ),
    },
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
      truncate: true,
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
      render: (s) => {
        const range = `${formatTime(s.startS)} – ${formatTime(s.endS)}`;
        const href = segmentVideoLink(s);
        if (!href) return <>{range}</>;
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Ver en YouTube desde ${formatTime(s.startS)}`}
            className="text-emerald-800 hover:underline"
          >
            {range}
          </a>
        );
      },
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
        searchable
        searchText={(v) => `${v.speaker} ${v.title}`}
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
                  // Selection is scoped to what's on screen: a filter switch
                  // must never leave invisible ids selected.
                  setSelectedSegmentIds([]);
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

        {selectedSegmentIds.length > 0 && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <span className="text-sm text-red-800">
              {selectedSegmentIds.length}
              {selectedSegmentIds.length === 1
                ? " segmento seleccionado"
                : " segmentos seleccionados"}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="px-3 py-1.5 bg-red-700 text-white text-sm hover:bg-red-800"
              >
                Eliminar seleccionados ({selectedSegmentIds.length})
              </button>
              <button
                onClick={() => setSelectedSegmentIds([])}
                className="px-3 py-1.5 border border-red-300 text-red-700 text-sm hover:bg-red-100"
              >
                Limpiar
              </button>
            </div>
          </div>
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
          searchable
          searchText={(s) => `${s.title} ${s.condition ?? ""} ${videoTitle(String(s.videoId))}`}
          onRenderedRowsChange={(rows) => setRenderedSegmentIds(rows.map((s) => s.id))}
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
        open={confirmAnalyzeVideo !== null}
        title={confirmAnalyzeVideo ? `¿Re-analizar "${confirmAnalyzeVideo.title}"?` : ""}
        description="El análisis vuelve a trocear el vídeo: los segmentos existentes se reemplazarán (los activos incluidos). Esta acción no se puede deshacer."
        confirmLabel="Re-analizar"
        onConfirm={() => {
          const row = confirmAnalyzeVideo;
          setConfirmAnalyzeVideo(null);
          if (row) void runAnalyze(row);
        }}
        onCancel={() => setConfirmAnalyzeVideo(null)}
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
      <ConfirmActionDialog
        open={confirmBulkDelete}
        title={`¿Eliminar ${selectedSegmentIds.length} segmentos seleccionados?`}
        description="Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => void handleBulkDeleteSelected()}
        onCancel={() => setConfirmBulkDelete(false)}
      />
      {/* Análisis con transcripción (json3 o texto del panel): el backend
          analiza el contenido facilitado y nunca invoca yt-dlp. */}
      <Dialog
        open={transcriptVideo !== null}
        onOpenChange={(open) => {
          if (!open) closeTranscriptDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {transcriptVideo
                ? `Analizar con transcripción — ${transcriptVideo.title}`
                : "Analizar con transcripción"}
            </DialogTitle>
            <DialogDescription>
              Pega la transcripción json3 de YouTube o el texto copiado del panel de
              transcripción (con líneas de tiempo como 0:18 o 0:01:18) — o carga un archivo —
              y el servidor la analizará directamente, sin invocar yt-dlp.
              {transcriptVideo?.status === "analyzed" &&
                " El análisis reemplazará los segmentos existentes (los activos incluidos)."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleTranscriptSubmit} noValidate className="space-y-4">
            <label className="block text-sm">
              Transcripción (json3 o texto del panel)
              <textarea
                rows={10}
                spellCheck={false}
                className="mt-1 w-full border border-stone-300 px-3 py-2 font-mono text-xs"
                value={transcriptText}
                onChange={(e) => {
                  setTranscriptText(e.target.value);
                  setTranscriptError(null);
                }}
                placeholder={'{"events": [ … ]}  ·  o texto del panel con marcas 0:18'}
                disabled={transcriptBusy}
              />
            </label>
            <label className="block text-xs text-stone-600">
              …o carga un archivo .json / .json3 / .txt
              <input
                type="file"
                accept=".json,.json3,.txt,application/json,text/plain"
                onChange={(e) => void handleTranscriptFile(e)}
                disabled={transcriptBusy}
                className="mt-1 block text-sm"
              />
            </label>
            {transcriptError && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 text-sm text-red-700"
              >
                {transcriptError}
              </div>
            )}
            <DialogFooter>
              <button
                type="button"
                onClick={closeTranscriptDialog}
                disabled={transcriptBusy}
                className="px-4 py-2 border border-stone-300 text-stone-600 text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={transcriptBusy}
                className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800 disabled:opacity-50"
              >
                {transcriptBusy ? "Enviando…" : "Analizar"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
