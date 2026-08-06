import { createSupabaseServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ZukaufEditForm from './ZukaufEditForm'
import { pruefeChargeHatBewegungen } from '../../actions'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function ZukaufEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data } = await (supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, art, menge, einheit, preis_gesamt, einstandspreis_pro_liter,
      rebsorte, jahrgang, notizen, weinart, eingangsrechnungsnummer,
      lieferung_uhrzeit, transport_zugmaschine, transport_anhaenger1, transport_anhaenger2,
      herkunft, anreicherung, kmw, alkohol_pct, qualitaetsstufe, staatliche_pruefnummer,
      lieferant_kontakt_id, lieferant_firma_id, ziel_weinausbau_id,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(id, vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(id, name),
      ziel_weinausbau:weinausbau!ziel_weinausbau_id(behaelter_id, weinart, menge_liter)
    `)
    .eq('id', id)
    .eq('aktiv', true)
    .single()

  if (!data) notFound()
  const z = data as R

  // Wurde gegen die verknüpfte Kellerbuch-Charge bereits etwas gebucht (Verkauf,
  // Umzug, Abfüllung, Verschnitt)? Falls ja, aktualisiert updateZukauf die Charge
  // beim Speichern nur per DIFFERENZ zur ursprünglichen Zukaufsmenge (der bereits
  // verbrauchte/verkaufte Anteil bleibt erhalten) statt sie vollständig zu
  // ersetzen - die Gebinde-Vorschau im Formular muss dieses Verhalten kennen,
  // um "Inhalt jetzt"/"Rest nach Zukauf" korrekt zu simulieren (siehe
  // ZukaufEditForm.tsx).
  const zielWeinausbauId: string | null = z.ziel_weinausbau_id ?? null
  const hatBewegungen = zielWeinausbauId
    ? await pruefeChargeHatBewegungen(zielWeinausbauId)
    : false
  const eigeneAktuelleMenge: number = (z.ziel_weinausbau as R | null)?.menge_liter != null
    ? Number((z.ziel_weinausbau as R | null)?.menge_liter)
    : 0

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
        kmw:                      z.kmw != null ? String(z.kmw) : '',
        alkohol_pct:              z.alkohol_pct != null ? String(z.alkohol_pct) : '',
        qualitaetsstufe:          z.qualitaetsstufe ?? '',
        staatliche_pruefnummer:   z.staatliche_pruefnummer ?? '',
      }}
      hatBewegungen={hatBewegungen}
      eigeneAktuelleMenge={eigeneAktuelleMenge}
      lieferantName={
        z.lieferant_kontakt
          ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
          : z.lieferant_firma?.name ?? ''
      }
    />
  )
}
