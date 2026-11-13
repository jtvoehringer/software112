import Link from '@/components/ui/Link'
import { Wine, ShoppingCart, Calendar, Wallet, FlaskConical, Grape, ArrowRightLeft, Sparkles } from 'lucide-react'
import { canWrite } from '@/lib/auth/roles'
import type { Ctx } from '../_shared/data'
import { seitenBereich } from '@/lib/navigation/seitenBereich'
import type { WidgetProps } from './typen'

// KAN-387: Schnellaktionen (Handy) und Schnellzugriff als eigene Widgets

/** Schnellaktionen nur am Handy (KAN-181): je nach Schreibrecht im Modul */
export function schnellaktionenFuer(ctx: Ctx) {
  return [
    { href: '/erntemeldung/erfassen',        icon: Grape,          label: 'Lese erfassen', modul: 'rieden' as const },
    { href: '/behandlungen/neu',             icon: FlaskConical,   label: 'Maßnahme',      modul: 'rieden' as const },
    { href: '/kellerbuch/umziehen?neu=1',    icon: ArrowRightLeft, label: 'Umziehen',      modul: 'kellerbuch' as const },
    { href: '/weinhandel/verkauf/neu',       icon: ShoppingCart,   label: 'Verkauf',       modul: 'warenwirtschaft' as const },
  ].filter(a => canWrite(ctx.role, a.modul))
    .filter(a => ctx.lesbar.includes(seitenBereich(a.href)))   // KAN-456: nur lesbare Bereiche
}

export function SchnellaktionenWidget({ ctx }: WidgetProps) {
  const schnellaktionen = schnellaktionenFuer(ctx)
  if (schnellaktionen.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-2">
      {schnellaktionen.map(a => (
        <Link key={a.href} href={a.href}
          className="bg-white border border-s112-line rounded-xl px-3 py-3 flex items-center gap-2 text-base font-medium text-s112-text">
          <a.icon size={20} strokeWidth={1.75} className="text-s112-blue-700 shrink-0" aria-hidden="true" />
          <span>{a.label}</span>
        </Link>
      ))}
    </div>
  )
}

// ── Schnellzugriff: „Produktion“ (KAN-119) nur mit Schreibrecht im Kellerbuch ──
// am Handy durch die Schnellaktionen ersetzt – nur wenn es welche gibt (Leser behalten den Schnellzugriff)
export function SchnellzugriffWidget({ ctx, mitSchnellaktionen }: WidgetProps) {
  const schnellzugriff = [
    { href: '/weinhandel/verkauf/neu',    icon: ShoppingCart, label: 'Neuer Verkauf' },
    { href: '/crm',                        icon: Calendar,     label: 'Aktivität' },
    { href: '/weinhandel/offene-posten',   icon: Wallet,       label: 'Offene Posten' },
    { href: '/erntemeldung',               icon: Wine,         label: 'Lese / Pressung' },
    { href: '/behandlungen/neu',           icon: FlaskConical, label: 'Maßnahme erfassen' },
    ...(canWrite(ctx.role, 'kellerbuch') ? [{ href: '/kellerbuch/produktion/neu', icon: Sparkles, label: 'Produktion' }] : []),
  ].filter(item => ctx.lesbar.includes(seitenBereich(item.href)))   // KAN-456: nur lesbare Bereiche
  if (schnellzugriff.length === 0) return null
  return (
    <div className={mitSchnellaktionen ? 'max-sm:hidden' : undefined}>
      <h2 className="text-xs font-semibold text-s112-muted uppercase tracking-wider mb-3">Schnellzugriff</h2>
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${schnellzugriff.length > 5 ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-3`}>
        {schnellzugriff.map(item => (
          <Link key={item.href} href={item.href}
            className="bg-white border border-s112-line rounded-xl p-4 flex items-center gap-3 hover:border-s112-teal hover:shadow-xs transition-all">
            <item.icon size={20} strokeWidth={1.75} className="text-s112-blue-700" />
            <span className="text-sm font-medium text-s112-text">{item.label}</span>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-s112-tertiary flex items-center gap-1"><Grape size={12} strokeWidth={1.5} /> Tipp: Strg K öffnet Seiten, Aktionen und die Suche von überall.</p>
    </div>
  )
}
