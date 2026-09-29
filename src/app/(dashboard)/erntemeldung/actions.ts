'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { kmwZuQualitaet } from '@/lib/weinqualitaet'
import { abstufungFehler, qualitaetFehler } from '@/lib/wein/qualitaet'
import { findePassendeHerkunftsstufe, HERKUNFT_LABEL, minHerkunft } from '@/lib/herkunft'
import { createVerkaufspostenFuerTrauben, ermittleQuellenName, upsertTraubenverkauf } from '@/app/(dashboard)/weinhandel/traubenverkauf/actions'
import { stornoVerkauf } from '@/app/(dashboard)/weinhandel/verkauf/actions'
import { getCurrentMembership, canAdmin, type Membership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText, LESE_WAEHLEN_MELDUNG } from '@/lib/fehler'
import { dezimal, fmtNum, zahlAus } from '@/lib/format'
import { folgebuchungenDerCharge, folgebuchungenText, sperreBeiFolgebuchungen } from '@/lib/kellerbuch/folgebuchungen'
import { GEBINDEWECHSEL_OHNE } from '@/lib/kellerbuch/storno'
import { KORREKTUR_NACH_OBEN_HINWEIS } from '@/lib/kellerbuch/hinweise'
import { aggregiereJeRebsorte, KG_JE_HL, ladeLesedaten, parzelleFuerMeldung, teileNachStichtag } from '@/lib/behoerden/erntemeldung'
import { runden, STELLEN } from '@/lib/csv'
import { mostgewichtAusFormular, mostgewichtAusWert, mostgewichtSpalten } from '@/lib/wein/mostgewichtFormular'
import type { Mostgewicht } from '@/lib/wein/mostgewicht'
import { istErntebar, leseZiele, verteileKg, type LeseGst, type LeseZiel } from '@/lib/wein/leseErfassung'
import { lesedatumFehler, behaelterPruefung } from '@/lib/wein/pressungLesedatum'
import { eisweinHinweis, istLeseArt, jahrgangAusEingabe, leseLoeschsperre, leseStufe, leseZeitraumFehler } from '@/lib/wein/lesen'
import { ladeLesenDesJahrgangs, leseDeckungFehler, leseFuerDatum, traubenverkaufLese } from '@/lib/wein/leseBilanz'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getMembership(): Promise<Membership> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership
}

async function getTenantId(): Promise<string> {
  return (await getMembership()).tenantId
}

// ── Hilfen für Meldungen und Eingaben (KAN-35) ───────────────────────────────

function datumText(d: string | null | undefined): string {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function literText(n: number | null | undefined): string {
  return n == null ? '–' : `${fmtNum(n, { max: 2 })} L`
}

function kgText(n: number): string {
  return `${fmtNum(n, { max: 1 })} kg`
}

/** Zahl aus JSON-Eingabe (number oder Text) – leer/ungültig → null */
function zahlOderNull(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  return zahlAus(v)
}

/** Formular-/JSON-Wert leer (null, undefined, nur Leerzeichen)? */
function leerOderNull(v: unknown): boolean {
  return v == null || String(v).trim() === ''
}

function textOderNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function runde2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Jahrgang muss zum aktiven Mandanten gehören (ernte_parzellen/pressung_* haben keine tenant_id) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ladeJahrgang(supabase: any, tenantId: string, jahrgangId: string): Promise<AR> {
  const { data, error } = await (supabase.from('weinjahrgaenge') as any)
    .select('id, jahrgang').eq('id', jahrgangId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Jahrgang konnte nicht geladen werden'))
  if (!data) throw new AktionsFehler('Jahrgang nicht gefunden – bitte die Seite neu laden.')
  return data as AR
}


// ── Jahrgänge ─────────────────────────────────────────────────────────────────

/** KAN-129: `vorhandenId` = der schon bestehende Jahrgang des Betriebs (nur bei 23505),
 *  damit das Formular dorthin verlinkt; `error` bleibt für bisherige Aufrufer gesetzt. */
export async function createJahrgang(formData: FormData): Promise<{ error?: string; vorhandenId?: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const jahrgang = Number(dezimal(formData.get('jahrgang')))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).insert({
    tenant_id:   tenantId,
    jahrgang,
    ernte_beginn: (formData.get('ernte_beginn') as string) || null,
    ernte_ende:   (formData.get('ernte_ende') as string) || null,
    notizen:      (formData.get('notizen') as string) || null,
  })
  if (error) {
    // 23505 = unique_violation (unique(tenant_id, jahrgang)) – verständliche Meldung statt Server-Crash
    if ((error as AR).code === '23505') {
      const meldung = `Jahrgang ${jahrgang} existiert bereits für diesen Betrieb.`
      // KAN-129: bestehenden Jahrgang nachladen, damit das Formular direkt dorthin führt
      // (die Lese wird am Jahrgang erfasst); schlägt das fehl, bleibt es bei der Meldung
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: vorhanden } = await (supabase.from('weinjahrgaenge') as any)
        .select('id').eq('tenant_id', tenantId).eq('jahrgang', jahrgang).maybeSingle()
      const vorhandenId = (vorhanden as AR | null)?.id as string | undefined
      return vorhandenId ? { error: meldung, vorhandenId } : { error: meldung }
    }
    return { error: (error as AR).message }
  }
  revalidatePath('/erntemeldung')
  return {}
}

export async function updateJahrgang(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // KAN-129: Beginn und Ende stehen an der Lese (updateLese); Felder, die das Formular nicht schickt
  // (z. B. witterungscharakter), bleiben unverändert statt auf NULL gesetzt zu werden
  const patch: AR = {}
  for (const feld of ['qualitaet_gesamt', 'witterungscharakter', 'notizen'] as const) {
    if (formData.has(feld)) patch[feld] = (formData.get(feld) as string) || null
  }
  if (Object.keys(patch).length === 0) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinjahrgaenge') as any).update(patch).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (weinjahrgaenge)'))
  revalidatePath('/erntemeldung')
  revalidatePath(`/erntemeldung/${id}`)
}

// ── Lesen (KAN-129) ───────────────────────────────────────────────────────────
// Ein Jahrgang je Betrieb, darunter Lesen mit lfd. Nr. (2026/1 Hauptlese, 2026/2 Eiswein …). Die Nummer
// vergibt die Datenbank (Trigger a_lesen_vor_schreiben), ein neuer Jahrgang bekommt Lese 1 per Trigger.

type LeseAngaben = { art: string; bezeichnung: string | null; beginn: string | null; ende: string | null; notizen: string | null }

function leseAngaben(formData: FormData, jahrgang: number): LeseAngaben {
  const art = String(formData.get('art') ?? 'hauptlese')
  if (!istLeseArt(art)) throw new AktionsFehler('Unbekannte Art der Lese – bitte aus der Liste wählen.')
  const bezeichnung = String(formData.get('bezeichnung') ?? '').trim() || null
  if (bezeichnung && bezeichnung.length > 100) throw new AktionsFehler('Die Bezeichnung der Lese ist zu lang (höchstens 100 Zeichen).')
  const beginn = String(formData.get('beginn') ?? '').trim() || null
  const ende = String(formData.get('ende') ?? '').trim() || null
  const zeitraum = leseZeitraumFehler(jahrgang, beginn, ende)
  if (zeitraum) throw new AktionsFehler(zeitraum)
  return { art, bezeichnung, beginn, ende, notizen: String(formData.get('notizen') ?? '').trim() || null }
}

/** Belegung einer Lese (Lese-Einträge, Pressungen, Traubenverkäufe) – für Löschsperre und „Lese 1 füllen“ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function leseBelegung(supabase: any, tenantId: string, jahrgangId: string, leseId: string) {
  const [ep, pr, tv] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('ernte_parzellen') as any).select('id', { count: 'exact', head: true })
      .eq('lese_id', leseId).eq('jahrgang_id', jahrgangId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pressungen') as any).select('id', { count: 'exact', head: true })
      .eq('lese_id', leseId).eq('tenant_id', tenantId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('traubenverkauf') as any).select('id', { count: 'exact', head: true })
      .eq('lese_id', leseId).eq('tenant_id', tenantId),
  ])
  for (const [tabelle, res] of [['ernte_parzellen', ep], ['pressungen', pr], ['traubenverkauf', tv]] as const) {
    if (res.error) throw new AktionsFehler(dbFehlerText(res.error, `Lese konnte nicht geprüft werden (${tabelle})`))
  }
  return {
    eintraege: (ep.count as number | null) ?? 0,
    pressungen: (pr.count as number | null) ?? 0,
    traubenverkaeufe: (tv.count as number | null) ?? 0,
  }
}

/**
 * „Neue Lese“: legt die Lese im Jahrgang an – gibt es den Jahrgang noch nicht, entsteht er mit (seine Lese 1
 * bekommt die Angaben). Hat ein bestehender Jahrgang nur eine leere, noch nie beschriebene Lese 1 (Übergang,
 * Jahrgang ohne Angaben), wird diese gefüllt statt eine zweite anzulegen.
 */
export async function neueLese(formData: FormData): Promise<{ error?: string; jahrgangId?: string; lfdNr?: number }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const jahrgang = jahrgangAusEingabe(formData.get('jahrgang'))
  if (jahrgang == null) return { error: 'Bitte einen gültigen Jahrgang (1900–2100) angeben.' }
  let angaben: LeseAngaben
  try { angaben = leseAngaben(formData, jahrgang) } catch (err) { return { error: (err as Error).message } }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ladeJg = async () => (supabase.from('weinjahrgaenge') as any)
    .select('id').eq('tenant_id', tenantId).eq('jahrgang', jahrgang).maybeSingle()
  const { data: jgVorhanden, error: jgErr } = await ladeJg()
  if (jgErr) return { error: dbFehlerText(jgErr, 'Jahrgang konnte nicht geladen werden') }
  let jahrgangId = (jgVorhanden as AR | null)?.id as string | undefined
  let jahrgangNeu = false
  if (!jahrgangId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neu, error } = await (supabase.from('weinjahrgaenge') as any)
      .insert({ tenant_id: tenantId, jahrgang }).select('id').single()
    if (error && (error as AR).code !== '23505') return { error: dbFehlerText(error, 'Jahrgang konnte nicht angelegt werden') }
    if (neu) { jahrgangId = (neu as AR).id as string; jahrgangNeu = true }
    else {
      // gleichzeitig angelegt (23505) – dann den bestehenden verwenden
      const { data: nochmal } = await ladeJg()
      jahrgangId = (nochmal as AR | null)?.id as string | undefined
      if (!jahrgangId) return { error: `Jahrgang ${jahrgang} konnte nicht angelegt werden – bitte die Seite neu laden.` }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawLesen, error: lErr } = await (supabase.from('lesen') as any)
    .select('id, lfd_nr, art, bezeichnung, beginn, ende, notizen').eq('jahrgang_id', jahrgangId).eq('tenant_id', tenantId)
  if (lErr) return { error: dbFehlerText(lErr, 'Lesen konnten nicht geladen werden') }
  const lesen = (rawLesen ?? []) as AR[]
  let fuellen: AR | null = null
  if (lesen.length === 1) {
    const l = lesen[0]
    const unbeschrieben = !l.beginn && !l.ende && !l.bezeichnung && !l.notizen && l.art === 'hauptlese'
    if (jahrgangNeu || (unbeschrieben && Object.values(await leseBelegung(supabase, tenantId, jahrgangId, l.id)).every(n => n === 0))) {
      fuellen = l
    }
  }

  let lfdNr: number
  if (fuellen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: upd, error } = await (supabase.from('lesen') as any)
      .update(angaben).eq('id', fuellen.id).eq('tenant_id', tenantId).select('lfd_nr')
    if (error) return { error: dbFehlerText(error, 'Speichern fehlgeschlagen (lesen)') }
    if (!(upd as AR[] | null)?.length) return { error: 'Die Lese konnte nicht gespeichert werden – keine Berechtigung. Bitte die Seite neu laden.' }
    lfdNr = (upd as AR[])[0].lfd_nr as number
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neu, error } = await (supabase.from('lesen') as any)
      .insert({ tenant_id: tenantId, jahrgang_id: jahrgangId, ...angaben }).select('lfd_nr').single()
    if (error || !neu) return { error: dbFehlerText(error, 'Speichern fehlgeschlagen (lesen)') }
    lfdNr = (neu as AR).lfd_nr as number
  }
  revalidatePath('/erntemeldung')
  revalidatePath(`/erntemeldung/${jahrgangId}`)
  return { jahrgangId, lfdNr }
}

/** Lese des aktiven Betriebs samt Jahrgang laden */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ladeLese(supabase: any, tenantId: string, leseId: string): Promise<AR> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('lesen') as any)
    .select('id, jahrgang_id, lfd_nr, jahrgang:weinjahrgaenge!lesen_jahrgang_fkey(jahrgang)')
    .eq('id', leseId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Lese konnte nicht geladen werden'))
  if (!data) throw new AktionsFehler('Lese nicht gefunden – bitte die Seite neu laden.')
  return data as AR
}

export async function updateLese(leseId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const lese = await ladeLese(supabase, tenantId, leseId)
  const angaben = leseAngaben(formData, Number(lese.jahrgang?.jahrgang))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: upd, error } = await (supabase.from('lesen') as any)
    .update(angaben).eq('id', leseId).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (lesen)'))
  if (!(upd as AR[] | null)?.length) throw new AktionsFehler('Die Lese konnte nicht gespeichert werden – keine Berechtigung. Bitte die Seite neu laden.')
  revalidatePath('/erntemeldung')
  revalidatePath(`/erntemeldung/${lese.jahrgang_id}`)
}

/** Löschen nur für Betriebsleiter (Entscheidung Jörgen 29.09.2026): höchste, leere Lese, nie die einzige */
export async function deleteLese(leseId: string): Promise<{ jahrgangId: string }> {
  const supabase = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId = membership.tenantId
  if (!canAdmin(membership.role)) throw new AktionsFehler('Lesen löschen dürfen nur Betriebsleiter (Admin).')
  const lese = await ladeLese(supabase, tenantId, leseId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawNr, error: nErr } = await (supabase.from('lesen') as any)
    .select('lfd_nr').eq('jahrgang_id', lese.jahrgang_id).eq('tenant_id', tenantId)
  if (nErr) throw new AktionsFehler(dbFehlerText(nErr, 'Lesen konnten nicht geladen werden'))
  const sperre = leseLoeschsperre(lese as { lfd_nr: number }, ((rawNr ?? []) as AR[]).map(r => r.lfd_nr as number),
    await leseBelegung(supabase, tenantId, lese.jahrgang_id, leseId))
  if (sperre) throw new AktionsFehler(sperre)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: del, error } = await (supabase.from('lesen') as any)
    .delete().eq('id', leseId).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Löschen fehlgeschlagen (lesen)'))
  if (!(del as AR[] | null)?.length) throw new AktionsFehler('Die Lese konnte nicht gelöscht werden – keine Berechtigung. Bitte die Seite neu laden.')
  revalidatePath('/erntemeldung')
  revalidatePath(`/erntemeldung/${lese.jahrgang_id}`)
  return { jahrgangId: lese.jahrgang_id as string }
}

