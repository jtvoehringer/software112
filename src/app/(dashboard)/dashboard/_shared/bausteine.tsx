// ── Bausteine, die eine Sicht und ein Widget der Übersicht gemeinsam nutzen (KAN-389, 31.10.2026) ──────────────
// Sicht und Widget rendern dieselbe Komponente aus denselben Ladefunktionen (_shared/data.ts, lib/verkauf/umsatz.ts) –
// so zeigen beide dieselben Zahlen. Server-tauglich (keine Hooks).

import Link from '@/components/ui/Link'
import { Warehouse, FlaskConical, Droplets } from 'lucide-react'
import { Card, Tile, Badge, Empty, Th, Td, fmtNum, fmtEur, fmtDate, type BadgeTone } from './ui'
import { FRIST_STATUS, type Charge, type Frist } from './types'
import type { ladeKeller, ladeWeingarten } from './data'
import { umsatzJeMonat, UMSATZ_BESCHRIFTUNG, type OffenerPosten, type UmsatzKunde } from '@/lib/verkauf/umsatz'
import { faelligText } from '@/lib/verkauf/faelligkeit'
import { lokalerTag } from '@/lib/datum/wien'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
type Keller = Awaited<ReturnType<typeof ladeKeller>>
type Wartefrist = Awaited<ReturnType<typeof ladeWeingarten>>['wartefristen'][number]

// ── Verkauf ──────────────────────────────────────────────────────────────────

/** 12-Monats-Fenster der Umsatzreihe bis zum laufenden Monat (heute = Wiener Wandzeit, KAN-158) */
export function umsatzFenster(heute: Date) {
  return {
    von: lokalerTag(new Date(heute.getFullYear(), heute.getMonth() - 11, 1)),
    bis: lokalerTag(new Date(heute.getFullYear(), heute.getMonth() + 1, 0)),
    monate: Array.from({ length: 12 }, (_, i) => lokalerTag(new Date(heute.getFullYear(), heute.getMonth() - 11 + i, 1)).slice(0, 7)),
  }
}

export type UmsatzPunkt = { label: string; value: number }

