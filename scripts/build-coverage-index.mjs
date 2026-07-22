// Precompute the windthrow coverage (% of pixels that are windthrow in the
// proposed mask) for every positive tile, so the review UI can filter by
// coverage *before* fetching any imagery.
//
// Run: node scripts/build-coverage-index.mjs
// Output: public/coverage_index.json  { "<tile_id>": <coveragePercent>, ... }
//
// Re-run whenever the dataset's masks/ or inputs_index.csv change.
import { fromArrayBuffer } from "geotiff"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HF_BASE =
  "https://huggingface.co/datasets/alexKlg/windthrowAI-dataset-segmentation_results/resolve/main"
const INDEX_URL = `${HF_BASE}/inputs_index.csv`
const maskUrl = id => `${HF_BASE}/masks/${id}.tif`

const CONCURRENCY = 24
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../public/coverage_index.json")

async function fetchTileIds() {
  const res = await fetch(INDEX_URL)
  if (!res.ok) throw new Error(`inputs_index.csv: ${res.status}`)
  const lines = (await res.text()).trim().split(/\r?\n/)
  const idCol = lines[0].split(",").indexOf("tile_id")
  if (idCol === -1) throw new Error("inputs_index.csv missing tile_id column")
  return lines.slice(1).map(l => l.split(",")[idCol]).filter(Boolean)
}

// Coverage = fraction of nonzero mask pixels, as a percentage. Mirrors the
// browser's rule in loadPatch (mask value > 0 counts as windthrow).
async function coverageOf(id) {
  const res = await fetch(maskUrl(id))
  if (!res.ok) throw new Error(`mask ${id}: ${res.status}`)
  const tiff = await fromArrayBuffer(await res.arrayBuffer())
  const image = await tiff.getImage()
  const [band] = await image.readRasters()
  let on = 0
  for (let i = 0; i < band.length; i++) if (band[i] > 0) on++
  return band.length ? (on / band.length) * 100 : 0
}

async function main() {
  const ids = await fetchTileIds()
  console.log(`Computing coverage for ${ids.length} tiles…`)
  const index = {}
  let done = 0
  let failed = 0

  // Fixed-size worker pool over the id list.
  let cursor = 0
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++]
      try {
        index[id] = Math.round((await coverageOf(id)) * 100) / 100 // 2 decimals
      } catch (e) {
        failed++
        console.warn(`  ! ${id}: ${e.message}`)
      }
      if (++done % 50 === 0) console.log(`  ${done}/${ids.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  await mkdir(dirname(OUT), { recursive: true })
  // Sort keys so the file diffs cleanly when regenerated.
  const sorted = Object.fromEntries(Object.keys(index).sort().map(k => [k, index[k]]))
  await writeFile(OUT, JSON.stringify(sorted) + "\n")
  console.log(`Wrote ${OUT} (${Object.keys(sorted).length} tiles, ${failed} failed).`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
