'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canWrite, canAdmin, isSystemAdmin } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import type { Zurechnung } from '@/lib/svs/berechnung'
import { AktionsFehler, NICHT_GESPEICHERT, dbFehlerText } from '@/lib/fehler'
import { dezimal } from '@/lib/format'
import { heuteWien } from '@/lib/datum/wien'
import { rund } from '@/lib/zahl/runden'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const ZURECHNUNGEN: Zurechnung[] = ['eigen', 'pacht_fremd', 'pacht_angehoerige', 'verpachtet', 'keine']

async function ctx(schreiben = true) {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new AktionsFehler('Kein Mandant')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (schreiben && !canWrite(membership, 'ea')) throw new AktionsFehler('Keine Berechtigung')
  const supabase = await createSupabaseServerClient()
  return { supabase, tenantId: membership.tenantId, role: membership.role }
}

/** Einheitswert + Zurechnung mehrerer Grundstücke speichern (Tabelle auf der SVS-Seite) */
export async function speichereEinheitswerte(zeilen: { id: string; einheitswert: number | null; svs_zurechnung: string; einheitswert_bescheid?: string | null }[]) {
  const { supabase, tenantId } = await ctx()
  let fehler: string | null = null
  for (const z of zeilen) {
    if (!ZURECHNUNGEN.includes(z.svs_zurechnung as Zurechnung)) return { ok: false, fehler: `Ungültige Zurechnung: ${z.svs_zurechnung}` }
    const { data: geaendert, error } = await (supabase.from('grundstuecke') as any)
      .update({
        einheitswert: z.einheitswert === null || Number.isNaN(z.einheitswert) ? null : rund(z.einheitswert, 2),
        svs_zurechnung: z.svs_zurechnung,
        einheitswert_bescheid: z.einheitswert_bescheid || null,
        einheitswert_quelle: 'manuell',
      })
      .eq('id', z.id).eq('tenant_id', tenantId)
      .select('id')
    if (error) { fehler = (error as R).message; break }
    if (!(geaendert as unknown[] | null)?.length) { fehler = NICHT_GESPEICHERT; break }   // KAN-248
  }
  revalidatePath('/buchhaltung/svs')
  return fehler ? { ok: false, fehler } : { ok: true }
}

/**
 * Import Einheitswerte aus CSV/Excel-Text (Strichpunkt oder Tab, Kopfzeile).
 * Erkannte Spalten (Groß/Klein egal): kg | katastralgemeinde, gst | gst_nr | grundstueck,
 * einheitswert | ew, bescheid | datum, zurechnung. Zuordnung über KG + GST-Nr.
 * (KG optional, wenn die GST-Nr. im Betrieb eindeutig ist).
 */
