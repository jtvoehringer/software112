'use server'

// KAN-150 F2 (01.10.2026): Exportauftrag stornieren statt löschen. Der Auftrag bleibt mit Grund stehen (Liste und CSV
// zeigen ihn gekennzeichnet), Positionen und Dokumente sind danach unveränderlich (a_export_kind_schutz), ein e-AD gibt es
// nicht mehr. Endgültig löschen über die RPC s112_storniert_loeschen: stornierte Aufträge, Entwürfe ohne ausgestelltes
// Dokument und ohne ARC auch ohne Storno (nur Betriebsleitung, Frage 8) – Positionen und Dokumente gehen mit.
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText, erwarteteDbAblehnung } from '@/lib/fehler'
import { heuteWien } from '@/lib/datum/wien'
import { ladeExportFaktura } from '@/lib/export/fakturaLaden'
import { fakturaRechnungstext } from '@/lib/export/fakturierung'
import { createVerkauf } from '@/app/(dashboard)/weinhandel/verkauf/actions'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { pruefeModul } from '@/lib/auth/modul'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function exportSchreibrecht(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!canWrite(membership, 'warenwirtschaft')) throw new AktionsFehler('Keine Schreibberechtigung für die Warenwirtschaft in diesem Betrieb.')
  await pruefeModul('modul_export')   // KAN-6: Paket-Modul Exportaufträge
  return membership.tenantId
}

export async function stornoExportauftrag(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await exportSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('exportauftraege') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Exportauftrag nicht gefunden oder bereits storniert.')
  revalidatePath('/weinexport')
  revalidatePath(`/weinexport/${id}`)
}

export async function loescheExportauftrag(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await exportSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'exportauftraege', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Löschen fehlgeschlagen'))
  revalidatePath('/weinexport')
}

// ── KAN-436 E1 (12.11.2026): Rechnung und Bestandsabgang aus dem Exportauftrag ──────────────────────────────────────────
// „Rechnung stellen“ legt über den bestehenden Weg (createVerkauf: Bestand alles-oder-nichts, Periodensperre, Rollback)
// einen Verkauf mit Rechnung an und verknüpft ihn mit dem Exportauftrag. Positionen, Kunde, Steuerfall und Text kommen
// aus dem Exportauftrag (ladeExportFaktura) – createVerkauf rechnet sie zur Gegenprüfung selbst noch einmal.
export async function exportRechnungStellen(id: string): Promise<{ error?: string; verkaufId?: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await exportSchreibrecht()
  const ex = await ladeExportFaktura(supabase, tenantId, id)
  if (!ex) return { error: 'Exportauftrag nicht gefunden – bitte die Seite neu laden.' }
  if (ex.faktura.fehler.length > 0) return { error: `Keine Rechnung möglich: ${ex.faktura.fehler.join(' ')}` }
  const referenz = String(ex.auftrag.referenz ?? '')
  const fd = new FormData()
  fd.set('datum', heuteWien())
  if (ex.faktura.kontaktId) fd.set('kontakt_id', ex.faktura.kontaktId)
  if (ex.faktura.firmaId) fd.set('firma_id', ex.faktura.firmaId)
  fd.set('rechnung_sofort', 'true')
  fd.set('export_id', id)
  fd.set('positionen_json', JSON.stringify(ex.faktura.positionen))
  fd.set('rechnungstext', fakturaRechnungstext(ex.faktura, referenz))
  fd.set('notizen', `Rechnung zum Exportauftrag ${referenz}`)
  const erg = await createVerkauf(fd)
  if ('error' in erg) return { error: erg.error }
  revalidatePath('/weinexport')
  revalidatePath(`/weinexport/${id}`)
  return { verkaufId: erg.id }
}

/** Mustersendung (Entscheidung 4A): Bestand als Entnahme aus- bzw. zurückbuchen – eine Transaktion in der Datenbank */
export async function exportMusterBuchen(id: string, zurueck: boolean): Promise<{ error?: string; flaschen?: number }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await exportSchreibrecht()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('s112_export_muster_buchen', {
    p_tenant_id: tenantId, p_auftrag_id: id, p_datum: heuteWien(), p_zurueck: zurueck,
  })
  if (error) {
    if (erwarteteDbAblehnung(error)) return { error: dbFehlerText(error, 'Das Muster konnte nicht gebucht werden') }
    throw new AktionsFehler(dbFehlerText(error, 'Das Muster konnte nicht gebucht werden'))
  }
  revalidatePath('/weinexport')
  revalidatePath(`/weinexport/${id}`)
  revalidatePath('/weinhandel')
  return { flaschen: Number((data as R | null)?.flaschen ?? 0) }
}
