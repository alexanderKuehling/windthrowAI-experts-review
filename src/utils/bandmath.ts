// Hand-written band-math expression engine. No eval / new Function anywhere —
// expressions compile to a closure tree that is evaluated per pixel.
//
// No-data: any value that isn't finite (division by zero, sqrt of a negative,
// a NaN fill pixel in the source GeoTIFF) evaluates to NaN and stays NaN
// through the rest of the expression. The renderer excludes NaN pixels from
// the contrast stretch and draws them transparent, so fill areas neither
// paint as black nor drag the stretch around. Comparisons involving NaN are
// NaN too, so a threshold like `NBR < 0.3` never lights up on no-data.

export const BAND_IDENTS = ["R", "G", "B", "nIR", "swIR1", "swIR2", "NBR"] as const
export type BandIdent = (typeof BAND_IDENTS)[number]

const BAND_INDEX: Record<string, number> = {}
BAND_IDENTS.forEach((b, i) => (BAND_INDEX[b.toLowerCase()] = i))

// Aliases → canonical band, resolved case-insensitively alongside BAND_IDENTS.
const ALIASES: Record<string, BandIdent> = {
  red: "R",
  green: "G",
  blue: "B",
  nir: "nIR",
  swir1: "swIR1",
  swir2: "swIR2",
  nbr: "NBR",
}

export class BandMathError extends Error {
  position?: number
  constructor(message: string, position?: number) {
    super(message)
    this.name = "BandMathError"
    this.position = position
  }
}

export interface CompiledExpr {
  source: string
  /** Value of the expression at pixel `i`. NaN means no-data. */
  evalAt: (bands: Float32Array[], i: number) => number
  /** Indices into `bands` that the expression references (for UI hints). */
  used: number[]
}

// ── Numeric safety helpers — applied at the node level ──────────────────────

/** Anything non-finite collapses to NaN (= no-data), never to a fake 0. */
function safe(v: number): number {
  return Number.isFinite(v) ? v : NaN
}
function safeDiv(a: number, b: number): number {
  return b === 0 ? NaN : safe(a / b)
}
function safeSqrt(x: number): number {
  return x < 0 ? NaN : safe(Math.sqrt(x))
}
function safeLog(x: number): number {
  return x <= 0 ? NaN : safe(Math.log(x))
}
/** Comparisons yield 1/0, but stay NaN wherever either side is no-data. */
function bool(a: number, b: number, cmp: (a: number, b: number) => boolean): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN
  return cmp(a, b) ? 1 : 0
}

// ── Tokenizer ─────────────────────────────────────────────────────────────

type TokenType = "num" | "ident" | "op" | "lparen" | "rparen" | "comma" | "eof"
interface Token {
  type: TokenType
  value: string
  pos: number
}

// Longest match first, so "<=" never tokenizes as "<" followed by "=".
const OPERATORS = ["<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "^", "<", ">", "!"]

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++
      continue
    }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const start = i
      while (i < n && ((src[i] >= "0" && src[i] <= "9") || src[i] === ".")) i++
      tokens.push({ type: "num", value: src.slice(start, i), pos: start })
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++
      tokens.push({ type: "ident", value: src.slice(start, i), pos: start })
      continue
    }
    if (c === "(") {
      tokens.push({ type: "lparen", value: c, pos: i })
      i++
      continue
    }
    if (c === ")") {
      tokens.push({ type: "rparen", value: c, pos: i })
      i++
      continue
    }
    if (c === ",") {
      tokens.push({ type: "comma", value: c, pos: i })
      i++
      continue
    }
    const op = OPERATORS.find(o => src.startsWith(o, i))
    if (op) {
      tokens.push({ type: "op", value: op, pos: i })
      i += op.length
      continue
    }
    if (c === "=") {
      throw new BandMathError(`Use "==" to compare, not "="`, i)
    }
    throw new BandMathError(`Unexpected character "${c}"`, i)
  }
  tokens.push({ type: "eof", value: "", pos: n })
  return tokens
}

// ── Parser (recursive descent) ───────────────────────────────────────────
//
// expr    := or
// or      := and (("or" | "||") and)*
// and     := cmp (("and" | "&&") cmp)*
// cmp     := sum (("<" | "<=" | ">" | ">=" | "==" | "!=") sum)?
// sum     := term (("+" | "-") term)*
// term    := unary (("*" | "/") unary)*
// unary   := ("-" | "+" | "!") unary | power
// power   := primary ("^" unary)?          -- right-associative
// primary := number | band | func "(" expr ("," expr)* ")" | "(" expr ")"

type Node = (bands: Float32Array[], i: number) => number

type Func =
  | { arity: 1; fn: (a: number) => number }
  | { arity: 2; fn: (a: number, b: number) => number }
  | { arity: 3; fn: (a: number, b: number, c: number) => number }

