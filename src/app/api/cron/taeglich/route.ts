import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, isSystemAdmin } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { laufMorgenberichte } from '@/lib/morgenbericht/lauf'
import { spiegleMailboxen } from '@/lib/email/spiegel'
import { ereignisMelden, ereignisseBereinigen } from '@/lib/system/ereignis'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── Täglicher Sammel-Cron (05:00 UTC = 07:00 MESZ, vercel.json) ──────────────
// Vercel Hobby erlaubt zwei Cron-Jobs je Projekt, jeweils einmal täglich.
// Deshalb laufen hier nacheinander: 1. fällige E&A-Daueraufträge (bisher
// /api/cron/ea-dauerauftraege, 06:00), 2. der Morgenbericht aller Betriebe -
// so enthält der Bericht die Buchungen aus den Daueraufträgen bereits.
// Die Einzelrouten bleiben für manuelle Aufrufe (System-Admin) bestehen.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function GET(req: NextRequest) { return handle(req) }
// schreibsperre-ausnahme: Cron bzw. manueller Lauf nur für Super-Admins (von der Abo-Sperre ausgenommen), mandantenübergreifend
export async function POST(req: NextRequest) { return handle(req) }

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const hasCronAuth = !!cronSecret && authHeader === `Bearer ${cronSecret}`
  if (!hasCronAuth) {
    // Sitzungszweig (manueller Lauf): Zwei-Faktor wie jede benutzergebundene Route (KAN-54)
    const zweiFaktor = await pruefeZweiFaktor()
    if (zweiFaktor) return zweiFaktor
    const membership = await getCurrentMembership()
    if (!membership || !isSystemAdmin(membership.role)) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })
  }
  const start = Date.now()

  // 1. Daueraufträge (mandantenübergreifende DB-Funktion, siehe Migration 164)
  // tenant-isolation-ignore: Cron-Job über alle Mandanten, siehe process_ea_dauerauftraege (Migration 164)
  const admin = createSupabaseAdminClient()
  const { data: daRaw, error: daErr } = await (admin.rpc as any)('process_ea_dauerauftraege')
  const da = (Array.isArray(daRaw) ? daRaw[0] : daRaw) as R | null
  const dauerauftraege = daErr ? { fehler: daErr.message } : { verarbeitet: da?.verarbeitet ?? 0, erstellt: da?.erstellt ?? 0, uebersprungen: da?.uebersprungen ?? 0, fehler: da?.fehler ?? 0 }

  // 2. E-Mail-Spiegelung ins CRM (Posteingang/Gesendet aller verbundenen Postfächer,
  //    inkrementell) - VOR den Morgenberichten (18.9.2026): der Lauf lief seit dem
  //    11.9. regelmäßig in den 60-s-Timeout (Vercel Runtime Timeout), weil die
  //    Morgenberichte das Budget nur zwischen den Betrieben prüfen; die Spiegelung
  //    kam so nie an die Reihe (email_spiegel_stand blieb überall leer). Jetzt hat
  //    sie ein festes Budget von 22 s und läuft zuerst; ihre Schreibvorgänge bleiben
  //    auch dann erhalten, wenn der Morgenbericht danach das Zeitlimit reißt.
  const emailSpiegel = await spiegleMailboxen(22000)

  // 3. Morgenberichte (restliches Zeitbudget, mindestens 5 s)
  const rest = (maxDuration - 6) * 1000 - (Date.now() - start)
  const morgenbericht = await laufMorgenberichte(Math.max(5000, rest))

  // 4. Systemprotokoll (Migration 222): Ergebnis des Laufs festhalten, alte Ereignisse bereinigen
  const mbFehler = morgenbericht.ergebnis.filter(e => e.fehler)
  const mbUebersprungen = morgenbericht.ergebnis.filter(e => e.uebersprungen)
  const fehlerAnzahl = (daErr ? 1 : 0) + Number(da?.fehler ?? 0) + emailSpiegel.fehler.length + mbFehler.length
  const bereinigt = await ereignisseBereinigen()
  await ereignisMelden({
    art: 'cron', quelle: '/api/cron/taeglich',
    meldung: `Täglicher Lauf: ${daErr ? 'Daueraufträge FEHLER' : `${da?.erstellt ?? 0} Daueraufträge`}, ${emailSpiegel.angelegt} E-Mails gespiegelt, ${morgenbericht.betriebe - mbUebersprungen.length} Morgenberichte${mbUebersprungen.length ? ` (${mbUebersprungen.length} übersprungen)` : ''}, ${fehlerAnzahl} Fehler, ${Math.round((Date.now() - start) / 1000)} s`,
    details: { fehler: fehlerAnzahl, dauerauftraege, emailSpiegel: { ...emailSpiegel, fehler: emailSpiegel.fehler.slice(0, 20) }, morgenbericht: { ...morgenbericht, ergebnis: morgenbericht.ergebnis.filter(e => e.fehler || e.uebersprungen) }, bereinigt },
  })

  return NextResponse.json({ dauerMs: Date.now() - start, dauerauftraege, emailSpiegel, morgenbericht })
}
