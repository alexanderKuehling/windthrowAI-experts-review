// A deterministic synthetic tile used by the help previews, so the modal works
// offline and before the first real tile has downloaded. Band order matches
// the real pipeline: R G B nIR swIR1 swIR2 NBR (NBR rescaled to [0,1]).

export interface DemoPatch {
  width: number
  height: number
  bands: Float32Array[]
  mask: Uint8Array
}

// mulberry32 — small, fast, seeded PRNG. Fixed seed so previews are
// byte-identical on every open.
function mulberry32(seed: number) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FOREST_MEANS = { R: 0.03, G: 0.05, B: 0.02, nIR: 0.3, swIR1: 0.13, swIR2: 0.05, NBR: 0.85 }
const SCAR_MEANS = { nIR: 0.18, swIR1: 0.19, swIR2: 0.1, NBR: 0.6 }

let cached: DemoPatch | null = null

export function makeDemoPatch(size = 96): DemoPatch {
  if (cached && cached.width === size) return cached

  const rnd = mulberry32(20260826) // fixed seed
  const n = size * size
  const bandOrder: (keyof typeof FOREST_MEANS)[] = ["R", "G", "B", "nIR", "swIR1", "swIR2", "NBR"]
  const bands = bandOrder.map(() => new Float32Array(n))

  // Elongated, rotated ellipse — the windthrow scar.
  const cx = size * 0.55
  const cy = size * 0.45
  const angle = 0.6 // radians
  const a = size * 0.32 // semi-major
  const b = size * 0.11 // semi-minor
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  function inScar(x: number, y: number): number {
    const dx = x - cx
    const dy = y - cy
    const u = dx * cos + dy * sin
    const v = -dx * sin + dy * cos
    const d = (u * u) / (a * a) + (v * v) / (b * b)
    return d // < 1 inside
  }

  // Smooth low-amplitude noise via a few sine terms (deterministic, no per-pixel PRNG needed
  // beyond a couple of seeded coefficients).
  const nf1 = rnd() * 0.02 + 0.01
  const nf2 = rnd() * 0.02 + 0.01
  const nPhase = rnd() * Math.PI * 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const noise = Math.sin(x * nf1 + nPhase) * Math.cos(y * nf2) * 0.01
      const d = inScar(x, y)
      const t = d < 1 ? Math.max(0, 1 - d) : 0 // soft falloff at the scar edge

      bandOrder.forEach((band, bi) => {
        const forest = FOREST_MEANS[band]
        const scar = band in SCAR_MEANS ? SCAR_MEANS[band as keyof typeof SCAR_MEANS] : forest
        const v = forest + (scar - forest) * t + noise
        bands[bi][i] = Math.max(0, v)
      })
    }
  }

  // Model's proposed mask: the scar shrunk so ~a quarter is unmasked, plus one
  // small false blob outside it — gives "Add" and "Remove" something to do.
  const mask = new Uint8Array(n)
  const shrink = 0.8 // shrunk semi-axes factor
  const blobCx = size * 0.15
  const blobCy = size * 0.8
  const blobR = size * 0.06

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const dx = x - cx
      const dy = y - cy
      const u = dx * cos + dy * sin
      const v = -dx * sin + dy * cos
      const d = (u * u) / ((a * shrink) * (a * shrink)) + (v * v) / ((b * shrink) * (b * shrink))
      // Cut off the "far" quarter of the shrunk ellipse (u > 0.3*a) to leave a visible gap.
      const inShrunk = d < 1 && u < a * 0.3
      const bx = x - blobCx
      const by = y - blobCy
      const inBlob = bx * bx + by * by < blobR * blobR
      mask[i] = inShrunk || inBlob ? 1 : 0
    }
  }

  cached = { width: size, height: size, bands, mask }
  return cached
}
