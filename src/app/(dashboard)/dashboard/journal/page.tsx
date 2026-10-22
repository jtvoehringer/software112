import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { DashHeader, Card, Note, Empty } from '../_shared/ui'
import { getCtx } from '../_shared/data'
import { ladeJournal } from '@/lib/journal/laden'
import { JOURNAL_AKTIONEN, JOURNAL_BEREICHE, filterParameter, journalFilter } from '@/lib/journal/journal'
import { heuteWien } from '@/lib/datum/wien'
import { wienZeitpunkt } from '@/lib/csv'
import { fmtZahl } from '@/lib/format'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import DruckFormatKnopf from '@/components/DruckFormatKnopf'
import SortierungUmschalter from '@/components/SortierungUmschalter'
import { PROTOKOLL_SORT_VORGABE, inAnzeigeReihenfolge, protokollSortAus } from '@/lib/protokoll/sortierung'

export const metadata: Metadata = { title: 'Journal' }
export const dynamic = 'force-dynamic'

// ── Sicht „Journal“ (KAN-332, 13.10.2026) ────────────────────────────────────
// Wer hat wann in welchem Bereich was gebucht – neueste oben. Mitarbeiter sehen ihre eigenen Vorgänge, die
// Betriebsleitung alle (Filter nach Benutzer). Quelle: Bestandsprotokoll (Anlage seit KAN-332, Änderung, Storno,
// Löschung). Druck über den Browser (PDF), CSV über /api/export/journal mit denselben Filtern.

/** Höchstzahl Zeilen auf der Seite – mehr gibt es in der CSV */
const MAX_ANZEIGE = 1000

const AKTION_FARBE: Record<string, string> = {
  anlage: 'bg-s112-ok-bg text-s112-ok-fg',
  aenderung: 'bg-s112-blue-50 text-s112-blue-700',
  storno: 'bg-s112-warn-bg text-s112-warn-fg',
  loeschung: 'bg-s112-err-bg text-s112-err-fg',
}

function zeitText(z: string): string {
  const w = wienZeitpunkt(z)
  if (!w) return z
  return `${w.datum.slice(8, 10)}.${w.datum.slice(5, 7)}.${w.datum.slice(0, 4)}${w.uhrzeit ? ` ${w.uhrzeit}` : ''}`
}

