'use server'

// ── Self-Service-Signup: neuer Betrieb + Admin-User + Stripe-Checkout ────────
// Rückmeldung 31.8.2026 ("Self-Service-Signup ... voller öffentlicher Signup
// für Ziel 200 Mandanten"): öffentlich erreichbar (kein Login nötig), legt
// Mandant + Betriebsleiter-Konto + Stripe-Customer an und schickt direkt in
// den Stripe-Checkout (Karte + 14 Tage Testphase, siehe TRIAL_TAGE). Der
// Mandant startet mit stripe_status='incomplete' (bereits über
// STRIPE_BLOCKED_STATUSES gesperrt) - bricht der Checkout ab, bleibt der
// Betrieb gesperrt, aber nutzbar-genug-um-sich-einzuloggen (siehe /abo ->
// "Jetzt Zahlungsdaten hinterlegen", abo/actions.ts). Erst das Webhook-Event
// customer.subscription.created (nach erfolgreichem Checkout) setzt
// stripe_status auf 'trialing' und schaltet frei.

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setActiveTenantCookie } from '@/lib/auth/activeTenant'
import { getStripe, TRIAL_TAGE } from '@/lib/stripe/client'
import { istPaketKey, paketPriceId, PAKETE } from '@/lib/pakete'
import { stripeKundennummerSync } from '@/lib/stripe/kundennummer'
import { AktionsFehler } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
type Ergebnis = { ok: true; url: string } | { ok: false; fehler: string }

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function registrierenAction(formData: FormData): Promise<Ergebnis> {
  const betrieb  = ((formData.get('betrieb')  as string) || '').trim()
  const name     = ((formData.get('name')     as string) || '').trim()
  const email    = ((formData.get('email')    as string) || '').trim().toLowerCase()
  const passwort = (formData.get('passwort') as string) || ''
  // Paketmodell (2.9.2026): der Client schickt nur den Paket-Schlüssel, die
  // Stripe-Preis-ID wird serverseitig aufgelöst (lib/pakete.ts) - so kann
  // niemand eine fremde/alte Preis-ID unterschieben.
  const paket    = ((formData.get('paket')    as string) || '').trim()

  if (!betrieb)  return { ok: false, fehler: 'Bitte den Namen Ihres Betriebs angeben.' }
  if (!name)     return { ok: false, fehler: 'Bitte Ihren Namen angeben.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, fehler: 'Bitte eine gültige E-Mail-Adresse angeben.' }
  if (passwort.length < 8) return { ok: false, fehler: 'Das Passwort muss mindestens 8 Zeichen haben.' }
  if (!istPaketKey(paket)) return { ok: false, fehler: 'Bitte ein Paket auswählen.' }
  const priceId = paketPriceId(paket)
  if (!priceId)  return { ok: false, fehler: `Für das Paket ${PAKETE[paket].label} ist noch kein Stripe-Preis hinterlegt. Bitte den Support kontaktieren.` }

  const admin = createSupabaseAdminClient()

  // Duplikat-Check per E-Mail (gleiche Methode wie inviteUserToTenant in
  // admin/mandanten/[id]/actions.ts - Supabase Auth hat keine direkte
  // "getUserByEmail"-Admin-Route).
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (userList.users.some(u => u.email?.toLowerCase() === email)) {
    return { ok: false, fehler: 'Für diese E-Mail-Adresse existiert bereits ein Konto. Bitte einloggen oder das Passwort zurücksetzen.' }
  }

  const baseSlug = slugify(betrieb)
  const slug = `${baseSlug || 'betrieb'}-${Date.now().toString(36)}`

  const { data: tenant, error: tenantError } = await (admin.from('tenants') as R)
    .insert({ name: betrieb, slug, stripe_status: 'incomplete' })
    .select('id')
    .single()
  if (tenantError) return { ok: false, fehler: (tenantError as R).message }
  const tenantId = (tenant as R).id as string

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email, password: passwort, email_confirm: true,
    user_metadata: { display_name: name },
  })
  if (userError || !userData.user) {
    { const { error: e } = await (admin.from('tenants') as R).delete().eq('id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (tenants): ${e.message}`) }
    return { ok: false, fehler: userError?.message ?? 'Konto konnte nicht angelegt werden.' }
  }
  const userId = userData.user.id

  const { error: memberError } = await (admin.from('tenant_memberships') as R)
    .insert({ tenant_id: tenantId, user_id: userId, role: 'tenant_admin', aktiv: true })
  if (memberError) {
    await admin.auth.admin.deleteUser(userId)
    { const { error: e } = await (admin.from('tenants') as R).delete().eq('id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (tenants): ${e.message}`) }
    return { ok: false, fehler: (memberError as R).message }
  }

  await (admin.from('profiles') as R)
    .upsert({ id: userId, full_name: name, updated_at: new Date().toISOString() }, { onConflict: 'id' })

  // Ab hier existiert ein voll funktionsfähiges (aber gesperrtes) Konto -
  // gleich einloggen, damit Stripe nachher wieder in eine gültige Session
  // zurückleitet, egal ob Checkout gelingt oder abgebrochen wird.
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signInWithPassword({ email, password: passwort })
  await setActiveTenantCookie(tenantId)

  let customer: { id: string }
  try {
    customer = await getStripe().customers.create({ name: betrieb, email, metadata: { tenant_id: tenantId } })
  } catch (err) {
    return { ok: false, fehler: `Konto wurde angelegt, Stripe-Fehler: ${(err as Error).message}. Sie können sich einloggen und die Zahlungsdaten unter /abo nachtragen.` }
  }
  { const { error: e } = await (admin.from('tenants') as R).update({ stripe_customer_id: customer.id }).eq('id', tenantId)
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (tenants): ${e.message}`) }
  await stripeKundennummerSync(tenantId)

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at'
  try {
    const session = await getStripe().checkout.sessions.create({
      customer:    customer.id,
      mode:        'subscription',
      line_items:  [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/signup/willkommen`,
      cancel_url:  `${baseUrl}/abo`,
      metadata:    { tenant_id: tenantId },
      subscription_data: { trial_period_days: TRIAL_TAGE, metadata: { tenant_id: tenantId } },
    })
    if (!session.url) return { ok: false, fehler: 'Stripe-Checkout konnte nicht gestartet werden. Sie können sich einloggen und es unter /abo erneut versuchen.' }
    return { ok: true, url: session.url }
  } catch (err) {
    return { ok: false, fehler: `Stripe-Fehler: ${(err as Error).message}. Sie können sich einloggen und es unter /abo erneut versuchen.` }
  }
}