export async function importiereEinheitswerte(text: string, bescheidDatum?: string | null) {
  const { supabase, tenantId } = await ctx()
  const zeilen = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (zeilen.length < 2) return { ok: false, fehler: 'Keine Datenzeilen gefunden (Kopfzeile + mindestens eine Zeile).' }
  const trenner = zeilen[0].includes('\t') ? '\t' : zeilen[0].includes(';') ? ';' : ','
  const kopf = zeilen[0].split(trenner).map(h => h.trim().toLowerCase().replace(/"/g, ''))
  const idx = (namen: string[]) => kopf.findIndex(h => namen.some(n => h === n || h.startsWith(n)))
  const iKg = idx(['kg', 'katastralgemeinde', 'kg-nr', 'kg_nr']), iGst = idx(['gst', 'gst_nr', 'gst-nr', 'grundst', 'parzelle'])
  const iEw = idx(['einheitswert', 'ew']), iDatum = idx(['bescheid', 'datum']), iZur = idx(['zurechnung', 'pacht'])
  if (iGst < 0 || iEw < 0) return { ok: false, fehler: 'Spalten „GST“ und „Einheitswert“ nicht gefunden – bitte Kopfzeile prüfen.' }

  // alle(): Abgleich über alle Grundstücke – sonst gälten GST ab dem 1.001. als „nicht gefunden“
  const { data: gstRaw, error: gstFehler } = await alle<R>((supabase.from('grundstuecke') as any)
    .select('id, gst_nr, katastralgemeinde, kg_bezeichnung').eq('tenant_id', tenantId).order('id'))
  if (gstFehler) return { ok: false, fehler: `Grundstücke nicht ladbar: ${gstFehler.message}` }
  const gst = gstRaw
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/^0+(?=\d)/, '')
  const parseBetrag = (s: string) => { const t = dezimal(s.replace(/[€\s.]/g, '')); const n = parseFloat(t); return Number.isNaN(n) ? null : n }
  const zurMap: Record<string, Zurechnung> = { eigen: 'eigen', eigentum: 'eigen', voll: 'eigen', pacht: 'pacht_fremd', pacht_fremd: 'pacht_fremd', fremd: 'pacht_fremd', angehoerige: 'pacht_angehoerige', angehörige: 'pacht_angehoerige', pacht_angehoerige: 'pacht_angehoerige', verpachtet: 'verpachtet', keine: 'keine' }

  let uebernommen = 0
  const nichtGefunden: string[] = []
  const mehrdeutig: string[] = []
  for (const zeile of zeilen.slice(1)) {
    const felder = zeile.split(trenner).map(f => f.trim().replace(/^"|"$/g, ''))
    const gstNr = felder[iGst], ew = parseBetrag(felder[iEw] ?? '')
    if (!gstNr || ew === null) continue
    const kg = iKg >= 0 ? norm(felder[iKg]) : ''
    let treffer = gst.filter(g => norm(g.gst_nr) === norm(gstNr))
    if (kg) treffer = treffer.filter(g => norm(g.katastralgemeinde) === kg || norm(g.kg_bezeichnung) === kg)
    if (treffer.length === 0) { nichtGefunden.push(`${kg ? kg + ' ' : ''}${gstNr}`); continue }
    if (treffer.length > 1) { mehrdeutig.push(`${gstNr} (${treffer.length}×)`); continue }
    const update: R = { einheitswert: rund(ew, 2), einheitswert_quelle: 'import', einheitswert_bescheid: (iDatum >= 0 && felder[iDatum]) ? isoDatum(felder[iDatum]) : (bescheidDatum || null) }
    if (iZur >= 0 && felder[iZur]) { const z = zurMap[felder[iZur].toLowerCase().trim()]; if (z) update.svs_zurechnung = z }   // aenderung-ohne-pruefung: Grundstück eben gefunden (treffer) – der Import zählt die übernommenen
    const { error } = await (supabase.from('grundstuecke') as any).update(update).eq('id', treffer[0].id).eq('tenant_id', tenantId)
    if (error) return { ok: false, fehler: dbFehlerText(error) }
    uebernommen++
  }
  revalidatePath('/buchhaltung/svs')
  return { ok: true, uebernommen, nichtGefunden, mehrdeutig }
}

function isoDatum(s: string): string | null {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** Wahl Pauschalsystem / Beitragsgrundlagenoption + manuelle Einkünfte + KV-Zusatz Angehörige */
export async function speichereSvsOption(werte: { svs_option: 'pauschal' | 'option'; svs_einkuenfte_manuell: number | null; svs_kv_angehoerige: boolean; svs_option_seit?: string | null }) {
  const { supabase, tenantId, role } = await ctx()
  if (!canAdmin(role)) return { ok: false, fehler: 'Die SVS-Option legt der Betriebs-Manager fest.' }
  if (werte.svs_option !== 'pauschal' && werte.svs_option !== 'option') return { ok: false, fehler: 'Ungültige Option' }
  // Benutzer-Schreibpfad auf tenant_einstellungen: nur .update() mit den svs_*-Feldern
  // (Trigger a_schutz_plattformfelder, Migration paketfelder_schutz), nie .upsert()
  const { data, error } = await (supabase.from('tenant_einstellungen') as any)
    .update({
      svs_option: werte.svs_option,
      svs_einkuenfte_manuell: werte.svs_einkuenfte_manuell === null || Number.isNaN(werte.svs_einkuenfte_manuell) ? null : werte.svs_einkuenfte_manuell,
      svs_kv_angehoerige: !!werte.svs_kv_angehoerige,
      svs_option_seit: werte.svs_option === 'option' ? (werte.svs_option_seit || heuteWien()) : null,
    })
    .eq('tenant_id', tenantId)
    .select('tenant_id')
  if (error) return { ok: false, fehler: dbFehlerText(error) }
  if (!data || (data as R[]).length === 0) return { ok: false, fehler: 'Einstellungen nicht gespeichert – keine Berechtigung oder Betrieb nicht eingerichtet.' }
  revalidatePath('/buchhaltung/svs')
  return { ok: true }
}

/** SVS-Parameter eines Jahres pflegen (Plattform-Admin; Service-Role, da keine Schreib-Policy) */
// schreibsperre-ausnahme: nur Super-Admin (plattformweite SVS-Parameter, kein Betriebsbezug) – Super-Admins sind von der Abo-Sperre ausgenommen
export async function speichereSvsParameter(p: { jahr: number; staffel: { bis: number | null; prozent: number }[]; satz_pv: number; satz_kv: number; satz_uv: number; satz_bh: number; satz_kv_zusatz: number; min_bg_kv_pv: number; min_bg_uv: number; hoechst_bg: number; hinweis?: string | null }) {
  const membership = await getCurrentMembership()
  if (!membership || !isSystemAdmin(membership.role)) return { ok: false, fehler: 'Nur der Plattform-Admin darf SVS-Parameter ändern.' }
  if (!Array.isArray(p.staffel) || p.staffel.length === 0 || p.staffel.some(s => typeof s.prozent !== 'number')) return { ok: false, fehler: 'Staffel unvollständig' }
  const admin = createSupabaseAdminClient()
  const { error } = await (admin.from('svs_parameter') as any).upsert({ ...p, aktualisiert_am: new Date().toISOString() }, { onConflict: 'jahr' })
  if (error) return { ok: false, fehler: dbFehlerText(error) }
  revalidatePath('/buchhaltung/svs')
  return { ok: true }
}
