'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { dezimal } from '@/lib/format'
import { freezeSperreAus, sperrMeldung } from '@/lib/freeze/sperre'
import { PN_FELD_LABEL, PN_FORMULAR_FELDER, istPnStatus, pnAenderbareFelder, type PnFormularFeld } from '@/lib/dac/workflow'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-97 (04.10.2026): Prüfnummernantrag als Workflow. Ein neuer Antrag ist immer ein Entwurf; Status, Einreichung,
// Bescheid und Entzug ändern sich nur über setzeDacStatus (RPC s112_pruefnummernantrag_status_setzen, Übergangsmatrix).
// Speichern schickt nur die Felder, die der Status noch zulässt (pnAenderbareFelder) – die Datenbank sperrt den Rest
// ohnehin (Freeze-Trigger a_freeze_*, 42501). Schreibrecht wie Storno: Kellerbuch.
function formularWerte(formData: FormData): Record<PnFormularFeld, unknown> {
  const text = (k: string) => ((formData.get(k) as string | null) ?? '').trim() || null
  const zahl = (k: string) => formData.get(k) ? Number(dezimal(formData.get(k))) : null
  return {
    weinausbau_id:       text('weinausbau_id'),
    bezeichnung:         (formData.get('bezeichnung') as string | null) ?? '',
    dac_region:          formData.get('dac_region') as string,
    jahrgang:            zahl('jahrgang'),
    rebsorte:            text('rebsorte'),
    menge_liter:         zahl('menge_liter'),
    alkohol_prozent:     zahl('alkohol_prozent'),
    pruefnummer:         text('pruefnummer'),
    antragsnummer:       text('antragsnummer'),
    untersuchungsnummer: text('untersuchungsnummer'),
    notizen:             text('notizen'),
    aktiv:               formData.get('aktiv') === 'true',
  }
}

function speicherFehler(error: unknown, kontext: string): AktionsFehler {
  const sperre = freezeSperreAus(error)
  return new AktionsFehler(sperre ? sperrMeldung(sperre, x => PN_FELD_LABEL[x] ?? x) : dbFehlerText(error, kontext))
}

export async function createDacAntrag(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const { tenantId } = await dacSchreibrecht()
  const w = formularWerte(formData)
  const payload: R = { tenant_id: tenantId, status: 'entwurf' }
  for (const k of PN_FORMULAR_FELDER) if (k !== 'aktiv') payload[k] = w[k]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('dac_antrag') as any).insert(payload)
  if (error) throw speicherFehler(error, 'Speichern fehlgeschlagen')
  revalidatePath('/dac')
}

export async function updateDacAntrag(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await dacSchreibrecht()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: alt, error: aErr } = await (supabase.from('dac_antrag') as any)
    // storno-sichtbar: ein stornierter Antrag wird mit eigener Meldung abgelehnt
    .select('status, storniert_am').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (aErr) throw new AktionsFehler(dbFehlerText(aErr, 'Antrag konnte nicht geladen werden'))
  if (!alt) throw new AktionsFehler('Antrag nicht gefunden – bitte die Seite neu laden.')
  if ((alt as R).storniert_am) throw new AktionsFehler('Der Antrag ist storniert und kann nicht mehr geändert werden.')
  const w = formularWerte(formData)
  const payload: R = {}
  for (const k of pnAenderbareFelder((alt as R).status)) payload[k] = w[k]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('dac_antrag') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw speicherFehler(error, 'Speichern fehlgeschlagen')
  revalidatePath('/dac')
  revalidatePath(`/dac/${id}`)
}

export async function setzeDacStatus(id: string, eingabe: { status: string; datum: string | null; pruefnummer?: string | null; grund?: string | null }): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await dacSchreibrecht()
  if (!istPnStatus(eingabe.status)) throw new AktionsFehler('Unbekannter Status.')
  if (eingabe.datum && !/^\d{4}-\d{2}-\d{2}$/.test(eingabe.datum)) throw new AktionsFehler('Bitte ein gültiges Datum angeben.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_pruefnummernantrag_status_setzen', {
    p_tenant_id: tenantId, p_antrag_id: id, p_status: eingabe.status, p_datum: eingabe.datum || null,
    p_pruefnummer: eingabe.pruefnummer?.trim() || null, p_grund: eingabe.grund?.trim() || null,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Statuswechsel fehlgeschlagen'))
  revalidatePath('/dac')
  revalidatePath(`/dac/${id}`)
  revalidatePath(`/dac/${id}/antrag`)
}

/** Endstatus: Weiterarbeit als neuer Entwurf mit denselben Antrags- und Weinangaben (ohne Nummern, Daten, Status) */
export async function kopiereDacAntragAlsEntwurf(id: string): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await dacSchreibrecht()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: alt, error: aErr } = await (supabase.from('dac_antrag') as any)
    // storno-sichtbar: auch ein stornierter Antrag lässt sich als Vorlage kopieren
    .select('bezeichnung, dac_region, weinausbau_id, jahrgang, rebsorte, menge_liter, alkohol_prozent, notizen')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (aErr) throw new AktionsFehler(dbFehlerText(aErr, 'Antrag konnte nicht geladen werden'))
  if (!alt) throw new AktionsFehler('Antrag nicht gefunden – bitte die Seite neu laden.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neu, error } = await (supabase.from('dac_antrag') as any)
    .insert({ ...(alt as R), tenant_id: tenantId, status: 'entwurf' }).select('id').single()
  if (error) throw speicherFehler(error, 'Kopieren fehlgeschlagen')
  revalidatePath('/dac')
  return { id: (neu as R).id }
}

// KAN-150 F2 (01.10.2026): DAC-Anträge werden storniert statt gelöscht (Frage 6: `aktiv` bleibt Ausblende-Schalter).
// Zeitpunkt und Benutzer setzt die Datenbank (s112_storno_schutz), der stornierte Antrag ist danach unveränderlich und
// gilt nicht mehr als Prüfnummer. Endgültig löschen nur über die RPC s112_storniert_loeschen: stornierte Anträge ohne
// Füllungen und Prüfnummernantrag, Entwürfe ohne Bezug auch ohne Storno (nur Betriebsleitung, Frage 8).
async function dacSchreibrecht() {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return membership
}

export async function stornoDacAntrag(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await dacSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // Nicht stornierte Füllungen führen die Prüfnummer des Antrags – erst umhängen bzw. stornieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('dac_antrag_id', id).is('storniert_am', null)
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllungen des Antrags konnten nicht geprüft werden'))
  if ((count ?? 0) > 0) {
    throw new AktionsFehler(`Der Antrag ist ${count === 1 ? 'einer Füllung' : `${count} Füllungen`} zugeordnet – bitte die Füllung zuerst einem anderen Antrag zuordnen oder stornieren.`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('dac_antrag') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Antrag nicht gefunden oder bereits storniert.')
  revalidatePath('/dac')
  revalidatePath(`/dac/${id}`)
}

export async function loescheDacAntrag(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await dacSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'dac_antrag', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Löschen fehlgeschlagen'))
  revalidatePath('/dac')
}

