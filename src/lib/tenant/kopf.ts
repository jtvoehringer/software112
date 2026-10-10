import { unstable_cache, revalidateTag } from 'next/cache'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { MostgewichtEinheit } from '@/lib/wein/mostgewicht'
import { AktionsFehler } from '@/lib/fehler'

// Layout-Cache (Performance, 17.9.2026): Branding, Module und Abo-Status eines
// Betriebs werden bei JEDER Seitennavigation vom Dashboard-Layout gebraucht
// (Farben, Sidebar, Sperre). Statt zwei Abfragen je Seitenaufruf werden sie
// hier 60 s im Next-Data-Cache gehalten (Schlüssel = tenant_id, Tag
// `tenant-<id>`). Speichern der Einstellungen bzw. Stripe-Webhook rufen
// tenantKopfInvalidieren() - so ist eine Änderung ab der nächsten Anfrage
// sichtbar, und selbst eine vergessene Invalidierung heilt sich nach einer Minute.
//
// Innerhalb von unstable_cache dürfen keine cookies() gelesen werden, daher
// der Admin-Client (Service Role); der Zugriff ist auf die genannten Spalten
// beschränkt und der Aufrufer (Layout) hat die tenant_id bereits über die
// Mitgliedschaft geprüft.
//
// KAN-5 (25.09.2026): Seit dem Nur-Lesen-Modus hängen auch die Schreibsperre der Server
// Actions/API-Routen und der Browser-Wächter am Abo-Stand aus diesem Cache. Deshalb:
//  - Ein Ladefehler wird NICHT gecacht (die Funktion im Cache wirft, ladeTenantKopf() liefert
//    dann einen ungecachten Stand mit ladefehler: true) – sonst gälte ein DB-Aussetzer 60 s lang
//    als „kein Abo-Status, nicht gesperrt“.
//  - tenantKopfInvalidieren() lässt den Eintrag sofort ablaufen ({ expire: 0 }) statt
//    stale-while-revalidate ('max', dort bekäme die nächste Anfrage noch den alten Stand).
//  - Vor jeder Ablehnung lädt aboStandErmitteln() (lib/abo/regeln.ts) über
//    ladeTenantKopfFrisch() einmal ungecacht nach.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type TenantKopf = {
  einstellungen: R | null
  tenant: { name: string | null; stripe_status: string | null; stripe_trial_ends_at: string | null; stripe_subscription_id: string | null } | null
  /** Laden fehlgeschlagen – Stand ist leer und wurde nicht gecacht */
  ladefehler?: boolean
}

// mostgewicht_einheit (KAN-128 Teil A, S3): bevorzugte Einheit °KMW/°Oe, Spalte aus Migration A.
// ACHTUNG Reihenfolge: erst Migration A einspielen, dann diesen Stand deployen – solange die Spalte
// fehlt, lehnt PostgREST die ganze Abfrage ab (42703), ladeTenantKopf() liefert dann bei jeder
// Anfrage den leeren, ungecachten Stand (Standard-Branding, Module aus, Abo-Sperre FREI).
export const KOPF_SPALTEN = 'anzeigename, logo_url, primary_color, secondary_color, modul_newsletter, modul_ea, modul_sumup, modul_export, modul_controlling, buchhaltungsart, session_timeout_minuten, assistent_aktiv, mostgewicht_einheit'

const LEER: TenantKopf = { einstellungen: null, tenant: null, ladefehler: true }

/** Wirft bei einem Datenbankfehler (damit unstable_cache ihn nicht speichert) */
async function ladeKopfDirekt(tenantId: string): Promise<TenantKopf> {
  const admin = createSupabaseAdminClient()
  const [{ data: e, error: ee }, { data: t, error: te }] = await Promise.all([
    (admin.from('tenant_einstellungen') as any).select(KOPF_SPALTEN).eq('tenant_id', tenantId).maybeSingle(),
    (admin.from('tenants') as any).select('name, stripe_status, stripe_trial_ends_at, stripe_subscription_id').eq('id', tenantId).maybeSingle(),
  ])
  if (ee || te) throw new AktionsFehler(`Tenant-Kopf ${tenantId} nicht ladbar: ${(ee ?? te)?.message ?? 'unbekannter Fehler'}`)
  return { einstellungen: (e as R | null) ?? null, tenant: (t as R | null) as TenantKopf['tenant'] }
}

/** Branding, Module und Abo-Stand aus dem 60-s-Cache – wirft nie (bei Fehler: ladefehler, ungecacht) */
export async function ladeTenantKopf(tenantId: string): Promise<TenantKopf> {
  try {
    return await unstable_cache(() => ladeKopfDirekt(tenantId), ['tenant-kopf', tenantId], {
      revalidate: 60,
      tags: [`tenant-${tenantId}`],
    })()
  } catch (err) {
    console.error('[tenant-kopf]', (err as Error).message)
    return LEER
  }
}

/** Derselbe Stand ohne Cache – für die Gegenprobe vor einer Abo-Sperre (lib/abo/regeln.ts: aboStandErmitteln) */
export async function ladeTenantKopfFrisch(tenantId: string): Promise<TenantKopf> {
  try {
    return await ladeKopfDirekt(tenantId)
  } catch (err) {
    console.error('[tenant-kopf, ungecacht]', (err as Error).message)
    return LEER
  }
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

/** Bevorzugte Mostgewicht-Einheit (KAN-128): 'oechsle' nur, wenn so eingestellt – sonst 'kmw' */
export function mostgewichtEinheitAus(kopf: TenantKopf): MostgewichtEinheit {
  return kopf.einstellungen?.mostgewicht_einheit === 'oechsle' ? 'oechsle' : 'kmw'
}

/** Bevorzugte Mostgewicht-Einheit für Server-Komponenten und Actions (aus dem 60-s-Cache) */
export async function ladeMostgewichtEinheit(tenantId: string): Promise<MostgewichtEinheit> {
  return mostgewichtEinheitAus(await ladeTenantKopf(tenantId))
}

/**
 * Nach Änderungen an tenant_einstellungen/tenants (Branding, Module, Abo) aufrufen. Läuft sofort
 * ab ({ expire: 0 }): die nächste Anfrage lädt blockierend neu, statt noch den alten Stand zu
 * bekommen – wichtig für Sperren und Entsperren des Nur-Lesen-Modus (KAN-5).
 */
export function tenantKopfInvalidieren(tenantId: string | null | undefined) {
  if (!tenantId) return
  try { revalidateTag(`tenant-${tenantId}`, { expire: 0 }) } catch { /* außerhalb eines Requests */ }
}
