'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle, inBloecken, zaehleInBloecken } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler, dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { ladeBezuege, istBezugsSperre } from '@/lib/stammdaten/bezuege'
import { bezuegeSumme, bezugsMeldung, hatBezug } from '@/lib/stammdaten/bezugText'
import { dezimal } from '@/lib/format'
import { mostgewichtAusFormular, mostgewichtSpalten } from '@/lib/wein/mostgewichtFormular'
import { reifeFelderFehler, reifeZahl } from '@/lib/wein/reifemessung'
import { wienHeute } from '@/lib/csv'
import { rund } from '@/lib/zahl/runden'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

// Rückmeldung 24.8.2026 ("löschen sollte nur dem Betriebsleiter (Rolle)
// möglich sein!!!"): bisher prüften ALLE Server Actions in dieser Datei nur
// getTenantId() (= ist der Nutzer überhaupt Mitglied dieses Mandanten), aber
// NIE die tatsächliche Rolle. Die UI hat Buttons zwar schon anhand von
// writeOk/adminOk (siehe roles.ts) ausgeblendet - das ist aber reine
// Kosmetik: jeder eingeloggte Tenant-Mitglied (auch Rolle "Nur-Lesen") hätte
// diese Actions weiterhin direkt aufrufen können. requireWrite()/
// requireAdmin() sind der serverseitige Ersatz für die bisherigen
// getTenantId()-Aufrufe und werfen bei fehlender Berechtigung - das wird in
// den try/catch-Blöcken unten (deleteWeingarten, deleteRied) bereits sauber
// zu { error } abgefangen, bzw. propagiert bei den nicht try/catch-
// umschlossenen Actions als geworfener Fehler an den Aufrufer.
async function requireWrite(): Promise<{ tenantId: string }> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'rieden')) {
    throw new AktionsFehler('Keine Berechtigung: Diese Aktion ist Betriebs-Manager, Super-Admin oder Mitarbeiter mit Modulrecht vorbehalten.')
  }
  return { tenantId: membership.tenantId }
}

async function requireAdmin(): Promise<{ tenantId: string }> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canAdmin(membership.role)) {
    throw new AktionsFehler('Keine Berechtigung: Löschen (und Deaktivieren) ist nur dem Betriebs-Manager bzw. Super-Admin vorbehalten.')
  }
  return { tenantId: membership.tenantId }
}

