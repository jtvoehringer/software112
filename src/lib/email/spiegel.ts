// ── E-Mail-Spiegelung ins CRM (17.9.2026) ─────────────────────────────────────
// Täglich (Sammel-Cron /api/cron/taeglich) und manuell (/api/email/spiegel):
// je verbundenem M365-Postfach (user_email_connections, eigene + geteilte
// Mailbox) werden Posteingang und Gesendete Elemente seit dem letzten Stand
// gelesen; Nachrichten von/an bekannte Kontakte oder Firmen (Absender-Index wie
// unter Nachrichten: exakte Adresse oder Firmendomain) werden als Aktivität
// art='email' angelegt (Upsert auf tenant_id,email_id - nichts doppelt).
// Erster Lauf: 90 Tage zurück. Fehler je Postfach werden gesammelt, nicht geworfen.
//
// KAN-69 (01.10.2026): Vor dem Lesen wird je Verbindung geprüft, ob der Verbindungs-User im
// Betrieb eine AKTIVE Mitgliedschaft hat und ob das Abo des Betriebs gesperrt ist (Nur-Lesen-
// Modus, KAN-5) – sonst Postfach überspringen (lib/email/spiegelFreigabe.ts). Das gilt für alle
// Aufrufer: Cron (/api/cron/taeglich), manuell (/api/email/spiegel, /api/nachrichten/spiegeln)
// und „nebenbei“ beim Öffnen der Nachrichten (spiegleNebenbei). Übersprungene Postfächer zählen
// nicht als Fehler (bewusste Auslassung); scheitert die Prüfung selbst, läuft nichts (fail-closed).

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getValidUserAccessToken, getMailboxBase } from '@/lib/m365/graph'
import { ladeAbsenderIndex, findeAbsender, type AbsenderIndex } from '@/lib/crm/absender'
import { ereignisMelden } from '@/lib/system/ereignis'
import { spiegelFreigabe, SPIEGEL_SPERR_TEXT, type SpiegelBetrieb, type SpiegelMitgliedschaft } from '@/lib/email/spiegelFreigabe'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** uebersprungen (KAN-69): Postfächer ohne aktive Mitgliedschaft oder mit gesperrtem Abo, je mit Grund */
export type SpiegelErgebnis = { postfaecher: number; nachrichten: number; angelegt: number; fehler: string[]; uebersprungen: string[]; dauerMs: number }

const ERSTER_LAUF_TAGE = 90
const MAX_JE_ORDNER = 300

