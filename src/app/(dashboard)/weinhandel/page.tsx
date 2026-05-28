import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Weinhandel – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const QUALITAET_LABELS: Record<string, string> = {
  qualitaetswein:         'Qualitätswein',
  kabinett:               'Kabinett',
  spaetlese:              'Spätlese',
  auslese:                'Auslese',
  beerenauslese:          'Beerenauslese',
  trockenbeerenauslese:   'TBA',
  eiswein:                'Eiswein',
  strohwein:              'Strohwein',
  dac:                    'DAC',
  reserve:                'Reservé',
  erste_lage:             'Erste Lage',
  grosses_gewachs:        'Gr. Gewächs',
  landwein:               'Landwein',
  sekt:                   'Sekt b.A.',
  perlwein:               'Perlwein',
  sonstiges:              'Sonstiges',
}

const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L (Magnum)', 3000: '3,0 L', 6000: '6,0 L',
}

export default async function WeinhandelPage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const { data: raw } = await (supabase.from('fuellungen') as any)
    .select('id, name, jahrgang, rebsorte, qualitaet, anbaugebiet, bezeichnung, datum, flaschengroesse_ml, anzahl_flaschen, bestand_flaschen, vk_preis_brutto, aktiv')
    .eq('aktiv', true)
    .order('datum', { ascending: false })

  const fuellungen = (raw ?? []) as R[]

  // Kennzahlen
  const gesamtFlaschen  = fuellungen.reduce((s: number, f: R) => s + (f.bestand_flaschen ?? 0), 0)
  const gesamtWert      = fuellungen.reduce((s: number, f: R) =>
    s + ((f.bestand_flaschen ?? 0) * (f.vk_preis_brutto ?? 0)), 0)
  const artikelAnzahl   = fuellungen.length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weinhandel</h1>
          <p className="text-sm text-s112-muted mt-0.5">Lager & Produkte</p>
        </div>
        {writeOk && (
          <Link
            href="/weinhandel/fuellungen/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            🍾 Neue Füllung
          </Link>
        )}
      </div>

      {/* Kennzahlen */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card text-center p-4">
          <p className="text-3xl font-bold text-s112-teal">{artikelAnzahl}</p>
          <p className="text-xs text-s112-muted mt-1">Artikel im Lager</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-3xl font-bold text-s112-teal">{gesamtFlaschen.toLocaleString('de-AT')}</p>
          <p className="text-xs text-s112-muted mt-1">Flaschen gesamt</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-3xl font-bold text-s112-teal">
            {gesamtWert > 0
              ? gesamtWert.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
              : '–'}
          </p>
          <p className="text-xs text-s112-muted mt-1">Lagerwert (Brutto-VK)</p>
        </div>
      </div>

      {/* Produktliste */}
      {fuellungen.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">🍾</p>
          <p className="text-lg font-semibold text-gray-800 mb-1">Noch keine Füllungen angelegt</p>
          <p className="text-sm text-s112-muted mb-4">
            Starte eine Abfüllung direkt aus dem Kellerbuch oder über die Schaltfläche oben.
          </p>
          {writeOk && (
            <Link href="/weinhandel/fuellungen/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
              🍾 Erste Füllung anlegen
            </Link>
          )}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Produkt</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Qualität</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Größe</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Bestand</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">VK brutto</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Lagerwert</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Abgefüllt</th>
              </tr>
            </thead>
            <tbody>
              {fuellungen.map((f: R, i: number) => {
                const bestand    = f.bestand_flaschen ?? 0
                const gesamt     = f.anzahl_flaschen ?? 0
                const preis      = f.vk_preis_brutto ?? null
                const lagerwert  = preis != null ? bestand * preis : null
                const bestandPct = gesamt > 0 ? Math.round((bestand / gesamt) * 100) : 0
                const bestandColor = bestandPct > 50 ? 'text-green-700' : bestandPct > 20 ? 'text-orange-600' : 'text-red-600'

                return (
                  <tr key={f.id} className={`border-b border-s112-border last:border-0 hover:bg-s112-bg/50 transition-colors ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {f.name}{f.bezeichnung ? ` – ${f.bezeichnung}` : ''}
                      </div>
                      <div className="text-xs text-s112-muted mt-0.5 flex gap-2">
                        {f.jahrgang && <span>{f.jahrgang}</span>}
                        {f.rebsorte && <span>{f.rebsorte}</span>}
                        {f.anbaugebiet && <span>{f.anbaugebiet}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-s112-muted">
                      {QUALITAET_LABELS[f.qualitaet] ?? f.qualitaet}
                    </td>
                    <td className="px-4 py-3 text-s112-muted whitespace-nowrap">
                      {FLASCHEN_LABEL[f.flaschengroesse_ml] ?? `${f.flaschengroesse_ml} ml`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold tabular-nums ${bestandColor}`}>
                        {bestand.toLocaleString('de-AT')}
                      </span>
                      <span className="text-xs text-s112-muted ml-1">/ {gesamt.toLocaleString('de-AT')}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {preis != null
                        ? preis.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
                        : <span className="text-s112-muted">–</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-s112-teal font-semibold">
                      {lagerwert != null
                        ? lagerwert.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
                        : <span className="text-s112-muted font-normal">–</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-s112-muted whitespace-nowrap">
                      {new Date(f.datum).toLocaleDateString('de-AT')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
