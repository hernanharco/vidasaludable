import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessages } from "../src/app/components/chat/ChatMessages";
import { ChatWidget } from "../src/app/components/chat";
import type { ProductCardInfo, VideoCardInfo } from "../src/app/components/chat/types";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * T6 — ProductCard info cards for `[REF]` citations.
 *
 * Agent bubbles parse `\[(\d{4,6})\]` (same convention as the backend's
 * extractProductRefs). Known references render a ProductCard and the token is
 * removed from the surrounding text; UNKNOWN references keep their literal
 * `[12345]` text (backward compatible — unlike `[VIDEO:id]`, where unknown
 * ids are stripped). User messages are never parsed (same contract as videos).
 *
 * The widget boot-fetches `/api/assistant/products` into a
 * `Map<string, ProductCardInfo>`; a failure degrades to an empty map and
 * never blocks chat (same best-effort pattern as the videos map).
 */
const LONG_BENEFITS =
  "Contribuye al mantenimiento normal de los huesos y dientes, apoya la función muscular normal y " +
  "ayuda al sistema inmunológico a funcionar con normalidad durante todo el año, con una fórmula " +
  "combinada de calcio, magnesio, vitamina D y otros minerales esenciales para el bienestar diario. ".repeat(2);

const PRODUCTS: ProductCardInfo[] = [
  {
    reference: "110606",
    name: "Nutrilite™ Cal Mag D Plus",
    price: 29.71,
    category: "Nutrición",
    benefits: LONG_BENEFITS,
    disclaimer: "Complemento alimenticio. No sustituye una dieta equilibrada.",
  },
  {
    reference: "121576",
    name: "Nutrilite™ Double X",
    price: 86.87,
    category: "Nutrición",
    benefits: "Multivitamínico con fitonutrientes de frutas y verduras.",
    disclaimer: "Complemento alimenticio.",
  },
];

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
];

/** The exact formatter the ProductCard uses (task contract, es-ES currency).
 * ICU puts U+00A0 before the symbol; testing-library's default text
 * normalization collapses whitespace, so tests normalize before comparing. */
const priceOf = (p: ProductCardInfo) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" })
    .format(p.price)
    .replace(/\u00A0/g, " ");

function productMap(list: ProductCardInfo[] = PRODUCTS): Map<string, ProductCardInfo> {
  return new Map(list.map((p) => [p.reference, p]));
}

function videoMap(list: VideoCardInfo[] = VIDEOS): Map<number, VideoCardInfo> {
  return new Map(list.map((v) => [v.id, v]));
}

function renderMessages(
  text: string,
  sender: "user" | "agent" = "agent",
  products: Map<string, ProductCardInfo> = productMap(),
  videos: Map<number, VideoCardInfo> = videoMap(),
) {
  return render(
    <ChatMessages
      messages={[{ sender, text }]}
      sending={false}
      chatError={null}
      scrollRef={{ current: null } as React.RefObject<HTMLDivElement>}
      videos={videos}
      products={products}
    />,
  );
}

