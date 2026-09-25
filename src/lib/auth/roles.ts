import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getActiveTenantCookie } from '@/lib/auth/activeTenant'

export type UserRole = 'system_admin' | 'tenant_admin' | 'winzer' | 'leser' | null

// ── Benutzerkonzept (Beschluss Mgmt-Team 19.9.2026, Migration 218) ────────────
// system_admin = Super-Admin, tenant_admin = Betriebs-Manager, winzer = Mitarbeiter
// (bearbeitet nur in freigegebenen Modulen, Matrix je Person), leser = Leser.
// Die technischen Schlüssel bleiben (96 RLS-Policies, Migrationen), nur die
// Anzeige ändert sich. Die Datenbank prüft die Matrix selbst (s112_darf_schreiben,
// restriktive Policies) - canWrite() hier steuert nur, was die Oberfläche anbietet.

export type { Modul } from './module'
export { MODULE, ALLE_MODULE, isModul, MODUL_VORLAGEN } from './module'
import { ALLE_MODULE, isModul, type Modul } from './module'

export type Membership = { tenantId: string; role: UserRole; schreibmodule: Modul[] }

/** Module aus der Mitgliedschaft: Admins immer alle, Leser keine, Mitarbeiter laut Matrix */
export function moduleAusMembership(role: UserRole, roh: unknown): Modul[] {
  if (role === 'system_admin' || role === 'tenant_admin') return ALLE_MODULE
  if (role !== 'winzer') return []
  return Array.isArray(roh) ? (roh.filter(isModul) as Modul[]) : []
}

// Je Request gemerkte Modulrechte der aktiven Mitgliedschaft, damit canWrite(role, modul)
// an den ~100 bestehenden Aufrufstellen ohne Signaturwechsel modulgenau prüfen kann.
// getCurrentMembership() befüllt den Speicher; ohne Befüllung (z.B. Client) gilt
// die bisherige Regel (Mitarbeiter darf).
const rechteSpeicher = cache(() => ({ schreibmodule: null as Modul[] | null }))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/**
 * Gibt die Rolle des eingeloggten Users im aktiven Tenant zurück.
 */
export async function getCurrentUserRole(): Promise<UserRole> {
  const m = await getCurrentMembership()
  return m?.role ?? null
}

/** Gibt Tenant-ID + Rolle zurück – liest aktiven Tenant aus Cookie.
 *  Per Request dedupliziert (React cache, 17.9.2026): Layout und Seite rufen
 *  das mehrfach - vorher je Aufruf ein Auth-Roundtrip + Membership-Abfrage. */
export const getCurrentMembership = cache(async function getCurrentMembership(): Promise<Membership | null> {
  const supabase = await createSupabaseServerClient()
  const activeTenantId = await getActiveTenantCookie()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  if (activeTenantId) {
    // Validiere Cookie gegen tatsächliche Memberships. WICHTIG: zusätzlich zu RLS explizit
    // auf user_id filtern - die RLS-Policy "memberships: tenant_admin can view all in
    // tenant" lässt system_admin/tenant_admin absichtlich ALLE Mitgliedschafts-Zeilen ihres
    // Tenants sehen (für die Nutzerverwaltung), nicht nur ihre eigene. Ohne .eq('user_id',
    // user.id) könnte .limit(1).maybeSingle() bei einem Tenant mit mehreren Mitgliedern
    // eine BELIEBIGE dieser sichtbaren Zeilen zurückgeben - und damit einem system_admin/
    // tenant_admin fälschlich die Rolle eines ANDEREN Mitglieds zuweisen (z.B. 'leser'
    // statt der eigenen 'system_admin'-Rolle), abhängig von einer nicht garantierten
    // Zeilenreihenfolge ohne ORDER BY.
    const { data } = await (supabase.from('tenant_memberships') as any)
      .select('tenant_id, role, schreibmodule')
      .eq('tenant_id', activeTenantId)
      .eq('user_id', user.id)
      .eq('aktiv', true)   // deaktivierte Mitgliedschaft (Migration 159) zählt nicht - wie in RLS
      .limit(1)
      .maybeSingle()
    if (data) return membershipAus(data as R)
  }

  // Fallback: erste Membership (kein Cookie gesetzt oder Cookie veraltet). Das IST hier
  // die kanonische "irgendeine Mitgliedschaft"-Fallback-Logik selbst, auf die sich
  // getCurrentMembership() als Ganzes stützt - jede andere Stelle im Code soll
  // stattdessen getCurrentMembership() aufrufen statt diese Query zu duplizieren. Auch
  // hier auf user_id gefiltert (siehe Kommentar oben) - ansonsten dieselbe Gefahr einer
  // fremden Mitgliedschaftszeile, nur diesmal sogar potenziell eines FREMDEN Mandanten.
  // KAN-33: deterministisch die älteste Mitgliedschaft (Sortierung wie die Abfrage in
  // /betrieb-waehlen) – ohne ORDER BY lieferte Postgres „irgendeine“, der Fallback-Betrieb
  // konnte also von Aufruf zu Aufruf wechseln (Layout zeigt A, die Action schreibt in B; der
  // Betriebs-Wächter, KAN-30, verlässt sich auf einen stabilen Betrieb).
  // tenant-isolation-ignore: kanonischer Fallback ohne aktiven Tenant-Cookie, siehe Kommentar oben
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id, role, schreibmodule')
    .eq('user_id', user.id)
    .eq('aktiv', true)
    .order('created_at', { ascending: true })
    .order('tenant_id')
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return membershipAus(data as R)
})

