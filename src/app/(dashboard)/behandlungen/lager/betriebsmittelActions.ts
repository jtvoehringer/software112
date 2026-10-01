'use server'

// KAN-167 (01.10.2026): Weinbehandlungs- und Produktionsmittel – Stammdaten, Lagerbuchungen, Einkauf mit Pflicht-E/A-
// Ausgabe (RPC s112_betriebsmittel_einkauf, eine Transaktion), Storno statt Löschen (RPC s112_betriebsmittel_stornieren,
// ein Einkauf storniert die Ausgabe mit) und endgültig löschen nur stornierter Buchungen (s112_storniert_loeschen).
// Rechte: Schreibmodul Rieden; Einkauf zusätzlich E&A (prüft auch die Datenbank). Stammdaten deaktivieren: Betriebsleitung.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { dezimal } from '@/lib/format'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { BETRIEBSMITTEL_GRUPPEN, BM_EINHEITEN } from '@/lib/behandlungen/betriebsmittel'

async function riedenSchreibrecht() {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!canWrite(membership, 'rieden')) throw new AktionsFehler('Keine Schreibberechtigung für Rieden/Maßnahmen in diesem Betrieb.')
  return membership
}

function zahl(v: FormDataEntryValue | null): number | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  const n = parseFloat(dezimal(s))
  return Number.isFinite(n) ? n : null
}

function neuLaden() {
  revalidatePath('/behandlungen/lager')
  revalidatePath('/behandlungen/neu')
}

// ── Stammdaten ────────────────────────────────────────────────────────────────────────────────────────────

export async function speichereBetriebsmittel(fd: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await riedenSchreibrecht()
  const id = (fd.get('existing_id') as string) || null
  const gruppe = fd.get('gruppe') as string
  const name = ((fd.get('name') as string) ?? '').trim()
  const einheit = fd.get('einheit') as string
  if (!(BETRIEBSMITTEL_GRUPPEN as readonly string[]).includes(gruppe)) throw new AktionsFehler('Unbekannte Gruppe.')
  if (!name) throw new AktionsFehler('Bitte eine Bezeichnung angeben.')
  if (!(BM_EINHEITEN as readonly string[]).includes(einheit)) throw new AktionsFehler('Bitte eine Einheit wählen.')
  const preis = zahl(fd.get('preis_pro_einheit'))
  if (preis !== null && preis < 0) throw new AktionsFehler('Der Einkaufspreis darf nicht negativ sein.')
  const payload = {
    tenant_id: tenantId, gruppe, name, einheit,
    preis_pro_einheit: preis,
    ea_kategorie_id: (fd.get('ea_kategorie_id') as string) || null,
    notizen: ((fd.get('notizen') as string) ?? '').trim() || null,
  }
  if (id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('betriebsmittel') as any)
      .update(payload).eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen'))
    if (!data?.length) throw new AktionsFehler('Betriebsmittel nicht gefunden – bitte die Seite neu laden.')
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('betriebsmittel') as any).insert(payload)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen'))
  }
  neuLaden()
}

export async function setzeBetriebsmittelAktiv(id: string, aktiv: boolean): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const membership = await riedenSchreibrecht()
  if (!canAdmin(membership.role)) throw new AktionsFehler('Deaktivieren und Reaktivieren darf die Betriebsleitung.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('betriebsmittel') as any)
    .update({ aktiv }).eq('id', id).eq('tenant_id', membership.tenantId).select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen'))
  if (!data?.length) throw new AktionsFehler('Betriebsmittel nicht gefunden – bitte die Seite neu laden.')
  neuLaden()
}

// ── Lagerbuchungen ────────────────────────────────────────────────────────────────────────────────────────

/** Anfangsbestand bzw. Inventurkorrektur anlegen oder ändern (Einkäufe nur über bucheBetriebsmittelEinkauf) */
export async function speichereBetriebsmittelBuchung(fd: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await riedenSchreibrecht()
  const id = (fd.get('existing_id') as string) || null
  const typ = fd.get('typ') as string
  if (typ !== 'anfangsbestand' && typ !== 'korrektur') throw new AktionsFehler('Einkäufe bitte über „Einkauf“ buchen.')
  const roh = zahl(fd.get('menge'))
  if (roh === null || roh === 0) throw new AktionsFehler('Bitte eine Menge angeben.')
  const menge = fd.get('richtung') === 'ausgang' ? -Math.abs(roh) : Math.abs(roh)
  const payload = {
    tenant_id: tenantId,
    betriebsmittel_id: fd.get('betriebsmittel_id') as string,
    datum: fd.get('datum') as string,
    typ, menge,
    einheit: fd.get('einheit') as string,
    notizen: ((fd.get('notizen') as string) ?? '').trim() || null,
  }
  if (id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('betriebsmittel_lager_bewegungen') as any)
      .update(payload).eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null).select('id')
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen'))
    if (!data?.length) throw new AktionsFehler('Buchung nicht gefunden, storniert oder ein Einkauf (nicht änderbar).')
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('betriebsmittel_lager_bewegungen') as any).insert(payload)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen'))
  }
  neuLaden()
}

/** Einkauf mit E/A-Ausgabe in einer Transaktion (RPC prüft E&A-Modul, Schreibmodule Rieden und E&A, Zeitraum) */
export async function bucheBetriebsmittelEinkauf(fd: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await riedenSchreibrecht()
  const menge = zahl(fd.get('menge'))
  const netto = zahl(fd.get('betrag_netto'))
  const ust = zahl(fd.get('ust_satz'))
  if (menge === null || menge <= 0) throw new AktionsFehler('Bitte eine Menge (> 0) angeben.')
  if (netto === null || netto < 0) throw new AktionsFehler('Bitte den Netto-Betrag angeben.')
  if (!fd.get('ea_kategorie_id')) throw new AktionsFehler('Bitte eine Ausgaben-Kategorie wählen.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_betriebsmittel_einkauf', {
    p_tenant_id: tenantId,
    p_betriebsmittel_id: fd.get('betriebsmittel_id') as string,
    p_datum: fd.get('datum') as string,
    p_menge: menge,
    p_einheit: fd.get('einheit') as string,
    p_betrag_netto: netto,
    p_ust_satz: ust ?? 20,
    p_lieferant_firma_id: (fd.get('lieferant_firma_id') as string) || null,
    p_ea_kategorie_id: fd.get('ea_kategorie_id') as string,
    p_notizen: ((fd.get('notizen') as string) ?? '').trim() || null,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Einkauf konnte nicht gebucht werden'))
  neuLaden()
  revalidatePath('/buchhaltung')
}

/** Storno mit Grund; ein Einkauf storniert die E/A-Ausgabe mit (Gegenbuchung) */
export async function stornoBetriebsmittelBuchung(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await riedenSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_betriebsmittel_stornieren', {
    p_tenant_id: tenantId, p_id: id, p_grund: grund.trim(), p_datum: null,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  neuLaden()
  revalidatePath('/buchhaltung')
}

export async function loescheBetriebsmittelBuchung(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await riedenSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das endgültige Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'betriebsmittel_lager_bewegungen', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Endgültig löschen fehlgeschlagen'))
  neuLaden()
}
