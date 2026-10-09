// Backend that persists reviews (tileloading service). In dev the app calls the
// relative /api path, which the Vite dev server proxies to the backend
// (vite.config.ts) — same origin, so no CORS setup is needed. Builds hit the
// deployed service unless VITE_TILE_API_URL overrides it (that origin then has
// to be in the backend's EXTRA_CORS_ORIGINS).
export const TILE_API_PROD_URL = "https://windthrowai-tileloading-80422754009.europe-west3.run.app"
export const TILE_API_URL: string =
  import.meta.env.VITE_TILE_API_URL || (import.meta.env.DEV ? "/api" : TILE_API_PROD_URL)

// Windthrow detection results dataset (HF dataset repo).
const HF_RESULTS_REPO = "alexKlg/windthrowAI-dataset-segmentation_results"
const HF_RESULTS_BASE = `https://huggingface.co/datasets/${HF_RESULTS_REPO}/resolve/main`

// Expert review — per-tile model inputs + proposed masks live in the same dataset.
// inputs_index.csv lists every positive tile; inputs/ and masks/ hold the raw
// 7-band model input and the proposed segmentation mask for each tile_id.
export const INPUTS_INDEX_URL = `${HF_RESULTS_BASE}/inputs_index.csv`
// A round names each tile's files in inputs_index.csv (input_file, mask_file),
// one subfolder per grid row — Hugging Face caps a folder at 10,000 files.
// Rounds from before those columns keep everything flat, hence the fallback.
export const datasetFileUrl = (path: string) => `${HF_RESULTS_BASE}/${path}`
export const inputTifUrl = (tileId: string, file?: string) => datasetFileUrl(file ?? `inputs/${tileId}.tif`)
export const maskTifUrl = (tileId: string, file?: string) => datasetFileUrl(file ?? `masks/${tileId}.tif`)

// Precomputed windthrow coverage per tile (share of mask pixels that are
// windthrow, in %). Built offline by scripts/build-coverage-index.mjs and
// shipped as a static asset so the review UI can filter tiles by coverage
// *before* fetching any imagery. Regenerate with `npm run build:coverage`.
export const COVERAGE_INDEX_URL = `${import.meta.env.BASE_URL}coverage_index.json`

// Submit endpoint (tileloading backend). Reviews are persisted server-side.
export const REVIEW_API_URL = `${TILE_API_URL}/reviews`

// Per-tile review counts (n reviews + who reviewed it so far), built from the
// dataset's file listing. Powers the tiered tile picking in ExpertReviewTab.
export const REVIEW_SUMMARY_API_URL = `${TILE_API_URL}/reviews/summary`

// Minimal auth: reviewers register / log in with a username + password and
// receive a session token. The token is attached to each review submission so
// the backend can attribute it to the reviewer (and reject spoofed names).
export const AUTH_API_URL = `${TILE_API_URL}/auth/login`
export const REGISTER_API_URL = `${TILE_API_URL}/auth/register`

// Leaderboard: aggregated review counts per reviewer, sorted server-side.
export const RANKINGS_API_URL = `${TILE_API_URL}/rankings`

// Custom channel presets, persisted server-side per reviewer account (so they
// follow the reviewer across devices/browsers instead of living only in this
// browser's localStorage). Requires a signed-in reviewer — anonymous guests
// keep using the localStorage fallback (see utils/channels.ts).
export const PRESETS_API_URL = `${TILE_API_URL}/presets`

// The Amazon scan composites Landsat 8 Collection-2 L2 scenes from this window
// (see amazon-scan src/config.py DATE_FROM / DATE_TO). Used as the acquisition
// label whenever inputs_index.csv carries no per-tile date_first / date_last.
export const IMAGERY = {
  sensor: "Landsat 8",
  windowFrom: "2024-06-01",
  windowTo: "2024-09-30",
  fallbackLabel: "Jun–Sep 2024",
} as const
