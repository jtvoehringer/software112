// Öffentliche Weinpass-Seite: /w/[chargennummer]
// Keine Authentifizierung erforderlich – nur öffentlich freigegebene Daten

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ charge: string }> }): Promise<Metadata> {
  const { charge } = await params
  return { title: `Weinpass ${decodeURIComponent(charge)} – software:112` }
}

export default async function WeinpassPage({ params }: { params: Promise<{ charge: string }> }) {
  const { charge } = await params
  const chargennummer = decodeURIComponent(charge)
  // Öffentliche Seite ohne Login (QR-Code auf der Flasche) -> Service-Role-Client nötig,
  // da die einzige RLS-SELECT-Policy auf fuellungen eine eingeloggte Tenant-Mitgliedschaft
  // verlangt und für anonyme Besucher sonst immer 0 Zeilen liefert.
  const supabase = createSupabaseAdminClient()

  // Füllung laden (öffentliche Felder)
  const { data: fuellungRaw } = await (supabase.from('fuellungen') as any)
    .select(`
      chargennummer, pruefnummer, name, jahrgang, rebsorte, qualitaet,
      anbaugebiet, bezeichnung, datum, flaschengroesse_ml, anzahl_flaschen,
      weinausbau_id
    `)
    .eq('chargennummer', chargennummer)
    .limit(1)
    .single()

  if (!fuellungRaw) notFound()
  const f = fuellungRaw as R

  // Weingärten aus Pressung laden
  let weingaerten: R[] = []
  if (f.weinausbau_id) {
    const { data: pbRaw } = await (supabase.from('pressung_behaelter') as any)
      .select(`
        pressung:pressung_id(
          datum,
          pressung_weingaerten(
            trauben_kg, rebsorte, ernte_datum, kmw,
            weingarten:weingarten_id(name, flaeche_ha)
          )
        )
      `)
      .eq('weinausbau_id', f.weinausbau_id)

    weingaerten = ((pbRaw ?? []) as R[])
      .flatMap((pb: R) => (pb.pressung?.pressung_weingaerten ?? []) as R[])
      .filter((wg: R) => wg.weingarten)
  }

  const qualitaetLabels: Record<string, string> = {
    qualitaetswein: 'Qualitätswein', kabinett: 'Kabinett', spaetlese: 'Spätlese',
    auslese: 'Auslese', beerenauslese: 'Beerenauslese',
    trockenbeerenauslese: 'Trockenbeerenauslese', eiswein: 'Eiswein',
    strohwein: 'Strohwein', dac: 'DAC', reserve: 'Reservé',
    erste_lage: 'Erste Lage (ÖTW)', grosses_gewachs: 'Großes Gewächs',
    landwein: 'Landwein', sekt: 'Sekt b.A.', perlwein: 'Perlwein', sonstiges: 'Sonstiges',
  }

  return (
    <div className="min-h-screen bg-[#F8F8F3] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">

        {/* Header */}
        <div className="bg-[#025450] px-6 py-5 text-white text-center">
          <p className="text-[10px] uppercase tracking-widest text-[#98C780] font-semibold mb-1">Weinpass</p>
          <h1 className="text-xl font-bold">{f.name}</h1>
          {f.bezeichnung && <p className="text-sm text-[#98C6DD] mt-0.5">{f.bezeichnung}</p>}
          <p className="text-sm text-white/70 mt-2">{f.anbaugebiet}</p>
        </div>

        {/* Hauptdaten */}
        <div className="px-6 py-5 space-y-3">
          {f.jahrgang && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Jahrgang</span>
              <span className="font-semibold text-gray-900">{f.jahrgang}</span>
            </div>
          )}
          {f.rebsorte && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Rebsorte</span>
              <span className="font-semibold text-gray-900">{f.rebsorte}</span>
            </div>
          )}
          {f.qualitaet && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Qualität</span>
              <span className="font-semibold text-gray-900">{qualitaetLabels[f.qualitaet] ?? f.qualitaet}</span>
            </div>
          )}
          {f.datum && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Abgefüllt</span>
              <span className="font-semibold text-gray-900">{new Date(f.datum).toLocaleDateString('de-AT')}</span>
            </div>
          )}
          {f.flaschengroesse_ml && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Flaschengröße</span>
              <span className="font-semibold text-gray-900">{f.flaschengroesse_ml} ml</span>
            </div>
          )}

          {/* Chargennummer */}
          <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-sm">
            <span className="text-gray-500">Chargennummer</span>
            <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">{f.chargennummer}</span>
          </div>
          {f.pruefnummer && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Prüfnummer</span>
              <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">{f.pruefnummer}</span>
            </div>
          )}
        </div>

        {/* Herkunft / Weingärten */}
        {weingaerten.length > 0 && (
          <div className="px-6 pb-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Herkunft</p>
            {weingaerten.map((wg: R, i: number) => (
              <div key={i} className="bg-[#F8F8F3] rounded-xl p-3 space-y-1">
                <p className="text-sm font-semibold text-[#025450]">🌿 {(wg.weingarten as R).name}</p>
                <div className="flex flex-wrap gap-x-3 text-xs text-gray-500">
                  {wg.trauben_kg && <span>🍇 {parseFloat(wg.trauben_kg).toLocaleString('de-AT')} kg</span>}
                  {wg.ernte_datum && <span>📅 {new Date(wg.ernte_datum).toLocaleDateString('de-AT')}</span>}
                  {wg.kmw && <span>⚖️ {wg.kmw} °KMW</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-6 pb-6 text-center">
          <p className="text-[10px] text-gray-300">Powered by software:112</p>
        </div>
      </div>
    </div>
  )
}
