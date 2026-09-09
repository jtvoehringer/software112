// ── Gemeinsame Bausteine der fünf Dashboard-Sichten (Dashboard-Relaunch) ─────
// Server-tauglich (keine Hooks). Optik nach dem Dashboard-PoC im
// s112-Designsystem: flache weiße Karten mit 1-px-Rand, Zahlen in Mono,
// Status-Badges gedämpft, Icons nur in Kachel-Labels.

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// CD-Manual (04 Typografie): Zahlen mit Tausenderpunkt und Dezimalkomma
// („€ 48.320,00 · 1.284 hl“), Beträge immer mit zwei Nachkommastellen.
// 'de-DE' statt 'de-AT', weil die Browser-/Node-Locale de-AT ein Leerzeichen
// als Tausendertrennung setzt („10 583“); das €-Zeichen steht wie in Österreich üblich vorne.
export function fmtNum(v: number, digits = 0) {
  return v.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
export function fmtEur(v: number, digits = 2) {
  return `€ ${fmtNum(v, digits)}`
}
export function fmtDate(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  if (!d) return '–'
  const x = typeof d === 'string' ? new Date(d) : d
  return Number.isNaN(x.getTime()) ? '–' : x.toLocaleDateString('de-AT', opts)
}
export function tageBis(d: string | Date) {
  const x = typeof d === 'string' ? new Date(d) : d
  const heute = new Date(); heute.setHours(0, 0, 0, 0)
  return Math.round((x.getTime() - heute.getTime()) / 86400000)
}

/** Seitenkopf einer Dashboard-Sicht */
export function DashHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="font-display text-2xl font-semibold text-s112-text tracking-[-.01em]">{title}</h1>
        {sub && <p className="text-s112-text-2 text-[13.5px] mt-1 max-w-[72ch]">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Card({ children, className = '', title, right, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; right?: ReactNode; pad?: boolean }) {
  return (
    <div className={`bg-white border border-s112-line rounded-xl ${pad ? 'p-[18px]' : ''} ${className}`}>
      {(title || right) && (
        <div className={`flex items-center justify-between gap-3 mb-3 ${pad ? '' : 'px-[18px] pt-4'}`}>
          {title && <h2 className="font-display font-semibold text-[14.5px] text-s112-text">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

export function Tile({ label, value, sub, icon: Icon, href, tone }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; href?: string; tone?: 'ok' | 'warn' | 'err'
}) {
  const subCls = tone === 'err' ? 'text-s112-err-fg font-medium' : tone === 'warn' ? 'text-s112-warn-fg font-medium' : tone === 'ok' ? 'text-s112-ok-fg font-medium' : 'text-s112-tertiary'
  const inner = (
    <>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={18} strokeWidth={1.5} className="text-s112-tertiary" />}
        <p className="text-[11.5px] font-semibold text-s112-text-2 tracking-[.02em]">{label}</p>
      </div>
      <p className="font-mono text-[24px] leading-[1.15] text-s112-text tabular-nums">{value}</p>
      {sub && <p className={`text-[11.5px] ${subCls}`}>{sub}</p>}
    </>
  )
  const cls = 'bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2'
  return href
    ? <Link href={href} className={`${cls} hover:shadow-sm hover:border-s112-blue-100 transition-all`}>{inner}</Link>
    : <div className={cls}>{inner}</div>
}

export type BadgeTone = 'ok' | 'warn' | 'err' | 'info' | 'gray'
export function Badge({ tone = 'gray', children }: { tone?: BadgeTone; children: ReactNode }) {
  const map: Record<BadgeTone, string> = {
    ok:   'bg-s112-ok-bg text-s112-ok-fg',
    warn: 'bg-s112-warn-bg text-s112-warn-fg',
    err:  'bg-s112-err-bg text-s112-err-fg',
    info: 'bg-s112-blue-50 text-s112-blue-700',
    gray: 'bg-[#F2F3F5] text-s112-text-1',
  }
  return <span className={`inline-flex items-center gap-1 font-mono text-[10.5px] font-semibold tracking-[.03em] uppercase rounded px-2 py-0.5 whitespace-nowrap ${map[tone]}`}>{children}</span>
}

export function Note({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-s112-blue-50 border border-s112-blue-100 rounded-lg px-4 py-3 text-[12.5px] text-s112-blue-700 ${className}`}>{children}</div>
}

export function Empty({ children, action }: { children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="py-6 text-center">
      <p className="text-[13px] text-s112-text-2">{children}</p>
      {action && <Link href={action.href} className="inline-block mt-2 text-[12.5px] text-s112-blue-700 hover:underline">{action.label} →</Link>}
    </div>
  )
}

/** Balkenreihe mit direkten Werten (HTML, keine Chart-Lib) */
// Töne lt. CD-Manual: 1 = Blau 700 (Hauptreihe), 2 = Blau 300 (Vergleich/Vorjahr),
// 'grey' = Markengrau (zweite Datenreihe ohne Wertung), 'warn' = Signalfarbe Achtung
// (nur für Zustände, nicht als Gestaltungsmittel).
export function BarRow({ label, value, max, text, tone = 1, labelWidth = 92 }: { label: string; value: number; max: number; text: string; tone?: 1 | 2 | 'grey' | 'warn'; labelWidth?: number }) {
  const pct = max > 0 ? Math.max(1, Math.round(value / max * 100)) : 0
  const color = tone === 'warn' ? 'bg-s112-warn' : tone === 'grey' ? 'bg-s112-grey' : tone === 2 ? 'bg-s112-blue-300' : 'bg-s112-blue-700'
  return (
    <div className="grid items-center gap-2.5 py-[3px]" style={{ gridTemplateColumns: `${labelWidth}px 1fr 84px` }} title={`${label}: ${text}`}>
      <span className="text-[12px] text-s112-text-2 truncate">{label}</span>
      <div><div className={`h-[14px] rounded-r ${color}`} style={{ width: `${pct}%`, minWidth: 2 }} /></div>
      <span className="font-mono text-[11.5px] font-semibold text-s112-text text-right tabular-nums">{text}</span>
    </div>
  )
}

/** Tabellen-Kopfzeile im Dashboard-Stil */
export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={`font-mono text-[10.5px] font-semibold tracking-[.06em] uppercase text-s112-tertiary px-2.5 py-2 border-b border-s112-line-str ${right ? 'text-right' : 'text-left'}`}>{children}</th>
}
export function Td({ children, right, mono, className = '' }: { children?: ReactNode; right?: boolean; mono?: boolean; className?: string }) {
  return <td className={`px-2.5 py-2.5 border-b border-s112-line align-middle text-[13px] ${right ? 'text-right' : ''} ${mono ? 'font-mono text-[12.5px] tabular-nums whitespace-nowrap' : ''} ${className}`}>{children}</td>
}
