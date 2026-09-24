import nodemailer from "nodemailer";

/**
 * Email service for sending assessment results.
 *
 * Uses SMTP configuration from environment variables:
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Falls back to a console log in development (no real SMTP needed).
 */

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  message: string;
}

let transporter: nodemailer.Transporter | null = null;

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  } else {
    // Development: log instead of sending
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return transporter;
}

/**
 * Send an email. In development, logs the email instead of sending.
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const transport = await getTransporter();
  const from = process.env.SMTP_FROM || "noreply@vidasaludable.rincom.es";

  const info = await transport.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    attachments: options.attachments,
  });

  const isDev = !process.env.SMTP_HOST;
  const messageId = info.messageId || "dev-log";

  return {
    success: true,
    messageId,
    message: isDev
      ? `Email registrado en consola (dev). MessageId: ${messageId}`
      : `Email enviado a ${options.to}. MessageId: ${messageId}`,
  };
}

/**
 * Build the HTML email for assessment results.
 */
export function buildAssessmentEmailHtml(options: {
  patientName: string;
  urgentCount: number;
  deficientCount: number;
  okCount: number;
  recommendations: Array<{ name: string; status: string; ratio: number }>;
}): string {
  const recRows = options.recommendations
    .map(
      (r) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${r.name}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;color:${r.status === "urgent" ? "#dc2626" : "#d97706"};">
        ${r.status === "urgent" ? "🔴 Urgente" : "⚠️ En Falta"} (${Math.round(r.ratio * 100)}%)
      </td>
    </tr>`,
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#065f46;color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:20px;">Evaluación de Prevención</h1>
    <p style="margin:4px 0 0;opacity:0.8;font-size:14px;">Medicina Funcional & Hábitos</p>
  </div>
  
  <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;">
    <p style="color:#374151;">Hola <strong>${options.patientName}</strong>,</p>
    <p style="color:#6b7280;">Adjuntamos el resultado de su evaluación de prevención.</p>
    
    <div style="display:flex;gap:12px;margin:20px 0;">
      <div style="flex:1;background:#ecfdf5;padding:12px;border-radius:6px;text-align:center;">
        <div style="font-size:24px;font-weight:bold;color:#059669;">${options.okCount}</div>
        <div style="font-size:12px;color:#065f46;">OK</div>
      </div>
      <div style="flex:1;background:#fffbeb;padding:12px;border-radius:6px;text-align:center;">
        <div style="font-size:24px;font-weight:bold;color:#d97706;">${options.deficientCount}</div>
        <div style="font-size:12px;color:#92400e;">En Falta</div>
      </div>
      <div style="flex:1;background:#fef2f2;padding:12px;border-radius:6px;text-align:center;">
        <div style="font-size:24px;font-weight:bold;color:#dc2626;">${options.urgentCount}</div>
        <div style="font-size:12px;color:#991b1b;">Urgente</div>
      </div>
    </div>

    ${
      options.recommendations.length > 0
        ? `
    <h3 style="color:#1f2937;font-size:16px;">Recomendaciones</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;">Nutriente</th>
          <th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;">Estado</th>
        </tr>
      </thead>
      <tbody>${recRows}</tbody>
    </table>
    `
        : ""
    }
  </div>
  
  <div style="background:#f9fafb;padding:16px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
      Este informe es orientativo y no sustituye una consulta médica profesional.<br>
      Dr. Andrea — Medicina Funcional & Hábitos
    </p>
  </div>
</body>
</html>`;
}