/** Umsatzreihe: 12 Monate, älteste zuerst, netto nach Rechnungsdatum (KAN-346) */
export function umsatzReihe(rechnungen: readonly R[], monate: readonly string[]): UmsatzPunkt[] {
  const jeMonat = umsatzJeMonat(rechnungen, monate)
  return monate.map(m => {
    const [y, mo] = m.split('-').map(Number)
    return { label: new Date(y, mo - 1, 1).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', month: 'short' }), value: jeMonat.get(m)?.umsatz ?? 0 }
  })
}

/** Balken der letzten 12 Monate (Sicht Verkauf, Widget „Umsatz-Trend“) */
export function UmsatzTrendKarte({ reihe, className = '' }: { reihe: UmsatzPunkt[]; className?: string }) {
  const max = Math.max(1, ...reihe.map(s => s.value))
  return (
    <div className={`bg-white border border-s112-line rounded-xl p-[18px] ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-[14px] text-s112-text">{UMSATZ_BESCHRIFTUNG}</h2>
        <span className="text-[11.5px] text-s112-tertiary">letzte 12 Monate</span>
      </div>
      <div className="h-[120px] flex items-end gap-2.5">
        {reihe.map((s, i) => {
          const color = i === 11 ? 'bg-s112-teal' : i >= 9 ? 'bg-s112-blue-300' : 'bg-s112-blue-100'
          const heightPct = Math.max(3, Math.round((s.value / max) * 100))
          return (
            <div key={i} className={`flex-1 h-full flex flex-col justify-end ${i < 6 ? 'hidden sm:flex' : ''}`} title={`${s.label}: ${fmtEur(s.value)}`}>
              <div className={`w-full rounded-t-[5px] ${color}`} style={{ height: `${heightPct}%` }} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between mt-2">
        {reihe.map((s, i) => (
          <span key={i} className={`flex-1 text-center font-mono text-[10.5px] text-s112-tertiary ${i < 6 ? 'hidden sm:block' : ''}`}>{s.label}</span>
        ))}
      </div>
    </div>
  )
}

/** Überfällige Rechnungen (KAN-374): ab Fälligkeit nach Kundenziel, längster Verzug zuerst */
export function ueberfaelligeRechnungen(liste: readonly OffenerPosten[], anzahl = 5): OffenerPosten[] {
  return liste
    .filter(p => p.ueberfaellig)
    .sort((a, b) => b.verzugTage - a.verzugTage)
    .slice(0, anzahl)
}

export function UeberfaelligeRechnungenKarte({ belege, className = '' }: { belege: OffenerPosten[]; className?: string }) {
  return (
    <div className={`bg-white border border-s112-line rounded-xl overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-[18px] pt-4 pb-2">
        <h2 className="font-display font-semibold text-[14px] text-s112-text">Überfällige Rechnungen</h2>
        <Link href="/weinhandel/offene-posten" className="text-[11.5px] text-s112-blue-700 hover:underline">alle →</Link>
      </div>
      {belege.length === 0 ? (
        <p className="text-sm text-s112-text-2 px-[18px] pb-5">Keine überfälligen Rechnungen.</p>
      ) : (
        <div>
          <div className="grid grid-cols-[1.6fr_.9fr_.9fr] sm:grid-cols-[1.6fr_1fr_.9fr_.9fr_40px] px-[18px] py-[11px] bg-s112-bg border-b border-s112-line text-[11px] font-semibold uppercase tracking-[.08em] text-s112-tertiary">
            <span>Kunde</span>
            <span className="max-sm:hidden">Rechnung</span>
            <span>Verzug</span>
            <span className="text-right">Offen</span>
            <span className="max-sm:hidden" />
          </div>
          {belege.map(v => (
            <Link key={v.id} href={`/weinhandel/rechnungen/${v.id}`}
              className="contents">
              <div className="col-span-5 grid grid-cols-[1.6fr_.9fr_.9fr] sm:grid-cols-[1.6fr_1fr_.9fr_.9fr_40px] items-center px-[18px] py-[13px] border-t border-[#F2F3F5] text-[13px] hover:bg-s112-bg transition-colors">
                <span className="text-s112-text truncate">{v.kunde}</span>
                <span className="max-sm:hidden font-mono text-s112-text-2">{v.rechnungsnummer ?? '–'}</span>
                <span>
                  <span title={faelligText(v)} className="inline-block px-2.5 py-1 rounded-full text-[11.5px] font-semibold bg-s112-err-bg text-s112-err-fg">
                    {v.verzugTage} Tage
                  </span>
                </span>
                <span className="font-mono text-right text-s112-text tabular-nums">
                  {fmtEur(v.offen)}
                </span>
                <span className="max-sm:hidden text-right text-s112-tertiary">⋯</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/** Top-Kunden nach Nettoumsatz der letzten 12 Monate (umsatzJeKunde, dieselben Rechnungen wie der Umsatz-Trend) */
export function TopKundenKarte({ kunden }: { kunden: UmsatzKunde[] }) {
  return (
    <Card title="Top-Kunden" right={<span className="text-[11.5px] text-s112-tertiary">netto · letzte 12 Monate</span>}>
      {kunden.length === 0 ? (
        <Empty>Keine Rechnungen in den letzten 12 Monaten.</Empty>
      ) : (
        <table className="w-full">
          <thead><tr><Th>Kunde</Th><Th right>Rechnungen</Th><Th right>Umsatz</Th></tr></thead>
          <tbody>
            {kunden.map(k => (
              <tr key={k.schluessel} className="hover:bg-s112-bg">
                <Td className="font-semibold">{k.href ? <Link href={k.href} className="text-s112-text hover:text-s112-blue-700">{k.kunde}</Link> : k.kunde}</Td>
                <Td right mono>{fmtNum(k.anzahl)}</Td>
                <Td right mono>{fmtEur(k.umsatz)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

// ── Kellerbuch ───────────────────────────────────────────────────────────────

export function GebindeBelegtKachel({ keller }: { keller: Keller }) {
  return (
    <Tile label="Gebinde belegt" icon={Warehouse} href="/kellerbuch"
      value={`${keller.behaelterBelegt} / ${keller.behaelterGesamt}`}
      sub={`Kapazität ${fmtNum(keller.kapazitaet)} L · ${fmtNum(keller.gesamtLiter)} L im Keller`} />
  )
}

export function AktiveGaerungenKachel({ keller, messintervallTage, href }: { keller: Keller; messintervallTage: number; href?: string }) {
  return (
    <Tile label="Aktive Gärungen" icon={FlaskConical} href={href}
      value={fmtNum(keller.gaerungen)}
      sub={keller.messungFaellig > 0 ? `${keller.messungFaellig} Messung${keller.messungFaellig === 1 ? '' : 'en'} fällig (≥ ${messintervallTage} Tage)` : keller.gaerungen > 0 ? 'Alle Messungen aktuell' : 'Keine Gärung aktiv'}
      tone={keller.messungFaellig > 0 ? 'warn' : keller.gaerungen > 0 ? 'ok' : undefined} />
  )
}

export function FuellfertigKachel({ keller, href }: { keller: Keller; href?: string }) {
  return (
    <Tile label="Füllfertig" icon={Droplets} href={href}
      value={fmtNum(keller.fuellfertig)}
      sub={keller.fuellfertig > 0 ? `${fmtNum(keller.chargen.filter(c => c.status === 'abfuellung').reduce((s, c) => s + c.menge_liter, 0))} L bereit zur Abfüllung` : 'Keine Charge in Abfüllung'} />
  )
}

/** Chargen in Gärung mit fälliger Messung (dieselbe Regel wie die Kachel „Aktive Gärungen“) – nie gemessen zuerst,
 *  dann die längste Zeit seit der letzten Messung */
export function gaerkontrolleFaellig(chargen: readonly Charge[]): Charge[] {
  return chargen.filter(c => c.messungFaellig)
    .sort((a, b) => (b.tageSeitMessung ?? Infinity) - (a.tageSeitMessung ?? Infinity) || a.name.localeCompare(b.name, 'de'))
}

export function GaerkontrolleKarte({ keller, messintervallTage }: { keller: Keller; messintervallTage: number }) {
  const faellig = gaerkontrolleFaellig(keller.chargen)
  return (
    <Card title="Gärkontrolle fällig" right={<Link href="/dashboard/kellerbuch" className="text-[11.5px] text-s112-blue-700 hover:underline">Chargen-Pipeline →</Link>}>
      {faellig.length === 0 ? (
        <Empty>{keller.gaerungen > 0 ? 'Alle Messungen aktuell.' : 'Keine Gärung aktiv.'}</Empty>
      ) : (
        <>
          <table className="w-full">
            <thead><tr><Th>Charge</Th><Th>Gebinde</Th><Th right>Letzte Messung</Th></tr></thead>
            <tbody>
              {faellig.slice(0, 8).map(c => (
                <tr key={c.id} className="hover:bg-s112-bg">
                  <Td className="font-semibold"><Link href={`/kellerbuch/weinausbau/${c.id}`} className="text-s112-text hover:text-s112-blue-700">{c.name}</Link></Td>
                  <Td>{c.behaelter ?? '–'}</Td>
                  <Td right><Badge tone="warn">{c.tageSeitMessung === null ? 'noch nie' : `vor ${c.tageSeitMessung} Tag${c.tageSeitMessung === 1 ? '' : 'en'}`}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11.5px] text-s112-tertiary mt-2">{faellig.length > 8 ? `… und ${faellig.length - 8} weitere · ` : ''}Messung fällig ab {messintervallTage} Tagen ohne Analyse</p>
        </>
      )}
    </Card>
  )
}

// ── Weingarten ───────────────────────────────────────────────────────────────

/** Laufende Wartefristen (frühester Lesetermin je Behandlung), nächste zuerst */
export function WartefristenKarte({ wartefristen, anzahl = 6 }: { wartefristen: Wartefrist[]; anzahl?: number }) {
  return (
    <Card title="Laufende Wartefristen" right={<Link href="/behandlungen" className="text-[11.5px] text-s112-blue-700 hover:underline">Maßnahmen →</Link>}>
      {wartefristen.length === 0 ? (
        <Empty>Keine laufende Wartefrist.</Empty>
      ) : (
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr><Th>Ried</Th><Th>Behandlung</Th><Th right>Lese frei ab</Th></tr></thead>
          <tbody>
            {wartefristen.slice(0, anzahl).map(w => (
              <tr key={w.id}>
                <Td className="font-semibold">{w.ried}</Td>
                <Td mono>{fmtDate(w.datum)}</Td>
                <Td right><Badge tone="warn">{fmtDate(w.freiAb)}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  )
}

// ── Fristen ──────────────────────────────────────────────────────────────────

/** Die nächsten offenen Fristen in der Reihenfolge der Ampel (ladeFristen: überfällig, fällig, offen, laufend) */
export function naechsteFristen(fristen: readonly Frist[], anzahl = 6): Frist[] {
  return fristen.filter(f => f.status !== 'erledigt').slice(0, anzahl)
}

export function MeldefristenKarte({ fristen }: { fristen: Frist[] }) {
  const naechste = naechsteFristen(fristen)
  return (
    <Card title="Nächste Meldefristen" right={<Link href="/dashboard/fristen" className="text-[11.5px] text-s112-blue-700 hover:underline">alle Fristen →</Link>}>
      {naechste.length === 0 ? (
        <Empty>Keine offenen Fristen.</Empty>
      ) : (
        <table className="w-full">
          <tbody>
            {naechste.map(f => {
              const s: { label: string; tone: BadgeTone } = FRIST_STATUS[f.status]
              return (
                <tr key={f.key} className="border-b border-s112-line last:border-0 hover:bg-s112-bg">
                  <td className="py-2.5 pr-2">
                    <Link href={f.href ?? '/dashboard/fristen'} className="block">
                      <span className="block text-[13.5px] font-semibold text-s112-text">{f.bezeichnung}</span>
                      <span className="block text-[12px] text-s112-text-2">{f.statusText}</span>
                    </Link>
                  </td>
                  <td className="py-2.5 px-2 font-mono text-[12px] text-s112-text-2 whitespace-nowrap text-right">{f.faelligAm ? fmtDate(f.faelligAm, { day: '2-digit', month: '2-digit' }) : '–'}</td>
                  <td className="py-2.5 pl-2 text-right"><Badge tone={s.tone}>{s.label}</Badge></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}
