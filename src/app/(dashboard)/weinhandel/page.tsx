import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Weinhandel – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const QUALITAET_LABELS: Record<string, string> = {
  qualitaetswein:        'Qualitätswein',
  kabinett:              'Kabinett',
  spaetlese:             'Spätlese',
  auslese:               'Auslese',
  beerenauslese:         'Beerenauslese',
  trockenbeerenauslese:  'TBA',
  eiswein:               'Eiswein',
  strohwein:             'Strohwein',
  dac:                   'DAC',
  reserve:               'Reservé',
  erste_lage:            'Erste Lage',
  grosses_gewachs:       'Gr. Gewächs',
  landwein:              'Landwein',
  sekt:                  'Sekt b.A.',
  perlwein:              'Perlwein',
  sonstiges:             'Sonstiges',
}

const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L Magnum', 3000: '3,0 L', 6000: '6,0 L',
}

const STATUS_VERKAUF: Record<string, { label: string; color: string }> = {
  ernte:    { label: 'Ernte',   color: 'bg-yellow-100 text-yellow-700' },
  gaerung:  { label: 'Gärung', color: 'bg-orange-100 text-orange-700' },
  ausbau:   { label: 'Ausbau', color: 'bg-blue-100 text-blue-700'   },
  abfuellung:{ label: 'Abfüllung', color: 'bg-purple-100 text-purple-700' },
}

export default async function WeinhandelPage() {
  const supabase = await createSupabaseServerClient()

  const [
    { data: fuellungenRaw },
    { data: tanksRaw },
  ] = await Promise.all([
    // Abgefüllte Flaschen im Lager
    (supabase.from('fuellungen') as any)
      .select('id, name, jahrgang, rebsorte, qualitaet, anbaugebiet, bezeichnung, datum, flaschengroesse_ml, anzahl_flaschen, bestand_flaschen, vk_preis_brutto, aktiv')
      .eq('aktiv', true)
      .order('datum', { ascending: false }),

    // Weinausbau-Chargen die für Tankverkauf in Frage kommen
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, menge_liter, status, behaelter_id, behaelter:behaelter_id(name)')
      .eq('aktiv', true)
      .in('status', ['ausbau', 'abfuellung'])
      .order('jahrgang', { ascending: false }),
  ])

  const fuellungen = (fuellungenRaw ?? []) as R[]
  const tanks      = (tanksRaw      ?? []) as R[]

  // Kennzahlen Flaschenbestand
  const gesamtFlaschen = fuellungen.reduce((s: number, f: R) => s + (f.bestand_flaschen ?? 0), 0)
  const gesamtWert     = fuellungen.reduce((s: number, f: R) =>
    s + ((f.bestand_flaschen ?? 0) * (f.vk_preis_brutto ?? 0)), 0)
  const gesamtLiterTank = tanks.reduce((s: number, t: R) => s + (t.menge_liter ?? 0), 0)

  return (
    <div className="space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weinhandel</h1>
          <p className="text-sm text-s112-muted mt-0.5">Handelsbestand & Verkauf</p>
        </div>
      </div>

      {/* ── Kennzahlen ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center p-4">
          <p className="text-3xl font-bold text-s112-teal">{gesamtFlaschen.toLocaleString('de-AT')}</p>
          <p className="text-xs text-s112-muted mt-1">Flaschen auf Lager</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-3xl font-bold text-s112-teal">
            {gesamtWert > 0
              ? gesamtWert.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
              : '–'}
          </p>
          <p className="text-xs text-s112-muted mt-1">Lagerwert Flaschen (Brutto-VK)</p>
        </div>
        <div className="card text-center p-4">
          <p className="text-3xl font-bold text-s112-teal">
            {gesamtLiterTank > 0 ? `${gesamtLiterTank.toLocaleString('de-AT')} L` : '–'}
          </p>
          <p className="text-xs text-s112-muted mt-1">Liter im Tank (Direktverkauf)</p>
        </div>
      </div>

      {/* ── Flaschenbestand ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-semibold text-gray-800 mb-3">🍾 Flaschenbestand</h2>

        {fuellungen.length === 0 ? (
          <div className="card text-center py-10">
            <p className="text-3xl mb-2">🍾</p>
            <p className="text-sm text-s112-muted mb-1">Noch keine Füllungen angelegt.</p>
            <p className="text-xs text-s112-muted">
              Füllungen werden im Kellerbuch unter{' '}
              <Link href="/weinhandel/fuellungen/neu" className="text-s112-teal hover:underline">Neue Füllung</Link>{' '}
              angelegt.
            </p>
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
                  const gesamt     = f.anzahl_flaschen  ?? 0
                  const preis      = f.vk_preis_brutto  ?? null
                  const lagerwert  = preis != null ? bestand * preis : null
                  const pct        = gesamt > 0 ? Math.round((bestand / gesamt) * 100) : 0
                  const bestandClr = pct > 50 ? 'text-green-700' : pct > 20 ? 'text-orange-600' : 'text-red-600'

                  return (
                    <tr key={f.id}
                      className={`border-b border-s112-border last:border-0 hover:bg-s112-bg/50 transition-colors ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {f.name}{f.bezeichnung ? ` – ${f.bezeichnung}` : ''}
                        </div>
                        <div className="text-xs text-s112-muted mt-0.5 flex gap-2">
                          {f.jahrgang   && <span>{f.jahrgang}</span>}
                          {f.rebsorte   && <span>{f.rebsorte}</span>}
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
                        <span className={`font-semibold tabular-nums ${bestandClr}`}>
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
      </section>

      {/* ── Tankverkauf ─────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-semibold text-gray-800">🚚 Tankverkauf (Direktverkauf ab Keller)</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
            Transportschein erforderlich
          </span>
        </div>
        <p className="text-xs text-s112-muted mb-3">
          Ungefüllter Wein kann direkt ab Tank verkauft werden. Für den LKW-Transport ist ein
          Transportschein (Begleitdokument) auszustellen.
        </p>

        {tanks.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-sm text-s112-muted">
              Keine Chargen im Status „Ausbau" oder „Abfüllung" vorhanden.
            </p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Charge</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">JG</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Rebsorte</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Behälter</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700">Liter</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700"></th>
                </tr>
              </thead>
              <tbody>
                {tanks.map((t: R, i: number) => {
                  const st = STATUS_VERKAUF[t.status] ?? { label: t.status, color: 'bg-gray-100 text-gray-600' }
                  return (
                    <tr key={t.id}
                      className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                      <td className="px-4 py-3 text-s112-muted">{t.jahrgang ?? '–'}</td>
                      <td className="px-4 py-3 text-s112-muted">{t.rebsorte ?? '–'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-s112-muted">
                        {(t.behaelter as R | null)?.name ?? '–'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-s112-teal">
                        {t.menge_liter ? t.menge_liter.toLocaleString('de-AT') : '–'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-s112-muted italic">
                          Verkauf folgt
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  )
}
