// Karte „Morgenbericht“ auf der Übersicht (ersetzt seit 10.9.2026 die Karte
// „Datenfluss statt Zettelwirtschaft“). Server-Komponente; der Knopf
// „Jetzt aktualisieren“ ist ein kleiner Client-Teil.
import Link from '@/components/ui/Link'
import { Sunrise, CloudRain, Wind, Thermometer, Droplets } from 'lucide-react'
import { Card, Badge, Note } from '../_shared/ui'
import type { Morgenbericht } from '@/lib/morgenbericht/erstellen'
import type { Befund } from '@/lib/wetter/regeln'
import AktualisierenKnopf from './AktualisierenKnopf'

const TONE: Record<Befund['stufe'], 'err' | 'warn' | 'info'> = { hoch: 'err', mittel: 'warn', info: 'info' }
const LABEL: Record<Befund['stufe'], string> = { hoch: 'dringend', mittel: 'erledigen', info: 'hinweis' }
export const stufeTone = TONE
export const stufeLabel = LABEL

export const zeitText = (iso: string) => new Date(iso).toLocaleString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })
const uhr = (iso: string) => new Date(iso).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })
const num = (n: number | null | undefined, st = 1) => n === null || n === undefined ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: st })

export function BefundZeile({ b }: { b: Befund }) {
  const extern = b.href?.startsWith('http')
  const inner = (
    <>
      <span className="block text-[13px] font-semibold text-s112-text">{b.titel}</span>
      <span className="block text-[12px] text-s112-text-2">{b.detail}</span>
    </>
  )
  return (
    <li className="flex items-start gap-3 py-2 border-b border-s112-line last:border-0">
      <span className="pt-0.5 shrink-0"><Badge tone={TONE[b.stufe]}>{LABEL[b.stufe]}</Badge></span>
      <div className="min-w-0 flex-1">
        {b.href ? (extern ? <a href={b.href} target="_blank" rel="noopener" className="block hover:text-s112-blue-700">{inner}</a> : <Link href={b.href} className="block hover:text-s112-blue-700">{inner}</Link>) : inner}
      </div>
      <span className="font-mono text-[10.5px] text-s112-tertiary uppercase tracking-[.04em] shrink-0 pt-1 hidden sm:inline">{b.bereich}</span>
    </li>
  )
}

