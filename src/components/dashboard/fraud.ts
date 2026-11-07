/**
 * Market-abuse and claims surveillance.
 *
 * 1. Account surveillance. Each account's trading behaviour around the crash is
 *    scored with the robust (modified) z-score of Iglewicz & Hoaglin:
 *        M = 0.6745 · (x − median) / MAD
 *    Median and MAD ignore the outliers they are hunting for, unlike mean and
 *    standard deviation, which a few huge accounts would drag toward
 *    themselves. |M| ≥ 3.5 is the standard outlier cut-off. Heavy-tailed money
 *    amounts are scored on a log scale.
 *
 *    - Liquidation hunting: an outsized short opened in the minutes before the
 *      crash that then booked an outsized profit from the cascade.
 *    - Spoofing: a flood of orders that are almost all cancelled within a
 *      second or two, so the book looks deeper (or thinner) than it is.
 *
 * 2. Compensation-claim screening. Before the Insurance Fund pays anyone, every
 *    claim is checked against the liquidation ledger with deterministic rules.
 *
 * The account population is synthetic and seeded, so a demo is repeatable.
 */

export const Z_FLAG = 3.5
/** A position opened this close to the incident counts as "pre-positioned" */
export const PRE_POSITION_WINDOW_S = 15 * 60
/** A claim above this multiple of the recorded loss is inflated */
export const INFLATION_FACTOR = 1.5

export interface Account {
  id: string
  createdAt: number
  /** Short notional opened before the crash, USD */
  shortNotionalUsd: number
  /** Seconds before the incident opened that the short was opened */
  shortOpenedSecBefore: number
  /** Realised PnL over the incident, USD */
  pnlUsd: number
  ordersPlaced: number
  /** Share of placed orders cancelled */
  cancelRatio: number
  /** Median time an order rested before cancel/fill */
  medianOrderLifeMs: number
}

export type AbusePattern = 'liquidation-hunting' | 'spoofing'

export interface AccountFlag {
  account: string
  pattern: AbusePattern
  /** The strongest modified z-score behind the flag */
  score: number
  evidence: string
}

export interface LiquidationEvent {
  account: string
  market: string
  notionalUsd: number
  /** Margin lost on the forced close */
  lossUsd: number
  ts: number
}

export interface Claim {
  id: string
  account: string
  market: string
  claimedUsd: number
  ts: number
  /** When the claimant's account was created */
  accountCreatedAt: number
}

export type ClaimReason = 'NO_LIQUIDATION' | 'DUPLICATE' | 'INFLATED' | 'NEW_ACCOUNT'
export const CLAIM_REASON_LABEL: Record<ClaimReason, string> = {
  NO_LIQUIDATION: 'no matching liquidation',
  DUPLICATE: 'duplicate claim',
  INFLATED: `claim > ${INFLATION_FACTOR}× recorded loss`,
  NEW_ACCOUNT: 'account opened during incident',
}

export interface ScreenedClaim extends Claim {
  reasons: ClaimReason[]
  /** Recorded loss on the matching liquidation, if any */
  recordedLossUsd: number | null
}

// ── Statistics ──────────────────────────────────────────────────────────────

