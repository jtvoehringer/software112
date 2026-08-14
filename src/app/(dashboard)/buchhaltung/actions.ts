'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getCtx() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new Error('Kein Mandant')
  return { supabase, tenantId: membership.tenantId }
}

// ── Buchung anlegen ───────────────────────────────────────────────────────────

export async function createEaTransaktion(formData: FormData) {
  const { supabase, tenantId } = await getCtx()

  const typ          = formData.get('typ') as string
  const datum        = formData.get('datum') as string
  const beschreibung = formData.get('beschreibung') as string
  const kategorie_id = (formData.get('kategorie_id') as string) || null
  const betrag_netto = parseFloat(formData.get('betrag_netto') as string)
  const ust_satz     = parseFloat(formData.get('ust_satz') as string)
  const notizen      = (formData.get('notizen') as string) || null

  if (!typ || !datum || !beschreibung || isNaN(betrag_netto)) {
    return { error: 'Pflichtfelder fehlen' }
  }

  const { error } = await (supabase.from('ea_transaktionen') as any).insert({
    tenant_id: tenantId, typ, datum, beschreibung,
    kategorie_id, betrag_netto, ust_satz: ust_satz || 20,
    notizen,
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

  const { error } = await (supabase.from('ea_kategorien') as any).insert({
    tenant_id:    tenantId,
    typ:          formData.get('typ'),
    name:         formData.get('name'),
    konto_nr:     formData.get('konto_nr') ? parseInt(formData.get('konto_nr') as string) : null,
    ust_satz_std: parseFloat(formData.get('ust_satz_std') as string) || 20,
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
    betrag_netto:       parseFloat(formData.get('betrag_netto') as string),
    ust_satz:           parseFloat(formData.get('ust_satz') as string) || 20,
    intervall:          formData.get('intervall'),
    tag_im_monat:       parseInt(formData.get('tag_im_monat') as string) || 1,
    naechste_faelligkeit: formData.get('naechste_faelligkeit'),
  })

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
    await (supabase.from('ea_transaktionen') as any)
      .delete()
      .in('id', bestehende.map((b: R) => b.id))
      .eq('tenant_id', tenantId)
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
