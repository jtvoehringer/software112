// ── Team-Benachrichtigungen (server-only) ────────────────────────────────────
// Übernommen aus der Hohenstein Suite. Ein Ereignis (Aufgabe/Termin zugewiesen,
// „für alle“, @Erwähnung) wird über zwei Kanäle zugestellt:
//   app    – Zeile in `benachrichtigungen` (Glocke in der Kopfleiste, Migration 224);
//            Einfügen läuft über den Admin-Client, weil es bewusst keine
//            INSERT-Policy gibt (nur der Server darf Benachrichtigungen erzeugen).
//   email  – transaktionale Mail über Brevo (lib/brevo/api.ts), je Benutzer im
//            Profil abschaltbar (profiles.benachrichtigung_email).
// Zustellung ist „best effort“: Fehler werden protokolliert, die auslösende
// Aktion (Aktivität speichern …) schlägt dadurch nie fehl.

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/brevo/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type BenachrichtigungArt = 'aufgabe_zugewiesen' | 'aufgabe_alle' | 'erwaehnung' | 'system'
export type Kanal = 'app' | 'email'

export type Ereignis = {
  tenantId: string
  /** Empfänger (auth.users-IDs); der Auslöser selbst wird automatisch ausgelassen */
  empfaengerIds: string[]
  ausgeloestVon: string | null
  art: BenachrichtigungArt
  titel: string
  text?: string | null
  /** Ziel in der App, z. B. /crm?aktivitaet=… (relativ) */
  href?: string | null
  quelleTyp?: string | null
  quelleId?: string | null
  /** Kanäle – Standard: App + E-Mail */
  kanaele?: Kanal[]
}

type Mitglied = { user_id: string; name: string; email: string; benachrichtigung_email: boolean }

const APP_NAME = 'software:112'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function ladeMitgliederMitEmail(tenantId: string): Promise<Mitglied[]> {
  try {
    const admin = createSupabaseAdminClient()
    const { data } = await (admin as any).rpc('s112_mandant_mitglieder_mit_email', { p_tenant_id: tenantId })
    return ((data ?? []) as R[]).map(m => ({ user_id: m.user_id, name: m.name, email: m.email, benachrichtigung_email: m.benachrichtigung_email !== false }))
  } catch { return [] }
}

/** Ereignis zustellen (App + E-Mail). Wirft nie. */
export async function sendeBenachrichtigung(e: Ereignis): Promise<void> {
  const empfaenger = [...new Set(e.empfaengerIds)].filter(id => id && id !== e.ausgeloestVon)
  if (empfaenger.length === 0) return
  const kanaele = e.kanaele ?? ['app', 'email']
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at').replace(/\/$/, '')
  const hrefAbsolut = e.href ? (e.href.startsWith('http') ? e.href : `${appUrl}${e.href}`) : null

  const mitglieder = await ladeMitgliederMitEmail(e.tenantId)
  const vonName = mitglieder.find(m => m.user_id === e.ausgeloestVon)?.name ?? null
  const admin = createSupabaseAdminClient()

  // ── Kanal App ──
  const zeilenIds = new Map<string, string>(empfaenger.map(id => [id, crypto.randomUUID()]))
  if (kanaele.includes('app')) {
    try {
      const { error } = await (admin.from('benachrichtigungen') as any).insert(empfaenger.map(id => ({
        id: zeilenIds.get(id), tenant_id: e.tenantId, empfaenger_id: id, ausgeloest_von: e.ausgeloestVon, art: e.art,
        titel: e.titel, text: e.text ?? null, href: e.href ?? null, quelle_typ: e.quelleTyp ?? null, quelle_id: e.quelleId ?? null,
      })))
      if (error) { console.error('benachrichtigungen (app):', (error as R).message); zeilenIds.clear() }
    } catch (err) { console.error('benachrichtigungen (app):', err) }
  }

  // ── Kanal E-Mail ──
  if (kanaele.includes('email') && process.env.BREVO_API_KEY) {
    const betreff = `[${APP_NAME}] ${e.titel}`
    await Promise.all(empfaenger.map(async id => {
      const m = mitglieder.find(x => x.user_id === id)
      if (!m?.email || !m.benachrichtigung_email) return
      const anrede = m.name.split(' ')[0]
      const text = `Hallo ${anrede},\n\n${e.titel}${vonName ? ` (von ${vonName})` : ''}\n${e.text ? `\n${e.text}\n` : ''}${hrefAbsolut ? `\nIn ${APP_NAME} öffnen: ${hrefAbsolut}\n` : ''}\n– ${APP_NAME}`
      const html = `<p>Hallo ${esc(anrede)},</p><p><strong>${esc(e.titel)}</strong>${vonName ? ` <span style="color:#707883">(von ${esc(vonName)})</span>` : ''}</p>`
        + (e.text ? `<p style="white-space:pre-wrap;border-left:3px solid #E4E6EB;padding-left:10px;color:#22252B">${esc(e.text)}</p>` : '')
        + (hrefAbsolut ? `<p><a href="${esc(hrefAbsolut)}" style="display:inline-block;background:#4F90E8;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">In ${APP_NAME} öffnen</a></p>` : '')
        + `<p style="color:#707883;font-size:12px">${APP_NAME} · E-Mail-Benachrichtigungen lassen sich im Profil abschalten.</p>`
      try {
        await sendEmail({ to: { email: m.email, name: m.name }, subject: betreff, htmlContent: html, textContent: text, senderName: APP_NAME })
        const zid = zeilenIds.get(id)
        if (zid) await (admin.from('benachrichtigungen') as any).update({ email_gesendet_am: new Date().toISOString() }).eq('id', zid).eq('tenant_id', e.tenantId)
      } catch (err) { console.error('benachrichtigungen (email):', err) }
    }))
  }
}

