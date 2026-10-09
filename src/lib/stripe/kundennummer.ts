import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/client'

// Kundennummer (Migration 209) als Metadaten am Stripe-Kunden hinterlegen, damit
// Rechnungen/Support in Stripe der software:112-Kundennummer zuordenbar sind.
// Idempotent, fehlertolerant (nur Protokoll) - wird nach Anlage des Stripe-
// Kunden und nach dem Speichern der Betriebsadresse (PLZ → Nummernvergabe)
// aufgerufen.
export async function stripeKundennummerSync(tenantId: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient()
    const { data, error } = await (admin.from('tenants') as any)
      .select('kundennummer, stripe_customer_id, name').eq('id', tenantId).maybeSingle()
    if (error) throw new Error(error.message)   // landet unten im Protokoll (fehlertolerant)
    const t = data as { kundennummer: string | null; stripe_customer_id: string | null; name: string } | null
    if (!t?.kundennummer || !t.stripe_customer_id) return
    await getStripe().customers.update(t.stripe_customer_id, {
      metadata: { tenant_id: tenantId, kundennummer: t.kundennummer },
      description: `${t.name} · ${t.kundennummer}`,
    })
  } catch (e) {
    console.error('[stripe] Kundennummer-Sync fehlgeschlagen:', e)
  }
}
