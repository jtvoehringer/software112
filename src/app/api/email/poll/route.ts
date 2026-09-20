import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { decryptPass } from '@/lib/email/crypto'
import { getCurrentMembership } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Kann per Vercel Cron oder manuellem Aufruf getriggert werden
// Header X-Cron-Secret muss mit CRON_SECRET übereinstimmen (optional)
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
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: cfg } = await (supabase.from('tenant_einstellungen') as any)
      .select('email_modul_aktiv, email_imap_host, email_imap_port, email_imap_user, email_imap_pass_enc')
      .eq('tenant_id', tenantId).maybeSingle()

    const c = (cfg as R | null)
    if (!c?.email_modul_aktiv || !c.email_imap_host || !c.email_imap_pass_enc)
      return NextResponse.json({ ok: true, info: 'IMAP nicht konfiguriert – übersprungen' })

    // Kontakte + Firmen E-Mail-Adressen laden
    const [{ data: kontakteRaw }, { data: firmenRaw }] = await Promise.all([
      (supabase.from('kontakte') as any).select('id, email').eq('tenant_id', tenantId).eq('aktiv', true).not('email', 'is', null),
      (supabase.from('firmen') as any).select('id, email').eq('tenant_id', tenantId).eq('aktiv', true).not('email', 'is', null),
    ])
    const emailMap: Record<string, { kontakt_id?: string; firma_id?: string }> = {}
    ;(kontakteRaw ?? []).forEach((k: R) => { if (k.email) emailMap[k.email.toLowerCase()] = { kontakt_id: k.id } })
    ;(firmenRaw ?? []).forEach((f: R) => { if (f.email) emailMap[f.email.toLowerCase()] = { firma_id: f.id } })

    const pass   = decryptPass(c.email_imap_pass_enc)
    const client = new ImapFlow({
      host: c.email_imap_host,
      port: Number(c.email_imap_port) || 993,
      secure: true,
      auth: { user: c.email_imap_user, pass },
      logger: false,
    })

    let neuAktivitaeten = 0
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      // Nur ungelesene Mails der letzten 7 Tage
      const seit = new Date(); seit.setDate(seit.getDate() - 7)
      for await (const msg of client.fetch({ since: seit }, { envelope: true, source: true })) {
        const from = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? ''
        const match = emailMap[from]
        if (!match) continue

        const betreff = msg.envelope?.subject ?? '(kein Betreff)'
        const datum   = (msg.envelope?.date ?? new Date()).toISOString().split('T')[0]
        const msgId   = msg.envelope?.messageId ?? null

        // Duplikat-Check über email_id (Sweep 20.9.2026: vorher .ilike('notizen') – Spalte gibt es
        // auf aktivitaeten nicht, die Prüfung scheiterte still und jede Abfrage legte die Mail neu an)
        if (msgId) {
          const { count } = await (admin.from('aktivitaeten') as any)
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('email_id', msgId)
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
      if (e) console.error('[poll] tenant_einstellungen:', e.message) }

    return NextResponse.json({ ok: true, neu: neuAktivitaeten })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
