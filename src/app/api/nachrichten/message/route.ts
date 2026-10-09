import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ladeAbsenderIndex, absenderStatus, findeNamensgleiche, type AbsenderStatus } from '@/lib/crm/absender'
import { ereignisMelden } from '@/lib/system/ereignis'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperre } from '@/lib/auth/sperren'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type KontaktInfo = { typ: 'kontakt' | 'firma'; id: string; name: string; accountnummer: string | null; istLead: boolean; ueber: 'email' | 'domain' } | null

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ fehler: 'Keine ID' }, { status: 400 })
    const mailbox = req.nextUrl.searchParams.get('mailbox') === 'shared' ? 'shared' : 'own'

    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
    // KAN-5: Mail lesen bleibt im Nur-Lesen-Modus möglich – das Spiegeln als CRM-Aktivität und
    // der Lead-Vorschlag (würde speichern) entfallen dann
    const nurLesen = (await schreibSperre(membership)) !== null
    const [{ data: cfg, error: cfgErr }, { data: tenantCfg, error: tenantCfgErr }] = await Promise.all([
      (admin.from('user_email_connections') as any)
        .select('m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, imap_aktiv, imap_host, imap_port, imap_user, imap_pass_enc, monitored_email, email_address').eq('tenant_id', tenantId).eq('user_id', user?.id ?? '').maybeSingle(),
      (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle(),
    ])
    { const ladeFehler = [cfgErr, tenantCfgErr].find(Boolean)
      if (ladeFehler) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${ladeFehler.message}` }, { status: 500 }) }
    const c = cfg as R | null

    if (c?.m365_aktiv && c?.m365_access_token_enc) {
      const token = await getValidUserAccessToken(c, tenantCfg as R, admin, tenantId, user?.id ?? '')
      const mailboxBase = getMailboxBase(c as R, mailbox)
      const res = await fetch(
        `${mailboxBase}/messages/${id}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,conversationId,isRead`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return NextResponse.json({ fehler: 'E-Mail nicht gefunden' }, { status: 404 })
      const msg = await res.json() as R

      // Anhänge (17.9.2026): eingebettete Bilder (Signaturen, Logos) stehen im
      // HTML als <img src="cid:…"> und wurden bisher nur als Alt-Text gezeigt
      // („Obsah obrázku …“). Inline-Anhänge werden hier als data:-URI in das
      // HTML eingesetzt, echte Anhänge als Liste mit Download-Link
      // (/api/nachrichten/anhang) zurückgegeben.
      const anhaenge: { id: string; name: string; groesse: number; typ: string }[] = []
      let bodyHtml: string | null = msg.body?.contentType === 'html' ? msg.body.content : null
      try {
        // Kein $select: contentBytes gehört zum Untertyp fileAttachment und wird
        // in der Liste ohnehin mitgeliefert (mit $select lehnt Graph die Abfrage ab).
        const ar = await fetch(`${mailboxBase}/messages/${id}/attachments?$top=50`, { headers: { Authorization: `Bearer ${token}` } })
        if (!ar.ok) {
          console.error('[nachrichten] Anhänge nicht ladbar:', ar.status, (await ar.text()).slice(0, 300))
        } else {
          const list = ((await ar.json() as R).value ?? []) as R[]
          const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          for (const a of list) {
            const istDatei = typeof a.contentBytes === 'string'
            if (istDatei && bodyHtml && Number(a.size ?? 0) <= 3 * 1024 * 1024) {
              const daten = `data:${a.contentType || 'image/png'};base64,${a.contentBytes}`
              const vorher = bodyHtml
              // 1) über Content-ID (<img src="cid:image001.png@01DC…">)
              const cid = a.contentId ? String(a.contentId).replace(/^<|>$/g, '') : ''
              if (cid) bodyHtml = bodyHtml.replace(new RegExp(`(src\\s*=\\s*["']?)cid:${esc(cid)}(["'\\s>])`, 'gi'), `$1${daten}$2`)
              // 2) Fallback über den Dateinamen (cid:image001.png@… ↔ name image001.png)
              if (vorher === bodyHtml && a.name) bodyHtml = bodyHtml.replace(new RegExp(`(src\\s*=\\s*["']?)cid:${esc(String(a.name))}(@[^"'\\s>]*)?(["'\\s>])`, 'gi'), `$1${daten}$3`)
              if (vorher !== bodyHtml) continue          // eingebettet → nicht in der Anhangsliste
              if (a.isInline) continue                   // Inline ohne Verweis im Text (z.B. Signaturrest)
            }
            if (a['@odata.type'] === '#microsoft.graph.itemAttachment') continue // eingebettete E-Mails
            anhaenge.push({ id: a.id, name: a.name ?? 'Anhang', groesse: Number(a.size ?? 0), typ: a.contentType ?? '' })
          }
        }
      } catch (e) { console.error('[nachrichten] Anhänge:', e) }

      // Kontakt-Matching für Anzeige (E-Mail exakt, sonst Firmendomain; Leads
      // zählen als bekannt). Unbekannte Absender bekommen den Lead-Vorschlag
      // (Dialog „Soll ein Lead angelegt werden?“ im NachrichtenClient) - außer
      // Systemadressen, eigene Postfächer und „nicht mehr fragen“-Absender.
      const fromEmail = msg.from?.emailAddress?.address?.toLowerCase() ?? ''
      let kontaktInfo: KontaktInfo = null
      let absender: AbsenderStatus = 'system'
      // Unbekannte Adresse, aber Name passt zu bestehendem Kontakt/Firma (18.9.2026):
      // die Oberfläche bietet dann „Adresse hinzufügen“ statt „Lead anlegen“ an.
      let namensTreffer: { typ: 'kontakt' | 'firma'; id: string; name: string; accountnummer: string | null; email: string | null; istLead: boolean }[] = []
      if (fromEmail) {
        const idx = await ladeAbsenderIndex(supabase, tenantId, [c.email_address, c.monitored_email, user?.email])
        const s = absenderStatus(idx, fromEmail, msg.from?.emailAddress?.name)
        absender = s.status
        if (s.treffer) kontaktInfo = { typ: s.treffer.typ, id: s.treffer.id, name: s.treffer.name, accountnummer: s.treffer.accountnummer, istLead: s.treffer.istLead, ueber: s.treffer.ueber }
        if (absender === 'unbekannt') {
          namensTreffer = findeNamensgleiche(idx, msg.from?.emailAddress?.name).slice(0, 3)
            .map(t => ({ typ: t.typ, id: t.id, name: t.name, accountnummer: t.accountnummer, email: t.email, istLead: t.istLead }))
        }

        // Eingehende Email als Aktivität speichern (fire-and-forget) – nicht im Nur-Lesen-Modus
        if (kontaktInfo && msg.id && tenantId && !nurLesen) {
          const bodyText = (msg.body?.content ?? '').replace(/<[^>]*>/g, '').trim()
          const bodyHtml = msg.body?.contentType === 'html' ? msg.body.content : null
          void (async () => {
            try {
              const emailData = {
                email_id: msg.id, email_conversation_id: msg.conversationId ?? null,
                email_von: msg.from?.emailAddress?.address ?? null,
                email_von_name: msg.from?.emailAddress?.name ?? null,
                email_an: (msg.toRecipients ?? []).map((r: R) => r.emailAddress?.address).join(', ') || null,
                email_body: bodyText || null, email_body_html: bodyHtml,
                beschreibung: bodyText.slice(0, 500),
              }
              // Bestehenden Eintrag (email_id=null) aktualisieren
              // .eq(spalte, null) schickt "eq.null" und scheitert an der uuid-Spalte – null braucht .is()
              let upd = (supabase.from('aktivitaeten') as any)
                .update(emailData)   // aenderung-ohne-pruefung: optionaler Alt-Eintrag ohne email_id – Anzahl über count danach
                .eq('tenant_id', tenantId)
              upd = kontaktInfo.typ === 'kontakt' ? upd.eq('kontakt_id', kontaktInfo.id) : upd.is('kontakt_id', null)
              upd = kontaktInfo.typ === 'firma'   ? upd.eq('firma_id', kontaktInfo.id)   : upd.is('firma_id', null)
              const { count } = await upd
                .eq('art', 'email').eq('betreff', msg.subject ?? '').is('email_id', null)
                .select('*', { count: 'exact', head: true })
              // Wenn nichts aktualisiert → neu anlegen
              if (!count || count === 0) {
                { const { error: e } = await (supabase.from('aktivitaeten') as any).upsert({
                  tenant_id: tenantId,
                  kontakt_id: kontaktInfo.typ === 'kontakt' ? kontaktInfo.id : null,
                  firma_id:   kontaktInfo.typ === 'firma'   ? kontaktInfo.id : null,
                  art: 'email', erledigt: false, ganztags: true,
                  betreff: msg.subject ?? '(kein Betreff)',
                  datum: (msg.receivedDateTime ?? msg.sentDateTime ?? '').split('T')[0],
                  ...emailData,
                }, { onConflict: 'tenant_id,email_id', ignoreDuplicates: true })
                  if (e) void ereignisMelden({ art: 'db', quelle: 'message/aktivitaeten', meldung: e.message }) }
              }
            } catch { /* ignore */ }
          })()
        }
      }

      return NextResponse.json({
        id: msg.id,
        betreff: msg.subject ?? '(kein Betreff)',
        von: msg.from?.emailAddress?.address ?? '',
        vonName: msg.from?.emailAddress?.name ?? '',
        an: (msg.toRecipients ?? []).map((r: R) => r.emailAddress?.address).join(', '),
        cc: (msg.ccRecipients ?? []).map((r: R) => r.emailAddress?.address).filter(Boolean).join(', '),
        datum: msg.receivedDateTime ?? msg.sentDateTime,
        bodyHtml,
        bodyText: msg.body?.contentType === 'text' ? msg.body.content : msg.body?.content ?? '',
        conversationId: msg.conversationId,
        anhaenge,
        mailbox,
        kontaktInfo,
        absender,
        // Lead-Vorschlag nur für unbekannte Absender (eigene Postfächer → 'eigen')
        leadVorschlag: absender === 'unbekannt' && !nurLesen,
        namensTreffer,
      })
    }
    return NextResponse.json({ fehler: 'Mailbox nicht verbunden' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
