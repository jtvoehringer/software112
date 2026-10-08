'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { dezimal } from '@/lib/format'
import { abgleichVerkaufsEinnahmen } from '@/lib/ea/verkaufEinnahmen'
import { ladeRechnungsKontext } from '@/lib/verkauf/rechnungsKontext'
import { pruefeModul } from '@/lib/auth/modul'
import { ustSatzAus, UST_SATZ_FEHLER } from '@/lib/ea/ustSatz'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getCtx(mitModul = true) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new AktionsFehler('Kein Mandant')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (mitModul) await pruefeModul('modul_ea')   // KAN-6: Paket-Modul E&A (nicht nur die Seite)
  // KAN-240: Freigabe E&A wie RLS (modul_insert/_update/_delete auf allen ea_*-Tabellen) – vorab statt technischer
  // RLS-Meldung. Ohne Modul (Abgleich der Verkaufs-Einnahmen) gilt das Recht, Zahlungen zu erfassen (KAN-239).
  if (mitModul && !canWrite(membership, 'ea')) throw new AktionsFehler('Keine Berechtigung für die E&A-Rechnung – dafür ist die Freigabe E&A nötig.')
  return { supabase, tenantId: membership.tenantId, membership }
}

// Migration 168 - liest den abzugsfaehig_pct-Wert der gewählten Kategorie, um
// ihn als Snapshot auf der neuen Buchung zu speichern (siehe dortiger
// Spalten-Kommentar). Ohne Kategorie bzw. bei Lesefehler: 100 (voll
// abzugsfähig), also unverändertes Verhalten wie vor Migration 168.
// tenant_id-Filter wie bei den übrigen ea_kategorien-Abfragen dieses Moduls
// (Kategorie ist entweder System-Kategorie mit tenant_id IS NULL oder gehört
// dem eigenen Mandanten) - verhindert, dass eine erratene fremde
// Kategorie-ID hier einen fremden Prozentsatz liefert.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getKategorieAbzugsfaehigPct(supabase: any, tenantId: string, kategorieId: string | null): Promise<number> {
  if (!kategorieId) return 100
  const { data } = await supabase.from('ea_kategorien')
    .select('abzugsfaehig_pct')
    .eq('id', kategorieId)
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .maybeSingle()
  const pct = (data as R | null)?.abzugsfaehig_pct
  return pct == null ? 100 : Number(pct)
}

// ── Buchung anlegen ───────────────────────────────────────────────────────────

export async function createEaTransaktion(formData: FormData) {
  const { supabase, tenantId } = await getCtx()

  const typ          = formData.get('typ') as string
  const datum        = formData.get('datum') as string
  const beschreibung = formData.get('beschreibung') as string
  const kategorie_id = (formData.get('kategorie_id') as string) || null
  const betrag_netto = parseFloat(dezimal(formData.get('betrag_netto') as string))
  const ust_satz     = ustSatzAus(formData.get('ust_satz'))   // KAN-240: 0 % bleibt 0 %
  const notizen      = (formData.get('notizen') as string) || null
  const konto_id     = (formData.get('konto_id') as string) || null

  if (!typ || !datum || !beschreibung || isNaN(betrag_netto)) {
    return { error: 'Pflichtfelder fehlen' }
  }
  if (ust_satz === null) return { error: UST_SATZ_FEHLER }

  // Zeitraum darf weder abgeschlossen (Monatsabschluss) noch bereits per UVA
  // übermittelt sein – sonst könnte ein geschlossener Zeitraum durch eine
  // neue, ungesperrte Buchung unterlaufen werden.
  const { data: pruefRaw } = await (supabase.rpc as any)('pruefe_ea_zeitraum_offen', {
    p_tenant_id: tenantId, p_datum: datum,
  })
  const pruef = Array.isArray(pruefRaw) ? pruefRaw[0] : pruefRaw
  if (pruef && pruef.offen === false) {
    return { error: pruef.grund ?? 'Zeitraum ist geschlossen.' }
  }

  const abzugsfaehig_pct = await getKategorieAbzugsfaehigPct(supabase, tenantId, kategorie_id)

  const { error } = await (supabase.from('ea_transaktionen') as any).insert({
    tenant_id: tenantId, typ, datum, beschreibung,
    kategorie_id, betrag_netto, ust_satz,
    notizen, konto_id, abzugsfaehig_pct,
  })

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung')
  return { ok: true }
}