export function WetterStreifen({ w, kompakt = true }: { w: NonNullable<Morgenbericht['wetter']>; kompakt?: boolean }) {
  if (!w.erlaubt) return <Note className="mt-3">Wetter & Empfehlungen: {w.grund ?? 'nicht verfügbar'}.</Note>
  if (w.punkte === 0) return <Note className="mt-3">Wetter & Empfehlungen: keine Ried mit Koordinaten – unter Rieden die Lage setzen (Karte oder AMA-Import), dann kommen Regen, Prognose und Spritzfenster je Ried.{w.grund ? ` ${w.grund}` : ''}</Note>
  return (
    <div className={`mt-3 rounded-lg bg-s112-bg border border-s112-line px-3.5 py-3 ${kompakt ? '' : 'text-[13px]'}`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-[12.5px]">
        <div className="flex items-center gap-1.5 text-s112-text"><Thermometer size={14} strokeWidth={1.5} className="text-s112-tertiary shrink-0" /><span className="font-mono">{num(w.jetzt?.t2m)} °C</span><span className="text-s112-text-2">· {num(w.jetzt?.rh2m, 0)} % rF</span></div>
        <div className="flex items-center gap-1.5 text-s112-text"><Wind size={14} strokeWidth={1.5} className="text-s112-tertiary shrink-0" /><span className="font-mono">{num(w.jetzt?.windKmh, 0)} km/h</span>{w.prognose && <span className="text-s112-text-2">· Böen bis {num(w.prognose.boeMaxKmh, 0)}</span>}</div>
        <div className="flex items-center gap-1.5 text-s112-text"><CloudRain size={14} strokeWidth={1.5} className="text-s112-tertiary shrink-0" /><span className="font-mono">{num(w.regen24h)} mm</span><span className="text-s112-text-2">24 h · {num(w.regen7d)} mm 7 Tage</span></div>
        <div className="flex items-center gap-1.5 text-s112-text"><Droplets size={14} strokeWidth={1.5} className="text-s112-tertiary shrink-0" />{w.prognose ? <><span className="font-mono">{num(w.prognose.regen48h)} mm</span><span className="text-s112-text-2">48 h · {num(w.prognose.tmin, 0)}–{num(w.prognose.tmax, 0)} °C</span></> : <span className="text-s112-text-2">keine Prognose</span>}</div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 flex-wrap text-[12px]">
        <span className="text-s112-text">{w.spritzfenster.length ? <><span className="text-s112-text-2">Spritzfenster:</span> <b className="font-semibold">{w.spritzfenster.slice(0, 2).map(f => f.label).join(' · ')}</b></> : <span className="text-s112-text-2">Kein Spritzfenster in den nächsten 48 h (Wind oder Regen)</span>}</span>
        <span className="text-[11px] text-s112-tertiary">Wetter: GeoSphere Austria{w.stand ? ` · Stand ${uhr(w.stand)}` : ''}{w.punkte > 1 ? ` · ${w.punkte} Rasterpunkte` : ''}</span>
      </div>
    </div>
  )
}

export default function MorgenberichtKarte({ bericht, darfSchreiben, wetterHinweis }: { bericht: Morgenbericht | null; darfSchreiben: boolean; wetterHinweis?: string | null }) {
  const right = (
    <div className="flex items-center gap-2">
      {bericht && <span className="text-[11.5px] text-s112-tertiary font-mono hidden md:inline">{zeitText(bericht.erstelltAm)}</span>}
      {darfSchreiben && <AktualisierenKnopf klein />}
      <Link href="/dashboard/morgenbericht" className="text-[11.5px] text-s112-blue-700 hover:underline whitespace-nowrap">alle Details →</Link>
    </div>
  )
  if (!bericht) {
    return (
      <Card title={<span className="inline-flex items-center gap-1.5"><Sunrise size={16} strokeWidth={1.75} className="text-s112-tertiary" />Morgenbericht</span>} right={right}>
        <p className="text-[13px] text-s112-text-2">Noch kein Bericht. Der Morgenbericht prüft jeden Tag um 7 Uhr Fristen, Gärkontrollen, Zahlungsziele, Belege, Bestände, Wartefristen, Kontakte und Abo – und verknüpft das Wetter mit den Behandlungen je Ried.</p>
        {wetterHinweis && <Note className="mt-3">{wetterHinweis}</Note>}
        {darfSchreiben && <div className="mt-3"><AktualisierenKnopf /></div>}
      </Card>
    )
  }
  const top = bericht.befunde.slice(0, 6)
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sunrise size={16} strokeWidth={1.75} className="text-s112-tertiary" />Morgenbericht {new Date(bericht.datum + 'T00:00:00').toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })}</span>} right={right}>
      <p className="text-[13.5px] text-s112-text leading-relaxed">{bericht.zusammenfassung}</p>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {bericht.anzahl.hoch > 0 && <Badge tone="err">{bericht.anzahl.hoch} dringend</Badge>}
        {bericht.anzahl.mittel > 0 && <Badge tone="warn">{bericht.anzahl.mittel} zu erledigen</Badge>}
        {bericht.anzahl.info > 0 && <Badge tone="info">{bericht.anzahl.info} {bericht.anzahl.info === 1 ? 'Hinweis' : 'Hinweise'}</Badge>}
        {bericht.befunde.length === 0 && <Badge tone="ok">keine Befunde</Badge>}
        {bericht.kiModell && <span className="text-[11px] text-s112-tertiary">Zusammenfassung mit KI · Prüfungen deterministisch</span>}
      </div>
      {top.length > 0 && (
        <ul className="mt-3">
          {top.map(b => <BefundZeile key={b.key} b={b} />)}
        </ul>
      )}
      {bericht.befunde.length > top.length && <p className="mt-2 text-[12px] text-s112-tertiary">+ {bericht.befunde.length - top.length} weitere unter „alle Details“</p>}
      {bericht.wetter && <WetterStreifen w={bericht.wetter} />}
    </Card>
  )
}
