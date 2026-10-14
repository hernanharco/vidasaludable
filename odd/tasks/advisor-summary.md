# Feature: advisor-summary (resumen ejecutivo IA por cliente)

Resumen ejecutivo generado con IA, bajo demanda, por cliente: la asesora entra
a la ficha del cliente y ve qué está consultando, qué se le recomendó y el
siguiente paso sugerido, sin armar el rompecabezas entre 5 pantallas del admin.
Reutiliza el cliente Gemini existente (`backend/src/agent/gemini.ts`).

## Specs

### S1 — Formato: resumen ejecutivo (IA)

> "Resumen ejecutivo (IA)" — "Además de la ficha, un resumen generado del chat:
> qué quiere el cliente, dolores, objeciones, siguiente paso sugerido."

El resumen cubre: qué consulta el cliente, dolores/objeciones mencionados, qué
se le recomendó y el siguiente paso sugerido para la asesora.

### S2 — Usuario: la asesora/nutricionista

> "La asesora/nutricionista" — "Persona técnica que asesora y vende; necesita
> ver recomendaciones y contexto de salud."

Visible en el admin autenticado (`/admin`), mismo gate JWT existente. Ningún
cambio de auth.

### S3 — Generación bajo demanda (botón)

> "Bajo demanda (botón)" — "La asesora aprieta 'Generar resumen' y queda
> guardado. Controla cuándo gasta cuota de Gemini y siempre resume hasta ese
> momento."

Existe un botón que genera (o regenera) el resumen; el resultado queda guardado
en DB. Sin cron ni generación automática. Muestra cuándo se generó.

### S4 — Alcance: por cliente, con toda su historia

> "Por cliente (recomendado)" — "Un resumen por cliente con toda su historia:
> encuesta + todos sus chats + compras."

Un solo resumen por cliente que agrega: perfil/encuesta, todos sus mensajes de
chat, sus recomendaciones del log y sus compras.

## Tasks

| ID | Specs | Ruta | Commit |
|----|-------|------|--------|
| T1 | S1, S4 | backend — tabla `customer_summaries` (migrate.ts DDL + schema.ts) + test de migración | — |
| T2 | S1, S3, S4 | backend — `summaryService` (contexto + prompt + Gemini), rutas `GET/POST /admin/customers/:id/summary` + tests de integración (Gemini mockeado) | — |
| T3 | S1, S2, S3 | frontend — `CustomerDetailPage` con bloque de resumen + botón Generar/Regenerar, ruta y link desde CustomersPage, `api.ts` | — |
| T4 | S1–S4 | frontend — tests de la ficha/resumen + suites completas verdes + docs | — |

## Log

- **L1** (2026-10-14, petición original verbatim): "hoy vamos a trabajar,
  conversemos se necesita algo informativo de que necesita el cliente. que
  tenemos hasta el momento el cliente hace la cuesta habla con el bot y este le
  hace unas recomendaciones pero estas recomendaciones la debe de conocer la
  persona que tiene el codigo para asi saber que esta consultando y que debe
  venderle o que informacion manejar hacia la persona. mejor dicho conocer que
  esta ocurriendo para darle asesoria"
- **L2** (2026-10-14, decisiones de producto): formato = "Resumen ejecutivo
  (IA)" (S1); usuario = "La asesora/nutricionista" (S2).
- **L3** (2026-10-14, decisiones de diseño): cuándo = "Bajo demanda (botón)"
  (S3); alcance = "Por cliente" con encuesta + chats + compras (S4). Se descartó
  "Alertas/Bandeja" e "Informe exportable".