// ── Buchung stornieren (KAN-149 D2c) ─────────────────────────────────────────
// Statt Löschen: Gegenbuchung mit negativem Betrag (RPC s112_ea_stornieren), das Original bleibt gekennzeichnet
// stehen (§ 131 Abs. 1 Z 8, § 132 BAO). Datum: vorgegeben, sonst das der Buchung, solange deren Zeitraum offen ist,
// sonst heute – so lassen sich auch Buchungen abgeschlossener Monate berichtigen. Rolle, Modul und Abo-Sperre
// prüft die RPC; Verkaufs-Einnahmen (über die Zahlung) und AfA (Anlagenverzeichnis) lehnt die Seite vorher ab.

export async function stornoEaTransaktion(id: string, grund: string, datum: string | null = null) {
  const fehler = stornoGrundFehler(grund)
  if (fehler) return { error: fehler }
  const { supabase, tenantId } = await getCtx()

  // Abgeleitete Buchungen haben ihren eigenen Weg – sonst liefen Zahlung bzw. Anlagenverzeichnis auseinander
  const { data: b, error: leseErr } = await (supabase.from('ea_transaktionen') as any)
    .select('import_quelle, verkaufsposten_id, anlage_id').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (leseErr) return { error: dbFehlerText(leseErr, 'Buchung konnte nicht geladen werden') }
  if (!b) return { error: 'Buchung nicht gefunden – bitte die Seite neu laden.' }
  if ((b as R).import_quelle === 'verkauf' && (b as R).verkaufsposten_id) {
    return { error: 'Diese Einnahme stammt aus einem Zahlungseingang – bitte die Zahlung im Verkauf stornieren.' }
  }
  if ((b as R).anlage_id) return { error: 'AfA-Buchungen bitte unter Anlagen & AfA zurücknehmen.' }
  if ((b as R).import_quelle === 'betriebsmittel') {   // KAN-167: Lagerbuchung und Ausgabe gehören zusammen
    return { error: 'Diese Ausgabe stammt aus einem Betriebsmittel-Einkauf – bitte den Einkauf unter Rieden › Betriebsmittel stornieren.' }
  }

  const { error } = await (supabase.rpc as any)('s112_ea_stornieren', {
    p_tenant_id: tenantId, p_id: id, p_grund: grund.trim(), p_datum: datum || null,
  })

  if (error) return { error: dbFehlerText(error, 'Buchung konnte nicht storniert werden') }
  revalidatePath('/buchhaltung')
  return { ok: true }
}

// ── Kategorie anlegen ─────────────────────────────────────────────────────────

export async function createEaKategorie(formData: FormData) {
  const { supabase, tenantId } = await getCtx()

  // Migration 168 - Default 100 (voll abzugsfähig), niedriger bei gesetzlich
  // beschränkt abzugsfähigen Ausgaben (z.B. Bewirtung/Repräsentation 50%).
  const abzugsfaehigRaw = parseFloat(dezimal(formData.get('abzugsfaehig_pct') as string))
  const abzugsfaehig_pct = isNaN(abzugsfaehigRaw) ? 100 : Math.min(100, Math.max(0, abzugsfaehigRaw))
  const ustStd = ustSatzAus(formData.get('ust_satz_std'))   // KAN-240: 0 % bleibt 0 %
  if (ustStd === null) return { error: UST_SATZ_FEHLER }

  const { error } = await (supabase.from('ea_kategorien') as any).insert({
    tenant_id:    tenantId,
    typ:          formData.get('typ'),
    name:         formData.get('name'),
    konto_nr:     formData.get('konto_nr') ? parseInt(dezimal(formData.get('konto_nr') as string)) : null,
    ust_satz_std: ustStd,
    abzugsfaehig_pct,
  })

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung/kategorien')
  return { ok: true }
}

// ── Dauerauftrag anlegen ──────────────────────────────────────────────────────