/**
 * Lese für einen NEUEN Lese-Eintrag bzw. eine neue Pressung aus dem Formular (Feld lese_id, der gewählte
 * Reiter der Jahrgangsseite). Muss zum Jahrgang und Betrieb gehören. Ohne Angabe null – dann ordnet die
 * Datenbank zu (eine Lese → diese, sonst nach Datum, notfalls Fehler „bitte die Lese wählen“).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function leseFuerNeuenEintrag(supabase: any, tenantId: string, jahrgangId: string, formData: FormData): Promise<string | null> {
  const leseId = String(formData.get('lese_id') ?? '').trim()
  if (!leseId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('lesen') as any)
    .select('id').eq('id', leseId).eq('jahrgang_id', jahrgangId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Lese konnte nicht geladen werden'))
  if (!data) throw new AktionsFehler('Die gewählte Lese gehört nicht zu diesem Jahrgang oder wurde gelöscht – bitte die Seite neu laden.')
  return leseId
}

// ── Ernte-Parzellen ───────────────────────────────────────────────────────────

export async function upsertErnteParzelle(jahrgangId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const weingartenId = formData.get('weingarten_id') as string
  // KAN-73: nur Lese-Stufen (LESE_QUALITAETEN = CHECK ernte_parzellen) – verständliche Meldung statt 23514
  const qualitaetsstufe = (formData.get('qualitaetsstufe') as string) || null
  const qualitaetUnzulaessig = qualitaetFehler('lese', qualitaetsstufe)
  if (qualitaetUnzulaessig) throw new AktionsFehler(qualitaetUnzulaessig)
  // KAN-128: Mostgewicht aus Messwert und Einheit (versteckte Felder der Eingabe, übergangsweise das
  // alte Feld klosterneuburger als °KMW) – beide Werte serverseitig gerechnet. Die Stufe bleibt, wie
  // im Formular gewählt („Lese bearbeiten“, Rechenregel 6). Löschen = beide Spalten NULL.
  const mostgewicht = mostgewichtAusFormular(formData, 'mostgewicht', { altesFeld: 'klosterneuburger' })
  if (!mostgewicht.ok) throw new AktionsFehler(mostgewicht.fehler)
  // dezimal() ist nötig, da Zahlen mit Komma-Dezimaltrennzeichen erfasst werden (de-AT) -
  // ohne die Ersetzung liefert Number() bei "9,5" NaN.
  const mengeKg = formData.get('menge_kg') ? Number(dezimal((formData.get('menge_kg') as string))) : null
  const mengeHl = mengeKg ? mengeKg / 130 : null  // 1 hl ≈ 130 kg
  const grundstueckId = (formData.get('grundstueck_id') as string) || null

  // Herkunft-Code (BKI) vom Grundstück übernehmen + Sortenspiegel-Abstufung, falls die
  // gelesene Rebsorte auf der GST-Stufe nicht zulässig ist (nur Abstufung, nie Aufstufung).
  let herkunftCode: string | null = null
  let notizenZusatz = ''
  if (grundstueckId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gst } = await (supabase.from('grundstuecke') as any)
      .select('trauben_herkunft_code, rebsorte').eq('id', grundstueckId).eq('tenant_id', tenantId).maybeSingle()
    const gstHerkunft = (gst as AR | null)?.trauben_herkunft_code as string | null ?? null
    const gstRebsorte = (gst as AR | null)?.rebsorte as string | null ?? null
    const passend = findePassendeHerkunftsstufe(gstHerkunft, gstRebsorte)
    herkunftCode = passend.code
    if (passend.abgestuft && gstHerkunft) {
      notizenZusatz = `Herkunft-Code automatisch abgestuft von ${HERKUNFT_LABEL[gstHerkunft] ?? gstHerkunft} auf ${HERKUNFT_LABEL[passend.code ?? ''] ?? passend.code} (Sortenspiegel: ${gstRebsorte ?? 'unbekannte Rebsorte'})`
    }
  }
  const notizenInput = (formData.get('notizen') as string) || null
  const notizen = notizenZusatz ? [notizenInput, notizenZusatz].filter(Boolean).join('\n') : notizenInput

  const payload: AR = {
    jahrgang_id:      jahrgangId,
    weingarten_id:    weingartenId,
    ernte_datum:      (formData.get('ernte_datum') as string) || null,
    menge_kg:         mengeKg,
    menge_hl:         mengeHl,
    // beide Werte und die gemessene Einheit – ein Formular ohne Mostgewicht-Feld lässt das
    // gespeicherte stehen (vorher schrieb das leere Hidden-Feld oechsle immer NULL)
    ...(mostgewicht.uebermittelt || !formData.get('existing_id') ? mostgewichtSpalten(mostgewicht.wert, 'klosterneuburger') : {}),
    qualitaetsstufe:  qualitaetsstufe,
    herkunft_code:    herkunftCode,
    lesemethode:      (formData.get('lesemethode') as string) || null,
    notizen:          notizen,
    grundstueck_id:   grundstueckId,
  }

  await ladeJahrgang(supabase, tenantId, jahrgangId)
  const existingId = formData.get('existing_id') as string | null
  if (existingId) {
    // KAN-35: Lesemenge nicht unter das bereits Verpresste/Verkaufte senken bzw. verschieben
    const alt = await ladeErnteParzelle(supabase, existingId, jahrgangId)
    await pruefeLesedatumNichtVerpresst(supabase, tenantId, jahrgangId, alt, (payload.ernte_datum as string | null) ?? null)
    await pruefeLesemengeGedeckt(supabase, tenantId, jahrgangId, alt,
      { weingarten_id: weingartenId, grundstueck_id: grundstueckId, menge_kg: mengeKg }, 'Ändern der Lesedaten')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: upd, error } = await (supabase.from('ernte_parzellen') as any)
      .update(payload).eq('id', existingId).eq('jahrgang_id', jahrgangId).select('id')
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (ernte_parzellen)'))
    if (!(upd as AR[] | null)?.length) throw new AktionsFehler('Die Lesedaten konnten nicht gespeichert werden – keine Berechtigung oder der Eintrag wurde inzwischen gelöscht. Bitte die Seite neu laden.')
  } else {
    // KAN-129: neuer Eintrag an die gewählte Lese; beim Bearbeiten bleibt die Lese unverändert
    const leseId = await leseFuerNeuenEintrag(supabase, tenantId, jahrgangId, formData)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('ernte_parzellen') as any).insert(leseId ? { ...payload, lese_id: leseId } : payload)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (ernte_parzellen)'))
  }
  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

// ── Lesemenge gegen Verpresstes/Verkauftes prüfen (KAN-35, 24.09.2026) ───────
// Lese-Einträge (ernte_parzellen) sind die Grundlage der verfügbaren kg für
// Pressung und Traubenverkauf (gleiche Rechnung wie erntemeldung/[id]/page.tsx:
// je GST und je Ried: geerntet − verpresst − verkauft). Ein Eintrag darf nur
// gelöscht, gemindert oder auf eine andere Ried/GST umgehängt werden, wenn das
// bereits Verpresste und Verkaufte danach noch gedeckt ist – sonst Sperre.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ladeErnteParzelle(supabase: any, id: string, jahrgangId: string): Promise<AR> {
  const { data, error } = await (supabase.from('ernte_parzellen') as any)
    .select('id, lese_id, weingarten_id, grundstueck_id, menge_kg, ernte_datum, weingarten:weingarten_id(name), grundstueck:grundstueck_id(gst_nr)')
    .eq('id', id).eq('jahrgang_id', jahrgangId).maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Lesedaten konnten nicht geladen werden'))
  if (!data) throw new AktionsFehler('Lesedaten nicht gefunden – bitte die Seite neu laden.')
  return data as AR
}

/**
 * KAN-126 (Entscheidung Jörgen 29.09.2026, offene Frage 4 „einfrieren“): Ist ein Lese-Eintrag schon verpresst –
 * eine Pressungszeile desselben Orts (Ortsregel wie die Lesetage der Pressung) trägt seinen Lesetag –, bleibt
 * sein Lesedatum fest. Sonst liefen Pressung (Snapshot pw.ernte_datum) und Erntemeldung auseinander.
 */
async function pruefeLesedatumNichtVerpresst(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, jahrgangId: string, alt: AR, neuesDatum: string | null,
): Promise<void> {
  const altesDatum = alt.ernte_datum ? String(alt.ernte_datum).slice(0, 10) : null
  if (!altesDatum || altesDatum === (neuesDatum ?? null)) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pRows, error: pErr } = await (supabase.from('pressungen') as any)
    .select('id, datum').eq('jahrgang_id', jahrgangId).eq('tenant_id', tenantId)
  if (pErr) throw new AktionsFehler(dbFehlerText(pErr, 'Pressungen konnten nicht geprüft werden'))
  const pressungen = (pRows ?? []) as AR[]
  if (pressungen.length === 0) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('pressung_weingaerten') as any)
    .select('pressung_id, grundstueck_id').in('pressung_id', pressungen.map(p => p.id))
    .eq('weingarten_id', alt.weingarten_id).eq('ernte_datum', altesDatum)
  if (alt.grundstueck_id) q = q.or(`grundstueck_id.eq.${alt.grundstueck_id},grundstueck_id.is.null`)
  const { data: pwRows, error: pwErr } = await q
  if (pwErr) throw new AktionsFehler(dbFehlerText(pwErr, 'Pressungen konnten nicht geprüft werden'))
  const treffer = ((pwRows ?? []) as AR[])[0]
  if (!treffer) return
  const pDatum = pressungen.find(p => p.id === treffer.pressung_id)?.datum as string | undefined
  throw new AktionsFehler(`Diese Lese vom ${datumText(altesDatum)} ist bereits verpresst${pDatum ? ` (Pressung vom ${datumText(pDatum)})` : ''} – ihr Lesedatum bleibt fest. `
    + 'Ist das Datum falsch, bitte zuerst die Pressung korrigieren (solange an ihren Chargen nichts gebucht ist).')
}

async function pruefeLesemengeGedeckt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  jahrgangId: string,
  alt: AR,
  neu: { weingarten_id: string | null; grundstueck_id: string | null; menge_kg: number | null } | null,
  aktion: string,
): Promise<void> {
  const altKg = Number(alt.menge_kg) || 0
  if (altKg <= 0) return
  const gleicheStelle = !!neu
    && neu.weingarten_id === alt.weingarten_id
    && (neu.grundstueck_id ?? null) === (alt.grundstueck_id ?? null)
  const neuKg = gleicheStelle ? (Number(neu!.menge_kg) || 0) : 0
  if (neuKg >= altKg) return                       // an der bisherigen Stelle wird nichts weniger
  const minderung = altKg - neuKg

  // KAN-129: Bilanz je Lese – nur Einträge, Pressungen und Traubenverkäufe derselben Lese
  const leseId = alt.lese_id as string
  const [parzRes, pressRes, tvRes] = await Promise.all([
    (supabase.from('ernte_parzellen') as any)
      .select('grundstueck_id, menge_kg').eq('jahrgang_id', jahrgangId).eq('lese_id', leseId).eq('weingarten_id', alt.weingarten_id),
    (supabase.from('pressungen') as any)
      .select('id').eq('jahrgang_id', jahrgangId).eq('lese_id', leseId).eq('tenant_id', tenantId),
    (supabase.from('traubenverkauf') as any)
      .select('grundstueck_id, menge_kg').eq('jahrgang_id', jahrgangId).eq('lese_id', leseId).eq('weingarten_id', alt.weingarten_id).eq('tenant_id', tenantId),
  ])
  for (const [tabelle, res] of [['ernte_parzellen', parzRes], ['pressungen', pressRes], ['traubenverkauf', tvRes]] as const) {
    if (res.error) throw new AktionsFehler(dbFehlerText(res.error, `Lesemenge konnte nicht geprüft werden (${tabelle})`))
  }
  const pressIds = ((pressRes.data ?? []) as AR[]).map(p => p.id as string)
  let pwZeilen: AR[] = []
  if (pressIds.length > 0) {
    const { data, error } = await (supabase.from('pressung_weingaerten') as any)
      .select('grundstueck_id, trauben_kg').in('pressung_id', pressIds).eq('weingarten_id', alt.weingarten_id)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Lesemenge konnte nicht geprüft werden (pressung_weingaerten)'))
    pwZeilen = (data ?? []) as AR[]
  }
  const parz = (parzRes.data ?? []) as AR[]
  const tv   = (tvRes.data ?? []) as AR[]
  const summe = (zeilen: AR[], feld: string, gst?: string) =>
    zeilen.filter(z => gst === undefined || z.grundstueck_id === gst).reduce((s, z) => s + (Number(z[feld]) || 0), 0)

  const riedName = (alt.weingarten as AR | null)?.name ?? 'dieser Ried'
  const pruefe = (stelle: string, geerntet: number, verbraucht: number) => {
    const danach = geerntet - minderung
    if (verbraucht > danach + 0.01) {
      throw new AktionsFehler(
        `${aktion} ist nicht möglich: Von ${stelle} sind bereits ${kgText(verbraucht)} verpresst bzw. als Trauben verkauft – `
        + `danach blieben nur ${kgText(Math.max(danach, 0))} Lesemenge. Bitte zuerst die Pressung bzw. den Traubenverkauf anpassen.`,
      )
    }
  }
  if (alt.grundstueck_id) {
    const gst = alt.grundstueck_id as string
    const gstNr = (alt.grundstueck as AR | null)?.gst_nr
    pruefe(`GST ${gstNr ?? '–'} (${riedName})`,
      summe(parz, 'menge_kg', gst),
      summe(pwZeilen, 'trauben_kg', gst) + summe(tv, 'menge_kg', gst))
  }
  pruefe(`der Ried „${riedName}“`,
    summe(parz, 'menge_kg'),
    summe(pwZeilen, 'trauben_kg') + summe(tv, 'menge_kg'))
}

