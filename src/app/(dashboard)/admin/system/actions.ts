'use server'
// seiten-betrieb-ausnahme: Systemtest der Plattform (Super-Admin), kein Schreiben in den aktiven Betrieb (KAN-30)
// schreibsperre-ausnahme-datei: Systemtest der Plattform – nur Super-Admin, von der Abo-Sperre ausgenommen (KAN-5)

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { AktionsFehler } from '@/lib/fehler'
import { smokeTestLauf, type SmokeZeile } from '@/lib/system/smokeTest'

// Smoke-Test der Zugriffsrechte (Migration 223, s112_smoke_test): läuft im
// Demo-Betrieb mit dem angemeldeten Super-Admin als Prüf-Benutzer, je Rolle
// eine Runde – alles wird in der Datenbank zurückgerollt, nichts bleibt liegen.
// Derselbe Lauf läuft nächtlich als Cron (/api/cron/smoke-test, lib/system/smokeTest.ts).

export type { SmokeZeile }

export async function smokeTestAusfuehren(): Promise<{ zeilen: SmokeZeile[]; dauerMs: number }> {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') throw new AktionsFehler('Nur für Super-Admins')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')

  const { zeilen, dauerMs } = await smokeTestLauf(createSupabaseAdminClient(), user.id, '/admin/system/smoke-test')
  return { zeilen, dauerMs }
}
