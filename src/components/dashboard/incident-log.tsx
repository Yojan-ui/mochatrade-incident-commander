import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { cn } from '@/lib/utils'
import { fileStamp, renderPostmortemPdf, summarizeIncident, type PostmortemInput } from './postmortem'
import { verifyLedger, type LedgerEntry, type LedgerKind } from './use-incident-sim'

const utc = (ts: number) => new Date(ts).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false })

// Critical actions and decisions in cyan, escalations in yellow, notes plain
const KIND: Record<LedgerKind, { tag: string; tone: string }> = {
  action: { tag: 'ACT', tone: 'text-[#06b6d4]' },
  decision: { tag: 'DEC', tone: 'text-[#06b6d4] font-semibold' },
  escalation: { tag: 'ESC', tone: 'text-[#eab308]' },
  note: { tag: 'NOTE', tone: 'text-gray-200' },
  system: { tag: 'SYS', tone: 'text-gray-500' },
}


function exportLedger(entries: LedgerEntry[]) {
  const body = entries
    .map((e) => `#${String(e.seq).padStart(4, '0')}  ${new Date(e.ts).toISOString()}  ${KIND[e.kind].tag.padEnd(4)}  ${e.text} [by ${e.actor}]  prev=${e.prevHash} hash=${e.hash}`)
    .join('\n')
  const url = URL.createObjectURL(new Blob([`INC-2417 decision ledger\n${body}\n`], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'INC-2417-ledger.log'
  a.click()
  URL.revokeObjectURL(url)
}

export function IncidentLog({
  entries,
  onAppend,
  getReportInput,
  onReportSaved,
}: {
  entries: LedgerEntry[]
  onAppend: (author: string, text: string) => void
  /** Current ruling, metrics, controls and ledger for the report */
  getReportInput: () => PostmortemInput
  /** Called with the filename once the PDF has been saved */
  onReportSaved: (filename: string) => void
}) {
  const [report, setReport] = useState<{ state: 'idle' | 'building' | 'saved' | 'failed'; filename?: string }>({
    state: 'idle',
  })

  // Builds the post-mortem PDF. jsPDF (~300 KB) is imported on first use so it
  // never weighs down the dashboard's initial load.
  const generatePostmortem = async () => {
    setReport({ state: 'building' })
    try {
      const { jsPDF } = await import('jspdf')
      const input = { ...getReportInput(), generatedAt: Date.now() }
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      doc.setProperties({
        title: 'MochaTrade SEV-1 Incident Post-Mortem: INC-2417',
        subject: 'Incident post-mortem and immutable decision record',
        author: 'MochaTrade Incident Commander',
        creator: 'HIGH-CORTISOL',
      })
      renderPostmortemPdf(doc, summarizeIncident(input))
      const filename = `mochatrade-incident-report-${fileStamp(input.generatedAt)}.pdf`
      doc.save(filename)
      setReport({ state: 'saved', filename })
      onReportSaved(filename)
    } catch {
      setReport({ state: 'failed' })
    }
  }
  const scroller = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [author, setAuthor] = useState('IC')
  const [note, setNote] = useState('')
  const intact = useMemo(() => verifyLedger(entries), [entries])
  const head = entries[entries.length - 1]

  // Follow new entries unless someone scrolled up to read history
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [entries, pinned])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 16)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!note.trim()) return
    onAppend(author, note)
    setNote('')
    setPinned(true)
  }

  const input =
    'h-7 border border-white/20 bg-black px-2 font-mono text-[11px] text-white placeholder:text-gray-600 outline-none focus:border-[#22c55e] focus-visible:outline-none'

  return (
    <section aria-labelledby="ledger-heading" className="border border-white/10 bg-black">
      <div className="flex h-7 items-center justify-between gap-2 border-b border-white/10 px-2.5 font-mono text-[10px]">
        <h2 id="ledger-heading" className="font-sans text-[12px] font-medium text-white">
          Incident log
        </h2>
        <span className="flex items-center gap-3">
          <span className={intact ? 'text-[#22c55e]' : 'text-crit'} title="Every entry's hash is recomputed and linked to the one before it">
            {intact ? 'CHAIN OK' : 'CHAIN BROKEN'} <span className="text-gray-500">{entries.length} entries, head {head?.hash}</span>
          </span>
          <button
            type="button"
            onClick={() => exportLedger(entries)}
            className="h-5 border border-white/20 px-1.5 text-gray-400 hover:border-white/50 hover:text-white active:translate-y-px"
          >
            EXPORT .log
          </button>
        </span>
      </div>

      <div
        ref={scroller}
        role="log"
        aria-label="Decision ledger"
        aria-live="polite"
        className="h-56 overflow-y-auto overscroll-contain py-1 font-mono text-[11px] leading-[1.5] [scrollbar-color:#333_transparent] [scrollbar-width:thin]"
      >
        {entries.map((e) => (
          <div key={e.seq} className="grid grid-cols-[auto_auto_1fr] gap-x-2 px-2.5 hover:bg-white/[0.03]">
            <span className="text-gray-600 tabular-nums">{String(e.seq).padStart(4, '0')}</span>
            <span className="text-gray-500 tabular-nums">{utc(e.ts)} UTC</span>
            <span className={cn('min-w-0 break-words', KIND[e.kind].tone)}>
              <span className="mr-1.5 text-[10px] opacity-70">{KIND[e.kind].tag}</span>- {e.text}{' '}
              <span className="text-gray-500">[by {e.actor}]</span>
              <span className="ml-2 hidden text-[10px] text-gray-700 lg:inline">{e.hash}</span>
            </span>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-1.5 border-t border-white/10 px-2.5 py-1.5">
        <label className="sr-only" htmlFor="ledger-author">
          Author
        </label>
        <input
          id="ledger-author"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          maxLength={24}
          placeholder="author"
          className={cn(input, 'w-24 text-gray-300')}
        />
        <label className="sr-only" htmlFor="ledger-note">
          Decision note
        </label>
        <input
          id="ledger-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          placeholder="type a decision note, Enter to append"
          className={cn(input, 'min-w-0 flex-1')}
        />
        <button
          type="submit"
          disabled={!note.trim()}
          className="h-7 border border-white bg-white px-3 font-mono text-[11px] font-semibold text-black hover:bg-gray-200 active:translate-y-px disabled:border-white/20 disabled:bg-black disabled:text-gray-600"
        >
          APPEND
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-2.5 py-1.5">
        <span className="min-w-0 font-mono text-[10px] text-gray-500">
          {report.state === 'saved' ? (
            <>
              saved <span className="text-[#22c55e]">{report.filename}</span>
            </>
          ) : report.state === 'building' ? (
            <span className="text-[#06b6d4]">building PDF…</span>
          ) : report.state === 'failed' ? (
            <span className="text-crit">PDF export failed; try again</span>
          ) : (
            'PDF: ruling, total liquidation volume, time to resolution and the full ledger'
          )}
        </span>
        <button
          type="button"
          onClick={generatePostmortem}
          disabled={report.state === 'building'}
          className="h-7 border border-[#06b6d4] bg-black px-3 font-mono text-[11px] font-semibold tracking-wide text-[#06b6d4] hover:bg-[#06b6d4]/10 active:translate-y-px active:bg-[#06b6d4]/20"
        >
          GENERATE POST-MORTEM
        </button>
      </div>
    </section>
  )
}
