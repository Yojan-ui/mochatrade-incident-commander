import { useEffect, useState, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { Coffee, ShieldAlert } from 'lucide-react'
import { ActionGrid } from '@/components/dashboard/action-grid'
import { IncidentStream } from '@/components/dashboard/incident-stream'
import { SignalNode } from '@/components/dashboard/signal-node'
import { LIQUIDATION_THRESHOLD, MARKET_LIST, formatMarketList, useIncidentSim } from '@/components/dashboard/use-incident-sim'
import { cn } from '@/lib/utils'

// The incident opened a little before this session started
const INCIDENT_OPENED = Date.now() - (7 * 60 + 12) * 1000

function Elapsed() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const s = Math.floor((now - INCIDENT_OPENED) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <span className="tabular-nums" aria-label="Time since incident opened">
      {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
    </span>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className="font-mono text-[12px] text-white">{children}</span>
    </div>
  )
}

export default function App() {
  const { metrics, controls, isPaused, isHalted, logs, toggleControl, sendBroadcast } = useIncidentSim()
  const { critical } = metrics
  const mitigated = MARKET_LIST.filter((m) => isPaused[m] || isHalted[m])
  const cascading = MARKET_LIST.filter((m) => !isPaused[m] && !isHalted[m])

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-2 p-2 md:p-3 lg:h-screen lg:min-h-[720px]">
        {/* Incident header */}
        <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 rounded-sm border border-white/10 bg-panel px-2.5 py-1.5">
          <div className="flex items-center gap-2">
            <span className="grid size-5 place-items-center rounded-sm bg-white text-black">
              <Coffee className="size-3" aria-hidden />
            </span>
            <span className="text-[13px] font-semibold text-white">MochaTrade</span>
            <span className="text-[12px] text-gray-500">/ Incident response</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Field label="Incident">INC-2417 BTC-PERP flash crash</Field>
            <span
              className={cn(
                'flex h-5 items-center gap-1 rounded-sm px-1.5 font-mono text-[11px] font-semibold',
                critical ? 'bg-crit-fill text-white' : 'border border-warn text-warn',
              )}
            >
              {critical ? 'SEV-1 CRITICAL' : 'SEV-2 ELEVATED'}
            </span>
            <Field label="Open">
              <Elapsed />
            </Field>
            <Field label="Commander">you</Field>
          </div>
        </header>

        {critical && (
          <div role="alert" className="flex items-center gap-2 rounded-sm bg-crit-fill px-2.5 py-1.5 text-[12px] text-white">
            <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
            <p>
              <span className="font-mono font-semibold">
                LIQUIDATIONS {metrics.liquidations.toLocaleString('en-US')}/MIN &gt; {LIQUIDATION_THRESHOLD}
              </span>
              <span className="mx-2 opacity-60">|</span>
              {mitigated.length === 0
                ? 'Pause margin liquidations or halt trading on the cascading markets.'
                : cascading.length === 0
                  ? 'Mitigation running on all markets. Rate should fall over the next few ticks.'
                  : `Mitigation running on ${formatMarketList(mitigated)}. ${formatMarketList(cascading)} still cascading.`}
            </p>
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
          <main className="flex min-w-0 flex-col gap-2 lg:overflow-y-auto [&>*]:shrink-0">
            <SignalNode metrics={metrics} isPaused={isPaused} isHalted={isHalted} />
            <ActionGrid
              metrics={metrics}
              controls={controls}
              isPaused={isPaused}
              isHalted={isHalted}
              onToggle={toggleControl}
              onBroadcast={sendBroadcast}
            />
          </main>

          <aside className="min-h-0">
            <IncidentStream logs={logs} critical={critical} />
          </aside>
        </div>
      </div>
    </MotionConfig>
  )
}