export async function createEaDauerauftrag(formData: FormData) {
  const { supabase, tenantId } = await getCtx()
  const ust = ustSatzAus(formData.get('ust_satz'))   // KAN-240: 0 % bleibt 0 %
  if (ust === null) return { error: UST_SATZ_FEHLER }

  const { error } = await (supabase.from('ea_dauerauftraege') as any).insert({
    tenant_id:          tenantId,
    typ:                formData.get('typ'),
    beschreibung:       formData.get('beschreibung'),
    kategorie_id:       (formData.get('kategorie_id') as string) || null,
    betrag_netto:       parseFloat(dezimal(formData.get('betrag_netto') as string)),
    ust_satz:           ust,
    intervall:          formData.get('intervall'),
    tag_im_monat:       parseInt(dezimal(formData.get('tag_im_monat') as string)) || 1,
    naechste_faelligkeit: formData.get('naechste_faelligkeit'),
    konto_id:           (formData.get('konto_id') as string) || null,
  })

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung/dauerauftraege')
  return { ok: true }
}

// ── Dauerauftrag deaktivieren ─────────────────────────────────────────────────

export async function deaktiviereEaDauerauftrag(id: string) {
  const { supabase, tenantId } = await getCtx()
  const membership = await getCurrentMembership()
  if (!canAdmin(membership?.role ?? null)) {
    return { error: 'Keine Berechtigung – nur Admins dürfen Daueraufträge deaktivieren.' }
  }

  const { error } = await (supabase.from('ea_dauerauftraege') as any)
    .update({ aktiv: false })
    .eq('id', id).eq('tenant_id', tenantId)

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung/dauerauftraege')
  return { ok: true }
}

// ── UVA berechnen + speichern ─────────────────────────────────────────────────