export async function createWeingarten(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await requireWrite()

  const name = formData.get('name') as string
  const payload: AnyRecord = {
    tenant_id:            tenantId,
    name,
    // "ried" ist das Feld, nach dem die Rieden-Übersicht gruppiert
    // (WeingartenBaum.tsx) - ohne das würde eine neu angelegte Ried hier in
    // den "Rieden"-Auffangkorb für nicht zugeordnete Weingärten fallen statt
    // als eigene Gruppe mit ihrem Namen zu erscheinen.
    ried:                 name || null,
    ama_feldnummer:       (formData.get('ama_feldnummer') as string) || null,
    codes:                (formData.get('codes') as string) || null,
    interne_bezeichnung:  (formData.get('interne_bezeichnung') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    aktiv:                true,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).insert(payload)
  if (error) throw new AktionsFehler((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function updateWeingarten(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await requireWrite()

  const name = formData.get('name') as string

  const payload: AnyRecord = {
    name,
    ama_feldnummer:       (formData.get('ama_feldnummer') as string) || null,
    codes:                (formData.get('codes') as string) || null,
    interne_bezeichnung:  (formData.get('interne_bezeichnung') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    aktiv:                formData.get('aktiv') === 'true',
  }

  // Rückmeldung 24.8.2026: Umbenennen einer Ried über das "Riedname"-Feld
  // aktualisierte bisher nur weingarten.name - die Rieden-Übersicht
  // (WeingartenBaum.tsx) gruppiert aber nach dem separaten Textfeld "ried",
  // das dadurch beim alten Namen blieb. Praktisch jeder bestehende
  // Weingarten-Datensatz ist über lage_id mit einer Zeile in "lagen"
  // verknüpft (der Kellerbuch-Altsystem-Import in api/import/route.ts setzt
  // lage_id und ried immer gemeinsam) - für diesen Fall wird beim Umbenennen
  // jetzt auch lagen.name mitgezogen und "ried" für ALLE Weingarten-
  // Datensätze dieser Lage aktualisiert (eine Ried kann aus mehreren
  // Weingarten-Datensätzen bestehen, siehe Kommentare in WeingartenBaum.tsx -
  // das Umbenennen betrifft dann bewusst die ganze Ried-Gruppe, nicht nur
  // diesen einen Datensatz). Nur bei Datensätzen ganz ohne Lage-Verknüpfung
  // wird "ried" direkt auf dieser Zeile mitgesetzt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: existingErr } = await (supabase.from('weingarten') as any)
    .select('lage_id')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  // KAN-251: sonst würde nur diese Zeile umbenannt, Lage und übrige Datensätze der Ried nicht
  if (existingErr) throw new AktionsFehler(dbFehlerText(existingErr, 'Ried konnte nicht geladen werden'))

  if (existing?.lage_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { data: geaendert, error: e } = await (supabase.from('lagen') as any)
      .update({ name })
      .eq('id', existing.lage_id).eq('tenant_id', tenantId).select('id')
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (lagen): ${e.message}`)
      if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT) }   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { error: e } = await (supabase.from('weingarten') as any)
      .update({ ried: name })   // aenderung-ohne-pruefung: Ried-Namen aller Weingärten der Lage nachziehen – ohne zugeordnete Weingärten 0 Zeilen
      .eq('lage_id', existing.lage_id).eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weingarten): ${e.message}`) }
  } else {
    payload.ried = name || null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: geaendert, error } = await (supabase.from('weingarten') as any).update(payload).eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler((error as AnyRecord).message)
  if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
  revalidatePath('/weingarten')
  revalidatePath('/lagen')
}

/** Ried-Datensätze deaktivieren bzw. reaktivieren (KAN-150: Stammdaten mit Bezug nur deaktivieren) */
export async function setzeWeingartenAktiv(ids: string[], aktiv: boolean): Promise<{ error?: string }> {
  try {
    if (ids.length === 0) return { error: 'Keine Ried übergeben' }
    const supabase = await createSupabaseServerClient()
    const { tenantId } = await requireAdmin()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('weingarten') as any).update({ aktiv }).in('id', ids).eq('tenant_id', tenantId).select('id')
    if (error) return { error: dbFehlerText(error, aktiv ? 'Reaktivieren fehlgeschlagen' : 'Deaktivieren fehlgeschlagen') }
    if (((data ?? []) as AnyRecord[]).length !== ids.length) return { error: 'Die Ried wurde inzwischen geändert – bitte die Seite neu laden.' }
    revalidatePath('/weingarten')
    revalidatePath('/lagen')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler' }
  }
}

export async function deactivateWeingarten(id: string): Promise<{ error?: string }> {
  return setzeWeingartenAktiv([id], false)
}

// Gemeinsame Fehlermeldung für FK-Verletzungen beim Löschen eines oder
// mehrerer Ried-Datensätze (weingarten). grundstuecke.weingarten_id hat "on
// delete cascade" (Migration 012) - GST-Zeilen werden also automatisch mit
// gelöscht, das braucht hier keinen eigenen Schritt. Blockieren können nur
// die Tabellen OHNE Cascade/Set-Null: pressungen.weingarten_id (Migration 018,
// Lese/Pressvorgänge) und traubenverkauf.weingarten_id (Migration 109).
function friendlyFkError(err: AnyRecord): string | null {
  if (err.code === '23503' || /foreign key/i.test(String(err.message ?? ''))) {
    return 'Dieser Ried kann nicht gelöscht werden, da noch verknüpfte Daten vorhanden sind ' +
      '(z. B. Pressungen/Lese oder Traubenverkauf). Bitte zuerst diese Datensätze entfernen oder den ' +
      'Ried stattdessen deaktivieren statt löschen.'
  }
  return null
}

/**
 * KAN-132 Soll 0 (Löschschutz): Rieden bzw. Grundstücke mit erfassten Maßnahmen oder Kostenaufteilungen nicht löschen –
 * die Kaskaden (grundstuecke → behandlung_grundstuecke, kosteneintrag_weingaerten) veränderten sonst nachträglich die
 * Anteile früherer Maßnahmen, das Behandlungsprotokoll verlöre Zeilen und Σ Kostenanteile ≠ Betrag.
 * Liefert den Grund oder null. (Ein FK auf RESTRICT folgt nur per Migration nach OK.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loeschSperre(supabase: any, tenantId: string, p: { weingartenIds?: string[]; grundstueckIds?: string[] }): Promise<string | null> {
  const wgIds = p.weingartenIds ?? []
  let gstIds = p.grundstueckIds ?? []
  if (wgIds.length > 0) {
    // inBloecken/zaehleInBloecken: bei „alle markieren“ kommen schnell mehrere hundert Grundstücke zusammen (URL-Grenze ≈ 350 IDs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await inBloecken<AnyRecord>(wgIds, b => alle((supabase.from('grundstuecke') as any).select('id').eq('tenant_id', tenantId).in('weingarten_id', b).order('id')))
    if (error) throw new AktionsFehler((error as AnyRecord).message)
    gstIds = [...gstIds, ...data.map(g => String(g.id))]
  }
  const zaehle = async (q: Promise<{ count: number; error: AnyRecord | null }>) => {
    const { count, error } = await q
    if (error) throw new AktionsFehler(String(error.message))
    return count
  }
  const [massnahmenGst, massnahmenWg, kosten] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zaehle(zaehleInBloecken(gstIds, b => (supabase.from('behandlung_grundstuecke') as any).select('behandlung_id', { count: 'exact', head: true }).in('grundstueck_id', b))),
    // storno-sichtbar: Bezugsprüfung – auch stornierte Maßnahmen verweisen auf die Ried (KAN-88)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zaehle(zaehleInBloecken(wgIds, b => (supabase.from('behandlungen') as any).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('weingarten_id', b))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zaehle(zaehleInBloecken(wgIds, b => (supabase.from('kosteneintrag_weingaerten') as any).select('id', { count: 'exact', head: true }).in('weingarten_id', b))),
  ])
  const teile = [
    massnahmenGst + massnahmenWg > 0 ? `${massnahmenGst + massnahmenWg} Maßnahmen-${massnahmenGst + massnahmenWg === 1 ? 'Eintrag' : 'Einträge'}` : null,
    kosten > 0 ? `${kosten} ${kosten === 1 ? 'Kostenaufteilung' : 'Kostenaufteilungen'}` : null,
  ].filter(Boolean)
  if (teile.length === 0) return null
  const was = p.grundstueckIds && !p.weingartenIds ? 'Dieses Grundstück' : 'Diese Ried'
  return `${was} hat erfasste Daten (${teile.join(', ')}) und kann nicht gelöscht werden – das würde die Anteile früherer Maßnahmen, `
    + 'das Behandlungsprotokoll und die Kostenaufteilung nachträglich verändern. Bitte die Ried stattdessen deaktivieren '
    + '(bzw. beim Grundstück die Nutzart ändern).'
}

/**
 * KAN-150 F1: berichtsrelevante Bezüge (Maßnahmen, Lese, Chargen, Pressungen, Traubenverkäufe – auch über die
 * Grundstücke) je Ried-Datensatz; bei Bezug Meldung mit Zählern, die App bietet dann „Deaktivieren“ an.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function riedBezugsMeldung(supabase: any, tenantId: string, ids: string[]): Promise<string | null> {
  const summe = bezuegeSumme(await Promise.all(ids.map(id => ladeBezuege(supabase, tenantId, 'weingarten', id))))
  if (!hatBezug(summe)) return null
  // abfrage-ohne-fehler: nur der Name für die Meldung – abgelehnt wird so oder so (Bezug vorhanden)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('weingarten') as any).select('name').in('id', ids).eq('tenant_id', tenantId).limit(1)
  const name = String(((data ?? []) as AnyRecord[])[0]?.name ?? 'Ried')
  return bezugsMeldung(name, summe, 'die Ried')
}

type LoeschErgebnis = { error?: string; deaktivierbar?: boolean }

export async function deleteWeingarten(id: string): Promise<LoeschErgebnis> {
  try {
    const supabase = await createSupabaseServerClient()
    const { tenantId } = await requireAdmin()
    const bezug = await riedBezugsMeldung(supabase, tenantId, [id])
    if (bezug) return { error: bezug, deaktivierbar: true }
    const sperre = await loeschSperre(supabase, tenantId, { weingartenIds: [id] })
    if (sperre) return { error: sperre, deaktivierbar: true }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: weg, error } = await (supabase.from('weingarten') as any).delete().eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) {
      if (istBezugsSperre(error)) return { error: (error as AnyRecord).message, deaktivierbar: true }
      const friendly = friendlyFkError(error as AnyRecord)
      if (friendly) return { error: friendly }
      return { error: (error as AnyRecord).message }
    }
    if (((weg ?? []) as unknown[]).length === 0) return { error: 'Die Ried wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.' }   // KAN-243
    revalidatePath('/weingarten')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen des Rieds' }
  }
}

// Rückmeldung 24.8.2026: eine "echte" Ried (Lage) besteht in der Rieden-
// Übersicht oft aus mehreren weingarten-Datensätzen (deren GST-Zeilen dort
// flach zusammen unter einer Gruppe angezeigt werden, siehe LageGruppe in
// WeingartenBaum.tsx) - dafür gab es bisher gar keine Löschen-Möglichkeit,
// nur einzelne weingarten-Datensätze waren löschbar. Löscht alle
// weingarten-Zeilen der Gruppe in EINEM atomaren DELETE-Statement (entweder
// alle oder keine, z.B. falls eine davon noch verknüpfte Pressungen hat) -
// die zugehörigen grundstuecke-Zeilen werden dank "on delete cascade"
// automatisch mitgelöscht.
export async function deleteRied(weingartenIds: string[]): Promise<LoeschErgebnis> {
  try {
    if (weingartenIds.length === 0) return { error: 'Keine Weingarten-Datensätze zum Löschen übergeben' }
    const supabase = await createSupabaseServerClient()
    const { tenantId } = await requireAdmin()
    const bezug = await riedBezugsMeldung(supabase, tenantId, weingartenIds)
    if (bezug) return { error: bezug, deaktivierbar: true }
    const sperre = await loeschSperre(supabase, tenantId, { weingartenIds })
    if (sperre) return { error: sperre, deaktivierbar: true }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: weg, error } = await (supabase.from('weingarten') as any)
      .delete()
      .in('id', weingartenIds)
      .eq('tenant_id', tenantId)
      .select('id')
    if (error) {
      if (istBezugsSperre(error)) return { error: (error as AnyRecord).message, deaktivierbar: true }
      const friendly = friendlyFkError(error as AnyRecord)
      if (friendly) return { error: friendly }
      return { error: (error as AnyRecord).message }
    }
    // KAN-243: alle oder keine – weniger gelöschte Zeilen heißt nicht gefunden bzw. RLS (still)
    if (((weg ?? []) as unknown[]).length !== new Set(weingartenIds).size) return { error: 'Die Ried wurde nicht (vollständig) gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.' }
    revalidatePath('/weingarten')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen der Ried' }
  }
}

// ── Grundstücke ─────────────────────────────────────────────────────────────────────────────────

export async function createGrundstueck(weingartenId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await requireWrite()

  // Rückmeldung 24.8.2026: "status" wird nicht mehr gepflegt (abgelöst durch
  // "nutzart") - bewusst NICHT mehr aus formData gelesen/geschrieben, das
  // Formular hat kein Status-Feld mehr. spritzbar leitet sich jetzt aus
  // nutzart==='WI' ab (vorher status==='aktiv') - steuert Ernte-Meldung,
  // Behandlungsplanung, KI-Assistent-Validierung und Zukauf-Flächensumme.
  const nutzart = formData.get('nutzart') as string
  if (!nutzart) throw new AktionsFehler('Nutzart ist ein Pflichtfeld')
  const payload: AnyRecord = {
    tenant_id:             tenantId,
    weingarten_id:         weingartenId,
    gst_nr:                formData.get('gst_nr') as string,
    katastralgemeinde:     (formData.get('katastralgemeinde') as string) || null,
    einlagezahl:           (formData.get('einlagezahl') as string) || null,
    ama_feldnummer:        (formData.get('ama_feldnummer') as string) || null,
    kg_bezeichnung:        (formData.get('kg_bezeichnung') as string) || null,
    boden:                 (formData.get('boden') as string) || null,
    rechtsverhaeltnis:     (formData.get('rechtsverhaeltnis') as string) || null,
    unterlagsrebe:         (formData.get('unterlagsrebe') as string) || null,
    rebsorte:              (formData.get('rebsorte') as string) || null,
    pflanzjahr:            formData.get('pflanzjahr') ? Number(dezimal(formData.get('pflanzjahr'))) : null,
    weinart:               (formData.get('weinart') as string) || null,
    bewirtschaftung:       (formData.get('bewirtschaftung') as string) || null,
    bewirtschaftung_seit:  (formData.get('bewirtschaftung_seit') as string) || null,
    flaeche_ha:            formData.get('flaeche_ha') ? Number(dezimal(formData.get('flaeche_ha'))) : null,
    flaeche_ha_kataster:   formData.get('flaeche_ha_kataster') ? Number(dezimal(formData.get('flaeche_ha_kataster'))) : null,
    trauben_herkunft_code: (formData.get('trauben_herkunft_code') as string) || null,
    nutzart,
    // Stückzahl (Bäume/Büsche) gehört nur zu Nutzart "LSE" - bewusst nur dann
    // aus formData übernehmen, sonst null (auch wenn das Feld aus einer alten
    // Eingabe technisch noch im FormData-Objekt hängen würde).
    lse_stueckzahl:        nutzart === 'LSE' && formData.get('lse_stueckzahl') ? Number(dezimal(formData.get('lse_stueckzahl'))) : null,
    spritzbar:             nutzart === 'WI',
    notizen:               (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('grundstuecke') as any).insert(payload)
  if (error) throw new AktionsFehler((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function updateGrundstueck(id: string, weingartenId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await requireWrite()
  // Rückmeldung 24.8.2026: "status" wird nicht mehr gepflegt, siehe
  // createGrundstueck weiter oben.
  const nutzart = formData.get('nutzart') as string
  if (!nutzart) throw new AktionsFehler('Nutzart ist ein Pflichtfeld')
  const payload: AnyRecord = {
    gst_nr:                formData.get('gst_nr') as string,
    katastralgemeinde:     (formData.get('katastralgemeinde') as string) || null,
    einlagezahl:           (formData.get('einlagezahl') as string) || null,
    ama_feldnummer:        (formData.get('ama_feldnummer') as string) || null,
    kg_bezeichnung:        (formData.get('kg_bezeichnung') as string) || null,
    boden:                 (formData.get('boden') as string) || null,
    rechtsverhaeltnis:     (formData.get('rechtsverhaeltnis') as string) || null,
    unterlagsrebe:         (formData.get('unterlagsrebe') as string) || null,
    rebsorte:              (formData.get('rebsorte') as string) || null,
    pflanzjahr:            formData.get('pflanzjahr') ? Number(dezimal(formData.get('pflanzjahr'))) : null,
    weinart:               (formData.get('weinart') as string) || null,
    bewirtschaftung:       (formData.get('bewirtschaftung') as string) || null,
    bewirtschaftung_seit:  (formData.get('bewirtschaftung_seit') as string) || null,
    flaeche_ha:            formData.get('flaeche_ha') ? Number(dezimal(formData.get('flaeche_ha'))) : null,
    flaeche_ha_kataster:   formData.get('flaeche_ha_kataster') ? Number(dezimal(formData.get('flaeche_ha_kataster'))) : null,
    trauben_herkunft_code: (formData.get('trauben_herkunft_code') as string) || null,
    nutzart,
    lse_stueckzahl:        nutzart === 'LSE' && formData.get('lse_stueckzahl') ? Number(dezimal(formData.get('lse_stueckzahl'))) : null,
    spritzbar:             nutzart === 'WI',
    notizen:               (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: geaendert, error } = await (supabase.from('grundstuecke') as any).update(payload).eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler((error as AnyRecord).message)
  if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
  revalidatePath('/weingarten')
  revalidatePath(`/weingarten/${weingartenId}`)
}

export async function deleteGrundstueck(id: string, weingartenId: string): Promise<LoeschErgebnis> {
  try {
    const supabase = await createSupabaseServerClient()
    const { tenantId } = await requireAdmin()
    // KAN-150 F1: mit Bezug nur deaktivieren
    const bezug = await ladeBezuege(supabase, tenantId, 'grundstuecke', id)
    if (hatBezug(bezug)) {
      // einzelabfrage-ohne-fehler: nur die GST-Nr. für die Meldung – abgelehnt wird so oder so (Bezug vorhanden)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('grundstuecke') as any).select('gst_nr').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
      return { error: bezugsMeldung(`Grundstück ${(data as AnyRecord | null)?.gst_nr ?? ''}`.trim(), bezug, 'das Grundstück'), deaktivierbar: true }
    }
    const sperre = await loeschSperre(supabase, tenantId, { grundstueckIds: [id] })
    if (sperre) return { error: sperre, deaktivierbar: true }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: weg, error } = await (supabase.from('grundstuecke') as any).delete().eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) {
      if (istBezugsSperre(error)) return { error: (error as AnyRecord).message, deaktivierbar: true }
      return { error: dbFehlerText(error, 'Grundstück konnte nicht gelöscht werden') }
    }
    if (((weg ?? []) as unknown[]).length === 0) return { error: 'Das Grundstück wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.' }   // KAN-243
    revalidatePath('/weingarten')
    revalidatePath(`/weingarten/${weingartenId}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen des Grundstücks' }
  }
}

/**
 * KAN-150 F1 (Frage 1): Grundstück deaktivieren mit Stichtag (nicht mehr bewirtschaftet, verkauft, verpachtet) – es
 * bleibt für frühere Zeiträume in den Meldungen (Flächenverzeichnis, Kupfer, Erntemeldung) bis zu diesem Tag.
 * aktiv und deaktiviert_am immer gemeinsam (CHECK grundstuecke_deaktiviert_check).
 */
export async function setzeGrundstueckAktiv(id: string, weingartenId: string, aktiv: boolean, datum: string | null): Promise<{ error?: string }> {
  try {
    if (!aktiv && (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum) || Number.isNaN(Date.parse(datum)))) {
      return { error: 'Bitte das Datum angeben, ab dem das Grundstück nicht mehr bewirtschaftet wird.' }
    }
    const supabase = await createSupabaseServerClient()
    const { tenantId } = await requireAdmin()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('grundstuecke') as any)
      .update({ aktiv, deaktiviert_am: aktiv ? null : datum }).eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) return { error: dbFehlerText(error, aktiv ? 'Reaktivieren fehlgeschlagen' : 'Deaktivieren fehlgeschlagen') }
    if (((data ?? []) as AnyRecord[]).length !== 1) return { error: 'Grundstück nicht gefunden – bitte die Seite neu laden.' }
    revalidatePath('/weingarten')
    revalidatePath(`/weingarten/${weingartenId}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler' }
  }
}

// ── BEV Kataster-API ────────────────────────────────────────────────────────────────────────────

export type BevNutzung = { ns: string; nutzung: string; ha: number }
export type BevResult = {
  ok: true; ha: number
  nutzungen: BevNutzung[]
} | {
  ok: false; message: string
  alleNutzungen?: BevNutzung[]  // gefüllt wenn GST gefunden aber kein ns=53
}

// schreibsperre-ausnahme: nur lesend – fragt die Fläche beim BEV-Kataster ab, schreibt nichts
export async function fetchBevFlaeche(kgnr: string, gstNr: string): Promise<BevResult> {
  if (!kgnr || !gstNr) return { ok: false, message: 'KGNr und GST-Nr erforderlich' }
  try {
    // KGNr auf 5 Stellen padden (z.B. "4023" → "04023")
    const paddedKgnr = kgnr.padStart(5, '0')
    // Slash in GST-Nr ist ein echter Pfad-Trenner, NICHT url-encodieren
    const url = 'https://kataster.bev.gv.at/api/gst/' + paddedKgnr + '/' + gstNr
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { ok: false, message: 'BEV-API Fehler: ' + res.status }
    const data = await res.json() as Record<string, unknown>
    if ('message' in data) return { ok: false, message: String(data.message) }
    type RawNutzung = { ns: string; nutzung: string; fl: number }
    const props = (data.properties as { nutzungen?: RawNutzung[] } | undefined)
    const alleRaw: RawNutzung[] = props?.nutzungen ?? []
    const toNutzung = (n: RawNutzung): BevNutzung => ({ ns: String(n.ns), nutzung: n.nutzung, ha: Math.round(n.fl) / 10000 })
    // Nur Weingärten (Nutzungsschlüssel ns=53)
    const weingarten = alleRaw.filter(n => String(n.ns) === '53')
    if (weingarten.length === 0) {
      return {
        ok: false,
        message: 'Keine Weingarten-Nutzung (ns=53) – Nutzungsaufschlüsselung:',
        alleNutzungen: alleRaw.map(toNutzung),
      }
    }
    const totalM2 = weingarten.reduce((s, n) => s + (n.fl ?? 0), 0)
    return {
      ok: true,
      ha: Math.round(totalM2) / 10000,
      nutzungen: weingarten.map(toNutzung),
    }
  } catch {
    return { ok: false, message: 'BEV-API nicht erreichbar' }
  }
}

// ── Rieden-Koordinaten (Stufe 1, Migration 181) ───────────────────────────────
//
// Riedenebene: eine Ried kann aus mehreren weingarten-Zeilen bestehen (gleiche
// lage_id bzw. gleicher ried-Text, siehe Kommentare in WeingartenBaum.tsx).
// Der Pin wird deshalb auf ALLE Zeilen derselben Ried geschrieben – analog zum
// Umbenennen in updateWeingarten().
async function riedGeschwister(supabase: any, tenantId: string, weingartenId: string): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: w, error: wErr } = await (supabase.from('weingarten') as any).select('id, lage_id, ried').eq('id', weingartenId).eq('tenant_id', tenantId).maybeSingle()
  // KAN-251: sonst „keine Datensätze“ – loescheRiedGeo meldete dann still Erfolg
  if (wErr) throw new AktionsFehler(dbFehlerText(wErr, 'Ried konnte nicht geladen werden'))
  if (!w) return []
  let q = (supabase.from('weingarten') as any).select('id').eq('tenant_id', tenantId)
  if (w.lage_id) q = q.eq('lage_id', w.lage_id)
  else if (w.ried) q = q.eq('ried', w.ried).is('lage_id', null)
  else return [w.id]
  // alle-ausnahme: Datensätze einer einzigen Ried – fachlich wenige Zeilen
  const { data: rows, error: rowsErr } = await q
  if (rowsErr) throw new AktionsFehler(dbFehlerText(rowsErr, 'Datensätze der Ried konnten nicht geladen werden'))
  const ids = ((rows ?? []) as { id: string }[]).map(r => r.id)
  return ids.length ? ids : [w.id]
}

export async function speichereRiedGeo(weingartenId: string, lat: number, lon: number): Promise<{ error?: string; anzahl?: number }> {
  try {
    const supabase = await createSupabaseServerClient()
    const { tenantId } = await requireWrite()
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'Ungültige Koordinaten' }

    const ids = await riedGeschwister(supabase, tenantId, weingartenId)
    if (!ids.length) return { error: 'Ried nicht gefunden' }
    const { data: geaendert, error } = await (supabase.from('weingarten') as any)
      .update({ zentrum_lat: rund(lat, 6), zentrum_lon: rund(lon, 6), geo_quelle: 'manuell', geo_stand: new Date().toISOString() })
      .in('id', ids).eq('tenant_id', tenantId).select('id')
    if (error) return { error: dbFehlerText(error) }
    if (!(geaendert as unknown[] | null)?.length) return { error: NICHT_GESPEICHERT }   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
    revalidatePath(`/weingarten/${weingartenId}`); revalidatePath('/weingarten'); revalidatePath('/dashboard/weingarten')
    return { anzahl: ids.length }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Speichern der Koordinaten' }
  }
}

export async function loescheRiedGeo(weingartenId: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const { tenantId } = await requireWrite()
    const ids = await riedGeschwister(supabase, tenantId, weingartenId)
    const { error } = await (supabase.from('weingarten') as any)
      .update({ zentrum_lat: null, zentrum_lon: null, geometrie: null, geo_quelle: null, geo_stand: null })   // aenderung-ohne-pruefung: Koordinaten aller Datensätze der Ried entfernen – ohne Datensätze ist nichts zu tun
      .in('id', ids).eq('tenant_id', tenantId)
    if (error) return { error: dbFehlerText(error) }
    revalidatePath(`/weingarten/${weingartenId}`); revalidatePath('/weingarten'); revalidatePath('/dashboard/weingarten')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen der Koordinaten' }
  }
}

// ── KAN-203: Reife-Messungen je Ried ────────────────────────────────────────
// Mostgewicht über MostgewichtEingabe (Messwert + Einheit, serverseitig gerechnet), dazu Säure, pH, Notiz.
// Nicht berichtsrelevant – Ändern und Löschen mit Schreibrecht Rieden.
export async function reifemessungSpeichern(weingartenId: string, formData: FormData): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const { tenantId } = await requireWrite()
    const id = ((formData.get('id') as string | null) ?? '').trim() || null
    const mg = mostgewichtAusFormular(formData, 'mostgewicht')
    if (!mg.ok) return { error: mg.fehler }
    if (!mg.wert) return { error: 'Bitte das Mostgewicht der Reife-Messung angeben.' }
    const felder = {
      datum: ((formData.get('datum') as string | null) ?? '').trim(),
      gesamtsaeure_gl: reifeZahl(formData.get('gesamtsaeure_gl')),
      ph_wert: reifeZahl(formData.get('ph_wert')),
    }
    if (Number.isNaN(felder.gesamtsaeure_gl) || Number.isNaN(felder.ph_wert)) return { error: 'Gesamtsäure und pH bitte als Zahl eingeben (z. B. 6,8).' }
    const fehler = reifeFelderFehler(felder, wienHeute())
    if (fehler) return { error: fehler }
    const zeile: AnyRecord = {
      ...felder,
      ...mostgewichtSpalten(mg.wert, 'kmw'),
      notizen: ((formData.get('notizen') as string | null) ?? '').trim() || null,
    }
    const { data: gespeichert, error } = id
      ? await (supabase.from('reifemessungen') as unknown as AnyRecord).update(zeile).eq('id', id).eq('tenant_id', tenantId).eq('weingarten_id', weingartenId).select('id')
      : await (supabase.from('reifemessungen') as unknown as AnyRecord).insert({ ...zeile, tenant_id: tenantId, weingarten_id: weingartenId }).select('id')
    if (error) return { error: dbFehlerText(error, 'Speichern fehlgeschlagen') }
    if (!(gespeichert as unknown[] | null)?.length) return { error: NICHT_GESPEICHERT }   // KAN-248
    revalidatePath(`/weingarten/${weingartenId}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Speichern der Reife-Messung' }
  }
}

export async function reifemessungLoeschen(weingartenId: string, id: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const { tenantId } = await requireWrite()
    const { data: weg, error } = await (supabase.from('reifemessungen') as unknown as AnyRecord).delete().eq('id', id).eq('tenant_id', tenantId).eq('weingarten_id', weingartenId).select('id')
    if (error) return { error: dbFehlerText(error, 'Löschen fehlgeschlagen') }
    if (((weg ?? []) as unknown[]).length === 0) return { error: 'Die Reife-Messung wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.' }   // KAN-243
    revalidatePath(`/weingarten/${weingartenId}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen der Reife-Messung' }
  }
}
