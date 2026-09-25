import type { jsPDF } from 'jspdf'
import { RULINGS, type RulingKind } from './decision-matrix'
import {
  INCIDENT_OPENED_AT,
  MARKET_LIST,
  SESSION_STARTED_AT,
  fmtPrice,
  usd,
  verifyLedger,
  type Controls,
  type LedgerEntry,
  type Metrics,
} from './use-incident-sim'

export interface PostmortemInput {
  metrics: Metrics
  controls: Controls
  ruling: RulingKind | null
  ledger: readonly LedgerEntry[]
  slaMinutes?: number
  generatedAt?: number
}

const iso = (ts: number) => new Date(ts).toISOString().replace(/\.\d{3}Z$/, 'Z')
const utcClock = (ts: number) => new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false })
const istClock = (ts: number) => new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })
const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
const TAG: Record<LedgerEntry['kind'], string> = { action: 'ACT', decision: 'DEC', escalation: 'ESC', note: 'NOTE', system: 'SYS' }

/** Filename-safe UTC stamp, e.g. 2026-09-25T09-53-12Z */
export const fileStamp = (ts: number) => iso(ts).replace(/:/g, '-')

/** Every fact the report states, computed once from the dashboard state */
export function summarizeIncident({ metrics, controls, ruling, ledger, slaMinutes, generatedAt = Date.now() }: PostmortemInput) {
  const reachedSev1 =
    metrics.critical ||
    metrics.escalation.active ||
    ledger.some((e) => e.text.startsWith('SEV-1 declared') || e.text.startsWith('Escalation trigger'))
  const activeNow = metrics.critical || metrics.escalation.active
  const firstMitigation = ledger.find((e) => e.kind === 'action' && /paused|halted/.test(e.text))
  const status = (m: (typeof MARKET_LIST)[number]) =>
    controls.markets[m].halt.status === 'executed'
      ? 'HALTED'
      : controls.markets[m].pause.status === 'executed'
        ? 'LIQ PAUSED'
        : 'LIVE'
  const stillMitigated = MARKET_LIST.filter((m) => status(m) !== 'LIVE')

  const followUps: string[] = []
  if (!ruling) followUps.push('Complete the Fault-vs-Market ruling; no ruling was recorded.')
  if (ruling === 'fault') followUps.push('Run the Insurance Fund compensation job for liquidations on affected markets inside the incident window.')
  if (ruling === 'unsure') followUps.push(`48-hour case-by-case review due by ${iso(generatedAt + 48 * 3_600_000)}.`)
  if (stillMitigated.length) followUps.push(`Plan and announce reopening for: ${stillMitigated.map((m) => `${m} (${status(m)})`).join(', ')}.`)
  if (controls.broadcast.count === 0) followUps.push('No public status update was broadcast during the incident.')
  if (metrics.usEquityClosed) followUps.push('Review stale-reference risk controls for US-stock perps during US off-hours.')
  followUps.push('Root-cause analysis: price feed, liquidation engine and margin parameters.')

  return {
    generatedAt,
    severity: reachedSev1 ? 'SEV-1' : 'SEV-2',
    activeNow,
    ruling: ruling
      ? { category: RULINGS[ruling].category, text: RULINGS[ruling].ruling, basis: RULINGS[ruling].basis }
      : null,
    totalLiqVolume: metrics.cumLiqVolumeUsd,
    liquidationsExecuted: Math.round(metrics.cumLiquidations),
    peakLiqVolumeRate: metrics.peakLiqVolumeUsd,
    timeToFirstMitigationMs: firstMitigation ? firstMitigation.ts - INCIDENT_OPENED_AT : null,
    timeToResolutionMs: generatedAt - INCIDENT_OPENED_AT,
    slaMinutes,
    broadcasts: controls.broadcast.count,
    tickets: metrics.tickets,
    usEquityClosed: metrics.usEquityClosed,
    markets: MARKET_LIST.map((m) => ({
      market: m,
      status: status(m),
      mark: fmtPrice(m, metrics.prices[m]),
      change: pct(metrics.drawdownByMarket[m]),
      volume: usd(metrics.liqVolumeByMarket[m]),
    })),
    followUps,
    ledger,
    chainIntact: verifyLedger(ledger),
    head: ledger[ledger.length - 1]?.hash ?? '-',
  }
}

