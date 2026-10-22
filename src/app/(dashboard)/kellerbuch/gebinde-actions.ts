'use server'

import { zielNachAbschluss } from '@/lib/navigation/zurueck'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ladeBehaelter, gebindeFehlerText } from '@/lib/keller/behaelter'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { fmtNum, dezimal, zahlAus } from '@/lib/format'
import { AktionsFehler, dbFehlerText, fehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { qualitaetFehler, qualitaetsAngabeAusFormular, qualitaetsAngabeFehler } from '@/lib/wein/qualitaet'
import { normalisiereQualitaet, qualitaetsSpalten } from '@/lib/wein/qualitaetsrang'
import { sperreBeiFolgebuchungen } from '@/lib/kellerbuch/folgebuchungen'
import {
  ladeUmzugZeilen, planeUmzugStorno, storniereUmzug, umzugSperrMeldung, umzugAlsEingabe, nurNotizenAenderbar,
  OHNE_MENGENWIRKUNG, GEBINDEWECHSEL_OHNE, type UmzugStornoPlan, type UmzugEingabe,
} from '@/lib/kellerbuch/storno'
import { KORREKTUR_NACH_OBEN_HINWEIS, KORREKTUR_NACH_UNTEN_HINWEIS } from '@/lib/kellerbuch/hinweise'
import { GRUND_BEARBEITET, stornoGrundFehler } from '@/lib/storno/grund'
import { mostgewichtAusFormular, mostgewichtSpalten } from '@/lib/wein/mostgewichtFormular'
import { mostgewichtNeu, mostgewichtZusammenfuehren, teilweiseVermerk, umzugMomentaufnahme, type Anteil } from '@/lib/kellerbuch/mostgewichtKette'
import { wienHeute } from '@/lib/csv'
import { waehleZielCharge } from '@/lib/kellerbuch/umzugZiel'
import { quellGebinde, selbesGebindeFehler } from '@/lib/kellerbuch/umzugGebinde'
import { pruefePruefnummernSchaden } from '@/lib/kellerbuch/pruefnummerLaden'
import { herkunftKnoten } from '@/lib/herkunft'
import { eroeffnungsStichtagFehler, eroeffnungsZeitpunkt, standardEroeffnungsStichtag } from '@/lib/kellerbuch/eroeffnungsStichtag'
import { ladeGebindeStand } from '@/lib/kellerbuch/eroeffnungsGebinde'
import { eroeffnungsVermerk, pruefeTankZeilen, tankFormularWerte, type DateiBefund, type TankEingabe } from '@/lib/import/eroeffnungsbestand'
import { rund } from '@/lib/zahl/runden'

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
  // KAN-244: wie RLS (weinausbau: Kellerbuch oder Rieden) – Eröffnungsbestand anlegen prüfte vorher nur die Datenbank
  if (!canWrite(membership, 'kellerbuch') && !canWrite(membership, 'rieden')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
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
const rund2 = (n: number): number => rund(n, 2)

// EROEFFNUNGSBESTAND

// Gemeinsame Einfuegelogik fuer Eroeffnungsbestand-Chargen - wird sowohl von der
// "normalen" Erfassung (Kellerbuch > Gebinde > Eroeffnungsbestand) als auch von der
// Anfangsbestandsbuchung im Datenimport (Gebinde) verwendet ("Chargenformular recyceln")
// und seit KAN-42 vom CSV-Import „Eröffnungsbestand Tank“ (importiereEroeffnungTank, je Zeile
// dieselben Formularfelder). `kontext` = bereits geprüfter Betrieb des Imports (sonst getTenantId()).
// Gibt bei Erfolg null zurueck, sonst die Fehlermeldung.
async function insertEroeffnungsbestand(
  formData: FormData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kontext?: { supabase: any; tenantId: string },
): Promise<string | null> {
  const supabase  = kontext?.supabase ?? await createSupabaseServerClient()
  const tenantId  = kontext?.tenantId ?? await getTenantId()
  const menge     = parseFloat(dezimal(formData.get('menge_liter') as string))
  // KAN-42: Stichtag wählbar (Standard 01.01. des laufenden Jahres, Wiener Zeit) – gespeichert als created_at
  // 00:00 Uhr Wiener Zeit (eroeffnungsZeitpunkt), gelesen als Wiener Kalendertag (eroeffnungsTag)
  const heute     = wienHeute()
  const stichtag  = String(formData.get('stichtag') ?? '').trim() || standardEroeffnungsStichtag(heute)
  const stichtagUnzulaessig = eroeffnungsStichtagFehler(stichtag, heute)
  if (stichtagUnzulaessig) return stichtagUnzulaessig
  // Keine aktiven 0-L- oder negativen Chargen (KAN-35; negativ scheitert zusätzlich am CHECK)
  if (!Number.isFinite(menge) || menge < 0.01) return 'Bitte eine Menge von mindestens 0,01 L angeben.'
  // KAN-73: nur Stufen des CHECK weinausbau (QUALITAET_OPTS) – vor der Transaktionsnummer prüfen.
  // KAN-186: dazu Zusatzbezeichnung und Erzeugnis; ein Altwert (reserve, sekt …) wird normalisiert.
  const angabe = qualitaetsAngabeAusFormular(formData)
  const qualitaetUnzulaessig = qualitaetFehler('charge', angabe.stufe)
  if (qualitaetUnzulaessig) return qualitaetUnzulaessig
  // KAN-204: Gebinde und Qualitätsstufe Pflicht; Jahrgang, Rebsorte, Weinart, Herkunft dürfen fehlen (Hinweis im Formular)
  if (!(formData.get('behaelter_id') as string)) return 'Bitte das Gebinde angeben.'
  if (!angabe.stufe) return 'Bitte die Qualitätsstufe angeben (z. B. Wein, Landwein, Qualitätswein).'
  const angabeUnzulaessig = qualitaetsAngabeFehler(angabe)
  if (angabeUnzulaessig) return angabeUnzulaessig
  // KAN-130 Etappe 3 (02.10.2026): Mostgewicht aus Messwert und Einheit (MostgewichtEingabe, °KMW oder °Oe;
  // übergangsweise das alte Feld kmw als °KMW) – beide Werte serverseitig gerechnet und vor der
  // Transaktionsnummer geprüft. Die Qualitätsstufe bleibt, wie gewählt (Rechenregel 6).
  const mostgewicht = mostgewichtAusFormular(formData, 'mostgewicht', { altesFeld: 'kmw' })
  if (!mostgewicht.ok) return mostgewicht.fehler
  // KAN-42: optionale Stammdaten (Import „Eröffnungsbestand Tank“) – nur Werte der Auswahllisten
  const text = (k: string) => { const v = formData.get(k); return typeof v === 'string' && v.trim() ? v.trim() : null }
  const weinart = text('weinart')
  if (weinart && !WEINARTEN.includes(weinart)) return `Die Weinart „${weinart}“ ist unbekannt – weiß, rot oder rosé.`
  const herkunftCode = text('herkunft_code')
  if (herkunftCode && herkunftCode !== 'sonstiges' && !herkunftKnoten(herkunftCode)) return `Der Herkunfts-Code „${herkunftCode}“ ist unbekannt.`

  const epRaw =dezimal(formData.get('einstandspreis_pro_liter') as string) ?? ''
  // Transaktionsnummer vergeben
  const { data: txnEb, error: txnErr } = await (supabase.rpc as any)('get_next_transaktionsnr', { p_tenant_id: tenantId, p_typ: 'eroeffnung' })
  if (txnErr) throw new AktionsFehler(dbFehlerText(txnErr, 'Transaktionsnummer konnte nicht vergeben werden'))

  const payload: R = {
    tenant_id:            tenantId,
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(dezimal(formData.get('jahrgang') as string)) || null,   // null-vorgabe-ok: Jahrgang 0 ist ungültig – leer
    ...mostgewichtSpalten(mostgewicht.wert, 'kmw'),   // kmw, oechsle, mostgewicht_einheit
    menge_liter:          menge,
    anfangsbestand_liter: menge,
    ...qualitaetsSpalten(angabe),
    behaelter_id:         (formData.get('behaelter_id') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: epRaw ? parseFloat(epRaw) : null,
    referenz_altsystem:   (formData.get('referenz_altsystem') as string) || null,
    transaktions_nr:      txnEb ?? null,
    status:               'ausbau',
    ist_eroeffnungsbestand: true,
    created_at:           eroeffnungsZeitpunkt(stichtag),
    aktiv:                true,
    ...(text('rebsorte') ? { rebsorte: text('rebsorte') } : {}),
    ...(weinart ? { weinart } : {}),
    ...(herkunftCode ? { herkunft_code: herkunftCode } : {}),
  }

  const { error } = await (supabase.from('weinausbau') as any).insert(payload)
  if (error) {
    console.error('[insertEroeffnungsbestand] DB Fehler:', (error as R).message, (error as R).code)
    return gebindeFehlerText(dbFehlerText(error))
  }
  revalidatePath('/kellerbuch/gebinde')
  return null
}

const WEINARTEN = ['weiss', 'rot', 'rose', 'unbekannt']

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

  // KAN-73: nur Stufen des CHECK weinausbau (QUALITAET_OPTS) – verständliche Meldung statt 23514
  // KAN-186: dazu Zusatzbezeichnung und Erzeugnis; ein Altwert (reserve, sekt …) wird normalisiert.
  const angabe = qualitaetsAngabeAusFormular(formData)
  const qualitaetUnzulaessig = qualitaetFehler('charge', angabe.stufe)
  if (qualitaetUnzulaessig) throw new AktionsFehler(qualitaetUnzulaessig)
  if (!angabe.stufe) throw new AktionsFehler('Bitte die Qualitätsstufe angeben (z. B. Wein, Landwein, Qualitätswein).')   // KAN-204
  const angabeUnzulaessig = qualitaetsAngabeFehler(angabe)
  if (angabeUnzulaessig) throw new AktionsFehler(angabeUnzulaessig)
  // KAN-130 Etappe 3 (02.10.2026): Mostgewicht wie beim Anlegen – geschrieben nur, wenn das Formular es
  // mitschickt (ein Formular ohne Feld lässt das gespeicherte stehen); leer = beide Spalten NULL.
  const mostgewicht = mostgewichtAusFormular(formData, 'mostgewicht', { altesFeld: 'kmw' })
  if (!mostgewicht.ok) throw new AktionsFehler(mostgewicht.fehler)

  const epRaw2 = dezimal(formData.get('einstandspreis_pro_liter') as string) ?? ''
  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        parseInt(dezimal(formData.get('jahrgang') as string)) || null,   // null-vorgabe-ok: Jahrgang 0 ist ungültig – leer
    ...(mostgewicht.uebermittelt ? mostgewichtSpalten(mostgewicht.wert, 'kmw') : {}),
    ...qualitaetsSpalten(angabe),
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
  redirect(zielNachAbschluss(formData.get('zurueck'), '/kellerbuch/gebinde?tab=eroeffnungsbestand', 'gespeichert'))   // KAN-224
}

// Eröffnungsbestand stornieren (KAN-35; KAN-145 B3, 30.09.2026): nur ohne Folgebuchungen. Die Charge bleibt als
// Datensatz erhalten, der Anfangsbestand bleibt stehen („Wert bleibt, Storno statt 0 L“); Bestand 0, inaktiv,
// abgeschlossen und das Storno-Kennzeichen mit Grund. Füllstand-Sicht und Bewegungsbuch lassen stornierte
// Eröffnungsbestände aus bzw. zeigen Buchung und Gegenbuchung.
export async function deleteEroeffnungsbestand(id: string, grund: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)

  await sperreBeiFolgebuchungen(supabase, id, 'Das Löschen des Eröffnungsbestands', {
    hinweis: 'Der Eröffnungsbestand bleibt als Historie erhalten – Korrekturen bitte als eigene, datierte Buchung erfassen (z. B. „Schwund buchen“ auf der Chargen-Seite).',
  })

  const { data, error } = await (supabase.from('weinausbau') as any)
    .update({ menge_liter: 0, aktiv: false, status: 'abgeschlossen', storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id)
    .eq('ist_eroeffnungsbestand', true)
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Stornieren fehlgeschlagen (weinausbau)'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Eröffnungsbestand nicht gefunden, bereits storniert oder keine Berechtigung.')
  revalidatePath('/kellerbuch/gebinde')
}

// ── KAN-42: CSV-Import „Eröffnungsbestand Tank“ (Datenimport) ───────────────────────────────────────────
// Vorschau (pruefeEroeffnungTank) und Import (importiereEroeffnungTank) prüfen jede Zeile mit derselben
// Funktion (lib/import/eroeffnungsbestand.ts) gegen den Gebindestand heute und am Stichtag; angelegt wird je
// gültiger Zeile über insertEroeffnungsbestand – dieselbe Logik wie das Einzelformular. Rechte wie der
// Datenimport (Super-Admin/Betriebs-Manager) und Schreibrecht Kellerbuch.

async function eroeffnungImportKontext() {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: vor den Rechten
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (membership.role !== 'system_admin' && membership.role !== 'tenant_admin') {
    throw new AktionsFehler('Der Datenimport ist Super-Admins und Betriebs-Managern vorbehalten.')
  }
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return { supabase: await createSupabaseServerClient(), tenantId: membership.tenantId }
}

type ImportZeilen = { kopf: string[]; zeilen: Record<string, string>[]; zeilenOffset?: number }

function importStichtag(stichtag: unknown): string {
  const s = typeof stichtag === 'string' ? stichtag.trim() : ''
  const f = eroeffnungsStichtagFehler(s, wienHeute())
  if (f) throw new AktionsFehler(f)
  return s
}

function importDaten(d: ImportZeilen): ImportZeilen {
  if (!d || !Array.isArray(d.kopf) || !Array.isArray(d.zeilen)) throw new AktionsFehler('Ungültige Importdaten – bitte die Datei erneut wählen.')
  if (d.zeilen.length > IMPORT_MAX_ZEILEN) throw new AktionsFehler(`Höchstens ${IMPORT_MAX_ZEILEN} Zeilen je Aufruf.`)
  return {
    kopf: d.kopf.map(h => String(h ?? '')),
    zeilen: d.zeilen.map(z => Object.fromEntries(Object.entries(z ?? {}).map(([k, v]) => [String(k), String(v ?? '')]))),
    zeilenOffset: Number.isInteger(d.zeilenOffset) && (d.zeilenOffset ?? 0) > 0 ? d.zeilenOffset : 0,
  }
}

const IMPORT_MAX_ZEILEN = 500

/** Vorschau: jede Zeile geprüft, nichts gespeichert */
export async function pruefeEroeffnungTank(stichtag: string, daten: ImportZeilen): Promise<DateiBefund<TankEingabe>> {
  const { supabase, tenantId } = await eroeffnungImportKontext()
  const tag = importStichtag(stichtag)
  const d = importDaten(daten)
  const gebinde = await ladeGebindeStand(supabase, tenantId, tag)
  return pruefeTankZeilen(d.kopf, d.zeilen, gebinde, { stichtag: tag, zeilenOffset: d.zeilenOffset })
}

export type EroeffnungImportErgebnis = {
  importiert: number
  /** je Zeile: Fehler der Prüfung bzw. beim Speichern (übersprungen) */
  fehler: { zeile: number; titel: string; meldungen: string[] }[]
}

/** Import: prüft erneut (nie der Vorschau des Browsers vertrauen) und legt die gültigen Zeilen an */
export async function importiereEroeffnungTank(stichtag: string, daten: ImportZeilen, herkunft: string): Promise<EroeffnungImportErgebnis> {
  const kontext = await eroeffnungImportKontext()
  const tag = importStichtag(stichtag)
  const d = importDaten(daten)
  const gebinde = await ladeGebindeStand(kontext.supabase, kontext.tenantId, tag)
  const befund = pruefeTankZeilen(d.kopf, d.zeilen, gebinde, { stichtag: tag, zeilenOffset: d.zeilenOffset })
  if (befund.dateiFehler.length > 0) throw new AktionsFehler(befund.dateiFehler.join(' '))
  const vermerk = eroeffnungsVermerk(tag, String(herkunft ?? '').slice(0, 120), wienHeute())
  const ergebnis: EroeffnungImportErgebnis = { importiert: 0, fehler: [] }
  for (const z of befund.zeilen) {
    if (!z.eingabe) { ergebnis.fehler.push({ zeile: z.zeile, titel: z.titel, meldungen: z.fehler }); continue }
    const fd = new FormData()
    for (const [k, v] of Object.entries(tankFormularWerte(z.eingabe, tag, vermerk))) fd.set(k, v)
    const fehler = await insertEroeffnungsbestand(fd, kontext)
    if (fehler) ergebnis.fehler.push({ zeile: z.zeile, titel: z.titel, meldungen: [fehler] })
    else ergebnis.importiert++
  }
  revalidatePath('/kellerbuch')
  return ergebnis
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
): Promise<{ quellCharge: Map<string, R>; bedarf: Map<string, number>; pnFragen: string[]; pnNotizJeCharge: Map<string, string> }> {
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
  // KAN-340: wie umziehen() – Ziel = Gebinde einer Quelle legte sonst eine zweite Charge ins selbe Gebinde
  const selbes = selbesGebindeFehler(quellGebinde(quellCharge.values()), e.ziele.map(z => z.behaelter_id))
  if (selbes) throw new AktionsFehler(selbes)

  // KAN-112: Ein Umzug in ein Gebinde mit abweichendem Wein (Rebsorte, Jahrgang, Herkunft, Qualität) bzw. aus Quellen
  // mit verschiedenen Merkmalen ist ein Verschnitt – beim Bearbeiten (Storno + Neubuchung) nicht still eine zweite
  // Charge ins Gebinde legen, sondern ablehnen. Chargen, die der Storno der bisherigen Buchung leert, zählen nicht.
  // KAN-183: Zusammenführung in eine bestehende Charge – Prüfnummern-Rückfrage wie umziehen() (KAN-83/KAN-94);
  // bei eingereichtem Antrag lehnt pruefePruefnummernSchaden hart ab
  const zielMenge = new Map<string, { name: string | null; liter: number }>()
  for (const z of e.ziele) {
    const tank = await zielChargenImGebinde(supabase, tenantId, z.behaelter_id, bedarf)
    const { istVerschnitt, vorhanden } = waehleZielCharge(tank.filter(c => (verfuegbarNach?.get(c.id) ?? 1) > 0.01), [...quellCharge.values()])
    if (istVerschnitt) throw new AktionsFehler(UMZUG_WAERE_VERSCHNITT)
    if (vorhanden) {
      const bisher = zielMenge.get(vorhanden.id)
      zielMenge.set(vorhanden.id, { name: vorhanden.name ?? null, liter: (bisher?.liter ?? 0) + z.menge_netto })
    }
  }
  const pnFragen: string[] = []
  const pnNotizJeCharge = new Map<string, string>()
  for (const [chargeId, { name, liter }] of zielMenge) {
    const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'umzug', [{ chargeId, name, zugangLiter: liter }], e.datum)
    if (!pn) continue
    pnFragen.push(pn.frage)
    pnNotizJeCharge.set(chargeId, pn.notiz)
  }
  return { quellCharge, bedarf, pnFragen, pnNotizJeCharge }
}

