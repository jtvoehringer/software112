'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { istNiedrigerAls, QUALITAET_LABEL } from '@/lib/weinqualitaet'
import { istNiedrigerAls as herkunftIstNiedrigerAls, HERKUNFT_LABEL } from '@/lib/herkunft'
import { getCurrentMembership, canWrite, type Membership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { dezimal, zahlAus, fmtNum } from '@/lib/format'
import { folgebuchungenDerFuellung, folgebuchungenFuellungText, heuteOrtsdatum, datumDe } from './fuellungen/folgebuchungen'
import { BEWEGUNGSARTEN, istBewegungsart } from './fuellungen/bewegungsarten'
import { spaetereMengenbewegungen } from '@/lib/kellerbuch/storno'
import { folgebuchungenText } from '@/lib/kellerbuch/folgebuchungen'
import { KORREKTUR_NACH_OBEN_HINWEIS } from '@/lib/kellerbuch/hinweise'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// ── KAN-35 (24.09.2026): Datenintegrität Füllung/Schwund ──────────────────────
// - Liter-Schwund nur noch als datierte Zeile über rpc('schwund_buchen'), nie mehr
//   durch direktes Überschreiben von weinausbau.menge_liter.
// - Flaschenbestand außerhalb von Verkauf/Storno nur noch über
//   rpc('fuellung_bestand_buchen') (datierte Zeile in fuellung_bewegungen).
// - Keine stillen Mengenänderungen: Überabfüllung wird abgelehnt statt auf 0 gekappt,
//   Charge-Updates prüfen Fehler UND „0 Zeilen“ (RLS-gefiltert bzw. zwischenzeitlich
//   geändert).
// - Sperren statt Überschreiben: Anzahl/Füllmenge einer Füllung mit Verkäufen oder
//   Bestandsbuchungen sind fest; Löschen ist dann ebenfalls gesperrt.

/** Rundungstoleranz: weinausbau/keller_umzuege speichern numeric(10,2) */
const RUNDUNG = 0.005
const r2 = (x: number) => Math.round(x * 100) / 100
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/

async function getMembership(): Promise<Membership> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership
}

// Schreibrechte wie die RLS-Modulprüfung (Migration 218): fuellungen, fuellung_chargen und
// keller_umzuege verlangen Kellerbuch ODER Warenwirtschaft, weinausbau Kellerbuch ODER Rieden.
// Vorab prüfen: ein per RLS gefiltertes UPDATE ändert still 0 Zeilen (früher: Füllung
// angelegt, Charge aber nicht gemindert).
function pruefeFuellungsRecht(m: Membership) {
  if (!(canWrite(m, 'kellerbuch') || canWrite(m, 'warenwirtschaft'))) {
    throw new AktionsFehler('Keine Berechtigung für Füllungen – dafür ist das Modul Kellerbuch oder Warenwirtschaft nötig.')
  }
}
function pruefeChargenRecht(m: Membership) {
  if (!(canWrite(m, 'kellerbuch') || canWrite(m, 'rieden'))) {
    throw new AktionsFehler('Keine Berechtigung, den Bestand der Kellerbuch-Charge zu ändern – dafür ist das Modul Kellerbuch (oder Rieden) nötig.')
  }
}

/** Notiz der Abschluss-Schwundzeile einer Füllung (deactivateFuellung erkennt sie am Anfang) */
const ABFUELL_SCHWUND_NOTIZ = 'Schwund bei Abfüllung'

/**
 * Wurde die Füllmenge dieser Füllung von der Charge abgebucht? Nur dann gibt es die
 * Verknüpfung fuellung_chargen (createFuellung). Eine nachträglich zugeordnete Charge
 * (Datenimport, frühere Füllungen ohne Charge) wurde nie gemindert. Liefert die
 * abgebuchten Liter oder null.
 */
