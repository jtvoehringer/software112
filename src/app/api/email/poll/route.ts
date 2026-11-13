import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { decryptPass } from '@/lib/email/crypto'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'
import { wienTag } from '@/lib/datum/wien'
import { dbFehlerText } from '@/lib/fehler'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Kann per Vercel Cron oder manuellem Aufruf getriggert werden
// Header X-Cron-Secret muss mit CRON_SECRET übereinstimmen (optional)
// zwei-faktor-ausnahme: nur mit Authorization: Bearer CRON_SECRET erreichbar – ohne Secret 401, kein Sitzungszweig
// schreibsperre-ausnahme: nur mit CRON_SECRET erreichbar – kein Benutzer, kein Sitzungszweig
export async function POST(req: NextRequest) {
  // Authentifizierung: CRON_SECRET (Cron-Job) ODER eingeloggte Supabase-Session (Admin)
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  // CRON_SECRET muss gesetzt sein – ohne Secret kein Zugriff
  if (!cronSecret) return NextResponse.json({ fehler: 'CRON_SECRET nicht konfiguriert' }, { status: 503 })
  const hasCronAuth = authHeader === `Bearer ${cronSecret}`
  if (!hasCronAuth) return NextResponse.json({ fehler: 'Unauthorized' }, { status: 401 })
  try {
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()

    const membership = await getCurrentMembership()
    const leseSperre = leseKonflikt(membership, 'crm')   // KAN-455: Lesebereich je Profil
    if (leseSperre) return leseSperre
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    // KAN-135: Passwort-Chiffrat nur per Service-Role (Benutzer haben keinen SELECT darauf)
    const { data: cfg, error: cfgErr } = await (admin.from('tenant_einstellungen') as any)
      .select('email_modul_aktiv, email_imap_host, email_imap_port, email_imap_user, email_imap_pass_enc')
      .eq('tenant_id', tenantId).maybeSingle()
    // KAN-252: sonst „IMAP nicht konfiguriert – übersprungen“ mit ok: true
    if (cfgErr) return NextResponse.json({ fehler: `E-Mail-Einstellungen konnten nicht geladen werden: ${dbFehlerText(cfgErr)}` }, { status: 500 })

    const c = (cfg as R | null)
    if (!c?.email_modul_aktiv || !c.email_imap_host || !c.email_imap_pass_enc)
      return NextResponse.json({ ok: true, info: 'IMAP nicht konfiguriert – übersprungen' })

    // Kontakte + Firmen E-Mail-Adressen laden
    // alle(): Gebeshuber hat über 8.000 Kontakte und 4.600 Firmen – ohne Paging wurden
    // E-Mails von Adressen ab dem 1.001. Datensatz keinem Kontakt bzw. keiner Firma zugeordnet
    const [{ data: kontakteRaw, error: kontakteRawErr }, { data: firmenRaw, error: firmenRawErr }] = await Promise.all([
      alle<R>((supabase.from('kontakte') as any).select('id, email').eq('tenant_id', tenantId).eq('aktiv', true).not('email', 'is', null).order('id')),
      alle<R>((supabase.from('firmen') as any).select('id, email').eq('tenant_id', tenantId).eq('aktiv', true).not('email', 'is', null).order('id')),
    ])
    { const ladeFehler = [kontakteRawErr, firmenRawErr].find(Boolean)
      if (ladeFehler) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${ladeFehler.message}` }, { status: 500 }) }
    const emailMap: Record<string, { kontakt_id?: string; firma_id?: string }> = {}
    ;(kontakteRaw ?? []).forEach((k: R) => { if (k.email) emailMap[k.email.toLowerCase()] = { kontakt_id: k.id } })
    ;(firmenRaw ?? []).forEach((f: R) => { if (f.email) emailMap[f.email.toLowerCase()] = { firma_id: f.id } })

    const pass   = decryptPass(c.email_imap_pass_enc)
    const client = new ImapFlow({
      host: c.email_imap_host,
      port: Number(c.email_imap_port) || 993,   // null-vorgabe-ok: Port 0 ist ungültig – Standardport des Protokolls
      secure: true,
      auth: { user: c.email_imap_user, pass },
      logger: false,
    })

    let neuAktivitaeten = 0
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      // Nur ungelesene Mails der letzten 7 Tage
      // datum-ok: Zeitpunkt minus 7 Tage für den IMAP-Filter, kein Wiener Kalendertag nötig
      const seit = new Date(); seit.setDate(seit.getDate() - 7)
      for await (const msg of client.fetch({ since: seit }, { envelope: true, source: true })) {
        const from = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? ''
        const match = emailMap[from]
        if (!match) continue

        const betreff = msg.envelope?.subject ?? '(kein Betreff)'
        const datum   = wienTag(msg.envelope?.date ?? new Date())   // KAN-255: Wiener Kalendertag (wie beim M365-Webhook, KAN-237)
        const msgId   = msg.envelope?.messageId ?? null

        // Duplikat-Check über email_id (Sweep 20.9.2026: vorher .ilike('notizen') – Spalte gibt es
        // auf aktivitaeten nicht, die Prüfung scheiterte still und jede Abfrage legte die Mail neu an)
        if (msgId) {
          const { count, error: dupErr } = await (admin.from('aktivitaeten') as any)
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('email_id', msgId)
          // Sweep 90 (KAN-282): Lesefehler hieß „neu“ – dieselbe Mail wurde bei jedem Abruf erneut angelegt.
          // Überspringen: der nächste Abruf versucht es wieder (die Mail bleibt im Postfach).
          if (dupErr) { console.error('E-Mail-Abruf: Duplikat-Prüfung fehlgeschlagen:', dupErr.message); continue }
          if ((count ?? 0) > 0) continue
        }

        const { error: insertErr } = await (admin.from('aktivitaeten') as any).insert({
          tenant_id:    tenantId,
          kontakt_id:   match.kontakt_id ?? null,
          firma_id:     match.firma_id   ?? null,
          art:          'email',
          email_id:     msgId,
          betreff,
          beschreibung: `Eingehende E-Mail von ${from}`,
          datum,
          erledigt:     false,
          ganztags:     true,
        })
        if (insertErr) {
          console.error('aktivitaet insert error:', insertErr.message)
          continue
        }
        neuAktivitaeten++
      }
    } finally {
      lock.release()
      await client.logout()
    }

    // Letzten Poll-Zeitstempel aktualisieren
    { const { error: e } = await (admin.from('tenant_einstellungen') as any)
      .update({ email_last_poll: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      if (e) void ereignisMelden({ art: 'db', quelle: 'poll/tenant_einstellungen', meldung: e.message }) }

    return NextResponse.json({ ok: true, neu: neuAktivitaeten })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