const UMZUG_WAERE_VERSCHNITT = 'Dieser Umzug wäre ein Verschnitt – bitte stornieren und über ‚Umziehen‘ neu buchen.'

/** KAN-112: aktive Chargen im Ziel-Gebinde (ohne die Quellen des Umzugs) – Grundlage für waehleZielCharge */
async function zielChargenImGebinde(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  behaelterId: string,
  quellen: Map<string, number>,
): Promise<R[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('weinausbau') as any)
    .select('id, name, menge_liter, rebsorte, jahrgang, herkunft_code, qualitaetsstufe, zusatzbezeichnung, erzeugnis, kmw, oechsle, mostgewicht_einheit')
    .eq('behaelter_id', behaelterId)
    .eq('aktiv', true)
    .neq('status', 'abgeschlossen')
    .eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Ziel-Chargen konnten nicht geladen werden'))
  return ((data ?? []) as R[]).filter(c => !quellen.has(c.id))
}

/** Umzug buchen (Nebenweg des Bearbeiten-Formulars; der Hauptweg ist umziehen/actions.ts) */
/** KAN-130 Etappe 2: Anteile eines Ziels – jede Quelle im Verhältnis ihrer Brutto-Menge */
function umzugAnteile(e: UmzugNeu, quellCharge: Map<string, R>, liter: number): Anteil[] {
  const summe = e.quellen.reduce((s, q) => s + q.brutto, 0)
  return e.quellen.map(q => ({ liter: summe > 0 ? liter * q.brutto / summe : 0, charge: quellCharge.get(q.weinausbau_id) }))
}