async function abgebuchteLiter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  fuellungId: string,
  weinausbauId: string,
): Promise<number | null> {
  const { data, error } = await (supabase.from('fuellung_chargen') as any)
    .select('anteil_liter')
    .eq('fuellung_id', fuellungId)
    .eq('weinausbau_id', weinausbauId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Chargen-Verknüpfung konnte nicht geladen werden'))
  return data ? r2(Number((data as AR).anteil_liter ?? 0) || 0) : null
}

type ChargeErgebnis = { ok: true } | { ok: false; code: string; meldung: string }

/**
 * Charge ändern – nur, wenn menge_liter noch dem gelesenen Wert entspricht (kein Lost
 * Update gegenüber parallelen Verkäufen/Umzügen). Liefert Fehler statt zu werfen, damit
 * der Aufrufer den Zusammenhang (Abfüllen, Löschen, Zurücksetzen) in die Meldung schreibt.
 */
async function chargeAktualisieren(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  chargeId: string,
  mengeVorher: unknown,
  werte: AR,
): Promise<ChargeErgebnis> {
  let q = (supabase.from('weinausbau') as any).update(werte).eq('id', chargeId).eq('tenant_id', tenantId)
  q = mengeVorher == null ? q.is('menge_liter', null) : q.eq('menge_liter', mengeVorher)
  const { data, error } = await q.select('id')
  if (error) return { ok: false, code: String((error as AR).code ?? ''), meldung: dbFehlerText(error, 'Speichern fehlgeschlagen (weinausbau)') }
  if (!data || (data as AR[]).length === 0) {
    return { ok: false, code: 'KONFLIKT', meldung: 'Der Bestand der Charge wurde zwischenzeitlich geändert – bitte die Seite neu laden und erneut versuchen.' }
  }
  return { ok: true }
}

// Neue Füllung anlegen

export async function createFuellung(formData: FormData): Promise<{ id: string; hinweis?: string }> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)

  const weinausbauId    = (formData.get('weinausbau_id') as string) || null
  const anzahl          = parseInt(dezimal(formData.get('anzahl_flaschen') as string))
  const flGroesseML     = parseInt(dezimal(formData.get('flaschengroesse_ml') as string)) || 750
  const mengeFormular   = parseFloat(dezimal(formData.get('menge_liter_gefuellt') as string)) || null
  // Falls kein Literfeld ausgefüllt: aus Flaschenzahl berechnen. Auf 2 Stellen gerundet wie
  // fuellungen.menge_liter_gefuellt (numeric(10,2)) – Abbuchung von der Charge, gespeicherte
  // Füllmenge und fuellung_chargen.anteil_liter sind so identisch.
  const mengeGefuellt   = r2(mengeFormular ?? (anzahl * flGroesseML / 1000))
  const datum           = ((formData.get('datum') as string) || '').slice(0, 10)

  if (!Number.isInteger(anzahl) || anzahl <= 0) {
    throw new AktionsFehler('Bitte die Anzahl der gefüllten Flaschen angeben (ganze Zahl größer als 0).')
  }
  if (!(mengeGefuellt > 0)) throw new AktionsFehler('Die abgefüllte Menge muss größer als 0 L sein.')
  if (!DATUM_RE.test(datum)) throw new AktionsFehler('Bitte ein gültiges Abfülldatum angeben.')

  const qualitaetInput     = (formData.get('qualitaet') as string) || null
  const herkunftCodeInput  = (formData.get('herkunft_code') as string) || null
  let notizenZusatz = ''
  let charge: AR | null = null

  // Bestandsprüfung VOR jedem Schreibzugriff: nicht mehr füllen als die Charge hat
  // + Downgrade-only-Prüfung: 'Qualitätswein' und 'Herkunft-Code (BKI)' dürfen beim Füllen nur
  // abgestuft, NIEMALS aufgestuft werden gegenüber der verknüpften Kellerbuch-Charge (hart blockiert).
  if (weinausbauId) {
    pruefeChargenRecht(membership)
    const { data: wa, error: waErr } = await (supabase.from('weinausbau') as any)
      .select('name, menge_liter, status, aktiv, qualitaetsstufe, herkunft_code')
      .eq('id', weinausbauId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (waErr) throw new AktionsFehler(dbFehlerText(waErr, 'Charge konnte nicht geladen werden'))
    if (!wa) throw new AktionsFehler('Die gewählte Kellerbuch-Charge wurde nicht gefunden.')
    charge = wa as AR

    // KAN-35: keine Toleranz mehr – bisher wurde bis zu einer Flasche mehr angenommen und die
    // Charge danach still auf 0 gekappt (die Füllung trug dann mehr Liter, als abgebucht wurden).
    const verfuegbar = Number(charge.menge_liter ?? 0) || 0
    if (mengeGefuellt > verfuegbar + RUNDUNG) {
      throw new AktionsFehler(
        `Abfüllmenge (${fmtNum(mengeGefuellt, 2)} L) übersteigt den Bestand der Charge „${charge.name}“ (${fmtNum(verfuegbar, 2)} L). ` +
        `Bitte Flaschenzahl bzw. Füllmenge prüfen. Ist tatsächlich mehr Wein vorhanden: ${KORREKTUR_NACH_OBEN_HINWEIS}`
      )
    }

    const chargeQualitaet = charge.qualitaetsstufe as string | null ?? null
    const chargeHerkunft  = charge.herkunft_code as string | null ?? null

    if (qualitaetInput && chargeQualitaet && istNiedrigerAls(chargeQualitaet, qualitaetInput)) {
      throw new AktionsFehler(
        `Qualitätswein kann nicht von ${QUALITAET_LABEL[chargeQualitaet] ?? chargeQualitaet} auf ${QUALITAET_LABEL[qualitaetInput] ?? qualitaetInput} AUFgestuft werden. Nur Abstufungen sind zulässig.`
      )
    }
    if (herkunftCodeInput && chargeHerkunft && herkunftIstNiedrigerAls(chargeHerkunft, herkunftCodeInput)) {
      throw new AktionsFehler(
        `Herkunft-Code (BKI) kann nicht von ${HERKUNFT_LABEL[chargeHerkunft] ?? chargeHerkunft} auf ${HERKUNFT_LABEL[herkunftCodeInput] ?? herkunftCodeInput} AUFgestuft werden. Nur Abstufungen sind zulässig.`
      )
    }
    if (qualitaetInput && chargeQualitaet && qualitaetInput !== chargeQualitaet && istNiedrigerAls(qualitaetInput, chargeQualitaet)) {
      notizenZusatz += `Qualität manuell abgestuft von ${QUALITAET_LABEL[chargeQualitaet] ?? chargeQualitaet} auf ${QUALITAET_LABEL[qualitaetInput] ?? qualitaetInput}. `
    }
    if (herkunftCodeInput && chargeHerkunft && herkunftCodeInput !== chargeHerkunft && herkunftIstNiedrigerAls(herkunftCodeInput, chargeHerkunft)) {
      notizenZusatz += `Herkunft-Code (BKI) manuell abgestuft von ${HERKUNFT_LABEL[chargeHerkunft] ?? chargeHerkunft} auf ${HERKUNFT_LABEL[herkunftCodeInput] ?? herkunftCodeInput}. `
    }
  }

  const notizenInput = (formData.get('notizen') as string) || null
  const notizen = notizenZusatz ? [notizenInput, notizenZusatz.trim()].filter(Boolean).join('\n') : notizenInput

  let chargennummer = (formData.get('chargennummer') as string) || null
  if (!chargennummer) {
    const { data: nr, error: nrErr } = await (supabase.rpc as any)('get_next_chargennummer', { p_tenant_id: tenantId })
    if (nrErr) throw new AktionsFehler(dbFehlerText(nrErr, 'Chargennummer konnte nicht vergeben werden'))
    chargennummer = (nr as string) ?? null
  }

  // 1. Charge mindern – VOR dem Anlegen der Füllung: scheitert es (paralleler Verkauf/Umzug,
  //    Gebinde-Prüfung), bleibt nichts halb gebucht zurück.
  //    Abschluss (Rest ≤ 0,01 L oder angehakt): Rest ≥ 0,01 L bucht schwund_buchen unten als
  //    datierte Schwundzeile aus und schließt ab; ein Rest < 0,01 L wird direkt abgeschlossen.
  let schwundLiter = 0
  let chargeVorher: AR | null = null
  let mengeNachher: number | null = null
  if (weinausbauId && charge) {
    const verfuegbar   = Number(charge.menge_liter ?? 0) || 0
    const differenz    = r2(verfuegbar - mengeGefuellt)   // ≥ −0,005 L laut Prüfung oben
    const rest         = differenz > 0 ? differenz : 0
    const abschliessen = formData.get('abschliessen') === 'true'
    const wirdAbgeschlossen = rest <= 0.01 || abschliessen
    schwundLiter = wirdAbgeschlossen && rest >= 0.01 ? rest : 0

    const werte: AR = !wirdAbgeschlossen
      ? { menge_liter: rest, status: 'abfuellung', aktiv: true }
      : schwundLiter > 0
        ? { menge_liter: rest }                                   // Abschluss übernimmt schwund_buchen
        : { menge_liter: 0, status: 'abgeschlossen', aktiv: false }
    const r = await chargeAktualisieren(supabase, tenantId, weinausbauId, charge.menge_liter, werte)
    if (!r.ok) throw new AktionsFehler(`Abfüllen fehlgeschlagen – die Charge „${charge.name}“ konnte nicht gemindert werden: ${r.meldung}`)
    chargeVorher = { menge_liter: charge.menge_liter ?? null, status: charge.status, aktiv: charge.aktiv }
    mengeNachher = werte.menge_liter as number
  }

  // 2. Füllung anlegen
  const payload: AR = {
    tenant_id:            tenantId,
    weinausbau_id:        weinausbauId,
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(dezimal(formData.get('jahrgang') as string)) || null,
    rebsorte:             (formData.get('rebsorte') as string) || null,
    qualitaet:            formData.get('qualitaet') as string,
    herkunft_code:        herkunftCodeInput,
    anbaugebiet:          (formData.get('anbaugebiet') as string) || null,
    bezeichnung:          (formData.get('bezeichnung') as string) || null,
    datum,
    flaschengroesse_ml:   flGroesseML,
    anzahl_flaschen:      anzahl,
    bestand_flaschen:     anzahl,
    menge_liter_gefuellt: mengeGefuellt,
    pruefnummer:          (formData.get('pruefnummer') as string) || null,
    dac_antrag_id:        (formData.get('dac_antrag_id') as string) || null,
    chargennummer,
    vk_preis_brutto:      parseFloat(dezimal(formData.get('vk_preis_brutto') as string)) || null,
    einstandspreis:       parseFloat(dezimal(formData.get('einstandspreis') as string)) || null,
    zolltarifnummer:      (formData.get('zolltarifnummer') as string) || null,
    notizen:              notizen,
  }

  const { error, data: fuellungData } = await (supabase.from('fuellungen') as any)
    .insert(payload).select('id').single()
  if (error || !(fuellungData as AR | null)?.id) {
    const meldung = dbFehlerText(error, 'Speichern fehlgeschlagen (fuellungen)')
    // Abbuchung zurücknehmen – die Füllung gibt es nicht
    if (weinausbauId && chargeVorher) {
      const r = await chargeAktualisieren(supabase, tenantId, weinausbauId, mengeNachher, chargeVorher)
      if (!r.ok) {
        throw new AktionsFehler(
          `${meldung} – Achtung: Die Charge „${charge?.name ?? ''}“ wurde bereits um ${fmtNum(mengeGefuellt, 2)} L gemindert und konnte nicht zurückgesetzt werden (${r.meldung}). Bitte den Bestand der Charge prüfen.`
        )
      }
    }
    throw new AktionsFehler(meldung)
  }
  const fuellungId = (fuellungData as AR).id as string

  // Ab hier existiert die Füllung: weitere Fehler als Hinweis zurückgeben statt zu werfen –
  // sonst legt ein erneutes Absenden die Füllung ein zweites Mal an.
  const hinweise: string[] = []

  // 3. fuellung_chargen: Charge-Verknüpfung (Rückverfolgung, Rückbuchung beim Löschen)
  if (weinausbauId) {
    const { error: e } = await (supabase.from('fuellung_chargen') as any).insert({
      tenant_id:     tenantId,
      fuellung_id:   fuellungId,
      weinausbau_id: weinausbauId,
      anteil_liter:  mengeGefuellt,
    })
    if (e) hinweise.push(`Die Verknüpfung der Füllung mit der Charge konnte nicht gespeichert werden (${dbFehlerText(e)}). Bitte melden – Rückverfolgung und Löschen dieser Füllung sind davon betroffen.`)
  }

  // 4. Rest als datierte Schwundzeile ausbuchen und Charge abschließen (atomar in der RPC)
  if (weinausbauId && schwundLiter > 0) {
    const { error: e } = await (supabase.rpc as any)('schwund_buchen', {
      p_tenant_id:      tenantId,
      p_weinausbau_id:  weinausbauId,
      p_liter:          schwundLiter,
      p_datum:          datum,
      // Beginnt mit ABFUELL_SCHWUND_NOTIZ – daran (und am Zeitpunkt) erkennt deactivateFuellung die Zeile
      p_notiz:          `${ABFUELL_SCHWUND_NOTIZ} (Füllung „${String(payload.name ?? '').trim() || 'ohne Name'}“)`,
      p_abschliessen:   true,
    })
    if (e) {
      hinweise.push(
        `Die Füllung ist angelegt, die Restmenge von ${fmtNum(schwundLiter, 2)} L konnte aber nicht als Schwund ausgebucht werden (${dbFehlerText(e)}). ` +
        'Die Charge ist noch offen – bitte in der Füllungsbearbeitung „Als Schwund ausbuchen“ verwenden.'
      )
    }
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  return hinweise.length ? { id: fuellungId, hinweis: hinweise.join(' ') } : { id: fuellungId }
}

// Füllung bearbeiten

export async function updateFuellung(id: string, formData: FormData): Promise<void> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)

  // Gespeicherten Stand laden: Mengenfelder werden verglichen statt blind überschrieben
  const { data: altRaw, error: altErr } = await (supabase.from('fuellungen') as any)
    .select('weinausbau_id, anzahl_flaschen, bestand_flaschen, flaschengroesse_ml, menge_liter_gefuellt')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (altErr) throw new AktionsFehler(dbFehlerText(altErr, 'Füllung konnte nicht geladen werden'))
  if (!altRaw) throw new AktionsFehler('Füllung nicht gefunden.')
  const alt = altRaw as AR

  // Fehlt ein Mengenfeld im Formular, bleibt der gespeicherte Wert
  const altAnzahl  = Number(alt.anzahl_flaschen)
  const altGroesse = Number(alt.flaschengroesse_ml) || 750
  const altMenge   = alt.menge_liter_gefuellt == null ? null : Number(alt.menge_liter_gefuellt)
  const feld = (name: string) => formData.get(name) as string | null

  const anzahl = feld('anzahl_flaschen') == null ? altAnzahl : parseInt(dezimal(feld('anzahl_flaschen')))
  if (!Number.isInteger(anzahl) || anzahl <= 0) {
    throw new AktionsFehler('Bitte die Anzahl der gefüllten Flaschen angeben (ganze Zahl größer als 0).')
  }
  const flGroesseML = feld('flaschengroesse_ml') == null ? altGroesse : (parseInt(dezimal(feld('flaschengroesse_ml'))) || 750)
  const mengeGefuellt = feld('menge_liter_gefuellt') == null
    ? altMenge
    : (parseFloat(dezimal(feld('menge_liter_gefuellt'))) || null)
  if (mengeGefuellt != null && mengeGefuellt < 0) throw new AktionsFehler('Die gefüllte Menge darf nicht negativ sein.')
  const weinausbauId = feld('weinausbau_id') == null ? (alt.weinausbau_id ?? null) : (feld('weinausbau_id') || null)

  // Wirksame Füllmenge wie in v_behaelter_fuellstand: menge_liter_gefuellt, sonst Anzahl × Größe
  const literWirksam = (menge: number | null, n: number, ml: number) => (menge != null && menge > 0 ? menge : n * ml / 1000)
  const anzahlGeaendert  = anzahl !== altAnzahl
  const mengenGeaendert  = anzahlGeaendert
    || flGroesseML !== altGroesse
    || Math.abs((mengeGefuellt ?? 0) - (altMenge ?? 0)) > RUNDUNG
  const literGeaendert   = Math.abs(literWirksam(mengeGefuellt, anzahl, flGroesseML) - literWirksam(altMenge, altAnzahl, altGroesse)) > RUNDUNG
  const chargeGeaendert  = !!alt.weinausbau_id && weinausbauId !== alt.weinausbau_id

  // KAN-35 Sperren: Anzahl/Größe/Füllmenge nur ohne Verkäufe und Bestandsbuchungen
  if (mengenGeaendert) {
    const fb = await folgebuchungenDerFuellung(supabase, tenantId, id)
    if (fb.verkaeufe > 0 || fb.bewegungen > 0) {
      throw new AktionsFehler(
        `Anzahl, Flaschengröße und Füllmenge sind nicht mehr änderbar: Zu dieser Füllung gibt es bereits ${folgebuchungenFuellungText(fb)}. ` +
        'Abweichungen im Flaschenbestand bitte über „Bestand korrigieren“ buchen (Inventur, Bruch, Eigenverbrauch, Korrektur).'
      )
    }
  }
  // … und wurden die Liter von der verknüpften Charge abgebucht (fuellung_chargen), weder Menge
  // noch Charge nachträglich umschreiben (Charge, Bewegungsbuch und Füllstand liefen sonst
  // auseinander). Eine nachträglich zugeordnete Charge wurde nie gemindert – sie bleibt änderbar.
  if (alt.weinausbau_id && (chargeGeaendert || literGeaendert)) {
    const abgebucht = await abgebuchteLiter(supabase, tenantId, id, alt.weinausbau_id as string)
    if (abgebucht != null) {
      throw new AktionsFehler(
        (chargeGeaendert
          ? 'Die Kellerbuch-Charge dieser Füllung ist nicht mehr änderbar: '
          : 'Die Füllmenge dieser Füllung ist nicht mehr änderbar: ') +
        `${fmtNum(abgebucht, 2)} L wurden beim Abfüllen von der verknüpften Charge abgebucht. ` +
        'Ist die Füllung falsch erfasst, bitte die Füllung löschen (bucht die Liter auf die Charge zurück – nur ohne Verkäufe und Bestandsbuchungen möglich) und neu anlegen.'
      )
    }
  }

  const qualitaetInput    = (formData.get('qualitaet') as string) || null
  const herkunftCodeInput = (formData.get('herkunft_code') as string) || null
  let notizenZusatz = ''

  // Downgrade-only-Prüfung wie bei createFuellung: 'Qualitätswein' und 'Herkunft-Code (BKI)'
  // dürfen beim Bearbeiten einer Füllung nur abgestuft, nie aufgestuft werden (hart blockiert).
  if (weinausbauId) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('qualitaetsstufe, herkunft_code')
      .eq('id', weinausbauId)
      .eq('tenant_id', tenantId)
      .single()
    const chargeQualitaet = (wa as AR | null)?.qualitaetsstufe as string | null ?? null
    const chargeHerkunft  = (wa as AR | null)?.herkunft_code as string | null ?? null

    if (qualitaetInput && chargeQualitaet && istNiedrigerAls(chargeQualitaet, qualitaetInput)) {
      throw new AktionsFehler(
        `Qualitätswein kann nicht von ${QUALITAET_LABEL[chargeQualitaet] ?? chargeQualitaet} auf ${QUALITAET_LABEL[qualitaetInput] ?? qualitaetInput} AUFgestuft werden. Nur Abstufungen sind zulässig.`
      )
    }
    if (herkunftCodeInput && chargeHerkunft && herkunftIstNiedrigerAls(chargeHerkunft, herkunftCodeInput)) {
      throw new AktionsFehler(
        `Herkunft-Code (BKI) kann nicht von ${HERKUNFT_LABEL[chargeHerkunft] ?? chargeHerkunft} auf ${HERKUNFT_LABEL[herkunftCodeInput] ?? herkunftCodeInput} AUFgestuft werden. Nur Abstufungen sind zulässig.`
      )
    }
    if (qualitaetInput && chargeQualitaet && qualitaetInput !== chargeQualitaet && istNiedrigerAls(qualitaetInput, chargeQualitaet)) {
      notizenZusatz += `Qualität manuell abgestuft von ${QUALITAET_LABEL[chargeQualitaet] ?? chargeQualitaet} auf ${QUALITAET_LABEL[qualitaetInput] ?? qualitaetInput}. `
    }
    if (herkunftCodeInput && chargeHerkunft && herkunftCodeInput !== chargeHerkunft && herkunftIstNiedrigerAls(herkunftCodeInput, chargeHerkunft)) {
      notizenZusatz += `Herkunft-Code (BKI) manuell abgestuft von ${HERKUNFT_LABEL[chargeHerkunft] ?? chargeHerkunft} auf ${HERKUNFT_LABEL[herkunftCodeInput] ?? herkunftCodeInput}. `
    }
  }

  const notizenInput = (formData.get('notizen') as string) || null
  const notizen = notizenZusatz ? [notizenInput, notizenZusatz.trim()].filter(Boolean).join('\n') : notizenInput

  // bestand_flaschen wird hier NICHT mehr aus dem Formular geschrieben (KAN-35: kein Lost
  // Update gegenüber Verkäufen, kein „0 → Anzahl“-Fehler). Korrekturen: bestandKorrigieren.
  const payload: AR = {
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(dezimal(formData.get('jahrgang') as string)) || null,
    rebsorte:             (formData.get('rebsorte') as string) || null,
    qualitaet:            formData.get('qualitaet') as string,
    herkunft_code:        herkunftCodeInput,
    anbaugebiet:          (formData.get('anbaugebiet') as string) || null,
    bezeichnung:          (formData.get('bezeichnung') as string) || null,
    datum:                formData.get('datum') as string,
    vk_preis_brutto:      parseFloat(dezimal(formData.get('vk_preis_brutto') as string)) || null,
    weinausbau_id:        weinausbauId,
    einstandspreis:       parseFloat(dezimal(formData.get('einstandspreis') as string)) || null,
    zolltarifnummer:      (formData.get('zolltarifnummer') as string) || null,
    notizen:              notizen,
    aktualisiert_am:      new Date().toISOString(),
  }
  if (mengenGeaendert) {
    // nur hier erreichbar ohne Verkäufe/Bestandsbuchungen (Sperre oben)
    payload.anzahl_flaschen      = anzahl
    payload.flaschengroesse_ml   = flGroesseML
    payload.menge_liter_gefuellt = mengeGefuellt
    // Tippfehler in der Anzahl: der Bestand zieht um dieselbe Differenz mit, damit
    // bestand = anzahl − Verkäufe + Bestandsbuchungen weiter stimmt
    if (anzahlGeaendert) {
      const neuBestand = Number(alt.bestand_flaschen) + (anzahl - altAnzahl)
      if (!(neuBestand >= 0)) {
        throw new AktionsFehler(`Die Anzahl kann nicht auf ${fmtNum(anzahl, 0)} gesenkt werden – der Flaschenbestand würde negativ.`)
      }
      payload.bestand_flaschen = neuBestand
    }
  }

  let upd = (supabase.from('fuellungen') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  // Mengenänderung nur, wenn seit dem Laden kein Verkauf/Storno den Bestand geändert hat
  if (mengenGeaendert) upd = upd.eq('bestand_flaschen', alt.bestand_flaschen)
  const { data: updData, error } = await upd.select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (fuellungen)'))
  if (!updData || (updData as AR[]).length === 0) {
    throw new AktionsFehler('Die Füllung wurde zwischenzeitlich geändert (z. B. durch einen Verkauf) – bitte die Seite neu laden und erneut speichern.')
  }
  revalidatePath('/weinhandel')
}

