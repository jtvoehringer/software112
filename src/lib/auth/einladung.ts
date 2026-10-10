import 'server-only'
// ── Konten suchen und Mitglieder einladen (KAN-139, Konto-Vorab-Übernahme) ───
// Gemeinsamer Weg für /benutzer (inviteMember), /admin/mandanten/[id]
// (inviteUserToTenant) und /admin/benutzer (inviteSystemAdmin).
//
// Bisher wurde ein per listUsers gefundenes Konto sofort Mitglied – ohne Mail
// und ohne zu prüfen, ob die Adresse je bestätigt wurde. Wer eine fremde
// Adresse vorab registrierte (Passwort bekannt, Adresse nie geprüft), bekam so
// später die Einladung des echten Inhabers samt Betriebsdaten. Jetzt gilt:
//   – kein Konto          → Supabase-Einladung (Passwort setzt erst, wer den Link aus dem Postfach öffnet)
//   – Konto unbestätigt   → Abbruch mit Hinweis, keine Mitgliedschaft
//   – Konto bestätigt     → Mitgliedschaft (normaler Mehrbetriebs-Fall) + Benachrichtigung
//                           an die Adresse (Brevo, falls eingerichtet) und in der Glocke

import type { SupabaseClient, User } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/brevo/api'
import { sendeBenachrichtigung } from '@/lib/benachrichtigungen/server'
import { roleLabel, type UserRole } from '@/lib/auth/roles'
import { authFehlerText } from './authFehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at').replace(/\/$/, '')
/** Ziel der Supabase-Einladungsmail (muss in Supabase unter Auth → Redirect URLs erlaubt sein) */
export const EINLADUNG_REDIRECT = 'https://software112.icp-consultants.at/auth/invite'

export function normalisiereEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Alle Auth-Konten (blättert über alle Seiten; Sweep 102: /benutzer lud nur die erste Seite mit 1.000 Konten und
 *  verwarf den Fehler). Wirft bei einem Fehler – nie mit einer Teilmenge weiterrechnen. */
export async function alleKonten(admin: SupabaseClient): Promise<User[]> {
  const proSeite = 1000
  const out: User[] = []
  for (let seite = 1; seite <= 100; seite++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: seite, perPage: proSeite })
    if (error) throw new Error(`Benutzerliste konnte nicht geladen werden: ${authFehlerText(error)}`)
    out.push(...data.users)
    if (data.users.length < proSeite) return out
  }
  throw new Error('Benutzerliste konnte nicht vollständig geladen werden (mehr als 100.000 Konten).')
}

/** Auth-Konto per E-Mail suchen (Groß-/Kleinschreibung egal, blättert über alle Seiten). */
export async function findeKontoPerEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const gesucht = normalisiereEmail(email)
  const proSeite = 1000
  for (let seite = 1; seite <= 50; seite++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: seite, perPage: proSeite })
    if (error) throw new Error(`Benutzerliste konnte nicht geladen werden: ${error.message}`)
    const treffer = data.users.find(u => u.email?.toLowerCase() === gesucht)
    if (treffer) return treffer
    if (data.users.length < proSeite) return null
  }
  return null
}

export const UNBESTAETIGT_FEHLER =
  'Für diese E-Mail-Adresse gibt es ein Konto, dessen Adresse noch nicht bestätigt wurde. Aus Sicherheitsgründen kann es erst zugeordnet werden, wenn die Person ihre bisherige Einladung bzw. Registrierung über den Link in ihrem Postfach abgeschlossen hat. Danach bitte erneut einladen.'

export type KontoFuerEinladung =
  | { ok: true; userId: string; neuesKonto: boolean; bestehendesKonto: User | null }
  | { ok: false; fehler: string }

/** Konto für eine Einladung bereitstellen: neues Konto per Supabase-Einladung,
 *  bestehendes nur, wenn die Adresse bestätigt ist. */
