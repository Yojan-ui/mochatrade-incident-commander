import { Fragment, useState } from 'react'
import { cn } from '@/lib/utils'
import { MARKET_LIST, formatMarketList, type Controls, type Market, type Metrics } from './use-incident-sim'

type TemplateId = 'pricing' | 'halt' | 'compensation'

interface Template {
  id: TemplateId
  title: string
  purpose: string
  body: string
}

const TEMPLATES: Template[] = [
  {
    id: 'pricing',
    title: 'Acknowledge Abnormal Pricing',
    purpose: 'First public word. Buys time without admitting cause.',
    body: 'We are aware of abnormal price movement on [ASSET] since [TIME]. Our risk team is investigating. Trading remains open and customer funds are safe. Next update in 30 minutes.',
  },
  {
    id: 'halt',
    title: 'Announce Market Halt',
    purpose: 'Required as soon as trading is halted on any market.',
    body: 'Trading on [ASSET] was halted at [TIME] to protect customers during extreme volatility. Open orders are frozen and no positions will be liquidated while the halt is in place. We will announce a reopening time at least 15 minutes in advance.',
  },
  {
    id: 'compensation',
    title: 'Insurance Fund Compensation Notice',
    purpose: 'Send only after a System Fault ruling.',
    body: "Positions on [ASSET] liquidated after [TIME] during this incident are under review. Where a liquidation was caused by a fault on MochaTrade's side, losses will be compensated from the Insurance Fund. Affected customers will be contacted directly within 48 hours; no action is needed.",
  },
]

/** "14:45 UTC / 20:15 IST" */
function stamp(ts: number) {
  const fmt = (timeZone: string) =>
    new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
  return `${fmt('UTC')} UTC / ${fmt('Asia/Kolkata')} IST`
}

interface Resolved {
  asset: string
  assetSource: string
  time: string
  timeSource: string
  warning?: string
}

/** Fills [ASSET] and [TIME] from the simulation, and says where each value came from */
function resolve(id: TemplateId, metrics: Metrics, controls: Controls, incidentOpenedAt: number): Resolved {
  const engaged = (m: Market) =>
    controls.markets[m].pause.status === 'executed' || controls.markets[m].halt.status === 'executed'
  const byStress = [...MARKET_LIST].sort((a, b) => metrics.stressByMarket[b] - metrics.stressByMarket[a])
  const opened = { time: stamp(incidentOpenedAt), timeSource: 'incident opened' }

  if (id === 'pricing') {
    const top = byStress.find((m) => !engaged(m)) ?? byStress[0]
    return { asset: top, assetSource: `highest stress, ${metrics.stressByMarket[top].toFixed(2)}×`, ...opened }
  }

  if (id === 'halt') {
    const halted = MARKET_LIST.filter((m) => controls.markets[m].halt.status === 'executed')
    if (halted.length === 0) {
      return {
        asset: byStress[0],
        assetSource: 'no market halted; showing highest stress',
        time: stamp(Date.now()),
        timeSource: 'now',
        warning: 'No market is halted. Halt one in Market controls before sending this.',
      }
    }
    const first = Math.min(...halted.map((m) => controls.markets[m].halt.at ?? Date.now()))
    return { asset: formatMarketList(halted), assetSource: 'halted markets', time: stamp(first), timeSource: 'first halt executed' }
  }

  const affected = MARKET_LIST.filter((m) => metrics.stressByMarket[m] >= 1 || engaged(m))
  const list = affected.length ? affected : [byStress[0]]
  return {
    asset: formatMarketList(list),
    assetSource: affected.length ? 'stress ≥ 1.0× or behind a breaker' : 'none over 1.0×; showing highest stress',
    ...opened,
  }
}

interface Staged {
  template: Template
  resolved: Resolved
  at: number
}

const fill = (body: string, r: Resolved) => body.replaceAll('[ASSET]', r.asset).replaceAll('[TIME]', r.time)

