import { useEffect, useState, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { Coffee, ShieldAlert } from 'lucide-react'
import { ActionGrid } from '@/components/dashboard/action-grid'
import { ASSET_TABS, AssetTabs, TAB_MARKET, tabLabelledBy, tabPanelId, type AssetTab } from '@/components/dashboard/asset-tabs'
import type { LaneState } from '@/components/dashboard/cascade-dynamics'
import { CascadePanel } from '@/components/dashboard/cascade-panel'
import { CommsTriage } from '@/components/dashboard/comms-triage'
import { DecisionMatrix, type RulingKind } from '@/components/dashboard/decision-matrix'
import { IncidentLog } from '@/components/dashboard/incident-log'
import { LiveSignalsPanel } from '@/components/dashboard/live-signals-panel'
import { IncidentStream } from '@/components/dashboard/incident-stream'
import { SignalNode } from '@/components/dashboard/signal-node'
import {
  INCIDENT_OPENED_AT,
  LIQUIDATION_THRESHOLD,
  MARKET_LIST,
  formatMarketList,
  useIncidentSim,
  type Market,
} from '@/components/dashboard/use-incident-sim'
import { cn } from '@/lib/utils'


function Elapsed() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const s = Math.floor((now - INCIDENT_OPENED_AT) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <span className="tabular-nums" aria-label="Time since incident opened">
      {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
    </span>
  )
}

const DEFAULT_SLA_MIN = 60
const MAX_SLA_MIN = 999

/**
 * Time left to resolve the incident before the SLA is breached. The duration is
 * a command-line style parameter: type minutes, press Enter, and the countdown
 * restarts from that value. It counts against a fixed deadline, so throttled
 * timers can't make it drift. Red while SEV-1 is active, and once breached.
 */
function SlaCountdown({ critical, onApply }: { critical: boolean; onApply?: (minutes: number) => void }) {
  const [minutes, setMinutes] = useState(DEFAULT_SLA_MIN)
  const [draft, setDraft] = useState(String(DEFAULT_SLA_MIN))
  const [invalid, setInvalid] = useState(false)
  const [deadline, setDeadline] = useState(() => Date.now() + DEFAULT_SLA_MIN * 60_000)
  const [now, setNow] = useState(() => Date.now())
  const left = Math.max(0, Math.ceil((deadline - now) / 1000))
  const breached = left === 0

  useEffect(() => {
    if (breached) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [breached, deadline])

  const apply = () => {
    const value = Number.parseInt(draft, 10)
    if (!Number.isFinite(value) || value < 1 || value > MAX_SLA_MIN) {
      setInvalid(true)
      return
    }
    const t = Date.now()
    setMinutes(value)
    setDraft(String(value))
    setDeadline(t + value * 60_000)
    setNow(t)
    setInvalid(false)
    onApply?.(value)
  }

  const revert = () => {
    setDraft(String(minutes))
    setInvalid(false)
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  const red = critical || breached
  return (
    <div
      className={cn(
        'flex h-7 items-center gap-2 rounded-sm border bg-black pr-2 pl-1.5 font-mono',
        red ? 'border-crit' : 'border-white/20',
      )}
    >
      <label className="group flex items-center text-[11px] text-gray-500">
        <span aria-hidden>[</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={3}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value.replace(/\D/g, ''))
            setInvalid(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply()
            else if (e.key === 'Escape') {
              revert()
              e.currentTarget.blur()
            }
          }}
          onBlur={revert}
          aria-label="SLA duration in minutes. Press Enter to restart the countdown."
          aria-invalid={invalid}
          className={cn(
            'mx-1 h-5 w-[4.5ch] rounded-none border bg-black px-0.5 text-center text-[12px] font-semibold text-white caret-[#22c55e]',
            // Replaces the browser focus ring with a terminal-style one, so keyboard focus stays visible
            'outline-none focus:border-[#22c55e] focus-visible:outline-none',
            // Error beats the focus colour, since it appears while the field has focus
            invalid ? 'border-crit text-crit focus:border-crit' : 'border-white/25 hover:border-white/50',
          )}
        />
        <span aria-hidden>]</span>
        <span className="ml-1.5 whitespace-nowrap">MIN SLA</span>
      </label>
      <span
        className={cn('text-[15px] leading-none font-semibold tabular-nums', red ? 'text-crit' : 'text-white')}
        aria-label={breached ? 'SLA breached' : `SLA countdown, ${Math.floor(left / 60)} minutes ${left % 60} seconds left`}
      >
        {pad(Math.floor(left / 60))}:{pad(left % 60)}
      </span>
      {breached && <span className="text-[10px] font-semibold text-crit">BREACHED</span>}
    </div>
  )
}

/**
 * Zero-mouse workflow. [SPACE] or [⌘K]/[Ctrl+K] pauses every market still
 * cascading; [1]–[4] switch tabs. Never fires while typing in a field.
 *
 * Space is reserved for the panic key everywhere else, including when a button
 * has focus: otherwise a focused "Resume" button would turn the panic key into
 * a resume. Enter still presses a focused button. Returns a short confirmation
 * for the legend.
 */
function useHotkeys(selectTab: (tab: AssetTab) => void, pauseAll: (source: string) => Market[]) {
  const [note, setNote] = useState<{ text: string; at: number } | null>(null)

  useEffect(() => {
    const fire = (source: string) => {
      const paused = pauseAll(source)
      setNote({
        text: paused.length ? `→ paused ${paused.length} market${paused.length > 1 ? 's' : ''}` : '→ nothing to pause',
        at: Date.now(),
      })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]')

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!e.repeat) fire('[CMD+K]')
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault() // stops a focused button or tab being activated by Space
        if (!e.repeat) fire('[SPACE]')
        return
      }

      const index = ['1', '2', '3', '4'].indexOf(e.key)
      if (index >= 0 && index < ASSET_TABS.length) {
        e.preventDefault()
        selectTab(ASSET_TABS[index])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectTab, pauseAll])

  // The confirmation fades out of the legend after a few seconds
  useEffect(() => {
    if (!note) return
    const id = window.setTimeout(() => setNote(null), 3000)
    return () => window.clearTimeout(id)
  }, [note])

  return note
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="border border-white/15 px-1 font-mono text-[10px] text-gray-400">{children}</kbd>
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
  const { metrics, controls, isPaused, isHalted, logs, ledger, record, toggleControl, pauseAllCascading, sendBroadcast } =
    useIncidentSim()
  const { critical } = metrics
  const mitigated = MARKET_LIST.filter((m) => isPaused[m] || isHalted[m])
  const cascading = MARKET_LIST.filter((m) => !isPaused[m] && !isHalted[m])
  const [selectedAsset, setSelectedAsset] = useState<AssetTab>('OVERVIEW')
  const [ruling, setRuling] = useState<RulingKind | null>(null)
  const [slaMinutes, setSlaMinutes] = useState(DEFAULT_SLA_MIN)

  const hotkeyNote = useHotkeys(setSelectedAsset, pauseAllCascading)
  const laneState = Object.fromEntries(
    MARKET_LIST.map((m) => [m, isHalted[m] ? 'halted' : isPaused[m] ? 'paused' : 'live']),
  ) as Record<Market, LaneState>

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-2 p-2 md:p-3 lg:h-screen lg:min-h-[720px]">
        {/* Incident header */}
        <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 rounded-sm border border-white/10 bg-black px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-white text-black">
              <Coffee className="size-3" aria-hidden />
            </span>
            <h1 className="text-[13px] font-semibold text-white">
              MochaTrade Incident Commander <span className="font-mono font-medium whitespace-nowrap text-gray-400">// HIGH-CORTISOL</span>
            </h1>
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
            <SlaCountdown
              critical={critical}
              onApply={(m) => {
                setSlaMinutes(m)
                record('action', `SLA window reset to ${m} min`, 'commander')
              }}
            />
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

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:grid-rows-[minmax(0,1fr)]">
          <main className="relative flex min-w-0 flex-col gap-2 lg:overflow-y-auto [&>*]:shrink-0">
            <SignalNode metrics={metrics} isPaused={isPaused} isHalted={isHalted} />
            <AssetTabs selected={selectedAsset} onSelect={setSelectedAsset} metrics={metrics} laneState={laneState} />
            {/* Bird's-eye view: every market's controls plus the ruling checklist. Hidden
                rather than unmounted so the ruling answers survive a tab switch. */}
            <div
              id={tabPanelId('OVERVIEW')}
              role="tabpanel"
              aria-labelledby={tabLabelledBy('OVERVIEW')}
              hidden={selectedAsset !== 'OVERVIEW'}
              className="flex flex-col gap-2"
            >
              <LiveSignalsPanel metrics={metrics} />
              <ActionGrid
                metrics={metrics}
                controls={controls}
                isPaused={isPaused}
                isHalted={isHalted}
                onToggle={toggleControl}
                onBroadcast={sendBroadcast}
              />
              <CommsTriage
                metrics={metrics}
                controls={controls}
                incidentOpenedAt={INCIDENT_OPENED_AT}
                onRecord={(text) => record('action', text, 'commander')}
              />
              <DecisionMatrix
                onRuling={(text) => record('decision', text, 'commander')}
                onRulingChange={setRuling}
              />
              <IncidentLog
                entries={ledger}
                onAppend={(author, text) => record('note', text, author)}
                getReportInput={() => ({ metrics, controls, ruling, ledger, slaMinutes })}
                onReportSaved={(filename) => record('action', `Post-mortem PDF generated: ${filename}`, 'commander')}
              />
            </div>
            {/* The 3D canvas mounts only on an asset tab, so it costs nothing while hidden */}
            {selectedAsset !== 'OVERVIEW' && (
              <CascadePanel
                id={tabPanelId(selectedAsset)}
                labelledBy={tabLabelledBy(selectedAsset)}
                assetId={TAB_MARKET[selectedAsset]}
                metrics={metrics}
                controls={controls}
                state={laneState[TAB_MARKET[selectedAsset]]}
                onToggle={toggleControl}
              />
            )}
          </main>

          <aside className="min-h-0">
            <IncidentStream logs={logs} critical={critical} />
          </aside>
        </div>

        {/* Hotkey legend; hidden on touch-sized screens where there's no keyboard */}
        <footer className="hidden h-5 shrink-0 items-center justify-between font-mono text-[10px] text-gray-600 sm:flex">
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <Key>SPACE</Key>/<Key>⌘K</Key> PAUSE ALL CASCADING
            </span>
            <span className="flex items-center gap-1.5">
              <Key>1</Key>–<Key>4</Key> SWITCH ASSET
            </span>
            <span className="flex items-center gap-1.5">
              <Key>ENTER</Key> PRESS FOCUSED BUTTON
            </span>
          </span>
          <span aria-live="polite" className="text-[#06b6d4]">
            {hotkeyNote?.text}
          </span>
        </footer>
      </div>
    </MotionConfig>
  )
}
