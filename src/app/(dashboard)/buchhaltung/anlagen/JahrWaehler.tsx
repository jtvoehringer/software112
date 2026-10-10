// Jahreswahl per Link (Server-Seite liest ?jahr=)
import Link from '@/components/ui/Link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function JahrWaehler({ jahre, jahr, basis = '/buchhaltung/anlagen' }: { jahre: number[]; jahr: number; basis?: string }) {
  const vor = jahre.filter(j => j < jahr).pop()
  const nach = jahre.filter(j => j > jahr).shift()
  const cls = (aktiv: boolean) =>
    `w-8 h-8 inline-flex items-center justify-center rounded-md border border-s112-line-str bg-white text-s112-text-2 hover:bg-s112-bg hover:text-s112-blue-700 transition-colors ${aktiv ? '' : 'opacity-30 pointer-events-none'}`
  return (
    <div className="flex items-center gap-1 print:hidden">
      <Link href={vor ? `${basis}?jahr=${vor}` : '#'} aria-label="Vorjahr" title="Vorjahr" aria-disabled={!vor} className={cls(!!vor)}><ChevronLeft size={15} strokeWidth={2} /></Link>
      <span className="font-mono font-semibold text-s112-text text-[16px] w-14 text-center tabular-nums">{jahr}</span>
      <Link href={nach ? `${basis}?jahr=${nach}` : '#'} aria-label="Folgejahr" title="Folgejahr" aria-disabled={!nach} className={cls(!!nach)}><ChevronRight size={15} strokeWidth={2} /></Link>
    </div>
  )
}
