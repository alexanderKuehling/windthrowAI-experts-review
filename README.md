# WindthrowAI — Expert Review

> Operating the review → retrain → rescan loop: see [`LOOP.md`](../LOOP.md) (lives next to the repos, outside git).

A standalone browser tool for expert review of tropical-forest windthrow
segmentation masks from the Amazon scan (`windthrowAI-amazon-scan`). Reviewers
sign in and are shown a flagged Landsat 8 tile with the model's proposed mask
overlaid, and can:

- switch band combinations (True Color, Vegetation/nIR, SWIR, NBR, …), view
  them all side by side with **Compare all**, and save their own presets in
  the **Channels** tab,
- paint / erase the mask with an adjustable brush, undoing strokes with
  ⌘Z / Ctrl+Z (redo: ⇧⌘Z / Ctrl+Y),
- zoom in (pinch, ⌘/Ctrl + scroll, or the − / + buttons and keys) and move
  around with scroll or Space + drag, and set how big each plot is drawn,
- **Submit** the (optionally edited) mask,
- mark **No windthrow** (false positive),
- confirm with **No change needed** (mask is correct as-is),
- **Skip** to another tile.

**Which tile comes next.** The picker favours tiles nobody has reviewed yet,
then tiles with a single review, using `GET /reviews/summary`. If that endpoint
is unreachable, every tile looks unreviewed and the picker falls back to a
uniform random draw. A coverage filter hides tiles whose proposed mask covers
less than 30 px (2.7 ha, 0.05 % of the tile), the patch size amazon-scan's
export rule requires; reviewers can move it with the slider.

About 1 in 10 tiles is a **spot check**: a random tile the model *rejected*
(`kind=control` in `inputs_index.csv`), shown with a blue note, no proposed mask
and its own buttons: "No windthrow: model is right", or paint and "Save: the
model missed this". Spot checks ignore the coverage filter. They are the only way
reviews can reveal what the model misses, and they feed the retraining gate's
check against a classifier drifting into flagging plain forest.

Signed-in reviewers also see the **Rankings** tab. "Continue without signing
in" lets people look around: browse tiles, paint, skip, build presets. The
decision buttons stay disabled for guests, because the deployed backend
rejects reviews without a session token.

This app was split out of the main WindthrowAI segmentation frontend so the
review workflow can be shared independently.

## Data & backend

Configuration lives in [`src/constants.ts`](src/constants.ts):

- **Tiles + proposed masks** come from the Hugging Face dataset
  `alexKlg/windthrowAI-dataset-segmentation_results`, always read from
  `resolve/main` and decoded in the browser. `inputs_index.csv` lists every
  exported tile. Its `input_file` and `mask_file` columns name the tile's files,
  one subfolder per grid row (`inputs/r0341/r0341_c0123.tif`), because Hugging
  Face caps a folder at 10,000 files. Rounds from before those columns keep
  `inputs/<tile_id>.tif` and `masks/<tile_id>.tif` flat, and the app falls back
  to that.
- **Other index columns** are optional and read by header name: `coverage`,
  `kind` (`flagged` / `control`), `nbr_encoding` (`raw` = NBR in −1…1; absent =
  the older `(NBR + 1) / 2`), `scan_id`, `clf_prob`, `max_patch_px`, the bbox
  and the acquisition dates.
- **Coverage** comes from the `coverage` column. Only for an index without it
  does the app load [`public/coverage_index.json`](public/coverage_index.json),
  built by `npm run build:coverage`
  ([`scripts/build-coverage-index.mjs`](scripts/build-coverage-index.mjs)).
- **Backend**: the `windthrowAI-tileloading` service on Cloud Run
  (`TILE_API_PROD_URL`). The app calls `/auth/login`, `/auth/register`,
  `/auth/me`, `POST /reviews`, `GET /reviews/summary`, `/rankings` and
  `/presets`. The backend stores each review as
  `reviews/{tile_id}/{ts}__p{pixels}__{reviewer}.json` + `.png` in the same
  dataset. The `scan_id` from the index goes along with every submission, so
  retraining pulls exactly the image the reviewer saw; older indexes without
  the column still work, just without that field.

Point these at your own dataset / backend by editing `constants.ts`.

## Develop

```bash
npm ci
npm run dev      # Vite dev server on :5173, proxies /api to http://localhost:8080
npm run build    # type-check + production build into dist/
npm run preview  # preview the production build
npm run lint
```

In dev the app calls `/api`, which Vite forwards to the tileloading backend
([`vite.config.ts`](vite.config.ts)). Start that backend locally with
`./dev.sh` in `windthrowAI-tileloading` (it needs the GEE key file, and an
`HF_WRITE_TOKEN` in its `.env` to store reviews), or develop against
production:

```bash
TILE_API_PROXY_TARGET=https://windthrowai-tileloading-80422754009.europe-west3.run.app npm run dev
```

`../dev.sh` / `../dev_stop.sh` start and stop backend and frontend together in
screen sessions; they expect `windthrowAI-tileloading` checked out next to this
repo.

To build against a different backend, set `VITE_TILE_API_URL=https://<backend>`
for `npm run build`. That origin has to be in the backend's
`EXTRA_CORS_ORIGINS`.

There are no automated tests; `npm run build` (includes `tsc -b`) and
`npm run lint` are the checks.

## Deploy

Every push to `main` runs the GitHub Actions workflow
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)), which builds
the site and publishes it to GitHub Pages:
<https://earthyscience.github.io/windthrowAI-experts-review/>. When a change
also needs a new backend, deploy the backend first.

`vite.config.ts` uses `base: './'`, so the build works whether it is served
from a domain root or a project subpath.

## Tech stack

React 19 · TypeScript · Vite · [geotiff.js](https://github.com/geotiffjs/geotiff.js)
for reading the multi-band GeoTIFF patches in the browser.
