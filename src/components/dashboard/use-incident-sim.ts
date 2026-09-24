import { useCallback, useEffect, useRef, useState } from 'react'

export const LIQUIDATION_THRESHOLD = 500
const HISTORY_LENGTH = 28
const MAX_LOG_LINES = 80
const MAX_LIQUIDATIONS = 9_999
const PRICE_STEP_MS = 850

/** Per-market incident controls; broadcast is global and handled separately */
export type Control = 'pause' | 'halt'
export type ActionStatus = 'idle' | 'executing' | 'executed'
export type LogLevel = 'liq' | 'sev' | 'ops' | 'tkt' | 'sys'
export type Market = 'BTC-PERP' | 'ETH-PERP' | 'SOL-PERP'

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
   * Per-tick growth factor compounded over the last 3 ticks (geometric mean of
   * liq[n] / liq[n-1]). Above 1 means the cascade is compounding.
   */
  growth: number
  critical: boolean
  prices: Record<Market, number>
  /** BTC-PERP change since the session open */
  drawdown: number
  drawdownByMarket: Record<Market, number>
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
  markets: {
    'BTC-PERP': { pause: idle(), halt: idle() },
    'ETH-PERP': { pause: idle(), halt: idle() },
    'SOL-PERP': { pause: idle(), halt: idle() },
  },
  broadcast: idle(),
})

const engagedMap = (controls: Controls, control: Control) =>
  Object.fromEntries(
    MARKET_LIST.map((m) => [m, controls.markets[m][control].status === 'executed']),
  ) as Record<Market, boolean>

const OPEN_PRICES: Record<Market, number> = { 'BTC-PERP': 64_820, 'ETH-PERP': 2_770, 'SOL-PERP': 143.4 }
const START_PRICES: Record<Market, number> = { 'BTC-PERP': 61_940, 'ETH-PERP': 2_642, 'SOL-PERP': 136.8 }
// Alts fall harder than BTC in a cascade
const BETA: Record<Market, number> = { 'BTC-PERP': 1, 'ETH-PERP': 1.25, 'SOL-PERP': 1.6 }
const UNIT: Record<Market, string> = { 'BTC-PERP': 'BTC', 'ETH-PERP': 'ETH', 'SOL-PERP': 'SOL' }
export const MARKET_LIST: readonly Market[] = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP']
const SHARE: Record<Market, number> = { 'BTC-PERP': 0.5, 'ETH-PERP': 0.33, 'SOL-PERP': 0.17 }
/** "BTC-PERP", "BTC-PERP and ETH-PERP", "BTC-PERP, ETH-PERP and SOL-PERP" */
export const formatMarketList = (markets: readonly string[]) =>
  markets.length <= 1 ? (markets[0] ?? '') : `${markets.slice(0, -1).join(', ')} and ${markets[markets.length - 1]}`

const last = (history: number[]) => history[history.length - 1]
const byMarket = <T,>(fn: (m: Market) => T) =>
  Object.fromEntries(MARKET_LIST.map((m) => [m, fn(m)])) as Record<Market, T>

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const push = (history: number[], value: number) => [...history.slice(-(HISTORY_LENGTH - 1)), value]
const hexAcct = () =>
  `${Math.floor(rand(0x1000, 0xffff)).toString(16)}…${Math.floor(rand(0x100, 0xfff)).toString(16)}`
const fmtPrice = (market: Market, px: number) =>
  px.toLocaleString('en-US', { minimumFractionDigits: market === 'SOL-PERP' ? 2 : 1, maximumFractionDigits: market === 'SOL-PERP' ? 2 : 1 })

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
  const hot = total >= LIQUIDATION_THRESHOLD
  const w = {
    'BTC-PERP': SHARE['BTC-PERP'] * rand(0.85, 1.15) * (hot ? 0.85 : 1),
    'ETH-PERP': SHARE['ETH-PERP'] * rand(0.85, 1.15),
    'SOL-PERP': SHARE['SOL-PERP'] * rand(0.85, 1.15) * (hot ? 1.3 : 1),
  }
  const sum = w['BTC-PERP'] + w['ETH-PERP'] + w['SOL-PERP']
  const eth = Math.round((total * w['ETH-PERP']) / sum)
  const sol = Math.round((total * w['SOL-PERP']) / sum)
  return { 'BTC-PERP': total - eth - sol, 'ETH-PERP': eth, 'SOL-PERP': sol }
}