// Flaschenbestand korrigieren (KAN-35): datierte Bestandsbuchung statt Überschreiben

export async function bestandKorrigieren(fuellungId: string, formData: FormData): Promise<{ bestand: number }> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)

  const art = String(formData.get('art') ?? '')
  if (!istBewegungsart(art)) throw new AktionsFehler('Bitte eine Buchungsart wählen.')
  const artDef = BEWEGUNGSARTEN.find(a => a.value === art)!

  const datum = String(formData.get('datum') ?? '').slice(0, 10)
  if (!DATUM_RE.test(datum)) throw new AktionsFehler('Bitte ein gültiges Buchungsdatum angeben.')
  if (datum > heuteOrtsdatum()) throw new AktionsFehler('Das Buchungsdatum darf nicht in der Zukunft liegen.')

  const grund = String(formData.get('grund') ?? '').trim() || null
  if (artDef.grundPflicht && !grund) throw new AktionsFehler(`Bitte bei „${artDef.label}“ einen Grund angeben.`)

  const { data: f, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('datum')
    .eq('id', fuellungId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllung konnte nicht geladen werden'))
  if (!f) throw new AktionsFehler('Füllung nicht gefunden.')
  const abfuelldatum = (f as AR).datum ? String((f as AR).datum).slice(0, 10) : null
  if (abfuelldatum && datum < abfuelldatum) {
    throw new AktionsFehler(`Das Buchungsdatum liegt vor dem Abfülldatum (${datumDe(abfuelldatum)}).`)
  }

  // Aufruf mit Parameternamen über den Benutzer-Client (erstellt_von/Protokoll)
  const params: AR = {
    p_tenant_id:   tenantId,
    p_fuellung_id: fuellungId,
    p_art:         art,
    p_datum:       datum,
    p_grund:       grund,
  }
  if (art === 'inventur') {
    const ist = zahlAus(formData.get('ist_bestand'))
    if (ist === null || !Number.isInteger(ist) || ist < 0) {
      throw new AktionsFehler('Bitte den gezählten Ist-Bestand in ganzen Flaschen angeben (0 oder mehr).')
    }
    params.p_ist_bestand = ist
  } else {
    const menge = zahlAus(formData.get('menge'))
    if (menge === null || !Number.isInteger(menge) || menge === 0) {
      throw new AktionsFehler('Bitte die Menge in ganzen Flaschen angeben (ungleich 0).')
    }
    // Abgänge (Bruch, Eigenverbrauch, Schwund) werden als Stückzahl eingegeben → negativ buchen
    params.p_menge_stk = artDef.abgang ? -Math.abs(menge) : menge
  }

  const { data, error } = await (supabase.rpc as any)('fuellung_bestand_buchen', params)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Bestandskorrektur fehlgeschlagen'))

  revalidatePath('/weinhandel')
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/edit`)
  return { bestand: Number(data) }
}

// Restmenge einer Weinausbau-Charge als Schwund ausbuchen + Charge abschließen

export async function schwundAusbuchen(fuellungId: string): Promise<void> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)
  pruefeChargenRecht(membership)

  const { data: f, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('name, datum, weinausbau_id')
    .eq('id', fuellungId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllung konnte nicht geladen werden'))
  const weinausbauId = (f as AR | null)?.weinausbau_id as string | null
  if (!f || !weinausbauId) throw new AktionsFehler('Keine Charge verknüpft')
  // Nur, wenn diese Füllung tatsächlich von der Charge abgefüllt hat – eine nachträglich
  // zugeordnete Charge wurde nie gemindert, ihr Bestand ist kein Rest dieser Abfüllung
  if (await abgebuchteLiter(supabase, tenantId, fuellungId, weinausbauId) == null) {
    throw new AktionsFehler('Die Charge wurde dieser Füllung nachträglich zugeordnet – von ihr wurde beim Abfüllen nichts abgebucht, ihr Bestand ist also kein Rest dieser Abfüllung. Echten Schwund bitte auf der Chargen-Seite über „Schwund buchen“ erfassen.')
  }

  const { data: wa, error: waErr } = await (supabase.from('weinausbau') as any)
    .select('name, menge_liter, status')
    .eq('id', weinausbauId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (waErr) throw new AktionsFehler(dbFehlerText(waErr, 'Charge konnte nicht geladen werden'))
  if (!wa) throw new AktionsFehler('Die verknüpfte Charge wurde nicht gefunden.')
  const charge = wa as AR
  if (charge.status === 'abgeschlossen') {
    throw new AktionsFehler(`Die Charge „${charge.name}“ ist bereits abgeschlossen – es gibt nichts mehr auszubuchen.`)
  }

  const rest = r2(Number(charge.menge_liter ?? 0) || 0)
  if (rest >= 0.01) {
    // Datierte Schwundzeile (Abfülldatum dieser Füllung) + Charge abschließen, atomar
    const datum = (f as AR).datum ? String((f as AR).datum).slice(0, 10) : heuteOrtsdatum()
    const { error } = await (supabase.rpc as any)('schwund_buchen', {
      p_tenant_id:      tenantId,
      p_weinausbau_id:  weinausbauId,
      p_liter:          rest,
      p_datum:          DATUM_RE.test(datum) ? datum : heuteOrtsdatum(),
      p_notiz:          `Schwund-Ausbuchung Restmenge (Füllung „${(f as AR).name ?? ''}“)`,
      p_abschliessen:   true,
    })
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Schwund konnte nicht gebucht werden'))
  } else {
    // Kein messbarer Rest (< 0,01 L): nur abschließen
    const r = await chargeAktualisieren(supabase, tenantId, weinausbauId, charge.menge_liter,
      { menge_liter: 0, status: 'abgeschlossen', aktiv: false })
    if (!r.ok) throw new AktionsFehler(`Die Charge „${charge.name}“ konnte nicht abgeschlossen werden: ${r.meldung}`)
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
}

// Füllung deaktivieren („löschen“ im Weinhandel)
//
// KAN-35: nur ohne Verkäufe und Bestandsbuchungen. Zurückgebucht wird genau, was die
// Abfüllung von der Charge genommen hat: die Füllmenge (fuellung_chargen.anteil_liter) und –
// hat die Abfüllung die Charge mit „Abschließen“ beendet – die Abschluss-Schwundzeile derselben
// Füllung (Notiz beginnt mit ABFUELL_SCHWUND_NOTIZ, Datum der Füllung, direkt nach ihr erfasst).
// Die Schwundzeile wird dabei gelöscht (protokolliert), die Charge wieder aktiv. Wurde an der
// Charge seither weitergebucht, bleibt die Füllung stehen. Alles oder nichts: scheitert ein
// Schritt, werden die vorherigen zurückgenommen.

/** Abschluss-Schwund muss so kurz nach der Füllung erfasst sein (gleicher Vorgang createFuellung) */
const ABSCHLUSS_SCHWUND_FENSTER_MS = 10 * 60 * 1000

export async function deactivateFuellung(id: string): Promise<void> {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId
  pruefeFuellungsRecht(membership)

  const { data: fRaw, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('name, aktiv, datum, erstellt_am, bestand_flaschen, weinausbau_id, menge_liter_gefuellt')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllung konnte nicht geladen werden'))
  if (!fRaw) throw new AktionsFehler('Füllung nicht gefunden.')
  const f = fRaw as AR
  if (!f.aktiv) {
    // schon entfernt (z. B. Doppelklick) – nichts doppelt zurückbuchen
    revalidatePath('/weinhandel')
    return
  }

  // KAN-35: Sperre bei Folgebuchungen – Verkäufe/Bestandsbuchungen bleiben sonst ohne Füllung
  const fb = await folgebuchungenDerFuellung(supabase, tenantId, id)
  if (fb.verkaeufe > 0 || fb.bewegungen > 0) {
    throw new AktionsFehler(
      `Die Füllung „${f.name}“ kann nicht gelöscht werden: Es gibt bereits ${folgebuchungenFuellungText(fb)}. ` +
      'Die Füllung bleibt als Historie erhalten. Ausverkaufte Füllungen lassen sich in der Lagerliste ausblenden; ' +
      'Abweichungen im Flaschenbestand bitte in der Füllungsbearbeitung über „Bestand korrigieren“ buchen.'
    )
  }

  // Zurückgebucht wird genau, was createFuellung von der Charge abgebucht hat
  // (fuellung_chargen.anteil_liter). Nachträglich zugeordnete Chargen wurden nie gemindert.
  type Rueck = { chargeId: string; liter: number; schwund: AR | null; schwundLiter: number; charge: AR; mengeNachher: number }
  let rueck: Rueck | null = null
  if (f.weinausbau_id) {
    const abgebucht = await abgebuchteLiter(supabase, tenantId, id, f.weinausbau_id as string)
    const liter = abgebucht ?? 0
    if (liter > 0) {
      pruefeChargenRecht(membership)
      const { data: wa, error: waErr } = await (supabase.from('weinausbau') as any)
        .select('name, menge_liter, status, aktiv')
        .eq('id', f.weinausbau_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (waErr) throw new AktionsFehler(dbFehlerText(waErr, 'Charge konnte nicht geladen werden'))
      if (!wa) throw new AktionsFehler('Die verknüpfte Charge wurde nicht gefunden – die Liter können nicht zurückgebucht werden.')
      const charge = wa as AR

      // Abschluss-Schwund dieser Abfüllung (createFuellung → schwund_buchen, früher direkt)
      const { data: swRaw, error: swErr } = await (supabase.from('keller_umzuege') as any)
        .select('id, datum, erstellt_am, brutto_liter, schwund_liter, notizen')
        .eq('tenant_id', tenantId)
        .eq('von_weinausbau_id', f.weinausbau_id)
        .eq('umzug_typ', 'schwund')
        .gte('erstellt_am', f.erstellt_am)
        .ilike('notizen', `${ABFUELL_SCHWUND_NOTIZ}%`)
      if (swErr) throw new AktionsFehler(dbFehlerText(swErr, 'Schwundbuchungen der Charge konnten nicht geprüft werden'))
      const fuellungMs = Date.parse(String(f.erstellt_am ?? ''))
      const kandidaten = ((swRaw ?? []) as AR[]).filter(z => {
        const ms = Date.parse(String(z.erstellt_am ?? ''))
        return String(z.datum ?? '').slice(0, 10) === String(f.datum ?? '').slice(0, 10)
          && Number.isFinite(ms) && Number.isFinite(fuellungMs) && ms - fuellungMs <= ABSCHLUSS_SCHWUND_FENSTER_MS
      })
      if (kandidaten.length > 1) {
        throw new AktionsFehler(`Die Füllung „${f.name}“ kann nicht automatisch gelöscht werden: Zur Abfüllung gibt es mehrere Abschluss-Schwundbuchungen an der Charge „${charge.name}“. Bitte Support kontaktieren.`)
      }
      const schwund = kandidaten[0] ?? null
      const schwundLiter = schwund ? r2(Number(schwund.brutto_liter ?? 0) || Number(schwund.schwund_liter ?? 0) || 0) : 0
      if (schwund) {
        // Nur, wenn an der Charge seit dem Abschluss nichts mehr gebucht wurde
        const spaeter = await spaetereMengenbewegungen(supabase, tenantId, f.weinausbau_id as string, String(schwund.erstellt_am), {
          umzugZeilenIds: [schwund.id as string],
        })
        if (spaeter.length > 0) {
          throw new AktionsFehler(
            `Die Füllung „${f.name}“ kann nicht gelöscht werden: Beim Abfüllen wurde die Charge „${charge.name}“ mit ${fmtNum(schwundLiter, 2)} L Schwund abgeschlossen, ` +
            `seither wurde an der Charge weitergebucht (${folgebuchungenText(spaeter)}). Die Füllung bleibt als Historie erhalten – Korrekturen bitte als eigene, datierte Buchung erfassen.`
          )
        }
      }
      rueck = {
        chargeId: f.weinausbau_id as string, liter, schwund, schwundLiter, charge,
        mengeNachher: r2((Number(charge.menge_liter ?? 0) || 0) + liter + schwundLiter),
      }
    }
  }

  /** Rückbuchung auf die Charge zurücknehmen; liefert einen Warnhinweis, wenn das scheitert */
  const chargeZuruecksetzen = async (): Promise<string> => {
    if (!rueck) return ''
    const r = await chargeAktualisieren(supabase, tenantId, rueck.chargeId, rueck.mengeNachher, {
      menge_liter: rueck.charge.menge_liter ?? null, status: rueck.charge.status, aktiv: rueck.charge.aktiv,
    })
    return r.ok ? '' : ` – Achtung: ${fmtNum(rueck.liter + rueck.schwundLiter, 2)} L wurden bereits auf die Charge „${rueck.charge.name}“ zurückgebucht und konnten nicht zurückgenommen werden (${r.meldung}). Bitte den Bestand der Charge prüfen.`
  }

  // 1. Liter (und Abschluss-Schwund) auf die Charge zurückbuchen und den Status konsistent
  //    machen (Menge > 0 → aktiv, nicht abgeschlossen). Zuerst, weil hier die Gebinde-Prüfung greifen kann.
  if (rueck) {
    const werte: AR = { menge_liter: rueck.mengeNachher, aktiv: true }
    if (rueck.charge.status === 'abgeschlossen') werte.status = 'abfuellung'
    const r = await chargeAktualisieren(supabase, tenantId, rueck.chargeId, rueck.charge.menge_liter, werte)
    if (!r.ok) {
      // weinausbau_gebinde_pruefen (P0001): Gebinde inzwischen durch einen anderen Betrieb belegt
      const grund = r.code === 'P0001'
        ? `${r.meldung.replace(/[.\s]+$/, '')}. Bitte die Charge zuerst einem freien Gebinde zuordnen oder das Gebinde freimachen.`
        : r.meldung
      throw new AktionsFehler(
        `Die Füllung „${f.name}“ kann nicht gelöscht werden, weil die ${fmtNum(rueck.liter + rueck.schwundLiter, 2)} L nicht auf die Charge „${rueck.charge.name}“ zurückgebucht werden konnten: ${grund}`
      )
    }
  }

  // 2. Füllung deaktivieren – nur, wenn seit der Prüfung kein Verkauf den Bestand geändert hat
  const { data: dData, error } = await (supabase.from('fuellungen') as any)
    .update({ aktiv: false, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true)
    .eq('bestand_flaschen', f.bestand_flaschen)
    .select('id')
  if (error || !dData || (dData as AR[]).length === 0) {
    const meldung = error
      ? dbFehlerText(error, 'Löschen fehlgeschlagen (fuellungen)')
      : 'Die Füllung wurde zwischenzeitlich geändert (z. B. durch einen Verkauf) – bitte die Seite neu laden.'
    throw new AktionsFehler(`${meldung}${await chargeZuruecksetzen()}`)
  }

  // 3. Abschluss-Schwundzeile löschen (protokolliert) – ihre Liter sind oben zurückgebucht
  if (rueck?.schwund) {
    const { data: sDel, error: sErr } = await (supabase.from('keller_umzuege') as any)
      .delete()
      .eq('id', rueck.schwund.id)
      .eq('tenant_id', tenantId)
      .select('id')
    if (sErr || !(sDel as AR[] | null)?.length) {
      const meldung = sErr
        ? dbFehlerText(sErr, 'Die Abschluss-Schwundbuchung konnte nicht gelöscht werden')
        : 'Die Abschluss-Schwundbuchung konnte nicht gelöscht werden – vermutlich fehlt die Berechtigung.'
      // Füllung wieder aktiv, Charge zurück – es bleibt nichts halb
      const { data: reakt, error: reErr } = await (supabase.from('fuellungen') as any)
        .update({ aktiv: true, aktualisiert_am: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .eq('aktiv', false)
        .select('id')
      const fuellungHinweis = reErr || !(reakt as AR[] | null)?.length
        ? ` – Achtung: Die Füllung ist bereits deaktiviert und konnte nicht wieder aktiviert werden (${reErr ? dbFehlerText(reErr) : 'keine Berechtigung'}). Bitte Support kontaktieren.`
        : ''
      throw new AktionsFehler(`${meldung.replace(/[.\s]+$/, '')}. Die Füllung wurde nicht gelöscht${fuellungHinweis}${await chargeZuruecksetzen()}`)
    }
  }

  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  if (f.weinausbau_id) revalidatePath(`/kellerbuch/weinausbau/${f.weinausbau_id}`)
}