/** Renders the filled template with substituted values highlighted, so a reviewer sees what changed */
function Highlighted({ body, resolved }: { body: string; resolved: Resolved }) {
  const parts = body.split(/(\[ASSET\]|\[TIME\])/)
  return (
    <>
      {parts.map((part, i) =>
        part === '[ASSET]' || part === '[TIME]' ? (
          <mark key={i} className="bg-[#22c55e]/15 px-0.5 text-[#22c55e]">
            {part === '[ASSET]' ? resolved.asset : resolved.time}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

export function CommsTriage({
  metrics,
  controls,
  incidentOpenedAt,
  onRecord,
}: {
  metrics: Metrics
  controls: Controls
  incidentOpenedAt: number
  onRecord?: (text: string) => void
}) {
  const [staged, setStaged] = useState<Staged | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const stage = (template: Template) => {
    const resolved = resolve(template.id, metrics, controls, incidentOpenedAt)
    setStaged({ template, resolved, at: Date.now() })
    setCopyState('idle')
    onRecord?.(`Comms staged: ${template.title} (${resolved.asset})`)
  }

  // Clipboard API first; fall back to a hidden textarea for browsers or contexts
  // that refuse it. Say so plainly if both fail rather than failing silently.
  const copy = async () => {
    if (!staged) return
    const text = fill(staged.template.body, staged.resolved)
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      onRecord?.(`Comms copied for external broadcast: ${staged.template.title}`)
      return
    } catch {
      // fall through to the legacy path
    }
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    setCopyState(ok ? 'copied' : 'failed')
    if (ok) onRecord?.(`Comms copied for external broadcast: ${staged.template.title}`)
  }

  const btn =
    'h-7 shrink-0 border px-2.5 font-mono text-[11px] font-semibold tracking-wide transition-colors duration-75 active:translate-y-px'

  return (
    <section aria-labelledby="comms-heading" className="border border-white/10 bg-black">
      <div className="flex h-7 items-center justify-between border-b border-white/10 px-2.5">
        <h2 id="comms-heading" className="text-[12px] font-medium text-white">
          Comms triage
        </h2>
        <span className="hidden font-mono text-[10px] text-gray-500 sm:inline">external templates, [ASSET] and [TIME] filled live</span>
      </div>

      <ul>
        {TEMPLATES.map((t) => {
          const active = staged?.template.id === t.id
          return (
            <li
              key={t.id}
              className={cn(
                'flex items-center justify-between gap-3 border-b border-white/[0.06] px-2.5 py-2',
                active && 'bg-white/[0.03]',
              )}
            >
              <div className="min-w-0">
                <div className="font-mono text-[12px] font-semibold text-white">{t.title}</div>
                <div className="text-[11px] text-gray-500">{t.purpose}</div>
              </div>
              <button
                type="button"
                onClick={() => stage(t)}
                aria-pressed={active}
                className={cn(
                  btn,
                  active
                    ? 'border-[#22c55e] bg-black text-[#22c55e] hover:bg-[#22c55e]/10'
                    : 'border-white bg-white text-black hover:bg-gray-200 active:bg-gray-300',
                )}
              >
                {active ? 'RESTAGE' : 'STAGE FOR BROADCAST'}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="p-2.5" aria-live="polite">
        {staged ? (
          <div className={cn('border bg-black', staged.resolved.warning ? 'border-warn' : 'border-[#22c55e]')}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-2.5 py-1 font-mono text-[10px]">
              <span className={staged.resolved.warning ? 'text-warn' : 'text-[#22c55e]'}>
                STAGED: {staged.template.title.toUpperCase()}
              </span>
              <span className="text-gray-500">
                values as of{' '}
                <span className="text-white">{new Date(staged.at).toLocaleTimeString('en-GB')}</span>
              </span>
            </div>
            {staged.resolved.warning && (
              <div className="border-b border-warn/40 bg-warn/10 px-2.5 py-1 font-mono text-[11px] text-warn">
                {staged.resolved.warning}
              </div>
            )}
            <p className="px-2.5 py-2 font-mono text-[12px] leading-relaxed text-gray-200">
              <Highlighted body={staged.template.body} resolved={staged.resolved} />
            </p>
            <dl className="grid grid-cols-1 gap-x-4 border-t border-white/10 px-2.5 py-1.5 font-mono text-[10px] sm:grid-cols-2">
              <div>
                <dt className="inline text-gray-500">[ASSET] </dt>
                <dd className="inline text-white">
                  {staged.resolved.asset} <span className="text-gray-500">({staged.resolved.assetSource})</span>
                </dd>
              </div>
              <div>
                <dt className="inline text-gray-500">[TIME] </dt>
                <dd className="inline text-white">
                  {staged.resolved.time} <span className="text-gray-500">({staged.resolved.timeSource})</span>
                </dd>
              </div>
            </dl>
            <div className="flex justify-end gap-2 border-t border-white/10 px-2.5 py-1.5">
              <button
                type="button"
                onClick={() => {
                  setStaged(null)
                  setCopyState('idle')
                }}
                className={cn(btn, 'border-white/20 bg-black text-gray-400 hover:bg-white/5 hover:text-white')}
              >
                CLEAR
              </button>
              <button
                type="button"
                onClick={copy}
                className={cn(
                  btn,
                  copyState === 'copied'
                    ? 'border-[#22c55e] bg-black text-[#22c55e]'
                    : copyState === 'failed'
                      ? 'border-crit bg-black text-crit'
                      : 'border-white bg-white text-black hover:bg-gray-200 active:bg-gray-300',
                )}
              >
                {copyState === 'copied' ? 'COPIED' : copyState === 'failed' ? 'COPY FAILED, SELECT TEXT' : 'COPY'}
              </button>
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-white/15 px-2.5 py-2 font-mono text-[11px] text-gray-500">
            Nothing staged. Pick a template above to preview it with live values.
          </div>
        )}
      </div>
    </section>
  )
}
