// ── Rolle und Profil in einem Auswahlwert (KAN-457, 14.11.2026) ─────────────────────────────────────────────────
//
// Die Mandantenverwaltung hat keine Modulmatrix – dort wählt der Plattform-Admin Rolle und Profil in einer Liste:
// „Mitarbeiter“, „Mitarbeiter – Profil Vertrieb“, „Mitarbeiter – Profil Extern“. Der Wert ist 'winzer' bzw.
// 'winzer:<profil>'; ein Profil gibt es nur für Mitarbeiter. Isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – .ts-Endung für node:test (kein Bundler)
import { PROFILE, istProfil, type Profil } from './lesebereiche.ts'

export type RolleProfil = { role: string; profil: Profil | null }

/** 'winzer:vertrieb' → { role: 'winzer', profil: 'vertrieb' }; unbekanntes Profil oder Profil an anderer Rolle → null */
export function rolleProfilAus(wert: unknown): RolleProfil | null {
  if (typeof wert !== 'string' || !wert) return null
  const [role, profil, ...rest] = wert.split(':')
  if (rest.length > 0 || !role) return null
  if (profil === undefined) return { role, profil: null }
  if (role !== 'winzer' || !istProfil(profil)) return null
  return { role, profil }
}

export function rolleProfilWert(role: string, profil: unknown): string {
  return role === 'winzer' && istProfil(profil) ? `winzer:${profil}` : role
}

/** Schreibmodule eines Profils (wie der Trigger z_profil_module) */
export function profilSchreibmodule(profil: Profil): string[] {
  return [...PROFILE[profil].schreibmodule]
}

/** Zusätzliche Einträge der Rollen-Auswahl: je Profil einer, direkt nach „Mitarbeiter“ */
export const PROFIL_ROLLEN_WAHL: { value: string; label: string; hinweis: string }[] =
  (Object.keys(PROFILE) as Profil[]).map(p => ({ value: `winzer:${p}`, label: `Mitarbeiter – Profil ${PROFILE[p].label}`, hinweis: PROFILE[p].hinweis }))