// Mehrfacherfassung: eine Parzelle pro Weingarten mit gemeinsamen Feldern
export async function createMultipleErnteParzellen(jahrgangId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const weingartenIds = [...new Set((formData.getAll('weingarten_ids') as string[]).filter(Boolean))]

  type GSTEntry = {
    /** Grundstück – null nur für einen Weingarten ohne Grundstücke (Einzelerfassung, KAN-161) */
    gst_id: string | null; weingarten_id: string
    /** veraltet und ignoriert: die Verteilung rechnet mit der Fläche aus der Datenbank (KAN-161) */
    flaeche_ha?: number | null
    /** eigene Menge (Einzelerfassung, Assistent); ohne eigene Menge bekommt die Zeile ihren Anteil der Gesamtmenge */
    menge_kg?: number | string | null
    /** Mostgewicht je Grundstück (KAN-128): Messwert (Text wie eingegeben oder Zahl) und gemessene Einheit */
    mostgewicht_wert?: string | number | null; mostgewicht_einheit?: string | null
    /** älteres Format (vor KAN-128): °KMW als Zahl – gilt als °KMW-Messung */
    kmw?: number | null
    lesemethode?: string | null; notizen?: string | null
  }
  const gstJsonRaw = formData.get('grundstueck_json') as string | null
  let gstEntries: GSTEntry[] = []
  try { gstEntries = gstJsonRaw ? JSON.parse(gstJsonRaw) : [] } catch { throw new AktionsFehler('Die Grundstücksauswahl ist ungültig – bitte die Seite neu laden.') }
  if (!Array.isArray(gstEntries)) throw new AktionsFehler('Die Grundstücksauswahl ist ungültig – bitte die Seite neu laden.')

  if (weingartenIds.length === 0 && gstEntries.length === 0) {
    throw new AktionsFehler('Mindestens eine Ried oder ein Grundstück auswählen')
  }
  // ernte_parzellen hat keine tenant_id – der Jahrgang muss zum aktiven Betrieb gehören
  await ladeJahrgang(supabase, tenantId, jahrgangId)

  const ernteDatum  = (formData.get('ernte_datum') as string) || null
  const lesemethode = (formData.get('lesemethode') as string) || null
  // KAN-128: gemeinsames Mostgewicht (gilt für jede Zeile ohne eigenes) aus Messwert und Einheit
  // der Eingabe, übergangsweise das alte Feld klosterneuburger als °KMW – beide Werte serverseitig
  // gerechnet; eine ungültige Eingabe bricht ab, bevor etwas geschrieben wird.
  const gemeinsam = mostgewichtAusFormular(formData, 'mostgewicht', { altesFeld: 'klosterneuburger' })
  if (!gemeinsam.ok) throw new AktionsFehler(gemeinsam.fehler)
  const mgGemeinsam = gemeinsam.wert
  // Qualitätsstufe wird ausschließlich aus den °KMW abgeleitet (kein manuelles Formularfeld
  // mehr) - Fallback 'qualitaetswein', wenn kein Mostgewicht erfasst wurde. Eine mitgeschickte Stufe
  // (nur das Assistent-Tool ernte_erfassen schickt eine) wird wie bisher NICHT übernommen;
  // KAN-73: sie muss trotzdem eine Lese-Stufe sein (LESE_QUALITAETEN), sonst Abbruch.
  // KAN-128 (Rechenregeln 5 und 6): nur aus ausMessung().kmw, bei °Oe-Messung also aus dem
  // gespeicherten °KMW nach Variante B – nie aus einer ungerundeten Umrechnung.
  const qualitaetMitgeschickt = (formData.get('qualitaetsstufe') as string) || null
  const qualitaetUnzulaessig = qualitaetFehler('lese', qualitaetMitgeschickt)
  if (qualitaetUnzulaessig) throw new AktionsFehler(qualitaetUnzulaessig)
  const qualitaet   = mgGemeinsam ? kmwZuQualitaet(mgGemeinsam.kmw) : 'qualitaetswein'
  const notizen     = (formData.get('notizen') as string) || null
  // KAN-161: EINE Gesamtmenge für die ganze Auswahl – vorher bekam jede ganz gewählte Ried die volle Menge
  const mengeKgRaw  = formData.get('menge_kg')
  const mengeKg     = zahlOderNull(mengeKgRaw)
  if (!leerOderNull(mengeKgRaw) && mengeKg == null) throw new AktionsFehler('Die Menge ist keine gültige Zahl.')
  if (mengeKg != null && mengeKg < 0) throw new AktionsFehler('Die Menge darf nicht negativ sein.')

  // ── Stammdaten aus der Datenbank (Flächen, Nutzart, Weingarten) – nichts davon aus dem Formular ──
  const einzelIds = [...new Set(gstEntries.map(g => g.gst_id).filter((x): x is string => typeof x === 'string' && x !== ''))]
  const ohneGstWg = [...new Set(gstEntries.filter(g => !g.gst_id).map(g => g.weingarten_id).filter(Boolean))]
  const ganzOderOhneGst = [...new Set([...weingartenIds, ...ohneGstWg])]
  const gstSpalten = 'id, weingarten_id, gst_nr, flaeche_ha, nutzart, trauben_herkunft_code, rebsorte'
  const [ganzRes, einzelRes] = await Promise.all([
    ganzOderOhneGst.length > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (supabase.from('grundstuecke') as any).select(gstSpalten).in('weingarten_id', ganzOderOhneGst).eq('tenant_id', tenantId).order('gst_nr').order('id')
      : { data: [], error: null },
    einzelIds.length > 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (supabase.from('grundstuecke') as any).select(gstSpalten).in('id', einzelIds).eq('tenant_id', tenantId)
      : { data: [], error: null },
  ])
  if (ganzRes.error) throw new AktionsFehler(dbFehlerText(ganzRes.error, 'Grundstücke konnten nicht geladen werden'))
  if (einzelRes.error) throw new AktionsFehler(dbFehlerText(einzelRes.error, 'Grundstücke konnten nicht geladen werden'))
  const gstStammdatenMap = new Map<string, AR>()
  for (const g of [...(ganzRes.data ?? []), ...(einzelRes.data ?? [])] as AR[]) gstStammdatenMap.set(g.id, g)
  for (const id of einzelIds) {
    const g = gstStammdatenMap.get(id)
    if (!g) throw new AktionsFehler('Ein gewähltes Grundstück wurde nicht gefunden – bitte die Seite neu laden.')
    if (g.nutzart !== 'WI') throw new AktionsFehler(`GST ${g.gst_nr} ist kein Weingarten-Grundstück (Nutzart ${g.nutzart ?? '–'}) – dort wird nicht geerntet.`)
  }
  // Weingarten eines Grundstücks immer aus der Datenbank (nicht aus dem Formular)
  const wgVonGst = (id: string) => gstStammdatenMap.get(id)!.weingarten_id as string

  const wgIds = [...new Set([...ganzOderOhneGst, ...einzelIds.map(wgVonGst)])]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wgRows, error: wgFehler } = await (supabase.from('weingarten') as any)
    .select('id, name, flaeche_ha').in('id', wgIds).eq('tenant_id', tenantId)
  if (wgFehler) throw new AktionsFehler(dbFehlerText(wgFehler, 'Rieden konnten nicht geladen werden'))
  const wgMap = new Map<string, AR>(((wgRows ?? []) as AR[]).map(w => [w.id, w]))
  if (wgIds.some(id => !wgMap.has(id))) throw new AktionsFehler('Eine gewählte Ried wurde nicht gefunden – bitte die Seite neu laden.')

  // WI-Grundstücke je Weingarten; ganz gewählt werden nur erntebare Weingärten (lib/wein/leseErfassung.ts)
  const alleJeWg = new Map<string, AR[]>()
  for (const g of (ganzRes.data ?? []) as AR[]) alleJeWg.set(g.weingarten_id, [...(alleJeWg.get(g.weingarten_id) ?? []), g])
  const wiJeWg: Record<string, LeseGst[]> = {}
  for (const wgId of ganzOderOhneGst) {
    const alle = alleJeWg.get(wgId) ?? []
    const wi = alle.filter(g => g.nutzart === 'WI')
    const name = wgMap.get(wgId)?.name ?? 'Ried'
    if (!istErntebar(alle.length, wi.length)) {
      throw new AktionsFehler(`„${name}“ hat keine Grundstücke der Nutzart Weingarten (WI) – dort wird nicht geerntet.`)
    }
    if (ohneGstWg.includes(wgId) && alle.length > 0) {
      throw new AktionsFehler(`„${name}“ hat Grundstücke – bitte die Menge je Grundstück angeben.`)
    }
    wiJeWg[wgId] = wi.map(g => ({ id: g.id, flaeche_ha: g.flaeche_ha ?? null }))
  }
  for (const id of einzelIds) {
    const liste = wiJeWg[wgVonGst(id)] ?? []
    if (!liste.some(x => x.id === id)) wiJeWg[wgVonGst(id)] = [...liste, { id, flaeche_ha: gstStammdatenMap.get(id)!.flaeche_ha ?? null }]
  }
  const wgFlaeche: Record<string, number | null> = {}
  for (const [id, w] of wgMap) wgFlaeche[id] = w.flaeche_ha ?? null

  // Einzeln übergebene Zeilen (eigene Menge, Mostgewicht, Lesemethode, Notizen) je Grundstück bzw. Weingarten ohne Grundstück
  const zielSchluessel = (wgId: string, gstId: string | null) => gstId ?? `wg:${wgId}`
  const eintragJeZiel = new Map<string, GSTEntry>()
  for (const g of gstEntries) {
    eintragJeZiel.set(g.gst_id ? g.gst_id : zielSchluessel(g.weingarten_id, null), g)
  }

  // Mostgewicht und Menge je Grundstück (KAN-128): eigener Messwert, sonst das gemeinsame – alle vor dem Schreiben prüfen
  const mgJeGst = new Map<GSTEntry, Mostgewicht | null>()
  for (const g of gstEntries) {
    const bezeichnung = g.gst_id ? `GST ${gstStammdatenMap.get(g.gst_id)?.gst_nr ?? g.gst_id}` : `„${wgMap.get(g.weingarten_id)?.name ?? 'Ried'}“`
    const eigenes = g.mostgewicht_wert !== null && g.mostgewicht_wert !== undefined && String(g.mostgewicht_wert).trim() !== ''
      ? mostgewichtAusWert(g.mostgewicht_wert, g.mostgewicht_einheit, bezeichnung)
      : g.kmw !== null && g.kmw !== undefined ? mostgewichtAusWert(g.kmw, 'kmw', bezeichnung) : null
    if (eigenes && !eigenes.ok) throw new AktionsFehler(eigenes.fehler)
    mgJeGst.set(g, eigenes ? eigenes.wert : mgGemeinsam)
    const eigeneMenge = zahlOderNull(g.menge_kg)
    if (!leerOderNull(g.menge_kg) && eigeneMenge == null) throw new AktionsFehler(`${bezeichnung}: Die Menge ist keine gültige Zahl.`)
    if (eigeneMenge != null && eigeneMenge < 0) throw new AktionsFehler(`${bezeichnung}: Die Menge darf nicht negativ sein.`)
  }

  // KAN-161: Zielflächen der ganzen Auswahl; die Gesamtmenge geht nach Fläche (aus der Datenbank) auf alle
  // Zeilen ohne eigene Menge – dieselbe Rechnung wie die Vorschau im Formular
  const ziele = leseZiele(ganzOderOhneGst, einzelIds.map(id => ({ gst_id: id, weingarten_id: wgVonGst(id) })), wiJeWg, wgFlaeche)
  const eintragVon = (z: LeseZiel) => eintragJeZiel.get(zielSchluessel(z.weingarten_id, z.grundstueck_id))
  const mengen = ziele.map(z => zahlOderNull(eintragVon(z)?.menge_kg))
  const zuVerteilen = ziele.map((_, i) => i).filter(i => mengen[i] == null)
  if (mengeKg != null && zuVerteilen.length === 0) {
    throw new AktionsFehler('Alle gewählten Grundstücke haben eine eigene Menge – die Gesamtmenge würde nicht verteilt. Bitte eines von beiden leeren.')
  }
  const anteile = verteileKg(mengeKg, zuVerteilen.map(i => ziele[i].flaeche_ha))
  zuVerteilen.forEach((i, k) => { mengen[i] = anteile[k] })

  // KAN-129: alle Einträge an die gewählte Lese – ohne Angabe wie die Datenbank nach Datum; der Jahrgang
  // muss zum Betrieb gehören (N4). Eiswein-Lese → Stufe Eiswein statt der Ableitung aus den °KMW (Soll 2).
  const jgMehrfach = await ladeJahrgang(supabase, tenantId, jahrgangId)
  const leseGewaehlt = await leseFuerNeuenEintrag(supabase, tenantId, jahrgangId, formData)
  const lesenJg = await ladeLesenDesJahrgangs(supabase, tenantId, jahrgangId)
  const leseWirksam = leseGewaehlt
    ? lesenJg.find(l => l.id === leseGewaehlt) ?? null
    : leseFuerDatum(lesenJg, Number(jgMehrfach.jahrgang), ernteDatum)
  const leseId = leseWirksam?.id ?? null
  const base = { jahrgang_id: jahrgangId, ernte_datum: ernteDatum, ...(leseId ? { lese_id: leseId } : {}) }
  const rows: AR[] = ziele.map((z, i) => {
    const eintrag = eintragVon(z)
    const perMg = eintrag ? (mgJeGst.get(eintrag) ?? null) : mgGemeinsam
    const perQualitaet = leseStufe(leseWirksam?.art, perMg ? kmwZuQualitaet(perMg.kmw) : qualitaet)
    const perLesemethode = eintrag?.lesemethode || lesemethode
    const perNotizen = eintrag?.notizen || notizen
    const kg = mengen[i]
    const zeile: AR = {
      ...base,
      weingarten_id: z.weingarten_id, grundstueck_id: z.grundstueck_id,
      menge_kg: kg, menge_hl: kg != null ? kg / 130 : null,
      ...mostgewichtSpalten(perMg, 'klosterneuburger'), qualitaetsstufe: perQualitaet, lesemethode: perLesemethode, notizen: perNotizen,
    }
    // Weingarten ohne Grundstück: kein GST-Herkunft-Code verfügbar
    if (z.grundstueck_id) {
      const gstStamm = gstStammdatenMap.get(z.grundstueck_id)
      const passend = findePassendeHerkunftsstufe(gstStamm?.trauben_herkunft_code ?? null, gstStamm?.rebsorte ?? null)
      zeile.herkunft_code = passend.code
      if (passend.abgestuft) {
        zeile.notizen = [perNotizen, `Herkunft-Code automatisch abgestuft auf ${HERKUNFT_LABEL[passend.code ?? ''] ?? passend.code} (Sortenspiegel: ${gstStamm?.rebsorte ?? 'unbekannte Rebsorte'})`].filter(Boolean).join('\n')
      }
    }
    return zeile
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('ernte_parzellen') as any).insert(rows)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (ernte_parzellen)'))
  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

export async function deleteErnteParzelle(id: string, jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  await ladeJahrgang(supabase, tenantId, jahrgangId)
  // KAN-35: nicht löschen, was schon verpresst oder als Trauben verkauft ist
  const alt = await ladeErnteParzelle(supabase, id, jahrgangId)
  await pruefeLesemengeGedeckt(supabase, tenantId, jahrgangId, alt, null, 'Löschen der Lesedaten')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: del, error } = await (supabase.from('ernte_parzellen') as any)
    .delete().eq('id', id).eq('jahrgang_id', jahrgangId).select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Löschen fehlgeschlagen (ernte_parzellen)'))
  // RLS löscht ohne Berechtigung still 0 Zeilen
  if (!(del as AR[] | null)?.length) throw new AktionsFehler('Die Lesedaten konnten nicht gelöscht werden – keine Berechtigung (Löschen ist Betriebsleitern vorbehalten) oder der Eintrag wurde inzwischen gelöscht. Bitte die Seite neu laden.')
  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

// ── AMA Meldung ───────────────────────────────────────────────────────────────

export async function createOrUpdateAMAMeldung(jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // ernte_parzellen hat keine tenant_id – erst den Jahrgang des aktiven Betriebs prüfen
  const jgMeldung = await ladeJahrgang(supabase, tenantId, jahrgangId)

  // Lesedaten über die gemeinsame Ladefunktion (Behördenmeldungen „Erntemeldung“/„Lesedaten“):
  // Druck, CSV-Vorschau und die hier gespeicherte Meldung rechnen damit gleich.
  // KAN-129: nur Lesegut bis zum Stichtag 30.11. (späteres gesondert, wie ladeErntemeldung)
  const lese = teileNachStichtag((await ladeLesedaten(supabase, jahrgangId)).zeilen, Number(jgMeldung.jahrgang)).bis
  // Weinbaugebiet steht nur am Ried – für die Meldung aus den geernteten Rieden ableiten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: parzellen, error: pFehler } = await (supabase.from('ernte_parzellen') as any)
    .select('id, weingarten:weingarten_id(weinbaugebiet)')
    .eq('jahrgang_id', jahrgangId)
  if (pFehler) throw new AktionsFehler(dbFehlerText(pFehler, 'Lesedaten konnten nicht geladen werden'))

  // Je Rebsorte wie Vorschau, Druck und CSV (lib/behoerden/erntemeldung.ts, aggregiereJeRebsorte)
  const summen = aggregiereJeRebsorte(lese.map(parzelleFuerMeldung))
  const gesamtKg = lese.reduce((s, p) => s + (p.mengeKg ?? 0), 0)
  // hl je Sorte: erfasst, sonst (auch bei nur teilweise erfassten hl) kg ÷ 130 – wie die Vorschau
  const hlJeSorte = (r: (typeof summen)[number]) => (r.hlGeschaetzt ? r.mengeKg / KG_JE_HL : r.mengeHl)
  const gesamtHl = runden(summen.reduce((s, r) => s + hlJeSorte(r), 0), STELLEN.hl)

  // Betriebsnummer liegt auf tenant_einstellungen (nicht auf tenants); Weinbaugebiet gibt es
  // nur auf Ried-/Grundstücksebene – aus den geernteten Rieden ableiten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('betrieb_betriebsnummer').eq('tenant_id', tenantId).maybeSingle()
  const weinbaugebiete = [...new Set(
    ((parzellen as AR[] ?? []).map(p => (p.weingarten as AR | null)?.weinbaugebiet).filter(Boolean))
  )] as string[]
  const tenant = {
    betriebsnummer: (einst as AR | null)?.betrieb_betriebsnummer ?? null,
    weinbaugebiet:  weinbaugebiete.length === 1 ? weinbaugebiete[0] : (weinbaugebiete[0] ?? null),
  }

  // Meldung anlegen oder aktualisieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from('ama_erntemeldungen') as any)
    .select('id').eq('jahrgang_id', jahrgangId).eq('tenant_id', tenantId).maybeSingle()

  const meldungPayload: AR = {
    tenant_id:       tenantId,
    jahrgang_id:     jahrgangId,
    betriebsnummer:  (tenant as AR)?.betriebsnummer ?? null,
    weinbaugebiet:   (tenant as AR)?.weinbaugebiet ?? null,
    gesamtmenge_kg:  gesamtKg,
    gesamtmenge_hl:  gesamtHl,
    status:          'bereit',
  }

  let meldungId: string
  if (existing) {
    meldungId = (existing as AR).id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { error: e } = await (supabase.from('ama_erntemeldungen') as any).update(meldungPayload).eq('id', meldungId).eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (ama_erntemeldungen): ${e.message}`) }
    // Positionen löschen und neu aufbauen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { error: e } = await (supabase.from('ama_meldepositionen') as any).delete().eq('meldung_id', meldungId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (ama_meldepositionen): ${e.message}`) }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neu } = await (supabase.from('ama_erntemeldungen') as any)
      .insert(meldungPayload).eq('tenant_id', tenantId).select('id').single()
    meldungId = (neu as AR).id
  }

  // Positionen je Rebsorte (lib/behoerden/erntemeldung.ts, aggregiereJeRebsorte):
  // Rebsorte vom Grundstück, sonst vom Ried; die Fläche ist die des Grundstücks (falls
  // gesetzt), NICHT die volle Ried-Fläche, und zählt je Grundstück nur einmal – auch bei
  // mehreren Lesedurchgängen auf demselben Grundstück.
  // Seit 25.09.2026 (Review): Qualitätsstufe aus den Lesedaten, wenn die Sorte genau eine hat
  // (sonst leer – die Erntemeldung weist darauf hin), statt fest 'qualitaetswein'; menge_hl
  // mit den erfassten hl (leer, wenn nicht alle Lesen hl haben → Ausgabe kg ÷ 130). So zeigt
  // die gespeicherte Meldung dieselben Werte wie die Vorschau aus den Lesedaten.
  const positionen = summen.map(r => ({
    meldung_id:      meldungId,
    rebsorte_name:   r.rebsorte,
    flaeche_ha:      r.flaecheHa,
    menge_kg:        r.mengeKg,
    menge_hl:        r.hlGeschaetzt ? null : runden(r.mengeHl, STELLEN.hl),
    qualitaetsstufe: r.qualitaetsstufen.length === 1 ? r.qualitaetsstufen[0] : null,
  }))

  if (positionen.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { error: e } = await (supabase.from('ama_meldepositionen') as any).insert(positionen)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (ama_meldepositionen): ${e.message}`) }
  }

  revalidatePath(`/erntemeldung/${jahrgangId}`)
}

// ── Pressungen ────────────────────────────────────────────────────────────────
// KAN-35 (24.09.2026, Übergang bis zum Journal AP3): Pressungszeilen haben stabile IDs.
// Beim Bearbeiten werden bestehende Zeilen gezielt geändert (UPDATE), neue angelegt
// (INSERT) und fehlende erst nach Regelprüfung entfernt. Bisher wurde alles gelöscht
// und neu eingefügt: neue IDs, verlorene pw.ernte_datum/kmw, gekappte Verkaufsverweise
// und Chargen, deren Bestand auf die Pressmenge zurückgesetzt wurde.
// pressung_behaelter.menge_liter ist die ZUGANGSMENGE der Charge (Bewegungsbuch,
// v_behaelter_fuellstand), weinausbau.menge_liter ihr aktueller Bestand:
//   - Mostmenge ändern: nur ohne mengenwirksame Folgebuchungen (Umzug, Schwund,
//     Verschnitt, Füllung, Tankverkauf, Zukauf) – die Charge ändert sich um die Differenz
//   - Behälter wechseln: nur ohne Folgebuchungen – die Charge zieht mit
//   - Behälterzeile entfernen: nur ohne Folgebuchungen (auch Behandlung, Analyse, DAC)
//     – die Charge wird mitgelöscht (nur Betriebsleiter, wie RLS auf weinausbau)
//   - Stammdaten bestehender Chargen (Name, Sorte, Qualität, Herkunft, Weinart) bleiben
//     unangetastet; gesetzt werden sie nur beim Anlegen, Änderungen im Kellerbuch
//   - KAN-126: Lesedatum und Mostgewicht je Traubenzeile (pw.ernte_datum, kmw/oechsle/mostgewicht_einheit)
//     kommen aus dem Formular (Lesetag der Erntemeldung, änderbar); Zukauf-Zeilen bekommen das Zukaufsdatum
// Keine Transaktion (einzelne PostgREST-Aufrufe): erst alles prüfen, dann schreiben.
// Sperren kommen aus lib/kellerbuch/folgebuchungen.ts (eine Stelle für „hat Folgebuchungen“).

type PressungWGInput  = {
  id?: string; weingarten_id?: string; grundstueck_id?: string | null; zukauf_posten_id?: string; trauben_kg: number; rebsorte?: string; notizen?: string
  /** KAN-126: Lesetag (JJJJ-MM-TT) und Mostgewicht dieser Traubenzeile */
  ernte_datum?: string | null; mostgewicht_wert?: string | number | null; mostgewicht_einheit?: string | null
}
type PressungBehInput = { id?: string; behaelter_id?: string; weinausbau_id?: string; menge_liter?: number; notizen?: string }
type NeueCharge = { behaelter_id: string; weinausbau_id: string; name: string; menge_liter: number | null; qualitaetsstufe: string | null; herkunft_code: string | null }

type WGZeile = {
  nr: number; id: string | null; weingarten_id: string | null; grundstueck_id: string | null; zukauf_posten_id: string | null
  trauben_kg: number; rebsorte: string | null; notizen: string | null
  ernte_datum: string | null; kmw: number | null; oechsle: number | null; mostgewicht_einheit: string
}
type BehZeile = {
  nr: number; id: string | null; behaelter_id: string | null; weinausbau_id: string | null
  menge_liter: number | null; notizen: string | null
}
type ChargenVorgaben = {
  name: string; jahr: number | null; rebsorte: string | null
  qualitaet: string; herkunft: string | null; weinart: string
}

const PW_FELDER = ['weingarten_id', 'grundstueck_id', 'zukauf_posten_id', 'trauben_kg', 'rebsorte', 'notizen', 'ernte_datum', 'kmw', 'oechsle', 'mostgewicht_einheit'] as const
const PW_ZAHLEN = new Set<string>(['trauben_kg', 'kmw', 'oechsle'])
const MENGE_TOLERANZ = 0.005
const MENGE_HINWEIS = `Die Pressung bleibt als Zugangsbeleg unverändert: Mindermengen bitte im Kellerbuch an der Charge über „Schwund buchen“ erfassen; eine Mehrmenge kann nach Folgebuchungen nicht mehr über die Pressung gebucht werden. ${KORREKTUR_NACH_OBEN_HINWEIS}`
const GEBINDE_HINWEIS = 'Liegt der Wein inzwischen in einem anderen Gebinde, bitte im Kellerbuch einen Umzug buchen.'
const CHARGE_HINWEIS = 'Die Pressung und ihre Chargen bleiben als Historie erhalten – Korrekturen bitte im Kellerbuch als eigene, datierte Buchung erfassen (z. B. Schwund buchen oder Umzug).'

function leseFormularJson<T>(fd: FormData, feld: string): T[] {
  let wert: unknown
  try { wert = JSON.parse((fd.get(feld) as string) || '[]') } catch { wert = null }
  if (!Array.isArray(wert)) throw new AktionsFehler('Ungültige Formulardaten – bitte die Seite neu laden und erneut speichern.')
  return wert as T[]
}

/** „„Grüner Veltliner“ (Tank 3)“ – Charge einer Behälterzeile für Meldungen */
function chargeBezeichnung(pb: AR): string {
  const name = (pb.weinausbau as AR | null)?.name as string | undefined
  const beh  = (pb.behaelter as AR | null)?.name as string | undefined
  return `„${name ?? 'ohne Namen'}“${beh ? ` (${beh})` : ''}`
}

function hatDoppelte(ids: (string | null)[]): boolean {
  const gesehen = new Set<string>()
  for (const id of ids) {
    if (!id) continue
    if (gesehen.has(id)) return true
    gesehen.add(id)
  }
  return false
}

/** Name, Sorte, Qualität, Herkunft und Weinart für NEUE Chargen (bestehende bleiben unverändert) */
async function chargenVorgabenErmitteln(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  jahrgangId: string,
  jahr: number | null,
  weingaerten: WGZeile[],
  kopf: { datum: string; weinbezeichnung: string | null; kmwGrad: number | null; qualitaetsstufe: string | null },
): Promise<ChargenVorgaben> {
  // Qualität: User-Input > KMW-Ableitung > Fallback 'qualitaetswein'
  // ACHTUNG: weinjahrgaenge.qualitaet_gesamt enthält Vintage-Bewertungen ('sehr_gut' etc.) – NICHT als qualitaetsstufe verwenden!
  const qualitaet = kopf.qualitaetsstufe
    ?? (kopf.kmwGrad != null && !isNaN(kopf.kmwGrad) ? kmwZuQualitaet(kopf.kmwGrad) : 'qualitaetswein')

  // Herkunft-Code (BKI): niedrigster (breitester) Wert der verknüpften Ernte-Parzellen übernehmen
  // (analog Qualität – Verschneiden/Pressen kann Herkunft nur ab-, nie aufstufen).
  let herkunft: string | null = null
  if (weingaerten.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: epRows, error } = await (supabase.from('ernte_parzellen') as any)
      .select('herkunft_code, weingarten_id, grundstueck_id').eq('jahrgang_id', jahrgangId)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Herkunft konnte nicht ermittelt werden (ernte_parzellen)'))
    const epList = ((epRows ?? []) as AR[])
    const passendeCodes = weingaerten.map(w => {
      const match = epList.find((e: AR) =>
        e.weingarten_id === w.weingarten_id &&
        (w.grundstueck_id ? e.grundstueck_id === w.grundstueck_id : true)
      )
      return match?.herkunft_code as string | null ?? null
    })
    herkunft = minHerkunft(passendeCodes)
  }

  // Rebsorte + Weinart ableiten aus Weingarten-Tabelle
  const rebsortenAusForm = weingaerten.map(w => w.rebsorte).filter((r): r is string => !!r)
  let dominantRebsorte: string | null = null
  let weinart = 'unbekannt'
  if (weingaerten.length > 0) {
    const wgIds  = weingaerten.map(w => w.weingarten_id).filter(Boolean) as string[]
    const gstIds = weingaerten.map(w => w.grundstueck_id).filter(Boolean) as string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: wgRows } = await (supabase.from('weingarten') as any).select('rebsorte, weinart').in('id', wgIds).eq('tenant_id', tenantId)
    const { data: gstRows } = gstIds.length > 0
      ? await (supabase.from('grundstuecke') as any).select('weinart').in('id', gstIds).eq('tenant_id', tenantId)
      : { data: [] }
    const wgArr  = ((wgRows  ?? []) as AR[])
    const gstArr = ((gstRows ?? []) as AR[])
    // Rebsorte
    const wgRebsorten = wgArr.map((w: AR) => w.rebsorte).filter(Boolean) as string[]
    const allRebsorten = rebsortenAusForm.length > 0 ? rebsortenAusForm : wgRebsorten
    const uniqueRebsorten = [...new Set(allRebsorten)]
    dominantRebsorte = uniqueRebsorten.length === 1 ? uniqueRebsorten[0] : uniqueRebsorten.length > 1 ? 'Sortenverschnitt' : null
    // Weinart: GST hat Vorrang vor Weingarten; eindeutig → übernehmen; gemischt → 'unbekannt'
    const weinartQuellen = gstArr.length > 0 ? gstArr : wgArr
    const uniqueWeinart = [...new Set(weinartQuellen.map((w: AR) => w.weinart).filter((a: string) => a && a !== 'unbekannt'))]
    if (uniqueWeinart.length === 1) weinart = uniqueWeinart[0] as string
  } else if (rebsortenAusForm.length > 0) {
    const unique = [...new Set(rebsortenAusForm)]
    dominantRebsorte = unique.length === 1 ? unique[0] : 'Sortenverschnitt'
  }
  const name = kopf.weinbezeichnung
    ? kopf.weinbezeichnung
    : dominantRebsorte
      ? dominantRebsorte
      : `Pressung ${datumText(kopf.datum)}`

  return { name, jahr, rebsorte: dominantRebsorte, qualitaet, herkunft, weinart }
}

/** Behälterzeile nach einem Fehler wieder entfernen – liefert '' oder einen Zusatz für die Meldung */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function behaelterzeileAufraeumen(supabase: any, pbId: string, pressId: string): Promise<string> {
  const { data, error } = await (supabase.from('pressung_behaelter') as any)
    .delete().eq('id', pbId).eq('pressung_id', pressId).select('id')
  if (error || !(data as AR[] | null)?.length) {
    return ` Achtung: Die angelegte Behälterzeile konnte nicht wieder entfernt werden${error ? ` (${dbFehlerText(error)})` : ''} – bitte die Pressung prüfen.`
  }
  return ''
}

/**
 * Neue Behälterzeile samt Kellerbuch-Charge anlegen. Reihenfolge: Behälterzeile →
 * Charge → Rückverknüpfung über pb.id. Scheitert ein Schritt, wird aufgeräumt, damit
 * weder eine Behälterzeile ohne Charge (Zugang ohne Bestand) noch eine Charge ohne
 * Behälterzeile (Bestand ohne Zugang) zurückbleibt.
 */
async function mostzeileMitChargeAnlegen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  pressId: string,
  b: BehZeile,
  v: ChargenVorgaben,
): Promise<NeueCharge> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pbNeu, error: pbErr } = await (supabase.from('pressung_behaelter') as any)
    .insert({ pressung_id: pressId, behaelter_id: b.behaelter_id, menge_liter: b.menge_liter, notizen: b.notizen })
    .select('id').single()
  if (pbErr || !pbNeu) throw new AktionsFehler(dbFehlerText(pbErr, 'Behälterzeile konnte nicht angelegt werden'))
  const pbId = (pbNeu as AR).id as string

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neuWA, error: waErr } = await (supabase.from('weinausbau') as any)
    .insert({
      tenant_id:       tenantId,
      name:            v.name,
      jahrgang:        v.jahr,
      rebsorte:        v.rebsorte,
      menge_liter:     b.menge_liter,
      status:          'ausbau',
      behaelter_id:    b.behaelter_id,
      qualitaetsstufe: v.qualitaet,
      herkunft_code:   v.herkunft,
      weinart:         v.weinart,
      aktiv:           true,
    })
    .select('id').single()
  if (waErr || !neuWA) {
    const zusatz = await behaelterzeileAufraeumen(supabase, pbId, pressId)
    throw new AktionsFehler(`Kellerbuch-Charge konnte nicht angelegt werden: ${dbFehlerText(waErr)}${zusatz}`)
  }
  const waId = (neuWA as AR).id as string

  // Rückverknüpfung über die ID der Behälterzeile (nicht über Pressung + Behälter:
  // zwei Zeilen mit demselben Behälter würden sonst beide überschrieben). Der Trigger
  // trg_pressung_weinausbau_weingaerten ergänzt dabei die Herkunft (weinausbau_weingaerten).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: link, error: linkErr } = await (supabase.from('pressung_behaelter') as any)
    .update({ weinausbau_id: waId }).eq('id', pbId).eq('pressung_id', pressId).select('id')
  if (linkErr || !(link as AR[] | null)?.length) {
    const zusatz = await behaelterzeileAufraeumen(supabase, pbId, pressId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: wDel, error: wDelErr } = await (supabase.from('weinausbau') as any)
      .delete().eq('id', waId).eq('tenant_id', tenantId).select('id')
    const chargeRest = wDelErr || !(wDel as AR[] | null)?.length
      ? ` Achtung: Die angelegte Charge „${v.name}“ konnte nicht wieder entfernt werden – bitte im Kellerbuch löschen lassen.`
      : ''
    throw new AktionsFehler(`Die Charge konnte nicht mit der Pressung verknüpft werden: ${linkErr ? dbFehlerText(linkErr) : 'keine Berechtigung'}.${zusatz}${chargeRest}`)
  }

  return { behaelter_id: b.behaelter_id as string, weinausbau_id: waId, name: v.name, menge_liter: b.menge_liter, qualitaetsstufe: v.qualitaet, herkunft_code: v.herkunft }
}

type PbAenderung = {
  alt: AR
  patch: AR
  // Anpassung der verknüpften Charge (Menge um die Differenz, Gebinde) samt Rücksetzwerten
  charge?: { neu: AR; rueck: AR; mengeVorher: number | null }
}

export async function upsertPressung(fd: FormData): Promise<{ neu: NeueCharge[]; warnung?: string }> {
  const supabase    = await createSupabaseServerClient()
  const membership  = await getMembership()
  const tenantId    = membership.tenantId
  const existingId  = (fd.get('existing_id') as string) || null
  const datum            = (fd.get('datum') as string) || ''
  const mostLiter        = zahlAus(fd.get('most_liter_gesamt'))
  const weinbezeichnung  = (fd.get('weinbezeichnung') as string) || null
  const kmwGrad          = zahlAus(fd.get('kmw_grad'))
  const notizen          = (fd.get('notizen') as string) || null
  const qualitaetsstufeInput = (fd.get('qualitaetsstufe') as string) || null
  if (!datum) throw new AktionsFehler('Bitte das Datum der Pressung angeben.')
  // KAN-73: die Stufe geht in die neue Kellerbuch-Charge (weinausbau) – vor jedem Schreiben prüfen.
  // Das Formular schickt keine (Ableitung aus den °KMW), nur ein direkter Aufruf.
  const qualitaetUnzulaessig = qualitaetFehler('charge', qualitaetsstufeInput)
  if (qualitaetUnzulaessig) throw new AktionsFehler(qualitaetUnzulaessig)
  // KAN-81/KAN-126: nur abstufen – die Obergrenze prüft der Abschnitt „Lese der Pressung“ (Eiswein, KAN-129)

  const weingaerten: WGZeile[] = leseFormularJson<PressungWGInput>(fd, 'weingaerten_json').map((w, i) => {
    // KAN-126: Mostgewicht der Zeile (Messwert + Einheit) wie in der Erntemeldung
    const mg = mostgewichtAusWert(w.mostgewicht_wert ?? null, w.mostgewicht_einheit ?? null, `Traubenzeile ${i + 1}`)
    if (!mg.ok) throw new AktionsFehler(mg.fehler)
    const spalten = mostgewichtSpalten(mg.wert, 'kmw')
    return {
      nr:               i + 1,
      id:               textOderNull(w.id),
      weingarten_id:    textOderNull(w.weingarten_id),
      grundstueck_id:   textOderNull(w.grundstueck_id),
      zukauf_posten_id: textOderNull(w.zukauf_posten_id),
      trauben_kg:       zahlOderNull(w.trauben_kg) ?? NaN,
      rebsorte:         textOderNull(w.rebsorte),
      notizen:          textOderNull(w.notizen),
      ernte_datum:      textOderNull(w.ernte_datum),
      kmw:              spalten.kmw,
      oechsle:          spalten.oechsle,
      mostgewicht_einheit: spalten.mostgewicht_einheit,
    }
  })
  const behaelter: BehZeile[] = leseFormularJson<PressungBehInput>(fd, 'behaelter_json').map((b, i) => {
    const menge = zahlOderNull(b.menge_liter)
    return {
      nr:            i + 1,
      id:            textOderNull(b.id),
      behaelter_id:  textOderNull(b.behaelter_id),
      weinausbau_id: textOderNull(b.weinausbau_id),
      menge_liter:   menge == null ? null : runde2(menge),
      notizen:       textOderNull(b.notizen),
    }
  })

  // ── Eingaben prüfen ────────────────────────────────────────────────────────
  for (const w of weingaerten) {
    if (!!w.weingarten_id === !!w.zukauf_posten_id) {
      throw new AktionsFehler(`Traubenzeile ${w.nr}: Jede Traubenzeile braucht genau eine Quelle – eine Ried/GST aus der Lese oder einen Trauben-Zukauf.`)
    }
    if (!(w.trauben_kg > 0)) throw new AktionsFehler(`Traubenzeile ${w.nr}: Bitte eine Menge größer als 0 kg angeben.`)
  }
  for (const b of behaelter) {
    if (b.id) continue
    if (b.weinausbau_id) {
      throw new AktionsFehler(`Behälterzeile ${b.nr}: Eine neue Behälterzeile kann keiner bestehenden Charge zugeordnet werden – bitte nur Behälter und Menge angeben.`)
    }
    if (!b.behaelter_id) throw new AktionsFehler(`Behälterzeile ${b.nr}: Bitte einen Behälter wählen.`)
    if (!(b.menge_liter != null && b.menge_liter > 0)) throw new AktionsFehler(`Behälterzeile ${b.nr}: Bitte die Mostmenge in Litern (größer als 0) angeben.`)
  }
  if (hatDoppelte(weingaerten.map(w => w.id)) || hatDoppelte(behaelter.map(b => b.id))) {
    throw new AktionsFehler('Ungültige Formulardaten (doppelte Zeile) – bitte die Seite neu laden.')
  }

  // ── Bestehende Pressung laden ──────────────────────────────────────────────
  let jahrgangId = (fd.get('jahrgang_id') as string) || ''
  let pwAlt: AR[] = []
  let pbAlt: AR[] = []
  let kopfAlt: AR | null = null
  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pAlt, error: pAltErr } = await (supabase.from('pressungen') as any)
      .select('id, jahrgang_id, lese_id, datum, most_liter_gesamt').eq('id', existingId).eq('tenant_id', tenantId).maybeSingle()
    if (pAltErr) throw new AktionsFehler(dbFehlerText(pAltErr, 'Pressung konnte nicht geladen werden'))
    if (!pAlt) throw new AktionsFehler('Pressung nicht gefunden – bitte die Seite neu laden.')
    jahrgangId = (pAlt as AR).jahrgang_id as string
    kopfAlt = pAlt as AR
    const [pwRes, pbRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('pressung_weingaerten') as any)
        .select('id, weingarten_id, grundstueck_id, zukauf_posten_id, trauben_kg, rebsorte, notizen, ernte_datum, kmw, oechsle, mostgewicht_einheit')
        .eq('pressung_id', existingId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('pressung_behaelter') as any)
        .select('id, behaelter_id, weinausbau_id, menge_liter, notizen, weinausbau:weinausbau_id(name, menge_liter), behaelter:behaelter_id(name)')
        .eq('pressung_id', existingId),
    ])
    if (pwRes.error) throw new AktionsFehler(dbFehlerText(pwRes.error, 'Pressung konnte nicht geladen werden (pressung_weingaerten)'))
    if (pbRes.error) throw new AktionsFehler(dbFehlerText(pbRes.error, 'Pressung konnte nicht geladen werden (pressung_behaelter)'))
    pwAlt = (pwRes.data ?? []) as AR[]
    pbAlt = (pbRes.data ?? []) as AR[]
  } else if (weingaerten.some(w => w.id) || behaelter.some(b => b.id)) {
    throw new AktionsFehler('Ungültige Formulardaten – bitte die Seite neu laden.')
  }
  const jg = await ladeJahrgang(supabase, tenantId, jahrgangId)

  // ── KAN-126: Lesedatum je Traubenzeile ─────────────────────────────────────
  // Zukauf-Zeilen: Zukaufsdatum (Entscheidung Jörgen 29.09.2026), unabhängig von der Formulareingabe
  const zukaufIds = [...new Set(weingaerten.map(w => w.zukauf_posten_id).filter(Boolean) as string[])]
  if (zukaufIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: zkRows, error: zkErr } = await (supabase.from('zukauf_posten') as any)
      .select('id, datum').in('id', zukaufIds).eq('tenant_id', tenantId)
    if (zkErr) throw new AktionsFehler(dbFehlerText(zkErr, 'Trauben-Zukauf konnte nicht geladen werden'))
    const zkDatum = new Map(((zkRows ?? []) as AR[]).map(z => [z.id as string, (z.datum as string | null) ?? null]))
    for (const w of weingaerten) {
      if (!w.zukauf_posten_id) continue
      if (!zkDatum.has(w.zukauf_posten_id)) throw new AktionsFehler(`Traubenzeile ${w.nr}: Der Trauben-Zukauf wurde nicht gefunden – bitte die Seite neu laden.`)
      w.ernte_datum = zkDatum.get(w.zukauf_posten_id) ?? null
    }
  }
  // Eigene Lese: Pflicht für neue Zeilen und Zeilen mit geändertem Ort; unveränderte Altzeilen ohne Datum
  // blockieren nicht. Ein gesetztes Datum wird immer geprüft – auch wenn sich nur das Pressungsdatum ändert.
  {
    const altById = new Map(pwAlt.map(w => [w.id as string, w]))
    for (const w of weingaerten) {
      if (!w.weingarten_id) continue
      const alt = w.id ? altById.get(w.id) : undefined
      const ortGeaendert = !alt || (alt.weingarten_id ?? null) !== w.weingarten_id || (alt.grundstueck_id ?? null) !== w.grundstueck_id
      const pflicht = ortGeaendert || !!alt?.ernte_datum
      const f = lesedatumFehler(w.ernte_datum, { pressungDatum: datum, jahrgang: (jg.jahrgang as number | null) ?? null, pflicht })
      if (f) throw new AktionsFehler(`Traubenzeile ${w.nr}: ${f}`)
    }
  }

  // ── Änderungen planen und prüfen (noch nichts geschrieben) ─────────────────
  const pwAltMap = new Map(pwAlt.map(w => [w.id as string, w]))
  const pbAltMap = new Map(pbAlt.map(b => [b.id as string, b]))
  if (weingaerten.some(w => w.id && !pwAltMap.has(w.id)) || behaelter.some(b => b.id && !pbAltMap.has(b.id))) {
    throw new AktionsFehler('Eine Zeile gehört nicht (mehr) zu dieser Pressung – bitte die Seite neu laden.')
  }

  // Traubenzeilen: keine eingehenden Verweise → ändern/entfernen erlaubt (Protokoll hält es fest)
  const pwBleibt = new Set(weingaerten.map(w => w.id).filter(Boolean) as string[])
  const pwEntfernen = pwAlt.map(w => w.id as string).filter(id => !pwBleibt.has(id))
  const pwAendern: { id: string; patch: AR }[] = []
  for (const w of weingaerten) {
    if (!w.id) continue
    const alt = pwAltMap.get(w.id)!
    const patch: AR = {}
    for (const feld of PW_FELDER) {
      const neu = w[feld]
      const gleich = PW_ZAHLEN.has(feld)
        ? (alt[feld] == null || neu == null)
          ? (alt[feld] ?? null) === (neu ?? null)
          : Math.abs((Number(alt[feld]) || 0) - (neu as number)) < 0.0005
        : feld === 'mostgewicht_einheit' && w.kmw == null && w.oechsle == null
          ? true   // ohne Messwert ist die Einheit bedeutungslos (Altzeilen: NULL)
          : (alt[feld] ?? null) === neu
      if (!gleich) patch[feld] = neu
    }
    if (Object.keys(patch).length > 0) pwAendern.push({ id: w.id, patch })
  }
  const pwNeu = weingaerten.filter(w => !w.id)

  // Direktverkauf aus der Pressung (verkauf_positionen.pressung_behaelter_id, ON DELETE SET NULL):
  // solche Behälterzeilen weder in Menge/Behälter ändern noch entfernen
  const pbMitVerkauf = new Set<string>()
  if (pbAlt.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vpRows, error: vpErr } = await (supabase.from('verkauf_positionen') as any)
      .select('pressung_behaelter_id').in('pressung_behaelter_id', pbAlt.map(b => b.id)).eq('tenant_id', tenantId)
    if (vpErr) throw new AktionsFehler(dbFehlerText(vpErr, 'Verkäufe aus der Pressung konnten nicht geprüft werden'))
    for (const v of (vpRows ?? []) as AR[]) pbMitVerkauf.add(v.pressung_behaelter_id as string)
  }

  const pbBleibt = new Set(behaelter.map(b => b.id).filter(Boolean) as string[])
  const pbEntfernen = pbAlt.filter(b => !pbBleibt.has(b.id as string))
  for (const alt of pbEntfernen) {
    if (pbMitVerkauf.has(alt.id)) {
      throw new AktionsFehler(`Der Behälter${(alt.behaelter as AR | null)?.name ? ` „${(alt.behaelter as AR).name}“` : ''} kann nicht aus der Pressung entfernt werden: Aus ihm wurde bereits direkt verkauft.`)
    }
    if (alt.weinausbau_id) {
      await sperreBeiFolgebuchungen(supabase, alt.weinausbau_id as string,
        `Das Entfernen des Behälters mit der Charge ${chargeBezeichnung(alt)} aus der Pressung`)
      if (!canAdmin(membership.role)) {
        throw new AktionsFehler(`Das Entfernen des Behälters löscht auch die daraus entstandene Charge ${chargeBezeichnung(alt)} – das dürfen nur Betriebsleiter (Admin).`)
      }
    }
  }

  const pbAendern: PbAenderung[] = []
  for (const b of behaelter) {
    if (!b.id) continue
    const alt = pbAltMap.get(b.id)!
    const altMenge = zahlOderNull(alt.menge_liter)
    const mengeGeaendert = altMenge == null
      ? b.menge_liter != null
      : b.menge_liter == null || Math.abs(altMenge - b.menge_liter) > MENGE_TOLERANZ
    const behGeaendert   = (alt.behaelter_id ?? null) !== b.behaelter_id
    const notizGeaendert = (alt.notizen ?? null) !== b.notizen
    if (!mengeGeaendert && !behGeaendert && !notizGeaendert) continue

    if ((mengeGeaendert || behGeaendert) && pbMitVerkauf.has(alt.id)) {
      throw new AktionsFehler(`Behälterzeile ${b.nr}: Menge und Behälter können nicht mehr geändert werden – aus diesem Pressungsbehälter wurde bereits direkt verkauft. Korrekturen bitte über einen Verkaufsstorno.`)
    }
    if (mengeGeaendert && !(b.menge_liter != null && b.menge_liter > 0)) {
      throw new AktionsFehler(`Behälterzeile ${b.nr}: Bitte die Mostmenge in Litern (größer als 0) angeben.`)
    }

    const patch: AR = {}
    if (mengeGeaendert) patch.menge_liter = b.menge_liter
    if (behGeaendert)   patch.behaelter_id = b.behaelter_id
    if (notizGeaendert) patch.notizen = b.notizen
    const aenderung: PbAenderung = { alt, patch }

    if (alt.weinausbau_id && (mengeGeaendert || behGeaendert)) {
      const waId = alt.weinausbau_id as string
      if (behGeaendert && !b.behaelter_id) {
        throw new AktionsFehler(`Behälterzeile ${b.nr}: Die Charge ${chargeBezeichnung(alt)} braucht einen Behälter – bitte einen Behälter wählen.`)
      }
      if (behGeaendert) {
        // Wie im Kellerbuch: Zukauf, Analysen und DAC-Anträge hängen nicht am Gebinde und
        // sperren den Wechsel nicht (ein Tippfehler beim Behälter bleibt so korrigierbar)
        await sperreBeiFolgebuchungen(supabase, waId,
          `Der Behälterwechsel für die Charge ${chargeBezeichnung(alt)}`, { ohne: GEBINDEWECHSEL_OHNE, hinweis: GEBINDE_HINWEIS })
      }
      if (mengeGeaendert) {
        // Behandlungen, Analysen und DAC-Anträge ändern keine Menge → sperren hier nicht
        await sperreBeiFolgebuchungen(supabase, waId,
          `Das Ändern der Mostmenge (${literText(altMenge)} → ${literText(b.menge_liter)}) für die Charge ${chargeBezeichnung(alt)}`,
          { ohne: ['behandlung', 'analyse', 'dac'], hinweis: MENGE_HINWEIS })
      }
      const chargeMenge = zahlOderNull((alt.weinausbau as AR | null)?.menge_liter)
      const neu: AR = {}
      const rueck: AR = {}
      if (mengeGeaendert) {
        // Bestand um die Differenz ändern, nicht auf die Pressmenge setzen
        const neueMenge = runde2((chargeMenge ?? 0) + ((b.menge_liter as number) - (altMenge ?? 0)))
        if (neueMenge < 0) {
          throw new AktionsFehler(`Die Mostmenge für die Charge ${chargeBezeichnung(alt)} kann nicht auf ${literText(b.menge_liter)} gesenkt werden: Die Charge hat nur noch ${literText(chargeMenge ?? 0)} Bestand. ${MENGE_HINWEIS}`)
        }
        neu.menge_liter = neueMenge
        rueck.menge_liter = chargeMenge
      }
      if (behGeaendert) {
        neu.behaelter_id = b.behaelter_id
        rueck.behaelter_id = alt.behaelter_id ?? null
      }
      aenderung.charge = { neu, rueck, mengeVorher: chargeMenge }
    }
    pbAendern.push(aenderung)
  }

  // ── KAN-126: Press-/Lesedatum einfrieren, sobald an einer Charge der Pressung gebucht wurde ───────────
  // (Entscheidung Jörgen 29.09.2026, wie Menge und Behälter nach KAN-35)
  if (existingId && kopfAlt) {
    const datumGeaendert = String(kopfAlt.datum ?? '').slice(0, 10) !== datum
    const lesedatumGeaendert = weingaerten.some(w => {
      if (!w.id) return false
      const alt = pwAltMap.get(w.id)
      return !!alt && String(alt.ernte_datum ?? '').slice(0, 10) !== (w.ernte_datum ?? '') && !w.zukauf_posten_id
    })
    if (datumGeaendert || lesedatumGeaendert) {
      const was = datumGeaendert && lesedatumGeaendert ? 'Press- und Lesedatum' : datumGeaendert ? 'das Pressdatum' : 'das Lesedatum'
      for (const pb of pbAlt) {
        if (!pb.weinausbau_id) continue
        await sperreBeiFolgebuchungen(supabase, pb.weinausbau_id as string,
          `Das Ändern von ${was} der Pressung (Charge ${chargeBezeichnung(pb)})`, { hinweis: CHARGE_HINWEIS })
      }
    }
  }

  // ── KAN-126: Most muss vollständig in Behälter (Summe = Mostausbeute ±0,5 L) und in die Behälter passen ──
  {
    const mengenGeaendert = !existingId
      || (zahlOderNull(kopfAlt?.most_liter_gesamt) ?? null) !== (mostLiter ?? null)
      || behaelter.some(b => !b.id) || pbEntfernen.length > 0
      || pbAendern.some(a => 'menge_liter' in a.patch || 'behaelter_id' in a.patch)
    if (mengenGeaendert) {
      const ziele = [...new Set(behaelter.map(b => b.behaelter_id).filter(Boolean) as string[])]
      const [volRes, fsRes] = ziele.length > 0 ? await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('behaelter') as any).select('id, name, volumen_liter').in('id', ziele).eq('tenant_id', tenantId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('v_behaelter_fuellstand') as any).select('behaelter_id, liter_aktuell').in('behaelter_id', ziele),
      ]) : [{ data: [], error: null }, { data: [], error: null }]
      if (volRes.error) throw new AktionsFehler(dbFehlerText(volRes.error, 'Behälter konnten nicht geladen werden'))
      if (fsRes.error) throw new AktionsFehler(dbFehlerText(fsRes.error, 'Füllstände konnten nicht geladen werden'))
      const fehlerText = behaelterPruefung({
        mostLiter,
        zeilen: behaelter.map(b => {
          const alt = b.id ? pbAltMap.get(b.id) : undefined
          return {
            nr: b.nr, behaelter_id: b.behaelter_id, menge_liter: b.menge_liter,
            alt: alt ? { behaelter_id: (alt.behaelter_id as string | null) ?? null, menge_liter: zahlOderNull(alt.menge_liter) } : null,
          }
        }),
        behaelter: ((volRes.data ?? []) as AR[]).map(r => ({ id: r.id as string, name: (r.name as string | null) ?? null, volumen_liter: zahlOderNull(r.volumen_liter) })),
        fuellstand: Object.fromEntries(((fsRes.data ?? []) as AR[]).map(r => [r.behaelter_id as string, zahlOderNull(r.liter_aktuell) ?? 0])),
      })
      if (fehlerText) throw new AktionsFehler(fehlerText)
    }
  }

  // ── KAN-129: Lese der Pressung und kg-Bilanz je Lese ───────────────────────
  // Entscheidung Jörgen 29.09.2026: je Lese, serverseitig sperren – verpresst + verkauft ≤ gelesen je Ort.
  // Neue Pressung: gewählter Reiter, sonst wie die Datenbank nach Datum; beim Bearbeiten bleibt die Lese.
  const lesenJg = await ladeLesenDesJahrgangs(supabase, tenantId, jahrgangId)
  let lesePressung = existingId ? lesenJg.find(l => l.id === (kopfAlt as AR).lese_id) ?? null : null
  if (!existingId) {
    const gewaehlt = await leseFuerNeuenEintrag(supabase, tenantId, jahrgangId, fd)
    lesePressung = gewaehlt ? lesenJg.find(l => l.id === gewaehlt) ?? null : leseFuerDatum(lesenJg, Number(jg.jahrgang), datum)
    if (!lesePressung) throw new AktionsFehler(LESE_WAEHLEN_MELDUNG)
  }
  // KAN-81/KAN-126: nur abstufen – nie über die Stufe aus den °KMW (ohne °KMW: Qualitätswein); bei einer
  // Eiswein-Lese ist die Obergrenze Eiswein (KAN-129 Soll 2)
  const ueberObergrenze = abstufungFehler(qualitaetsstufeInput, leseStufe(lesePressung?.art,
    kmwGrad != null && !isNaN(kmwGrad) ? kmwZuQualitaet(kmwGrad) : 'qualitaetswein'))
  if (ueberObergrenze) throw new AktionsFehler(ueberObergrenze)
  if (lesePressung) {
    const deckung = await leseDeckungFehler(supabase, tenantId, jahrgangId, lesePressung, Number(jg.jahrgang), { pressungId: existingId },
      pwAlt.filter(w => w.weingarten_id).map(w => ({ weingarten_id: w.weingarten_id as string, grundstueck_id: (w.grundstueck_id as string | null) ?? null, kg: Number(w.trauben_kg) || 0 })),
      weingaerten.filter(w => w.weingarten_id).map(w => ({ weingarten_id: w.weingarten_id, grundstueck_id: w.grundstueck_id, kg: w.trauben_kg })))
    if (deckung) throw new AktionsFehler(deckung)
  }

  // ── Schreiben ──────────────────────────────────────────────────────────────
  let pressId: string
  if (existingId) {
    pressId = existingId

    // 1. Entfernte Behälterzeilen samt Charge (pb zuerst: pressung_behaelter.weinausbau_id ist NO ACTION)
    for (const alt of pbEntfernen) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pbDel, error: pbDelErr } = await (supabase.from('pressung_behaelter') as any)
        .delete().eq('id', alt.id).eq('pressung_id', pressId).select('id')
      if (pbDelErr) throw new AktionsFehler(dbFehlerText(pbDelErr, 'Behälterzeile konnte nicht entfernt werden'))
      if (!(pbDel as AR[] | null)?.length) throw new AktionsFehler('Behälterzeile konnte nicht entfernt werden – keine Berechtigung oder inzwischen geändert. Bitte die Seite neu laden.')
      if (!alt.weinausbau_id) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: wDel, error: wDelErr } = await (supabase.from('weinausbau') as any)
        .delete().eq('id', alt.weinausbau_id).eq('tenant_id', tenantId).select('id')
      if (wDelErr || !(wDel as AR[] | null)?.length) {
        // Behälterzeile wiederherstellen – sonst bliebe die Charge ohne Zugang (Bewegungsbuch) zurück
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: rErr } = await (supabase.from('pressung_behaelter') as any).insert({
          id: alt.id, pressung_id: pressId, behaelter_id: alt.behaelter_id ?? null, weinausbau_id: alt.weinausbau_id,
          menge_liter: alt.menge_liter ?? null, notizen: alt.notizen ?? null,
        })
        throw new AktionsFehler(
          `Die Charge ${chargeBezeichnung(alt)} konnte nicht gelöscht werden: ${wDelErr ? dbFehlerText(wDelErr) : 'keine Berechtigung (nur Betriebsleiter)'}.`
          + (rErr
            ? ` Achtung: Die Behälterzeile konnte nicht wiederhergestellt werden (${dbFehlerText(rErr)}) – bitte die Pressung prüfen.`
            : ' Die Behälterzeile bleibt erhalten.'))
      }
    }

    // 2. Geänderte Behälterzeilen – Charge zuerst (Gebinde-Trigger, Prüfregeln), dann die Zeile
    for (const a of pbAendern) {
      if (a.charge) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (supabase.from('weinausbau') as any)
          .update(a.charge.neu).eq('id', a.alt.weinausbau_id).eq('tenant_id', tenantId)
        // Kein Lost Update: die Menge darf sich seit dem Laden nicht geändert haben
        // (Bereich statt Gleichheit: numeric → JSON-Zahl ist nicht immer bitgenau)
        if ('menge_liter' in a.charge.neu) {
          const v = a.charge.mengeVorher
          q = v == null ? q.is('menge_liter', null) : q.gte('menge_liter', v - 1e-6).lte('menge_liter', v + 1e-6)
        }
        const { data: wUpd, error: wUpdErr } = await q.select('id')
        if (wUpdErr) throw new AktionsFehler(dbFehlerText(wUpdErr, `Die Charge ${chargeBezeichnung(a.alt)} konnte nicht angepasst werden`))
        if (!(wUpd as AR[] | null)?.length) {
          throw new AktionsFehler(`Die Charge ${chargeBezeichnung(a.alt)} konnte nicht angepasst werden – sie wurde inzwischen geändert oder es fehlt die Berechtigung. Bitte die Seite neu laden.`)
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pbUpd, error: pbUpdErr } = await (supabase.from('pressung_behaelter') as any)
        .update(a.patch).eq('id', a.alt.id).eq('pressung_id', pressId).select('id')
      if (pbUpdErr || !(pbUpd as AR[] | null)?.length) {
        let zusatz = ''
        if (a.charge) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rUpd, error: rErr } = await (supabase.from('weinausbau') as any)
            .update(a.charge.rueck).eq('id', a.alt.weinausbau_id).eq('tenant_id', tenantId).select('id')
          if (rErr || !(rUpd as AR[] | null)?.length) {
            zusatz = ` Achtung: Die Charge ${chargeBezeichnung(a.alt)} wurde bereits angepasst und konnte nicht zurückgesetzt werden – bitte im Kellerbuch prüfen.`
          }
        }
        throw new AktionsFehler(`Behälterzeile konnte nicht gespeichert werden: ${pbUpdErr ? dbFehlerText(pbUpdErr) : 'keine Berechtigung oder inzwischen geändert'}.${zusatz}`)
      }
    }

    // 3. Kopfdaten
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pUpd, error: pUpdErr } = await (supabase.from('pressungen') as any)
      .update({ datum, most_liter_gesamt: mostLiter, weinbezeichnung, kmw_grad: kmwGrad, notizen })
      .eq('id', pressId).eq('tenant_id', tenantId).select('id')
    if (pUpdErr) throw new AktionsFehler(dbFehlerText(pUpdErr, 'Speichern fehlgeschlagen (pressungen)'))
    if (!(pUpd as AR[] | null)?.length) throw new AktionsFehler('Die Pressung konnte nicht gespeichert werden – keine Berechtigung oder inzwischen gelöscht. Bitte die Seite neu laden.')

    // 4. Traubenzeilen: entfernen und ändern (neue folgen unten)
    if (pwEntfernen.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pwDel, error: pwDelErr } = await (supabase.from('pressung_weingaerten') as any)
        .delete().in('id', pwEntfernen).eq('pressung_id', pressId).select('id')
      if (pwDelErr) throw new AktionsFehler(dbFehlerText(pwDelErr, 'Traubenzeilen konnten nicht entfernt werden'))
      if (((pwDel ?? []) as AR[]).length !== pwEntfernen.length) {
        throw new AktionsFehler('Traubenzeilen konnten nicht entfernt werden – keine Berechtigung oder inzwischen geändert. Bitte die Seite neu laden.')
      }
    }
    for (const u of pwAendern) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pwUpd, error: pwUpdErr } = await (supabase.from('pressung_weingaerten') as any)
        .update(u.patch).eq('id', u.id).eq('pressung_id', pressId).select('id')
      if (pwUpdErr) throw new AktionsFehler(dbFehlerText(pwUpdErr, 'Speichern fehlgeschlagen (pressung_weingaerten)'))
      if (!(pwUpd as AR[] | null)?.length) throw new AktionsFehler('Eine Traubenzeile konnte nicht gespeichert werden – keine Berechtigung oder inzwischen geändert. Bitte die Seite neu laden.')
    }
  } else {
    // KAN-129: neue Pressung an die oben ermittelte Lese; beim Bearbeiten bleibt die Lese unverändert
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neu, error: neuErr } = await (supabase.from('pressungen') as any)
      .insert({ tenant_id: tenantId, jahrgang_id: jahrgangId, datum, most_liter_gesamt: mostLiter, weinbezeichnung, kmw_grad: kmwGrad, notizen, lese_id: lesePressung?.id })
      .select('id').single()
    if (neuErr || !neu) throw new AktionsFehler(dbFehlerText(neuErr, 'Speichern fehlgeschlagen (pressungen)'))
    pressId = (neu as AR).id as string
  }

  // 5. Neue Traubenzeilen
  if (pwNeu.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: pwInsErr } = await (supabase.from('pressung_weingaerten') as any).insert(pwNeu.map(w => ({
      pressung_id: pressId, weingarten_id: w.weingarten_id, grundstueck_id: w.grundstueck_id,
      zukauf_posten_id: w.zukauf_posten_id, trauben_kg: w.trauben_kg, rebsorte: w.rebsorte, notizen: w.notizen,
      ernte_datum: w.ernte_datum, kmw: w.kmw, oechsle: w.oechsle, mostgewicht_einheit: w.mostgewicht_einheit,
    })))
    if (pwInsErr) {
      let zusatz = ''
      if (!existingId) {
        // Neue Pressung ohne Trauben nicht stehen lassen (noch keine Behälter/Chargen angelegt)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: pDel, error: pDelErr } = await (supabase.from('pressungen') as any)
          .delete().eq('id', pressId).eq('tenant_id', tenantId).select('id')
        if (pDelErr || !(pDel as AR[] | null)?.length) zusatz = ' Achtung: Die bereits angelegte Pressung ohne Trauben konnte nicht wieder entfernt werden – bitte löschen.'
      }
      throw new AktionsFehler(dbFehlerText(pwInsErr, 'Speichern fehlgeschlagen (pressung_weingaerten)') + zusatz)
    }
  }

  // 6. Herkunft bestehender Chargen um neu hinzugekommene Rieden ergänzen. Früher erledigte
  //    das der Trigger trg_pressung_weinausbau_weingaerten beim Neu-Einfügen aller
  //    Behälterzeilen; er feuert nur bei INSERT bzw. Änderung von weinausbau_id. Wie der
  //    Trigger nur ergänzen, nie entfernen (ON CONFLICT DO NOTHING).
  if (existingId) {
    const neueRieden = new Set<string>()
    for (const w of pwNeu) if (w.weingarten_id) neueRieden.add(w.weingarten_id)
    for (const u of pwAendern) if (u.patch.weingarten_id) neueRieden.add(u.patch.weingarten_id as string)
    const entfernt = new Set(pbEntfernen.map(b => b.id as string))
    const chargen = [...new Set(pbAlt.filter(b => b.weinausbau_id && !entfernt.has(b.id)).map(b => b.weinausbau_id as string))]
    if (neueRieden.size > 0 && chargen.length > 0) {
      const zeilen = chargen.flatMap(waId => [...neueRieden].map(wgId => ({ tenant_id: tenantId, weinausbau_id: waId, weingarten_id: wgId })))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: wawErr } = await (supabase.from('weinausbau_weingaerten') as any)
        .upsert(zeilen, { onConflict: 'weinausbau_id,weingarten_id', ignoreDuplicates: true })
      if (wawErr) throw new AktionsFehler(dbFehlerText(wawErr, 'Herkunft der Charge konnte nicht ergänzt werden (weinausbau_weingaerten)'))
    }
  }

  // 7. Lesedaten-Sync: kg aus der Pressung in ernte_parzellen übertragen
  //    Nur Zeilen ohne gesetztes menge_kg werden befüllt (bestehende Werte bleiben)
  for (const w of weingaerten) {
    // Zukauf-Trauben (kein weingarten_id) haben keine eigene Lese-Zeile zum Sync
    if (!w.trauben_kg || !w.weingarten_id) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('ernte_parzellen') as any)
      .update({ menge_kg: w.trauben_kg, menge_hl: w.trauben_kg / 130 })
      .eq('jahrgang_id', jahrgangId)
      .eq('weingarten_id', w.weingarten_id)
      .is('menge_kg', null)
    // Wenn die Pressung ein konkretes Grundstück referenziert, NUR dessen Ernte-Zeile
    // aktualisieren – sonst würden andere, noch offene Grundstücke desselben Rieds
    // fälschlich mit überschrieben.
    if (w.grundstueck_id) q = q.eq('grundstueck_id', w.grundstueck_id)
    // KAN-126 (Entscheidung Jörgen): bei Mehrfachlese nur den Eintrag desselben Lesetags befüllen
    if (w.ernte_datum) q = q.eq('ernte_datum', w.ernte_datum)
    const { error: syncErr } = await q
    if (syncErr) throw new AktionsFehler(dbFehlerText(syncErr, 'Lesedaten konnten nicht übernommen werden (ernte_parzellen)'))
  }

  // 8. Neue Behälterzeilen samt Kellerbuch-Charge. Jede Zeile räumt bei einem Fehler
  //    selbst auf; die übrigen Änderungen sind dann schon gespeichert → Warnung statt
  //    Fehler, damit das Formular nicht dieselbe Pressung ein zweites Mal anlegt.
  const neuePb = behaelter.filter(b => !b.id)
  const neuChargen: NeueCharge[] = []
  const fehlgeschlagen: string[] = []
  if (neuePb.length > 0) {
    const vorgaben = await chargenVorgabenErmitteln(supabase, tenantId, jahrgangId, (jg.jahrgang as number | null) ?? null, weingaerten,
      { datum, weinbezeichnung, kmwGrad, qualitaetsstufe: qualitaetsstufeInput ?? (lesePressung?.art === 'eiswein' ? 'eiswein' : null) })
    for (const b of neuePb) {
      try {
        neuChargen.push(await mostzeileMitChargeAnlegen(supabase, tenantId, pressId, b, vorgaben))
      } catch (e) {
        fehlgeschlagen.push(`Behälterzeile ${b.nr}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/kellerbuch')
  // KAN-129: Eiswein unter 25 °KMW – nur Hinweis
  const eiswein = eisweinHinweis(lesePressung?.art, kmwGrad != null && !isNaN(kmwGrad) ? kmwGrad : null)
  if (fehlgeschlagen.length > 0) {
    return {
      neu: neuChargen,
      warnung: [`Die Pressung wurde gespeichert, aber ${fehlgeschlagen.length === 1 ? 'eine Behälterzeile konnte' : `${fehlgeschlagen.length} Behälterzeilen konnten`} nicht angelegt werden – bitte die Pressung bearbeiten und den Behälter erneut eintragen.\n${fehlgeschlagen.join('\n')}`, eiswein].filter(Boolean).join('\n'),
    }
  }
  return eiswein ? { neu: neuChargen, warnung: eiswein } : { neu: neuChargen }
}

