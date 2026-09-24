// behoerdenmeldung: transportbescheinigungen
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import type { Metadata } from 'next'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeTransportbescheinigungen, FORMULAR_GESPEICHERT } from '@/lib/behoerden/transportbescheinigung'
import { istDatum } from '@/lib/behoerden/verkehr-hilfen'
import { wienHeute } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import DruckKnopf from './DruckKnopf'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Transportbescheinigungen – software:112' }

// Zeitraumliste aller Transportbescheinigungen (Behördenmeldung „transportbescheinigungen“):
// Druckansicht und CSV nutzen dieselbe Ladefunktion wie die einzelne Transportbescheinigung
// (lib/behoerden/transportbescheinigung.ts). Nicht gespeicherte Formulare erscheinen mit
// ihrer Vorbelegung und dem Formularstand „nicht gespeicherte Vorbelegung“.

/** 'JJJJ-MM-TT' → 'TT.MM.JJJJ' (stringbasiert, ohne Zeitzone) */
function tag(d: string | null): string {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('.') : '–'
}

export default async function TransportbescheinigungenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/dashboard')

  const heute = wienHeute()
  const vonRoh = typeof sp.von === 'string' ? sp.von : ''
  const bisRoh = typeof sp.bis === 'string' ? sp.bis : ''
  const von = istDatum(vonRoh) ? vonRoh : `${heute.slice(0, 4)}-01-01`
  const bis = istDatum(bisRoh) ? bisRoh : heute
  const nurGespeichert = sp.nur === 'gespeichert'
  const eingabeFehler = (vonRoh && !istDatum(vonRoh)) || (bisRoh && !istDatum(bisRoh))
    ? 'Ungültiges Datum – Standardzeitraum (1. Jänner bis heute) wird angezeigt.'
    : von > bis ? '„Von“ liegt nach „bis“ – bitte den Zeitraum korrigieren.' : null

  const supabase = await createSupabaseServerClient()
  const { zeilen, warnungen } = von <= bis
    ? await ladeTransportbescheinigungen(supabase, membership.tenantId, { von, bis, nurGespeichert })
    : { zeilen: [], warnungen: [] }
  const belege = new Set(zeilen.map(z => z.verkaufspostenId)).size

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-s112-muted print:hidden">
        <Link href="/weinhandel/verkauf" className="hover:text-s112-blue-700 transition-colors">Verkauf</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Transportbescheinigungen</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Transportbescheinigungen</h1>
          <p className="text-sm text-s112-muted mt-0.5">
            {nurGespeichert ? 'Gespeicherte Transportbescheinigungen' : 'Verkäufe mit Tank-, Flaschen- oder Traubenpositionen'} vom {tag(von)} bis {tag(bis)} · {belege} {belege === 1 ? 'Verkauf' : 'Verkäufe'}, {zeilen.length} {zeilen.length === 1 ? 'Weinposition' : 'Weinpositionen'}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2 print:hidden">
          <DruckKnopf />
          {von <= bis && <CsvExportKnopf href={csvPfad('transportbescheinigungen', { von, bis, nur: nurGespeichert ? 'gespeichert' : null })} className="self-center" />}
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-xs text-s112-text-2">
          <span className="block mb-0.5">Verkaufsdatum von</span>
          <input type="date" name="von" defaultValue={von} className="border border-s112-border rounded-lg px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-s112-text-2">
          <span className="block mb-0.5">bis</span>
          <input type="date" name="bis" defaultValue={bis} className="border border-s112-border rounded-lg px-2 py-1 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-s112-text-2 pb-1.5">
          <input type="checkbox" name="nur" value="gespeichert" defaultChecked={nurGespeichert} className="accent-s112-teal" />
          nur gespeicherte Transportbescheinigungen
        </label>
        <button type="submit" className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-opacity-90">
          Anzeigen
        </button>
      </form>

      {eingabeFehler && <p role="alert" className="text-sm text-s112-err-fg print:hidden">{eingabeFehler}</p>}

      {warnungen.length > 0 && (
        <div role="status" className="text-xs text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2 print:hidden">
          <p className="font-medium mb-1">Hinweise ({warnungen.length})</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {warnungen.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}
            {warnungen.length > 20 && <li>… und {warnungen.length - 20} weitere</li>}
          </ul>
        </div>
      )}

      {zeilen.length === 0 ? (
        <div className="card text-center py-12 text-sm text-s112-muted">Keine Verkäufe mit Transportbescheinigung in diesem Zeitraum.</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-left">
                <th className="px-3 py-2 font-semibold">Verkaufsdatum</th>
                <th className="px-3 py-2 font-semibold">Rechnung</th>
                <th className="px-3 py-2 font-semibold">Empfänger</th>
                <th className="px-3 py-2 font-semibold">Lieferung</th>
                <th className="px-3 py-2 font-semibold text-right">Pos.</th>
                <th className="px-3 py-2 font-semibold text-right">Menge</th>
                <th className="px-3 py-2 font-semibold">Art</th>
                <th className="px-3 py-2 font-semibold">Traubensorte(n)</th>
                <th className="px-3 py-2 font-semibold">Jahrgang</th>
                <th className="px-3 py-2 font-semibold">Prüfnummer</th>
                <th className="px-3 py-2 font-semibold">Angereichert</th>
                <th className="px-3 py-2 font-semibold">Formularstand</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map(z => (
                <tr key={`${z.verkaufspostenId}-${z.position}`} className="border-b border-s112-border last:border-0 align-top">
                  <td className="px-3 py-1.5 tabular-nums">{tag(z.verkaufsdatum)}</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/weinhandel/verkauf/${z.verkaufspostenId}/transportbescheinigung`} className="text-s112-blue-700 hover:underline">
                      {z.rechnungsnummer ?? 'Formular'}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">{z.empfaengerKurz || '–'}</td>
                  <td className="px-3 py-1.5 tabular-nums">{tag(z.lieferdatum)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{z.position}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{z.menge === null ? '–' : `${fmtNum(z.menge, { max: 2 })} ${z.einheit ?? ''}`}</td>
                  <td className="px-3 py-1.5">{z.art ?? '–'}</td>
                  <td className="px-3 py-1.5">{z.traubensorte ?? '–'}</td>
                  <td className="px-3 py-1.5">{z.jahrgang ?? '–'}</td>
                  <td className="px-3 py-1.5 font-mono">{z.pruefnummer ?? '–'}</td>
                  <td className="px-3 py-1.5">{z.angereichert === null ? '–' : z.angereichert ? 'J' : 'N'}</td>
                  <td className={`px-3 py-1.5 ${z.formularstand === FORMULAR_GESPEICHERT ? 'text-s112-ok-fg' : 'text-s112-warn-fg'}`}>{z.formularstand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