// ── @Erwähnungen ─────────────────────────────────────────────────────────────
// „@Hannes“, „@Jörgen Vöhringer“ – Vorname oder voller Anzeigename der
// Mitglieder (Groß-/Kleinschreibung egal). Längere Namen werden zuerst geprüft.

export type MitgliedName = { id: string; name: string }

export function findeErwaehnungen(text: string | null | undefined, mitglieder: MitgliedName[]): string[] {
  if (!text || !text.includes('@')) return []
  const t = text.toLowerCase()
  const treffer = new Set<string>()
  const kandidaten = mitglieder.flatMap(m => {
    const voll = m.name.trim().toLowerCase()
    const vorname = voll.split(/\s+/)[0]
    return [...new Set([voll, vorname])].filter(Boolean).map(n => ({ id: m.id, n }))
  }).sort((a, b) => b.n.length - a.n.length)
  for (const k of kandidaten) {
    // @name am Wortanfang (nicht Teil einer E-Mail-Adresse wie info@paul.at), danach Wortende
    const re = new RegExp(`(?<![\\p{L}\\p{N}._-])@${k.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu')
    if (re.test(t)) treffer.add(k.id)
  }
  return [...treffer]
}

/** Neue Erwähnungen gegenüber dem alten Text (damit beim Bearbeiten nicht erneut benachrichtigt wird) */
export function neueErwaehnungen(neuText: string | null | undefined, altText: string | null | undefined, mitglieder: MitgliedName[]): string[] {
  const alt = new Set(findeErwaehnungen(altText, mitglieder))
  return findeErwaehnungen(neuText, mitglieder).filter(id => !alt.has(id))
}

// ── Aktivität (Aufgabe/Termin) gespeichert → Benachrichtigungen ─────────────

export type AktivitaetBenachrichtigung = {
  tenantId: string
  userId: string
  id: string
  betreff: string
  art: string
  datum: string | null
  beschreibung: string | null
  verantwortlichId: string | null
  fuerAlle: boolean
  vorher: { verantwortlich_id: string | null; fuer_alle: boolean; beschreibung: string | null } | null
  mitglieder: MitgliedName[]
}

/** Nach dem Speichern: Zuweisung, „für alle“, @Erwähnungen in der Beschreibung. Wirft nie. */
export async function benachrichtigeAktivitaet(a: AktivitaetBenachrichtigung): Promise<void> {
  try {
    const istTermin = a.art !== 'aufgabe'
    const wort = istTermin ? 'Termin' : 'Aufgabe'
    const href = `/crm?aktivitaet=${a.id}`
    const wann = a.datum ? ` · ${new Date(a.datum + 'T00:00:00').toLocaleDateString('de-AT')}` : ''
    const beschreibung = a.beschreibung
    const textMit = beschreibung ? beschreibung.slice(0, 500) + wann : (wann.replace(/^ · /, '') || null)
    const basis = { tenantId: a.tenantId, ausgeloestVon: a.userId, href, quelleTyp: 'aktivitaet', quelleId: a.id }

    // 1) Verantwortlich neu zugewiesen (nicht an sich selbst – filtert sendeBenachrichtigung)
    const neuV = a.verantwortlichId
    const altV = a.vorher?.verantwortlich_id ?? null
    if (neuV && neuV !== altV) {
      await sendeBenachrichtigung({ ...basis, empfaengerIds: [neuV], art: 'aufgabe_zugewiesen', titel: `${wort} zugewiesen: ${a.betreff}`, text: textMit })
    }
    // 2) Für alle (neu gesetzt)
    if (a.fuerAlle && !a.vorher?.fuer_alle) {
      await sendeBenachrichtigung({ ...basis, empfaengerIds: a.mitglieder.map(m => m.id), art: 'aufgabe_alle', titel: `${wort} für alle: ${a.betreff}`, text: textMit })
    }
    // 3) @Erwähnungen (nur neue; wer gerade zugewiesen wurde, bekommt nicht zwei Mails)
    const erwaehnt = neueErwaehnungen(beschreibung, a.vorher?.beschreibung ?? null, a.mitglieder)
      .filter(uid => !(uid === neuV && neuV !== altV))
    if (erwaehnt.length > 0) {
      await sendeBenachrichtigung({ ...basis, empfaengerIds: erwaehnt, art: 'erwaehnung', titel: `Erwähnung in ${wort}: ${a.betreff}`, text: beschreibung?.slice(0, 500) ?? null })
    }
  } catch (err) { console.error('benachrichtigeAktivitaet:', err) }
}