export async function berechneUndSpeichereUva(jahr: number, zeitraum: string) {
  const { supabase, tenantId } = await getCtx()

  // Bereits übermittelte (gesperrte) Meldungen nie überschreiben
  const { data: bestehend } = await (supabase.from('ea_uva') as any)
    .select('gesperrt')
    .eq('tenant_id', tenantId).eq('jahr', jahr).eq('zeitraum', zeitraum)
    .maybeSingle()
  if ((bestehend as R | null)?.gesperrt) {
    return { error: 'Diese Meldung ist bereits als übermittelt markiert (gesperrt) und kann nicht neu berechnet werden.' }
  }

  // RPC aufrufen
  const { data, error } = await (supabase.rpc as any)('berechne_ea_uva', {
    p_tenant_id: tenantId,
    p_jahr:      jahr,
    p_zeitraum:  zeitraum,
  })

  if (error) return { error: (error as R).message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { error: 'Keine Daten für diesen Zeitraum' }

  // In ea_uva upserten
  const { error: upsertErr } = await (supabase.from('ea_uva') as any).upsert({
    tenant_id:   tenantId,
    jahr:        jahr,
    zeitraum:    zeitraum,
    bmgl_ust_0:  row.bmgl_0  || 0,
    bmgl_ust_10: row.bmgl_10 || 0,
    bmgl_ust_13: row.bmgl_13 || 0,
    bmgl_ust_20: row.bmgl_20 || 0,
    ust_10:      row.ust_10  || 0,
    ust_13:      row.ust_13  || 0,
    ust_20:      row.ust_20  || 0,
    vst_10:      row.vst_10  || 0,
    vst_13:      row.vst_13  || 0,
    vst_20:      row.vst_20  || 0,
  }, { onConflict: 'tenant_id,jahr,zeitraum' })

  if (upsertErr) return { error: (upsertErr as R).message }
  revalidatePath('/buchhaltung/uva')
  return { ok: true, data: row }
}

// ── Zahlungseingang → E&A-Einnahme synchronisieren (Punkt 7) ──────────────────
//
// Wird nach jeder Änderung an den Zahlungen eines Verkaufspostens aufgerufen (Zahlung erfasst oder storniert,
// „Als bezahlt markiert“). Gleicht die Einnahmen je Zahlung ab (KAN-149 D2b, abgleichVerkaufsEinnahmen über die
// Service-Role, Nebenbefund 2): Wer Zahlungen erfassen darf, aktualisiert damit auch die abgeleitete Einnahme – ohne
// eigenes Recht in der E&A. Idempotent: Stimmt der Bestand, passiert nichts.
export async function syncEaEinnahmeFuerVerkauf(
  verkaufspostenId: string
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const { supabase, tenantId, membership } = await getCtx(false)   // KAN-6: läuft aus dem Verkauf – ohne E&A-Modul übersprungen (unten)
  // Zahlungen und Verkäufe erfassen Warenwirtschaft, die E&A ihre Einnahmen – Leser nie
  if (!canWrite(membership, 'warenwirtschaft') && !canWrite(membership, 'ea')) {
    return { ok: false, error: 'Keine Berechtigung, die E&A-Einnahme dieses Verkaufs zu aktualisieren.' }
  }

  // Nur relevant, wenn das E&A-Modul für diesen Mandanten aktiv ist
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle()
  if (!(einst as R | null)?.modul_ea) return { ok: true, skipped: true }

  // KAN-105 Teil B: bei einer Rechnung über mehrere Lieferscheine alle Lieferscheine und alle Zahlungen der Rechnung;
  // Einnahmen am Anker-Lieferschein, bestehende über alle Lieferscheine der Rechnung erkannt (keine Doppelbuchung)
  const kontext = await ladeRechnungsKontext(supabase, tenantId, verkaufspostenId, 'preis_brutto, menge, rabatt_pct, sonderrabatt_pct, ust_satz')
  if (!kontext) return { ok: false, error: 'Verkaufsposten nicht gefunden' }
  const positionen = kontext.positionen

  // KAN-149 D2b: Einnahmen je Zahlung (am Zahlungstag, je USt-Satz anteilig), Abweichungen per Gegenbuchung – kein
  // Löschen und Neuaufbau mehr. Ein stornierter Verkauf behält seine Einnahmen, solange die Zahlung nicht storniert
  // (erstattet) ist: Das Geld ist eingegangen. Plan: lib/ea/verkaufEinnahmenPlan.ts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zq = (supabase.from('zahlungen') as any).select('id, betrag, datum, erstellt_am, storniert_am').eq('tenant_id', tenantId)
  const { data: zahlungenRaw, error: zahlErr } = await (kontext.rechnungId
    ? zq.eq('rechnung_id', kontext.rechnungId)
    : zq.eq('verkaufsposten_id', verkaufspostenId))
  if (zahlErr) return { ok: false, error: `Zahlungen konnten nicht geladen werden: ${(zahlErr as R).message}` }
  const zahlungen = ((zahlungenRaw ?? []) as R[]).map(z => ({
    id: z.id as string, betrag: Number(z.betrag ?? 0), datum: z.datum as string, erstelltAm: z.erstellt_am ?? null, storniertAm: z.storniert_am ?? null,
  }))
  const beleg = kontext.rechnungsnummer ? `RE ${kontext.rechnungsnummer}` : `Beleg ${verkaufspostenId.slice(0, 8)}`
  const plan = positionen.map(p => ({
    preis_brutto: p.preis_brutto == null ? null : Number(p.preis_brutto), menge: Number(p.menge ?? 0),
    rabatt_pct: p.rabatt_pct ?? null, sonderrabatt_pct: p.sonderrabatt_pct ?? null, ust_satz: p.ust_satz ?? null,
  }))
  const r = await abgleichVerkaufsEinnahmen(tenantId, kontext.anker, { positionen: plan, zahlungen, beleg }, kontext.lieferscheinIds)
  if (!r.ok) return { ok: false, error: r.fehler }

  revalidatePath('/buchhaltung')
  revalidatePath('/buchhaltung/uva')
  return r.gesperrt ? { ok: true, skipped: true } : { ok: true }
}

// ── UVA als übermittelt markieren ─────────────────────────────────────────────
//
// Reine Anwendungs-Markierung mit Zeitstempel (KEINE elektronische Übermittlung
// an FinanzOnline – die tatsächliche Meldung erfolgt weiterhin manuell durch
// den Steuerpflichtigen/Steuerberater mit ID Austria/FinanzOnline-Zugang).
// Setzt ea_uva.gesperrt + gesperrt_am und sperrt alle E&A-Buchungen im
// Zeitraum (is_locked=true), damit weder ein manuelles Löschen/Bearbeiten
// noch der automatische Zahlungseingang-Sync (Punkt 7) sie nachträglich
// verändert. Irreversibel über die UI – nur Admin-Rollen dürfen das auslösen.
export async function markiereUvaAlsUebermittelt(uvaId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase, tenantId } = await getCtx()
  const membership = await getCurrentMembership()
  if (!canAdmin(membership?.role ?? null)) {
    return { ok: false, error: 'Keine Berechtigung – nur Admins dürfen eine UVA als übermittelt markieren.' }
  }

  const { data: uvaRaw } = await (supabase.from('ea_uva') as any)
    .select('jahr, zeitraum, gesperrt')
    .eq('id', uvaId).eq('tenant_id', tenantId).maybeSingle()
  const uva = uvaRaw as R | null
  if (!uva) return { ok: false, error: 'UVA-Meldung nicht gefunden' }
  if (uva.gesperrt) return { ok: true }

  const { error } = await (supabase.rpc as any)('sperre_ea_uva', {
    p_tenant_id: tenantId,
    p_jahr:      uva.jahr,
    p_zeitraum:  uva.zeitraum,
  })
  if (error) return { ok: false, error: (error as R).message }

  revalidatePath('/buchhaltung/uva')
  revalidatePath('/buchhaltung')
  return { ok: true }
}

