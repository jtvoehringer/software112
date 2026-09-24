import 'server-only'
import { canSeeAuswertungen, canWrite, getCurrentMembership, type Membership } from '@/lib/auth/roles'
import { istPflichtmeldungsRolle, istVerwaltungsRolle } from '@/lib/auth/pflichtmeldung'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { ModulFlag } from '@/lib/auth/modul'
import type { Betriebsdaten, KatalogEintrag } from './typen'
import { KATALOG_LISTE } from './katalog'

// ── Zugriff auf Behördenmeldungen (server-only, 24.09.2026) ──────────────────
//
// Route-Handler durchlaufen keine layout.tsx-Guards – die CSV-Route prüft deshalb hier
// selbst Modul und Rolle; dieselbe Prüfung filtert die Übersichten (erlaubteMeldungen(),
// genutzt von uebersicht.ts). Login und – für Konten mit eingerichtetem Faktor – aal2
// sichert der Proxy; Abo-Sperre und 2FA-Einrichtungspflicht prüft die Route über
// lib/auth/sperren.ts (dieselbe Funktion wie das Dashboard-Layout).
// Rollenlisten aus lib/auth/pflichtmeldung.ts (eine Stelle für Guard, Navigation und Route).

export type ModulSchalter = Record<ModulFlag, boolean>

const MODUL_NAME: Record<ModulFlag, string> = {
  modul_ea: 'E&A-Rechnung',
  modul_sumup: 'SumUp-Kassa',
  modul_export: 'Weinexport',
  modul_controlling: 'Controlling',
}

/** Module, die für eine Meldung freigeschaltet sein müssen */
export function benoetigteModule(e: Pick<KatalogEintrag, 'zugriff' | 'modul'>): ModulFlag[] {
  const m: ModulFlag[] = []
  if (e.zugriff === 'auswertungen') m.push('modul_controlling')
  if (e.modul && !m.includes(e.modul)) m.push(e.modul)
  return m
}

/** null = erlaubt, sonst deutscher Grund (→ HTTP 403) */
export function zugriffsFehler(
  e: Pick<KatalogEintrag, 'zugriff' | 'modul' | 'schreibModul'>,
  membership: Membership,
  module: ModulSchalter,
): string | null {
  for (const flag of benoetigteModule(e)) {
    if (!module[flag]) return `Das Modul „${MODUL_NAME[flag]}“ ist für diesen Betrieb nicht freigeschaltet.`
  }
  switch (e.zugriff) {
    case 'mitglied':
      return null
    case 'betriebsleitung':
      // Pflichtmeldungen: Betriebsleiter immer; Leser wie bisher mit Controlling + Auswertungsrecht
      if (istPflichtmeldungsRolle(membership.role)) return null
      if (module.modul_controlling && canSeeAuswertungen(membership)) return null
      return 'Diese Meldung dürfen Super-Admins, Betriebs-Manager und Mitarbeiter exportieren – Leser nur mit Modul „Controlling“.'
    case 'auswertungen':
      return canSeeAuswertungen(membership) ? null : 'Für diese Auswertung fehlt das Recht „Controlling & Frag dein Weingut“.'
    case 'schreiben':
      return canWrite(membership, e.schreibModul) ? null : 'Für diesen Export fehlt das Bearbeitungsrecht.'
    case 'verwaltung':
      return istVerwaltungsRolle(membership.role) ? null : 'Diesen Export dürfen nur Betriebs-Manager und Super-Admins abrufen.'
  }
}

/** Betriebsdaten (Dateiname) und Modul-Schalter in einer Abfrage. Wirft bei Datenbankfehler. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function betriebUndModuleLaden(supabase: any, tenantId: string): Promise<{ betrieb: Betriebsdaten; module: ModulSchalter }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('tenant_einstellungen') as any)
    .select('betrieb_name, betrieb_betriebsnummer, modul_ea, modul_sumup, modul_export, modul_controlling')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`Betriebseinstellungen konnten nicht geladen werden: ${error.message}`)
  const d = (data ?? {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    betrieb: { name: text(d.betrieb_name), betriebsnummer: text(d.betrieb_betriebsnummer) },
    module: {
      modul_ea: d.modul_ea === true,
      modul_sumup: d.modul_sumup === true,
      modul_export: d.modul_export === true,
      modul_controlling: d.modul_controlling === true,
    },
  }
}

/** Katalog-Einträge, die die aktive Mitgliedschaft abrufen darf (für Übersichten in Server-Komponenten) */
export async function erlaubteMeldungen(): Promise<KatalogEintrag[]> {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return []
  if (KATALOG_LISTE.length === 0) return []
  const supabase = await createSupabaseServerClient()
  const { module } = await betriebUndModuleLaden(supabase, membership.tenantId)
  return KATALOG_LISTE.filter(e => zugriffsFehler(e, membership, module) === null)
}
