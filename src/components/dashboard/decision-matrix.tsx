import { useState } from 'react'
import { cn } from '@/lib/utils'

type Answer = 'yes' | 'no' | null
export type RulingKind = 'fault' | 'market' | 'unsure'

/*
 * Fault-vs-Market flowchart:
 *   01 Fault in the company / fundamental issue?  YES → System Fault
 *                                                 NO  → 02
 *   02 Short-term market overreaction?            YES → Market Move
 *                                                 NO  → Unsure
 */
export const RULINGS: Record<RulingKind, { category: string; ruling: string; basis: string; tone: string; border: string }> = {
  fault: {
    category: 'SYSTEM FAULT',
    ruling: 'RULING: Reverse/Compensate via Insurance Fund',
    basis: 'Losses caused by MochaTrade systems are made whole from the insurance fund.',
    tone: 'text-crit',
    border: 'border-crit',
  },
  market: {
    category: 'MARKET MOVE',
    ruling: 'RULING: Liquidation Stands',
    basis: 'Price moved on real market activity; the liquidations were valid under margin rules.',
    tone: 'text-white',
    border: 'border-white/40',
  },
  unsure: {
    category: 'UNSURE',
    ruling: 'RULING: 48-Hour Case-by-Case Review',
    basis: 'Not a system fault, but not a normal overreaction either. Each case is reviewed within 48 hours.',
    tone: 'text-warn',
    border: 'border-warn',
  },
}

function rulingFor(fault: Answer, overreaction: Answer): RulingKind | null {
  if (fault === 'yes') return 'fault'
  if (fault === 'no' && overreaction === 'yes') return 'market'
  if (fault === 'no' && overreaction === 'no') return 'unsure'
  return null
}

function YesNo({ value, onChange, question }: { value: Answer; onChange: (a: Answer) => void; question: string }) {
  return (
    <div role="group" aria-label={question} className="inline-flex">
      {(['yes', 'no'] as const).map((a, i) => {
        const on = value === a
        return (
          <button
            key={a}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : a)}
            className={cn(
              'h-6 w-12 border font-mono text-[11px] font-semibold transition-colors duration-75 active:translate-y-px',
              i === 0 ? 'rounded-l-sm' : '-ml-px rounded-r-sm',
              on
                ? 'relative z-10 border-white bg-white text-black hover:bg-gray-200'
                : 'border-white/20 bg-black text-gray-400 hover:bg-white/[0.06] hover:text-white',
            )}
          >
            {a.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

function Route({ children, tone }: { children: string; tone?: string }) {
  return <span className={cn('font-mono text-[11px]', tone ?? 'text-gray-500')}>{children}</span>
}

/** Ledger wording for each ruling as it is reached */
const RULING_LEDGER: Record<RulingKind, string> = {
  fault: 'Pricing fault confirmed (System Fault); compensation via Insurance Fund triggered',
  market: 'Ruling: Market Move; liquidations stand',
  unsure: 'Ruling: Unsure; 48-hour case-by-case review opened',
}

export function DecisionMatrix({
  onRuling,
  onRulingChange,
}: {
  /** A new ruling was reached: ledger wording */
  onRuling?: (text: string) => void
  /** The current ruling, including null when it is cleared or incomplete */
  onRulingChange?: (kind: RulingKind | null) => void
}) {
  const [fault, setFault] = useState<Answer>(null)
  const [overreaction, setOverreaction] = useState<Answer>(null)
  const kind = rulingFor(fault, overreaction)
  const ruling = kind ? RULINGS[kind] : null

  // Record a ruling when an answer produces a new one (not on clears or repeats)
  const report = (next: RulingKind | null) => {
    if (next && next !== kind) onRuling?.(RULING_LEDGER[next])
    if (next !== kind) onRulingChange?.(next)
  }

  const setFaultAnswer = (a: Answer) => {
    // Check 02 only applies on the NO branch; drop a stale answer when leaving it
    const nextOverreaction = a === 'no' ? overreaction : null
    setFault(a)
    setOverreaction(nextOverreaction)
    report(rulingFor(a, nextOverreaction))
  }

  const setOverreactionAnswer = (a: Answer) => {
    setOverreaction(a)
    report(rulingFor(fault, a))
  }

  const q1 = 'Is this a fault in the company/fundamental issue?'
  const q2 = 'Is it a short-term market overreaction?'

  return (
    <section aria-labelledby="ruling-heading" className="rounded-sm border border-white/10 bg-panel">
      <div className="flex h-7 items-center justify-between border-b border-white/10 px-2.5">
        <h2 id="ruling-heading" className="text-[12px] font-medium text-white">
          Fault-vs-market ruling
        </h2>
        <button
          type="button"
          onClick={() => setFaultAnswer(null)}
          disabled={fault === null}
          className="font-mono text-[10px] text-gray-500 hover:text-white disabled:opacity-40 disabled:hover:text-gray-500"
        >
          reset
        </button>
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="h-6 border-b border-white/10 text-[10px] text-gray-500">
            <th scope="col" className="w-8 pl-2.5 font-normal">
              #
            </th>
            <th scope="col" className="font-normal">
              Check
            </th>
            <th scope="col" className="w-28 font-normal">
              Answer
            </th>
            <th scope="col" className="hidden w-40 pr-2.5 font-normal sm:table-cell">
              Route
            </th>
          </tr>
        </thead>
        <tbody className="text-[12px]">
          <tr className="border-b border-white/[0.06]">
            <td className="py-1.5 pl-2.5 align-middle font-mono text-[11px] text-gray-500">01</td>
            <td className="py-1.5 pr-2 align-middle text-gray-300">{q1}</td>
            <td className="py-1.5 align-middle">
              <YesNo value={fault} onChange={setFaultAnswer} question={q1} />
            </td>
            <td className="hidden py-1.5 pr-2.5 align-middle sm:table-cell">
              {fault === 'yes' ? (
                <Route tone="text-crit">→ SYSTEM FAULT</Route>
              ) : fault === 'no' ? (
                <Route tone="text-white">→ check 02</Route>
              ) : (
                <Route>awaiting answer</Route>
              )}
            </td>
          </tr>
          {fault === 'no' && (
            <tr className="border-b border-white/[0.06]">
              <td className="py-1.5 pl-2.5 align-middle font-mono text-[11px] text-gray-500">02</td>
              <td className="py-1.5 pr-2 align-middle text-gray-300">{q2}</td>
              <td className="py-1.5 align-middle">
                <YesNo value={overreaction} onChange={setOverreactionAnswer} question={q2} />
              </td>
              <td className="hidden py-1.5 pr-2.5 align-middle sm:table-cell">
                {overreaction === 'yes' ? (
                  <Route tone="text-white">→ MARKET MOVE</Route>
                ) : overreaction === 'no' ? (
                  <Route tone="text-warn">→ UNSURE</Route>
                ) : (
                  <Route>awaiting answer</Route>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Final ruling */}
      <div className="p-2.5" aria-live="polite">
        {ruling ? (
          <div className={cn('rounded-sm border bg-black px-2.5 py-2', ruling.border)}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className={cn('font-mono text-[13px] font-semibold', ruling.tone)}>{ruling.ruling}</span>
              <span className={cn('font-mono text-[10px]', ruling.tone)}>{ruling.category}</span>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-gray-400">{ruling.basis}</p>
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-white/15 bg-black px-2.5 py-2 font-mono text-[12px] text-gray-500">
            RULING: pending, answer check {fault === 'no' ? '02' : '01'}
          </div>
        )}
      </div>
    </section>
  )
}
