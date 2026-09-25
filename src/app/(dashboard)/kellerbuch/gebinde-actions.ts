'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ladeBehaelter, gebindeFehlerText } from '@/lib/keller/behaelter'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { fmtNum, dezimal, zahlAus } from '@/lib/format'
import { AktionsFehler, dbFehlerText, fehlerText } from '@/lib/fehler'
import { sperreBeiFolgebuchungen } from '@/lib/kellerbuch/folgebuchungen'
import {
  ladeUmzugZeilen, planeUmzugStorno, storniereUmzug, umzugSperrMeldung, umzugAlsEingabe, nurNotizenAenderbar,
  OHNE_MENGENWIRKUNG, GEBINDEWECHSEL_OHNE, type UmzugStornoPlan, type UmzugEingabe,
} from '@/lib/kellerbuch/storno'
import { KORREKTUR_NACH_OBEN_HINWEIS, KORREKTUR_NACH_UNTEN_HINWEIS } from '@/lib/kellerbuch/hinweise'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen/ersten
// tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft Daten des falschen
// Betriebs gelesen/verändert werden.
async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership.tenantId
}

// Storno/Änderung eines Umzugs bucht Chargen zurück und löscht Bewegungszeilen – die
// Rechte dafür vorab prüfen (weinausbau und keller_umzuege), damit nicht eine Hälfte
// durchgeht und die andere an RLS scheitert.
async function kellerbuchSchreibrecht(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: vor den Rechten – sonst meldet ein veralteter Tab die Rechte des neuen Betriebs
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return membership.tenantId
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
const rund2 = (n: number): number => Math.round(n * 100) / 100

// EROEFFNUNGSBESTAND

// Gemeinsame Einfuegelogik fuer Eroeffnungsbestand-Chargen - wird sowohl von der
// "normalen" Erfassung (Kellerbuch > Gebinde > Eroeffnungsbestand) als auch von der
// Anfangsbestandsbuchung im Datenimport (Gebinde) verwendet ("Chargenformular recyceln").
// Gibt bei Erfolg null zurueck, sonst die Fehlermeldung.
async function insertEroeffnungsbestand(formData: FormData): Promise<string | null> {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  const menge     = parseFloat(dezimal(formData.get('menge_liter') as string))
  const jahr      = new Date().getFullYear()
  // Keine aktiven 0-L- oder negativen Chargen (KAN-35; negativ scheitert zusätzlich am CHECK)
  if (!Number.isFinite(menge) || menge < 0.01) return 'Bitte eine Menge von mindestens 0,01 L angeben.'

  const epRaw = dezimal(formData.get('einstandspreis_pro_liter') as string) ?? ''
  // Transaktionsnummer vergeben
  const { data: txnEb } = await (supabase.rpc as any)('get_next_transaktionsnr', { p_tenant_id: tenantId, p_typ: 'eroeffnung' })

  const payload: R = {
    tenant_id:            tenantId,
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(dezimal(formData.get('jahrgang') as string)) || null,
    kmw:                  parseFloat(dezimal(formData.get('kmw') as string)) || null,
    menge_liter:          menge,
    anfangsbestand_liter: menge,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    behaelter_id:         (formData.get('behaelter_id') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: epRaw ? parseFloat(epRaw) : null,
    referenz_altsystem:   (formData.get('referenz_altsystem') as string) || null,
    transaktions_nr:      txnEb ?? null,
    status:               'ausbau',
    ist_eroeffnungsbestand: true,
    created_at:           new Date(`${jahr}-01-01T00:00:00`).toISOString(),
    aktiv:                true,
  }

  const { error } = await (supabase.from('weinausbau') as any).insert(payload)
  if (error) {
    console.error('[insertEroeffnungsbestand] DB Fehler:', (error as R).message, (error as R).code)
    return gebindeFehlerText(dbFehlerText(error))
  }
  revalidatePath('/kellerbuch/gebinde')
  return null
}

export async function createEroeffnungsbestand(formData: FormData) {
  const fehler = await insertEroeffnungsbestand(formData)
  if (fehler) {
    redirect(`/kellerbuch/gebinde?tab=eroeffnungsbestand&err=${encodeURIComponent(fehler)}`)
  }
  redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')
}

// Wie createEroeffnungsbestand, aber fuer die Anfangsbestandsbuchung innerhalb des
// Datenimport-Menuepunkts (Gebinde) - fuehrt nach dem Speichern zurueck zum Datenimport
// statt zum Kellerbuch. Diese Buchungsmoeglichkeit wird bewusst NUR dort angeboten.
export async function createEroeffnungsbestandVonImport(formData: FormData) {
  const fehler = await insertEroeffnungsbestand(formData)
  if (fehler) {
    redirect(`/admin/import?typ=gebinde&err=${encodeURIComponent(fehler)}`)
  }
  redirect('/admin/import?typ=gebinde&eb=1')
}

// Eröffnungsbestand bearbeiten (KAN-35, 24.09.2026)
// Die Menge ist der Anfangsbestand: sie schreibt anfangsbestand_liter UND menge_liter
// gemeinsam (vorher nur menge_liter – die Ansichten starten aber beim Anfangsbestand) und
// nur, solange an der Charge keine Mengenbewegung hängt und der Bestand noch dem
// Anfangsbestand entspricht. Ein Gebindewechsel ist nur ohne Folgebuchungen möglich
// (sonst wäre es ein Umzug ohne Bewegungszeile). Bezeichnung, Jahrgang, KMW, Qualität,
// Preis, Referenz und Notizen bleiben immer änderbar (Änderungen protokolliert die DB).
const EB_MENGE_HINWEIS = `${KORREKTUR_NACH_UNTEN_HINWEIS} ${KORREKTUR_NACH_OBEN_HINWEIS}`

async function eroeffnungsbestandSpeichern(id: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const { data: altRaw, error: ladeErr } = await (supabase.from('weinausbau') as any)
    .select('id, menge_liter, anfangsbestand_liter, behaelter_id, aktiv')
    .eq('id', id)
    .eq('ist_eroeffnungsbestand', true)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (ladeErr) throw new AktionsFehler(dbFehlerText(ladeErr, 'Eröffnungsbestand konnte nicht geladen werden'))
  if (!altRaw) throw new AktionsFehler('Eröffnungsbestand nicht gefunden')
  const alt = altRaw as R

  const epRaw2 = dezimal(formData.get('einstandspreis_pro_liter') as string) ?? ''
  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        parseInt(dezimal(formData.get('jahrgang') as string)) || null,
    kmw:             parseFloat(dezimal(formData.get('kmw') as string)) || null,
    qualitaetsstufe: (formData.get('qualitaetsstufe') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: epRaw2 ? parseFloat(epRaw2) : null,
    referenz_altsystem: (formData.get('referenz_altsystem') as string) || null,
  }

  // Menge = Anfangsbestand (fehlt das Feld, weil es gesperrt angezeigt wird: unverändert)
  const mengeRoh = formData.get('menge_liter')
  if (mengeRoh != null && String(mengeRoh).trim() !== '') {
    const menge = zahlAus(mengeRoh)
    if (menge == null || menge < 0.01) {
      throw new AktionsFehler('Bitte eine Menge von mindestens 0,01 L angeben. Ein Eröffnungsbestand ohne Menge bitte über „Löschen“ entfernen.')
    }
    const neu = rund2(menge)
    const bestand = num(alt.menge_liter)
    const anfang = alt.anfangsbestand_liter != null ? num(alt.anfangsbestand_liter) : bestand
    if (Math.abs(neu - anfang) > 0.001) {
      if (!alt.aktiv) {
        throw new AktionsFehler('Das Ändern der Menge ist nicht möglich: Der Eröffnungsbestand ist gelöscht bzw. abgeschlossen.')
      }
      await sperreBeiFolgebuchungen(supabase, id, 'Das Ändern der Menge des Eröffnungsbestands', {
        ohne: OHNE_MENGENWIRKUNG,
        hinweis: EB_MENGE_HINWEIS,
      })
      if (Math.abs(bestand - anfang) > 0.01) {
        throw new AktionsFehler(
          `Das Ändern der Menge des Eröffnungsbestands ist nicht möglich: Der aktuelle Bestand (${fmtNum(bestand, 2)} L) weicht bereits vom Anfangsbestand (${fmtNum(anfang, 2)} L) ab. ${EB_MENGE_HINWEIS}`,
        )
      }
      payload.anfangsbestand_liter = neu
      payload.menge_liter = neu
    }
  }

  // Gebinde – Wechsel nur ohne Folgebuchungen (sonst Umzug buchen)
  if (formData.has('behaelter_id')) {
    const neuesGebinde = (formData.get('behaelter_id') as string) || null
    if (neuesGebinde !== ((alt.behaelter_id as string | null) ?? null)) {
      await sperreBeiFolgebuchungen(supabase, id, 'Der Gebindewechsel', {
        ohne: GEBINDEWECHSEL_OHNE,
        hinweis: 'Bitte den Wechsel als Umzug buchen (Kellerbuch › Umziehen) – so bleibt das Bewegungsbuch beider Gebinde stimmig.',
      })
      payload.behaelter_id = neuesGebinde
    }
  }

  const { data, error } = await (supabase.from('weinausbau') as any)
    .update(payload)
    .eq('id', id)
    .eq('ist_eroeffnungsbestand', true)
    .eq('tenant_id', tenantId)
    .select('id')
  if (error) throw new AktionsFehler(gebindeFehlerText(dbFehlerText(error, 'Speichern fehlgeschlagen (weinausbau)')))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Speichern fehlgeschlagen: Eröffnungsbestand nicht gefunden oder keine Berechtigung.')
}

export async function updateEroeffnungsbestand(id: string, formData: FormData) {
  let fehler: string | null = null
  try {
    await eroeffnungsbestandSpeichern(id, formData)
  } catch (e) {
    fehler = fehlerText(e, 'Speichern fehlgeschlagen')
  }
  // redirect() außerhalb von try/catch – er wirft selbst (NEXT_REDIRECT)
  if (fehler) {
    console.error('[updateEroeffnungsbestand]', fehler)
    redirect(`/kellerbuch/eroeffnungsbestand/${id}/edit?err=${encodeURIComponent(fehler)}`)
  }
  revalidatePath('/kellerbuch/gebinde')
  redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')
}

// Eröffnungsbestand löschen (KAN-35): nur ohne Folgebuchungen. Die Charge bleibt als
// Datensatz erhalten (Historie, Protokoll), wird aber auf Anfangsbestand 0, Bestand 0 und
// inaktiv gesetzt – so zeigen View, Gebindeanzeige und Dashboard übereinstimmend 0
// (vorher nur aktiv=false: die View zählte den Anfangsbestand weiter).
export async function deleteEroeffnungsbestand(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  await sperreBeiFolgebuchungen(supabase, id, 'Das Löschen des Eröffnungsbestands', {
    hinweis: 'Der Eröffnungsbestand bleibt als Historie erhalten – Korrekturen bitte als eigene, datierte Buchung erfassen (z. B. „Schwund buchen“ auf der Chargen-Seite).',
  })

  const { data, error } = await (supabase.from('weinausbau') as any)
    .update({ anfangsbestand_liter: 0, menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
    .eq('id', id)
    .eq('ist_eroeffnungsbestand', true)
    .eq('tenant_id', tenantId)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Löschen fehlgeschlagen (weinausbau)'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Eröffnungsbestand nicht gefunden oder keine Berechtigung.')
  revalidatePath('/kellerbuch/gebinde')
}

// UMZIEHEN

type UmzugNeu = {
  datum: string
  notizen: string | null
  quellen: { weinausbau_id: string; brutto: number }[]
  ziele: { behaelter_id: string; menge_netto: number }[]
}

// JSON-Zahlen direkt übernehmen (zahlAus würde „1.234“ als Tausenderpunkt lesen),
// Texteingaben über zahlAus (deutsches Format)
const zahl = (v: unknown): number => typeof v === 'number' ? v : (zahlAus(v) ?? NaN)

/** Formularwerte lesen, ohne zu prüfen (für den Vergleich mit der bestehenden Buchung) */
function leseUmzugRoh(formData: FormData): UmzugNeu {
  let quellenRaw: unknown
  let zieleRaw: unknown
  try {
    quellenRaw = JSON.parse((formData.get('quellen_json') as string) || '[]')
    zieleRaw   = JSON.parse((formData.get('ziele_json')   as string) || '[]')
  } catch {
    throw new AktionsFehler('Ungültige Eingabe: Quellen und Ziele konnten nicht gelesen werden.')
  }
  if (!Array.isArray(quellenRaw) || !Array.isArray(zieleRaw)) {
    throw new AktionsFehler('Ungültige Eingabe: Quellen und Ziele fehlen.')
  }
  return {
    datum:   String(formData.get('datum') ?? '').trim(),
    notizen: String(formData.get('notizen') ?? '').trim() || null,
    quellen: (quellenRaw as R[])
      .map(q => ({ weinausbau_id: typeof q?.weinausbau_id === 'string' ? q.weinausbau_id.trim() : '', brutto: zahl(q?.brutto) }))
      .filter(q => q.weinausbau_id || q.brutto > 0),   // leere Formularzeilen ignorieren
    ziele: (zieleRaw as R[])
      .map(z => ({ behaelter_id: typeof z?.behaelter_id === 'string' ? z.behaelter_id.trim() : '', menge_netto: zahl(z?.menge_netto) }))
      .filter(z => z.behaelter_id || z.menge_netto > 0),
  }
}

/** Formularwerte lesen und prüfen: Datum, Charge/Gebinde je Zeile, Mengen > 0, kein Mehr am Ziel */
function leseUmzugEingabe(formData: FormData): UmzugNeu {
  const e = leseUmzugRoh(formData)
  if (!e.datum) throw new AktionsFehler('Bitte ein Datum angeben.')
  for (const q of e.quellen) {
    if (!q.weinausbau_id) throw new AktionsFehler('Bitte für jede Quell-Zeile eine Charge wählen.')
    if (!Number.isFinite(q.brutto) || q.brutto < 0.01) throw new AktionsFehler('Die Brutto-Menge jeder Quelle muss mindestens 0,01 L betragen.')
  }
  for (const z of e.ziele) {
    if (!z.behaelter_id) throw new AktionsFehler('Bitte für jede Ziel-Zeile ein Gebinde wählen.')
    if (!Number.isFinite(z.menge_netto) || z.menge_netto < 0.01) throw new AktionsFehler('Die Netto-Menge jedes Ziels muss mindestens 0,01 L betragen.')
  }
  if (e.quellen.length === 0 || e.ziele.length === 0) {
    throw new AktionsFehler('Bitte mindestens eine Quelle und ein Ziel angeben.')
  }
  const summeBrutto = e.quellen.reduce((s, q) => s + q.brutto, 0)
  const summeNetto  = e.ziele.reduce((s, z) => s + z.menge_netto, 0)
  if (summeNetto > summeBrutto + 0.01) {
    throw new AktionsFehler(`Die Ziel-Mengen (${fmtNum(summeNetto, 2)} L) übersteigen die Quell-Mengen (${fmtNum(summeBrutto, 2)} L) – ein Umzug kann keinen Wein erzeugen.`)
  }
  return e
}

/** Gleiche Buchung (Datum, Quellen, Ziele) – dann ändern sich höchstens die Notizen */
function gleicheBuchung(alt: UmzugEingabe, neu: UmzugNeu): boolean {
  if (alt.datum !== neu.datum) return false
  const summe = <T,>(liste: T[], key: (x: T) => string, menge: (x: T) => number) => {
    const m = new Map<string, number>()
    for (const x of liste) m.set(key(x), (m.get(key(x)) ?? 0) + (Number.isFinite(menge(x)) ? menge(x) : NaN))
    return m
  }
  const gleich = (a: Map<string, number>, b: Map<string, number>) =>
    a.size === b.size && [...a].every(([k, v]) => b.has(k) && Math.abs(v - b.get(k)!) < 0.001)
  return gleich(
    summe(alt.quellen.filter(q => q.weinausbau_id || q.brutto > 0), q => q.weinausbau_id, q => q.brutto),
    summe(neu.quellen, q => q.weinausbau_id, q => q.brutto),
  ) && gleich(
    summe(alt.ziele.filter(z => z.behaelter_id || z.menge_netto > 0), z => z.behaelter_id, z => z.menge_netto),
    summe(neu.ziele, z => z.behaelter_id, z => z.menge_netto),
  )
}

/**
 * Umzug vor der ersten Buchung prüfen: Ziel-Gebinde (Kellergemeinschaft) und Bestand der
 * Quellen (Menge je Charge summiert). `verfuegbarNach` ersetzt den Bestand einzelner
 * Chargen (Bestand nach dem Storno der bisherigen Buchung beim Bearbeiten).
 */
async function pruefeUmzug(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  e: UmzugNeu,
  verfuegbarNach?: Map<string, number>,
): Promise<{ quellCharge: Map<string, R>; bedarf: Map<string, number> }> {
  // Ziele (Kellergemeinschaft, Migration 203): eigenes oder freigegebenes, aktives Gebinde,
  // nicht durch einen anderen Betrieb belegt. Der DB-Trigger fängt das ebenfalls ab - aber
  // erst beim Ziel-Insert, wenn die Quellen schon reduziert wären.
  const zielGebinde = await ladeBehaelter(supabase, tenantId, { nurAktiv: true })
  for (const z of e.ziele) {
    const g = zielGebinde.find(b => b.id === z.behaelter_id)
    if (!g) throw new AktionsFehler('Ziel-Gebinde nicht gefunden oder nicht freigegeben.')
    if (g.gesperrt) throw new AktionsFehler(`Gebinde „${g.name}“ ist durch ${g.fremd_betrieb ?? 'einen anderen Betrieb'} belegt – Umziehen dorthin ist nicht möglich.`)
  }

  const bedarf = new Map<string, number>()
  for (const q of e.quellen) bedarf.set(q.weinausbau_id, (bedarf.get(q.weinausbau_id) ?? 0) + q.brutto)
  const { data: qRows, error } = await (supabase.from('weinausbau') as any)
    .select('*')
    .in('id', [...bedarf.keys()])
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Quell-Chargen konnten nicht geladen werden'))
  const quellCharge = new Map(((qRows ?? []) as R[]).map(w => [w.id as string, w]))
  for (const [id, menge] of bedarf) {
    const wa = quellCharge.get(id)
    if (!wa) throw new AktionsFehler('Quell-Charge nicht gefunden.')
    const verfuegbar = verfuegbarNach?.get(id) ?? num(wa.menge_liter)
    if (menge > verfuegbar + 0.01) {
      throw new AktionsFehler(`Brutto (${fmtNum(menge, { max: 2 })} L) für Charge „${wa.name}“ übersteigt den Bestand (${fmtNum(verfuegbar, { max: 2 })} L).`)
    }
  }
  return { quellCharge, bedarf }
}

/** Umzug buchen (Nebenweg des Bearbeiten-Formulars; der Hauptweg ist umziehen/actions.ts) */
async function umzugAnlegen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  e: UmzugNeu,
  opts: { umzugTyp?: string | null } = {},
): Promise<void> {
  // Alle Prüfungen vor der ersten Buchung
  const { quellCharge, bedarf } = await pruefeUmzug(supabase, tenantId, e)

  const batchId = crypto.randomUUID()

  // Transaktionsnummer für diesen Umzugs-Batch
  const { data: txnKu, error: txnErr } = await (supabase.rpc as any)('get_next_transaktionsnr', { p_tenant_id: tenantId, p_typ: 'umzug' })
  if (txnErr) throw new AktionsFehler(dbFehlerText(txnErr, 'Transaktionsnummer konnte nicht vergeben werden'))
  const typFeld = opts.umzugTyp ? { umzug_typ: opts.umzugTyp } : {}

  // --- Quellen: Bestand je Charge reduzieren, bei Rest ≤ 0,01 L abschließen (wie umziehen) ---
  for (const [id, menge] of bedarf) {
    const wa = quellCharge.get(id)!
    const rest = rund2(num(wa.menge_liter) - menge)
    const { error: e1 } = await (supabase.from('weinausbau') as any)
      .update(rest <= 0.01 ? { menge_liter: 0, aktiv: false, status: 'abgeschlossen' } : { menge_liter: rest })
      .eq('id', id)
      .eq('tenant_id', tenantId)
    if (e1) throw new AktionsFehler(dbFehlerText(e1, 'Speichern fehlgeschlagen (weinausbau)'))
  }

  // --- Quelle-Records anlegen ---
  for (let qi = 0; qi < e.quellen.length; qi++) {
    const q = e.quellen[qi]
    const wa = quellCharge.get(q.weinausbau_id)
    const { error: qErr } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:         tenantId,
      von_weinausbau_id: q.weinausbau_id,
      von_behaelter_id:  wa?.behaelter_id ?? null,
      datum:             e.datum,
      brutto_liter:      q.brutto,
      menge_liter:       q.brutto,
      schwund_liter:     0,
      notizen:           qi === 0 ? e.notizen : null,
      transaktions_nr:   qi === 0 ? (txnKu ?? null) : null,
      umzug_batch_id:    batchId,
      zeilen_typ:        'quelle',
      ...typFeld,
    })
    if (qErr) throw new AktionsFehler(dbFehlerText(qErr, 'Speichern fehlgeschlagen (keller_umzuege)'))
  }

  // --- Ziele verarbeiten ---
  // Lot-Metadaten (Name, Jahrgang, …) von der ersten Quelle übernehmen
  const hauptQuelle = quellCharge.get(e.quellen[0].weinausbau_id)

  for (const z of e.ziele) {
    // Bestehendes Lot im Ziel-Gebinde suchen (Name + Jahrgang).
    // WICHTIG: .eq('jahrgang', null) matched bei PostgREST NIE echte NULL-Werte – für
    // Chargen ohne Jahrgang (z.B. NV-Cuvées) muss .is() verwendet werden, sonst wird
    // nie das bestehende Lot gefunden und stattdessen jedes Mal ein neues angelegt.
    let existingQuery = (supabase.from('weinausbau') as any)
      .select('id, menge_liter, rebsorte')
      .eq('behaelter_id', z.behaelter_id)
      .eq('name', hauptQuelle?.name ?? '')
      .eq('aktiv', true)
      .eq('tenant_id', tenantId)
    existingQuery = (hauptQuelle?.jahrgang == null)
      ? existingQuery.is('jahrgang', null)
      : existingQuery.eq('jahrgang', hauptQuelle.jahrgang)
    const { data: existingArr, error: exErr } = await existingQuery.limit(1)
    if (exErr) throw new AktionsFehler(dbFehlerText(exErr, 'Ziel-Charge konnte nicht geladen werden'))
    let existing: R | null = ((existingArr ?? []) as R[])[0] ?? null

    // Rebsortenmix-Schutz: nicht blind in ein Lot mit anderer Rebsorte mischen (wie umziehen()
    // es für den normalen "neuer Umzug"-Weg bereits verhindert) – sonst würde beim Bearbeiten
    // eines Umzugs eine Verschneidung ohne Verschneidungs-Workflow/Kennzeichnung entstehen.
    if (existing && hauptQuelle?.rebsorte && existing.rebsorte && existing.rebsorte !== hauptQuelle.rebsorte) {
      existing = null
    }
    let nachWeinausbauId: string | null = null

    if (existing) {
      const altMenge = num(existing.menge_liter)
      { const { error: e2 } = await (supabase.from('weinausbau') as any)
        .update({ menge_liter: rund2(altMenge + z.menge_netto) })
        .eq('id', existing.id)
        .eq('tenant_id', tenantId)
        if (e2) throw new AktionsFehler(dbFehlerText(e2, 'Speichern fehlgeschlagen (weinausbau)')) }
      nachWeinausbauId = existing.id
    } else {
      const { data: neu, error: neuErr } = await (supabase.from('weinausbau') as any)
        .insert({
          tenant_id:            tenantId,
          name:                 hauptQuelle?.name ?? 'Unbekannt',
          jahrgang:             hauptQuelle?.jahrgang ?? null,
          rebsorte:             hauptQuelle?.rebsorte ?? null,
          qualitaetsstufe:      hauptQuelle?.qualitaetsstufe ?? null,
          status:               hauptQuelle?.status && hauptQuelle.status !== 'abgeschlossen' ? hauptQuelle.status : 'ausbau',
          behaelter_id:         z.behaelter_id,
          menge_liter:          z.menge_netto,
          anfangsbestand_liter: null,
          notizen:              null,
          aktiv:                true,
        })
        .select('id').single()
      if (neuErr) throw new AktionsFehler(gebindeFehlerText(dbFehlerText(neuErr)))
      nachWeinausbauId = (neu as R | null)?.id ?? null
    }

    // Ziel-Record anlegen
    const { error: zErr } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:          tenantId,
      nach_behaelter_id:  z.behaelter_id,
      nach_weinausbau_id: nachWeinausbauId,
      datum:              e.datum,
      menge_liter:        z.menge_netto,
      schwund_liter:      0,
      brutto_liter:       null,
      notizen:            null,
      umzug_batch_id:     batchId,
      zeilen_typ:         'ziel',
      ...typFeld,
    })
    if (zErr) throw new AktionsFehler(dbFehlerText(zErr, 'Speichern fehlgeschlagen (keller_umzuege)'))
  }
}

