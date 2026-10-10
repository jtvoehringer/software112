import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, isSystemAdmin } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { laufMorgenberichte } from '@/lib/morgenbericht/lauf'
import { LAUF_RESERVE_MS, TAEGLICH_QUELLE, ergebnisArt, laufBilanz } from '@/lib/morgenbericht/zeitplan'
import { spiegleMailboxen } from '@/lib/email/spiegel'
import { ereignisMelden, ereignisseBereinigen } from '@/lib/system/ereignis'
import { journalAbgleichAlle } from '@/lib/kellerbuch/journal'
import { dbFehlerText } from '@/lib/fehler'

export const dynamic = 'force-dynamic'
export const maxDuration = 800

// ── Täglicher Sammel-Cron (05:00 UTC = 07:00 MESZ, vercel.json) ──────────────
// Entstanden unter Vercel Hobby (zwei Cron-Jobs je Projekt, einmal täglich, 60 s).
// Seit 23.09.2026 läuft das Projekt auf Vercel Pro mit Fluid Compute: bis 100 Cron-Jobs
// je Projekt, bis einmal pro Minute, minutengenau, maxDuration bis 800 s (KAN-123 nutzt
// das volle Limit). Der Sammel-Cron bleibt trotzdem, weil die Reihenfolge zählt:
// 1. fällige E&A-Daueraufträge, 1b. Abgleich des Bewegungsjournals (KAN-40), 2. E-Mail-Spiegelung, 3. der Morgenbericht aller
// Betriebe – so enthält der Bericht die Buchungen aus den Daueraufträgen bereits.
// Die Einzelrouten bleiben für manuelle Aufrufe (System-Admin) bestehen.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function GET(req: NextRequest) { return handle(req) }
// schreibsperre-ausnahme: Cron bzw. manueller Lauf nur für Super-Admins (von der Abo-Sperre ausgenommen), mandantenübergreifend
export async function POST(req: NextRequest) { return handle(req) }

async function handle(req: NextRequest) {
  const start = Date.now()
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

  // 1. Daueraufträge (mandantenübergreifende DB-Funktion, siehe Migration 164)
  // tenant-isolation-ignore: Cron-Job über alle Mandanten, siehe process_ea_dauerauftraege (Migration 164)
  const admin = createSupabaseAdminClient()
  const { data: daRaw, error: daErr } = await (admin.rpc as any)('process_ea_dauerauftraege')
  const da = (Array.isArray(daRaw) ? daRaw[0] : daRaw) as R | null
  const dauerauftraege = daErr ? { fehler: dbFehlerText(daErr) } : { verarbeitet: da?.verarbeitet ?? 0, erstellt: da?.erstellt ?? 0, uebersprungen: da?.uebersprungen ?? 0, fehler: da?.fehler ?? 0 }

  // 1b. Bewegungsjournal (KAN-40 E1): Mengenänderungen ohne Bewegung als Korrekturbuchung nachtragen – nur Betriebe
  //     mit eröffnetem Journal (journal_ab); Musterhof bleibt vorerst ohne Journal (Jörgen 03.10.2026)
  const journal = await journalAbgleichAlle(admin)

  // 2. E-Mail-Spiegelung ins CRM (Posteingang/Gesendet aller verbundenen Postfächer,
  //    inkrementell) - VOR den Morgenberichten (18.9.2026): der Lauf lief seit dem
  //    11.9. regelmäßig in den 60-s-Timeout (Vercel Runtime Timeout), weil die
  //    Morgenberichte das Budget nur zwischen den Betrieben prüfen; die Spiegelung
  //    kam so nie an die Reihe (email_spiegel_stand blieb überall leer). Jetzt hat
  //    sie ein festes Budget von 22 s und läuft zuerst; ihre Schreibvorgänge bleiben
  //    auch dann erhalten, wenn der Morgenbericht danach das Zeitlimit reißt.
  const emailSpiegel = await spiegleMailboxen(22000)

  // 3. Morgenberichte: Rest bis maxDuration abzüglich Reserve für Bereinigung und Protokoll
  //    (KAN-123; Zeitgrenzen je Betrieb, Reihenfolge und Parallelität in lib/morgenbericht/zeitplan.ts)
  const rest = maxDuration * 1000 - LAUF_RESERVE_MS - (Date.now() - start)
  const morgenbericht = await laufMorgenberichte(Math.max(5000, rest))

  // 4. Systemprotokoll (Migration 222): Ergebnis des Laufs festhalten, alte Ereignisse bereinigen.
  //    KAN-123: Aus Zeitmangel übersprungene oder gekürzte Berichte zählen als Fehler, bewusste
  //    Auslassungen (deaktiviert, Abo gesperrt, Demo-Betrieb) nicht. Gescheiterte Wetterabrufe
  //    (GeoSphere-Zeitlimit, HTTP-Fehler – der Bericht nutzt dann den Cache) stehen in der Meldung,
  //    zählen aber nicht als Fehler.
  const mb = laufBilanz(morgenbericht.ergebnis)
  const fehlerAnzahl = (daErr ? 1 : 0) + Number(da?.fehler ?? 0) + journal.fehler.length + emailSpiegel.fehler.length + mb.alsFehler
  const mbText = `${mb.erstellt} Morgenberichte${mb.bewusst ? ` (${mb.bewusst} bewusst ausgelassen)` : ''}${mb.zeitUebersprungen ? `, ${mb.zeitUebersprungen} aus Zeitmangel übersprungen` : ''}${mb.gekuerzt ? `, ${mb.gekuerzt} wegen der Zeitgrenze gekürzt` : ''}${mb.wetterFehler ? `, ${mb.wetterFehler} ${mb.wetterFehler === 1 ? 'Wetterpunkt' : 'Wetterpunkte'} nicht abrufbar` : ''}`
  const bereinigt = await ereignisseBereinigen()
  await ereignisMelden({
    art: 'cron', quelle: TAEGLICH_QUELLE,
    meldung: `Täglicher Lauf: ${daErr ? 'Daueraufträge FEHLER' : `${da?.erstellt ?? 0} Daueraufträge`}, ${journal.betriebe ? `Journal ${journal.betriebe} ${journal.betriebe === 1 ? 'Betrieb' : 'Betriebe'}/${journal.korrekturen} Korrekturen, ` : ''}${emailSpiegel.angelegt} E-Mails gespiegelt${emailSpiegel.uebersprungen.length ? ` (${emailSpiegel.uebersprungen.length} ${emailSpiegel.uebersprungen.length === 1 ? 'Postfach' : 'Postfächer'} bewusst ausgelassen)` : ''}${emailSpiegel.neuVerbinden.length ? ` (${emailSpiegel.neuVerbinden.length} neu zu verbinden)` : ''}, ${mbText}, ${fehlerAnzahl} Fehler, ${Math.round((Date.now() - start) / 1000)} s`,
    // KAN-69: ausgelassene Postfächer (inaktive Mitgliedschaft, Abo gesperrt) zählen nicht als Fehler
    details: { fehler: fehlerAnzahl, dauerauftraege, journal, emailSpiegel: { ...emailSpiegel, fehler: emailSpiegel.fehler.slice(0, 20), uebersprungen: emailSpiegel.uebersprungen.slice(0, 20) }, morgenbericht: { ...morgenbericht, ergebnis: morgenbericht.ergebnis.filter(e => ergebnisArt(e) !== 'ok' || e.wetterFehler) }, bereinigt },
  })

  return NextResponse.json({ dauerMs: Date.now() - start, dauerauftraege, journal, emailSpiegel, morgenbericht })
}