async function umzugAnlegen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  e: UmzugNeu,
  opts: { umzugTyp?: string | null; pnNotizJeCharge?: Map<string, string> } = {},
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
    const { data: d1, error: e1 } = await (supabase.from('weinausbau') as any)
      .update(rest <= 0.01 ? { menge_liter: 0, aktiv: false, status: 'abgeschlossen' } : { menge_liter: rest })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id')
    if (e1) throw new AktionsFehler(dbFehlerText(e1, 'Speichern fehlgeschlagen (weinausbau)'))
    // KAN-183: ohne Treffer keine Umzugszeile (sonst Bewegung ohne Bestandsänderung)
    if (((d1 ?? []) as R[]).length !== 1) throw new AktionsFehler(`Charge „${wa.name}“ konnte nicht geändert werden – bitte die Seite neu laden. Es wurde nichts gebucht.`)
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
    // KAN-112: Ziel-Charge mit derselben Regel wie umziehen() (waehleZielCharge) – gleiche Merkmale → zusammenführen,
    // leeres Gebinde → neue Charge; ein Verschnitt ist oben in pruefeUmzug abgelehnt (bisher: Suche nach Name + Jahrgang,
    // bei anderer Rebsorte still eine zweite Charge im Gebinde)
    const tank = await zielChargenImGebinde(supabase, tenantId, z.behaelter_id, bedarf)
    const wahl = waehleZielCharge(tank, [...quellCharge.values()])
    if (wahl.istVerschnitt) throw new AktionsFehler(UMZUG_WAERE_VERSCHNITT)
    const existing: R | null = wahl.vorhanden
    let nachWeinausbauId: string | null = null
    // KAN-130 Etappe 2: Mostgewicht – Momentaufnahme an der Zielzeile, Vermerk bei „teilweise“
    let mostgewichtSnapshot: R = {}
    let zielNotiz: string | null = null

    if (existing) {
      const altMenge = num(existing.menge_liter)
      const mg = mostgewichtZusammenfuehren(existing, altMenge, umzugAnteile(e, quellCharge, z.menge_netto))
      mostgewichtSnapshot = umzugMomentaufnahme(mg)
      if (mg.werte) zielNotiz = teilweiseVermerk(mg)
      { const { data: d2, error: e2 } = await (supabase.from('weinausbau') as any)
        .update({ menge_liter: rund2(altMenge + z.menge_netto), ...(mg.werte ?? {}) })
        .eq('id', existing.id)
        .eq('tenant_id', tenantId)
        .select('id')
        if (e2) throw new AktionsFehler(dbFehlerText(e2, 'Speichern fehlgeschlagen (weinausbau)'))
        // KAN-183: Ziel-Charge nicht geändert → keine Zielzeile
        if (((d2 ?? []) as R[]).length !== 1) throw new AktionsFehler(`Ziel-Charge „${existing.name ?? ''}“ konnte nicht geändert werden – bitte den Umzug prüfen und neu erfassen.`) }
      // KAN-183: Vermerk „Prüfnummer gilt nicht mehr“ (bestätigte Rückfrage) an der Zielzeile
      const pnNotiz = opts.pnNotizJeCharge?.get(existing.id)
      if (pnNotiz) zielNotiz = [zielNotiz, pnNotiz].filter(Boolean).join(' · ')
      nachWeinausbauId = existing.id
    } else {
      const mg = mostgewichtNeu(umzugAnteile(e, quellCharge, z.menge_netto))
      if (mg.spalten) zielNotiz = teilweiseVermerk(mg)
      const { data: neu, error: neuErr } = await (supabase.from('weinausbau') as any)
        .insert({
          ...(mg.spalten ?? {}),
          tenant_id:            tenantId,
          name:                 hauptQuelle?.name ?? 'Unbekannt',
          jahrgang:             hauptQuelle?.jahrgang ?? null,
          rebsorte:             hauptQuelle?.rebsorte ?? null,
          // KAN-112: Herkunft und Weinart wie die (gleichen) Quellen – sonst wiche die neue Charge von ihnen ab
          herkunft_code:        hauptQuelle?.herkunft_code ?? null,
          weinart:              hauptQuelle?.weinart ?? 'unbekannt',
          ...qualitaetsSpalten(normalisiereQualitaet(hauptQuelle)),   // KAN-186: samt Zusatz/Erzeugnis, nie ein Altwert
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
      notizen:            zielNotiz,
      ...mostgewichtSnapshot,
      umzug_batch_id:     batchId,
      zeilen_typ:         'ziel',
      ...typFeld,
    })
    if (zErr) throw new AktionsFehler(dbFehlerText(zErr, 'Speichern fehlgeschlagen (keller_umzuege)'))
  }
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
// KAN-183: bestaetigung = Rückfrage „Prüfnummer gilt nicht mehr“ – nichts gebucht; mit pn_bestaetigt=1 erneut senden
export async function updateUmzugBatch(firstRecordId: string, formData: FormData): Promise<{ bestaetigung?: string } | void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()

  const zeilen = await ladeUmzugZeilen(supabase, tenantId, firstRecordId)
  if (!zeilen) throw new AktionsFehler('Umzug nicht gefunden')
  const alt = umzugAlsEingabe(zeilen)

  const roh = leseUmzugRoh(formData)
  if (gleicheBuchung(alt, roh)) {
    // Nur Notizen (stehen an der ersten Quell-Zeile)
    const { data: geaendert, error } = await (supabase.from('keller_umzuege') as any)
      .update({ notizen: roh.notizen })
      .eq('id', alt.ersteId)
      .eq('tenant_id', tenantId).select('id')
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (keller_umzuege)'))
    if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
    revalidiereUmzug()
    redirect(zielNachAbschluss(formData.get('zurueck'), '/kellerbuch/gebinde?tab=umziehen', 'gespeichert'))   // KAN-224
  }

  const plan = await planeUmzugStorno(supabase, tenantId, zeilen)
  if (nurNotizenAenderbar(plan)) throw new AktionsFehler(umzugSperrMeldung(plan, 'aendern'))

  const neu = leseUmzugEingabe(formData)
  // Neue Buchung gegen den Bestand NACH dem Storno prüfen, bevor irgendetwas gebucht wird
  const { pnFragen, pnNotizJeCharge } = await pruefeUmzug(supabase, tenantId, neu, new Map(plan.aenderungen.map(a => [a.id, a.neu])))
  if (pnFragen.length > 0 && formData.get('pn_bestaetigt') !== '1') return { bestaetigung: pnFragen.join('\n') }

  // Bearbeiten braucht keinen eigenen Grund (Vorgabe 30.09.2026) – der Storno der alten Buchung trägt einen festen
  await storniereUmzug(supabase, tenantId, plan, GRUND_BEARBEITET)
  const umzugTyp = (zeilen.find(z => z.umzug_typ && z.umzug_typ !== 'normal')?.umzug_typ as string | undefined) ?? null
  try {
    await umzugAnlegen(supabase, tenantId, neu, { umzugTyp, pnNotizJeCharge })
  } catch (e) {
    revalidiereUmzug(plan)
    throw new AktionsFehler(`Der bisherige Umzug wurde storniert, der geänderte konnte aber nicht gebucht werden: ${fehlerText(e)} Bitte den Umzug neu erfassen.`)
  }
  revalidiereUmzug(plan)
  redirect(zielNachAbschluss(formData.get('zurueck'), '/kellerbuch/gebinde?tab=umziehen', 'umzug'))   // KAN-224
}