// ── Monat abschließen ─────────────────────────────────────────────────────────
//
// Sperrt (is_locked=true) alle E&A-Buchungen des gewählten Monats und trägt
// den Abschluss in ea_monatsabschluss ein. Irreversibel über die UI – nur
// Admin-Rollen dürfen das auslösen (analog zur UVA-Übermittlung).
export async function schliesseEaMonat(jahr: number, monat: number): Promise<{ ok: boolean; error?: string }> {
  const { supabase, tenantId } = await getCtx()
  const membership = await getCurrentMembership()
  if (!canAdmin(membership?.role ?? null)) {
    return { ok: false, error: 'Keine Berechtigung – nur Admins dürfen einen Monat abschließen.' }
  }

  const { error } = await (supabase.rpc as any)('sperre_ea_monat', {
    p_tenant_id: tenantId,
    p_jahr:      jahr,
    p_monat:     monat,
  })
  if (error) return { ok: false, error: (error as R).message }

  revalidatePath('/buchhaltung/monatsabschluss')
  revalidatePath('/buchhaltung')
  revalidatePath('/buchhaltung/uva')
  return { ok: true }
}

// ── Beleg verbuchen (aus KI-Erkennung oder manuell nach Upload) ───────────────
//
// Legt aus den vom Nutzer geprüften/korrigierten Formularwerten eine normale
// ea_transaktionen-Zeile an (identische Logik/Prüfungen wie createEaTransaktion
// oben) und verknüpft den Beleg damit (status='verbucht'). Die von Claude
// vorgeschlagenen Werte (ea_belege.erkannte_daten) dienen nur der Vorbefüllung
// im Formular - gebucht wird ausschließlich das, was der Nutzer bestätigt hat.

