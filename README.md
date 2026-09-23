# WindthrowAI — Expert Review

A standalone browser tool for expert review of tropical-forest windthrow
segmentation masks. Reviewers are shown a random positive Landsat patch with the
model's proposed mask overlaid, and can:

- switch band combinations (True Color, Vegetation/nIR, SWIR, NBR),
- paint / erase the mask with an adjustable brush,
- **Submit** the (optionally edited) mask,
- mark **No windthrow** (false positive),
- confirm with **No change needed** (mask is correct as-is),
- **Skip** to another random tile.

Each submission is posted to the review backend, which persists the verdict and
the resulting mask server-side.

This app was split out of the main WindthrowAI segmentation frontend so the
review workflow can be shared independently.

## Data & backend

Configuration lives in [`src/constants.ts`](src/constants.ts):

- **Tiles + proposed masks** come from the Hugging Face dataset
  `alexKlg/windthrowAI-dataset-segmentation_results`
  (`inputs_index.csv`, `inputs/<tile_id>.tif`, `masks/<tile_id>.tif`).
- **Reviews** are submitted to `POST {TILE_API_URL}/reviews`. When
  `inputs_index.csv` carries a `scan_id` column (the export round the tiles
  came from), it's sent along with each submission so the backend can record
  which round a review belongs to; older indexes without the column still
  work, just without that field.
- **Tiered tile picking**: `GET {TILE_API_URL}/reviews/summary` returns how
  many times each tile has been reviewed and by whom. The review tab uses it
  to favour unreviewed and single-reviewed tiles over ones a reviewer (or
  someone else) already looked at, instead of picking uniformly at random. If
  that endpoint is unreachable, every tile looks unreviewed and the picker
  falls back to a uniform random draw.

Point these at your own dataset / backend by editing `constants.ts`.

## Develop

```bash
npm install
npm run dev      # start Vite dev server
npm run build    # type-check + production build into dist/
npm run preview  # preview the production build
npm run lint
```

## Deploy

`npm run build` emits a static site into `dist/`. The included GitHub Actions
workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml))
builds and publishes it to GitHub Pages on every push to `master`/`main`.

`vite.config.ts` uses `base: './'`, so the build works whether it is served
from a domain root or a project subpath.

## Tech stack

React 19 · TypeScript · Vite · [geotiff.js](https://github.com/geotiffjs/geotiff.js)
for reading the multi-band GeoTIFF patches in the browser.
