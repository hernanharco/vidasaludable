import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessages } from "../src/app/components/chat/ChatMessages";
import { ChatInput } from "../src/app/components/chat/ChatInput";

/**
 * S3b — a11y contract for the chat surface (feature ui-optimization, spec
 * S3): the message list is a polite live log that announces new replies,
 * the typing indicator is a status region, the input has an accessible
 * name, and the icon-only submit button names its state (send vs sent).
 */

function renderMessages(sending = false) {
  return render(
    <ChatMessages
      messages={[
        { sender: "user", text: "Hola" },
        { sender: "agent", text: "¡Hola! ¿En qué puedo ayudarte?" },
      ]}
      sending={sending}
      scrollRef={{ current: null } as React.RefObject<HTMLDivElement>}
      videos={new Map()}
    />,
  );
}

describe("ChatMessages accessibility (S3b)", () => {
  it("exposes the message list as a polite live log containing the replies", () => {
    renderMessages();

    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    // Replies live inside the log → new additions are announced.
    expect(log).toHaveTextContent("¡Hola! ¿En qué puedo ayudarte?");
    expect(log).toHaveTextContent("Hola");
  });

  it("announces the typing indicator as a status region", () => {
    renderMessages(true);

    expect(screen.getByRole("status")).toHaveTextContent("Escribiendo...");
  });
});

describe("ChatInput accessibility (S3b)", () => {
  const noop = () => {};

  it("names the text input for assistive tech", () => {
    render(
      <ChatInput inputValue="" sending={false} onInputChange={noop} onSend={noop} />,
    );

    expect(screen.getByRole("textbox", { name: "Escribir mensaje" })).toBeInTheDocument();
  });

  it("names the icon-only submit button for the send state", () => {
    render(
      <ChatInput inputValue="hola" sending={false} onInputChange={noop} onSend={noop} />,
    );

    expect(screen.getByRole("button", { name: "Enviar mensaje" })).toBeInTheDocument();
  });

  it("names the icon-only submit button for the sent/confirmed state", () => {
    render(
      <ChatInput inputValue="hola" sending={true} onInputChange={noop} onSend={noop} />,
    );

    expect(screen.getByRole("button", { name: "Mensaje enviado" })).toBeInTheDocument();
  });
});
