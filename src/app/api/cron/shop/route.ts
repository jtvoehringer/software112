import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ereignisMelden } from '@/lib/system/ereignis'
import { AktionsFehler, dbFehlerText, fehlerText } from '@/lib/fehler'
import { warteschlangeAbarbeiten } from '@/lib/shop/warteschlange'
import { laufText } from '@/lib/shop/warteschlangeRegeln'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const QUELLE = 'cron/shop'

// ── Weinshop-Anbindung: Warteschlange abarbeiten (KAN-463, 15.11.2026) ──────────────────────────────────────────────
// Vercel-Cron alle 10 Minuten (vercel.json) – überträgt eingereihte Bestände und Weindaten an die WooCommerce-Shops
// der Betriebe mit Modul. Mit ?abgleich=1 (einmal täglich, eigener Zeitplan) werden vorher alle zugeordneten
// Füllungen der Betriebe mit eingeschalteter Bestandsübertragung eingereiht (s112_shop_abgleich_einreihen).
// Ein Eintrag im Systembericht entsteht nur, wenn etwas übertragen wurde oder scheiterte – nicht bei leeren Läufen.

// zwei-faktor-ausnahme: nur mit Authorization: Bearer CRON_SECRET erreichbar – ohne Secret 401, kein Sitzungszweig
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ fehler: 'CRON_SECRET nicht konfiguriert' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  let eingereiht: number | null = null
  try {
    if (req.nextUrl.searchParams.get('abgleich') === '1') {
      // tenant-isolation-ignore: täglicher Abgleich über alle Betriebe mit eingeschalteter Bestandsübertragung (Service-Role)
      const { data, error } = await (admin.rpc as unknown as (fn: string) => PromiseLike<{ data: unknown; error: { message?: string } | null }>)('s112_shop_abgleich_einreihen')
      if (error) throw new AktionsFehler(dbFehlerText(error, 'Abgleich konnte nicht eingereiht werden'))
      eingereiht = Number(data ?? 0)
    }
    const lauf = await warteschlangeAbarbeiten(admin)
    if (lauf.uebertragen > 0 || lauf.fehler > 0 || lauf.offen > 0 || (eingereiht ?? 0) > 0) {
      await ereignisMelden({
        art: 'cron', quelle: QUELLE,
        meldung: `${laufText(lauf)}${eingereiht !== null ? ` (Abgleich: ${eingereiht} eingereiht)` : ''}`,
        details: { ...lauf, eingereiht },
      })
    }
    return NextResponse.json({ ...lauf, eingereiht })
  } catch (e) {
    const meldung = `Shop-Warteschlange: Lauf gescheitert – ${fehlerText(e)}`
    console.error(`[${QUELLE}]`, meldung)
    await ereignisMelden({ art: 'cron', quelle: QUELLE, meldung })
    return NextResponse.json({ fehler: meldung }, { status: 500 })
  }
}
