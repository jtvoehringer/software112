import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ereignisMelden } from '@/lib/system/ereignis'
import { AktionsFehler, fehlerText } from '@/lib/fehler'
import { smokeTestLauf } from '@/lib/system/smokeTest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const QUELLE = 'cron/smoke-test'

// ── Nächtlicher Smoke-Test der Zugriffsrechte (12.11.2026) ─────────────────────────────────────────────────
// Vercel-Cron 50 3 * * * UTC (vercel.json) – nach dem Demo-Reset (03:00 UTC, Hohenstein Suite) und der
// Musterhof-Ampel (03:35 UTC). Derselbe Lauf wie der Knopf unter Admin → System (lib/system/smokeTest.ts):
// im Demo-Betrieb, je Rolle eine Runde, alles wird zurückgerollt. Prüf-Benutzer: SMOKE_TEST_USER_ID (Vercel),
// sonst der älteste Plattform-Admin. Ergebnis in system_ereignisse – der Healthstatus im Morgenbericht der
// Hohenstein Suite zeigt es (rot bei fehlgeschlagenen Prüfungen).

// zwei-faktor-ausnahme: nur mit Authorization: Bearer CRON_SECRET erreichbar – ohne Secret 401, kein Sitzungszweig
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ fehler: 'CRON_SECRET nicht konfiguriert' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })

  // tenant-isolation-ignore: Systemprüfung im Demo-Betrieb mit Service-Role, die RPC rollt alles zurück
  const admin = createSupabaseAdminClient()
  try {
    let pruefBenutzer = process.env.SMOKE_TEST_USER_ID?.trim() || null
    if (!pruefBenutzer) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin.from('plattform_admins') as any)
        .select('user_id').order('erstellt_am').order('user_id').limit(1).maybeSingle()
      if (error) throw new AktionsFehler(error.message)
      pruefBenutzer = (data?.user_id as string | undefined) ?? null
    }
    if (!pruefBenutzer) throw new AktionsFehler('Kein Prüf-Benutzer (SMOKE_TEST_USER_ID oder Plattform-Admin) gefunden')

    const { zeilen, dauerMs, fehler } = await smokeTestLauf(admin, pruefBenutzer, QUELLE)
    return NextResponse.json({ bestanden: zeilen.length - fehler, gesamt: zeilen.length, fehler, dauerMs }, { status: fehler ? 500 : 200 })
  } catch (e) {
    const meldung = `Smoke-Test: Lauf abgebrochen – ${fehlerText(e)}`
    console.error(`[${QUELLE}]`, meldung)
    await ereignisMelden({ art: 'cron', quelle: QUELLE, meldung })
    return NextResponse.json({ fehler: meldung }, { status: 500 })
  }
}
