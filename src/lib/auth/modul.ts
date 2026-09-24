import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canSeeAuswertungen } from '@/lib/auth/roles'
import { istPflichtmeldungsRolle } from '@/lib/auth/pflichtmeldung'

// Zuschaltbare Module (boolean-Flags auf tenant_einstellungen, Toggle in
// Administration → Mandanten). Die Sidebar blendet die Menüpunkte aus, diese
// Server-Guards sichern zusätzlich die Routen selbst ab - ein direkter Aufruf
// per URL landet ohne Freischaltung auf dem Dashboard (gleiches Muster wie die
// inline-Prüfungen der E&A-Seiten, hier nur einmal zentral).
export type ModulFlag = 'modul_ea' | 'modul_sumup' | 'modul_export' | 'modul_controlling'

export async function hatModul(flag: ModulFlag): Promise<boolean> {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return false
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_einstellungen') as any)
    .select(flag).eq('tenant_id', membership.tenantId).maybeSingle()
  return !!(data as Record<string, unknown> | null)?.[flag]
}

// In Server-Layouts/-Pages: leitet auf /dashboard um, wenn das Modul für den
// aktiven Mandanten nicht freigeschaltet ist.
export async function requireModul(flag: ModulFlag): Promise<void> {
  if (!(await hatModul(flag))) redirect('/dashboard')
}

// Benutzerkonzept (Migration 218): Controlling und Frag dein Weingut sehen nur
// Betriebs-Manager, Leser und Mitarbeiter mit Modul „auswertungen“ in der Matrix.
export async function requireAuswertungen(): Promise<void> {
  const membership = await getCurrentMembership()
  if (!canSeeAuswertungen(membership)) redirect('/dashboard')
}

// Pflichtmeldungen (Entscheidung Jörgen 24.9.2026, „Behördenmeldungen als CSV“):
// Erntemeldung/Lesedaten, Weinbestandsmeldung, Pflanzenschutz-Aufzeichnungen,
// Kupfer-Bilanz, Nährstoffbilanz und Weinbuch-Sammlung – samt Druck und CSV –
// erreichen Betriebsleiter (system_admin, tenant_admin, winzer) auch OHNE Modul
// „Controlling“ und ohne Auswertungsrecht. Alle anderen Rollen (Leser) nur wie
// bisher mit Modul Controlling + Auswertungsrecht. Seiten-Guard:
// reports/(pflicht)/layout.tsx. Dieselbe Regel steht clientseitig (nur
// Sichtbarkeit) in lib/navigation/index.ts (NavItem.pflichtmeldung) und für die
// CSV-Route in lib/behoerden/zugriff.ts – die Rollenliste kommt für alle drei aus
// lib/auth/pflichtmeldung.ts (isomorph).
export { PFLICHTMELDUNG_ROLLEN } from '@/lib/auth/pflichtmeldung'

/** true, wenn die aktive Mitgliedschaft Pflichtmeldungen (Druck + CSV) sehen darf – ohne Umleitung, z.B. für Route-Handler (403). */
export async function darfPflichtmeldungen(): Promise<boolean> {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return false
  if (istPflichtmeldungsRolle(membership.role)) return true
  return canSeeAuswertungen(membership) && (await hatModul('modul_controlling'))
}

// In Server-Layouts/-Pages: leitet ohne Pflichtmeldungs-Zugriff auf /dashboard um.
export async function requirePflichtmeldungen(): Promise<void> {
  if (!(await darfPflichtmeldungen())) redirect('/dashboard')
}
