// Precompute the windthrow coverage (% of pixels that are windthrow in the
// proposed mask) for every flagged tile, so the review UI can filter by
// coverage *before* fetching any imagery.
//
// Only a fallback: the app takes coverage from the `coverage` column of
// inputs_index.csv whenever the index has one (every export since the
// row-folder layout does) and loads this file only for an index without it.
//
// Run: npm run build:coverage
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
// Same fallback as maskTifUrl in src/constants.ts: a round names each mask in
// the `mask_file` column (one subfolder per grid row, masks/r0341/<id>.tif);
// rounds from before that column keep masks/ flat.
const maskUrl = tile => `${HF_BASE}/${tile.maskFile ?? `masks/${tile.id}.tif`}`

const CONCURRENCY = 24
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../public/coverage_index.json")

async function fetchTiles() {
  const res = await fetch(INDEX_URL)
  if (!res.ok) throw new Error(`inputs_index.csv: ${res.status}`)
  const lines = (await res.text()).trim().split(/\r?\n/)
  const header = lines[0].split(",")
  const idCol = header.indexOf("tile_id")
  if (idCol === -1) throw new Error("inputs_index.csv missing tile_id column")
  const maskCol = header.indexOf("mask_file")
  const kindCol = header.indexOf("kind")
  return lines
    .slice(1)
    .map(l => l.split(","))
    // Spot checks stay out, as in fetchTileIndex: their coverage is 0 by construction.
    .filter(cols => cols[idCol] && cols[kindCol] !== "control")
    .map(cols => ({ id: cols[idCol], maskFile: cols[maskCol] || undefined }))
}

// Coverage = fraction of nonzero mask pixels, as a percentage. Mirrors the
// browser's rule in loadPatch (mask value > 0 counts as windthrow).
async function coverageOf(tile) {
  const res = await fetch(maskUrl(tile))
  if (!res.ok) throw new Error(`mask ${tile.id}: ${res.status}`)
  const tiff = await fromArrayBuffer(await res.arrayBuffer())
  const image = await tiff.getImage()
  const [band] = await image.readRasters()
  let on = 0
  for (let i = 0; i < band.length; i++) if (band[i] > 0) on++
  return band.length ? (on / band.length) * 100 : 0
}

async function main() {
  const tiles = await fetchTiles()
  console.log(`Computing coverage for ${tiles.length} tiles…`)
  const index = {}
  let done = 0
  let failed = 0

  // Fixed-size worker pool over the tile list.
  let cursor = 0
  async function worker() {
    while (cursor < tiles.length) {
      const tile = tiles[cursor++]
      try {
        index[tile.id] = Math.round((await coverageOf(tile)) * 100) / 100 // 2 decimals
      } catch (e) {
        failed++
        console.warn(`  ! ${tile.id}: ${e.message}`)
      }
      if (++done % 50 === 0) console.log(`  ${done}/${tiles.length}`)
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
