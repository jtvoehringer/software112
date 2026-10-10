// behoerdenmeldung: bki-qualitaetsstufen, bki-erzeugnisse, bki-buchungsarten
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import Link from '@/components/ui/Link'
import { csvPfad, type MeldungsId } from '@/lib/behoerden/katalog'
import { betriebUndModuleLaden } from '@/lib/behoerden/zugriff'
import { istParameterFehler } from '@/lib/behoerden/typen'
import { BKI_BLAETTER, parameterFuer, pruefbericht, type PruefHinweis } from '@/lib/behoerden/bki-schnittstelle'
import { bkiZeitraumAus, ladeBkiSchnittstelle } from '@/lib/behoerden/bki-schnittstelle-laden'
import { buchungsartZeilen, erzeugnisZeilen, KATALOG_HINWEIS, qualitaetsstufenZeilen, type KatalogZeile } from '@/lib/behoerden/bki-kataloge'
import { datumAT } from '@/lib/behoerden/ernte_hilfen'
import LagerTabs from '../_behoerden/LagerTabs'

// KAN-50 AP13: Gesamtexport der BKI-Schnittstelle (eine XLSX-Datei, ein Blatt je Spezifikationsblatt, Prüfbericht vorne)
// und die drei Katalogblätter. Jedes Blatt einzeln weiterhin als CSV über /meldungen/<id>/csv.

export const metadata: Metadata = { title: 'BKI-Schnittstelle – Gesamtexport' }
export const dynamic = 'force-dynamic'

const ART_FARBE: Record<PruefHinweis['art'], string> = {
  fehler: 'text-s112-err-fg', fehlt: 'text-s112-muted', warnung: 'text-s112-warn-fg', info: 'text-s112-text-2',
}

function KatalogTabelle({ titel, href, zeilen }: { titel: string; href: string; zeilen: KatalogZeile[] }) {
  return (
    <div className="card p-0 overflow-x-auto">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-s112-border">
        <h2 className="text-sm font-semibold text-s112-text">{titel}</h2>
        <CsvExportKnopf href={href} ariaLabel={`CSV exportieren: ${titel}`} />
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-s112-bg text-left text-xs font-semibold text-s112-text-2">
            <th className="px-3 py-2">Bezeichnung</th><th className="px-3 py-2">Kürzel</th><th className="px-3 py-2">Hinweis</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map(z => (
            <tr key={z.kuerzel} className="border-t border-s112-border">
              <td className="px-3 py-1.5">{z.bezeichnung}</td>
              <td className="px-3 py-1.5 font-mono text-xs">{z.kuerzel}{z.vorlaeufig ? ' *' : ''}</td>
              <td className="px-3 py-1.5 text-xs text-s112-muted">{z.hinweis ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function BkiSchnittstellePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) notFound()
  const supabase = await createSupabaseServerClient()

  const url = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string'))
  const zeitraum = bkiZeitraumAus(url)
  const fehler = istParameterFehler(zeitraum) ? zeitraum.fehler : null
  const z = istParameterFehler(zeitraum) ? bkiZeitraumAus(new URLSearchParams()) : zeitraum
  if (istParameterFehler(z)) notFound()
  const qs = new URLSearchParams({ von: z.von, bis: z.bis, stichtag: z.stichtag }).toString()

  let bericht: PruefHinweis[] | null = null
  if (sp.pruefen === '1' && !fehler) {
    const { betrieb, module } = await betriebUndModuleLaden(supabase, membership.tenantId)
    bericht = pruefbericht(await ladeBkiSchnittstelle({ supabase, tenantId: membership.tenantId, membership, betrieb, module }, z))
  }

  return (
    <div className="space-y-6">
      <LagerTabs aktiv="gesamt" />
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">BKI-Schnittstelle – Gesamtexport</h1>
        <p className="text-xs text-s112-muted mt-0.5">
          Alle Blätter der Schnittstelle in einer XLSX-Datei (ein Arbeitsblatt je Blatt, Prüfbericht vorne). Lagerbewegungen und BSM für den
          Zeitraum, Lagerstand zum Stichtag, besondere Konten für das Weinwirtschaftsjahr des Zeitraumendes.
        </p>
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-xs text-s112-text-2">Von
          <input type="date" name="von" defaultValue={z.von} className="form-input block mt-1" />
        </label>
        <label className="text-xs text-s112-text-2">Bis
          <input type="date" name="bis" defaultValue={z.bis} className="form-input block mt-1" />
        </label>
        <label className="text-xs text-s112-text-2">Lagerstand zum
          <input type="date" name="stichtag" defaultValue={z.stichtag} className="form-input block mt-1" />
        </label>
        <button type="submit" name="pruefen" value="1" className="btn-primary text-sm">Prüfen</button>
        <CsvExportKnopf href={`/meldungen/bki-schnittstelle/xlsx?${qs}`} format="xlsx" label="XLSX herunterladen" />
      </form>
      {fehler && <p role="alert" className="text-sm text-s112-err-fg">{fehler}</p>}

      {bericht && (
        <div className="card">
          <h2 className="text-sm font-semibold text-s112-text mb-2">Prüfbericht {datumAT(z.von)} bis {datumAT(z.bis)}</h2>
          <ul className="text-xs space-y-0.5">
            {bericht.map((h, i) => (
              <li key={i} className={ART_FARBE[h.art]}><span className="font-medium">{h.blatt}</span>: {h.text}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-s112-bg border-b border-s112-border text-left text-xs font-semibold text-s112-text-2">
              <th className="px-3 py-2.5">Blatt der Spezifikation</th><th className="px-3 py-2.5">Stand</th><th className="px-3 py-2.5">Einzeln</th>
            </tr>
          </thead>
          <tbody>
            {BKI_BLAETTER.map(b => (
              <tr key={b.blatt} className="border-t border-s112-border">
                <td className="px-3 py-2">{b.blatt}</td>
                <td className="px-3 py-2 text-xs">{b.nurEinzeln ? 'umgesetzt (nur mit Auswahl)' : b.meldung ? 'umgesetzt' : <span className="text-s112-muted">folgt mit {b.folgt}</span>}</td>
                <td className="px-3 py-2">
                  {b.nurEinzeln ? (
                    <Link href="/kellerbuch/bki-rv" className="text-xs text-s112-blue-700 hover:underline">mit Auswahl öffnen →</Link>
                  ) : b.meldung && (
                    <CsvExportKnopf href={csvPfad(b.meldung as MeldungsId, Object.fromEntries(parameterFuer(b.meldung, z)))} ariaLabel={`CSV exportieren: ${b.blatt}`} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-s112-muted">* {KATALOG_HINWEIS} Die Kürzel gelten in allen Blättern (Erzeugnis, Qualitätsstufe, Buchungsart BSM).</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <KatalogTabelle titel="Qualitätsstufen" href={csvPfad('bki-qualitaetsstufen')} zeilen={qualitaetsstufenZeilen()} />
        <KatalogTabelle titel="Erzeugnisse" href={csvPfad('bki-erzeugnisse')} zeilen={erzeugnisZeilen()} />
        <KatalogTabelle titel="Buchungsarten (BSM)" href={csvPfad('bki-buchungsarten')} zeilen={buchungsartZeilen()} />
      </div>
    </div>
  )
}
