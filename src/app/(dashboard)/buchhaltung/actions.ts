'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getCtx() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new AktionsFehler('Kein Mandant')
  return { supabase, tenantId: membership.tenantId }
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
  const ust_satz     = parseFloat(dezimal(formData.get('ust_satz') as string))
  const notizen      = (formData.get('notizen') as string) || null
  const konto_id     = (formData.get('konto_id') as string) || null

  if (!typ || !datum || !beschreibung || isNaN(betrag_netto)) {
    return { error: 'Pflichtfelder fehlen' }
  }

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
    kategorie_id, betrag_netto, ust_satz: ust_satz || 20,
    notizen, konto_id, abzugsfaehig_pct,
  })

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung')
  return { ok: true }
}

// ── Buchung löschen ───────────────────────────────────────────────────────────

export async function deleteEaTransaktion(id: string) {
  const { supabase, tenantId } = await getCtx()

  const { error } = await (supabase.from('ea_transaktionen') as any)
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .eq('is_locked', false)

  if (error) return { error: (error as R).message }
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

  const { error } = await (supabase.from('ea_kategorien') as any).insert({
    tenant_id:    tenantId,
    typ:          formData.get('typ'),
    name:         formData.get('name'),
    konto_nr:     formData.get('konto_nr') ? parseInt(formData.get('konto_nr') as string) : null,
    ust_satz_std: parseFloat(dezimal(formData.get('ust_satz_std') as string)) || 20,
    abzugsfaehig_pct,
  })

  if (error) return { error: (error as R).message }
  revalidatePath('/buchhaltung/kategorien')
  return { ok: true }
}

// ── Dauerauftrag anlegen ──────────────────────────────────────────────────────