export async function spiegleMailboxen(zeitbudgetMs = 40000, nurTenantId?: string, nurUserId?: string): Promise<SpiegelErgebnis> {
  const start = Date.now()
  const deadline = start + zeitbudgetMs
  const admin = createSupabaseAdminClient()
  const erg: SpiegelErgebnis = { postfaecher: 0, nachrichten: 0, angelegt: 0, fehler: [], uebersprungen: [], dauerMs: 0 }

  // tenant-isolation-ignore: Cron über alle verbundenen Postfächer (Service-Role), je Zeile nach tenant_id verarbeitet
  let q = (admin.from('user_email_connections') as any)
    .select('tenant_id, user_id, email_address, monitored_email, m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at, email_spiegel_stand')
    .eq('m365_aktiv', true).not('m365_access_token_enc', 'is', null)
  if (nurTenantId) q = q.eq('tenant_id', nurTenantId)
  if (nurUserId) q = q.eq('user_id', nurUserId)
  const { data: verbindungen, error } = await q
  if (error) { erg.fehler.push(error.message); erg.dauerMs = Date.now() - start; return erg }

  // KAN-69: nur Verbindungen mit aktiver Mitgliedschaft in einem Betrieb ohne Abo-Sperre
  const alle = (verbindungen ?? []) as (R & { tenant_id: string; user_id: string })[]
  let freigegeben: R[] = []
  if (alle.length) {
    const tenantIds = [...new Set(alle.map(v => v.tenant_id))]
    const userIds = [...new Set(alle.map(v => v.user_id))]
    const db = admin as unknown as R
    const [{ data: mitglieder, error: me }, { data: betriebe, error: be }] = await Promise.all([
      // tenant-isolation-ignore: Mitgliedschaften genau der gelesenen Verbindungen (tenant_id IN …, user_id IN …)
      db.from('tenant_memberships').select('tenant_id, user_id, aktiv').in('tenant_id', tenantIds).in('user_id', userIds),
      // tenant-isolation-ignore: Abo-Stand genau der Betriebe der gelesenen Verbindungen
      db.from('tenants').select('id, stripe_status, stripe_trial_ends_at').in('id', tenantIds),
    ])
    if (me || be) {
      erg.fehler.push(`Freigabeprüfung (Mitgliedschaft/Abo) nicht möglich: ${(me ?? be)?.message ?? 'unbekannter Fehler'}`)
      erg.dauerMs = Date.now() - start
      return erg
    }
    const f = spiegelFreigabe(alle, (mitglieder ?? []) as SpiegelMitgliedschaft[], (betriebe ?? []) as SpiegelBetrieb[])
    freigegeben = f.freigegeben
    for (const u of f.uebersprungen) erg.uebersprungen.push(`${u.verbindung.email_address ?? u.verbindung.user_id}: ${SPIEGEL_SPERR_TEXT[u.grund]}`)
  }

  const indexCache = new Map<string, AbsenderIndex>()
  const tenantCfgCache = new Map<string, R | null>()

  for (const uc of freigegeben) {
    if (Date.now() - start > zeitbudgetMs) { erg.fehler.push('Zeitbudget erschöpft – Rest beim nächsten Lauf'); break }
    const tenantId = uc.tenant_id as string
    try {
      if (!tenantCfgCache.has(tenantId)) {
        const { data: tc } = await (admin.from('tenant_einstellungen') as any).select('m365_tenant_id, m365_client_id, m365_client_secret_enc').eq('tenant_id', tenantId).maybeSingle()
        tenantCfgCache.set(tenantId, (tc as R | null) ?? null)
      }
      const tc = tenantCfgCache.get(tenantId)
      if (!tc) { erg.fehler.push(`${uc.email_address ?? uc.user_id}: keine M365-App-Einstellungen`); continue }
      if (!indexCache.has(tenantId)) indexCache.set(tenantId, await ladeAbsenderIndex(admin, tenantId, [uc.email_address, uc.monitored_email]))
      const idx = indexCache.get(tenantId)!
      const token = await getValidUserAccessToken(uc, tc, admin, tenantId, uc.user_id)
      const seit = uc.email_spiegel_stand ? new Date(new Date(uc.email_spiegel_stand).getTime() - 10 * 60000) : new Date(Date.now() - ERSTER_LAUF_TAGE * 86400000)
      const laufStart = new Date()
      const mailboxen: ('own' | 'shared')[] = uc.monitored_email ? ['own', 'shared'] : ['own']
      let anzahl = 0, angelegt = 0
      // Zeitbudget auch INNERHALB eines Postfachs (18.9.2026): wird abgebrochen,
      // rückt der Stand nur bis zur ältesten verarbeiteten Nachricht vor (die
      // Ordner werden absteigend gelesen) - der Rest kommt beim nächsten Lauf.
      let abgebrochen = false
      let neuerStand = laufStart
      for (const mb of mailboxen) {
        const base = getMailboxBase(uc, mb)
        for (const ordner of ['inbox', 'sentItems'] as const) {
          const r = await spiegleOrdner(admin, token, base, ordner, seit, tenantId, idx, uc.user_id, deadline)
          anzahl += r.anzahl; angelegt += r.angelegt
          if (r.fehler) erg.fehler.push(`${uc.email_address ?? uc.user_id} (${mb}/${ordner}): ${r.fehler}`)
          if (r.abgebrochen) {
            abgebrochen = true
            const aelteste = r.aeltesteVerarbeitet ? new Date(r.aeltesteVerarbeitet) : seit
            if (aelteste < neuerStand) neuerStand = aelteste
          }
        }
      }
      erg.postfaecher++; erg.nachrichten += anzahl; erg.angelegt += angelegt
      if (abgebrochen) erg.fehler.push(`${uc.email_address ?? uc.monitored_email ?? uc.user_id}: Zeitbudget erschöpft, Rest beim nächsten Lauf`)
      { const { error: e } = await (admin.from('user_email_connections') as any)
        .update({ email_spiegel_stand: neuerStand.toISOString(), email_spiegel_info: `${laufStart.toISOString().slice(0, 16)} · ${anzahl} geprüft · ${angelegt} neu${abgebrochen ? ' · unvollständig' : ''}` })
        .eq('tenant_id', tenantId).eq('user_id', uc.user_id)
        if (e) void ereignisMelden({ art: 'db', quelle: 'email/user_email_connections', meldung: e.message }) }
    } catch (e) {
      erg.fehler.push(`${uc.email_address ?? uc.user_id}: ${(e as Error).message}`)
    }
  }
  erg.dauerMs = Date.now() - start
  return erg
}

