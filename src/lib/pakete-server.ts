// Server-seitige Helfer zum Paketmodell (Benutzerlimit, Modul-Sync).
// Gegenstück zu lib/pakete.ts (das bewusst client-tauglich bleibt).

import type { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { PAKETE, MODULE_OHNE_PAKET, paketAusPlan, type PaketKey } from '@/lib/pakete'
import { AktionsFehler } from '@/lib/fehler'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type BenutzerlimitStatus = {
  /** aktive Mitglieder des Betriebs (ohne Plattform-Admins) */
  anzahl: number
  /** null = unbegrenzt */
  limit: number | null
  /** darf noch ein Benutzer eingeladen werden? */
  erlaubt: boolean
  /** KAN-254: Limit nicht prüfbar (Datenbankfehler) – dann nie erlaubt */
  fehler?: string
}

/**
 * Zählt die Benutzer eines Betriebs gegen tenants.max_benutzer (Migration 194).
 * system_admin-Mitgliedschaften (Plattformbetreiber, z.B. beim Anlegen eines
 * Mandanten automatisch dabei) zählen nicht mit - der Kunde soll nur seine
 * eigenen Leute im Limit haben. Deaktivierte Mitglieder zählen ebenfalls
 * nicht. Betriebe ohne Stripe-Abo (max_benutzer NULL, z.B. Sandbox oder
 * manuell betreute Kunden) sind unbegrenzt.
 */
export async function pruefeBenutzerlimit(admin: AdminClient, tenantId: string): Promise<BenutzerlimitStatus> {
  const [{ data: tenant, error: tenantErr }, { count, error: countErr }] = await Promise.all([
    (admin.from('tenants') as any).select('max_benutzer').eq('id', tenantId).maybeSingle(),
    (admin.from('tenant_memberships') as any)
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .neq('role', 'system_admin')
      .eq('aktiv', true),
  ])
  // KAN-254: ein Lesefehler hieß sonst „max_benutzer NULL = unbegrenzt“ bzw. „0 Benutzer“ – das Limit wäre ausgehebelt
  const ladeFehler = tenantErr ?? countErr
  if (ladeFehler) return { anzahl: 0, limit: null, erlaubt: false, fehler: `Benutzerlimit konnte nicht geprüft werden: ${(ladeFehler as R).message}` }
  const limit = ((tenant as R | null)?.max_benutzer ?? null) as number | null
  const anzahl = count ?? 0
  return { anzahl, limit, erlaubt: limit === null || anzahl < limit }
}

export function benutzerlimitFehler(s: BenutzerlimitStatus): string {
  if (s.fehler) return s.fehler
  return `Benutzerlimit erreicht: Ihr Paket umfasst ${s.limit} Benutzer (${s.anzahl} aktiv). Für weitere Benutzer bitte das Paket unter „Abo" erweitern.`
}

/**
 * Schreibt die Paket-Vorgaben (Modul-Flags + Benutzerlimit) für einen
 * Mandanten - vom Stripe-Webhook bei jedem Subscription-Event aufgerufen,
 * außerdem manuell aus Administration → Mandanten ("Paket-Vorgaben anwenden").
 * paket = null (kein Abo / gekündigt) schaltet alles Paketgesteuerte ab.
 */
export async function wendePaketAn(admin: AdminClient, tenantId: string, paket: PaketKey | null): Promise<string | null> {
  const modulFlags = paket ? PAKETE[paket].module : MODULE_OHNE_PAKET
  const maxBenutzer = paket ? PAKETE[paket].maxBenutzer : null
  const { error: e1 } = await (admin.from('tenant_einstellungen') as any)
    .upsert({ tenant_id: tenantId, ...modulFlags }, { onConflict: 'tenant_id' })
  if (e1) return `Modul-Sync fehlgeschlagen: ${(e1 as R).message}`
  const { error: e2 } = await (admin.from('tenants') as any)
    .update({ max_benutzer: maxBenutzer }).eq('id', tenantId)
  if (e2) return `Benutzerlimit konnte nicht gesetzt werden: ${(e2 as R).message}`
  return null
}

/** Paket eines Mandanten aus tenants.stripe_plan (inkl. Alt-Slugs). */
export async function ladePaket(admin: AdminClient, tenantId: string): Promise<PaketKey | null> {
  const { data, error } = await (admin.from('tenants') as any).select('stripe_plan').eq('id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(`Paket konnte nicht geladen werden: ${(error as R).message}`)
  return paketAusPlan((data as R | null)?.stripe_plan)
}
