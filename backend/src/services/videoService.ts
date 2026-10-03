import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { videos, videoSegments } from "../db/schema.js";
import type { Video, NewVideo, VideoSegment, NewVideoSegment } from "../db/schema.js";

/**
 * Video-segments service — CRUD over the two tables added by T3.
 *
 * Mirrors guidanceService: synchronous better-sqlite3 reads/writes, ISO-8601
 * `createdAt`/`updatedAt` text written by the service (not the SQL default),
 * and `update*` refreshing `updatedAt`.
 *
 * `videos` holds the analyzed originals; `video_segments` holds the timestamped
 * excerpts. `enabled` gates chat injection, and a segment's `symptomId` (the
 * resolved `assessment_symptoms` row) is what lets the assistant cite it for a
 * user's symptoms — see matchSymptom in symptomMatcher.ts.
 *
 * FK note: `foreign_keys` is ON, so `removeVideo` fails on a video that still
 * has segments. Delete the segments first (or the future admin routes should
 * expose that ordering deliberately).
 */
/**
 * Shape of an enabled segment joined with its video row — the consumer card
 * for `GET /assistant/videos`. The widget resolves `[VIDEO:<id>]` markers
 * against these cards; `id` is the SEGMENT id (the agent cites segments).
 */
export interface VideoSegmentCard {
  id: number;
  videoId: number;
  title: string; // segment title (the card headline)
  condition: string | null;
  summary: string;
  startS: number;
  endS: number;
  speaker: string; // from the joined videos row
  youtubeId: string; // ORIGINAL video id (fallback deep-link target)
  clipYoutubeId: string | null; // owner-channel clip, null until uploaded
}

export interface VideoService {
  /** All videos (admin CRM list). */
  listVideos(): Video[];
  /** Video by its ORIGINAL YouTube id. Returns null when absent. */
  getVideoByYoutubeId(youtubeId: string): Video | null;
  /** Create a video. `status` defaults to 'draft' at the DB. Timestamps ISO-8601 text. */
  createVideo(input: NewVideo): Video;
  /** Partial update by id; refreshes `updatedAt`. Returns null when absent. */
  updateVideo(id: number, patch: Partial<NewVideo>): Video | null;
  /** Delete a video. Returns whether a row was removed. */
  removeVideo(id: number): boolean;
  /** All segments (admin CRM list), enabled or not. */
  listSegments(): VideoSegment[];
  /** Only enabled segments — the ones the assistant may cite in chat. */
  listEnabledSegments(): VideoSegment[];
  /** Enabled segments joined with their video row, shaped for `GET /assistant/videos`. */
  listEnabledSegmentCards(): VideoSegmentCard[];
  /** Create a segment. `enabled` defaults to 0, `summary` to '' at the DB. */
  createSegment(input: NewVideoSegment): VideoSegment;
  /** Partial update by id; refreshes `updatedAt`. Returns null when absent. */
  updateSegment(id: number, patch: Partial<NewVideoSegment>): VideoSegment | null;
  /** Delete a segment. Returns whether a row was removed. */
  removeSegment(id: number): boolean;
}

export function createVideoService(db: Db): VideoService {
  return {
    listVideos(): Video[] {
      return db.select().from(videos).all();
    },

    getVideoByYoutubeId(youtubeId: string): Video | null {
      const row = db.select().from(videos).where(eq(videos.youtubeId, youtubeId)).get();
      return row ?? null;
    },

    createVideo(input: NewVideo): Video {
      const now = new Date().toISOString();
      return db
        .insert(videos)
        .values({ ...input, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },

    updateVideo(id: number, patch: Partial<NewVideo>): Video | null {
      const row = db
        .update(videos)
        .set({ ...patch, updatedAt: new Date().toISOString() })
        .where(eq(videos.id, id))
        .returning()
        .get();
      return row ?? null;
    },

    removeVideo(id: number): boolean {
      const result = db.delete(videos).where(eq(videos.id, id)).run();
      return result.changes > 0;
    },

    listSegments(): VideoSegment[] {
      return db.select().from(videoSegments).all();
    },

    listEnabledSegments(): VideoSegment[] {
      return db.select().from(videoSegments).where(eq(videoSegments.enabled, 1)).all();
    },

    listEnabledSegmentCards(): VideoSegmentCard[] {
      return db
        .select({
          id: videoSegments.id,
          videoId: videoSegments.videoId,
          title: videoSegments.title,
          condition: videoSegments.condition,
          summary: videoSegments.summary,
          startS: videoSegments.startS,
          endS: videoSegments.endS,
          speaker: videos.speaker,
          youtubeId: videos.youtubeId,
          clipYoutubeId: videoSegments.clipYoutubeId,
        })
        .from(videoSegments)
        .innerJoin(videos, eq(videoSegments.videoId, videos.id))
        .where(eq(videoSegments.enabled, 1))
        .all();
    },

    createSegment(input: NewVideoSegment): VideoSegment {
      const now = new Date().toISOString();
      return db
        .insert(videoSegments)
        .values({ ...input, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },

    updateSegment(id: number, patch: Partial<NewVideoSegment>): VideoSegment | null {
      const row = db
        .update(videoSegments)
        .set({ ...patch, updatedAt: new Date().toISOString() })
        .where(eq(videoSegments.id, id))
        .returning()
        .get();
      return row ?? null;
    },

    removeSegment(id: number): boolean {
      const result = db.delete(videoSegments).where(eq(videoSegments.id, id)).run();
      return result.changes > 0;
    },
  };
}
