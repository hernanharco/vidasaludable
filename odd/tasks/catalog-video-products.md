# Feature: catalog-video-products

Extends the video-segments work: (1) expand the Nutrilite catalog from
`docs/PriceList_April-2026_ES.pdf`, (2) show segment times as `mm:ss`, (3) link
products mentioned inside video segments to the catalog so the chat can relate
condition → video → product, (4) render product cards like video cards.

**Content honesty rule (from curatedProducts.ts):** benefits/dosage/ingredients
are NEVER fabricated — only transcribed from the price list, the detail fichas
in `~/Documentos/amway/`, or official amway.es product pages (with source
recorded). Rows without field sources stay `complete: false` and are flagged,
never inserted.

**Price calibration:** “Precio al cliente con IVA Península” column (verified:
100305 → 24.04 matches existing curation). Nutrition section = PDF pages 3–6,
row regex `^\d{4,6} ` (refs are 4–6 digits, e.g. `5847`).

## Tasks

| # | Task | Edit surfaces | Verification |
|---|------|---------------|--------------|
| 1 | Extract nutrition rows (≈74) from PriceList into a re-runnable script + curatedProducts entries (`complete:false` where no field source) | `backend/src/seed/**` | script output count ≈74; seed flags them, inserts 0 |
| 2 | Complete batch: video-mentioned products (Cal Mag D Plus 110606, Double X 121576, Proteína Vegetal 110415, Complejo B, Omega-3, Vitamina C, …) + detail-fichas → transcribe fields with source → `complete:true` | `backend/src/seed/**` | all batch rows complete; no invented text (spot-check vs source) |
| 3 | Seed + verify catalog in DB/CRM | none (run seed) | `products` count grows; idempotent re-run |
| 4 | Phase A — `formatTime` → `mm:ss` in CRM segment table, VideoCard, prompt block | `frontend/src/app/admin/**`, `frontend/src/app/components/chat/**`, `backend/src/agent/prompt.ts`, tests | RED→GREEN; build |
| 5 | Phase B backend — `mentioned_products` + `product_references` JSON on `video_segments` (DDL+schema+service); analyzer prompt injects catalog & extracts per-segment products; admin PATCH/POST fields; prompt block lines carry products; re-run pilot analyze | `backend/src/db/**`, `backend/src/services/**`, `backend/src/tools/**`, `backend/src/routes/admin.ts`, `backend/src/agent/prompt.ts`, tests | RED→GREEN; pilot segments carry product refs |
| 6 | ProductCard frontend + `GET /assistant/products` (public catalog map at boot) | `frontend/src/app/components/chat/**`, `frontend/src/app/admin/../assistant?` → backend `routes/assistant.ts`, tests | RED→GREEN; build |
| 7 | Full verification + native reviews per work-unit + close (evidence in this doc) | this doc | suites green; reviews approved |

## Evidence (commits per task)

- _(append as tasks close)_

## Decisions

- Catalog scope: Nutrición section only (pages 3–6) — the chat is a vitamin
  recommender; beauty/home rows are out of scope.
- Sets/conjuntos included as their own rows (category preserved from section).
- Product-mention matching in the analyzer is catalog-anchored: mention stays
  raw (`mentioned_products`) until an admin (or exact match) links a catalog
  ref (`product_references`).

## Progress

- T1 next: price-list extraction.