function membershipAus(d: R): Membership {
  const role = d.role as UserRole
  const m: Membership = { tenantId: d.tenant_id, role, schreibmodule: moduleAusMembership(role, d.schreibmodule) }
  try { rechteSpeicher().schreibmodule = m.schreibmodule } catch { /* außerhalb eines Requests */ }
  return m
}

// ── Berechtigungsprüfungen ─────────────────────────────────────────────────

/** Darf anlegen + bearbeiten. Mit Modul: Mitarbeiter nur, wenn das Modul in
 *  seiner Matrix freigegeben ist; ohne Modul: irgendwo schreiben dürfen.
 *  Statt der Rolle kann auch die Mitgliedschaft übergeben werden (Actions). */
export function canWrite(rolle: UserRole | Membership, modul?: Modul | 'betrieb'): boolean {
  const role = typeof rolle === 'object' && rolle ? rolle.role : rolle
  if (role === 'system_admin' || role === 'tenant_admin') return true
  if (role !== 'winzer') return false
  const mods = typeof rolle === 'object' && rolle ? rolle.schreibmodule : rechteSpeicherLesen()
  if (!mods) return true
  if (modul === 'betrieb') return true   // betriebsweite Kleinigkeiten (Fristen, Checklisten, Morgenbericht): jeder Mitarbeiter
  return modul ? mods.includes(modul) : mods.length > 0
}

function rechteSpeicherLesen(): Modul[] | null {
  try { return rechteSpeicher().schreibmodule } catch { return null }
}

/** Controlling + Frag dein Weingut sehen: Admins und Leser immer, Mitarbeiter mit Modul „auswertungen“ */
export function canSeeAuswertungen(rolle: UserRole | Membership): boolean {
  const role = typeof rolle === 'object' && rolle ? rolle.role : rolle
  if (role === 'system_admin' || role === 'tenant_admin' || role === 'leser') return true
  if (role !== 'winzer') return false
  const mods = typeof rolle === 'object' && rolle ? rolle.schreibmodule : rechteSpeicherLesen()
  return mods ? mods.includes('auswertungen') : true
}

/** Darf löschen + deaktivieren (nur Admins) */
export function canAdmin(role: UserRole): boolean {
  return role === 'system_admin' || role === 'tenant_admin'
}

/** Darf Benutzerverwaltung (nur Admins) */
export function canManageUsers(role: UserRole): boolean {
  return role === 'system_admin' || role === 'tenant_admin'
}

/** Ist Plattform-Admin */
export function isSystemAdmin(role: UserRole): boolean {
  return role === 'system_admin'
}

/** Lesbare Rollenbezeichnung auf Deutsch */
export function roleLabel(role: UserRole): string {
  const labels: Record<string, string> = {
    system_admin: 'Super-Admin',
    tenant_admin: 'Betriebs-Manager',
    winzer:       'Mitarbeiter',
    leser:        'Leser',
  }
  return role ? (labels[role] ?? role) : '–'
}

// ── Sandbox-Sonderfreigabe für den Administration-Menübaum ─────────────────
//
// paul.derstroff@outlook.com und jg@weingut-gebeshuber.at sollen den
// Administration-Menübaum (Mandanten/Release Notes/Datenimport/System-Admin/
// Onboarding Guide/Zeiterfassung) sehen und nutzen können, aber AUSSCHLIESSLICH
// solange ihr aktiver Betrieb der Mandant "Sandbox" ist - in jedem anderen
// Mandanten (auch dem echten Weingut Gebeshuber) NIE (Rückmeldung 19.8.2026).
// Das gilt unabhängig von ihrer tatsächlichen Rolle im jeweiligen Mandanten.
//
// WICHTIG: Diese Liste schaltet nur die MENÜSICHTBARKEIT frei (Sidebar.tsx).
// Die dahinterliegenden Seiten /admin/mandanten, /admin/mandanten/[id] und
// /admin/benutzer sind zusätzlich selbst gehärtet, damit die Sonderfreigabe
// NIEMALS echte Kundendaten (u.a. Stripe/Brevo/SMTP-IMAP/M365/SumUp-
// Zugangsdaten oder System-Admin-Listen anderer Mandanten) ausliefert, egal
// welche URL direkt aufgerufen wird - siehe isSandboxAdminUnlock()-Aufrufe in
// den jeweiligen page.tsx/actions.ts-Dateien. /admin/import und
// /admin/onboarding sind bereits von sich aus ungefährlich (tenant-gescopt
// bzw. rein statischer Inhalt) und brauchen keine zusätzliche Härtung.
export const SANDBOX_ADMIN_ALLOWLIST = ['paul.derstroff@outlook.com', 'jg@weingut-gebeshuber.at']

/** true, wenn diese E-Mail zur Sandbox-Sonderfreigabe gehört UND der aktuell
 *  aktive/betroffene Mandant tatsächlich "Sandbox" ist. */
export function isSandboxAdminUnlock(email: string | null | undefined, isSandbox: boolean): boolean {
  if (!isSandbox || !email) return false
  return SANDBOX_ADMIN_ALLOWLIST.includes(email.toLowerCase())
}