export async function createEaDauerauftrag(formData: FormData) {
  const { supabase, tenantId } = await getCtx()

  const { error } = await (supabase.from('ea_dauerauftraege') as any).insert({
    tenant_id:          tenantId,
    typ:                formData.get('typ'),
    beschreibung:       formData.get('beschreibung'),
    kategorie_id:       (formData.get('kategorie_id') as string) || null,
    betrag_netto:       parseFloat(dezimal(formData.get('betrag_netto') as string)),
    ust_satz:           parseFloat(dezimal(formData.get('ust_satz') as string)) || 20,
    intervall:          formData.get('intervall'),
    tag_im_monat:       parseInt(formData.get('tag_im_monat') as string) || 1,
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
// Wird nach jeder Änderung an den Zahlungen eines Verkaufspostens aufgerufen
// (Zahlung erfasst/gelöscht, "Als bezahlt markiert", Storno/Löschung). Baut die
// verknüpften ea_transaktionen-Zeilen für diesen Verkaufsposten komplett neu
// auf (idempotent) – dadurch entstehen bei mehreren Teilzahlungen keine
// Duplikate. Bereits über eine übermittelte UVA gesperrte Zeilen werden nie
// angefasst.
export async function syncEaEinnahmeFuerVerkauf(
  verkaufspostenId: string
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const { supabase, tenantId } = await getCtx()

  // Nur relevant, wenn das E&A-Modul für diesen Mandanten aktiv ist
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle()
  if (!(einst as R | null)?.modul_ea) return { ok: true, skipped: true }

  const { data: postenRaw } = await (supabase.from('verkaufsposten') as any)
    .select(`
      id, datum, rechnungsnummer, storniert,
      positionen:verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct, ust_satz)
    `)
    .eq('id', verkaufspostenId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!postenRaw) return { ok: false, error: 'Verkaufsposten nicht gefunden' }
  const posten = postenRaw as R
  const positionen = (posten.positionen ?? []) as R[]

  // Bestehende, verknüpfte Buchungen prüfen
  const { data: bestehendeRaw } = await (supabase.from('ea_transaktionen') as any)
    .select('id, is_locked')
    .eq('verkaufsposten_id', verkaufspostenId)
    .eq('tenant_id', tenantId)
  const bestehende = (bestehendeRaw ?? []) as R[]

  if (bestehende.some((b: R) => b.is_locked)) {
    // Zeitraum bereits per UVA übermittelt – nicht mehr verändern
    return { ok: true, skipped: true }
  }

  if (bestehende.length > 0) {
    { const { error: e } = await (supabase.from('ea_transaktionen') as any)
      .delete()
      .in('id', bestehende.map((b: R) => b.id))
      .eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (ea_transaktionen): ${e.message}`) }
  }

  if (posten.storniert) {
    revalidatePath('/buchhaltung')
    revalidatePath('/buchhaltung/uva')
    return { ok: true }
  }

  // Zahlungen summieren
  const { data: zahlungenRaw } = await (supabase.from('zahlungen') as any)
    .select('betrag, datum')
    .eq('verkaufsposten_id', verkaufspostenId)
    .eq('tenant_id', tenantId)
    .order('datum', { ascending: false })
  const zahlungen = (zahlungenRaw ?? []) as R[]
  const bezahltSumme = zahlungen.reduce((s: number, z: R) => s + Number(z.betrag ?? 0), 0)

  if (bezahltSumme <= 0.005) {
    revalidatePath('/buchhaltung')
    revalidatePath('/buchhaltung/uva')
    return { ok: true }
  }

  // Rechnungssumme je USt-Satz (brutto/netto) – analog zur Rechnungsdruck-Logik
  const gruppen: Record<string, { brutto: number; netto: number }> = {}
  for (const pos of positionen) {
    if (pos.preis_brutto == null) continue
    const satz = Number(pos.ust_satz ?? 13)
    const brutto = Number(pos.preis_brutto) * Number(pos.menge)
    const rabatt = Number(pos.rabatt_pct ?? 0) / 100
    const sonder = Number(pos.sonderrabatt_pct ?? 0) / 100
    const effektiv = brutto * (1 - rabatt) * (1 - sonder)
    const netto = effektiv / (1 + satz / 100)
    const key = String(satz)
    if (!gruppen[key]) gruppen[key] = { brutto: 0, netto: 0 }
    gruppen[key].brutto += effektiv
    gruppen[key].netto += netto
  }
  const gesamtBrutto = Object.values(gruppen).reduce((s, g) => s + g.brutto, 0)
  if (gesamtBrutto <= 0) {
    revalidatePath('/buchhaltung')
    revalidatePath('/buchhaltung/uva')
    return { ok: true }
  }

  // Anteilig zugeordneter Zahlungseingang je USt-Satz (bei Teilzahlung proportional)
  const quote = Math.min(bezahltSumme, gesamtBrutto) / gesamtBrutto
  const re = posten.rechnungsnummer ? `RE ${posten.rechnungsnummer}` : `Beleg ${verkaufspostenId.slice(0, 8)}`
  const buchungsDatum = zahlungen[0]?.datum ?? posten.datum

  const inserts: R[] = []
  for (const [satz, g] of Object.entries(gruppen)) {
    const nettoAnteil = Math.round(g.netto * quote * 100) / 100
    if (nettoAnteil <= 0) continue
    inserts.push({
      tenant_id:         tenantId,
      typ:               'einnahme',
      datum:             buchungsDatum,
      beschreibung:      `Zahlungseingang ${re}`,
      betrag_netto:      nettoAnteil,
      ust_satz:          Number(satz),
      import_quelle:     'verkauf',
      verkaufsposten_id: verkaufspostenId,
      notizen:           'Automatisch erzeugt aus Zahlungseingang (Verkauf)',
    })
  }

  if (inserts.length > 0) {
    const { error } = await (supabase.from('ea_transaktionen') as any).insert(inserts)
    if (error) return { ok: false, error: (error as R).message }
  }

  revalidatePath('/buchhaltung')
  revalidatePath('/buchhaltung/uva')
  return { ok: true }
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
  const ust_satz     = parseFloat(dezimal(formData.get('ust_satz') as string))
  const notizen      = (formData.get('notizen') as string) || null
  const konto_id     = (formData.get('konto_id') as string) || null
  // Migration 167 - optionaler Lieferant (aus Belege-OCR erkannt/bestätigt
  // oder manuell zugeordnet). Bewusst kein Pflichtfeld.
  const firma_id     = (formData.get('firma_id') as string) || null

  if (!typ || !datum || !beschreibung || isNaN(betrag_netto)) {
    return { error: 'Pflichtfelder fehlen' }
  }

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
      kategorie_id, betrag_netto, ust_satz: ust_satz || 20,
      notizen, konto_id, firma_id, abzugsfaehig_pct,
    })
    .select('id')
    .single()

  if (error) return { error: (error as R).message }

  await (supabase.from('ea_belege') as any)
    .update({
      ea_transaktion_id: (neu as R).id,
      status:             'verbucht',
      verbucht_am:         new Date().toISOString(),
    })
    .eq('id', belegId).eq('tenant_id', tenantId)

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
    { const { error: e } = await (supabase.from('ea_belege') as any)
      .delete().eq('id', belegId).eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (ea_belege): ${e.message}`) }
    await supabase.storage.from('ea-belege').remove([beleg.storage_pfad])
  }

  revalidatePath('/buchhaltung/belege')
  redirect('/buchhaltung/belege')
}
