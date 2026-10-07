'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb, seitenBetriebFehler } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff, schreibSperreFehler } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { wienHeute } from '@/lib/csv'
import { KORREKTUR_FELDER, KORREKTUR_PFADE, korrekturAenderungen, korrekturGrundFehler } from '@/lib/freeze/korrektur'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * KAN-196: Korrektur gesperrter Felder durch die Betriebsleitung (system_admin/tenant_admin) über die RPC
 * s112_freeze_korrektur – mit Grund, protokolliert im Bestandsprotokoll (Alt/Neu, Benutzer, Grund). Nur Tabellen und
 * Felder aus KORREKTUR_FELDER; übergeben werden nur echte Änderungen. Die RPC prüft Rolle, Abo und Grund selbst.
 */
export async function freezeKorrigieren(tabelle: string, id: string, eingabe: Record<string, string>, grund: string): Promise<void> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!canAdmin(membership.role)) throw new AktionsFehler('Korrekturen trotz Sperre nur durch die Betriebsleitung.')
  const felder = KORREKTUR_FELDER[tabelle]
  if (!felder || !UUID_RE.test(id)) throw new AktionsFehler('Für diese Daten gibt es keine Korrektur durch die Betriebsleitung.')
  const gf = korrekturGrundFehler(grund)
  if (gf) throw new AktionsFehler(gf)

  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: alt, error } = await (supabase.from(tabelle) as any)
    // storno-sichtbar: ein stornierter Datensatz wird mit eigener Meldung abgelehnt
    .select(['id', 'storniert_am', ...felder.map(f => f.spalte)].join(', '))
    .eq('id', id).eq('tenant_id', membership.tenantId).maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Datensatz konnte nicht geladen werden'))
  if (!alt) throw new AktionsFehler('Datensatz nicht gefunden – bitte die Seite neu laden.')
  if ((alt as R).storniert_am) throw new AktionsFehler('Der Datensatz ist storniert und bleibt unverändert.')

  const ae = korrekturAenderungen(tabelle, alt as R, eingabe, wienHeute())
  if ('fehler' in ae) throw new AktionsFehler(ae.fehler)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: kErr } = await (supabase.rpc as any)('s112_freeze_korrektur', {
    p_tenant_id: membership.tenantId, p_tabelle: tabelle, p_id: id, p_werte: ae.werte, p_grund: grund.trim(),
  })
  if (kErr) throw new AktionsFehler(dbFehlerText(kErr, 'Korrektur fehlgeschlagen'))
  for (const p of KORREKTUR_PFADE[tabelle] ?? []) revalidatePath(p.replace('[id]', id))
}

/** KAN-222: Darf der Benutzer „Mit Grund korrigieren“ sehen? Für Client-Seiten ohne Rolle (Kellerbehandlungen) – nur
 *  lesend; der Knopf bleibt ohnehin durch freezeKorrigieren und die RPC geschützt. */
export async function korrekturErlaubt(): Promise<boolean> {
  const membership = await getCurrentMembership()
  if (!membership) return false
  if (await seitenBetriebFehler(membership.tenantId)) return false   // KAN-30: veralteter Tab
  const gesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus – keine Korrektur anbieten
  if (gesperrt) return false
  return canAdmin(membership.role)
}
