import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { createFuellung } from '../../actions'
import { ladeCustomWeinbaugebiete } from '../../../weinbaugebiete/actions'
import FuellungFormClient from './FuellungFormClient'
import { losnummerVorschau } from '@/lib/handel/losnummer'
import { wienHeute } from '@/lib/csv'
import { pruefnummerGueltig, pruefnummerHinweis, waehlbareAntraege, type PnChargeDaten } from '@/lib/kellerbuch/pruefnummer'
import { ladePruefnummerDaten } from '@/lib/kellerbuch/pruefnummerLaden'
import { ladeZusammensetzungCharge } from '@/lib/wein/blendKomposition'
import { sortenAnteile, type GruppenAnteil } from '@/lib/wein/mischungsrechnung'
import { istSortenverschnitt } from '@/lib/wein/sortenangabe'

export const metadata: Metadata = { title: 'Neue Füllung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function NeueFuellungPage({
  searchParams,
}: {
  searchParams: Promise<{ charge?: string; lohnversektung?: string }>
}) {
  const role = await getCurrentUserRole()
  if (!canWrite(role, 'warenwirtschaft')) redirect('/weinhandel')

  const { charge: chargeParam, lohnversektung: lvParam } = await searchParams
  let chargeId = chargeParam
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // KAN-232: Rückkehr aus der Lohnversektung – Charge = versandter Grundwein, nur bei offenem Versand
  let lohnversektung: { id: string; firma: string | null; datum: string; literVersandt: number } | null = null
  if (lvParam && tenantId) {
    // storno-sichtbar: Einzelzeile per ID – storniert_am wird geprüft bzw. die Folgeaktion lehnt Stornos ab
    const lv = geladen(await (supabase.from('lohnversektungen') as R)
      .select('id, weinausbau_id, datum, liter_versandt, storniert_am, abgeschlossen_am, firma:firmen!firma_id(name)')
      .eq('id', lvParam).eq('tenant_id', tenantId).maybeSingle(), 'Lohnversektungen')
    const l = lv as R | null
    if (l && !l.storniert_am && !l.abgeschlossen_am) {
      lohnversektung = { id: l.id, firma: l.firma?.name ?? null, datum: String(l.datum), literVersandt: Number(l.liter_versandt) }
    }
    if (l) chargeId = l.weinausbau_id as string
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Alle aktiven Weinausbau-Chargen + DAC-Anträge parallel laden. KAN-72: keine abgelehnten
  // oder inaktiven Anträge mehr (früher wählbar, samt ihrer Prüfnummer)
  const [chargenRawRes, dacRawRes] = await Promise.all([
  alle(tf((supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, weinart, menge_liter, status, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code')
    .eq('aktiv', true)
    .neq('status', 'abgeschlossen')
    .order('jahrgang', { ascending: false }).order('id'))),
  alle(tf((supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, dac_region, jahrgang, rebsorte, pruefnummer, status, weinausbau_id')
    .eq('aktiv', true)
    .is('storniert_am', null)   // KAN-150 F2: stornierte Anträge nicht wählbar
    .neq('status', 'abgelehnt')
    .order('jahrgang', { ascending: false }).order('id'))),
  ])
  const chargenRaw = geladen(chargenRawRes, 'Chargen')
  const dacRaw = geladen(dacRawRes, 'Prüfnummernanträge')

  const alleAntraege = (dacRaw ?? []) as R[]
  let chargen = (chargenRaw ?? []) as R[]

  // KAN-92: Vorschau der nächsten Los-/Chargennummer (dieselbe Bildung wie get_next_chargennummer)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: nkRaw } = tenantId ? await (supabase.from('tenant_einstellungen') as any)
    .select('charge_prefix, charge_stellen, charge_zaehler').eq('tenant_id', tenantId).maybeSingle() : { data: null }
  const losVorschau = nkRaw ? losnummerVorschau({ prefix: nkRaw.charge_prefix, stellen: nkRaw.charge_stellen, zaehler: nkRaw.charge_zaehler }, Number(wienHeute().slice(0, 4))) : null

  // Eigene, vom Mandanten selbst angelegte Weinbaugebiete (Herkunft-Code-Selbstverwaltung)
  const customWeinbaugebiete = await ladeCustomWeinbaugebiete()

  // Wenn über "Abfüllen"-Button mit chargeId aufgerufen: diese Charge immer mitladen,
  // auch wenn Status 'abgeschlossen' ist (Füllung kann trotzdem angelegt werden)
  if (chargeId && !chargen.find((c: R) => c.id === chargeId)) {
    const extraRaw = geladen(await tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, weinart, menge_liter, status, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code')
      .eq('id', chargeId))
      .maybeSingle(), 'Chargen')
    if (extraRaw) chargen = [extraRaw as R, ...chargen]
  }

  // KAN-72: nur Anträge anbieten, die für den heutigen Bestand der Charge gelten – dieselbe
  // Regel prüft createFuellung (fuellungAntragPruefen: Stand am Buchungstag, bei einem Abfüll-
  // datum bis heute also heute). Für Chargen, deren frühere Prüfnummer nicht (mehr) gilt – auch
  // nur mit inaktiven/abgelehnten Anträgen –, zeigt das Formular den Grund; der Lader liest dafür
  // die Anträge aller angebotenen Chargen.
  const heute = wienHeute()
  const pnDaten = tenantId
    ? await ladePruefnummerDaten(supabase, tenantId, [...chargen.map(c => c.id), ...alleAntraege.map(d => d.weinausbau_id)], { heute })
    : new Map<string, PnChargeDaten>()
  const waehlbar = new Set<string>()
  const pnHinweise: Record<string, string> = {}
  for (const [id, daten] of pnDaten) {
    for (const a of waehlbareAntraege(daten, heute)) waehlbar.add(a)
    const hinweis = pruefnummerHinweis(pruefnummerGueltig(daten, heute))
    if (hinweis) pnHinweise[id] = hinweis
  }
  const dacAntraege = alleAntraege.filter(d => waehlbar.has(d.id))
  // Chargen mit (aktivem, nicht abgelehntem) Antrag: keine freie Prüfnummer-Eingabe
  const chargenMitAntrag = [...new Set(alleAntraege.map(d => d.weinausbau_id).filter(Boolean) as string[])]

  // KAN-113: Sorten (absteigend, Rechenkern KAN-76) der Sortenverschnitt-Chargen – Vorschlag und Prüfung der Sortenangabe
  // im Formular. Begrenzt: die vorgewählte Charge zuerst, dann höchstens 40 (Zusammensetzung je Charge über den Graphen)
  const sortenJeCharge: Record<string, GruppenAnteil[]> = {}
  if (tenantId) {
    const svIds = chargen.filter(c => istSortenverschnitt(c.rebsorte)).map(c => c.id as string)
      .sort((a, b) => (a === chargeId ? -1 : b === chargeId ? 1 : 0)).slice(0, 40)
    await Promise.all(svIds.map(async id => {
      try {
        sortenJeCharge[id] = sortenAnteile((await ladeZusammensetzungCharge(supabase, tenantId, id)).anteile)
      } catch {
        // Komfort – ohne Zusammensetzung bleibt die Rebsorte der Charge
      }
    }))
  }

  return (
    <div className="max-w-2xl">
      <nav className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weinhandel" className="hover:text-s112-blue-700">Weinhandel</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Neue Füllung</span>
      </nav>

      <h1 className="text-2xl font-semibold text-s112-text mb-1">{lohnversektung ? 'Rückkehr aus der Lohnversektung' : 'Neue Füllung anlegen'}</h1>
      <p className="text-sm text-s112-muted mb-6">
        {lohnversektung
          ? 'Der versektete Wein kommt in Flaschen zurück und wird als Artikel im Weinhandel angelegt (Journal LNSKT/LNSKT_ZU).'
          : 'Der Wein verlässt den Keller und wird als verkaufsfertiger Artikel im Weinhandel angelegt.'}
      </p>

      <FuellungFormClient
        chargen={chargen as any}
        dacAntraege={dacAntraege as any}
        chargenMitAntrag={chargenMitAntrag}
        pnHinweise={pnHinweise}
        customWeinbaugebiete={customWeinbaugebiete}
        action={createFuellung}
        defaultChargeId={chargeId}
        lohnversektung={lohnversektung}
        losVorschau={losVorschau}
        sortenJeCharge={sortenJeCharge}
      />
    </div>
  )
}
