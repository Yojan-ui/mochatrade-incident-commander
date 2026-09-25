import { useCallback, useEffect, useRef, useState } from 'react'
import HISTORICAL_CRASH from '@/data/historical-crash.json'

export const LIQUIDATION_THRESHOLD = 500
const HISTORY_LENGTH = 28
const MAX_LOG_LINES = 80
const MAX_LIQUIDATIONS = 9_999
const PRICE_STEP_MS = 850

/** Per-market incident controls; broadcast is global and handled separately */
export type Control = 'pause' | 'halt'
export type ActionStatus = 'idle' | 'executing' | 'executed'
export type LogLevel = 'liq' | 'sev' | 'ops' | 'tkt' | 'sys'
export type Market = 'BTC-PERP' | 'ETH-PERP' | 'SOL-PERP' | 'NVDA-PERP' | 'TSLA-PERP'

export interface LogLine {
  id: number
  ts: number
  level: LogLevel
  text: string
}

/**
 * The single source of truth for everything the dashboard displays. Every
 * derived figure is computed here, in the same commit as the values it is
 * derived from, so no component ever recomputes (and disagrees about) them.
 */
export interface Metrics {
  /** Forced liquidations in the trailing 60 seconds */
  liquidations: number
  /** Open support tickets */
  tickets: number
  liqDelta: number
  ticketDelta: number
  liqHistory: number[]
  ticketHistory: number[]
  /** Per-market liquidation series; liqHistory is their exact sum at every tick */
  liqByMarket: Record<Market, number[]>
  liqDeltaByMarket: Record<Market, number>
  peakLiquidations: number
  avgLiquidations: number
  /** liquidations / LIQUIDATION_THRESHOLD */
  load: number
  /**
   * Per-market stress: the market's liquidation rate divided by its share of
   * the SEV-1 threshold. 1.0 means the market alone is running at threshold pace.
   */
  stressByMarket: Record<Market, number>
  critical: boolean
  prices: Record<Market, number>
  /** BTC-PERP change since the session open */
  drawdown: number
  drawdownByMarket: Record<Market, number>
  /** US equity session state; while closed, US-stock perps trade against a stale reference price */
  usEquityClosed: boolean
  /** Notional liquidated in the trailing 60 seconds, USD (sampled each tick) */
  liqVolumeUsd: number
  liqVolumeHistory: number[]
  liqVolumeByMarket: Record<Market, number>
  /** New support tickets per minute */
  ticketVelocity: number
  ticketVelocityHistory: number[]
  /** Escalation triggers: either one on means SEV-1 escalation */
  escalation: { volume: boolean; tickets: boolean; active: boolean }
  /** Historical crash replay: index into HISTORICAL_CRASH and that tick's values */
  replayIndex: number
  /** The recorded tick number (1-based, as in the JSON) */
  replayTick: number
  replayPhase: ReplayPhase
  /** 0..1; drives the 3D order book's uSeverity (fBM amplitude) */
  severity: number
  /** Recorded USD liquidated per minute at this tick */
  liquidationVol: number
  /** Running totals since monitoring started (SESSION_STARTED_AT): rate × elapsed time */
  cumLiqVolumeUsd: number
  cumLiquidations: number
  peakLiqVolumeUsd: number
}

/**
 * Historical replay. The 3D order book's intensity follows this recorded crash
 * timeline (src/data/historical-crash.json) instead of the live random model:
 * ticks 1–20 healthy, 21–40 an exponential flash crash, 41–100 sustained high
 * severity. One tick every REPLAY_TICK_MS; it loops so a demo never runs out.
 */
export const REPLAY_TICK_MS = 500
export const REPLAY_LENGTH = HISTORICAL_CRASH.length
export type ReplayPhase = 'PRE-CRASH' | 'FLASH CRASH' | 'SUSTAINED'
const replayPhaseOf = (tick: number): ReplayPhase => (tick <= 20 ? 'PRE-CRASH' : tick <= 40 ? 'FLASH CRASH' : 'SUSTAINED')

