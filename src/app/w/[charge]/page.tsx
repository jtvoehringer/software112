// Öffentliche Weinpass-Seite: /w/[chargennummer]
// Keine Authentifizierung erforderlich – nur öffentlich freigegebene Daten

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Sprout } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'

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
  // verlangt und für anonyme Besucher sonst immer 0 Zeilen liefert. Es gibt hier bewusst
  // KEINE tenant_id-Filterung (kein aktiver Mandant auf einer öffentlichen, unangemeldeten
  // Seite) - siehe check-tenant-isolation.js TENANT_FILTER_MISSING für diese Zeile.
  //
  // WICHTIG: chargennummer ist NUR pro Mandant eindeutig (auto-vergeben über
  // get_next_chargennummer(), Muster z.B. "CH-2025-001" mit pro Mandant konfigurierbarem,
  // aber standardmäßig identischem Prefix "CH") - KEINE globale Eindeutigkeit über alle
  // Mandanten hinweg garantiert. Zwei Mandanten mit Standardeinstellungen können also exakt
  // dieselbe Chargennummer vergeben. .limit(1) VOR .single() würde eine solche Kollision
  // still verdecken und irgendeine der mehreren passenden Zeilen (ggf. eines FREMDEN
  // Mandanten) anzeigen. Deshalb bewusst OHNE .limit(1): .single() liefert dann bei mehr
  // als einer Trefferzeile einen Fehler statt einer beliebigen Zeile, und die Seite zeigt
  // "nicht gefunden" statt (möglicherweise) fremder Daten. Löst NICHT das zugrunde liegende
  // Produktproblem (chargennummer sollte langfristig global eindeutig sein, z.B. über eine
  // UUID-basierte oder mandanten-präfigierte Weinpass-URL) - das braucht eine bewusste
  // Entscheidung, siehe Rückmeldung an den Nutzer.
  const supabase = createSupabaseAdminClient()

  // Füllung laden (öffentliche Felder)
  // tenant-isolation-ignore: oeffentliche, unangemeldete Seite ohne aktiven Mandanten - siehe Kommentar oben
  const { data: fuellungRaw } = await (supabase.from('fuellungen') as any)
    .select(`
      chargennummer, pruefnummer, name, jahrgang, rebsorte, qualitaet,
      anbaugebiet, bezeichnung, datum, flaschengroesse_ml, anzahl_flaschen,
      weinausbau_id
    `)
    .eq('chargennummer', chargennummer)
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
    <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl overflow-hidden">

        {/* Header */}
        <div className="bg-[#4F86D6] px-6 py-5 text-white text-center">
          <p className="text-[10px] uppercase tracking-widest text-white/80 font-semibold mb-1">Weinpass</p>
          <h1 className="text-xl font-semibold">{f.name}</h1>
          {f.bezeichnung && <p className="text-sm text-white/85 mt-0.5">{f.bezeichnung}</p>}
          <p className="text-sm text-white/70 mt-2">{f.anbaugebiet}</p>
        </div>

        {/* Hauptdaten */}
        <div className="px-6 py-5 space-y-3">
          {f.jahrgang && (
            <div className="flex justify-between text-sm">
              <span className="text-s112-text-2">Jahrgang</span>
              <span className="font-semibold text-s112-text">{f.jahrgang}</span>
            </div>
          )}
          {f.rebsorte && (
            <div className="flex justify-between text-sm">
              <span className="text-s112-text-2">Rebsorte</span>
              <span className="font-semibold text-s112-text">{formatRebsorteMitKuerzel(f.rebsorte)}</span>
            </div>
          )}
          {f.qualitaet && (
            <div className="flex justify-between text-sm">
              <span className="text-s112-text-2">Qualität</span>
              <span className="font-semibold text-s112-text">{qualitaetLabels[f.qualitaet] ?? f.qualitaet}</span>
            </div>
          )}
          {f.datum && (
            <div className="flex justify-between text-sm">
              <span className="text-s112-text-2">Abgefüllt</span>
              <span className="font-semibold text-s112-text">{new Date(f.datum).toLocaleDateString('de-AT')}</span>
            </div>
          )}
          {f.flaschengroesse_ml && (
            <div className="flex justify-between text-sm">
              <span className="text-s112-text-2">Flaschengröße</span>
              <span className="font-semibold text-s112-text">{f.flaschengroesse_ml} ml</span>
            </div>
          )}

          {/* Chargennummer */}
          <div className="mt-3 pt-3 border-t border-s112-line flex justify-between text-sm">
            <span className="text-s112-text-2">Chargennummer</span>
            <span className="font-mono text-xs bg-[#F2F3F5] px-2 py-0.5 rounded text-s112-text-1">{f.chargennummer}</span>
          </div>
          {f.pruefnummer && (
            <div className="flex justify-between text-sm">
              <span className="text-s112-text-2">Prüfnummer</span>
              <span className="font-mono text-xs bg-[#F2F3F5] px-2 py-0.5 rounded text-s112-text-1">{f.pruefnummer}</span>
            </div>
          )}
        </div>

        {/* Herkunft / Weingärten */}
        {weingaerten.length > 0 && (
          <div className="px-6 pb-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-s112-tertiary">Herkunft</p>
            {weingaerten.map((wg: R, i: number) => (
              <div key={i} className="bg-[#F7F8FA] rounded-xl p-3 space-y-1">
                <p className="text-sm font-semibold text-[#4F86D6] flex items-center gap-1">
                  <Sprout className="w-3.5 h-3.5" aria-hidden="true" />
                  {(wg.weingarten as R).name}
                </p>
                <div className="flex flex-wrap gap-x-3 text-xs text-s112-text-2">
                  {wg.trauben_kg && <span>{parseFloat(wg.trauben_kg).toLocaleString('de-AT')} kg</span>}
                  {wg.ernte_datum && <span>{new Date(wg.ernte_datum).toLocaleDateString('de-AT')}</span>}
                  {wg.kmw && <span>{wg.kmw} °KMW</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-6 pb-6 text-center">
          <p className="text-[10px] text-s112-tertiary">Powered by software:112</p>
        </div>
      </div>
    </div>
  )
}
