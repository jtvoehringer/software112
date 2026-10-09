'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { alle } from '@/lib/supabase/alle'
import { naechsteTbNummer, tbNummerVergeben, tbPflichtFehler } from '@/lib/behoerden/tbPflicht'
import { betriebsnummerPflicht } from '@/lib/betrieb/betriebsnummer'
import { tbsDuplikatText } from '@/lib/handel/tbsNummer'

/** KAN-90: Duplikat der TBS-Nr. im selben Jahr (UNIQUE transportbescheinigungen_tbs_nummer_uq) verständlich melden */
function speicherFehler(e: R, daten: R): AktionsFehler {
  if (e?.code === '23505' && String(e?.message ?? '').includes('tbs_nummer')) return new AktionsFehler(tbsDuplikatText(daten?.laufende_nr, daten?.jahr))
  return new AktionsFehler(dbFehlerText(e, 'Speichern fehlgeschlagen (transportbescheinigungen)'))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-150 F2 (01.10.2026): Speichern über den Benutzer-Client (RLS tb_* + modul_*), damit der Benutzer im
// Änderungsprotokoll steht – vorher Service-Role ohne Benutzerbezug. Aktiv gewählter Betrieb (Cookie) statt einer
// beliebigen Mitgliedschaft. Eine stornierte Bescheinigung gilt nicht mehr; danach legt Speichern eine neue an.
async function tbSchreibrecht(): Promise<string> {
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!membership || !tenantId) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'warenwirtschaft')) throw new AktionsFehler('Keine Schreibberechtigung für die Warenwirtschaft in diesem Betrieb.')
  return tenantId
}

export async function saveTB(verkaufspostenId: string, daten: R): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await tbSchreibrecht()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: exErr } = await (supabase.from('transportbescheinigungen') as any)
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('verkaufsposten_id', verkaufspostenId)
    .is('storniert_am', null)
    .maybeSingle()
  if (exErr) throw new AktionsFehler(dbFehlerText(exErr, 'Transportbescheinigung konnte nicht geladen werden'))
  // KAN-209: ausgestellt = fest (auch DB-Trigger a_freeze) – Korrektur über Storno und neue Bescheinigung
  if (existing?.status === 'ausgestellt') {
    throw new AktionsFehler('Die Transportbescheinigung ist bereits ausgestellt und kann nicht mehr geändert werden. Korrektur: stornieren und eine neue ausstellen.')
  }

  if (existing?.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: geaendert, error: e } = await (supabase.from('transportbescheinigungen') as any)
      .update({ formular_daten: daten, aktualisiert_am: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId).select('id')
    if (e) throw speicherFehler(e, daten)
    if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
    revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}/transportbescheinigung`)
    return { id: existing.id }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neu, error } = await (supabase.from('transportbescheinigungen') as any)
    .insert({ tenant_id: tenantId, verkaufsposten_id: verkaufspostenId, formular_daten: daten })
    .select('id').single()
  if (error) throw speicherFehler(error, daten)
  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}/transportbescheinigung`)
  return { id: (neu as R).id }
}

export async function stornoTB(verkaufspostenId: string, id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await tbSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('transportbescheinigungen') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).eq('verkaufsposten_id', verkaufspostenId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Transportbescheinigung nicht gefunden oder bereits storniert.')
  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}/transportbescheinigung`)
}

export async function loescheTB(verkaufspostenId: string, id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await tbSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das endgültige Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'transportbescheinigungen', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Endgültig löschen fehlgeschlagen'))
  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}/transportbescheinigung`)
}

// KAN-209 (05.10.2026): Ausstellen – Pflichtangaben prüfen, ohne Eingabe die nächste laufende Nummer des Jahres vergeben,
// gespeicherte Fassung mit Status „ausgestellt“ (Zeitpunkt und Benutzer setzt der Trigger); danach fest.
export async function tbAusstellen(verkaufspostenId: string, daten: R): Promise<{ id: string; laufendeNr: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await tbSchreibrecht()
  const jahr = String(daten?.jahr ?? '').trim()
  const nummerEingabe = String(daten?.laufende_nr ?? '').trim()
  // KAN-261: Weinhändler brauchen als Versender keine Weinbau-Betriebsnummer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase-Typen ohne Tabellenschema (Konvention)
  const { data: art, error: artErr } = await (supabase.from('tenant_einstellungen') as any)
    .select('betriebsart').eq('tenant_id', tenantId).maybeSingle()
  if (artErr) throw new AktionsFehler(dbFehlerText(artErr, 'Betriebsart konnte nicht geladen werden'))
  const fehlt = tbPflichtFehler(daten, {
    nummerWirdVergeben: !nummerEingabe,
    versenderOhneBetriebsnummer: !betriebsnummerPflicht((art as R | null)?.betriebsart),
  })
  if (fehlt.length > 0) throw new AktionsFehler(`Zum Ausstellen fehlen noch: ${fehlt.join('; ')}.`)

  // Laufende Nummern des Jahres (nicht storniert, andere Verkäufe – KAN-90: auch Entwürfe mit Nummer, die DB lehnt
  // ein Duplikat ab; Spalten tbs_nummer/tbs_jahr leitet der Trigger aus dem Formular ab)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase-Typen ohne Tabellenschema (Konvention)
  const { data: vorhandene, error: vErr } = await alle<R>((supabase.from('transportbescheinigungen') as any)
    .select('id, verkaufsposten_id, tbs_nummer')
    .eq('tenant_id', tenantId).eq('tbs_jahr', Number(jahr)).not('tbs_nummer', 'is', null).is('storniert_am', null).order('id'))
  if (vErr) throw new AktionsFehler(dbFehlerText(vErr, 'Laufende Nummern konnten nicht geprüft werden'))
  const imJahr = ((vorhandene ?? []) as R[])
    .filter(t => t.verkaufsposten_id !== verkaufspostenId)
    .map(t => String(t.tbs_nummer ?? ''))
  const laufendeNr = nummerEingabe || naechsteTbNummer(imJahr)
  if (nummerEingabe && tbNummerVergeben(nummerEingabe, imJahr)) {
    throw new AktionsFehler(`Die laufende Nummer ${nummerEingabe}/${jahr} ist bereits vergeben – bitte eine andere eintragen oder das Feld leer lassen (dann wird die nächste vergeben).`)
  }
  const formular = { ...daten, laufende_nr: laufendeNr }

  const { id } = await saveTB(verkaufspostenId, formular)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('transportbescheinigungen') as any)
    .update({ status: 'ausgestellt', aktualisiert_am: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId).eq('status', 'entwurf').is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Ausstellen fehlgeschlagen'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Die Transportbescheinigung wurde inzwischen geändert oder ausgestellt – bitte die Seite neu laden.')
  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}/transportbescheinigung`)
  return { id, laufendeNr }
}