const FUNCS: Record<string, Func> = {
  abs: { arity: 1, fn: a => safe(Math.abs(a)) },
  sqrt: { arity: 1, fn: a => safeSqrt(a) },
  log: { arity: 1, fn: a => safeLog(a) },
  exp: { arity: 1, fn: a => safe(Math.exp(a)) },
  not: { arity: 1, fn: a => (Number.isNaN(a) ? NaN : a === 0 ? 1 : 0) },
  min: { arity: 2, fn: (a, b) => safe(Math.min(a, b)) },
  max: { arity: 2, fn: (a, b) => safe(Math.max(a, b)) },
  pow: { arity: 2, fn: (a, b) => safe(Math.pow(a, b)) },
  nd: { arity: 2, fn: (a, b) => safeDiv(a - b, a + b) },
  clamp: { arity: 3, fn: (a, lo, hi) => safe(Math.min(Math.max(a, lo), hi)) },
  // Both branches are evaluated (they're pure and cheap), then one is picked.
  if: { arity: 3, fn: (c, a, b) => (Number.isNaN(c) ? NaN : c !== 0 ? a : b) },
}

/** Function names in the order the UI lists them, with their signature. */
export const FUNC_HELP: { name: string; sig: string; what: string }[] = [
  { name: "nd", sig: "nd(a, b)", what: "normalized difference (a − b) / (a + b)" },
  { name: "abs", sig: "abs(x)", what: "absolute value" },
  { name: "sqrt", sig: "sqrt(x)", what: "square root (no-data below 0)" },
  { name: "log", sig: "log(x)", what: "natural log (no-data at or below 0)" },
  { name: "exp", sig: "exp(x)", what: "e to the power of x" },
  { name: "pow", sig: "pow(x, k)", what: "x to the power of k — same as x ^ k" },
  { name: "min", sig: "min(a, b)", what: "smaller of the two" },
  { name: "max", sig: "max(a, b)", what: "larger of the two" },
  { name: "clamp", sig: "clamp(x, lo, hi)", what: "hold x inside lo…hi" },
  { name: "if", sig: "if(cond, a, b)", what: "a where cond is true, else b" },
  { name: "not", sig: "not(cond)", what: "flips a 0/1 condition" },
]

const COMPARISONS: Record<string, (a: number, b: number) => boolean> = {
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
}