export async function createUmzug(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  await umzugAnlegen(supabase, tenantId, leseUmzugEingabe(formData))
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
}

function revalidiereUmzug(plan?: UmzugStornoPlan) {
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/behaelter', 'layout')
  for (const a of plan?.aenderungen ?? []) revalidatePath(`/kellerbuch/weinausbau/${a.id}`)
}

// Umzug bearbeiten (KAN-35, 24.09.2026): Bleiben Datum, Quellen und Ziele gleich, werden nur
// die Notizen geändert (immer erlaubt). Mengen-, Gebinde- und Datumsänderungen laufen als
// Storno + Neubuchung und sind nur unter denselben Bedingungen wie das Stornieren erlaubt
// (lib/kellerbuch/storno.ts). Die neue Buchung wird VOR dem Storno vollständig geprüft –
// vorher konnte ein Fehler beim Neuanlegen den Umzug ersatzlos vernichten.
export async function updateUmzugBatch(firstRecordId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()

  const zeilen = await ladeUmzugZeilen(supabase, tenantId, firstRecordId)
  if (!zeilen) throw new AktionsFehler('Umzug nicht gefunden')
  const alt = umzugAlsEingabe(zeilen)

  const roh = leseUmzugRoh(formData)
  if (gleicheBuchung(alt, roh)) {
    // Nur Notizen (stehen an der ersten Quell-Zeile)
    const { error } = await (supabase.from('keller_umzuege') as any)
      .update({ notizen: roh.notizen })
      .eq('id', alt.ersteId)
      .eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (keller_umzuege)'))
    revalidiereUmzug()
    redirect('/kellerbuch/gebinde?tab=umziehen')
  }

  const plan = await planeUmzugStorno(supabase, tenantId, zeilen)
  if (nurNotizenAenderbar(plan)) throw new AktionsFehler(umzugSperrMeldung(plan, 'aendern'))

  const neu = leseUmzugEingabe(formData)
  // Neue Buchung gegen den Bestand NACH dem Storno prüfen, bevor irgendetwas gebucht wird
  await pruefeUmzug(supabase, tenantId, neu, new Map(plan.aenderungen.map(a => [a.id, a.neu])))

  await storniereUmzug(supabase, tenantId, plan)
  const umzugTyp = (zeilen.find(z => z.umzug_typ && z.umzug_typ !== 'normal')?.umzug_typ as string | undefined) ?? null
  try {
    await umzugAnlegen(supabase, tenantId, neu, { umzugTyp })
  } catch (e) {
    revalidiereUmzug(plan)
    throw new AktionsFehler(`Der bisherige Umzug wurde storniert, der geänderte konnte aber nicht gebucht werden: ${fehlerText(e)} Bitte den Umzug neu erfassen.`)
  }
  revalidiereUmzug(plan)
  redirect('/kellerbuch/gebinde?tab=umziehen')
}