/**
 * The PDF's built-in Courier only covers Latin-1, so symbols used on screen
 * (≥, →, ×, …, dashes) are spelled out; anything else unsupported becomes '?'.
 */
const ASCII: Record<string, string> = { '≥': '>=', '≤': '<=', '→': '->', '×': 'x', '…': '...', '—': '-', '–': '-', '·': '-', '’': "'", '“': '"', '”': '"' }
export const pdfSafe = (text: string) =>
  text.replace(/[^\x20-\x7e]/g, (ch) => ASCII[ch] ?? '?')

const A4 = { w: 210, h: 297 }
const MARGIN = 15
const FOOTER = 12

/**
 * Lays out the post-mortem on a jsPDF document: header, summary metrics,
 * market state, follow-ups, the full hash-chained decision ledger (paginated),
 * and sign-off lines. Courier throughout.
 */
export function renderPostmortemPdf(doc: jsPDF, report: ReturnType<typeof summarizeIncident>) {
  const width = A4.w - MARGIN * 2
  let y = MARGIN

  const ensure = (height: number) => {
    if (y + height > A4.h - MARGIN - FOOTER) {
      doc.addPage()
      y = MARGIN
      // Running header on continuation pages
      doc.setFont('courier', 'bold').setFontSize(8).setTextColor(90)
      doc.text('MOCHATRADE // INC-2417 // POST-MORTEM (CONT.)', MARGIN, y)
      doc.setDrawColor(180).line(MARGIN, y + 2, A4.w - MARGIN, y + 2)
      y += 8
    }
  }
  const lineHeight = (size: number) => size * 0.3528 * 1.35 // pt → mm, with leading
  const setType = (size: number, bold: boolean, color: number) =>
    doc.setFont('courier', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(color)
  /** Wrapped lines for text at a given size, measured with that size's font */
  const wrap = (text: string, size: number, bold: boolean, indent: number) => {
    setType(size, bold, 20)
    return doc.splitTextToSize(pdfSafe(text), width - indent) as string[]
  }
  const write = (text: string, opts: { size?: number; bold?: boolean; color?: number; indent?: number; gap?: number } = {}) => {
    const { size = 9, bold = false, color = 20, indent = 0, gap = 0.4 } = opts
    const lineH = lineHeight(size)
    for (const line of wrap(text, size, bold, indent)) {
      ensure(lineH)
      // Set the type after the page check: a new page draws its running header
      // in a different font, which must not leak into this line
      setType(size, bold, color)
      doc.text(line, MARGIN + indent, y + lineH * 0.8)
      y += lineH
    }
    y += gap
  }
  const rule = (weight = 0.2) => {
    ensure(3)
    doc.setDrawColor(0).setLineWidth(weight).line(MARGIN, y + 1, A4.w - MARGIN, y + 1)
    y += 3
  }
  const section = (title: string) => {
    y += 2
    ensure(10)
    write(title, { size: 10, bold: true, gap: 0 })
    rule(0.3)
  }
  const kv = (label: string, value: string, bold = false) => write(`${label.padEnd(26, '.')} ${value}`, { bold })

  // ── Header: black bar with the title in white ─────────────────────────────
  doc.setFillColor('#000000').rect(0, 0, A4.w, 26, 'F')
  doc.setFont('courier', 'bold').setFontSize(15).setTextColor(255)
  doc.text(pdfSafe(`MOCHATRADE ${report.severity} INCIDENT POST-MORTEM`), MARGIN, 12)
  doc.setFont('courier', 'normal').setFontSize(8.5).setTextColor(200)
  doc.text(`INC-2417  BTC-PERP flash crash  //  generated ${iso(report.generatedAt)}`, MARGIN, 19)
  y = 34

  write(`DOCUMENT ID  INC-2417-${report.head}`, { size: 8, color: 90, gap: 0 })
  write(`CLASSIFICATION  CONFIDENTIAL - INTERNAL / REGULATORY`, { size: 8, color: 90 })

  // ── Summary metrics ────────────────────────────────────────────────────────
  section('1. SUMMARY METRICS')
  kv('TOTAL LIQUIDATION VOLUME', usd(report.totalLiqVolume), true)
  kv('FAULT-VS-MARKET RULING', report.ruling ? `${report.ruling.category}: ${report.ruling.text.replace(/^RULING: /, '')}` : 'NOT RECORDED', true)
  kv(
    'TIME TO RESOLUTION',
    `${duration(report.timeToResolutionMs)}${report.activeNow ? '  (UNRESOLVED at export: SEV-1 active)' : ''}`,
    true,
  )
  kv('TIME TO FIRST MITIGATION', report.timeToFirstMitigationMs === null ? 'none recorded' : duration(report.timeToFirstMitigationMs))
  kv('PEAK SEVERITY', report.severity)
  kv('LIQUIDATIONS EXECUTED', report.liquidationsExecuted.toLocaleString('en-US'))
  kv('PEAK LIQUIDATION RATE', `${usd(report.peakLiqVolumeRate)}/min`)
  kv('OPEN SUPPORT TICKETS', report.tickets.toLocaleString('en-US'))
  kv('STATUS UPDATES BROADCAST', String(report.broadcasts))
  kv('SLA WINDOW', report.slaMinutes ? `${report.slaMinutes} min` : 'n/a')
  kv('US EQUITY MARKETS', report.usEquityClosed ? 'CLOSED (stale reference on US-stock perps)' : 'OPEN')
  kv('INCIDENT OPENED', `${iso(INCIDENT_OPENED_AT)}  (${istClock(INCIDENT_OPENED_AT)} IST)`)
  write(`Volume totals are measured from monitoring start, ${iso(SESSION_STARTED_AT)}.`, { size: 7.5, color: 90 })
  if (report.ruling) write(report.ruling.basis, { size: 8, color: 60 })

  // ── Market state ───────────────────────────────────────────────────────────
  section('2. MARKETS AT EXPORT')
  write(`${'MARKET'.padEnd(11)}${'STATUS'.padEnd(12)}${'MARK'.padStart(11)}${'24H'.padStart(9)}${'LIQ VOL/MIN'.padStart(14)}`, { bold: true, gap: 0 })
  for (const m of report.markets) {
    write(`${m.market.padEnd(11)}${m.status.padEnd(12)}${m.mark.padStart(11)}${m.change.padStart(9)}${m.volume.padStart(14)}`, { gap: 0 })
  }

  // ── Follow-ups ─────────────────────────────────────────────────────────────
  section('3. FOLLOW-UP ACTIONS')
  for (const f of report.followUps) write(`[ ] ${f}`, { indent: 0 })

  // ── Decision record ────────────────────────────────────────────────────────
  section('4. DECISION RECORD (IMMUTABLE LEDGER)')
  write(
    `${report.ledger.length} entries. Hash chain (FNV-1a, genesis 00000000) ${report.chainIntact ? 'VERIFIED' : 'BROKEN'}; head ${report.head}. Each hash covers the previous hash and the entry, so any edit breaks every later link.`,
    { size: 7.5, color: 90 },
  )
  for (const e of report.ledger) {
    const important = e.kind === 'decision' || e.kind === 'escalation'
    const entry = `#${String(e.seq).padStart(4, '0')}  ${utcClock(e.ts)} UTC  ${TAG[e.kind].padEnd(4)}  ${e.text} [by ${e.actor}]`
    const proof = `${' '.repeat(7)}${iso(e.ts)}  prev=${e.prevHash}  hash=${e.hash}`
    // Keep each entry and its hash line together on one page
    const blockHeight = wrap(entry, 8, important, 0).length * lineHeight(8) + lineHeight(6.5) + 1.2
    ensure(blockHeight)
    write(entry, { size: 8, bold: important, gap: 0 })
    write(proof, { size: 6.5, color: 120, gap: 1.2 })
  }

  // ── Sign-off ───────────────────────────────────────────────────────────────
  section('5. SIGN-OFF')
  for (const role of ['INCIDENT COMMANDER', 'HEAD OF RISK', 'COMPLIANCE OFFICER']) {
    ensure(12)
    y += 6
    write(`${role.padEnd(20)} ____________________________   DATE ____________`, { size: 8.5 })
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(180).setLineWidth(0.2).line(MARGIN, A4.h - FOOTER, A4.w - MARGIN, A4.h - FOOTER)
    doc.setFont('courier', 'normal').setFontSize(7).setTextColor(110)
    doc.text(`CONFIDENTIAL // INC-2417 // ledger head ${report.head} // chain ${report.chainIntact ? 'VERIFIED' : 'BROKEN'}`, MARGIN, A4.h - FOOTER + 5)
    doc.text(`PAGE ${p} OF ${pages}`, A4.w - MARGIN, A4.h - FOOTER + 5, { align: 'right' })
  }
  return doc
}