class Parser {
  private tokens: Token[]
  private pos = 0
  private used = new Set<number>()

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }
  private next(): Token {
    return this.tokens[this.pos++]
  }

  /** True for an ident token used as a keyword operator ("and" / "or"). */
  private isKeyword(t: Token, word: string): boolean {
    return t.type === "ident" && t.value.toLowerCase() === word
  }

  parse(): { node: Node; used: number[] } {
    const node = this.parseOr()
    const tail = this.peek()
    if (tail.type !== "eof") {
      throw new BandMathError(`Unexpected "${tail.value}"`, tail.pos)
    }
    return { node, used: [...this.used].sort((a, b) => a - b) }
  }

  private parseOr(): Node {
    let left = this.parseAnd()
    for (;;) {
      const t = this.peek()
      if ((t.type === "op" && t.value === "||") || this.isKeyword(t, "or")) {
        this.next()
        const right = this.parseAnd()
        const l = left
        left = (b, i) => {
          const a = l(b, i)
          const c = right(b, i)
          if (Number.isNaN(a) || Number.isNaN(c)) return NaN
          return a !== 0 || c !== 0 ? 1 : 0
        }
      } else {
        break
      }
    }
    return left
  }

  private parseAnd(): Node {
    let left = this.parseComparison()
    for (;;) {
      const t = this.peek()
      if ((t.type === "op" && t.value === "&&") || this.isKeyword(t, "and")) {
        this.next()
        const right = this.parseComparison()
        const l = left
        left = (b, i) => {
          const a = l(b, i)
          const c = right(b, i)
          if (Number.isNaN(a) || Number.isNaN(c)) return NaN
          return a !== 0 && c !== 0 ? 1 : 0
        }
      } else {
        break
      }
    }
    return left
  }

  // Non-associative on purpose: "a < b < c" reads as maths but wouldn't mean
  // what it looks like, so it's rejected rather than silently misinterpreted.
  private parseComparison(): Node {
    const left = this.parseSum()
    const t = this.peek()
    if (t.type === "op" && COMPARISONS[t.value]) {
      this.next()
      const right = this.parseSum()
      const cmp = COMPARISONS[t.value]
      const chained = this.peek()
      if (chained.type === "op" && COMPARISONS[chained.value]) {
        throw new BandMathError(
          `Chained comparisons aren't supported — write "a > lo and a < hi"`,
          chained.pos,
        )
      }
      return (b, i) => bool(left(b, i), right(b, i), cmp)
    }
    return left
  }

  private parseSum(): Node {
    let left = this.parseTerm()
    for (;;) {
      const t = this.peek()
      if (t.type === "op" && (t.value === "+" || t.value === "-")) {
        this.next()
        const right = this.parseTerm()
        const l = left
        left =
          t.value === "+"
            ? (b, i) => safe(l(b, i) + right(b, i))
            : (b, i) => safe(l(b, i) - right(b, i))
      } else {
        break
      }
    }
    return left
  }

  private parseTerm(): Node {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t.type === "op" && (t.value === "*" || t.value === "/")) {
        this.next()
        const right = this.parseUnary()
        const l = left
        left =
          t.value === "*"
            ? (b, i) => safe(l(b, i) * right(b, i))
            : (b, i) => safeDiv(l(b, i), right(b, i))
      } else {
        break
      }
    }
    return left
  }

  private parseUnary(): Node {
    const t = this.peek()
    if (t.type === "op" && (t.value === "-" || t.value === "+" || t.value === "!")) {
      this.next()
      const inner = this.parseUnary()
      if (t.value === "+") return inner
      if (t.value === "-") return (b, i) => safe(-inner(b, i))
      return (b, i) => {
        const v = inner(b, i)
        return Number.isNaN(v) ? NaN : v === 0 ? 1 : 0
      }
    }
    return this.parsePower()
  }

  // Right-associative, and the exponent may be signed: 2 ^ -1, nIR ^ 2.
  private parsePower(): Node {
    const base = this.parsePrimary()
    const t = this.peek()
    if (t.type === "op" && t.value === "^") {
      this.next()
      const exponent = this.parseUnary()
      return (b, i) => safe(Math.pow(base(b, i), exponent(b, i)))
    }
    return base
  }

  private parsePrimary(): Node {
    const t = this.peek()

    if (t.type === "num") {
      this.next()
      const v = Number(t.value)
      if (!Number.isFinite(v)) throw new BandMathError(`"${t.value}" isn't a number`, t.pos)
      return () => v
    }

    if (t.type === "ident") {
      const lower = t.value.toLowerCase()
      if (lower === "and" || lower === "or") {
        throw new BandMathError(`Unexpected "${t.value}"`, t.pos)
      }
      this.next()

      // Function call?
      if (this.peek().type === "lparen" && FUNCS[lower]) {
        return this.parseFuncCall(lower, t.pos)
      }
      if (this.peek().type === "lparen") {
        throw new BandMathError(
          `Unknown function "${t.value}". Available: ${Object.keys(FUNCS).join(", ")}`,
          t.pos,
        )
      }

      const canonical = BAND_INDEX[lower] !== undefined ? (t.value as BandIdent) : ALIASES[lower]
      if (canonical === undefined) {
        throw new BandMathError(
          `Unknown band "${t.value}". Available: ${BAND_IDENTS.join(", ")}`,
          t.pos,
        )
      }
      const idx = BAND_INDEX[canonical.toLowerCase()]
      this.used.add(idx)
      return (b, i) => b[idx][i]
    }

    if (t.type === "lparen") {
      this.next()
      const inner = this.parseOr()
      const close = this.peek()
      if (close.type !== "rparen") {
        throw new BandMathError(`Expected ")"`, close.pos)
      }
      this.next()
      return inner
    }

    if (t.type === "eof") {
      throw new BandMathError("Unexpected end of expression", t.pos)
    }

    throw new BandMathError(`Unexpected "${t.value}"`, t.pos)
  }

  private parseFuncCall(name: string, pos: number): Node {
    const spec = FUNCS[name]
    this.next() // consume "("
    const args: Node[] = []
    if (this.peek().type !== "rparen") {
      args.push(this.parseOr())
      while (this.peek().type === "comma") {
        this.next()
        args.push(this.parseOr())
      }
    }
    const close = this.peek()
    if (close.type !== "rparen") {
      throw new BandMathError(`Expected ")"`, close.pos)
    }
    this.next()

    if (args.length !== spec.arity) {
      throw new BandMathError(
        `"${name}" expects ${spec.arity} argument${spec.arity === 1 ? "" : "s"}, got ${args.length}`,
        pos,
      )
    }

    // Specialised per arity: this runs once per pixel, so the generic
    // args.map(...) version would allocate an array for every pixel.
    if (spec.arity === 1) {
      const [a] = args
      return (b, i) => spec.fn(a(b, i))
    }
    if (spec.arity === 2) {
      const [a, c] = args
      return (b, i) => spec.fn(a(b, i), c(b, i))
    }
    const [a, c, d] = args
    return (b, i) => spec.fn(a(b, i), c(b, i), d(b, i))
  }
}

/** Parse + compile once. Throws BandMathError on any syntax/name error. */
export function compileExpression(src: string): CompiledExpr {
  if (src.trim() === "") {
    throw new BandMathError("Expression is empty")
  }
  const tokens = tokenize(src)
  const parser = new Parser(tokens)
  const { node, used } = parser.parse()
  return { source: src, evalAt: node, used }
}

/** Run a compiled expression over every pixel. NaN entries are no-data. */
export function evaluateExpression(c: CompiledExpr, bands: Float32Array[], n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = c.evalAt(bands, i)
  return out
}
