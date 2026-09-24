import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LogLevel, LogLine } from './use-incident-sim'

const LEVELS: Record<LogLevel, { tag: string; text: string; bar: string }> = {
  liq: { tag: 'LIQ', text: 'text-warn', bar: 'bg-warn' },
  sev: { tag: 'SEV', text: 'text-crit', bar: 'bg-crit' },
  ops: { tag: 'OPS', text: 'text-ok', bar: 'bg-ok' },
  tkt: { tag: 'TKT', text: 'text-info', bar: 'bg-info' },
  sys: { tag: 'SYS', text: 'text-gray-500', bar: 'bg-gray-500' },
}

const stamp = (ts: number) => {
  const d = new Date(ts)
  return `${d.toLocaleTimeString('en-GB')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export function IncidentStream({ logs, critical }: { logs: LogLine[]; critical: boolean }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  // Follow the tail unless the reader has scrolled up to inspect something
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [logs, pinned])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <section
      aria-label="Incident stream"
      className="relative flex h-[480px] flex-col rounded-sm border border-white/10 bg-panel lg:h-full"
    >
      <header className="flex h-7 shrink-0 items-center justify-between border-b border-white/10 px-2.5 text-[11px]">
        <span className="font-medium text-gray-400">
          Incident stream <span className="ml-1 font-mono text-gray-500">tail -f INC-2417.log</span>
        </span>
        <span className={cn('flex items-center gap-1.5 font-mono text-[10px]', critical ? 'text-crit' : 'text-ok')}>
          <span className={cn('size-1.5', critical ? 'bg-crit' : 'bg-ok')} aria-hidden />
          LIVE {logs.length.toString().padStart(3, '0')}
        </span>
      </header>

      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 overflow-y-auto overscroll-contain py-1 font-mono text-[11px] leading-[1.45] [scrollbar-color:#333_transparent] [scrollbar-width:thin]"
      >
        {logs.map((line) => {
          const lvl = LEVELS[line.level]
          return (
            <motion.div
              key={line.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.12 }}
              className={cn(
                'relative grid grid-cols-[auto_auto_1fr] gap-x-2 border-b border-white/[0.04] px-2.5 py-[2px]',
                line.level === 'sev' && 'bg-crit-fill/20',
              )}
            >
              {/* Solid 2px trail marks new arrivals, then fades */}
              <motion.span
                aria-hidden
                className={cn('absolute inset-y-0 left-0 w-0.5', lvl.bar)}
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 1.6, ease: 'linear' }}
              />
              <span className="text-gray-500 tabular-nums">{stamp(line.ts)}</span>
              <span className={cn('font-semibold', lvl.text)}>{lvl.tag}</span>
              <span className={cn('break-words', line.level === 'liq' ? 'text-gray-400' : 'text-white')}>{line.text}</span>
            </motion.div>
          )
        })}
        <div className="px-2.5 pt-1 text-gray-500">
          risk@mocha:~$ <span className="inline-block h-3 w-[6px] translate-y-0.5 animate-pulse bg-white" />
        </div>
      </div>

      {!pinned && (
        <button
          type="button"
          onClick={() => setPinned(true)}
          className="absolute bottom-2 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-sm border border-white/20 bg-black px-2.5 text-[11px] text-white hover:bg-gray-900 active:bg-gray-800"
        >
          <ArrowDown className="size-3" aria-hidden />
          Jump to latest
        </button>
      )}
    </section>
  )
}
