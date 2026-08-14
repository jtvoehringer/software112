import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// SumUp Webhook: POST /api/sumup/webhook
// SumUp sendet hier Events wenn eine Kartenzahlung abgeschlossen wird.
// Authentifizierung: SumUp-Webhook-Secret im Header X-SumUp-Signature (HMAC-SHA256)
// Da Webhook-Secret pro Mandant unterschiedlich ist, identifizieren wir den Mandant
// über den query-param ?tenant_id=... (muss beim Webhook-Setup in SumUp angegeben werden)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── HMAC-SHA256 Signatur-Verifikation ─────────────────────────────────────────
async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    const expected = Buffer.from(sig).toString('hex')
    return expected === signature
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenant_id')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id fehlt' }, { status: 400 })
  }

  const rawBody = await req.text()

  // Mandant + SumUp-Konfiguration laden
  const { data: einst } = await (supabaseAdmin.from('tenant_einstellungen') as any)
    .select('modul_sumup, sumup_api_key, sumup_merchant_code')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!einst?.modul_sumup) {
    return NextResponse.json({ error: 'SumUp nicht aktiviert' }, { status: 403 })
  }

  // Signatur prüfen (optional: wenn kein Secret konfiguriert, akzeptieren wir trotzdem)
  const signature = req.headers.get('x-sumup-signature') ?? ''
  if (einst.sumup_api_key && signature) {
    const valid = await verifySignature(rawBody, signature, einst.sumup_api_key)
    if (!valid) {
      return NextResponse.json({ error: 'Ungültige Signatur' }, { status: 401 })
    }
  }

  let payload: R
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Ungültiger JSON-Body' }, { status: 400 })
  }

  // SumUp Event-Typen: payment.successful, payment.failed, checkout.completed
  const eventType = payload.event_type ?? payload.type ?? ''
  const tx        = payload.payload ?? payload

  if (!tx?.id) {
    // Unbekanntes Event – ignorieren
    return NextResponse.json({ received: true })
  }

  // Checkout-ID (+ dessen EIGENE tenant_id) auflösen (SumUp sendet checkout_reference).
  // Der query-param tenant_id kommt ungeprüft aus der URL (SumUp-Server, keine Session) –
  // für das spätere Update verwenden wir daher NICHT diesen Wert, sondern die tenant_id,
  // die tatsächlich am gefundenen sumup_checkouts-Datensatz hinterlegt ist.
  let checkoutId: string | null = null
  let checkoutTenantId: string | null = null
  const checkoutRef = tx.checkout_reference ?? tx.checkout_id ?? null
  if (checkoutRef) {
    const { data: checkout } = await (supabaseAdmin.from('sumup_checkouts') as any)
      .select('id, tenant_id')
      .eq('sumup_checkout_id', checkoutRef)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    checkoutId = checkout?.id ?? null
    checkoutTenantId = checkout?.tenant_id ?? null
  }

  // Transaktion eintragen (service_role umgeht RLS)
  const { error } = await (supabaseAdmin.from('sumup_transaktionen') as any).upsert({
    tenant_id:           tenantId,
    checkout_id:         checkoutId,
    sumup_transaction_id: tx.id,
    sumup_checkout_ref:  checkoutRef,
    betrag:              tx.amount ?? tx.net_amount ?? 0,
    waehrung:            tx.currency ?? 'EUR',
    status:              tx.status ?? (eventType.includes('success') ? 'SUCCESSFUL' : 'FAILED'),
    zahlungsart:         tx.payment_type ?? null,
    kartennetz:          tx.card?.type ?? null,
    kartentyp:           tx.card?.category ?? null,
    letzten_4_ziffern:   tx.card?.last_4_digits ?? null,
    bezahlt_am:          tx.timestamp ?? tx.date ?? null,
    raw_payload:         payload,
  }, { onConflict: 'sumup_transaction_id', ignoreDuplicates: false })

  if (error) {
    console.error('[SumUp Webhook] DB-Fehler:', error)
    return NextResponse.json({ error: 'DB-Fehler' }, { status: 500 })
  }

  // Checkout-Status aktualisieren
  if (checkoutId && checkoutTenantId) {
    const isSuccess = (tx.status ?? '').toUpperCase() === 'SUCCESSFUL' || eventType.includes('success')
    await (supabaseAdmin.from('sumup_checkouts') as any)
      .update({
        status:          isSuccess ? 'PAID' : 'FAILED',
        aktualisiert_am: new Date().toISOString(),
      })
      .eq('id', checkoutId)
      .eq('tenant_id', checkoutTenantId)
  }

  return NextResponse.json({ received: true })
}

// HEAD/GET für Webhook-Verifikation (SumUp pingt manchmal GET)
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
