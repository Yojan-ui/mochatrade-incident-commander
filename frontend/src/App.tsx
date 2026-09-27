import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { AttackMatrix } from '@/components/AttackMatrix'
import { OneFixCard } from '@/components/OneFixCard'
import { ScorePanel } from '@/components/ScorePanel'
import { ErrorPanel, ScanningBanner, Skeleton } from '@/components/States'
import { TopBar } from '@/components/TopBar'
import { VectorGrid } from '@/components/VectorGrid'
import { useReport, type Source } from '@/hooks/useReport'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { DemoScenario, VectorId } from '@/lib/types'

// three.js is ~600 KB; load it after the dashboard has painted.
const DefenseLattice = lazy(() => import('@/components/lattice/DefenseLattice'))

function LatticePlaceholder() {
  return <div className="panel h-[377px] animate-pulse bg-raised/40 sm:h-[477px]" aria-hidden />
}

const DEFAULT_SCENARIO = 'startup'

// URL state: ?demo=<id> or ?domain=<name>; ?delay=<ms> slows demo responses
// so loading states can be designed.
function sourceFromUrl(): { source: Source; delayMs: number } {
  const params = new URLSearchParams(window.location.search)
  const domain = params.get('domain')
  const delayMs = Math.max(0, Number(params.get('delay')) || 0)
  return {
    source: domain ? { kind: 'live', domain } : { kind: 'demo', id: params.get('demo') ?? DEFAULT_SCENARIO },
    delayMs,
  }
}

function writeUrl(source: Source) {
  const params = new URLSearchParams(window.location.search)
  params.delete('demo')
  params.delete('domain')
  if (source.kind === 'demo') params.set('demo', source.id)
  else params.set('domain', source.domain)
  window.history.replaceState(null, '', `?${params}`)
}

const describe = (source?: Source) => (!source ? '' : source.kind === 'demo' ? `demo:${source.id}` : source.domain)

export default function App() {
  const [initial] = useState(sourceFromUrl)
  const { status, source, report, error, startedAt, load } = useReport()
  const [scenarios, setScenarios] = useState<DemoScenario[]>([])
  const [apiUp, setApiUp] = useState<boolean | null>(null)
  const [focus, setFocus] = useState<{ id: VectorId; n: number }>()
  const focusVector = useCallback((id: VectorId) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })), [])

  // Hovering DOM elements aims the 3D camera. Clearing is delayed briefly so
  // sliding between adjacent rows retargets instead of bouncing home.
  const [flyTo, setFlyTo] = useState<VectorId | null>(null)
  const releaseTimer = useRef<number | undefined>(undefined)
  const aim = useCallback((id: VectorId | null) => {
    window.clearTimeout(releaseTimer.current)
    if (id) setFlyTo(id)
    else releaseTimer.current = window.setTimeout(() => setFlyTo(null), 180)
  }, [])
  useEffect(() => () => window.clearTimeout(releaseTimer.current), [])

  useEffect(() => {
    const controller = new AbortController()
    api.health(controller.signal).then(
      () => setApiUp(true),
      () => !controller.signal.aborted && setApiUp(false),
    )
    api.scenarios(controller.signal).then(setScenarios, () => {})
    load(initial.source, initial.delayMs)
    return () => controller.abort()
  }, [initial, load])

  const select = useCallback(
    (next: Source) => {
      setFocus(undefined) // don't re-scroll to a card from the previous report
      setFlyTo(null)
      writeUrl(next)
      load(next, initial.delayMs)
    },
    [initial.delayMs, load],
  )

  const loading = status === 'loading'
  const reportKey = report ? `${report.domain}-${report.scanned_at}` : ''

  return (
    <div className="min-h-dvh">
      <TopBar
        initialDomain={initial.source.kind === 'live' ? initial.source.domain : ''}
        scenarios={scenarios}
        source={source}
        loading={loading}
        apiUp={apiUp}
        onSelect={select}
      />

      <main className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-4">
        {loading && startedAt !== undefined && <ScanningBanner target={describe(source)} since={startedAt} />}

        {status === 'error' && error && source && (
          <ErrorPanel error={error} target={describe(source)} onRetry={() => load(source, initial.delayMs)} />
        )}

        {!report && loading && <Skeleton />}

        {report && status !== 'error' && (
          <div className={cn('flex flex-col gap-3', loading && 'pointer-events-none')} aria-busy={loading}>
            {/*
              < lg : stacked      Score / One Fix / Lattice / Matrix
                lg : Score | One Fix, then Lattice and Matrix full width
                xl : One Fix + Matrix on the left, Score + a sticky Lattice on the
                     right, so the camera fly-to stays in view while hovering rows.
            */}
            <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <div className={cn('xl:col-start-2 xl:row-start-1', loading && 'opacity-40')}>
                <ScorePanel report={report} />
              </div>
              {/* Keyed so per-report UI state (expanded lists) resets on a new scan */}
              <div className={cn('xl:col-start-1 xl:row-start-1', loading && 'opacity-40')}>
                <OneFixCard key={reportKey} report={report} onAim={aim} />
              </div>
              {/* Not keyed: the lattice stays mounted so links animate between reports */}
              <div className="lg:col-span-2 xl:sticky xl:top-28 xl:col-span-1 xl:col-start-2 xl:row-start-2 xl:self-start">
                <Suspense fallback={<LatticePlaceholder />}>
                  <DefenseLattice report={report} dimmed={loading} flyTo={flyTo} onSelectVector={focusVector} />
                </Suspense>
              </div>
              <div className={cn('lg:col-span-2 xl:col-span-1 xl:col-start-1 xl:row-start-2', loading && 'opacity-40')}>
                <AttackMatrix report={report} onAim={aim} />
              </div>
            </div>
            <div className={cn(loading && 'opacity-40')}>
              <VectorGrid key={reportKey} report={report} focus={focus} />
            </div>
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-6 font-mono text-[10px] tracking-wider text-slate-600">
        SPF · DKIM · DMARC · MX · STARTTLS/25 · MTA-STS · TLS-RPT
      </footer>
    </div>
  )
}
