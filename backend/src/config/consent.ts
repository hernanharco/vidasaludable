/**
 * Informed-consent source of truth.
 *
 * `CURRENT_CONSENT_VERSION` is the single versioned constant the whole system
 * checks against. It MUST be bumped whenever the consent/legal text changes.
 * Customers whose `consent_version < CURRENT_CONSENT_VERSION` are re-consented
 * before any new recommendation; prior records are preserved (version-gated,
 * not presence-gated — see design ADR and recommendation-audit-log spec).
 */
export const CURRENT_CONSENT_VERSION = 2;

export const CONSENT_TEXT = `CONSENTIMIENTO INFORMADO — RECOMENDADOR PREVENTIVO NUTRILITE™

Al continuar, usted declara que ha leído y acepta los siguientes términos antes de
recibir cualquier recomendación:

1. FINALIDAD. Este asistente le ofrece orientación general de prevención y apoyo al
   estilo de vida con productos Nutrilite™. NO proporciona diagnóstico, tratamiento,
   cura ni prescripción médica de ninguna enfermedad o condición de salud. Este
   programa pertenece a los empresarios que lo ofrecen y no representa, patrocina ni
   está afiliado de ninguna manera con la empresa Nutrilite™; solo se hace uso de
   sus productos.

2. NATURALEZA INFORMATIVA. Las recomendaciones son de carácter orientativo y se basan
   en la información que usted facilita. No sustituyen la consulta, el diagnóstico ni
   el tratamiento de un profesional sanitario. Si tiene síntomas persistentes, dolor o
   sospecha de alguna enfermedad, consulte a su médico.

3. USO DE SUS DATOS. Sus datos de identificación (nombre, correo electrónico y teléfono)
   y el historial de sus conversaciones y recomendaciones se almacenan exclusivamente
   para: (a) personalizar las sugerencias preventivas, (b) mantener la continuidad de la
   conversación y (c) cumplir con el registro auditable de recomendaciones exigido por la
   normativa de protección de datos (LOPD/GDPR). Sus datos no se cederán a terceros salvo
   obligación legal.

4. CONSENTIMIENTO VERSIÓN ${CURRENT_CONSENT_VERSION}. Usted acepta esta versión del
   consentimiento. Si en el futuro esta versión cambia, se le solicitará un nuevo
   consentimiento antes de seguir recibiendo recomendaciones.

5. REVOCACIÓN. Puede solicitar la supresión o revisión de sus datos en cualquier momento
   dirigiéndose a la persona que le recomendó esta página.

Al aceptar, confirma que es mayor de edad y que acepta estos términos voluntariamente.`;

export interface ConsentInfo {
  version: number;
  text: string;
}

/** Returns the current consent version and exact legal text for the chat UI. */
export function getCurrentConsent(): ConsentInfo {
  return { version: CURRENT_CONSENT_VERSION, text: CONSENT_TEXT };
}