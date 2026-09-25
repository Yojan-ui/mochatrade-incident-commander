// Generates src/data/historical-crash.json: a mock flash-crash timeline that
// drives the 3D order-book shader. 100 ticks:
//   1–20   healthy: low severity
//   21–40  flash crash: severity spikes exponentially
//   41–100 sustained: high severity with volatility
// severity: 0..1, fed straight into the shader's uSeverity uniform
// liquidationVol: USD liquidated per minute at that tick
// Seeded, so re-running produces the identical file:
//   node scripts/generate-historical-crash.mjs
import { writeFileSync } from 'node:fs'

// mulberry32: tiny deterministic PRNG
let seed = 2417
const rand = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

const START = 0.1 // severity entering the crash
const PEAK = 0.95 // severity at the end of the spike
const k = Math.log(PEAK / START) / 20 // exponential rate over ticks 21–40

const ticks = []
let sustained = 0.88
for (let tick = 1; tick <= 100; tick++) {
  let severity
  if (tick <= 20) {
    severity = 0.06 + rand() * 0.06 // calm, slightly noisy
  } else if (tick <= 40) {
    severity = START * Math.exp(k * (tick - 20)) * (0.94 + rand() * 0.12) // exponential spike
  } else {
    // mean-reverting random walk around a high level, with occasional jolts
    sustained += (0.86 - sustained) * 0.15 + (rand() - 0.5) * 0.12 + (rand() < 0.08 ? 0.1 : 0)
    severity = sustained
  }
  severity = clamp(severity, 0, 1)
  // Liquidated notional tracks severity super-linearly (cascades compound),
  // $0.8M/min at calm up to ~$55M/min at the peak, with volume noise
  const liquidationVol = Math.round((800_000 + 55_000_000 * severity ** 2.2) * (0.85 + rand() * 0.3))
  ticks.push({ tick, severity: Math.round(severity * 1000) / 1000, liquidationVol })
}

writeFileSync(new URL('../src/data/historical-crash.json', import.meta.url), JSON.stringify(ticks, null, 1) + '\n')
console.log(`wrote ${ticks.length} ticks`)
