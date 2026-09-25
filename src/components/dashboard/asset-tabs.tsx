import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { CASCADE_LANES, collapseDepth, type LaneState } from './cascade-dynamics'
import type { Market, Metrics } from './use-incident-sim'

export type AssetTab = 'OVERVIEW' | 'BTC' | 'ETH' | 'SOL'
export const ASSET_TABS: readonly AssetTab[] = ['OVERVIEW', 'BTC', 'ETH', 'SOL']
export const TAB_MARKET: Record<Exclude<AssetTab, 'OVERVIEW'>, Market> = {
  BTC: 'BTC-PERP',
  ETH: 'ETH-PERP',
  SOL: 'SOL-PERP',
}

export const tabPanelId = (tab: AssetTab) => `asset-panel-${tab.toLowerCase()}`
const tabId = (tab: AssetTab) => `asset-tab-${tab.toLowerCase()}`

/** Each tab carries its asset's live state, so the bar itself is a status line */
function tabStatus(tab: AssetTab, metrics: Metrics, laneState: Record<Market, LaneState>) {
  if (tab === 'OVERVIEW') {
    const breakers = CASCADE_LANES.filter((m) => laneState[m] !== 'live').length
    return { text: breakers ? `${breakers} BRK` : `${CASCADE_LANES.length} MKT`, lamp: breakers ? 'bg-[#06b6d4]' : 'bg-gray-600' }
  }
  const m = TAB_MARKET[tab]
  if (laneState[m] !== 'live') return { text: 'BRK', lamp: 'bg-[#06b6d4]' }
  // The market's live stress (the 3D view shows the historical replay); the lamp
  // uses the same collapse thresholds as before
  const stress = metrics.stressByMarket[m]
  const depth = collapseDepth(stress, laneState[m])
  return {
    text: `${stress.toFixed(1)}×`,
    lamp: depth >= 0.5 ? 'bg-[#ef4444]' : depth >= 0.2 ? 'bg-[#eab308]' : 'bg-[#22c55e]',
  }
}

export function AssetTabs({
  selected,
  onSelect,
  metrics,
  laneState,
}: {
  selected: AssetTab
  onSelect: (tab: AssetTab) => void
  metrics: Metrics
  laneState: Record<Market, LaneState>
}) {
  const refs = useRef(new Map<AssetTab, HTMLButtonElement>())

  // Standard tablist keyboard model: arrows move and select, Home/End jump
  const onKeyDown = (e: KeyboardEvent) => {
    const i = ASSET_TABS.indexOf(selected)
    const next =
      e.key === 'ArrowRight' ? ASSET_TABS[(i + 1) % ASSET_TABS.length]
      : e.key === 'ArrowLeft' ? ASSET_TABS[(i - 1 + ASSET_TABS.length) % ASSET_TABS.length]
      : e.key === 'Home' ? ASSET_TABS[0]
      : e.key === 'End' ? ASSET_TABS[ASSET_TABS.length - 1]
      : null
    if (!next) return
    e.preventDefault()
    onSelect(next)
    refs.current.get(next)?.focus()
  }

  return (
    <div role="tablist" aria-label="Asset view" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto">
      {ASSET_TABS.map((tab) => {
        const active = tab === selected
        const status = tabStatus(tab, metrics, laneState)
        return (
          <button
            key={tab}
            ref={(el) => {
              if (el) refs.current.set(tab, el)
              else refs.current.delete(tab)
            }}
            id={tabId(tab)}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={tabPanelId(tab)}
            aria-keyshortcuts={String(ASSET_TABS.indexOf(tab) + 1)}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-sm border px-2 font-mono text-[12px] font-semibold tracking-wide sm:gap-2 sm:px-3',
              'transition-colors duration-75 active:translate-y-px',
              active
                ? 'border-[#22c55e] bg-black text-[#22c55e]'
                : 'border-white/10 bg-panel text-gray-500 hover:border-white/25 hover:text-gray-300',
            )}
          >
            <span>
              {tab}
              {tab !== 'OVERVIEW' && <span className="hidden sm:inline">-PERP</span>}
            </span>
            <span className="flex items-center gap-1 text-[10px] font-medium text-gray-500 tabular-nums">
              <span className={cn('size-1.5', status.lamp)} aria-hidden />
              <span className={tab === 'OVERVIEW' ? 'hidden sm:inline' : undefined}>{status.text}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function tabLabelledBy(tab: AssetTab) {
  return tabId(tab)
}
