'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  return membership.tenantId
}

async function createZukaufCharge(
  supabase: any,
  tenantId: string,
  behaelterId: string,
  rebsorte: string | null,
  jahrgang: number | null,
  menge: number,
  einstandspreisProLiter: number | null,
  weinart: string | null,
  qualitaetsstufe: string | null,
): Promise<string> {
  const name = rebsorte || 'Zukauf'
  const { data: neu, error } = await (supabase.from('weinausbau') as any)
    .insert({
      tenant_id:   tenantId,
      name,
      rebsorte:    rebsorte ?? null,
      behaelter_id: behaelterId,
      jahrgang,
      menge_liter:  menge,
      einstandspreis_pro_liter: einstandspreisProLiter ?? null,
      anfangsbestand_liter: null,
      status:      'ausbau',
      aktiv:       true,
      weinart:     weinart ?? 'unbekannt',
      qualitaetsstufe: qualitaetsstufe ?? null,
    })
    .select('id')
    .single()
  if (error) throw new AktionsFehler((error as AR).message)
  return (neu as AR).id
}

// Bugfix 7.8.2026: bereinigCharge() prüfte bisher NUR Umzüge/Füllungen und übersah dabei
// Tank-Verkäufe und Verschneidungen (siehe chargeHatBewegungen() oben, die genau deshalb
// bereits erweitert wurde – aber bereinigCharge() wurde dabei nicht mitgezogen). Wurde ein
// Zukauf gelöscht/bearbeitet, dessen Charge zwischenzeitlich per Tankverkauf oder Verschnitt
// TEILWEISE reduziert wurde (aber nie umgezogen/abgefüllt), landete die Charge fälschlich auf
// "Abgeschlossen", OHNE dass die reale Restmenge auf 0 gesetzt wurde – das Kellerbuch zeigte
// dann eine "abgeschlossene" Charge mit noch vorhandenem Bestand (siehe Klärung 7.8.2026).
// Jetzt: dieselbe vollständige Bewegungsprüfung wie chargeHatBewegungen(). Wurde die Charge
// bereits IRGENDWIE bewegt, bleibt sie unangetastet (der reale Bestand darf hier nicht blind
// genullt werden) – nur eine Charge OHNE jede Bewegung ist eine echte Karteileiche und darf
// sicher geschlossen + auf 0 gesetzt werden.
async function bereinigCharge(supabase: any, weinausbauId: string, tenantId: string): Promise<void> {
  const hatBewegungen = await chargeHatBewegungen(supabase, weinausbauId, tenantId)
  if (hatBewegungen) return
  { const { error: e } = await (supabase.from('weinausbau') as any)
    .update({ menge_liter: 0, status: 'abgeschlossen', aktiv: false })
    .eq('id', weinausbauId)
    .eq('tenant_id', tenantId)
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weinausbau): ${e.message}`) }
}

// Prüft, ob gegen eine Weinausbau-Charge bereits irgendeine Bewegung gebucht wurde (abgefüllt,
// umgezogen, verkauft ab Tank oder verschnitten). Wichtig für updateZukauf (siehe dort) – im
// Unterschied zu bereinigCharge() zählen hier zusätzlich Tank-Verkäufe und Verschneidungen mit,
// weil eine bereits "bewegte" Charge beim Bearbeiten des zugehörigen Zukaufs NICHT mehr blind
// deaktiviert/neu angelegt werden darf (das würde den physisch noch vorhandenen Restbestand aus
// allen Übersichten verschwinden lassen, siehe Bugreport 5.8.2026 – Kellerbuch zeigte "Kein Wein
// in diesem Behälter", obwohl laut Bewegungsbuch/View noch mehrere tausend Liter vorhanden waren).
async function chargeHatBewegungen(supabase: any, weinausbauId: string, tenantId: string): Promise<boolean> {
  const [
    { count: umzugCount },
    { count: fuellungCount },
    { count: verkaufCount },
    { count: verschnQuelleCount },
    { count: verschnZielCount },
  ] = await Promise.all([
    (supabase.from('keller_umzuege') as any)
      .select('id', { count: 'exact', head: true })
      .or(`von_weinausbau_id.eq.${weinausbauId},nach_weinausbau_id.eq.${weinausbauId}`)
      .eq('tenant_id', tenantId),
    (supabase.from('fuellungen') as any)
      .select('id', { count: 'exact', head: true })
      .eq('weinausbau_id', weinausbauId)
      .eq('tenant_id', tenantId),
    (supabase.from('verkauf_positionen') as any)
      .select('id', { count: 'exact', head: true })
      .eq('weinausbau_id', weinausbauId)
      .eq('tenant_id', tenantId),
    (supabase.from('verschneidung_quellen') as any)
      .select('id', { count: 'exact', head: true })
      .eq('quell_weinausbau_id', weinausbauId),
    (supabase.from('verschneidungen') as any)
      .select('id', { count: 'exact', head: true })
      .eq('ziel_weinausbau_id', weinausbauId)
      .eq('tenant_id', tenantId),
  ])
  return (umzugCount ?? 0) > 0 || (fuellungCount ?? 0) > 0 || (verkaufCount ?? 0) > 0
    || (verschnQuelleCount ?? 0) > 0 || (verschnZielCount ?? 0) > 0
}

// Öffentlicher Wrapper für die Zukauf-Bearbeiten-Seite (page.tsx): baut sich
// seinen eigenen Supabase-Client, damit die Signatur (nur ein serialisierbarer
// String-Parameter) sauber als Server-Action-Export bleibt.
export async function pruefeChargeHatBewegungen(weinausbauId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  return chargeHatBewegungen(supabase, weinausbauId, tenantId)
}

function parseZukaufFormData(formData: FormData) {
  const datum = (formData.get('datum') as string) || new Date().toISOString().split('T')[0]
  // Jahrgang ist optional im Formular, wird aber u.a. für den Pressungs-Vorschlag
  // und den Traubenverkauf-Dropdown bei Trauben-Zukäufen benötigt (exakter Match
  // gegen weinjahrgaenge.jahrgang) – bleibt das Feld leer, auf das Kalenderjahr
  // des Liefer-/Kaufdatums zurückfallen, statt NULL zu speichern und den Posten
  // dadurch unsichtbar für diese Zuordnung zu machen.
  const jahrgangEingabe = parseInt(dezimal(formData.get('jahrgang') as string))
  const jahrgang = !isNaN(jahrgangEingabe) ? jahrgangEingabe : (parseInt(datum.slice(0, 4)) || null)
  return {
    datum,
    lieferungUhrzeit:    (formData.get('lieferung_uhrzeit')        as string)?.trim() || null,
    art:                 (formData.get('art')                      as string) || 'wein',
    lieferantKontaktId:  (formData.get('lieferant_kontakt_id')     as string) || null,
    lieferantFirmaId:    (formData.get('lieferant_firma_id')       as string) || null,
    // Nur beim Neuanlegen relevant – siehe createZukauf; updateZukauf lässt das Feld
    // bewusst unangetastet (Lieferant-Zuordnung ist nach dem Anlegen nicht mehr änderbar).
    zhKontaktId:         (formData.get('zh_kontakt_id')            as string) || null,
    eingangsrechnungsnummer: (formData.get('eingangsrechnungsnummer') as string)?.trim() || null,
    zugmaschine:         (formData.get('transport_zugmaschine')    as string)?.trim() || null,
    anhaenger1:          (formData.get('transport_anhaenger1')     as string)?.trim() || null,
    anhaenger2:          (formData.get('transport_anhaenger2')     as string)?.trim() || null,
    weinart:             (formData.get('weinart')                  as string) || 'unbekannt',
    rebsorte:            (formData.get('rebsorte')                 as string)?.trim() || null,
    qualitaetsstufe:     (formData.get('qualitaetsstufe')          as string)?.trim() || null,
    jahrgang,
    herkunft:            (formData.get('herkunft')                 as string)?.trim() || null,
    anreicherung:        formData.get('anreicherung') === 'true',
    kmw:                 parseFloat(dezimal(formData.get('kmw')            as string)) || null,
    alkohol:             parseFloat(dezimal(formData.get('alkohol_pct')    as string)) || null,
    pruefnummer:         (formData.get('staatliche_pruefnummer')   as string)?.trim() || null,
    menge:               parseFloat(dezimal(formData.get('menge')          as string)) || 0,
    einheit:             (formData.get('einheit')                  as string) || 'kg',
    preisGesamt:         parseFloat(dezimal(formData.get('preis_gesamt')   as string)) || null,
    einstandspreisLiter: parseFloat(dezimal(formData.get('einstandspreis_pro_liter') as string)) || null,
    notizen:             (formData.get('notizen')                  as string)?.trim() || null,
    zielBehaelterId:     (formData.get('ziel_behaelter_id')        as string) || null,
  }
}

export async function createZukauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const f = parseZukaufFormData(formData)

  if (f.menge <= 0) throw new AktionsFehler('Menge muss größer als 0 sein')

  let zielWeinausbauId: string | null = null
  if ((f.art === 'wein' || f.art === 'most') && f.zielBehaelterId) {
    zielWeinausbauId = await createZukaufCharge(
      supabase, tenantId, f.zielBehaelterId, f.rebsorte, f.jahrgang, f.menge, f.einstandspreisLiter, f.weinart, f.qualitaetsstufe,
    )
  }

  const { error } = await (supabase.from('zukauf_posten') as any)
    .insert({
      tenant_id:                tenantId,
      datum:                    f.datum,
      lieferung_uhrzeit:        f.lieferungUhrzeit,
      art:                      f.art,
      lieferant_kontakt_id:     f.lieferantKontaktId || null,
      lieferant_firma_id:       f.lieferantFirmaId   || null,
      zh_kontakt_id:            f.lieferantFirmaId ? (f.zhKontaktId || null) : null,
      eingangsrechnungsnummer: f.eingangsrechnungsnummer,
      transport_zugmaschine:    f.zugmaschine,
      transport_anhaenger1:     f.anhaenger1,
      transport_anhaenger2:     f.anhaenger2,
      weinart:                  f.weinart,
      rebsorte:                 f.rebsorte,
      qualitaetsstufe:          f.qualitaetsstufe,
      jahrgang:                 f.jahrgang,
      herkunft:                 f.herkunft,
      anreicherung:             f.anreicherung,
      kmw:                      f.kmw,
      alkohol_pct:              f.alkohol,
      staatliche_pruefnummer:   f.pruefnummer,
      menge:                    f.menge,
      einheit:                  f.einheit,
      preis_gesamt:             f.preisGesamt ?? null,
      einstandspreis_pro_liter: f.einstandspreisLiter ?? null,
      notizen:                  f.notizen,
      ziel_weinausbau_id:       zielWeinausbauId,
    })

  if (error) throw new AktionsFehler((error as AR).message)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')

  if (zielWeinausbauId && f.zielBehaelterId && f.rebsorte) {
    // Prüfung 1: Andere Rebsorte im Gebinde → Verschneidung (Sortenverschnitt)
    const { data: andereRebsorte } = await (supabase.from('weinausbau') as any)
      .select('id')
      .eq('behaelter_id', f.zielBehaelterId)
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)
      .neq('id', zielWeinausbauId)
      .neq('rebsorte', f.rebsorte)
      .limit(1)
    if ((andereRebsorte as any[])?.length > 0) {
      const existierendeId = (andereRebsorte as any[])[0].id
      redirect(`/kellerbuch/weinausbau/${existierendeId}?form=verschneiden&quelle=${zielWeinausbauId}&menge=${f.menge}`)
    }

    // Prüfung 2: Gleiche Rebsorte, andere Qualitätsstufe → Verschneidung (ggf. Abstufung)
    if (f.qualitaetsstufe) {
      const { data: gleicheRebsorte } = await (supabase.from('weinausbau') as any)
        .select('id, qualitaetsstufe')
        .eq('behaelter_id', f.zielBehaelterId)
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)
        .neq('id', zielWeinausbauId)
        .eq('rebsorte', f.rebsorte)
        .not('qualitaetsstufe', 'is', null)
        .limit(10)
      const treffer = ((gleicheRebsorte as any[]) ?? []).find(
        (c: any) => c.qualitaetsstufe !== f.qualitaetsstufe
      )
      if (treffer) {
        redirect(`/kellerbuch/weinausbau/${treffer.id}?form=verschneiden&quelle=${zielWeinausbauId}&menge=${f.menge}`)
      }
    }
  }

  redirect('/weinhandel/zukauf')
}

export async function updateZukauf(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const f = parseZukaufFormData(formData)

  if (f.menge <= 0) throw new AktionsFehler('Menge muss größer als 0 sein')

  const { data: alt } = await (supabase.from('zukauf_posten') as any)
    .select('ziel_weinausbau_id, menge')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()
  const altWeinausbauId: string | null = (alt as AR | null)?.ziel_weinausbau_id ?? null
  const alteZukaufMenge: number = parseFloat((alt as AR | null)?.menge ?? '0') || 0

  let zielWeinausbauId: string | null = altWeinausbauId

  if ((f.art === 'wein' || f.art === 'most') && f.zielBehaelterId) {
    const hatBewegungen = altWeinausbauId ? await chargeHatBewegungen(supabase, altWeinausbauId, tenantId) : false

    if (altWeinausbauId && hatBewegungen) {
      // Die bisherige Charge wurde bereits abgefüllt/umgezogen/verkauft/verschnitten – NICHT
      // deaktivieren+neu anlegen (das würde den physisch noch vorhandenen Restbestand aus dem
      // Kellerbuch verschwinden lassen), sondern in-place aktualisieren. Nur die DIFFERENZ
      // zwischen alter und neuer deklarierter Zukaufsmenge wird auf den aktuellen Bestand
      // verrechnet (z.B. Tippfehler-Korrektur der Menge), damit bereits verbrauchte Mengen
      // erhalten bleiben.
      const { data: alteCharge } = await (supabase.from('weinausbau') as any)
        .select('behaelter_id, menge_liter')
        .eq('id', altWeinausbauId)
        .eq('tenant_id', tenantId)
        .single()
      const alterBehaelterId = (alteCharge as AR | null)?.behaelter_id ?? null
      if (alterBehaelterId && alterBehaelterId !== f.zielBehaelterId) {
        throw new AktionsFehler(
          'Diese Charge wurde bereits abgefüllt, umgezogen, verkauft oder verschnitten – der Ziel-Behälter kann nachträglich nicht mehr geändert werden. Bitte den Behälter unverändert lassen und stattdessen "Umziehen" im Kellerbuch verwenden.'
        )
      }
      const bisherigerBestand = parseFloat((alteCharge as AR | null)?.menge_liter ?? '0') || 0
      const mengenDelta = f.menge - alteZukaufMenge
      const neuerBestand = Math.max(0, bisherigerBestand + mengenDelta)

      const { error: updChargeErr } = await (supabase.from('weinausbau') as any)
        .update({
          menge_liter:              neuerBestand,
          rebsorte:                 f.rebsorte ?? null,
          jahrgang:                 f.jahrgang,
          einstandspreis_pro_liter: f.einstandspreisLiter ?? null,
          weinart:                  f.weinart ?? 'unbekannt',
          qualitaetsstufe:          f.qualitaetsstufe ?? null,
        })
        .eq('id', altWeinausbauId)
        .eq('tenant_id', tenantId)
      if (updChargeErr) throw new AktionsFehler((updChargeErr as AR).message)
      zielWeinausbauId = altWeinausbauId
    } else {
      // Noch keine Bewegungen gegen die bisherige Charge gebucht – bisheriges Verhalten
      // (deaktivieren + frisch anlegen) ist hier unbedenklich, da noch nichts verbraucht wurde.
      if (altWeinausbauId) await bereinigCharge(supabase, altWeinausbauId, tenantId)
      zielWeinausbauId = await createZukaufCharge(
        supabase, tenantId, f.zielBehaelterId, f.rebsorte, f.jahrgang, f.menge, f.einstandspreisLiter, f.weinart, f.qualitaetsstufe,
      )
    }
  } else if (!(f.art === 'wein' || f.art === 'most')) {
    if (altWeinausbauId) await bereinigCharge(supabase, altWeinausbauId, tenantId)
    zielWeinausbauId = null
  }

  const { error } = await (supabase.from('zukauf_posten') as any).update({
    datum:                    f.datum,
    lieferung_uhrzeit:        f.lieferungUhrzeit,
    art:                      f.art,
    lieferant_kontakt_id:     f.lieferantKontaktId || null,
    lieferant_firma_id:       f.lieferantFirmaId   || null,
    eingangsrechnungsnummer: f.eingangsrechnungsnummer,
    transport_zugmaschine:    f.zugmaschine,
    transport_anhaenger1:     f.anhaenger1,
    transport_anhaenger2:     f.anhaenger2,
    weinart:                  f.weinart,
    rebsorte:                 f.rebsorte,
    qualitaetsstufe:          f.qualitaetsstufe,
    jahrgang:                 f.jahrgang,
    herkunft:                 f.herkunft,
    anreicherung:             f.anreicherung,
    kmw:                      f.kmw,
    alkohol_pct:              f.alkohol,
    staatliche_pruefnummer:   f.pruefnummer,
    menge:                    f.menge,
    einheit:                  f.einheit,
    preis_gesamt:             f.preisGesamt ?? null,
    einstandspreis_pro_liter: f.einstandspreisLiter ?? null,
    notizen:                  f.notizen,
    ziel_weinausbau_id:       zielWeinausbauId,
  }).eq('id', id).eq('tenant_id', tenantId)

  if (error) throw new AktionsFehler((error as AR).message)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  redirect('/weinhandel/zukauf')
}

export async function deleteZukauf(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const { data: zukauf } = await (supabase.from('zukauf_posten') as any)
    .select('ziel_weinausbau_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()
  const weinausbauId: string | null = (zukauf as AR | null)?.ziel_weinausbau_id ?? null

  const { error } = await (supabase.from('zukauf_posten') as any)
    .update({ aktiv: false })
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)

  if (weinausbauId) await bereinigCharge(supabase, weinausbauId, tenantId)

  revalidatePath('/weinhandel/zukauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
}
