import { useCallback, useEffect, useState } from 'react'
import { AttackMatrix } from '@/components/AttackMatrix'
import { OneFixCard } from '@/components/OneFixCard'
import { ScorePanel } from '@/components/ScorePanel'
import { ErrorPanel, ScanningBanner, Skeleton } from '@/components/States'
import { TopBar } from '@/components/TopBar'
import { VectorGrid } from '@/components/VectorGrid'
import { useReport, type Source } from '@/hooks/useReport'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { DemoScenario } from '@/lib/types'

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
      writeUrl(next)
      load(next, initial.delayMs)
    },
    [initial.delayMs, load],
  )

  const loading = status === 'loading'

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
          // Keyed by report so per-card expand state resets on a new scan.
          <div
            key={`${report.domain}-${report.scanned_at}`}
            className={cn('flex flex-col gap-3 transition-opacity', loading && 'pointer-events-none opacity-40')}
            aria-busy={loading}
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <ScorePanel report={report} />
              <OneFixCard report={report} />
            </div>
            <AttackMatrix report={report} />
            <VectorGrid report={report} />
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-6 font-mono text-[10px] tracking-wider text-slate-600">
        SPF · DKIM · DMARC · MX · STARTTLS/25 · MTA-STS · TLS-RPT
      </footer>
    </div>
  )
}
