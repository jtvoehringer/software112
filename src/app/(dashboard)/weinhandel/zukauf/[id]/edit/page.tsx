import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import ZukaufEditForm from './ZukaufEditForm'
import { folgebuchungenDerZielcharge, zielchargeText, zukaufVerweise, traubenGebundenText } from '../../sperren'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function ZukaufEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) notFound()

  const { data } = await (supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, art, menge, einheit, preis_gesamt, einstandspreis_pro_liter,
      rebsorte, jahrgang, notizen, weinart, eingangsrechnungsnummer,
      lieferung_uhrzeit, transport_zugmaschine, transport_anhaenger1, transport_anhaenger2,
      herkunft, anreicherung, kmw, oechsle, mostgewicht_einheit, alkohol_pct, qualitaetsstufe, staatliche_pruefnummer,
      lieferant_kontakt_id, lieferant_firma_id, ziel_weinausbau_id,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(id, vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(id, name),
      ziel_weinausbau:weinausbau!ziel_weinausbau_id(behaelter_id, weinart, menge_liter)
    `)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .single()

  if (!data) notFound()
  const z = data as R

  // Hängen an der verknüpften Kellerbuch-Charge bereits Folgebuchungen (Umzug, Schwund,
  // Verschnitt, Füllung, Tankverkauf, Behandlung, Analyse, DAC – KAN-35, siehe sperren.ts)?
  // Dann sind Menge, Einheit, Gebinde und Art gesperrt (updateZukauf prüft das ebenso).
  // WICHTIG: eine Kellerbuch-Charge behält ihre behaelter_id NIE über einen
  // Umzug hinweg - beim Umziehen wird die
  // Ursprungscharge nur reduziert/deaktiviert, der Wein landet in einer ANDEREN
  // weinausbau-Zeile im Zielgebinde (siehe kellerbuch/umziehen/actions.ts). D.h.
  // sobald hatBewegungen true ist, kann diese Seite NICHT mehr zuverlässig
  // sagen, wo der Wein aus diesem Zukauf gerade tatsächlich steht (dafür müsste
  // man der keller_umzuege/Verschneidungs-Historie folgen, ggf. über mehrere
  // Stationen und mit Vermischung anderer Chargen). Die Gebinde-Vorschau im
  // Formular zeigt deshalb in diesem Fall bewusst nur noch den UNVERÄNDERLICHEN
  // ursprünglichen Zugang (Behälter + Menge zum Zeitpunkt der Befüllung) plus
  // einen Hinweis, den aktuellen Bestand im Kellerbuch nachzusehen - siehe
  // ZukaufEditForm.tsx.
  const zielWeinausbauId: string | null = z.ziel_weinausbau_id ?? null
  const [folge, verweise] = await Promise.all([
    zielWeinausbauId ? folgebuchungenDerZielcharge(supabase, zielWeinausbauId) : Promise.resolve([]),
    zukaufVerweise(supabase, z.id, tenantId),
  ])
  const hatBewegungen = folge.length > 0

  return (
    <ZukaufEditForm
      id={z.id}
      initial={{
        datum:                    z.datum,
        art:                      z.art,
        lieferant_kontakt_id:     z.lieferant_kontakt_id ?? '',
        lieferant_firma_id:       z.lieferant_firma_id   ?? '',
        eingangsrechnungsnummer: z.eingangsrechnungsnummer ?? '',
        menge:                    String(z.menge ?? ''),
        einheit:                  z.einheit ?? 'L',
        preis_gesamt:             z.preis_gesamt != null ? String(z.preis_gesamt) : '',
        einstandspreis_pro_liter: z.einstandspreis_pro_liter != null ? String(z.einstandspreis_pro_liter) : '',
        rebsorte:                 z.rebsorte   ?? '',
        jahrgang:                 z.jahrgang   != null ? String(z.jahrgang) : '',
        ziel_behaelter_id:        (z.ziel_weinausbau as R | null)?.behaelter_id ?? '',
        ziel_weinausbau_id:       z.ziel_weinausbau_id ?? '',
        weinart:                  z.weinart ?? (z.ziel_weinausbau as R | null)?.weinart ?? 'unbekannt',
        notizen:                  z.notizen ?? '',
        lieferung_uhrzeit:        z.lieferung_uhrzeit ?? '',
        transport_zugmaschine:    z.transport_zugmaschine ?? '',
        transport_anhaenger1:     z.transport_anhaenger1 ?? '',
        transport_anhaenger2:     z.transport_anhaenger2 ?? '',
        herkunft:                 z.herkunft ?? '',
        anreicherung:             z.anreicherung ?? false,
        mostgewicht:              z.kmw != null || z.oechsle != null ? { kmw: z.kmw, oechsle: z.oechsle, einheit: z.mostgewicht_einheit } : null,
        alkohol_pct:              z.alkohol_pct != null ? String(z.alkohol_pct) : '',
        qualitaetsstufe:          z.qualitaetsstufe ?? '',
        staatliche_pruefnummer:   z.staatliche_pruefnummer ?? '',
      }}
      hatBewegungen={hatBewegungen}
      sperrHinweis={hatBewegungen ? zielchargeText(folge) : null}
      traubenGebunden={{
        kg:   verweise.verpresstKg + verweise.verkauftKg,
        text: traubenGebundenText(verweise),
      }}
      eigeneAktuelleMenge={Number((z.ziel_weinausbau as R | null)?.menge_liter ?? 0) || 0}
      lieferantName={
        z.lieferant_kontakt
          ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
          : z.lieferant_firma?.name ?? ''
      }
    />
  )
}
