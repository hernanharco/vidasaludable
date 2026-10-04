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

- T1: price-list extraction (78 rows, 75 flagged, anchors verified) — `202f5d91`
  · reviewed HIGH 4-lens APPROVED (lineage df5d4170, 15 advisory)
- T2: 14 complete products from official PDPs (13 new + Double X completed),
  pdpParser test-first, price fix 121576→86.87 — `dc855c4e` + `17c2d1c6`
  (scoring static catalog) · reviewed APPROVED (lineage 0a9ec2d1, 3 advisory:
  R3-PDPFALLBACK, R3-PDPWIRING, R3-SCOREPRICE)
- T3: seed + CRM verified live — 16 products served by /admin/catalog
  (Cal Mag €29.71, Double X €86.87); idempotent seed; suite 171/171, tsc clean
- T4: Phase A mm:ss (formatTime helper, CRM table, VideoCard chip, prompt
  ranges, raw seconds kept in DB/API) — `478367f1` · reviewed APPROVED
  (lineage 75146bb6; two reviewer payloads refused at admission for a
  trailing-period path citation in reviewer prose — relaunched per protocol,
  third admitted; 2 advisory: R3-BACKEND-FORMAT-DUPLICATION,
  R3-PARTIAL-TIME-PAYLOAD)
- T5: Phase B product mentions — `6aeefb04` · reviewed APPROVED (lineage
  70b83191, 2 advisory: R3-ColloquialPairingNeverRenders,
  R3-DuplicateRefsRenderTwice). Pilot re-run: 19 segments, 14 mentions,
  12 with catalog refs (126132×7, 110606×4, 109741×4, 121576×3, 110178×3…).
  Note: first analyzer prompt linked 0 refs (colloquial “Calmac”/“doble X”)
  → prompt reworded to link by correspondence, strict ref validation kept.
- T6: ProductCard + GET /assistant/products — `c5b1abf6` · reviewed APPROVED
  (lineage 9a8db9f1, 1 advisory: R3-DisclaimerNeverRendered — suggestion,
  backlog). Unknown product refs stay literal (unlike videos); [VIDEO:id]
  vs [d4-6] coexistence tested.
- T7: FULL VERIFICATION — backend 195/195 + tsc clean · frontend 46/46 +
  build clean · migrate idempotent · data: 16 products, 19 segments,
  12 with catalog refs, 0 enabled (owner approval pending).
  Final inspect `3931f32b…` = .atl only → documentation-only skip.
  FEATURE COMPLETE.

## Decisions

- Catalog scope: Nutrición section only (pages 3–6) — the chat is a vitamin
  recommender; beauty/home rows are out of scope.
- Sets/conjuntos included as their own rows (category preserved from section).
- Product-mention matching in the analyzer is catalog-anchored: mention stays
  raw (`mentioned_products`) until an admin (or exact match) links a catalog
  ref (`product_references`).

## Progress
- T1–T4 DONE (see Evidence). Sources learned: amway.es PDPs via Jina keyless
  (r.jina.ai); the hidden "Detalles" tab lives in the embedded RSC payload —
  `x-respond-with: html` exposes dosage/ingredients/aviso. Flippingbook catalogs
  and Wayback have no extractable text; local fichas were cart screenshots.
- T6 DONE (see Evidence). Advisory backlog across the feature: T1 15 · T2 3 ·
  T4 2 · T5 2 · T6 1 = 23 findings inventoried above.
- T7 DONE — FEATURE COMPLETE.