// Umzug stornieren (KAN-35, 24.09.2026): nur, solange die Ziel-Charge seit der Buchung nicht
// weiterbewegt wurde und die Rückbuchung vollständig möglich ist; Quellen werden dabei wieder
// aktiv, leer gewordene Ziel-Chargen abgeschlossen. Umzüge im alten Zeilenformat sind nicht
// stornierbar; Schwundbuchungen nur durch Betriebs-Manager und nur, wenn sie nachweislich den
// Bestand gemindert haben und an der Charge seither nichts gebucht wurde
// (lib/kellerbuch/storno.ts). Alles oder nichts; die Buchung bleibt mit Grund als storniert stehen (KAN-145).
export async function deleteUmzug(id: string, grund: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()

  const zeilen = await ladeUmzugZeilen(supabase, tenantId, id)
  if (!zeilen) throw new AktionsFehler('Umzug nicht gefunden')
  // KAN-145 B4 / KAN-166: Schwund stornieren auch Mitarbeiter – die Minderung liefert die RPC s112_schwund_minderung
  const plan = await planeUmzugStorno(supabase, tenantId, zeilen)
  await storniereUmzug(supabase, tenantId, plan, grund)   // wirft bei Sperre bzw. fehlendem Grund die deutsche Meldung

  revalidiereUmzug(plan)
}
