import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound, redirect } from 'next/navigation'
import { zukaufArtFehler } from '@/lib/auth/profilGrenzen'
import { KEIN_LESERECHT_ZIEL } from '@/lib/auth/lesen'
import ZukaufEditForm from './ZukaufEditForm'
import { folgebuchungenDerZielcharge, zielchargeText, zukaufVerweise, traubenGebundenText } from '../../sperren'
import { ladeCustomWeinbaugebiete } from '../../../../weinbaugebiete/actions'
import { herkunftVorbelegung } from '@/lib/zukauf/ware'
import { zukaufMerkmaleFest, zukaufMerkmalSperrGrund } from '@/lib/zukauf/merkmalSperre'
import { normalisiereQualitaet } from '@/lib/wein/qualitaetsrang'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Zukauf bearbeiten' }

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function ZukaufEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) notFound()

  const data = geladen(await (supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, art, menge, einheit, preis_gesamt, einstandspreis_pro_liter,
      rebsorte, jahrgang, notizen, weinart, eingangsrechnungsnummer,
      lieferung_uhrzeit, transport_zugmaschine, transport_anhaenger1, transport_anhaenger2, tbs_nummer_lieferant, tbs_jahr_lieferant,
      herkunft, anreicherung, kmw, oechsle, mostgewicht_einheit, alkohol_pct, qualitaetsstufe, zusatzbezeichnung, erzeugnis, land_iso, staatliche_pruefnummer,
      lieferant_kontakt_id, lieferant_firma_id, ziel_weinausbau_id,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(id, vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(id, name),
      ziel_weinausbau:weinausbau!ziel_weinausbau_id(behaelter_id, weinart, menge_liter)
    `)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .maybeSingle(), 'Zukäufe')

  if (!data) notFound()
  const z = data as R
  // KAN-456: Wein/Most bzw. Trauben/Maische nur mit Leserecht auf Kellerbuch bzw. Lese – ohne die Daten wären die
  // Sperren dieser Seite (Folgebuchungen der Charge, verpresst/verkauft) blind bzw. die Seite bräche ab
  if (zukaufArtFehler(membership, z.art)) redirect(KEIN_LESERECHT_ZIEL)

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
  const [folge, verweise, customWeinbaugebiete] = await Promise.all([
    zielWeinausbauId ? folgebuchungenDerZielcharge(supabase, zielWeinausbauId) : Promise.resolve([]),
    zukaufVerweise(supabase, z.id, tenantId),
    ladeCustomWeinbaugebiete(),   // KAN-80 Nachtrag: eigene Weinbaugebiete wie am GST
  ])
  const hatBewegungen = folge.length > 0
  // KAN-351: Merkmale fest – dieselbe Bedingung wie updateZukauf und der Trigger a_freeze; das Formular sperrt die
  // Felder, statt die Änderung erst nach dem Speichern abzulehnen
  const merkmalLage = { art: z.art, zielWeinausbauId, folgebuchungen: folge.length }
  const merkmaleFest = zukaufMerkmaleFest(merkmalLage)
  const merkmalSperrGrund = zukaufMerkmalSperrGrund(merkmalLage)
  // KAN-41 Paket 2b: Weinlager-Artikel des Flaschenzukaufs (je Zukauf höchstens einer)
  let flaschenArtikel: { id: string; name: string; bestand: number } | null = null
  if (z.art === 'flaschen') {
    const fl = geladen(await (supabase.from('fuellungen') as R)
      .select('id, name, bestand_flaschen').eq('tenant_id', tenantId).eq('zukauf_posten_id', z.id).maybeSingle(), 'Füllungen')
    if (fl) flaschenArtikel = { id: String((fl as R).id), name: String((fl as R).name ?? ''), bestand: Number((fl as R).bestand_flaschen) || 0 }
  }

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
        weinart:                  z.weinart ?? (z.ziel_weinausbau as R | null)?.weinart ?? '',
        notizen:                  z.notizen ?? '',
        lieferung_uhrzeit:        z.lieferung_uhrzeit ?? '',
        transport_zugmaschine:    z.transport_zugmaschine ?? '',
        tbs_nummer_lieferant:     z.tbs_nummer_lieferant ?? '',
        tbs_jahr_lieferant:       z.tbs_jahr_lieferant != null ? String(z.tbs_jahr_lieferant) : '',
        transport_anhaenger1:     z.transport_anhaenger1 ?? '',
        transport_anhaenger2:     z.transport_anhaenger2 ?? '',
        // KAN-80 Nachtrag (02.10.2026): Code bzw. eigenes Gebiet unverändert, Freitext-Altwert nur, wenn eindeutig
        herkunft:                 herkunftVorbelegung(z.herkunft, customWeinbaugebiete.map(g => g.name)),
        herkunft_gespeichert:     z.herkunft ?? '',
        anreicherung:             z.anreicherung ?? false,
        mostgewicht:              z.kmw != null || z.oechsle != null ? { kmw: z.kmw, oechsle: z.oechsle, einheit: z.mostgewicht_einheit } : null,
        alkohol_pct:              z.alkohol_pct != null ? String(z.alkohol_pct) : '',
        // KAN-186: Altwerte (reserve, sekt …) → Stufe + Zusatzbezeichnung/Erzeugnis
        qualitaetsstufe:          normalisiereQualitaet(z).stufe ?? '',
        zusatzbezeichnung:        normalisiereQualitaet(z).zusatz ?? '',
        erzeugnis:                normalisiereQualitaet(z).erzeugnis ?? '',
        land_iso:                 z.land_iso ?? 'AT',
        staatliche_pruefnummer:   z.staatliche_pruefnummer ?? '',
      }}
      hatBewegungen={hatBewegungen}
      merkmaleFest={merkmaleFest}
      merkmalSperrGrund={merkmalSperrGrund}
      sperrHinweis={hatBewegungen ? zielchargeText(folge) : null}
      traubenGebunden={{
        kg:   verweise.verpresstKg + verweise.verkauftKg,
        text: traubenGebundenText(verweise),
      }}
      eigeneAktuelleMenge={Number((z.ziel_weinausbau as R | null)?.menge_liter ?? 0) || 0}
      customWeinbaugebiete={customWeinbaugebiete}
      flaschenArtikel={flaschenArtikel}
      lieferantName={
        z.lieferant_kontakt
          ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
          : z.lieferant_firma?.name ?? ''
      }
    />
  )
}