export async function verbucheBeleg(belegId: string, formData: FormData) {
  const { supabase, tenantId } = await getCtx()

  const { data: belegRaw } = await (supabase.from('ea_belege') as any)
    .select('id, status')
    .eq('id', belegId).eq('tenant_id', tenantId).maybeSingle()
  const beleg = belegRaw as R | null
  if (!beleg) return { error: 'Beleg nicht gefunden' }
  if (beleg.status === 'verbucht') return { error: 'Dieser Beleg wurde bereits verbucht.' }

  const typ          = formData.get('typ') as string
  const datum        = formData.get('datum') as string
  const beschreibung = formData.get('beschreibung') as string
  const kategorie_id = (formData.get('kategorie_id') as string) || null
  const betrag_netto = parseFloat(dezimal(formData.get('betrag_netto') as string))
  const ust_satz     = ustSatzAus(formData.get('ust_satz'))   // KAN-240: 0 % bleibt 0 %
  const notizen      = (formData.get('notizen') as string) || null
  const konto_id     = (formData.get('konto_id') as string) || null
  // Migration 167 - optionaler Lieferant (aus Belege-OCR erkannt/bestätigt
  // oder manuell zugeordnet). Bewusst kein Pflichtfeld.
  const firma_id     = (formData.get('firma_id') as string) || null

  if (!typ || !datum || !beschreibung || isNaN(betrag_netto)) {
    return { error: 'Pflichtfelder fehlen' }
  }
  if (ust_satz === null) return { error: UST_SATZ_FEHLER }

  const { data: pruefRaw } = await (supabase.rpc as any)('pruefe_ea_zeitraum_offen', {
    p_tenant_id: tenantId, p_datum: datum,
  })
  const pruef = Array.isArray(pruefRaw) ? pruefRaw[0] : pruefRaw
  if (pruef && pruef.offen === false) {
    return { error: pruef.grund ?? 'Zeitraum ist geschlossen.' }
  }

  const abzugsfaehig_pct = await getKategorieAbzugsfaehigPct(supabase, tenantId, kategorie_id)

  const { data: neu, error } = await (supabase.from('ea_transaktionen') as any)
    .insert({
      tenant_id: tenantId, typ, datum, beschreibung,
      kategorie_id, betrag_netto, ust_satz,
      notizen, konto_id, firma_id, abzugsfaehig_pct,
    })
    .select('id')
    .single()

  if (error) return { error: (error as R).message }

  // KAN-240: scheitert das Markieren, darf der Beleg nicht still „erkannt“ bleiben – sonst ließe er sich ein zweites
  // Mal verbuchen (doppelte Ausgabe). Die Buchung steht; Meldung wie beim Zahlungseingang (KAN-149): nicht erneut buchen.
  { const { error: markErr } = await (supabase.from('ea_belege') as any)
    .update({
      ea_transaktion_id: (neu as R).id,
      status:             'verbucht',
      verbucht_am:         new Date().toISOString(),
    })
    .eq('id', belegId).eq('tenant_id', tenantId)
    if (markErr) {
      revalidatePath('/buchhaltung')
      return { error: `Die Buchung ist angelegt (bitte nicht erneut verbuchen), der Beleg konnte aber nicht als verbucht markiert werden: ${dbFehlerText(markErr)}. Bitte die Belege prüfen (lassen).` }
    } }

  revalidatePath('/buchhaltung')
  revalidatePath('/buchhaltung/belege')
  return { ok: true }
}

// ── Beleg verwerfen (löschen, ohne Buchung) ────────────────────────────────────
//
// Nur für noch nicht verbuchte Belege (status 'erkannt'/'fehler') - z.B. bei
// einem versehentlichen Doppel-Upload oder einem für die Buchhaltung
// irrelevanten Foto. Bereits verbuchte Belege bleiben als Nachweis erhalten
// und können hier nicht mehr gelöscht werden.

export async function verwerfeBeleg(belegId: string): Promise<void> {
  const { supabase, tenantId } = await getCtx()

  const { data: belegRaw } = await (supabase.from('ea_belege') as any)
    .select('storage_pfad, status')
    .eq('id', belegId).eq('tenant_id', tenantId).maybeSingle()
  const beleg = belegRaw as R | null

  if (beleg && beleg.status !== 'verbucht') {
    // KAN-243: Datei erst entfernen, wenn die Zeile wirklich weg ist – sonst bliebe ein Beleg ohne Datei zurück
    { const { data: weg, error: e } = await (supabase.from('ea_belege') as any)
      .delete().eq('id', belegId).eq('tenant_id', tenantId).select('id')
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (ea_belege): ${e.message}`)
      if (((weg ?? []) as unknown[]).length === 0) throw new AktionsFehler('Der Beleg wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.') }
    await supabase.storage.from('ea-belege').remove([beleg.storage_pfad])
  }

  revalidatePath('/buchhaltung/belege')
  redirect('/buchhaltung/belege')
}
