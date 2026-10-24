import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/brevo/api'
import { ereignisMelden } from '@/lib/system/ereignis'
import { fehlerText } from '@/lib/fehler'
import { MUSTERHOF_RESET_EMPFAENGER, MUSTERHOF_TENANT_ID, bewerten, ladeMusterhofPruefung, mailInhalt } from '@/lib/demo/musterhofResetAmpel'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const QUELLE = 'cron/musterhof-reset'

// ── Ampel für den nächtlichen Demo-Reset des Musterhofs (24.10.2026) ─────────────────────────────────────────
// Vercel-Cron 35 3 * * * UTC (vercel.json), 35 min nach dem Reset der Hohenstein Suite (03:00 UTC). Prüft nur
// lesend (demo_musterhof_info, journal_konsistenz, lade_behaelter) und mailt die Ampel jeden Tag – auch bei Grün –
// über das IC&P-Brevo-Systemkonto (sendEmail ohne Zugang, Absender BREVO_SENDER_EMAIL). Setzt nie selbst zurück:
// einen gescheiterten Reset holt nur Jörgen nach seinem OK nach. Bewertung in lib/demo/musterhofResetAmpel.ts.

// zwei-faktor-ausnahme: nur mit Authorization: Bearer CRON_SECRET erreichbar – ohne Secret 401, kein Sitzungszweig
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ fehler: 'CRON_SECRET nicht konfiguriert' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })

  const jetzt = new Date()
  // tenant-isolation-ignore: Systemprüfung des Demo-Betriebs, nur lesend mit Service-Role
  const pruefung = await ladeMusterhofPruefung(createSupabaseAdminClient())
  const bewertung = bewerten(pruefung, jetzt)
  const mail = mailInhalt(bewertung, pruefung, jetzt)
  const empfaenger = process.env.MUSTERHOF_RESET_EMPFAENGER?.trim() || MUSTERHOF_RESET_EMPFAENGER

  try {
    await sendEmail({ to: { email: empfaenger }, subject: mail.betreff, htmlContent: mail.html, textContent: mail.text })
  } catch (e) {
    const meldung = `Musterhof-Reset: Ampel-Mail nicht versendet (${bewertung.ampel}): ${fehlerText(e)}`
    console.error(`[${QUELLE}]`, meldung)
    await ereignisMelden({ art: 'cron', quelle: QUELLE, meldung, tenantId: MUSTERHOF_TENANT_ID, details: { ampel: bewertung.ampel, gruende: bewertung.gruende } })
    return NextResponse.json({ fehler: meldung, ampel: bewertung.ampel }, { status: 500 })
  }

  await ereignisMelden({
    art: 'cron', quelle: QUELLE, tenantId: MUSTERHOF_TENANT_ID,
    meldung: `Musterhof-Reset ${bewertung.ampel}${bewertung.gruende.length ? `: ${bewertung.gruende.join('; ')}` : ''}`,
    details: { ampel: bewertung.ampel, letzter_reset: bewertung.letzterReset, gruende: bewertung.gruende },
  })
  return NextResponse.json({ ampel: bewertung.ampel, betreff: mail.betreff, gruende: bewertung.gruende })
}
