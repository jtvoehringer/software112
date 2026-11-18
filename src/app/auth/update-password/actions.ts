'use server'
// schreibsperre-ausnahme-datei: eigenes Konto (Kennzeichen „Passwort offen“), keine Betriebsdaten – das Passwort muss sich auch im Nur-Lesen-Modus des Abos festlegen lassen (KAN-465)

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { PASSWORT_OFFEN } from '@/lib/auth/authLink'

// KAN-465: Kennzeichen „Passwort noch nicht festgelegt“ (app_metadata, setzt die Einladung) löschen, sobald der Benutzer
// sein Passwort selbst festgelegt hat. Betrifft immer nur das eigene Konto: Die ID kommt aus der geprüften Sitzung
// (getUser), nie aus einem Parameter. app_metadata kann der Benutzer nicht selbst schreiben – deshalb per Service-Role.
export async function passwortFestgelegt(): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  if (user.app_metadata?.[PASSWORT_OFFEN] !== true) return { ok: true }   // nichts zu löschen
  const admin = createSupabaseAdminClient()
  const { error } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, [PASSWORT_OFFEN]: false } })
  return { ok: !error }
}