export async function kontoFuerEinladung(admin: SupabaseClient, email: string, name?: string): Promise<KontoFuerEinladung> {
  const mail = normalisiereEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, fehler: 'Bitte eine gültige E-Mail-Adresse angeben.' }

  const bestehend = await findeKontoPerEmail(admin, mail)
  if (bestehend) {
    if (!bestehend.email_confirmed_at) return { ok: false, fehler: UNBESTAETIGT_FEHLER }
    return { ok: true, userId: bestehend.id, neuesKonto: false, bestehendesKonto: bestehend }
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(mail, {
    redirectTo: EINLADUNG_REDIRECT,
    ...(name ? { data: { display_name: name } } : {}),
  })
  if (error || !data.user) return { ok: false, fehler: error ? authFehlerText(error) : 'Einladung fehlgeschlagen' }
  return { ok: true, userId: data.user.id, neuesKonto: true, bestehendesKonto: null }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Mail an ein bestehendes (bestätigtes) Konto, dass es einem Betrieb zugeordnet
 *  wurde. Best effort: ohne BREVO_API_KEY oder bei Fehlern kein Abbruch. Liefert,
 *  ob die Mail versandt wurde. */
export async function sendeZuordnungsMail(p: {
  email: string; name: string | null; betriebName: string; rolle: string; eingeladenVon: string | null
}): Promise<boolean> {
  if (!process.env.BREVO_API_KEY) return false
  const anrede = p.name?.trim().split(/\s+/)[0] || null
  const von = p.eingeladenVon ? ` von ${p.eingeladenVon}` : ''
  const titel = `Sie wurden dem Betrieb „${p.betriebName}“ hinzugefügt`
  const text = `${anrede ? `Hallo ${anrede}` : 'Hallo'},\n\n`
    + `Ihr software:112-Konto wurde${von} dem Betrieb „${p.betriebName}“ als ${p.rolle} hinzugefügt. `
    + `Nach der Anmeldung finden Sie ihn in der Betriebsauswahl.\n\n`
    + `Anmelden: ${APP_URL}/login\n\n`
    + `Falls Sie diese Zuordnung nicht erwartet haben, wenden Sie sich bitte an den Betrieb oder an uns – `
    + `Sie können die Mitgliedschaft auch von der Betriebsleitung wieder entfernen lassen.\n\n– software:112`
  const html = `<p>${anrede ? `Hallo ${esc(anrede)}` : 'Hallo'},</p>`
    + `<p>Ihr software:112-Konto wurde${esc(von)} dem Betrieb <strong>„${esc(p.betriebName)}“</strong> als <strong>${esc(p.rolle)}</strong> hinzugefügt. `
    + `Nach der Anmeldung finden Sie ihn in der Betriebsauswahl.</p>`
    + `<p><a href="${esc(APP_URL)}/login" style="display:inline-block;background:#4F90E8;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">Anmelden</a></p>`
    + `<p style="color:#707883;font-size:12px">Falls Sie diese Zuordnung nicht erwartet haben, wenden Sie sich bitte an den Betrieb oder an uns – die Mitgliedschaft lässt sich jederzeit wieder entfernen.</p>`
  try {
    await sendEmail({ to: { email: p.email, ...(p.name ? { name: p.name } : {}) }, subject: `[software:112] ${titel}`, htmlContent: html, textContent: text, senderName: 'software:112' })
    return true
  } catch (err) {
    console.error('Zuordnungs-Mail (KAN-139):', err)
    return false
  }
}

export type EinladungsErgebnis = { success: true; hinweis: string } | { error: string }

/** Mitglied in einen Betrieb einladen – gemeinsamer Ablauf für /benutzer und
 *  /admin/mandanten/[id]. Rollen- und Limitprüfung machen die Aufrufer vorher. */
export async function mitgliedEinladen(admin: SupabaseClient, p: {
  tenantId: string
  email: string
  role: string
  name: string
  /** Modulmatrix (Migration 218); undefined = Feld nicht setzen (DB-Standard) */
  schreibmodule?: string[] | null
  /** auth.users-ID der einladenden Person (für Mail und Glocke) */
  eingeladenVon: string | null
}): Promise<EinladungsErgebnis> {
  const mail = normalisiereEmail(p.email)
  const konto = await kontoFuerEinladung(admin, mail, p.name)
  if (!konto.ok) return { error: konto.fehler }
  const { userId, neuesKonto } = konto

  // Neues Konto wieder entfernen, wenn danach etwas scheitert – sonst bliebe ein
  // eingeladener Auth-User ohne Mitgliedschaft zurück
  const aufraeumen = async () => { if (neuesKonto) await admin.auth.admin.deleteUser(userId) }

  const { data: vorhanden, error: vorhandenFehler } = await (admin.from('tenant_memberships') as R)
    .select('id').eq('user_id', userId).eq('tenant_id', p.tenantId).maybeSingle()
  if (vorhandenFehler) { await aufraeumen(); return { error: (vorhandenFehler as R).message } }
  if (vorhanden) return { error: 'Benutzer ist bereits Mitglied dieses Betriebs.' }

  const zeile: R = { tenant_id: p.tenantId, user_id: userId, role: p.role }
  if (p.schreibmodule !== undefined) zeile.schreibmodule = p.schreibmodule
  const { error: memberError } = await (admin.from('tenant_memberships') as R).insert(zeile)
  if (memberError) { await aufraeumen(); return { error: (memberError as R).message } }

  // Klarname: bei neuen Konten setzen; ein bestehendes Konto gehört der Person
  // selbst (und ggf. anderen Betrieben) – dort nur ergänzen, wenn noch leer.
  const { data: profil, error: profilErr } = await (admin.from('profiles') as R).select('full_name').eq('id', userId).maybeSingle()
  // KAN-254: sonst „noch kein Name“ – ein bestehender Profilname würde überschrieben
  if (profilErr) return { error: (profilErr as R).message }
  const bisherigerName = ((profil as R | null)?.full_name as string | null | undefined)?.trim() || null
  if (neuesKonto || !bisherigerName) {
    const { error: profileError } = await (admin.from('profiles') as R)
      .upsert({ id: userId, full_name: p.name, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (profileError) return { error: (profileError as R).message }
  }

  if (neuesKonto) return { success: true, hinweis: `Einladung an ${mail} versandt.` }

  // Bestehendes, bestätigtes Konto: Person informieren (Mail + Glocke)
  // abfrage-ohne-fehler: nur Betriebs- und Absendername in der Einladungs-Mail (Ersatz „software:112“ bzw. ohne Namen)
  const [{ data: tenant }, { data: einladender }] = await Promise.all([
    (admin.from('tenants') as R).select('name').eq('id', p.tenantId).maybeSingle(),
    p.eingeladenVon
      ? (admin.from('profiles') as R).select('full_name').eq('id', p.eingeladenVon).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const betriebName = ((tenant as R | null)?.name as string | undefined) ?? 'software:112'
  const rolle = roleLabel(p.role as UserRole)
  const mailVersandt = await sendeZuordnungsMail({
    email: mail, name: bisherigerName ?? p.name, betriebName, rolle,
    eingeladenVon: ((einladender as R | null)?.full_name as string | undefined) ?? null,
  })
  await sendeBenachrichtigung({
    tenantId: p.tenantId, empfaengerIds: [userId], ausgeloestVon: p.eingeladenVon, art: 'system',
    titel: `Sie wurden dem Betrieb „${betriebName}“ als ${rolle} hinzugefügt`, href: '/dashboard', kanaele: ['app'],
  })
  return {
    success: true,
    hinweis: mailVersandt
      ? `${mail} hatte bereits ein Konto und wurde dem Betrieb hinzugefügt – die Person wurde per E-Mail informiert.`
      : `${mail} hatte bereits ein Konto und wurde dem Betrieb hinzugefügt. Bitte die Person selbst informieren (E-Mail-Versand ist nicht eingerichtet).`,
  }
}