async function spiegleOrdner(
  admin: R, token: string, base: string, ordner: 'inbox' | 'sentItems', seit: Date,
  tenantId: string, idx: AbsenderIndex, userId: string, deadline: number,
): Promise<{ anzahl: number; angelegt: number; fehler: string | null; abgebrochen: boolean; aeltesteVerarbeitet: string | null }> {
  const zeitfeld = ordner === 'sentItems' ? 'sentDateTime' : 'receivedDateTime'
  let url: string | null = `${base}/mailFolders/${ordner}/messages?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,bodyPreview,conversationId&$filter=${zeitfeld} ge ${seit.toISOString()}&$orderby=${zeitfeld} desc&$top=100`
  let anzahl = 0, angelegt = 0
  let abgebrochen = false
  let aeltesteVerarbeitet: string | null = null
  const zeilen: R[] = []
  while (url && anzahl < MAX_JE_ORDNER) {
    if (Date.now() > deadline) { abgebrochen = true; break }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json() as R
    // Graph-Fehler (z.B. 403 bei einer geteilten Mailbox, die noch auf einem
    // lokalen Exchange liegt): Ordner ist nicht lesbar - melden, aber NICHT als
    // „abgebrochen“ werten, sonst würde der Stand jedes Mal auf 90 Tage
    // zurückgesetzt und die lesbaren Ordner immer wieder komplett neu gelesen.
    if (!res.ok || data.error) return { anzahl, angelegt, fehler: `Graph ${res.status}: ${data?.error?.message ?? res.statusText}`, abgebrochen: false, aeltesteVerarbeitet }
    for (const m of (data.value ?? []) as R[]) {
      anzahl++
      aeltesteVerarbeitet = String(m[zeitfeld] ?? m.receivedDateTime ?? m.sentDateTime ?? aeltesteVerarbeitet ?? '') || aeltesteVerarbeitet
      const partner = ordner === 'sentItems'
        ? [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map((r: R) => r.emailAddress?.address as string | undefined)
        : [m.from?.emailAddress?.address as string | undefined]
      let treffer = null
      for (const e of partner) { if (!e) continue; treffer = findeAbsender(idx, e); if (treffer) break }
      if (!treffer || !m.id) continue
      const bodyText = String(m.body?.content ?? '').replace(/<[^>]*>/g, '').replace(/\s+\n/g, '\n').trim()
      zeilen.push({
        tenant_id: tenantId,
        kontakt_id: treffer.typ === 'kontakt' ? treffer.id : null,
        firma_id: treffer.typ === 'firma' ? treffer.id : null,
        art: 'email', erledigt: false, ganztags: true,
        betreff: m.subject ?? '(kein Betreff)',
        datum: String(m.receivedDateTime ?? m.sentDateTime ?? '').split('T')[0] || new Date().toISOString().slice(0, 10),
        email_id: m.id, email_conversation_id: m.conversationId ?? null,
        email_von: m.from?.emailAddress?.address ?? null, email_von_name: m.from?.emailAddress?.name ?? null,
        email_an: (m.toRecipients ?? []).map((r: R) => r.emailAddress?.address).filter(Boolean).join(', ') || null,
        email_body: bodyText || m.bodyPreview || null,
        email_body_html: m.body?.contentType === 'html' ? m.body.content : null,
        beschreibung: (bodyText || m.bodyPreview || '').slice(0, 500) || null,
        erstellt_von: userId,
      })
    }
    url = (data['@odata.nextLink'] as string | undefined) ?? null
    if (url && anzahl >= MAX_JE_ORDNER) abgebrochen = true   // Rest beim nächsten Lauf
  }
  // Vorhandene email_ids überspringen (Upsert mit ignoreDuplicates zählt nicht, was neu ist)
  if (zeilen.length) {
    const ids = zeilen.map(z => z.email_id)
    const vorhanden = new Set<string>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data: ex } = await (admin.from('aktivitaeten') as any).select('email_id').eq('tenant_id', tenantId).in('email_id', ids.slice(i, i + 200))
      for (const e of (ex ?? []) as R[]) vorhanden.add(e.email_id)
    }
    const neu = zeilen.filter(z => !vorhanden.has(z.email_id))
    for (let i = 0; i < neu.length; i += 100) {
      const { error } = await (admin.from('aktivitaeten') as any).upsert(neu.slice(i, i + 100), { onConflict: 'tenant_id,email_id', ignoreDuplicates: true })
      if (error) return { anzahl, angelegt, fehler: error.message, abgebrochen: true, aeltesteVerarbeitet }
      angelegt += Math.min(100, neu.length - i)
    }
  }
  return { anzahl, angelegt, fehler: null, abgebrochen, aeltesteVerarbeitet }
}

/**
 * Inkrementelle Spiegelung „nebenbei“ (18.9.2026): wird beim Öffnen der
 * Nachrichten für das eigene Postfach angestoßen, wenn der letzte Stand älter
 * als 15 Minuten ist - so landen neue Mails bekannter Kontakte zeitnah als
 * Aktivität, nicht erst beim Tageslauf. Läuft nach der Antwort (next/server
 * after()), kurzes Budget, Fehler nur im Protokoll.
 * KAN-69 (01.10.2026): Mitgliedschaft und Abo-Sperre prüft spiegleMailboxen() – im
 * Nur-Lesen-Modus entsteht hier also keine Aktivität und der Stand bleibt unverändert.
 */
export async function spiegleNebenbei(tenantId: string, userId: string, budgetMs = 12000): Promise<void> {
  try {
    const admin = createSupabaseAdminClient()
    const { data } = await (admin.from('user_email_connections') as any)
      .select('email_spiegel_stand, m365_aktiv').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle()
    const uc = data as R | null
    if (!uc?.m365_aktiv) return
    if (uc.email_spiegel_stand && Date.now() - new Date(uc.email_spiegel_stand).getTime() < 15 * 60000) return
    const erg = await spiegleMailboxen(budgetMs, tenantId, userId)
    if (erg.fehler.length) console.warn('[email-spiegel nebenbei]', erg.fehler.join(' | '))
  } catch (e) {
    console.error('[email-spiegel nebenbei]', e)
  }
}