// Pressung löschen (KAN-35): nur, wenn an keiner der daraus entstandenen Chargen
// Folgebuchungen hängen (alle Arten, auch Behandlung/Analyse/DAC) und nicht direkt
// aus der Pressung verkauft wurde. Dann Behälterzeilen → Chargen → Traubenzeilen →
// Pressung löschen, jedes Ergebnis prüfen (RLS löscht ohne Berechtigung still 0 Zeilen).
export async function deletePressung(id: string, jahrgangId: string) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId   = membership.tenantId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p, error: pErr } = await (supabase.from('pressungen') as any)
    .select('id, datum, jahrgang_id').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (pErr) throw new AktionsFehler(dbFehlerText(pErr, 'Pressung konnte nicht geladen werden'))
  if (!p) throw new AktionsFehler('Pressung nicht gefunden – bitte die Seite neu laden.')
  const titel = `Die Pressung vom ${datumText((p as AR).datum)}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pbRaw, error: pbErr } = await (supabase.from('pressung_behaelter') as any)
    .select('id, behaelter_id, weinausbau_id, menge_liter, notizen, weinausbau:weinausbau_id(name), behaelter:behaelter_id(name)')
    .eq('pressung_id', id)
  if (pbErr) throw new AktionsFehler(dbFehlerText(pbErr, 'Pressung konnte nicht geladen werden (pressung_behaelter)'))
  const pbs = (pbRaw ?? []) as AR[]

  if (pbs.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: nVerkauf, error: vpErr } = await (supabase.from('verkauf_positionen') as any)
      .select('id', { count: 'exact', head: true })
      .in('pressung_behaelter_id', pbs.map(b => b.id)).eq('tenant_id', tenantId)
    if (vpErr) throw new AktionsFehler(dbFehlerText(vpErr, 'Verkäufe aus der Pressung konnten nicht geprüft werden'))
    if ((nVerkauf ?? 0) > 0) {
      throw new AktionsFehler(`${titel} kann nicht gelöscht werden: Aus ihren Behältern wurde bereits direkt verkauft (${fmtNum(nVerkauf ?? 0, 0)} ${nVerkauf === 1 ? 'Verkaufsposition' : 'Verkaufspositionen'}). ${CHARGE_HINWEIS}`)
    }
  }

  const mitCharge = pbs.filter(b => b.weinausbau_id)
  const befunde = await Promise.all(mitCharge.map(async b => ({ b, f: await folgebuchungenDerCharge(supabase, b.weinausbau_id as string) })))
  const gesperrt = befunde.filter(x => x.f.length > 0)
  if (gesperrt.length > 0) {
    const teile = gesperrt.map(x =>
      `an der Charge ${chargeBezeichnung(x.b)} ${x.f.length === 1 && x.f[0].anzahl === 1 ? 'hängt' : 'hängen'} bereits ${folgebuchungenText(x.f)}`)
    throw new AktionsFehler(`${titel} kann nicht gelöscht werden: ${teile.join('; ')}. ${CHARGE_HINWEIS}`)
  }
  if (mitCharge.length > 0 && !canAdmin(membership.role)) {
    throw new AktionsFehler(`${titel} kann nur von Betriebsleitern (Admin) gelöscht werden, weil dabei auch die daraus entstandenen Kellerbuch-Chargen gelöscht werden.`)
  }

  // 1. Behälterzeilen (verweisen per NO ACTION auf die Chargen)
  if (pbs.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pbDel, error: pbDelErr } = await (supabase.from('pressung_behaelter') as any)
      .delete().eq('pressung_id', id).select('id')
    if (pbDelErr) throw new AktionsFehler(dbFehlerText(pbDelErr, 'Löschen fehlgeschlagen (pressung_behaelter)'))
    if (((pbDel ?? []) as AR[]).length !== pbs.length) {
      throw new AktionsFehler('Die Behälterzeilen der Pressung konnten nicht gelöscht werden – keine Berechtigung oder inzwischen geändert. Bitte die Seite neu laden.')
    }
  }

  // 2. Chargen
  if (mitCharge.length > 0) {
    const waIds = [...new Set(mitCharge.map(b => b.weinausbau_id as string))]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: wDel, error: wDelErr } = await (supabase.from('weinausbau') as any)
      .delete().in('id', waIds).eq('tenant_id', tenantId).select('id')
    const geloescht = new Set(((wDel ?? []) as AR[]).map(w => w.id as string))
    if (wDelErr || geloescht.size !== waIds.length) {
      // Behälterzeilen der nicht gelöschten Chargen wiederherstellen – sonst blieben
      // Chargen ohne Zugang (Bewegungsbuch) zurück
      const wiederherstellen = pbs.filter(b => !b.weinausbau_id || !geloescht.has(b.weinausbau_id))
      let zusatz = ''
      if (wiederherstellen.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: rErr } = await (supabase.from('pressung_behaelter') as any).insert(wiederherstellen.map(b => ({
          id: b.id, pressung_id: id, behaelter_id: b.behaelter_id ?? null, weinausbau_id: b.weinausbau_id ?? null,
          menge_liter: b.menge_liter ?? null, notizen: b.notizen ?? null,
        })))
        zusatz = rErr
          ? ` Achtung: Die Behälterzeilen konnten nicht wiederhergestellt werden (${dbFehlerText(rErr)}) – bitte die Pressung prüfen.`
          : ' Die Pressung bleibt unverändert erhalten.'
      }
      throw new AktionsFehler(`Die Chargen der Pressung konnten nicht gelöscht werden: ${wDelErr ? dbFehlerText(wDelErr) : 'keine Berechtigung (nur Betriebsleiter)'}.${zusatz}`)
    }
  }

  // 3. Traubenzeilen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: pwDelErr } = await (supabase.from('pressung_weingaerten') as any)
    .delete().eq('pressung_id', id).select('id')
  if (pwDelErr) throw new AktionsFehler(dbFehlerText(pwDelErr, 'Löschen fehlgeschlagen (pressung_weingaerten)'))

  // 4. Pressung
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pDel, error: pDelErr } = await (supabase.from('pressungen') as any)
    .delete().eq('id', id).eq('tenant_id', tenantId).select('id')
  if (pDelErr) throw new AktionsFehler(dbFehlerText(pDelErr, 'Löschen fehlgeschlagen (pressungen)'))
  if (!(pDel as AR[] | null)?.length) throw new AktionsFehler('Die Pressung konnte nicht gelöscht werden – keine Berechtigung. Bitte die Seite neu laden.')

  revalidatePath(`/erntemeldung/${(p as AR).jahrgang_id ?? jahrgangId}`)
  revalidatePath('/kellerbuch')
}

// Jahrgang löschen (KAN-35): gesperrt, sobald Pressungen (und damit Kellerbuch-
// Chargen), Traubenverkäufe oder eine eingereichte/bestätigte/abgelehnte AMA-
// Erntemeldung daran hängen. Sonst genügt das Löschen des Jahrgangs: ernte_parzellen,
// ama_erntemeldungen (→ ama_meldepositionen) und pressungen hängen per ON DELETE
// CASCADE daran (Protokoll-Trigger halten jede Zeile fest).
const AMA_GESPERRT: Record<string, string> = {
  eingereicht: 'eingereicht',
  bestaetigt:  'von der AMA bestätigt',
  abgelehnt:   'von der AMA abgelehnt',
}

export async function deleteJahrgang(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const jg = await ladeJahrgang(supabase, tenantId, id)

  const [pressRes, tvRes, amaRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pressungen') as any)
      .select('id', { count: 'exact', head: true }).eq('jahrgang_id', id).eq('tenant_id', tenantId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('traubenverkauf') as any)
      .select('id', { count: 'exact', head: true }).eq('jahrgang_id', id).eq('tenant_id', tenantId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('ama_erntemeldungen') as any)
      .select('status').eq('jahrgang_id', id).eq('tenant_id', tenantId),
  ])
  for (const [tabelle, res] of [['pressungen', pressRes], ['traubenverkauf', tvRes], ['ama_erntemeldungen', amaRes]] as const) {
    if (res.error) throw new AktionsFehler(dbFehlerText(res.error, `Jahrgang konnte nicht geprüft werden (${tabelle})`))
  }
  const nPress = (pressRes.count as number | null) ?? 0
  const nTv    = (tvRes.count as number | null) ?? 0
  const amaStatus = ((amaRes.data ?? []) as AR[]).map(a => a.status as string).find(s => s in AMA_GESPERRT)

  const gruende: string[] = []
  if (nPress > 0) gruende.push(`${fmtNum(nPress, 0)} ${nPress === 1 ? 'Pressung ist' : 'Pressungen sind'} erfasst (daraus sind Kellerbuch-Chargen entstanden)`)
  if (nTv > 0)    gruende.push(`${fmtNum(nTv, 0)} ${nTv === 1 ? 'Traubenverkauf ist' : 'Traubenverkäufe sind'} erfasst`)
  if (amaStatus)  gruende.push(`die AMA-Erntemeldung ist bereits ${AMA_GESPERRT[amaStatus]}`)
  if (gruende.length > 0) {
    throw new AktionsFehler(`Der Jahrgang ${jg.jahrgang} kann nicht gelöscht werden: ${gruende.join('; ')}. Der Jahrgang bleibt als Historie erhalten.`
      + (nPress > 0 || nTv > 0 ? ' Pressungen ohne Folgebuchungen und Traubenverkäufe lassen sich vorher einzeln in der Lese löschen.' : ''))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: del, error } = await (supabase.from('weinjahrgaenge') as any)
    .delete().eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Löschen fehlgeschlagen (weinjahrgaenge)'))
  if (!(del as AR[] | null)?.length) throw new AktionsFehler('Der Jahrgang konnte nicht gelöscht werden – Löschen ist Betriebsleitern (Admin) vorbehalten. Bitte die Seite neu laden.')
  revalidatePath('/erntemeldung')
}

// ── Traubenverkauf ────────────────────────────────────────────────────────────

export async function createTraubenverkauf(fd: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // KAN-73: Trauben-Qualität = Stufen der Lese (traubenverkauf hat keinen CHECK) – vor jedem
  // Schreiben und vor der Liefernummer prüfen (keine Lücke im Nummernkreis)
  const qualitaetsstufe = (fd.get('qualitaetsstufe') as string) || null
  const qualitaetUnzulaessig = qualitaetFehler('lese', qualitaetsstufe)
  if (qualitaetUnzulaessig) throw new AktionsFehler(qualitaetUnzulaessig)
  // KAN-128: Mostgewicht aus Messwert und Einheit (übergangsweise altes Feld kmw_grad als °KMW) –
  // ebenfalls vor der Liefernummer prüfen; die Stufe bleibt, wie gewählt (Rechenregel 6)
  const mostgewicht = mostgewichtAusFormular(fd, 'mostgewicht', { altesFeld: 'kmw_grad' })
  if (!mostgewicht.ok) throw new AktionsFehler(mostgewicht.fehler)

  const jahrgangId   = fd.get('jahrgang_id') as string | null
  const weingartenId = (fd.get('weingarten_id') as string) || null
  const zukaufPostenId = (fd.get('zukauf_posten_id') as string) || null
  const grundstueckId = (fd.get('grundstueck_id') as string) || null
  const mengeKg      = parseFloat(dezimal((fd.get('menge_kg') as string)))
  const preisPerKg   = fd.get('preis_per_kg') ? parseFloat(dezimal((fd.get('preis_per_kg') as string))) : null
  const kontaktId    = (fd.get('kontakt_id') as string) || null
  const firmaId      = (fd.get('firma_id') as string) || null
  const datum        = fd.get('datum') as string

  // KAN-129: Jahrgang des Betriebs (N5), Lese und kg-Bilanz je Lese – vor Liefernummer und Schreiben
  const lese = await traubenverkaufLese(supabase, tenantId, {
    jahrgangId: jahrgangId || null, weingartenId, grundstueckId, zukaufPostenId, datum, mengeKg,
    leseIdFormular: (fd.get('lese_id') as string) || null, leseWaehlenText: LESE_WAEHLEN_MELDUNG,
  })
  if (lese.fehler) throw new AktionsFehler(lese.fehler)

  // Liefernummer auto-generieren – erst nach allen Prüfungen (keine Lücke im Nummernkreis)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lnData } = await (supabase.rpc as any)('get_next_liefernummer', { p_tenant_id: tenantId })
  const liefernummer = lnData as string | null

  const weingartenName = await ermittleQuellenName(supabase, weingartenId, zukaufPostenId, tenantId)

  const payload: AR = {
    tenant_id:       tenantId,
    jahrgang_id:     jahrgangId || null,
    lese_id:         lese.leseId,
    weingarten_id:   weingartenId,
    zukauf_posten_id: zukaufPostenId,
    grundstueck_id:  grundstueckId,
    kontakt_id:      kontaktId,
    firma_id:        firmaId,
    datum,
    menge_kg:        mengeKg,
    preis_per_kg:    preisPerKg,
    ...mostgewichtSpalten(mostgewicht.wert, 'kmw_grad'),
    qualitaetsstufe,
    gesundheit:      (fd.get('gesundheit') as string) || 'G',
    herkunft_code:   (fd.get('herkunft_code') as string) || null,
    notizen:         (fd.get('notizen') as string) || null,
    liefernummer,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error } = await (supabase.from('traubenverkauf') as any).insert(payload).eq('tenant_id', tenantId).select('id').single()
  if (error) throw new AktionsFehler((error as AR).message)

  // Verkaufsposten anlegen, damit der Traubenverkauf auch in der Buchhaltung/Rechnungsübersicht auftaucht
  // (dieselbe Logik wie weinhandel/traubenverkauf, damit beide Erfassungswege konsistent sind)
  const postenId = await createVerkaufspostenFuerTrauben(supabase, tenantId, {
    datum, kontaktId, firmaId, weingartenName, mengeKg, preisPerKg,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { const { error: e } = await (supabase.from('traubenverkauf') as any).update({ verkaufsposten_id: postenId }).eq('id', (inserted as AR).id).eq('tenant_id', tenantId)
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (traubenverkauf): ${e.message}`) }

  if (jahrgangId) revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/erntemeldung')
  revalidatePath('/weinhandel/verkauf')
}

