import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { RulingKind } from './decision-matrix'
import {
  CLAIM_REASON_LABEL,
  Z_FLAG,
  summarizeClaims,
  type AccountFlag,
  type ClaimReason,
  type ScreenedClaim,
} from './fraud'
import { usd } from './use-incident-sim'

const PINK = 'text-[#f472b6]'
const PATTERN_LABEL: Record<AccountFlag['pattern'], string> = {
  'liquidation-hunting': 'LIQ HUNTING',
  spoofing: 'SPOOFING',
}
const REASON_SHORT: Record<ClaimReason, string> = {
  NO_LIQUIDATION: 'NO LIQ',
  DUPLICATE: 'DUPLICATE',
  INFLATED: 'INFLATED',
  NEW_ACCOUNT: 'NEW ACCT',
}

/**
 * Fraud detection: market-abuse flags on accounts that traded the crash, and
 * screening of every compensation claim before the Insurance Fund pays it.
 * See fraud.ts for the statistics and the rules.
 */
export function FraudPanel({
  flags,
  claims,
  frozen,
  ruling,
  onFreeze,
}: {
  flags: AccountFlag[]
  claims: ScreenedClaim[]
  frozen: Record<string, number>
  ruling: RulingKind | null
  onFreeze: (flag: AccountFlag) => void
}) {
  const summary = useMemo(() => summarizeClaims(claims), [claims])
  const recentHeld = useMemo(() => claims.filter((c) => c.reasons.length).slice(-5).reverse(), [claims])

  return (
    <section aria-labelledby="fraud-heading" className="rounded-sm border border-white/10 bg-panel">
      <div className="flex h-7 items-center justify-between gap-2 border-b border-white/10 px-2.5 font-mono text-[11px]">
        <h2 id="fraud-heading" className="font-sans text-[12px] font-medium text-white">
          Market abuse &amp; claims surveillance
        </h2>
        <span className="hidden truncate text-[10px] text-gray-500 sm:inline">
          robust z-score (median/MAD) · flag ≥ {Z_FLAG}
        </span>
        <span className={cn('shrink-0', flags.length ? PINK : 'text-gray-500')}>
          ■ {flags.length ? `${flags.length} FLAGGED` : 'SCANNING'}
        </span>
      </div>

      {/* Account flags */}
      <div className="border-b border-white/10">
        <div className="px-2.5 pt-2 pb-1 text-[11px] text-gray-500">Accounts flagged for market abuse</div>
        {flags.length === 0 ? (
          <p className="px-2.5 pb-2 font-mono text-[11px] text-gray-500">Sweeping 240 accounts that traded the crash window…</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {flags.map((f) => {
              const isFrozen = !!frozen[f.account]
              return (
                <li key={`${f.account}-${f.pattern}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 font-mono text-[11px]">
                  <span className={cn('w-[11ch] shrink-0 text-[10px] font-semibold', PINK)}>{PATTERN_LABEL[f.pattern]}</span>
                  <span className="w-[10ch] shrink-0 text-white">{f.account}</span>
                  <span className="w-[6ch] shrink-0 text-right text-white tabular-nums" title="Modified z-score">
                    z {f.score.toFixed(1)}
                  </span>
                  <span className="min-w-0 flex-1 basis-60 text-[10px] text-gray-400">{f.evidence}</span>
                  <button
                    type="button"
                    disabled={isFrozen}
                    onClick={() => onFreeze(f)}
                    className={cn(
                      'h-6 shrink-0 rounded-sm border px-2 text-[10px] font-semibold transition-colors',
                      isFrozen
                        ? 'border-[#06b6d4] text-[#06b6d4]'
                        : 'border-[#f472b6] text-[#f472b6] hover:bg-[#f472b6] hover:text-black',
                    )}
                  >
                    {isFrozen ? 'FROZEN' : 'FREEZE'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Claims screening */}
      <div className="p-2.5">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] text-gray-500">Compensation-claim screening</span>
          <span className={cn('font-mono text-[10px]', ruling === 'fault' ? 'text-warn' : 'text-gray-500')}>
            {ruling === 'fault' ? 'Insurance Fund payouts gated by screening' : 'pre-screening ahead of any compensation ruling'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px border border-white/10 bg-white/10 font-mono text-[11px] tabular-nums sm:grid-cols-4">
          <div className="bg-black px-2 py-1.5">
            <div className="text-[10px] text-gray-500">screened</div>
            <div className="text-white">{summary.screened}</div>
          </div>
          <div className="bg-black px-2 py-1.5">
            <div className="text-[10px] text-gray-500">held</div>
            <div className={summary.flagged ? PINK : 'text-white'}>
              {summary.flagged}
              {summary.screened > 0 && <span className="ml-1 text-gray-500">({Math.round((summary.flagged / summary.screened) * 100)}%)</span>}
            </div>
          </div>
          <div className="bg-black px-2 py-1.5">
            <div className="text-[10px] text-gray-500">claimed</div>
            <div className="text-white">{usd(summary.claimedUsd)}</div>
          </div>
          <div className="bg-black px-2 py-1.5">
            <div className="text-[10px] text-gray-500">payout held</div>
            <div className={summary.heldUsd ? PINK : 'text-white'}>{usd(summary.heldUsd)}</div>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 font-mono text-[10px]">
          {(Object.keys(summary.byReason) as ClaimReason[]).map((r) => (
            <span key={r} className="rounded-sm border border-white/15 px-1.5 py-0.5 text-gray-400" title={CLAIM_REASON_LABEL[r]}>
              {REASON_SHORT[r]} <span className="text-white">{summary.byReason[r]}</span>
            </span>
          ))}
        </div>
        {recentHeld.length > 0 && (
          <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-gray-400" aria-label="Most recent held claims">
            {recentHeld.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-2">
                <span className="text-gray-500">{c.id}</span>
                <span className="text-white">{c.account}</span>
                <span>{c.market}</span>
                <span className="text-white">{usd(c.claimedUsd)}</span>
                {c.recordedLossUsd !== null && <span>vs loss {usd(c.recordedLossUsd)}</span>}
                <span className={PINK}>{c.reasons.map((r) => REASON_SHORT[r]).join(' + ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