function installMemoryLocalStorage() {
  // jsdom 30 under vitest runs with an opaque origin (about:blank), where
  // jsdom refuses to expose localStorage. ChatWidget reads it at render time,
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

describe("ChatMessages product cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a ProductCard for a known ref: name, formatted price, ref chip; token removed", () => {
    renderMessages("Te recomiendo Nutrilite™ Cal Mag D Plus [110606] para tus huesos.");

    // Card carries name, category chip, exact es-ES formatted price, ref chip.
    expect(screen.getByText("Nutrilite™ Cal Mag D Plus")).toBeInTheDocument();
    expect(screen.getByText("Nutrición")).toBeInTheDocument();
    expect(screen.getByText(priceOf(PRODUCTS[0]))).toBeInTheDocument();
    expect(screen.getByText("[110606]")).toBeInTheDocument();

    // The citation token is replaced by the card: surrounding reply text
    // survives and the literal "[110606]" appears exactly once (the chip).
    const bubble = screen.getByText(/Te recomiendo/) as HTMLElement;
    expect(bubble.textContent).toContain("para tus huesos.");
    expect(bubble.textContent).not.toContain("[110606] para");
    expect(screen.getAllByText("[110606]")).toHaveLength(1);

    // No link — the app has no store (info card only).
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the product disclaimer as a muted line when present", () => {
    renderMessages("Prueba [110606] hoy con aviso.");

    // The disclaimer already rides along in ProductCardInfo and the API
    // serves it — it must show under the benefits line.
    expect(screen.getByText(PRODUCTS[0].disclaimer)).toBeInTheDocument();
  });

  it("renders no disclaimer line when it is empty, blank, or missing (old rows must not break)", () => {
    const gaps: ProductCardInfo[] = [
      { ...PRODUCTS[1], disclaimer: "" },
      { ...PRODUCTS[1], reference: "111111", disclaimer: "   " },
      // Runtime gap: older API rows may not carry the field at all.
      { ...PRODUCTS[1], reference: "222222", disclaimer: undefined as unknown as string },
    ];
    renderMessages("Prueba [121576] [111111] [222222] sin drama.", "agent", productMap(gaps));

    // Cards still render fine…
    expect(screen.getAllByText(/Nutrilite™ Double X/)).toHaveLength(3);
    // …and a blank/missing disclaimer produces no line at all.
    expect(screen.queryByText(/Complemento alimenticio/)).not.toBeInTheDocument();
  });

  it("renders the ProductCard only for the FIRST occurrence of a repeated ref (per message)", () => {
    renderMessages("Prueba Nutrilite™ Double X [121576] y otra vez Double X [121576].");

    // Exactly one card…
    expect(screen.getAllByText("Nutrilite™ Double X")).toHaveLength(1);
    expect(screen.getAllByText(priceOf(PRODUCTS[1]))).toHaveLength(1);
    // …and BOTH token occurrences stay visible in the text (append-only
    // contract): one as the card's ref chip, one as literal text.
    const bubble = screen.getByText(/Prueba/) as HTMLElement;
    expect(bubble.textContent?.match(/\[121576\]/g) ?? []).toHaveLength(2);
    expect(bubble.textContent).toContain("y otra vez Double X [121576].");
  });

  it("dedupes per message only: each message still renders its own card", () => {
    render(
      <ChatMessages
        messages={[
          { sender: "agent", text: "Primero [110606]." },
          { sender: "agent", text: "Segundo [110606]." },
        ]}
        sending={false}
        chatError={null}
        scrollRef={{ current: null } as React.RefObject<HTMLDivElement>}
        videos={videoMap()}
        products={productMap()}
      />,
    );

    expect(screen.getAllByText("Nutrilite™ Cal Mag D Plus")).toHaveLength(2);
  });

  it("truncates long benefits at ~180 chars with an ellipsis", () => {
    const { container } = renderMessages("Prueba [110606] hoy mismo.");

    const expected = `${LONG_BENEFITS.slice(0, 180).trimEnd()}…`;
    expect(screen.getByText(expected)).toBeInTheDocument();
    // Full text is NOT rendered.
    expect(container.textContent).not.toContain(LONG_BENEFITS);
  });

  it("keeps an unknown ref as literal text (backward compatible)", () => {
    renderMessages("Prueba [99999] cuando quieras.");

    const bubble = screen.getByText(/Prueba/) as HTMLElement;
    expect(bubble.textContent).toContain("[99999]");
    expect(bubble.textContent).toContain("cuando quieras.");
    // No card rendered for the unknown ref.
    expect(screen.queryByText("Nutrilite™ Cal Mag D Plus")).not.toBeInTheDocument();
    expect(screen.queryByText(priceOf(PRODUCTS[0]))).not.toBeInTheDocument();
  });

  it("renders a video card and product cards in ONE message ([VIDEO:id] ≠ product ref)", () => {
    renderMessages(
      "Mira [VIDEO:7] y prueba Nutrilite™ Cal Mag D Plus [110606] y Double X [121576].",
    );

    // Video marker resolves to its link card…
    const link = screen.getByRole("link", { name: /Vitamina D y huesos/i });
    expect(link).toHaveAttribute("href", VIDEOS[0].url);
    // …and both product refs render as info cards in the same bubble.
    expect(screen.getByText("Nutrilite™ Cal Mag D Plus")).toBeInTheDocument();
    expect(screen.getByText("Nutrilite™ Double X")).toBeInTheDocument();
    expect(screen.getByText(priceOf(PRODUCTS[0]))).toBeInTheDocument();
    expect(screen.getByText(priceOf(PRODUCTS[1]))).toBeInTheDocument();

    // `[VIDEO:7]` contains letters — it must NOT be mistaken for a product ref.
    const bubble = screen.getByText(/Mira/) as HTMLElement;
    expect(bubble.textContent).not.toContain("[VIDEO");
    // Each citation token is consumed: it appears exactly once per product —
    // as the card's ref chip, never as leftover literal reply text.
    expect(screen.getAllByText("[110606]")).toHaveLength(1);
    expect(screen.getAllByText("[121576]")).toHaveLength(1);

    // Order preserved: video card first, then the two product cards.
    const text = bubble.textContent ?? "";
    const iVideo = text.indexOf("Vitamina D y huesos");
    const iP1 = text.indexOf("Nutrilite™ Cal Mag D Plus");
    const iP2 = text.indexOf("Nutrilite™ Double X");
    expect(iVideo).toBeGreaterThanOrEqual(0);
    expect(iP1).toBeGreaterThan(iVideo);
    expect(iP2).toBeGreaterThan(iP1);
  });

  it("renders user messages untouched (no parsing, literal refs kept)", () => {
    renderMessages("¿Puedes pasarme [110606] y [VIDEO:7]?", "user");

    const bubble = screen.getByText(/¿Puedes pasarme/) as HTMLElement;
    expect(bubble.textContent).toContain("[110606]");
    expect(bubble.textContent).toContain("[VIDEO:7]");
    // No cards of either kind.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("Nutrilite™ Cal Mag D Plus")).not.toBeInTheDocument();
    expect(screen.queryByText(priceOf(PRODUCTS[0]))).not.toBeInTheDocument();
  });

  it("degrades to literal text when the product map is empty", () => {
    renderMessages("Prueba [110606] cuando quieras.", "agent", new Map());

    const bubble = screen.getByText(/Prueba/) as HTMLElement;
    expect(bubble.textContent).toContain("[110606]");
    expect(bubble.textContent).toContain("cuando quieras.");
  });
});

