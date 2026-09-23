import { notFound, redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// Alte Adresse /newsletter (bis 23.9.2026 fest auf einen Betrieb verdrahtet):
// leitet auf /newsletter/<kurzname> des bisherigen Betriebs (NEWSLETTER_TENANT_ID) weiter.
export const dynamic = 'force-dynamic'

export default async function NewsletterAlt() {
  const tenantId = process.env.NEWSLETTER_TENANT_ID
  if (!tenantId) notFound()
  const admin = createSupabaseAdminClient()
  const { data } = await (admin.from('tenant_einstellungen') as any)
    .select('newsletter_kurzname').eq('tenant_id', tenantId).maybeSingle()
  const kurzname = (data as { newsletter_kurzname: string | null } | null)?.newsletter_kurzname
  if (!kurzname) notFound()
  redirect(`/newsletter/${kurzname}`)
}
