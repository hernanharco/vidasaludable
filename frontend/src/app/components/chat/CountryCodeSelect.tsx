import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select";
import {
  COUNTRY_CODES,
  flagUrl,
  type CountryCode,
} from "../../lib/countryCodes";

/**
 * Dial-code picker with the country's real flag (flagcdn.com) instead of a
 * plain native `<select>`. Built on the shadcn/Radix Select so it works
 * identically on every OS — Windows shows the flag image, which emoji-based
 * pickers cannot do. The wire value stays the dial code string (e.g. "+34"),
 * so RegistrationGate and ChatSession are unaffected. The duplicated "+1"
 * entries are disambiguated by name and resolve to the first match.
 */
interface CountryCodeSelectProps {
  /** Dial code, e.g. "+34" (wire value emitted back via onChange). */
  value: string;
  onChange: (code: string) => void;
  /** Accessible name for the trigger, e.g. "Indicativo del país". */
  label: string;
  className?: string;
}

/** Radix Select values must be unique; dial codes alone are not (+1). */
function optionKey(c: CountryCode): string {
  return `${c.code}-${c.name}`;
}

function FlagImg({ country, className }: { country: CountryCode; className: string }) {
  return (
    <img
      src={flagUrl(country.iso)}
      alt={`Bandera de ${country.name}`}
      className={className}
      loading="lazy"
      // If the CDN is unreachable, keep the dial code readable instead of
      // rendering the browser's broken-image glyph.
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

const flagCls = "w-5 h-auto rounded-[2px] shrink-0";
const itemFlagCls = "w-5 h-auto rounded-[2px] shrink-0";

export function CountryCodeSelect({
  value,
  onChange,
  label,
  className,
}: CountryCodeSelectProps) {
  // First entry matching the dial code wins (both +1 rows share the value).
  const selected: CountryCode =
    COUNTRY_CODES.find((c) => c.code === value) ?? COUNTRY_CODES[0]!;
  return (
    <Select
      value={optionKey(selected)}
      onValueChange={(key) => {
        const entry = COUNTRY_CODES.find((c) => optionKey(c) === key);
        if (entry) onChange(entry.code);
      }}
    >
      <SelectTrigger
        aria-label={label}
        className={className ?? "w-[152px] shrink-0 bg-stone-100 border-stone-200"}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <FlagImg country={selected} className={flagCls} />
          <span className="truncate">
            {selected.code} {selected.name}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {COUNTRY_CODES.map((c) => (
          <SelectItem key={optionKey(c)} value={optionKey(c)}>
            <span className="flex items-center gap-2">
              <FlagImg country={c} className={itemFlagCls} />
              <span>
                {c.code} {c.name}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