describe("ChatWidget product map boot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("fetches /api/assistant/products at boot", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/assistant/products")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ products: PRODUCTS }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(<ChatWidget />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/assistant/products");
    });
  });

  it("still opens the widget when the products fetch fails", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/assistant/products")) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(<ChatWidget />);
    await user.click(screen.getByRole("button"));

    // Chat flow is not blocked by the products failure: access-code gate shows.
    expect(await screen.findByText("Código de acceso")).toBeInTheDocument();
  });

  it("still opens the widget when the products response is not an array", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/assistant/products")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ products: "nope" }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(<ChatWidget />);
    await user.click(screen.getByRole("button"));
    expect(await screen.findByText("Código de acceso")).toBeInTheDocument();
  });

  it("renders a ProductCard end-to-end when an agent reply cites a known ref", async () => {
    const user = userEvent.setup();
    // Returning customer → straight to chat (no gates).
    window.localStorage.setItem("vr_customer_id", "7");
    window.localStorage.setItem("vr_conversation_id", "3");

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/assistant/products")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ products: PRODUCTS }) });
      }
      if (url.includes("/api/assistant/videos")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ videos: VIDEOS }) });
      }
      if (url.includes("/api/assistant/history")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ messages: [] }) });
      }
      if (url.includes("/api/assistant/ask")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              conversation_id: 3,
              reply: "Te recomiendo Cal Mag D Plus [110606] para tus huesos.",
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    render(<ChatWidget />);
    await user.click(screen.getByRole("button"));

    const input = screen.getByPlaceholderText("Escribe un mensaje...");
    await user.type(input, "me duelen los huesos");
    await user.keyboard("{Enter}");

    // The boot-fetched map resolves the reply citation into a ProductCard.
    expect(await screen.findByText("Nutrilite™ Cal Mag D Plus")).toBeInTheDocument();
    expect(screen.getByText(priceOf(PRODUCTS[0]))).toBeInTheDocument();
    expect(screen.getByText("[110606]")).toBeInTheDocument();
  });
});