// Umzug stornieren (KAN-35, 24.09.2026): nur, solange die Ziel-Charge seit der Buchung nicht
// weiterbewegt wurde und die Rückbuchung vollständig möglich ist; Quellen werden dabei wieder
// aktiv, leer gewordene Ziel-Chargen abgeschlossen. Umzüge im alten Zeilenformat sind nicht
// stornierbar; Schwundbuchungen nur durch Betriebs-Manager und nur, wenn sie nachweislich den
// Bestand gemindert haben und an der Charge seither nichts gebucht wurde
// (lib/kellerbuch/storno.ts). Alles oder nichts; das Löschen protokolliert die DB.
export async function deleteUmzug(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()

  const zeilen = await ladeUmzugZeilen(supabase, tenantId, id)
  if (!zeilen) throw new AktionsFehler('Umzug nicht gefunden')
  if (zeilen.some(z => z.umzug_typ === 'schwund')) {
    const m = await getCurrentMembership()
    if (!canAdmin(m?.role ?? null)) {
      throw new AktionsFehler('Schwundbuchungen können nur Betriebs-Manager stornieren (sie sehen im Bestandsprotokoll, ob die Buchung den Bestand gemindert hat).')
    }
  }
  const plan = await planeUmzugStorno(supabase, tenantId, zeilen)
  await storniereUmzug(supabase, tenantId, plan)   // wirft bei Sperre die deutsche Meldung

  revalidiereUmzug(plan)
}
