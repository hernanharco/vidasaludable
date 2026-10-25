// Country dialing codes for international phone numbers.
// UI language: Spanish (neutral/professional).

export interface CountryCode {
  /** Dialing code including "+", e.g. "+34" */
  code: string;
  /** Country name in Spanish */
  name: string;
  /** ISO 3166-1 alpha-2 code, uppercase; used for the flag image. */
  iso: string;
}

/** Flag image URL for an ISO alpha-2 code (public flagcdn.com CDN). */
export function flagUrl(iso: string): string {
  return `https://flagcdn.com/w40/${iso.toLowerCase()}.svg`;
}

export const DEFAULT_COUNTRY_CODE = "+34";

export const COUNTRY_CODES: CountryCode[] = [
  { code: "+34", name: "España", iso: "ES" },
  { code: "+52", name: "México", iso: "MX" },
  { code: "+54", name: "Argentina", iso: "AR" },
  { code: "+56", name: "Chile", iso: "CL" },
  { code: "+57", name: "Colombia", iso: "CO" },
  { code: "+51", name: "Perú", iso: "PE" },
  { code: "+58", name: "Venezuela", iso: "VE" },
  { code: "+593", name: "Ecuador", iso: "EC" },
  { code: "+591", name: "Bolivia", iso: "BO" },
  { code: "+595", name: "Paraguay", iso: "PY" },
  { code: "+598", name: "Uruguay", iso: "UY" },
  { code: "+505", name: "Nicaragua", iso: "NI" },
  { code: "+506", name: "Costa Rica", iso: "CR" },
  { code: "+507", name: "Panamá", iso: "PA" },
  { code: "+504", name: "Honduras", iso: "HN" },
  { code: "+503", name: "El Salvador", iso: "SV" },
  { code: "+502", name: "Guatemala", iso: "GT" },
  { code: "+53", name: "Cuba", iso: "CU" },
  { code: "+1", name: "Estados Unidos / Canadá", iso: "US" },
  { code: "+1", name: "Puerto Rico / Rep. Dominicana", iso: "PR" },
  { code: "+351", name: "Portugal", iso: "PT" },
  { code: "+33", name: "Francia", iso: "FR" },
  { code: "+39", name: "Italia", iso: "IT" },
  { code: "+49", name: "Alemania", iso: "DE" },
  { code: "+44", name: "Reino Unido", iso: "GB" },
  { code: "+353", name: "Irlanda", iso: "IE" },
  { code: "+31", name: "Países Bajos", iso: "NL" },
  { code: "+32", name: "Bélgica", iso: "BE" },
  { code: "+41", name: "Suiza", iso: "CH" },
  { code: "+43", name: "Austria", iso: "AT" },
  { code: "+46", name: "Suecia", iso: "SE" },
  { code: "+47", name: "Noruega", iso: "NO" },
  { code: "+45", name: "Dinamarca", iso: "DK" },
  { code: "+358", name: "Finlandia", iso: "FI" },
  { code: "+48", name: "Polonia", iso: "PL" },
  { code: "+420", name: "República Checa", iso: "CZ" },
  { code: "+30", name: "Grecia", iso: "GR" },
  { code: "+7", name: "Rusia", iso: "RU" },
  { code: "+380", name: "Ucrania", iso: "UA" },
  { code: "+86", name: "China", iso: "CN" },
  { code: "+81", name: "Japón", iso: "JP" },
  { code: "+82", name: "Corea del Sur", iso: "KR" },
  { code: "+91", name: "India", iso: "IN" },
  { code: "+92", name: "Pakistán", iso: "PK" },
  { code: "+62", name: "Indonesia", iso: "ID" },
  { code: "+66", name: "Tailandia", iso: "TH" },
  { code: "+84", name: "Vietnam", iso: "VN" },
  { code: "+63", name: "Filipinas", iso: "PH" },
  { code: "+60", name: "Malasia", iso: "MY" },
  { code: "+65", name: "Singapur", iso: "SG" },
  { code: "+90", name: "Turquía", iso: "TR" },
  { code: "+972", name: "Israel", iso: "IL" },
  { code: "+971", name: "Emiratos Árabes", iso: "AE" },
  { code: "+966", name: "Arabia Saudita", iso: "SA" },
  { code: "+212", name: "Marruecos", iso: "MA" },
  { code: "+20", name: "Egipto", iso: "EG" },
  { code: "+234", name: "Nigeria", iso: "NG" },
  { code: "+27", name: "Sudáfrica", iso: "ZA" },
  { code: "+254", name: "Kenia", iso: "KE" },
  { code: "+61", name: "Australia", iso: "AU" },
  { code: "+64", name: "Nueva Zelanda", iso: "NZ" },
];

/**
 * Builds an E.164-style phone string: dialing code + local digits.
 * Strips spaces, dashes and parentheses from the local number.
 */
export function formatPhone(code: string, number: string): string {
  const digits = number.replace(/[\s\-()]/g, "");
  return `${code}${digits}`;
}