/** Escalation triggers for the live signals panel */
export const ESCALATION_LIQ_VOLUME_USD = 10_000_000
export const ESCALATION_TICKET_VELOCITY = 500

/** When this dashboard started monitoring; running totals count from here */
export const SESSION_STARTED_AT = Date.now()

/** When the incident opened: shortly before this session started */
export const INCIDENT_OPENED_AT = Date.now() - (7 * 60 + 12) * 1000

/**
 * Decision ledger. Append-only: entries are frozen when written and nothing in
 * the app edits or removes them. Each entry hashes its content together with
 * the previous entry's hash, so any change to history breaks the chain.
 */
export type LedgerKind = 'action' | 'decision' | 'escalation' | 'note' | 'system'
export interface LedgerEntry {
  readonly seq: number
  readonly ts: number
  readonly kind: LedgerKind
  readonly actor: string
  readonly text: string
  readonly prevHash: string
  readonly hash: string
}
export const LEDGER_GENESIS = '00000000'

/** FNV-1a, 32-bit: small and deterministic; tamper-evident, not cryptographic */
function fnv1a(input: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
export const ledgerHash = (e: Omit<LedgerEntry, 'hash'>) =>
  fnv1a(`${e.prevHash}|${e.seq}|${e.ts}|${e.kind}|${e.actor}|${e.text}`)

/** Recomputes every hash and link; false if any entry was altered or reordered */
export function verifyLedger(entries: readonly LedgerEntry[]) {
  let prev = LEDGER_GENESIS
  for (const e of entries) {
    if (e.prevHash !== prev || ledgerHash(e) !== e.hash) return false
    prev = e.hash
  }
  return true
}

function makeEntry(prev: LedgerEntry | undefined, ts: number, kind: LedgerKind, actor: string, text: string): LedgerEntry {
  const base = { seq: (prev?.seq ?? 0) + 1, ts, kind, actor, text, prevHash: prev?.hash ?? LEDGER_GENESIS }
  return Object.freeze({ ...base, hash: ledgerHash(base) })
}

function seedLedger(): LedgerEntry[] {
  const out: LedgerEntry[] = []
  const add = (ts: number, kind: LedgerKind, actor: string, text: string) => out.push(makeEntry(out[out.length - 1], ts, kind, actor, text))
  add(INCIDENT_OPENED_AT, 'escalation', 'risk-engine', 'Incident INC-2417 opened: BTC-PERP flash crash, liquidation engine cascading')
  add(INCIDENT_OPENED_AT + 20_000, 'action', 'on-call', 'Incident commander paged; risk and support on bridge')
  if (US_EQUITY_CLOSED) {
    add(INCIDENT_OPENED_AT + 45_000, 'system', 'risk-engine', `US equity markets closed; ${US_STOCK_PERPS.join(', ')} on stale reference price`)
  }
  return out
}

export interface ActionRecord {
  status: ActionStatus
  at?: number
  count: number
}

export interface Controls {
  markets: Record<Market, Record<Control, ActionRecord>>
  broadcast: ActionRecord
}

const idle = (): ActionRecord => ({ status: 'idle', count: 0 })
const initialControls = (): Controls => ({
  markets: byMarket(() => ({ pause: idle(), halt: idle() })),
  broadcast: idle(),
})

const engagedMap = (controls: Controls, control: Control) =>
  Object.fromEntries(
    MARKET_LIST.map((m) => [m, controls.markets[m][control].status === 'executed']),
  ) as Record<Market, boolean>

/*
 * India-aware market context. US-stock perps trade 24/7, but their reference
 * price comes from US equity markets. During Indian daytime the US session is
 * closed, so the reference is stale: the perp can gap far from it with nothing
 * anchoring it, which widens moves and slippage.
 *
 * This incident is scripted as an off-hours event, so the flag is fixed to
 * CLOSED rather than read from the clock.
 */
export const US_EQUITY_CLOSED = true
export const US_STOCK_PERPS: readonly Market[] = ['NVDA-PERP', 'TSLA-PERP']
/** Multipliers applied to US-stock perps while the US session is closed */
export const STALE_REF_VOLATILITY = 1.8
export const STALE_REF_SLIP = 2.5
const isStale = (m: Market) => US_EQUITY_CLOSED && US_STOCK_PERPS.includes(m)

const OPEN_PRICES: Record<Market, number> = {
  'BTC-PERP': 64_820,
  'ETH-PERP': 2_770,
  'SOL-PERP': 143.4,
  'NVDA-PERP': 182.6,
  'TSLA-PERP': 348.2,
}
const START_PRICES: Record<Market, number> = {
  'BTC-PERP': 61_940,
  'ETH-PERP': 2_642,
  'SOL-PERP': 136.8,
  'NVDA-PERP': 176.4,
  'TSLA-PERP': 336.9,
}
// Higher beta assets fall harder than BTC in a cascade
const BETA: Record<Market, number> = { 'BTC-PERP': 1, 'ETH-PERP': 1.25, 'SOL-PERP': 1.6, 'NVDA-PERP': 1.3, 'TSLA-PERP': 1.5 }
const UNIT: Record<Market, string> = { 'BTC-PERP': 'BTC', 'ETH-PERP': 'ETH', 'SOL-PERP': 'SOL', 'NVDA-PERP': 'NVDA', 'TSLA-PERP': 'TSLA' }
/** Position size range per liquidation event, in the market's unit */
const SIZE: Record<Market, [number, number]> = {
  'BTC-PERP': [0.4, 38],
  'ETH-PERP': [8, 540],
  'SOL-PERP': [90, 9200],
  'NVDA-PERP': [40, 6000],
  'TSLA-PERP': [20, 3000],
}
/**
 * Typical liquidated position, in the market's unit (about $43K BTC, $18K ETH,
 * $9K SOL, $6K NVDA, $7K TSLA at start prices). Calibrated so $10M/min of
 * liquidated notional lands at roughly 400 liquidations/min.
 */
const AVG_UNITS: Record<Market, number> = { 'BTC-PERP': 0.7, 'ETH-PERP': 7, 'SOL-PERP': 65, 'NVDA-PERP': 35, 'TSLA-PERP': 20 }
const DECIMALS: Record<Market, number> = { 'BTC-PERP': 1, 'ETH-PERP': 1, 'SOL-PERP': 2, 'NVDA-PERP': 2, 'TSLA-PERP': 2 }
export const MARKET_LIST: readonly Market[] = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP', 'NVDA-PERP', 'TSLA-PERP']
const SHARE: Record<Market, number> = { 'BTC-PERP': 0.42, 'ETH-PERP': 0.26, 'SOL-PERP': 0.14, 'NVDA-PERP': 0.1, 'TSLA-PERP': 0.08 }
/** "BTC-PERP", "BTC-PERP and ETH-PERP", "BTC-PERP, ETH-PERP and SOL-PERP" */
/** $845.2K, $12.41M */
export const usd = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${(v / 1_000).toFixed(1)}K`

export const formatMarketList = (markets: readonly string[]) =>
  markets.length <= 1 ? (markets[0] ?? '') : `${markets.slice(0, -1).join(', ')} and ${markets[markets.length - 1]}`

const last = (history: number[]) => history[history.length - 1]
const byMarket = <T,>(fn: (m: Market) => T) =>
  Object.fromEntries(MARKET_LIST.map((m) => [m, fn(m)])) as Record<Market, T>

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const push = (history: number[], value: number) => [...history.slice(-(HISTORY_LENGTH - 1)), value]
const hexAcct = () =>
  `${Math.floor(rand(0x1000, 0xffff)).toString(16)}…${Math.floor(rand(0x100, 0xfff)).toString(16)}`
export const fmtPrice = (market: Market, px: number) =>
  px.toLocaleString('en-US', { minimumFractionDigits: DECIMALS[market], maximumFractionDigits: DECIMALS[market] })

/** History that has been compounding at a steady rate up to `end` */
function seedExponential(end: number, start: number) {
  const k = Math.log(end / start) / (HISTORY_LENGTH - 1)
  return Array.from({ length: HISTORY_LENGTH }, (_, i) =>
    Math.round(start * Math.exp(k * i) * (i === HISTORY_LENGTH - 1 ? 1 : rand(0.94, 1.06))),
  ).map((v, i, a) => (i === a.length - 1 ? end : v))
}

/**
 * Splits a total across markets for the seeded history (after that, each market
 * evolves on its own). Rounding remainder goes to BTC so the sum is exact.
 */
function splitByMarket(total: number): Record<Market, number> {
  const w = byMarket((m) => SHARE[m] * rand(0.85, 1.15))
  const sum = MARKET_LIST.reduce((acc, m) => acc + w[m], 0)
  const split = byMarket((m) => Math.round((total * w[m]) / sum))
  split['BTC-PERP'] = total - MARKET_LIST.filter((m) => m !== 'BTC-PERP').reduce((acc, m) => acc + split[m], 0)
  return split
}

type Series = Pick<
  Metrics,
  | 'liqHistory'
  | 'ticketHistory'
  | 'liqByMarket'
  | 'liqVolumeHistory'
  | 'liqVolumeByMarket'
  | 'ticketVelocityHistory'
  | 'cumLiqVolumeUsd'
  | 'cumLiquidations'
  | 'peakLiqVolumeUsd'
  | 'replayIndex'
>

const volumeByMarket = (counts: Record<Market, number>, prices: Record<Market, number>) =>
  byMarket((m) => counts[m] * AVG_UNITS[m] * prices[m])
const sumMarkets = (v: Record<Market, number>) => MARKET_LIST.reduce((acc, m) => acc + v[m], 0)
/** Angry users per liquidation, plus background volume that exists anyway */
const ticketVelocityFor = (liquidations: number, broadcasted: boolean) =>
  Math.round((liquidations * rand(0.7, 1.0) + 20) * (broadcasted ? 0.35 : 1))

function seedSeries(): Series {
  const liqHistory = seedExponential(184, 34)
  const splits = liqHistory.map(splitByMarket)
  const volumes = splits.map((split) => volumeByMarket(split, START_PRICES))
  return {
    liqHistory,
    ticketHistory: seedExponential(312, 96),
    liqByMarket: byMarket((m) => splits.map((s) => s[m])),
    liqVolumeHistory: volumes.map(sumMarkets),
    liqVolumeByMarket: volumes[volumes.length - 1],
    ticketVelocityHistory: liqHistory.map((l) => ticketVelocityFor(l, false)),
    cumLiqVolumeUsd: 0,
    cumLiquidations: 0,
    replayIndex: 0,
    peakLiqVolumeUsd: sumMarkets(volumes[volumes.length - 1]),
  }
}

/** Builds a complete, internally consistent snapshot from the raw series and prices */
function snapshot(series: Series, prices: Record<Market, number>): Metrics {
  const { liqHistory, ticketHistory } = series
  const liquidations = liqHistory[liqHistory.length - 1]
  const tickets = ticketHistory[ticketHistory.length - 1]
  return {
    liquidations,
    tickets,
    liqDelta: liquidations - (liqHistory[liqHistory.length - 2] ?? liquidations),
    ticketDelta: tickets - (ticketHistory[ticketHistory.length - 2] ?? tickets),
    liqHistory,
    ticketHistory,
    liqByMarket: series.liqByMarket,
    liqDeltaByMarket: byMarket((m) => {
      const h = series.liqByMarket[m]
      return last(h) - (h[h.length - 2] ?? last(h))
    }),
    peakLiquidations: Math.max(...liqHistory),
    avgLiquidations: Math.round(liqHistory.reduce((a, b) => a + b, 0) / liqHistory.length),
    load: liquidations / LIQUIDATION_THRESHOLD,
    stressByMarket: byMarket((m) => last(series.liqByMarket[m]) / (LIQUIDATION_THRESHOLD * SHARE[m])),
    critical: liquidations >= LIQUIDATION_THRESHOLD,
    prices,
    drawdown: (prices['BTC-PERP'] - OPEN_PRICES['BTC-PERP']) / OPEN_PRICES['BTC-PERP'],
    drawdownByMarket: byMarket((m) => (prices[m] - OPEN_PRICES[m]) / OPEN_PRICES[m]),
    usEquityClosed: US_EQUITY_CLOSED,
    liqVolumeUsd: last(series.liqVolumeHistory),
    liqVolumeHistory: series.liqVolumeHistory,
    liqVolumeByMarket: series.liqVolumeByMarket,
    ticketVelocity: last(series.ticketVelocityHistory),
    ticketVelocityHistory: series.ticketVelocityHistory,
    escalation: (() => {
      const volume = last(series.liqVolumeHistory) >= ESCALATION_LIQ_VOLUME_USD
      const tickets = last(series.ticketVelocityHistory) >= ESCALATION_TICKET_VELOCITY
      return { volume, tickets, active: volume || tickets }
    })(),
    cumLiqVolumeUsd: series.cumLiqVolumeUsd,
    cumLiquidations: series.cumLiquidations,
    peakLiqVolumeUsd: series.peakLiqVolumeUsd,
    replayIndex: series.replayIndex,
    replayTick: HISTORICAL_CRASH[series.replayIndex].tick,
    replayPhase: replayPhaseOf(HISTORICAL_CRASH[series.replayIndex].tick),
    severity: HISTORICAL_CRASH[series.replayIndex].severity,
    liquidationVol: HISTORICAL_CRASH[series.replayIndex].liquidationVol,
  }
}

export function useIncidentSim() {
  const [metrics, setMetrics] = useState<Metrics>(() => snapshot(seedSeries(), START_PRICES))
  const [controls, setControls] = useState<Controls>(initialControls)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>(seedLedger)
  const ledgerRef = useRef(ledger)

  // Timers read through refs so they never restart. Both refs are written in the
  // same statement as their state, so a timer never sees a value the UI doesn't.
  const metricsRef = useRef(metrics)
  const controlsRef = useRef(controls)
  const lastTickAt = useRef(Date.now())
  const logId = useRef(0)

  const commitMetrics = useCallback((next: Metrics) => {
    metricsRef.current = next
    setMetrics(next)
  }, [])

  const commitControls = useCallback((update: (prev: Controls) => Controls) => {
    const next = update(controlsRef.current)
    controlsRef.current = next
    setControls(next)
  }, [])

  /** Append to the decision ledger. The only way entries are ever written. */
  const record = useCallback((kind: LedgerKind, text: string, actor = 'system') => {
    const clean = text.trim().slice(0, 280)
    if (!clean) return
    const prev = ledgerRef.current
    const next = [...prev, makeEntry(prev[prev.length - 1], Date.now(), kind, actor.trim().slice(0, 24) || 'system', clean)]
    ledgerRef.current = next
    setLedger(next)
  }, [])

  const log = useCallback((level: LogLevel, text: string) => {
    const line: LogLine = { id: logId.current++, ts: Date.now(), level, text }
    setLogs((prev) => [...prev.slice(-(MAX_LOG_LINES - 1)), line])
  }, [])

  // Opening context for the stream (guarded so StrictMode's double effect doesn't repeat it)
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    log('sys', 'attached to incident INC-2417, tailing risk-engine and support queues')
    if (US_EQUITY_CLOSED) {
      log(
        'sev',
        `US equity markets closed (off-hours); ${formatMarketList(US_STOCK_PERPS)} pricing off stale reference, volatility ×${STALE_REF_VOLATILITY}, slip ×${STALE_REF_SLIP}`,
      )
    }
    log('sev', 'BTC-PERP mark fell 4.4% in 90s; liquidation engine cascading')
    log('ops', 'incident commander paged; risk and support on bridge')
  }, [log])

  // Counter ticks land every 2–3 seconds. Growth is multiplicative, so an
  // unchecked cascade compounds and the sparklines curve upward.
  useEffect(() => {
    let timer: number

    const step = () => {
      const prev = metricsRef.current
      const current = controlsRef.current
      const paused = engagedMap(current, 'pause')
      const halted = engagedMap(current, 'halt')
      const broadcasted = current.broadcast.status === 'executed'

      // Each market compounds on its own; pausing or halting one only shrinks that one
      const liqNext = byMarket((m) => {
        let growth: number
        if (halted[m]) growth = rand(0.35, 0.55)
        else if (paused[m]) growth = rand(0.55, 0.75)
        else if (Math.random() < 0.12) growth = rand(0.93, 1) // brief lull
        else growth = rand(1.08, 1.2) * (Math.random() < 0.22 ? rand(1.15, 1.35) : 1) // compounding, with spikes
        const cap = MAX_LIQUIDATIONS * SHARE[m]
        return Math.round(Math.max(halted[m] ? 0 : 2, Math.min(last(prev.liqByMarket[m]) * growth, cap)))
      })
      const liquidations = MARKET_LIST.reduce((sum, m) => sum + liqNext[m], 0)

      // Tickets arrive at a per-minute velocity driven by liquidations; the open
      // backlog grows by velocity × elapsed time. Agents close ~1% per tick, and a
      // status broadcast deflects most new tickets and speeds up closures.
      const tickAt = Date.now()
      const elapsedMin = (tickAt - lastTickAt.current) / 60_000
      lastTickAt.current = tickAt
      const ticketVelocity = ticketVelocityFor(liquidations, broadcasted)
      const closed = prev.tickets * (broadcasted ? 0.1 : 0.01)
      const tickets = Math.round(Math.max(40, prev.tickets + ticketVelocity * elapsedMin - closed))

      const volumes = volumeByMarket(liqNext, prev.prices)
      const next = snapshot(
        {
          liqHistory: push(prev.liqHistory, liquidations),
          ticketHistory: push(prev.ticketHistory, tickets),
          liqByMarket: byMarket((m) => push(prev.liqByMarket[m], liqNext[m])),
          liqVolumeHistory: push(prev.liqVolumeHistory, sumMarkets(volumes)),
          liqVolumeByMarket: volumes,
          ticketVelocityHistory: push(prev.ticketVelocityHistory, ticketVelocity),
          // Rates are per minute, so totals grow by rate × minutes since the last tick
          cumLiqVolumeUsd: prev.cumLiqVolumeUsd + sumMarkets(volumes) * elapsedMin,
          cumLiquidations: prev.cumLiquidations + liquidations * elapsedMin,
          peakLiqVolumeUsd: Math.max(prev.peakLiqVolumeUsd, sumMarkets(volumes)),
          replayIndex: prev.replayIndex,
        },
        prev.prices,
      )
      commitMetrics(next)

      // Report the single biggest per-market jump, if any
      const spiking = MARKET_LIST.map((m) => ({ m, from: last(prev.liqByMarket[m]), to: liqNext[m] }))
        .filter(({ from, to }) => to > from * 1.3 && to > 120)
        .sort((a, b) => b.to - b.from - (a.to - a.from))[0]

      if (!prev.critical && next.critical) {
        log('sev', `liquidations crossed ${LIQUIDATION_THRESHOLD}/min (${liquidations}); escalated to SEV-1, paging head of risk`)
        record('escalation', `SEV-1 declared: liquidations ${liquidations}/min ≥ ${LIQUIDATION_THRESHOLD}`, 'risk-engine')
      } else if (prev.critical && !next.critical) {
        log('sys', `liquidations back under ${LIQUIDATION_THRESHOLD}/min (${liquidations}); holding SEV-1 until stable for 10 min`)
        record('escalation', `Liquidations back under ${LIQUIDATION_THRESHOLD}/min (${liquidations}); SEV-1 held pending 10 min stability`, 'risk-engine')
      } else if (spiking) {
        log('liq', `spike: ${spiking.m} ${spiking.from} → ${spiking.to}/min, cascade through the book`)
      }
      if (!prev.escalation.volume && next.escalation.volume) {
        log('sev', `escalation trigger: liquidation volume crossed ${usd(ESCALATION_LIQ_VOLUME_USD)}/min (${usd(next.liqVolumeUsd)})`)
        record('escalation', `Escalation trigger: liquidation volume ${usd(next.liqVolumeUsd)}/min ≥ ${usd(ESCALATION_LIQ_VOLUME_USD)}`, 'risk-engine')
      }
      if (!prev.escalation.tickets && next.escalation.tickets) {
        log('sev', `escalation trigger: ticket velocity crossed ${ESCALATION_TICKET_VELOCITY}/min (${next.ticketVelocity})`)
        record('escalation', `Escalation trigger: ticket velocity ${next.ticketVelocity}/min ≥ ${ESCALATION_TICKET_VELOCITY}`, 'risk-engine')
      }
      if (next.ticketVelocity > prev.ticketVelocity * 1.25 && next.ticketVelocity > 200) {
        log('tkt', `ticket velocity ${prev.ticketVelocity} → ${next.ticketVelocity}/min; top tag "position closed without warning"`)
      }
    }

    const loop = () => {
      timer = window.setTimeout(() => {
        step()
        loop()
      }, rand(2000, 3000))
    }
    loop()
    return () => window.clearTimeout(timer)
  }, [commitMetrics, log, record])

  // Replay clock: advance one recorded tick every REPLAY_TICK_MS, looping at the end
  useEffect(() => {
    const id = window.setInterval(() => {
      const prev = metricsRef.current
      const replayIndex = (prev.replayIndex + 1) % REPLAY_LENGTH
      commitMetrics(snapshot({ ...prev, replayIndex }, prev.prices))
      const tick = HISTORICAL_CRASH[replayIndex].tick
      if (replayIndex === 0) log('sys', `historical crash replay looped (${REPLAY_LENGTH} ticks)`)
      else if (tick === 21) log('sys', 'historical replay: flash crash begins, severity spiking (tick 21)')
      else if (tick === 41) log('sys', 'historical replay: sustained high severity and volatility (tick 41)')
    }, REPLAY_TICK_MS)
    return () => window.clearInterval(id)
  }, [commitMetrics, log])

  // Each market's price falls on every step while its cascade runs, and
  // abnormal liquidations are logged at the price just committed. Pausing
  // liquidations or halting trading on a market stops only that market's decline.
  useEffect(() => {
    const id = window.setInterval(() => {
      const current = controlsRef.current
      const paused = engagedMap(current, 'pause')
      const halted = engagedMap(current, 'halt')
      const active = MARKET_LIST.filter((m) => !paused[m] && !halted[m])
      if (active.length === 0) return

      const prev = metricsRef.current
      const prices = { ...prev.prices }
      for (const m of active) {
        // Forced selling scales with this market's liquidation rate (normalised by its
        // usual share); the fall eases as its drawdown deepens but never turns positive.
        const pressure = 0.0006 + Math.min(last(prev.liqByMarket[m]) / SHARE[m], 3000) * 0.0000012
        const ease = Math.max(0.25, 1 + prev.drawdownByMarket[m] * 2)
        // Stale reference: nothing anchors the perp, so each step moves further
        const vol = isStale(m) ? STALE_REF_VOLATILITY : 1
        prices[m] = prices[m] * (1 - pressure * ease * BETA[m] * vol * rand(0.6, 1.4))
      }
      commitMetrics(snapshot(prev, prices))

      // Only markets still liquidating can log liquidation events
      const activeLiq = active.reduce((sum, m) => sum + last(prev.liqByMarket[m]), 0)
      if (activeLiq === 0 || Math.random() > Math.min(0.85, activeLiq / 600)) return
      let r = Math.random() * activeLiq
      const market = active.find((m) => (r -= last(prev.liqByMarket[m])) < 0) ?? active[0]
      const size = rand(...SIZE[market])
      const stale = isStale(market)
      const slip = rand(0.4, prev.critical ? 7.8 : 3.2) * (stale ? STALE_REF_SLIP : 1)
      log(
        'liq',
        `${market}  long ${size.toFixed(2)} ${UNIT[market]} @ ${fmtPrice(market, prices[market])}  acct ${hexAcct()}  slip ${slip.toFixed(1)}%${stale ? '  stale-ref' : ''}`,
      )
    }, PRICE_STEP_MS)
    return () => window.clearInterval(id)
  }, [commitMetrics, log])

  const toggleControl = useCallback(
    (market: Market, control: Control) => {
      const current = controlsRef.current.markets[market][control]
      if (current.status === 'executing') return

      const set = (record: ActionRecord) =>
        commitControls((prev) => ({
          ...prev,
          markets: { ...prev.markets, [market]: { ...prev.markets[market], [control]: record } },
        }))

      if (current.status === 'executed') {
        set({ ...current, status: 'idle' })
        log(
          'ops',
          control === 'pause'
            ? `${market} margin liquidations resumed by commander`
            : `${market} trading resumed by commander; order entry re-enabled`,
        )
        record('action', control === 'pause' ? `${market} margin liquidations resumed` : `${market} market resumed, order entry re-enabled`, 'commander')
        return
      }

      set({ ...current, status: 'executing' })
      window.setTimeout(() => {
        set({ status: 'executed', at: Date.now(), count: controlsRef.current.markets[market][control].count + 1 })
        log(
          'ops',
          control === 'pause'
            ? `${market} margin liquidations paused by commander; under-margin positions held, not closed`
            : `${market} markets halted by commander; order entry disabled`,
        )
        record('action', control === 'pause' ? `${market} margin liquidations paused` : `${market} market halted, order entry disabled`, 'commander')
      }, 650)
    },
    [commitControls, log, record],
  )

  /**
   * Pauses liquidations on every market that is still cascading (no pause or
   * halt engaged). Records one ledger entry for the command, then each market's
   * own entry lands as its pause executes. Returns the markets it acted on.
   */
  const pauseAllCascading = useCallback(
    (source: string): Market[] => {
      const targets = MARKET_LIST.filter((m) => {
        const c = controlsRef.current.markets[m]
        return c.pause.status === 'idle' && c.halt.status !== 'executed'
      })
      if (targets.length === 0) return []
      record('action', `Global pause via ${source}: ${formatMarketList(targets)}`, 'commander')
      targets.forEach((m) => toggleControl(m, 'pause'))
      return targets
    },
    [record, toggleControl],
  )

  const sendBroadcast = useCallback(() => {
    if (controlsRef.current.broadcast.status === 'executing') return
    commitControls((prev) => ({ ...prev, broadcast: { ...prev.broadcast, status: 'executing' } }))
    window.setTimeout(() => {
      commitControls((prev) => ({
        ...prev,
        broadcast: { status: 'executed', at: Date.now(), count: prev.broadcast.count + 1 },
      }))
      log(
        'ops',
        `status update #${controlsRef.current.broadcast.count} posted by commander to status page, in-app banner and @MochaTradeStatus`,
      )
      record('action', `Status update #${controlsRef.current.broadcast.count} broadcast to status page, in-app banner and @MochaTradeStatus`, 'commander')
    }, 650)
  }, [commitControls, log, record])

  return {
    metrics,
    controls,
    isPaused: engagedMap(controls, 'pause'),
    isHalted: engagedMap(controls, 'halt'),
    logs,
    ledger,
    record,
    toggleControl,
    pauseAllCascading,
    sendBroadcast,
  }
}
