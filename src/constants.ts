// Backend that persists reviews (tileloading service).
export const TILE_API_URL = "https://windthrowai-tileloading-80422754009.europe-west3.run.app"

// Windthrow detection results dataset (HF dataset repo).
const HF_RESULTS_REPO = "alexKlg/windthrowAI-dataset-segmentation_results"
const HF_RESULTS_BASE = `https://huggingface.co/datasets/${HF_RESULTS_REPO}/resolve/main`

// Expert review — per-tile model inputs + proposed masks live in the same dataset.
// inputs_index.csv lists every positive tile; inputs/ and masks/ hold the raw
// 7-band model input and the proposed segmentation mask for each tile_id.
export const INPUTS_INDEX_URL = `${HF_RESULTS_BASE}/inputs_index.csv`
export const inputTifUrl = (tileId: string) => `${HF_RESULTS_BASE}/inputs/${tileId}.tif`
export const maskTifUrl = (tileId: string) => `${HF_RESULTS_BASE}/masks/${tileId}.tif`

// Submit endpoint (tileloading backend). Reviews are persisted server-side.
export const REVIEW_API_URL = `${TILE_API_URL}/reviews`

// Minimal auth: reviewers register / log in with a username + password and
// receive a session token. The token is attached to each review submission so
// the backend can attribute it to the reviewer (and reject spoofed names).
export const AUTH_API_URL = `${TILE_API_URL}/auth/login`
export const REGISTER_API_URL = `${TILE_API_URL}/auth/register`

// Leaderboard: aggregated review counts per reviewer, sorted server-side.
export const RANKINGS_API_URL = `${TILE_API_URL}/rankings`
