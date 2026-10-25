import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CountryCodeSelect } from "../src/app/components/chat/CountryCodeSelect";
import { COUNTRY_CODES } from "../src/app/lib/countryCodes";

/**
 * Dial-code picker with a real country flag (flagcdn.com) instead of the
 * native `<select>` whose "+34 España" text looked plain and rendered no
 * flag on Windows. The shadcn/Radix Select keeps the same wire value
 * (dial code string) so RegistrationGate and ChatSession are unaffected.
 */

function openDropdown(trigger: HTMLElement) {
  fireEvent.mouseDown(trigger);
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("countryCodes — ISO codes for flags", () => {
  it("every entry carries a 2-letter ISO alpha-2 code", () => {
    for (const c of COUNTRY_CODES) {
      expect(c.iso, `iso missing for ${c.code} ${c.name}`).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("the duplicated +1 entries have distinct ISO codes", () => {
    const ones = COUNTRY_CODES.filter((c) => c.code === "+1");
    expect(ones).toHaveLength(2);
    expect(new Set(ones.map((c) => c.iso)).size).toBe(2);
  });
});

describe("CountryCodeSelect", () => {
  it("shows the selected country's flag and dial code on the trigger", () => {
    render(
      <CountryCodeSelect value="+34" onChange={() => {}} label="Indicativo del país" />,
    );
    const trigger = screen.getByRole("combobox", { name: /indicativo del país/i });
    const flag = within(trigger).getByRole("img", { name: /bandera de españa/i });
    expect(flag).toHaveAttribute("src", "https://flagcdn.com/w40/es.svg");
    expect(trigger).toHaveTextContent("+34");
  });

  it("renders every country with its flag in the dropdown", () => {
    render(
      <CountryCodeSelect value="+54" onChange={() => {}} label="Indicativo" />,
    );
    const trigger = screen.getByRole("combobox", { name: /indicativo/i });
    openDropdown(trigger);
    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(COUNTRY_CODES.length);
    // Spot checks: Argentina (first option content) and España.
    expect(
      within(listbox).getByRole("img", { name: /bandera de argentina/i }),
    ).toHaveAttribute("src", "https://flagcdn.com/w40/ar.svg");
    expect(
      within(listbox).getByRole("img", { name: /bandera de españa/i }),
    ).toHaveAttribute("src", "https://flagcdn.com/w40/es.svg");
  });

  it("emits the dial code (not the option key) on selection", () => {
    const onChange = vi.fn();
    render(
      <CountryCodeSelect value="+34" onChange={onChange} label="Indicativo" />,
    );
    openDropdown(screen.getByRole("combobox", { name: /indicativo/i }));
    fireEvent.click(screen.getByRole("option", { name: /méxico/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("+52");
  });

  it("keeps triggering the same dial code selected for duplicate +1 entries", () => {
    const onChange = vi.fn();
    render(
      <CountryCodeSelect value="+1" onChange={onChange} label="Indicativo" />,
    );
    const trigger = screen.getByRole("combobox", { name: /indicativo/i });
    expect(trigger).toHaveTextContent("+1");
    expect(trigger).toHaveTextContent("Estados Unidos");
    openDropdown(trigger);
    fireEvent.click(screen.getByRole("option", { name: /puerto rico/i }));
    expect(onChange).toHaveBeenCalledWith("+1");
  });
});
