import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { qualitaetLabel } from '@/lib/wein/qualitaet'

export const metadata: Metadata = { title: 'Weinetikett – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const DAC_REGION_LABEL: Record<string, string> = {
  weinviertel: 'Weinviertel DAC', kamptal: 'Kamptal DAC', kremstal: 'Kremstal DAC',
  wachau: 'Wachau', wagram: 'Wagram DAC', traisental: 'Traisental DAC',
  carnuntum: 'Carnuntum DAC', leithaberg: 'Leithaberg DAC',
  neusiedlersee: 'Neusiedlersee DAC', mittelburgenland: 'Mittelburgenland DAC',
  eisenberg: 'Eisenberg DAC', rosalia: 'Rosalia DAC',
  wiener_gemischter_satz: 'Wiener Gemischter Satz DAC', sonstiges: 'Österreich',
}

function fmtMenge(liter: number | null): string {
  if (!liter) return '–'
  if (liter < 1) return `${(liter * 1000).toFixed(0)} ml`
  return `${liter.toFixed(2).replace('.', ',')} L`
}

export default async function EtikettPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const [{ data: rows }, { data: settingsRaw }] = await Promise.all([
    (supabase.from('dac_antrag') as any)
      .select('id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status, pruefnummer, bescheid_am')
      .eq('id', id).limit(1),
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url')
      .limit(1).maybeSingle(),
  ])

  const dac = (((rows ?? []) as R[])[0] ?? null) as R | null
  if (!dac) notFound()

  const s = (settingsRaw as R | null) ?? {}

  const regionLabel = DAC_REGION_LABEL[dac.dac_region] ?? dac.dac_region

  return (
    <div className="max-w-2xl space-y-6">

      {/* Breadcrumb + Aktionen (ausgeblendet beim Drucken) */}
      <div className="flex items-center justify-between print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/dac" className="hover:text-s112-teal">Prüfnummern</Link>
          <span>/</span>
          <Link href={`/dac/${id}`} className="hover:text-s112-teal">{dac.bezeichnung}</Link>
          <span>/</span>
          <span className="text-gray-700 font-medium">Etikett</span>
        </nav>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90"
        >
          🖨 Drucken / Als PDF speichern
        </button>
      </div>

      {/* Hinweis wenn noch keine Prüfnummer */}
      {!dac.pruefnummer && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 print:hidden">
          ⚠ Noch keine Prüfnummer vergeben – Etikett enthält Platzhalterdaten. Bitte erst nach Genehmigung drucken.
        </div>
      )}

      {/* ── ETIKETT-VORSCHAU ──────────────────────────────────────────────── */}
      <div className="card border-2 border-s112-border p-8 space-y-6 print:border-0 print:shadow-none print:p-0">

        {/* Kopfzeile: Logo + Weingut */}
        <div className="flex items-start justify-between border-b border-s112-border pb-5">
          <div>
            {s.logo_url && (
              <Image
                src={s.logo_url}
                alt={s.betrieb_name ?? 'Weingut'}
                width={160} height={50}
                className="object-contain object-left max-h-12 w-auto mb-2"
              />
            )}
            {s.betrieb_name && (
              <p className="text-base font-bold text-gray-900">{s.betrieb_name}</p>
            )}
            {(s.betrieb_strasse || s.betrieb_plz || s.betrieb_ort) && (
              <p className="text-sm text-gray-600">
                {[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
              </p>
            )}
            {s.betrieb_uid && (
              <p className="text-xs text-gray-400 mt-0.5">UID: {s.betrieb_uid}</p>
            )}
          </div>
          {dac.pruefnummer && (
            <div className="text-right">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Prüfnummer</p>
              <p className="text-2xl font-bold text-s112-teal font-mono mt-0.5">{dac.pruefnummer}</p>
              {dac.bescheid_am && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Bescheid: {new Date(dac.bescheid_am).toLocaleDateString('de-AT')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Weinbezeichnung */}
        <div className="text-center py-4 border-b border-s112-border">
          <p className="text-3xl font-bold text-gray-900 tracking-tight">{dac.bezeichnung}</p>
          {dac.jahrgang && (
            <p className="text-xl text-gray-600 mt-1">{dac.jahrgang}</p>
          )}
          <p className="text-base font-semibold text-s112-teal mt-2">{regionLabel}</p>
        </div>

        {/* Pflichtangaben Grid */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          {[
            ['Rebsorte', dac.rebsorte ?? '–'],
            ['Qualitätsstufe', 'DAC – Qualitätswein bestimmter Herkunft'],
            ['Alkohol', dac.alkohol_prozent ? `${String(dac.alkohol_prozent).replace('.', ',')} % vol.` : '–'],
            ['Füllmenge', fmtMenge(dac.menge_liter)],
            ['Herkunft', 'Österreich'],
            ['Enthält', 'Sulfite'],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-gray-900 mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* Fußzeile */}
        <div className="border-t border-s112-border pt-4 flex items-end justify-between">
          <div>
            <p className="text-xs text-gray-400">Erzeuger &amp; Abfüller</p>
            <p className="text-sm font-medium text-gray-700">
              {s.betrieb_name ?? '–'}
              {s.betrieb_ort ? `, ${s.betrieb_ort}` : ''}
              , Österreich
            </p>
          </div>
          <p className="text-xs text-gray-300">software:112</p>
        </div>
      </div>

      {/* Druckhinweis */}
      <p className="text-xs text-s112-muted text-center print:hidden">
        Pflichtangaben gemäß EU-Weinetikettierungsverordnung (VO 2019/33). Vor dem Druck bitte rechtliche Prüfung durch den Erzeuger.
      </p>

    </div>
  )
}