export const median = (xs: readonly number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((p, q) => p - q)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Modified z-scores of every value; a zero MAD falls back to the mean absolute deviation */
export function robustZ(xs: readonly number[]) {
  const med = median(xs)
  const mad = median(xs.map((x) => Math.abs(x - med)))
  if (mad > 0) return xs.map((x) => (0.6745 * (x - med)) / mad)
  const meanAd = xs.reduce((acc, x) => acc + Math.abs(x - med), 0) / xs.length
  return xs.map((x) => (meanAd > 0 ? (x - med) / (1.253314 * meanAd) : 0))
}

/** Signed log so negative PnL stays negative */
const slog = (x: number) => Math.sign(x) * Math.log10(1 + Math.abs(x))
const usdShort = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(0)}K`)

export function scoreAccounts(accounts: readonly Account[]): AccountFlag[] {
  const zShort = robustZ(accounts.map((a) => slog(a.shortNotionalUsd)))
  const zPnl = robustZ(accounts.map((a) => slog(a.pnlUsd)))
  const zOrders = robustZ(accounts.map((a) => Math.log10(1 + a.ordersPlaced)))
  const zCancel = robustZ(accounts.map((a) => a.cancelRatio))

  const flags: AccountFlag[] = []
  accounts.forEach((a, i) => {
    const prePositioned = a.shortNotionalUsd > 0 && a.shortOpenedSecBefore <= PRE_POSITION_WINDOW_S
    if (prePositioned && zShort[i] >= Z_FLAG && zPnl[i] >= Z_FLAG) {
      flags.push({
        account: a.id,
        pattern: 'liquidation-hunting',
        score: Math.min(zShort[i], zPnl[i]),
        evidence: `${usdShort(a.shortNotionalUsd)} short opened ${Math.round(a.shortOpenedSecBefore / 60)} min pre-crash, PnL +${usdShort(a.pnlUsd)} (z ${zShort[i].toFixed(1)} / ${zPnl[i].toFixed(1)})`,
      })
    }
    if (zCancel[i] >= Z_FLAG && zOrders[i] >= Z_FLAG && a.medianOrderLifeMs < 2_000) {
      flags.push({
        account: a.id,
        pattern: 'spoofing',
        score: Math.min(zCancel[i], zOrders[i]),
        evidence: `${a.ordersPlaced.toLocaleString('en-US')} orders, ${(a.cancelRatio * 100).toFixed(1)}% cancelled, median life ${a.medianOrderLifeMs} ms (z ${zCancel[i].toFixed(1)} / ${zOrders[i].toFixed(1)})`,
      })
    }
  })
  return flags.sort((p, q) => q.score - p.score)
}

/**
 * Screens one claim against the liquidation ledger and the claims already
 * screened. A claim may carry several reasons; any reason holds the payout.
 */
export function screenClaim(
  claim: Claim,
  liquidations: readonly LiquidationEvent[],
  earlier: readonly Claim[],
  incidentOpenedAt: number,
): ScreenedClaim {
  const reasons: ClaimReason[] = []
  const matches = liquidations.filter((l) => l.account === claim.account && l.market === claim.market)
  const recordedLossUsd = matches.length ? matches.reduce((acc, l) => acc + l.lossUsd, 0) : null
  if (recordedLossUsd === null) reasons.push('NO_LIQUIDATION')
  if (earlier.some((c) => c.account === claim.account && c.market === claim.market)) reasons.push('DUPLICATE')
  if (recordedLossUsd !== null && claim.claimedUsd > recordedLossUsd * INFLATION_FACTOR) reasons.push('INFLATED')
  if (claim.accountCreatedAt >= incidentOpenedAt) reasons.push('NEW_ACCOUNT')
  return { ...claim, reasons, recordedLossUsd }
}

export interface ClaimSummary {
  screened: number
  flagged: number
  claimedUsd: number
  /** Value of flagged claims, held from payout */
  heldUsd: number
  byReason: Record<ClaimReason, number>
}

export function summarizeClaims(claims: readonly ScreenedClaim[]): ClaimSummary {
  const byReason: Record<ClaimReason, number> = { NO_LIQUIDATION: 0, DUPLICATE: 0, INFLATED: 0, NEW_ACCOUNT: 0 }
  let flagged = 0
  let claimedUsd = 0
  let heldUsd = 0
  for (const c of claims) {
    claimedUsd += c.claimedUsd
    if (c.reasons.length) {
      flagged++
      heldUsd += c.claimedUsd
      for (const r of c.reasons) byReason[r]++
    }
  }
  return { screened: claims.length, flagged, claimedUsd, heldUsd, byReason }
}

// ── Synthetic population ────────────────────────────────────────────────────

/** mulberry32: tiny deterministic PRNG */
export function seededRandom(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hexId = (rnd: () => number) =>
  `${Math.floor(0x1000 + rnd() * 0xefff).toString(16)}…${Math.floor(0x100 + rnd() * 0xeff).toString(16)}`

/**
 * Ordinary traders plus a few planted bad actors: two liquidation hunters and
 * two spoofers. Ordinary accounts are log-normal in size, mostly long (they
 * are the ones being liquidated), and cancel a normal share of their orders.
 */
export function generateAccounts(seed: number, count: number, incidentOpenedAt: number): Account[] {
  const rnd = seededRandom(seed)
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
  const day = 86_400_000
  const accounts: Account[] = []
  for (let i = 0; i < count; i++) {
    const shorts = rnd() < 0.3
    accounts.push({
      id: hexId(rnd),
      createdAt: incidentOpenedAt - Math.floor(30 + rnd() * 900) * day,
      shortNotionalUsd: shorts ? Math.exp(9.5 + 1.1 * normal()) : 0,
      shortOpenedSecBefore: shorts ? Math.floor(3_600 + rnd() * 30 * 86_400) : Infinity,
      pnlUsd: (shorts ? 1 : -1) * Math.exp(7.5 + 1.2 * normal()),
      ordersPlaced: Math.round(Math.exp(3.2 + 0.9 * normal())),
      cancelRatio: Math.min(0.85, Math.max(0.02, 0.35 + 0.14 * normal())),
      medianOrderLifeMs: Math.round(Math.exp(10 + 1.3 * normal())),
    })
  }
  // Planted at fixed, distinct positions so none overwrites another
  let slot = 0
  const plant = (overrides: Partial<Account>) => {
    slot += Math.floor(accounts.length / 5)
    accounts[slot] = { ...accounts[0], id: hexId(rnd), createdAt: incidentOpenedAt - 400 * day, ...overrides }
  }
  plant({ shortNotionalUsd: 18_400_000, shortOpenedSecBefore: 260, pnlUsd: 2_930_000, ordersPlaced: 14, cancelRatio: 0.2, medianOrderLifeMs: 40_000 })
  plant({ shortNotionalUsd: 9_700_000, shortOpenedSecBefore: 540, pnlUsd: 1_410_000, ordersPlaced: 22, cancelRatio: 0.3, medianOrderLifeMs: 61_000 })
  plant({ shortNotionalUsd: 0, shortOpenedSecBefore: Infinity, pnlUsd: 84_000, ordersPlaced: 18_300, cancelRatio: 0.988, medianOrderLifeMs: 420 })
  plant({ shortNotionalUsd: 0, shortOpenedSecBefore: Infinity, pnlUsd: 51_000, ordersPlaced: 9_650, cancelRatio: 0.975, medianOrderLifeMs: 780 })
  return accounts
}
