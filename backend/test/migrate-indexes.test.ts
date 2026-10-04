import { describe, it, expect } from "vitest";
import { createDatabase } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

/**
 * R3-002 (backend-quick-wins T1) — `video_segments.video_id` had no index:
 * segment lookups by video (assistant cards, admin lists, the DELETE FK
 * pre-check) scanned the whole table. The production DDL must create
 * `video_segments_video_id_idx`, and migrate must stay idempotent
 * (`IF NOT EXISTS` DDL; the ALTER/backfill/drop steps already ignore
 * "already exists"/"no such column" failures).
 */
describe("migrate DDL — video_segments indexes (R3-002)", () => {
  it("creates video_segments_video_id_idx on video_segments (video_id)", async () => {
    const db = createDatabase(":memory:");
    await migrate(db);
    const row = db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'video_segments' AND name = 'video_segments_video_id_idx'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("video_segments_video_id_idx");

    // Idempotency: a second migrate over the same database must not throw.
    await migrate(db);
  });
});
