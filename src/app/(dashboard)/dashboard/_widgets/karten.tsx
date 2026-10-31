import Link from '@/components/ui/Link'
import { TrendingUp } from 'lucide-react'
import { canWrite } from '@/lib/auth/roles'
import { Card, Badge, Empty, fmtEur, fmtNum, fmtDate, tageBis, type BadgeTone } from '../_shared/ui'
import type { AufgabeTermin } from '../_shared/data'
import MorgenberichtKarte from '../morgenbericht/MorgenberichtKarte'
import { fristenDringend, type WidgetProps } from './typen'

// KAN-387: Karten der Übersicht als eigene Widgets (Inhalt unverändert aus dashboard/page.tsx)

// ── Finanzen (E&A / Doppik) ───────────────────────────────────────────────────
export function FinanzenWidget({ ctx, einst, d }: WidgetProps) {
  const f = d.finanzen
  if (!f) return null
  const jahr = ctx.heute.getFullYear()
  const delta = f.ytd.ergebnisVj === 0 ? null : (f.ytd.ergebnis - f.ytd.ergebnisVj) / Math.abs(f.ytd.ergebnisVj) * 100
  const offenUebergabe = f.uebergabe ? f.uebergabe.rechnungenOffen + f.uebergabe.belegeOffen : 0
  return (
    <Link href="/buchhaltung/uebersicht" className="block bg-white border border-s112-line rounded-xl px-[18px] py-3.5 hover:border-s112-teal hover:shadow-xs transition-all">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} strokeWidth={1.75} className="text-s112-blue-700" />
          <span className="font-display font-semibold text-[14.5px] text-s112-text">Finanzen {jahr}</span>
          <span className="text-[12px] text-s112-tertiary">bis heute · {einst.doppik ? 'Belege für den Steuerberater' : 'E&A-Rechnung'}</span>
        </div>
        <div className="flex items-center gap-x-6 gap-y-1 sm:gap-y-6 flex-wrap text-[13px]">
          <span><span className="text-s112-text-2">Ergebnis </span><span className={`font-mono font-semibold ${f.ytd.ergebnis < 0 ? 'text-s112-err-fg' : ''}`}>{fmtEur(f.ytd.ergebnis)}</span>{delta !== null && <span className={`ml-1 text-[12px] ${delta < 0 ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(0)} % VJ</span>}</span>
          <span><span className="text-s112-text-2">Liquidität </span><span className={`font-mono font-semibold ${f.liquiditaet.summe < 0 ? 'text-s112-err-fg' : ''}`}>{fmtEur(f.liquiditaet.summe)}</span></span>
          <span><span className="text-s112-text-2">Forderungen </span><span className="font-mono font-semibold">{fmtEur(f.forderungen.summe)}</span></span>
          {f.uebergabe
            ? <Badge tone={offenUebergabe > 0 ? 'warn' : 'ok'}>{offenUebergabe > 0 ? `${offenUebergabe} Belege nicht übergeben` : 'alles übergeben'}</Badge>
            : f.uva && <Badge tone={f.uva.status === 'uebermittelt' ? 'ok' : f.uva.faelligAm < ctx.heuteStr ? 'err' : 'warn'}>UVA {f.uva.label}: {f.uva.status === 'uebermittelt' ? 'übermittelt' : f.uva.status === 'entwurf' ? 'Entwurf' : 'offen'}</Badge>}
          {f.unvollstaendig.length > 0 && <Badge tone="err">Zahlen unvollständig</Badge>}
          <span className="text-[12px] text-s112-blue-700">Finanzübersicht →</span>
        </div>
      </div>
    </Link>
  )
}

// ── Nächste Schritte: aus Keller, Fristen und Wartefristen ───────────────────
type Schritt = { key: string; titel: string; hinweis: string; wann: string; badge: string; tone: BadgeTone; href: string; rang: number }

export function NaechsteSchritteWidget({ d }: WidgetProps) {
  const { keller, fristen, weingarten } = d
  if (!keller || !fristen || !weingarten) return null
  const schritte: Schritt[] = []
  for (const c of keller.chargen.filter(c => c.messungFaellig).slice(0, 3)) {
    schritte.push({
      key: `mess:${c.id}`, titel: `Gärkontrolle – ${c.name}`, hinweis: c.tageSeitMessung === null ? 'Noch keine Analyse erfasst' : `Letzte Messung vor ${c.tageSeitMessung} Tagen${c.behaelter ? ` · ${c.behaelter}` : ''}`,
      wann: 'heute', badge: 'FÄLLIG', tone: 'warn', href: `/kellerbuch/weinausbau/${c.id}`, rang: 1,
    })
  }
  for (const c of keller.chargen.filter(c => c.status === 'abfuellung').slice(0, 2)) {
    schritte.push({
      key: `fuell:${c.id}`, titel: `Abfüllung planen – ${c.name}`, hinweis: `${fmtNum(c.menge_liter)} L füllfertig${c.behaelter ? ` · ${c.behaelter}` : ''}`,
      wann: 'offen', badge: 'FÜLLFERTIG', tone: 'info', href: `/kellerbuch/weinausbau/${c.id}`, rang: 3,
    })
  }
  for (const f of fristenDringend(fristen).slice(0, 4)) {
    schritte.push({
      key: f.key, titel: f.bezeichnung, hinweis: f.hinweis, wann: f.faelligAm ? `bis ${fmtDate(f.faelligAm, { day: '2-digit', month: '2-digit' })}` : '–',
      badge: f.status === 'ueberfaellig' ? 'ÜBERFÄLLIG' : 'FÄLLIG', tone: f.status === 'ueberfaellig' ? 'err' : 'warn', href: f.href ?? '/dashboard/fristen', rang: f.status === 'ueberfaellig' ? 0 : 2,
    })
  }
  for (const w of weingarten.wartefristen.filter(w => tageBis(w.freiAb) <= 14).slice(0, 2)) {
    schritte.push({
      key: `wf:${w.id}`, titel: `Wartefrist endet – ${w.ried}`, hinweis: `Behandlung vom ${fmtDate(w.datum)} · Lese frei ab ${fmtDate(w.freiAb)}`,
      wann: fmtDate(w.freiAb, { day: '2-digit', month: '2-digit' }), badge: 'WARTEFRIST', tone: 'gray', href: '/behandlungen', rang: 4,
    })
  }
  // Termine/Aufgaben stehen seit 22.9.2026 im eigenen Widget „Aufgaben & Termine“ (Meine / Betrieb)
  schritte.sort((a, b) => a.rang - b.rang)

  return (
    <Card title="Nächste Schritte" right={<Link href="/dashboard/fristen" className="text-[11.5px] text-s112-blue-700 hover:underline">alle Fristen →</Link>}>
      {schritte.length === 0 ? (
        <Empty>Nichts Dringendes – keine fälligen Messungen oder Fristen.</Empty>
      ) : (
        <table className="w-full">
          <tbody>
            {schritte.slice(0, 8).map(s => (
              <tr key={s.key} className="border-b border-s112-line last:border-0 hover:bg-s112-bg">
                <td className="py-2.5 pr-2">
                  <Link href={s.href} className="block">
                    <span className="block text-[13.5px] font-semibold text-s112-text">{s.titel}</span>
                    <span className="block text-[12px] text-s112-text-2">{s.hinweis}</span>
                  </Link>
                </td>
                <td className="py-2.5 px-2 font-mono text-[12px] text-s112-text-2 whitespace-nowrap text-right">{s.wann}</td>
                <td className="py-2.5 pl-2 text-right"><Badge tone={s.tone}>{s.badge}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

// ── Morgenbericht (ersetzt seit 10.9.2026 „Datenfluss statt Zettelwirtschaft“) ──
export function MorgenberichtWidget({ ctx, einst, d }: WidgetProps) {
  return (
    <MorgenberichtKarte bericht={d.morgenbericht ?? null} darfSchreiben={canWrite(ctx.role, 'betrieb')} wetterHinweis={!einst.wetterAktiv || !einst.modulWeingarten ? 'Wetter & Empfehlungen sind für diesen Betrieb deaktiviert (Mein Betrieb → Branding & Regeln).' : null} />
  )
}

// ── Aufgaben & Termine: mir zugewiesen / für alle vs. Betrieb (Migration 224, 22.9.2026) ──
export function AufgabenTermineWidget({ ctx, d }: WidgetProps) {
  const aufgabenTermine = d.aufgabenTermine
  if (!aufgabenTermine) return null
  return (
    <Card title="Aufgaben & Termine"
      right={<Link href="/crm" className="text-[11.5px] text-s112-blue-700 hover:underline">Kalender →</Link>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
        <AufgabenSpalte titel="Meine" hinweis="mir zugewiesen oder für alle" eintraege={aufgabenTermine.meine} heute={ctx.heuteStr}
          leer="Nichts für mich – keine zugewiesenen Aufgaben oder Termine." meine />
        <AufgabenSpalte titel="Betrieb" hinweis="anderen zugewiesen oder niemandem" eintraege={aufgabenTermine.betrieb} heute={ctx.heuteStr}
          leer="Keine weiteren offenen Aufgaben oder Termine im Betrieb." />
      </div>
    </Card>
  )
}

// ── Spalte „Meine“ / „Betrieb“ der Karte Aufgaben & Termine ──────────────────
function AufgabenSpalte({ titel, hinweis, eintraege, heute, leer, meine = false }: {
  titel: string; hinweis: string; eintraege: AufgabeTermin[]; heute: string; leer: string; meine?: boolean
}) {
  const offen = eintraege.length
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between mb-1.5">
        <h3 className="text-[12.5px] font-semibold text-s112-text">{titel} <span className="font-mono font-normal text-s112-tertiary">({offen})</span></h3>
        <span className="text-[11px] text-s112-tertiary">{hinweis}</span>
      </div>
      {offen === 0 ? (
        <p className="text-[12px] text-s112-tertiary py-2">{leer}</p>
      ) : (
        <table className="w-full">
          <tbody>
            {eintraege.slice(0, 6).map(a => (
              <tr key={a.id} className="border-b border-s112-line last:border-0 hover:bg-s112-bg">
                <td className="py-2 pr-2 min-w-0">
                  <Link href={`/crm?aktivitaet=${a.id}`} className="block min-w-0">
                    <span className="block text-[13px] font-semibold text-s112-text truncate">{a.betreff}</span>
                    <span className="block text-[11.5px] text-s112-text-2 truncate">
                      {a.wer || (a.istAufgabe ? 'Aufgabe' : 'Termin')}{!meine && <> · <span className="text-s112-tertiary">{a.verantwortlich}</span></>}{meine && a.fuerAlle && <> · <span className="text-s112-tertiary">für alle</span></>}
                    </span>
                  </Link>
                </td>
                <td className={`py-2 px-2 font-mono text-[12px] whitespace-nowrap text-right ${a.ueberfaellig ? 'text-s112-err-fg' : 'text-s112-text-2'}`}>
                  {a.datum === heute ? 'heute' : fmtDate(a.datum, { weekday: 'short', day: '2-digit', month: '2-digit' })}{a.uhrzeit ? ` ${a.uhrzeit}` : ''}
                </td>
                <td className="py-2 pl-2 text-right"><Badge tone={a.ueberfaellig ? 'err' : a.istAufgabe ? 'warn' : 'info'}>{a.ueberfaellig ? 'ÜBERFÄLLIG' : a.istAufgabe ? 'AUFGABE' : 'TERMIN'}</Badge></td>
              </tr>
            ))}
            {offen > 6 && (
              <tr><td colSpan={3} className="pt-1.5 text-[11.5px]"><Link href="/crm" className="text-s112-blue-700 hover:underline">{offen - 6} weitere im Kalender →</Link></td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
