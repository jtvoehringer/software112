import { NextRequest, NextResponse } from 'next/server'
import { geheimLesen } from '@/lib/email/geheimnis'
import { pruefeSumupWebhook } from '@/lib/sumup/webhook'
import { createClient } from '@supabase/supabase-js'

// SumUp Webhook: POST /api/sumup/webhook?tenant_id=…&checkout=…&sig=…
// SumUp ruft die return_url des Checkouts auf, sobald sich dessen Status ändert.
// Body laut SumUp-Doku nur { "event_type": "CHECKOUT_STATUS_CHANGED", "id": "<SumUp-Checkout-ID>" },
// ohne Signatur und ohne Webhook-Secret. Absicherung daher (Details in lib/sumup/webhook.ts):
//  1. sig in der URL – HMAC über tenant_id + lokale Checkout-ID, erzeugt von /api/sumup/checkout.
//     Fehlt sie oder passt sie nicht: 401, bevor irgendetwas gelesen oder geschrieben wird.
//  2. Status und Transaktionen kommen nicht aus dem Body, sondern aus GET /v0.1/checkouts/{id}
//     mit dem API-Key des Betriebs; deren checkout_reference muss zum lokalen Checkout passen.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// SumUp-Checkout-Status → sumup_checkout_status (PENDING bleibt unverändert)
const CHECKOUT_STATUS: Record<string, string> = { PAID: 'PAID', FAILED: 'FAILED', EXPIRED: 'CANCELLED' }

// zwei-faktor-ausnahme: SumUp-Webhook ohne Benutzersitzung (Server zu Server) – nur mit gültiger HMAC-Signatur in der URL (sig, je Checkout), Status wird bei der SumUp-API gegengeprüft
// schreibsperre-ausnahme: SumUp-Webhook ohne Benutzersitzung – bestätigt eine bereits am Terminal erfolgte Zahlung
export async function POST(req: NextRequest) {
  const geprueft = pruefeSumupWebhook(req.nextUrl.searchParams)
  if (!geprueft) {
    return NextResponse.json({ error: 'Ungültige Signatur' }, { status: 401 })
  }
  const { tenantId, checkoutId } = geprueft

  let payload: R
  try {
    payload = JSON.parse(await req.text())
  } catch {
    return NextResponse.json({ error: 'Ungültiger JSON-Body' }, { status: 400 })
  }

  // Andere bzw. neue Event-Typen laut SumUp stillschweigend ignorieren
  if (payload?.event_type !== 'CHECKOUT_STATUS_CHANGED' || typeof payload.id !== 'string' || !payload.id) {
    return NextResponse.json({ received: true })
  }

  // Mandant + SumUp-Konfiguration laden
  const { data: einst } = await (supabaseAdmin.from('tenant_einstellungen') as any)
    .select('modul_sumup, sumup_api_key')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!einst?.modul_sumup || !einst.sumup_api_key) {
    return NextResponse.json({ error: 'SumUp nicht aktiviert' }, { status: 403 })
  }

  const { data: checkout } = await (supabaseAdmin.from('sumup_checkouts') as any)
    .select('id, sumup_checkout_id')
    .eq('id', checkoutId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!checkout?.sumup_checkout_id) {
    return NextResponse.json({ error: 'Checkout nicht gefunden' }, { status: 404 })
  }

  // Ereignis bei SumUp bestätigen – nur diese Antwort zählt, nicht der Webhook-Body
  let sumup: R
  try {
    const res = await fetch(`https://api.sumup.com/v0.1/checkouts/${encodeURIComponent(payload.id)}`, {
      headers: { 'Authorization': `Bearer ${geheimLesen(einst.sumup_api_key)}` },
    })
    if (!res.ok) {
      console.error('[SumUp Webhook] Checkout-Abfrage fehlgeschlagen:', res.status)
      return NextResponse.json({ error: 'SumUp-Abfrage fehlgeschlagen' }, { status: 502 })  // SumUp wiederholt
    }
    sumup = await res.json()
  } catch (err) {
    console.error('[SumUp Webhook] Netzwerkfehler:', err)
    return NextResponse.json({ error: 'SumUp nicht erreichbar' }, { status: 502 })
  }

  if (sumup.checkout_reference !== checkout.sumup_checkout_id) {
    return NextResponse.json({ error: 'Checkout passt nicht zur Webhook-URL' }, { status: 409 })
  }

  // Transaktionen eintragen (service_role umgeht RLS)
  const transaktionen: R[] = (Array.isArray(sumup.transactions) ? sumup.transactions : []).filter((tx: R) => tx?.id)
  if (transaktionen.length > 0) {
    const { error } = await (supabaseAdmin.from('sumup_transaktionen') as any).upsert(
      transaktionen.map(tx => ({
        tenant_id:            tenantId,
        checkout_id:          checkoutId,
        sumup_transaction_id: tx.id,
        sumup_checkout_ref:   sumup.checkout_reference,
        betrag:               tx.amount ?? 0,
        waehrung:             tx.currency ?? sumup.currency ?? 'EUR',
        status:               tx.status ?? 'PENDING',
        zahlungsart:          tx.payment_type ?? null,
        kartennetz:           tx.card?.type ?? null,
        kartentyp:            tx.card?.category ?? null,
        letzten_4_ziffern:    tx.card?.last_4_digits ?? null,
        bezahlt_am:           tx.timestamp ?? null,
        raw_payload:          tx,
      })),
      { onConflict: 'sumup_transaction_id', ignoreDuplicates: false },
    )

    if (error) {
      console.error('[SumUp Webhook] DB-Fehler:', error)
      return NextResponse.json({ error: 'DB-Fehler' }, { status: 500 })
    }
  }

  // Checkout-Status aktualisieren
  const status = CHECKOUT_STATUS[sumup.status]
  if (status) {
    const { error } = await (supabaseAdmin.from('sumup_checkouts') as any)
      .update({ status, aktualisiert_am: new Date().toISOString() })
      .eq('id', checkoutId)
      .eq('tenant_id', tenantId)

    if (error) {
      console.error('[SumUp Webhook] DB-Fehler:', error)
      return NextResponse.json({ error: 'DB-Fehler' }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}

// HEAD/GET für Webhook-Verifikation (SumUp pingt manchmal GET)
// zwei-faktor-ausnahme: Erreichbarkeits-Ping für SumUp, liefert nur { status: 'ok' } und keine Daten
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
