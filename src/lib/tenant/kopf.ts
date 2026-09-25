import { unstable_cache, revalidateTag } from 'next/cache'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// Layout-Cache (Performance, 17.9.2026): Branding, Module und Abo-Status eines
// Betriebs werden bei JEDER Seitennavigation vom Dashboard-Layout gebraucht
// (Farben, Sidebar, Sperre). Statt zwei Abfragen je Seitenaufruf werden sie
// hier 60 s im Next-Data-Cache gehalten (Schlüssel = tenant_id, Tag
// `tenant-<id>`). Speichern der Einstellungen bzw. Stripe-Webhook rufen
// tenantKopfInvalidieren() - so ist eine Änderung sofort sichtbar, und selbst
// eine vergessene Invalidierung heilt sich nach einer Minute.
//
// Innerhalb von unstable_cache dürfen keine cookies() gelesen werden, daher
// der Admin-Client (Service Role); der Zugriff ist auf die genannten Spalten
// beschränkt und der Aufrufer (Layout) hat die tenant_id bereits über die
// Mitgliedschaft geprüft.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type TenantKopf = {
  einstellungen: R | null
  tenant: { name: string | null; stripe_status: string | null; stripe_trial_ends_at: string | null } | null
}

export const KOPF_SPALTEN = 'anzeigename, logo_url, primary_color, secondary_color, modul_newsletter, modul_ea, modul_sumup, modul_export, modul_controlling, buchhaltungsart, session_timeout_minuten, assistent_aktiv'

async function ladeKopfDirekt(tenantId: string): Promise<TenantKopf> {
  const admin = createSupabaseAdminClient()
  const [{ data: e }, { data: t }] = await Promise.all([
    (admin.from('tenant_einstellungen') as any).select(KOPF_SPALTEN).eq('tenant_id', tenantId).maybeSingle(),
    (admin.from('tenants') as any).select('name, stripe_status, stripe_trial_ends_at').eq('id', tenantId).maybeSingle(),
  ])
  return { einstellungen: (e as R | null) ?? null, tenant: (t as R | null) as TenantKopf['tenant'] }
}

export function ladeTenantKopf(tenantId: string): Promise<TenantKopf> {
  return unstable_cache(() => ladeKopfDirekt(tenantId), ['tenant-kopf', tenantId], {
    revalidate: 60,
    tags: [`tenant-${tenantId}`],
  })()
}

/** Name des Betriebs für Hinweise (KAN-30): Anzeigename wie in der Kopfleiste, sonst der Mandantenname */
export function betriebsName(kopf: TenantKopf): string {
  const anzeige = kopf.einstellungen?.anzeigename
  return (typeof anzeige === 'string' && anzeige.trim()) || kopf.tenant?.name || 'Betrieb'
}

/** Mandantenname (tenants.name) – unterscheidet im Betriebs-Wächter Betriebe mit gleichem Anzeigenamen */
export function mandantName(kopf: TenantKopf): string {
  return kopf.tenant?.name?.trim() || ''
}

/** Nach Änderungen an tenant_einstellungen/tenants (Branding, Module, Abo) aufrufen. */
export function tenantKopfInvalidieren(tenantId: string | null | undefined) {
  if (!tenantId) return
  try { revalidateTag(`tenant-${tenantId}`, 'max') } catch { /* außerhalb eines Requests */ }
}