const GROWTH_WINDOW = 3

function compoundedGrowth(history: number[]) {
  const now = history[history.length - 1]
  const then = history[history.length - 1 - GROWTH_WINDOW]
  if (!then || !now) return 1
  return Math.pow(now / then, 1 / GROWTH_WINDOW)
}

type Series = Pick<Metrics, 'liqHistory' | 'ticketHistory' | 'liqByMarket'>

function seedSeries(): Series {
  const liqHistory = seedExponential(184, 34)
  const splits = liqHistory.map(splitByMarket)
  return {
    liqHistory,
    ticketHistory: seedExponential(312, 96),
    liqByMarket: byMarket((m) => splits.map((s) => s[m])),
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
    growth: compoundedGrowth(liqHistory),
    critical: liquidations >= LIQUIDATION_THRESHOLD,
    prices,
    drawdown: (prices['BTC-PERP'] - OPEN_PRICES['BTC-PERP']) / OPEN_PRICES['BTC-PERP'],
    drawdownByMarket: byMarket((m) => (prices[m] - OPEN_PRICES[m]) / OPEN_PRICES[m]),
  }
}

export function useIncidentSim() {
  const [metrics, setMetrics] = useState<Metrics>(() => snapshot(seedSeries(), START_PRICES))
  const [controls, setControls] = useState<Controls>(initialControls)
  const [logs, setLogs] = useState<LogLine[]>([])

  // Timers read through refs so they never restart. Both refs are written in the
  // same statement as their state, so a timer never sees a value the UI doesn't.
  const metricsRef = useRef(metrics)
  const controlsRef = useRef(controls)
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

      // Tickets accumulate from liquidations, so they compound with them
      const inflow = liquidations * rand(0.08, 0.14)
      const tickets = Math.round(
        Math.max(40, broadcasted ? prev.tickets * 0.9 + inflow * 0.35 : prev.tickets + inflow),
      )

      const next = snapshot(
        {
          liqHistory: push(prev.liqHistory, liquidations),
          ticketHistory: push(prev.ticketHistory, tickets),
          liqByMarket: byMarket((m) => push(prev.liqByMarket[m], liqNext[m])),
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
      } else if (prev.critical && !next.critical) {
        log('sys', `liquidations back under ${LIQUIDATION_THRESHOLD}/min (${liquidations}); holding SEV-1 until stable for 10 min`)
      } else if (spiking) {
        log('liq', `spike: ${spiking.m} ${spiking.from} → ${spiking.to}/min, cascade through the book`)
      }
      if (next.ticketDelta > 45 && next.ticketDelta > prev.tickets * 0.12) {
        log('tkt', `+${next.ticketDelta} tickets in last tick; top tag "position closed without warning"`)
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
        prices[m] = prices[m] * (1 - pressure * ease * BETA[m] * rand(0.6, 1.4))
      }
      commitMetrics(snapshot(prev, prices))

      // Only markets still liquidating can log liquidation events
      const activeLiq = active.reduce((sum, m) => sum + last(prev.liqByMarket[m]), 0)
      if (activeLiq === 0 || Math.random() > Math.min(0.85, activeLiq / 600)) return
      let r = Math.random() * activeLiq
      const market = active.find((m) => (r -= last(prev.liqByMarket[m])) < 0) ?? active[0]
      const size = market === 'BTC-PERP' ? rand(0.4, 38) : market === 'ETH-PERP' ? rand(8, 540) : rand(90, 9200)
      const slip = rand(0.4, prev.critical ? 7.8 : 3.2)
      log(
        'liq',
        `${market}  long ${size.toFixed(2)} ${UNIT[market]} @ ${fmtPrice(market, prices[market])}  acct ${hexAcct()}  slip ${slip.toFixed(1)}%`,
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
      }, 650)
    },
    [commitControls, log],
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
    }, 650)
  }, [commitControls, log])

  return {
    metrics,
    controls,
    isPaused: engagedMap(controls, 'pause'),
    isHalted: engagedMap(controls, 'halt'),
    logs,
    toggleControl,
    sendBroadcast,
  }
}
