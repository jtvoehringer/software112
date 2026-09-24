// ── Rollen für Pflichtmeldungen und Verwaltungs-Exporte (isomorph, 25.09.2026) ─────
//
// Eine Stelle für die Rollenlisten, die bisher dreifach im Code standen (lib/auth/modul.ts,
// lib/behoerden/zugriff.ts, lib/navigation/index.ts). Nur `import type` aus lib/auth/roles
// (server-only) – die Datei ist deshalb auch in Client-Komponenten nutzbar.
//
// Pflichtmeldungen (Entscheidung Jörgen 24.09.2026): Erntemeldung/Lesedaten,
// Weinbestandsmeldung, Pflanzenschutz-Aufzeichnungen, Kupfer-Bilanz, Nährstoffbilanz und
// Weinbuch-Sammlung – samt Druck und CSV – erreichen Betriebsleiter auch OHNE Modul
// „Controlling“; alle anderen Rollen (Leser) nur mit Modul Controlling + Auswertungsrecht.

import type { UserRole } from '@/lib/auth/roles'

/** Betriebsleiter: Super-Admin, Betriebs-Manager, Mitarbeiter */
export const PFLICHTMELDUNG_ROLLEN: readonly UserRole[] = ['system_admin', 'tenant_admin', 'winzer']

/** Verwaltung (wie canAdmin): Super-Admin und Betriebs-Manager – z. B. Änderungsprotokoll */
export const VERWALTUNG_ROLLEN: readonly UserRole[] = ['system_admin', 'tenant_admin']

export function istPflichtmeldungsRolle(role: UserRole | null | undefined): boolean {
  return !!role && PFLICHTMELDUNG_ROLLEN.includes(role)
}

export function istVerwaltungsRolle(role: UserRole | null | undefined): boolean {
  return !!role && VERWALTUNG_ROLLEN.includes(role)
}
