import { NextRequest, NextResponse } from 'next/server'
import { geheimLesen } from '@/lib/email/geheimnis'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'
import { sumupWebhookUrl } from '@/lib/sumup/webhook'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'

// POST /api/sumup/checkout
// Erstellt einen SumUp Checkout für einen Verkaufsposten.
// Body: { verkaufsposten_id, betrag, beschreibung? }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
  }
  const tenantId = membership.tenantId
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  // KAN-245: wie RLS (modul_insert auf sumup_checkouts = Warenwirtschaft) – vor dem API-Schlüssel und vor SumUp
  if (!canWrite(membership, 'warenwirtschaft')) {
    return NextResponse.json({ error: 'Keine Berechtigung für Kartenzahlungen – dafür ist die Freigabe Warenwirtschaft nötig.' }, { status: 403 })
  }

  // SumUp-Konfiguration laden – KAN-135: API-Key nur per Service-Role (Benutzer haben
  // keinen SELECT darauf); Mitgliedschaft ist geprüft, Zeile über tenant_id eingeschränkt
  const { data: einst, error: einstErr } = await (createSupabaseAdminClient().from('tenant_einstellungen') as any)
    .select('modul_sumup, sumup_api_key, sumup_merchant_code')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (einstErr) return NextResponse.json({ error: `SumUp-Einstellungen konnten nicht geladen werden: ${einstErr.message}` }, { status: 500 })

  if (!einst?.modul_sumup) {
    return NextResponse.json({ error: 'SumUp-Modul nicht aktiviert' }, { status: 403 })
  }
  if (!einst?.sumup_api_key) {
    return NextResponse.json({ error: 'SumUp API-Key nicht konfiguriert' }, { status: 400 })
  }

  const body: R = await req.json()
  const { verkaufsposten_id, betrag, beschreibung } = body

  if (!betrag || betrag <= 0) {
    return NextResponse.json({ error: 'Ungültiger Betrag' }, { status: 400 })
  }

  // Lokalen Checkout-Eintrag anlegen
  const checkoutRef = `S112-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`

  const { data: localCheckout, error: localErr } = await (supabase.from('sumup_checkouts') as any)
    .insert({
      tenant_id:         tenantId,
      verkaufsposten_id: verkaufsposten_id || null,
      betrag:            betrag,
      beschreibung:      beschreibung ?? 'Weinverkauf',
      status:            'PENDING',
    })
    .select('id')
    .single()

  if (localErr) {
    return NextResponse.json({ error: (localErr as R).message }, { status: 500 })
  }

  // SumUp Checkout API aufrufen
  // return_url = Webhook-Adresse (SumUp meldet dorthin Statusänderungen, signiert je Checkout,
  // siehe lib/sumup/webhook.ts); redirect_url = Rücksprung in die App nach der Zahlung
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at'
  const sumupPayload = {
    checkout_reference: checkoutRef,
    amount:             betrag,
    currency:           'EUR',
    merchant_code:      einst.sumup_merchant_code,
    description:        beschreibung ?? 'Weinverkauf',
    return_url:         sumupWebhookUrl(baseUrl, tenantId, (localCheckout as R).id),
    redirect_url:       `${baseUrl.replace(/\/$/, '')}/weinhandel/verkauf`,
  }

  let sumupCheckoutId: string | null = null
  let sumupCheckoutUrl: string | null = null

  try {
    const sumupRes = await fetch('https://api.sumup.com/v0.1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${geheimLesen(einst.sumup_api_key)}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(sumupPayload),
    })

    if (sumupRes.ok) {
      const sumupData: R = await sumupRes.json()
      sumupCheckoutId  = sumupData.id ?? null
      sumupCheckoutUrl = sumupData.hosted_checkout_url ?? null

      // SumUp Checkout-ID in lokaler DB speichern
      { const { error: e } = await (supabase.from('sumup_checkouts') as any)
        .update({ sumup_checkout_id: checkoutRef })   // aenderung-ohne-pruefung: Zeile eben angelegt, Fehler wird protokolliert (Checkout läuft schon)
        .eq('id', (localCheckout as R).id)
        .eq('tenant_id', tenantId)
        if (e) void ereignisMelden({ art: 'db', quelle: 'checkout/sumup_checkouts', meldung: e.message }) }
    } else {
      const errData: R = await sumupRes.json().catch(() => ({}))
      console.error('[SumUp Checkout] API-Fehler:', errData)
      // Trotzdem lokal-Checkout zurückgeben; Zahlung kann manuell gebucht werden
    }
  } catch (err) {
    console.error('[SumUp Checkout] Netzwerkfehler:', err)
  }

  return NextResponse.json({
    checkout_id:      (localCheckout as R).id,
    sumup_checkout_id: sumupCheckoutId,
    checkout_url:     sumupCheckoutUrl,
    betrag,
    status:           'PENDING',
  })
}

// GET /api/sumup/checkout?id=… – Status eines Checkouts abfragen
export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
  }
  const tenantId = membership.tenantId

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id fehlt' }, { status: 400 })

  const { data, error } = await (supabase.from('sumup_checkouts') as any)
    .select('*, sumup_transaktionen(status, betrag, kartennetz, letzten_4_ziffern)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: `Checkout konnte nicht geladen werden: ${error.message}` }, { status: 500 })

  if (!data) return NextResponse.json({ error: 'Checkout nicht gefunden' }, { status: 404 })

  return NextResponse.json(data)
}
