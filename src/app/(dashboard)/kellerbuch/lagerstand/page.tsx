// behoerdenmeldung: bki-lagerstand
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { istParameterFehler } from '@/lib/behoerden/typen'
import { ladeLagerstand, lagerstandStichtag } from '@/lib/behoerden/lagerstand'
import { fmtNum } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import DruckKnopf from '../_behoerden/DruckKnopf'
import LagerTabs from '../_behoerden/LagerTabs'

// KAN-44 Teil 1: BKI-Blatt „Lagerstand zum Datum“ aus dem Bewegungsjournal – dieselbe Ladefunktion liefert die CSV
// (/meldungen/bki-lagerstand/csv?stichtag=…). Die Seite zeigt die wichtigsten Spalten, die CSV alle Spalten des Blatts.

export const metadata: Metadata = { title: 'Lagerstand zum Datum – software:112' }
export const dynamic = 'force-dynamic'

const datum = (d: string) => d.split('-').reverse().join('.')

export default async function LagerstandPage({ searchParams }: { searchParams: Promise<{ stichtag?: string }> }) {
  const sp = await searchParams
  const heute = wienHeute()
  const param = lagerstandStichtag(new URLSearchParams(sp.stichtag ? { stichtag: sp.stichtag } : {}), heute)
  const fehler = istParameterFehler(param) ? param.fehler : null
  const stichtag = istParameterFehler(param) ? heute : param.stichtag

  const membership = await getCurrentMembership()
  if (!membership?.tenantId) notFound()
  const supabase = await createSupabaseServerClient()
  const l = await ladeLagerstand(supabase, membership.tenantId, { stichtag })
  const summeOffen = l.zeilen.filter(z => z.gebindeArt === 'offen').reduce((s, z) => s + z.liter, 0)
  const summeFlasche = l.zeilen.filter(z => z.gebindeArt === 'Flasche').reduce((s, z) => s + z.liter, 0)
  const feld = 'border border-s112-border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

  return (
    <div className="space-y-6">
      <LagerTabs aktiv="lagerstand" />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Lagerstand zum {datum(stichtag)}</h1>
          <p className="text-xs text-s112-muted mt-0.5">
            BKI-Schnittstelle, Blatt „Lagerstand zum Datum“ – Bestand je Charge (offen) und Füllung (Flasche) laut Bewegungsjournal.
            Die CSV enthält alle Spalten des Blatts.
          </p>
        </div>
        <div className="flex items-start gap-2 print:hidden">
          <DruckKnopf />
          <CsvExportKnopf href={csvPfad('bki-lagerstand', { stichtag })} />
        </div>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="text-xs text-s112-text-2">
          <span className="block mb-0.5 font-medium">Stichtag</span>
          <input type="date" name="stichtag" defaultValue={stichtag} max={heute} aria-label="Stichtag" className={feld} />
        </label>
        <button type="submit" className="text-xs border border-s112-teal text-s112-blue-700 px-3 py-1.5 rounded-lg hover:bg-s112-teal/5 font-medium">
          Lagerstand anzeigen
        </button>
      </form>
      {fehler && <p className="text-sm text-s112-err-fg">{fehler}</p>}
      {l.warnungen.length > 0 && (
        <ul className="text-xs text-s112-warn-fg list-disc pl-4 space-y-0.5">
          {l.warnungen.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-s112-bg border-b border-s112-border text-left text-xs font-semibold text-s112-text-2">
              <th className="px-3 py-2.5">Produkt</th>
              <th className="px-3 py-2.5">Erzeugnis</th>
              <th className="px-3 py-2.5">Sorte</th>
              <th className="px-3 py-2.5">Stufe</th>
              <th className="px-3 py-2.5">Jg.</th>
              <th className="px-3 py-2.5">Herkunft</th>
              <th className="px-3 py-2.5">Art</th>
              <th className="px-3 py-2.5">Gebinde</th>
              <th className="px-3 py-2.5">Prüfnr.</th>
              <th className="px-3 py-2.5 text-right">Stk</th>
              <th className="px-3 py-2.5 text-right">Liter</th>
            </tr>
          </thead>
          <tbody>
            {l.zeilen.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-xs text-s112-muted italic">Kein Bestand zum Stichtag</td></tr>
            ) : l.zeilen.map((z, i) => (
              <tr key={i} className="border-b border-s112-border/30 last:border-0">
                <td className="px-3 py-2">{z.produkt ?? '–'}</td>
                <td className="px-3 py-2 text-xs">{z.erzeugnis ?? '–'}</td>
                <td className="px-3 py-2 text-xs">{z.sorte ?? z.sorteName ?? '–'}</td>
                <td className="px-3 py-2 text-xs">{z.qualitaet ?? '–'}</td>
                <td className="px-3 py-2 text-xs">{z.jahrgang ?? '–'}</td>
                <td className="px-3 py-2 text-xs">{z.herkunft ?? '–'}</td>
                <td className="px-3 py-2 text-xs">{z.gebindeArt}{z.etikett ? ` (${z.etikett})` : ''}</td>
                <td className="px-3 py-2 text-xs">{z.gebinde ?? '–'}{z.nennvolumen !== null ? ` · ${fmtNum(z.nennvolumen, z.gebindeArt === 'Flasche' ? 3 : 0)} l` : ''}</td>
                <td className="px-3 py-2 text-xs">{z.pruefnummer ?? ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{z.stk ?? ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(z.liter, 2)}</td>
              </tr>
            ))}
            {l.zeilen.length > 0 && (
              <tr className="border-t-2 border-s112-teal/30 bg-s112-teal/5 text-sm">
                <td colSpan={10} className="px-3 py-2 font-medium">Summe offen {fmtNum(summeOffen, 2)} l · Flaschen {fmtNum(summeFlasche, 2)} l</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtNum(summeOffen + summeFlasche, 2)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