export default async function JournalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCtx()
  const sp = await searchParams
  const f = journalFilter(sp, heuteWien())
  // KAN-350: Bildschirmansicht des Änderungsprotokolls – neueste zuerst (Vorgabe) oder chronologisch (?sort=alt).
  // Die CSV des Änderungsprotokolls (Gebinde-Seite) bleibt chronologisch, die Journal-CSV unverändert.
  const sort = protokollSortAus(sp.sort)
  if (!ctx.tenantId || !ctx.userId) {
    return <div className="space-y-6"><DashHeader title="Journal" /><Empty>Kein Betrieb ausgewählt.</Empty></div>
  }
  const { zeilen, alleSichtbar, benutzer } = await ladeJournal(ctx.supabase, { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role }, f)
  const csvHref = `/api/export/journal?${new URLSearchParams(filterParameter(f))}`
  // ladeJournal liefert neueste zuerst; angezeigt werden die neuesten MAX_ANZEIGE – in der gewählten Reihenfolge
  const sichtbar = inAnzeigeReihenfolge(zeilen.slice(0, MAX_ANZEIGE).reverse(), sort)
  const feld = 'border border-s112-border rounded-lg px-2.5 py-1.5 text-sm bg-white'

  return (
    <div className="space-y-6">
      <DashHeader
        title="Journal"
        sub={`${alleSichtbar
          ? 'Alle Vorgänge im Betrieb – wer hat wann in welchem Bereich was angelegt, geändert, storniert oder gelöscht.'
          : 'Deine Vorgänge – was Du wann in welchem Bereich angelegt, geändert, storniert oder gelöscht hast.'} ${sort === 'neu' ? 'Neueste oben.' : 'Chronologisch (älteste oben).'}`}
        right={<div className="flex flex-wrap items-center gap-2 print:hidden">
          <SortierungUmschalter sort={sort} pfad="/dashboard/journal" parameter={filterParameter(f)} />
          <DruckFormatKnopf standard="quer" klein />
          <CsvExportKnopf href={csvHref} />
        </div>}
      />

      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-xs text-s112-text-2 space-y-1">
          <span className="block">Von</span>
          <input type="date" name="von" defaultValue={f.von} className={feld} />
        </label>
        <label className="text-xs text-s112-text-2 space-y-1">
          <span className="block">Bis</span>
          <input type="date" name="bis" defaultValue={f.bis} className={feld} />
        </label>
        <label className="text-xs text-s112-text-2 space-y-1">
          <span className="block">Bereich</span>
          <select name="bereich" defaultValue={f.bereich ?? ''} className={feld}>
            <option value="">Alle Bereiche</option>
            {JOURNAL_BEREICHE.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-s112-text-2 space-y-1">
          <span className="block">Aktion</span>
          <select name="aktion" defaultValue={f.aktion ?? ''} className={feld}>
            <option value="">Alle Aktionen</option>
            {JOURNAL_AKTIONEN.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        {alleSichtbar && (
          <label className="text-xs text-s112-text-2 space-y-1">
            <span className="block">Benutzer</span>
            <select name="benutzer" defaultValue={f.benutzer ?? ''} className={feld}>
              <option value="">Alle Benutzer</option>
              {benutzer.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        {sort !== PROTOKOLL_SORT_VORGABE && <input type="hidden" name="sort" value={sort} />}
        <button type="submit" className="btn-primary text-sm py-1.5">Anzeigen</button>
        <Link href="/dashboard/journal" className="text-sm text-s112-text-2 hover:text-s112-blue-700 py-1.5">Zurücksetzen</Link>
      </form>

      <Card
        title={`${fmtZahl(zeilen.length, 0)} ${zeilen.length === 1 ? 'Vorgang' : 'Vorgänge'} vom ${zeitText(f.von)} bis ${zeitText(f.bis)}`}
        pad={false}
      >
        {zeilen.length === 0 ? (
          <Empty>Keine Vorgänge in diesem Zeitraum.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-s112-bg text-left text-xs text-s112-text-2">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium whitespace-nowrap">Zeitpunkt</th>
                  <th scope="col" className="px-4 py-2 font-medium">Bereich</th>
                  <th scope="col" className="px-4 py-2 font-medium">Vorgang</th>
                  <th scope="col" className="px-4 py-2 font-medium">Aktion</th>
                  <th scope="col" className="px-4 py-2 font-medium">Datensatz</th>
                  {alleSichtbar && <th scope="col" className="px-4 py-2 font-medium">Benutzer</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-s112-line">
                {sichtbar.map(z => (
                  <tr key={z.id} className="align-top">
                    <td className="px-4 py-2 whitespace-nowrap font-mono text-[12px]">{zeitText(z.zeitpunkt)}</td>
                    <td className="px-4 py-2">{z.bereich}</td>
                    <td className="px-4 py-2">{z.vorgang}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11.5px] font-medium ${AKTION_FARBE[z.aktion] ?? ''}`}>{z.aktionText}</span>
                    </td>
                    <td className="px-4 py-2">
                      {z.link ? <Link href={z.link} className="text-s112-blue-700 hover:underline">{z.beschreibung}</Link> : z.beschreibung}
                      {z.felder && <div className="text-[11.5px] text-s112-text-2">geändert: {z.felder}</div>}
                      {z.grund && <div className="text-[11.5px] text-s112-text-2">Grund: {z.grund}</div>}
                    </td>
                    {alleSichtbar && <td className="px-4 py-2 whitespace-nowrap">{z.benutzer}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {zeilen.length > MAX_ANZEIGE && (
              <p className="px-4 py-3 text-xs text-s112-text-2">
                Angezeigt werden die neuesten {fmtZahl(MAX_ANZEIGE, 0)} Vorgänge – alle {fmtZahl(zeilen.length, 0)} stehen in der CSV, oder den Zeitraum einschränken.
              </p>
            )}
          </div>
        )}
      </Card>

      <Note className="print:hidden">
        Neuanlagen stehen im Journal ab dem 13.10.2026; Änderungen, Stornos und Löschungen reichen weiter zurück. Positionen
        (z. B. einer Rechnung oder Pressung) erscheinen bei der Anlage über ihren Kopf, bei Änderungen einzeln.
      </Note>
    </div>
  )
}
