// Öffentliche Weinpass-Seite: /w/[weinpass_code] (KAN-92), alte Etiketten /w/[chargennummer]
// Keine Authentifizierung erforderlich – nur öffentlich freigegebene Daten

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Sprout } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum } from '@/lib/format'
import { qualitaetText } from '@/lib/weinqualitaet'
import { format as formatMostgewicht } from '@/lib/wein/mostgewicht'
import { mostgewichtAusGespeichert } from '@/lib/wein/mostgewichtFormular'
import { ladeMostgewichtEinheit } from '@/lib/tenant/kopf'
import { istWeinpassCode } from '@/lib/handel/losnummer'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ charge: string }> }): Promise<Metadata> {
  const { charge } = await params
  return { title: istWeinpassCode(decodeURIComponent(charge)) ? 'Weinpass – software:112' : `Weinpass ${decodeURIComponent(charge)} – software:112` }
}

export default async function WeinpassPage({ params }: { params: Promise<{ charge: string }> }) {
  const { charge } = await params
  const schluessel = decodeURIComponent(charge)
  // Öffentliche Seite ohne Login (QR-Code auf der Flasche) -> Service-Role-Client nötig, da die einzige
  // RLS-SELECT-Policy auf fuellungen eine eingeloggte Tenant-Mitgliedschaft verlangt. Es gibt hier bewusst KEINE
  // tenant_id-Filterung (kein aktiver Mandant auf einer öffentlichen, unangemeldeten Seite) – siehe
  // check-tenant-isolation.js TENANT_FILTER_MISSING für diese Zeilen.
  //
  // KAN-92 (07.10.2026): Neue QR-Codes führen auf /w/<weinpass_code> – zufällig und global eindeutig. Alte Etiketten
  // mit /w/<chargennummer> gehen weiter, aber die Chargennummer ist nur je Betrieb eindeutig: bei mehr als einem Treffer
  // (Nummer in mehreren Betrieben) zeigt die Seite einen Hinweis statt (möglicherweise) fremder Daten.
  const supabase = createSupabaseAdminClient()
  const SPALTEN = `
      chargennummer, pruefnummer, name, jahrgang, rebsorte, qualitaet, zusatzbezeichnung, erzeugnis,
      anbaugebiet, bezeichnung, datum, flaschengroesse_ml, anzahl_flaschen,
      weinausbau_id, tenant_id
    `
  let fuellungRaw: R | null = null
  if (istWeinpassCode(schluessel)) {
    // tenant-isolation-ignore: oeffentliche, unangemeldete Seite ohne aktiven Mandanten – Code global eindeutig (UNIQUE)
    const { data } = await (supabase.from('fuellungen') as R)
      .select(SPALTEN)
      .eq('weinpass_code', schluessel)
      .maybeSingle()
    fuellungRaw = (data ?? null) as R | null
  }
  if (!fuellungRaw) {
    // tenant-isolation-ignore: oeffentliche, unangemeldete Seite ohne aktiven Mandanten – alte URL, nur bei eindeutigem Treffer
    const { data } = await (supabase.from('fuellungen') as R)
      .select(SPALTEN)
      .eq('chargennummer', schluessel)
      .limit(2)
    const treffer = (data ?? []) as R[]
    if (treffer.length > 1) return <WeinpassMehrdeutig nummer={schluessel} />
    fuellungRaw = treffer[0] ?? null
  }

  if (!fuellungRaw) notFound()
  const f = fuellungRaw as R

  // Weingärten aus Pressung laden
  let weingaerten: R[] = []
  if (f.weinausbau_id) {
    const { data: pbRaw } = await (supabase.from('pressung_behaelter') as any)
      .select(`
        pressung:pressung_id(
          datum, storniert_am,
          pressung_weingaerten(
            trauben_kg, rebsorte, ernte_datum, kmw, oechsle, mostgewicht_einheit, storniert_am,
            weingarten:weingarten_id(name, flaeche_ha)
          )
        )
      `)
      .eq('weinausbau_id', f.weinausbau_id)
      .is('storniert_am', null)

    weingaerten = ((pbRaw ?? []) as R[])
      .flatMap((pb: R) => (pb.pressung?.pressung_weingaerten ?? []) as R[])
      .filter((wg: R) => wg.weingarten)
  }

  // KAN-131: Mostgewicht mit beiden Werten in der bevorzugten Einheit des Betriebs; ohne Pressung das der Charge
  // (Zukauf, Eröffnungsbestand). Die Charge gehört zum selben Betrieb wie die Füllung.
  const einheit = f.tenant_id ? await ladeMostgewichtEinheit(String(f.tenant_id)) : 'kmw'
  const mgText = (z: R | null | undefined) => formatMostgewicht(mostgewichtAusGespeichert(z ? { kmw: z.kmw, oechsle: z.oechsle, einheit: z.mostgewicht_einheit } : null), einheit)
  let chargeMostgewicht = ''
  if (f.weinausbau_id && weingaerten.length === 0 && f.tenant_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- öffentliche Seite: Charge der Füllung, auf deren Betrieb eingeschränkt
    const { data: waRaw } = await (supabase.from('weinausbau') as any)
      .select('kmw, oechsle, mostgewicht_einheit').eq('id', f.weinausbau_id).eq('tenant_id', f.tenant_id).maybeSingle()
    chargeMostgewicht = mgText(waRaw as R | null)
  }

  // Kurzbezeichnungen aus lib/weinqualitaet (alle Stufen der Füllung, KAN-73: auch „Wein“ und „Ausbruch“);
  // KAN-186: samt Zusatzbezeichnung und Erzeugnis („Qualitätswein Reserve“, „Sekt g.U. (Qualitätswein)“)

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl overflow-hidden">

        {/* Header */}
        <div className="bg-[#4F86D6] px-6 py-5 text-white text-center">
          <p className="text-[11px] uppercase tracking-widest text-white/80 font-semibold mb-1">Weinpass</p>
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
              <span className="font-semibold text-s112-text">{qualitaetText(f)}</span>
            </div>
          )}
          {chargeMostgewicht && (
            <div className="flex justify-between text-sm">
              <span className="text-s112-text-2">Mostgewicht</span>
              <span className="font-semibold text-s112-text">{chargeMostgewicht}</span>
            </div>
          )}
          {f.datum && (
            <div className="flex justify-between text-sm">
              <span className="text-s112-text-2">Abgefüllt</span>
              <span className="font-semibold text-s112-text">{new Date(f.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}</span>
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
            <span className="font-mono text-xs bg-[#F2F3F5] px-2 py-0.5 rounded-sm text-s112-text-1">{f.chargennummer}</span>
          </div>
          {f.pruefnummer && (
            <div className="flex justify-between text-sm">
              <span className="text-s112-text-2">Prüfnummer</span>
              <span className="font-mono text-xs bg-[#F2F3F5] px-2 py-0.5 rounded-sm text-s112-text-1">{f.pruefnummer}</span>
            </div>
          )}
        </div>

        {/* Herkunft / Weingärten */}
        {weingaerten.length > 0 && (
          <div className="px-6 pb-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-s112-tertiary">Herkunft</p>
            {weingaerten.map((wg: R, i: number) => (
              <div key={i} className="bg-s112-bg rounded-xl p-3 space-y-1">
                <p className="text-sm font-semibold text-[#4F86D6] flex items-center gap-1">
                  <Sprout className="w-3.5 h-3.5" aria-hidden="true" />
                  {(wg.weingarten as R).name}
                </p>
                <div className="flex flex-wrap gap-x-3 text-xs text-s112-text-2">
                  {wg.trauben_kg && <span>{fmtNum(parseFloat(wg.trauben_kg))} kg</span>}
                  {wg.ernte_datum && <span>{new Date(wg.ernte_datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}</span>}
                  {mgText(wg) && <span>{mgText(wg)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="px-6 pb-6 text-center">
          <p className="text-[11px] text-s112-tertiary">Powered by software:112</p>
        </div>
      </div>
    </div>
  )
}

/** KAN-92: alte Weinpass-URL mit einer Chargennummer, die es in mehreren Betrieben gibt – keine fremden Daten zeigen */
function WeinpassMehrdeutig({ nummer }: { nummer: string }) {
  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-6 text-center space-y-2">
        <p className="text-[11px] uppercase tracking-widest text-s112-muted font-semibold">Weinpass</p>
        <h1 className="text-lg font-semibold text-s112-text">Charge {nummer} nicht eindeutig</h1>
        <p className="text-sm text-s112-text-2">
          Diese Chargennummer gibt es bei mehreren Weingütern. Bitte den QR-Code eines neueren Etiketts verwenden oder
          beim Weingut nachfragen.
        </p>
      </div>
    </div>
  )
}
