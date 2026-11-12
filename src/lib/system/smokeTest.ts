// Smoke-Test der Zugriffsrechte (Migration 223, RPC s112_smoke_test) – gemeinsamer Lauf für den
// Knopf unter Admin → System und den nächtlichen Cron (/api/cron/smoke-test, 12.11.2026).
// Läuft im Demo-Betrieb mit einem Super-Admin als Prüf-Benutzer, je Rolle eine Runde; die RPC rollt
// alles zurück, nichts bleibt liegen. Ergebnis landet in system_ereignisse (Quelle enthält „smoke-test“ –
// darauf filtert der Healthstatus im Morgenbericht der Hohenstein Suite).

import type { SupabaseClient } from '@supabase/supabase-js'
import { ereignisMelden } from '@/lib/system/ereignis'

export const SMOKE_DEMO_TENANT = '33333333-3333-4333-8333-333333333333'

export type SmokeZeile = { lauf: string; modul: string; schritt: string; erwartet: boolean; tatsaechlich: boolean; ok: boolean; meldung: string }

const LAEUFE: { lauf: string; rolle: string; module: string[] | null }[] = [
  { lauf: 'Betriebs-Manager', rolle: 'tenant_admin', module: null },
  { lauf: 'Mitarbeiter (Rieden & Keller)', rolle: 'winzer', module: ['rieden', 'kellerbuch'] },
  { lauf: 'Mitarbeiter (Vertrieb)', rolle: 'winzer', module: ['warenwirtschaft', 'crm'] },
  { lauf: 'Leser', rolle: 'leser', module: null },
]

/** Führt alle Runden aus und protokolliert das Ergebnis. `admin` = Service-Role-Client. */
export async function smokeTestLauf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  pruefBenutzer: string,
  quelle: string,
): Promise<{ zeilen: SmokeZeile[]; dauerMs: number; fehler: number }> {
  const start = Date.now()
  const zeilen: SmokeZeile[] = []
  for (const l of LAEUFE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.rpc as any)('s112_smoke_test', { p_user: pruefBenutzer, p_tenant: SMOKE_DEMO_TENANT, p_rolle: l.rolle, p_module: l.module })
    if (error) {
      zeilen.push({ lauf: l.lauf, modul: 'lauf', schritt: 'Aufruf', erwartet: true, tatsaechlich: false, ok: false, meldung: error.message })
      continue
    }
    for (const r of (data ?? []) as Omit<SmokeZeile, 'lauf'>[]) zeilen.push({ lauf: l.lauf, ...r })
  }
  const fehler = zeilen.filter(z => !z.ok)
  await ereignisMelden({
    art: 'cron', quelle, userId: pruefBenutzer,
    meldung: `Smoke-Test: ${zeilen.length - fehler.length} von ${zeilen.length} Prüfungen bestanden${fehler.length ? `, ${fehler.length} FEHLGESCHLAGEN` : ''}`,
    details: { fehler: fehler.length, fehlgeschlagen: fehler },
  })
  return { zeilen, dauerMs: Date.now() - start, fehler: fehler.length }
}
