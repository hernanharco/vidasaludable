import { describe, it, expect } from "vitest";
import { formatTime, youtubeTimestampUrl } from "../src/app/lib/format";

/**
 * T4 Phase A — YouTube-style human-facing time format (M:SS, H:MM:SS ≥3600s).
 * Storage and API payloads keep integer seconds; only display layers format.
 */
describe("formatTime", () => {
  it("formats zero as 0:00", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats sub-minute values with a zero-padded seconds field", () => {
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(45)).toBe("0:45");
  });

  it("formats minutes as M:SS without a leading zero on the minutes", () => {
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(599)).toBe("9:59");
    expect(formatTime(1093)).toBe("18:13");
  });

  it("formats hours as H:MM:SS at >= 3600s", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3661)).toBe("1:01:01");
    expect(formatTime(7325)).toBe("2:02:05");
  });

  it("degrades negative or non-finite input to 0:00", () => {
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
  });
});

/**
 * Deep link into the ORIGINAL video at the segment's start minute, so the
 * operator can watch a segment before deciding its condition.
 */
describe("youtubeTimestampUrl", () => {
  it("builds a watch URL with the start second as the t parameter", () => {
    expect(youtubeTimestampUrl("abc123", 0)).toBe(
      "https://www.youtube.com/watch?v=abc123&t=0s",
    );
    expect(youtubeTimestampUrl("abc123", 90)).toBe(
      "https://www.youtube.com/watch?v=abc123&t=90s",
    );
  });

  it("floors fractional seconds and degrades invalid input to 0", () => {
    expect(youtubeTimestampUrl("abc123", 90.9)).toBe(
      "https://www.youtube.com/watch?v=abc123&t=90s",
    );
    expect(youtubeTimestampUrl("abc123", -5)).toBe(
      "https://www.youtube.com/watch?v=abc123&t=0s",
    );
    expect(youtubeTimestampUrl("abc123", NaN)).toBe(
      "https://www.youtube.com/watch?v=abc123&t=0s",
    );
  });

  it("returns null when there is no video id to link to", () => {
    expect(youtubeTimestampUrl("", 90)).toBeNull();
    expect(youtubeTimestampUrl("   ", 90)).toBeNull();
  });

  // R3-NullTrim: a payload that omits youtubeId entirely must degrade to
  // "no link", never throw while the segment table renders.
  it("does not throw when the payload omits the id at runtime", () => {
    expect(youtubeTimestampUrl(undefined, 90)).toBeNull();
    expect(youtubeTimestampUrl(null, 90)).toBeNull();
    // Any non-string value arriving from an untyped payload behaves the same.
    expect(youtubeTimestampUrl(42 as unknown as string, 90)).toBeNull();
  });
});
