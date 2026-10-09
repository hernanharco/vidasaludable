import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { ChatMessages } from "../src/app/components/chat/ChatMessages";
import { ChatSession } from "../src/app/components/chat";
import type { VideoCardInfo } from "../src/app/components/chat/types";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const VIDEOS: VideoCardInfo[] = [
  {
    id: 7,
    title: "Vitamina D y huesos",
    condition: "Dolor óseo",
    summary: "Resumen del segmento sobre vitamina D.",
    url: "https://www.youtube.com/watch?v=abc123&t=90",
    speaker: "Luis Collantes",
    startS: 90,
    endS: 180,
  },
  {
    id: 12,
    title: "Magnesio y sueño",
    condition: null,
    summary: "Resumen del segmento sobre magnesio.",
    url: "https://www.youtube.com/watch?v=def456",
    speaker: "Luis Collantes",
  },
];

function videoMap(list: VideoCardInfo[] = VIDEOS): Map<number, VideoCardInfo> {
  return new Map(list.map((v) => [v.id, v]));
}

function renderMessages(
  text: string,
  sender: "user" | "agent",
  videos: Map<number, VideoCardInfo>,
) {
  return render(
    <ChatMessages
      messages={[{ sender, text }]}
      sending={false}
      chatError={null}
      scrollRef={{ current: null } as React.RefObject<HTMLDivElement>}
      videos={videos}
    />,
  );
}

function installMemoryLocalStorage() {
  // jsdom 30 under vitest runs with an opaque origin (about:blank), where
  // jsdom refuses to expose localStorage. ChatSession reads it at render time,
  // so the widget-level tests install a tiny in-memory stand-in.
  const store = new Map<string, string>();
  const impl = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: impl });
}

installMemoryLocalStorage();

describe("ChatMessages video cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a video card for a known marker in an agent message", () => {
    renderMessages("Mira este video [VIDEO:7] para saber más.", "agent", videoMap());

    const card = screen.getByRole("link", { name: /Vitamina D y huesos/i });
    expect(card).toHaveAttribute("href", VIDEOS[0]!.url);
    expect(card).toHaveAttribute("target", "_blank");
    expect(card.getAttribute("rel")).toContain("noopener");
    expect(card.getAttribute("rel")).toContain("noreferrer");
    // Card shows title, condition chip, and speaker
    expect(card).toHaveTextContent("Vitamina D y huesos");
    expect(card).toHaveTextContent("Dolor óseo");
    expect(card).toHaveTextContent("Luis Collantes");
    // T4 Phase A: segment range chip in mm:ss when startS/endS are present.
    expect(card).toHaveTextContent("1:30 – 3:00");
    // Surrounding text intact, marker token gone
    expect(screen.getByText(/Mira este video/)).toBeInTheDocument();
    expect(screen.queryByText(/VIDEO:/)).not.toBeInTheDocument();
  });

  it("renders both cards for two markers, surrounding text intact and in order", () => {
    renderMessages("Antes [VIDEO:7] en medio [VIDEO:12] después.", "agent", videoMap());

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", VIDEOS[0]!.url);
    expect(links[1]).toHaveAttribute("href", VIDEOS[1]!.url);
    // Card without a condition renders title + speaker only (no crash)
    expect(links[1]).toHaveTextContent("Magnesio y sueño");
    expect(links[1]).toHaveTextContent("Luis Collantes");
    // Absent startS/endS → no time chip, no crash (only card 1 carries times).
    expect(links[1]!.textContent).not.toMatch(/\d+:\d+/);
    expect(screen.queryByText("1:30 – 3:00")).toBeInTheDocument();
    expect(screen.queryAllByText(/–/)).toHaveLength(1);

    const bubble = screen.getByText(/Antes/) as HTMLElement;
    const text = bubble.textContent ?? "";
    const iBefore = text.indexOf("Antes");
    const iCard1 = text.indexOf("Vitamina D y huesos");
    const iMiddle = text.indexOf("en medio");
    const iCard2 = text.indexOf("Magnesio y sueño");
    const iAfter = text.indexOf("después");
    expect(iBefore).toBeGreaterThanOrEqual(0);
    expect(iCard1).toBeGreaterThan(iBefore);
    expect(iMiddle).toBeGreaterThan(iCard1);
    expect(iCard2).toBeGreaterThan(iMiddle);
    expect(iAfter).toBeGreaterThan(iCard2);
    expect(text).not.toContain("[VIDEO");
  });

  it("removes an unknown marker id without rendering a card", () => {
    renderMessages("Esto es [VIDEO:999] invisible.", "agent", videoMap());

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const bubble = screen.getByText(/Esto es/) as HTMLElement;
    expect(bubble.textContent).toContain("Esto es");
    expect(bubble.textContent).toContain("invisible.");
    expect(bubble.textContent).not.toContain("[VIDEO");
    expect(bubble.textContent).not.toContain("999");
  });

  it("strips markers and does not crash with an empty video map", () => {
    const { container } = renderMessages("Video útil [VIDEO:1] fin.", "agent", new Map());

    expect(container).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const bubble = screen.getByText(/Video útil/) as HTMLElement;
    expect(bubble.textContent).toContain("fin.");
    expect(bubble.textContent).not.toContain("[VIDEO");
  });

  it("renders user messages as plain text without parsing markers", () => {
    renderMessages("¿Puedes ver [VIDEO:7]?", "user", videoMap());

    expect(screen.getByText(/¿Puedes ver \[VIDEO:7\]\?/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("VideoCard scheme guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const EVIL: VideoCardInfo = {
    id: 13,
    title: "XSS de prueba",
    condition: null,
    summary: "Segmento con URL hostil (defensa en profundidad).",
    url: "javascript:alert(1)",
    speaker: "Luis Collantes",
  };

  it("renders no href for a non-https url (javascript: stays inert)", () => {
    const { container } = renderMessages(
      "Mira esto [VIDEO:13] con cuidado.",
      "agent",
      videoMap([...VIDEOS, EVIL]),
    );

    // The card layout still renders…
    expect(screen.getByText("XSS de prueba")).toBeInTheDocument();
    // …but nothing anchors to a javascript: URL and no link role appears.
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.queryByRole("link", { name: /XSS de prueba/i })).not.toBeInTheDocument();
    // Surrounding text intact, marker token stripped like any other card.
    const bubble = screen.getByText(/Mira esto/) as HTMLElement;
    expect(bubble.textContent).toContain("con cuidado.");
    expect(bubble.textContent).not.toContain("[VIDEO");
  });

  it("keeps the href for normal https urls", () => {
    renderMessages("Mira [VIDEO:12] para dormir mejor.", "agent", videoMap());

    const link = screen.getByRole("link", { name: /Magnesio y sueño/i });
    expect(link).toHaveAttribute("href", VIDEOS[1]!.url);
  });
});

describe("ChatSession video map boot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("fetches /api/assistant/videos at boot", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/assistant/videos")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ videos: VIDEOS }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(<ChatSession />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/assistant/videos");
    });
  });

  it("still opens the widget when the videos fetch fails", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/assistant/videos")) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(<ChatSession />);

    // Chat flow is not blocked by the videos failure: access-code gate shows.
    expect(await screen.findByText("Código de acceso")).toBeInTheDocument();
  });

  it("still opens the widget when the videos response is not an array", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/assistant/videos")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ videos: "nope" }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(<ChatSession />);
    expect(await screen.findByText("Código de acceso")).toBeInTheDocument();
  });
});
