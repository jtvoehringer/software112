'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { AktionsFehler } from '@/lib/fehler'
import { ereignisMelden } from '@/lib/system/ereignis'

// Smoke-Test der Zugriffsrechte (Migration 223, s112_smoke_test): läuft im
// Demo-Betrieb mit dem angemeldeten Super-Admin als Prüf-Benutzer, je Rolle
// eine Runde – alles wird in der Datenbank zurückgerollt, nichts bleibt liegen.

const DEMO_TENANT = '33333333-3333-4333-8333-333333333333'

export type SmokeZeile = { lauf: string; modul: string; schritt: string; erwartet: boolean; tatsaechlich: boolean; ok: boolean; meldung: string }

const LAEUFE: { lauf: string; rolle: string; module: string[] | null }[] = [
  { lauf: 'Betriebs-Manager', rolle: 'tenant_admin', module: null },
  { lauf: 'Mitarbeiter (Rieden & Keller)', rolle: 'winzer', module: ['rieden', 'kellerbuch'] },
  { lauf: 'Mitarbeiter (Vertrieb)', rolle: 'winzer', module: ['warenwirtschaft', 'crm'] },
  { lauf: 'Leser', rolle: 'leser', module: null },
]

export async function smokeTestAusfuehren(): Promise<{ zeilen: SmokeZeile[]; dauerMs: number }> {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') throw new AktionsFehler('Nur für Super-Admins')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')

  const admin = createSupabaseAdminClient()
  const start = Date.now()
  const zeilen: SmokeZeile[] = []
  for (const l of LAEUFE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.rpc as any)('s112_smoke_test', { p_user: user.id, p_tenant: DEMO_TENANT, p_rolle: l.rolle, p_module: l.module })
    if (error) {
      zeilen.push({ lauf: l.lauf, modul: 'lauf', schritt: 'Aufruf', erwartet: true, tatsaechlich: false, ok: false, meldung: error.message })
      continue
    }
    for (const r of (data ?? []) as Omit<SmokeZeile, 'lauf'>[]) zeilen.push({ lauf: l.lauf, ...r })
  }
  const fehler = zeilen.filter(z => !z.ok)
  await ereignisMelden({
    art: 'cron', quelle: '/admin/system/smoke-test', userId: user.id,
    meldung: `Smoke-Test: ${zeilen.length - fehler.length} von ${zeilen.length} Prüfungen bestanden${fehler.length ? `, ${fehler.length} FEHLGESCHLAGEN` : ''}`,
    details: { fehler: fehler.length, fehlgeschlagen: fehler },
  })
  return { zeilen, dauerMs: Date.now() - start }
}