// Traubenverkauf bearbeiten (KAN-35): derselbe Weg wie unter Weinhandel › Traubenverkauf
// (upsertTraubenverkauf) – Menge > 0, stornierte/uneindeutige Rechnung vorab abgelehnt,
// Rechnungsposition (Menge, Preis, Bezeichnung) und Kopf werden mitgezogen. Bisher blieb die
// Rechnung beim Bearbeiten über die Lese still auf dem alten Stand.
export async function updateTraubenverkauf(id: string, fd: FormData) {
  await getMembership()   // KAN-30/KAN-5: Betrieb und Schreibsperre vorab (upsertTraubenverkauf prüft erneut)
  const jahrgangId = fd.get('jahrgang_id') as string | null
  fd.set('existing_id', id)
  await upsertTraubenverkauf(fd)

  if (jahrgangId) revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/erntemeldung')
  revalidatePath('/weinhandel/verkauf')
}

// Traubenverkauf löschen (KAN-35): Der zugehörige Verkaufsposten (Rechnung) wird nie
// hart gelöscht, sondern über den regulären Verkaufsstorno (weinhandel/verkauf:
// stornoVerkauf → lib/verkauf/bestand.ts) storniert – der Beleg bleibt samt
// Rechnungsnummer erhalten, nicht gesperrte E&A-Buchungen werden wie beim Storno im
// Weinhandel entfernt. Trauben haben keinen Kellerbestand, eine Bestandsrückbuchung
// entfällt. Der Storno entfernt die Traubenverkauf-Zeilen des Postens selbst; ohne
// (offene) Rechnung wird die Zeile hier gelöscht. Das Bestandsprotokoll hält sie fest,
// die kg sind wieder verfügbar. Rechnungen mit weiteren Positionen nur im Weinhandel
// stornieren (gleiche Regel wie weinhandel/traubenverkauf/actions.ts).
export async function deleteTraubenverkauf(id: string, jahrgangId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tv, error: tvErr } = await (supabase.from('traubenverkauf') as any)
    .select('id, verkaufsposten_id').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (tvErr) throw new AktionsFehler(dbFehlerText(tvErr, 'Traubenverkauf konnte nicht geladen werden'))
  if (!tv) throw new AktionsFehler('Traubenverkauf nicht gefunden – bitte die Seite neu laden.')

  const postenId = (tv as AR).verkaufsposten_id as string | null
  let storniert = false
  if (postenId) {
    const [postenRes, posRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('verkaufsposten') as any)
        .select('id, rechnungsnummer, storniert').eq('id', postenId).eq('tenant_id', tenantId).maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('verkauf_positionen') as any)
        .select('id, typ, traubenverkauf_id').eq('verkaufsposten_id', postenId).eq('tenant_id', tenantId),
    ])
    if (postenRes.error) throw new AktionsFehler(dbFehlerText(postenRes.error, 'Rechnung zum Traubenverkauf konnte nicht geladen werden'))
    if (posRes.error) throw new AktionsFehler(dbFehlerText(posRes.error, 'Rechnungspositionen konnten nicht geladen werden'))
    const posten = postenRes.data as AR | null
    if (posten && !posten.storniert) {
      const positionen = (posRes.data ?? []) as AR[]
      // Nur die eine Trauben-Position dieses Verkaufs: Erfassung über Lese/Traubenverkauf
      // ('sonstiges' ohne Verweis) oder über das Verkaufsformular ('trauben' mit Verweis)
      const nurDieserVerkauf = positionen.length <= 1 && positionen.every(p =>
        (p.typ === 'trauben' && p.traubenverkauf_id === id) || (p.typ === 'sonstiges' && !p.traubenverkauf_id))
      if (!nurDieserVerkauf) {
        throw new AktionsFehler(`Der Traubenverkauf gehört zur Rechnung ${posten.rechnungsnummer ?? '(ohne Nummer)'} mit weiteren Positionen und kann hier nicht gelöscht werden. Bitte den Verkauf unter Weinhandel › Verkauf stornieren.`)
      }
      await stornoVerkauf(postenId)
      storniert = true
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: del, error } = await (supabase.from('traubenverkauf') as any)
    .delete().eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Löschen fehlgeschlagen (traubenverkauf)'))
  if (!(del as AR[] | null)?.length) {
    // 0 Zeilen: entweder hat der Storno die Zeile schon entfernt (gut) oder RLS hat still
    // nichts gelöscht
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: noch, error: nochErr } = await (supabase.from('traubenverkauf') as any)
      .select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
    if (nochErr) throw new AktionsFehler(dbFehlerText(nochErr, 'Traubenverkauf konnte nicht geprüft werden'))
    if (noch) {
      throw new AktionsFehler(`Der Traubenverkauf konnte nicht gelöscht werden – keine Berechtigung.${storniert ? ' Die zugehörige Rechnung wurde bereits storniert.' : ''}`)
    }
  }
  revalidatePath(`/erntemeldung/${jahrgangId}`)
  revalidatePath('/erntemeldung')
  revalidatePath('/weinhandel/traubenverkauf')
  revalidatePath('/weinhandel/verkauf')
}
