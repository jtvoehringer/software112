// GET /api/buchhaltung/belege/<id>/datei – Beleg öffnen (KAN-415)
//
// Leitet auf eine kurzlebige signierte Adresse der Datei im Bucket ea-belege weiter. Lesen darf jedes Mitglied des
// Betriebs (wie die Tabelle ea_belege); die Zeile wird über id UND Betrieb geladen. Keine Seiteneffekte.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { dbFehlerText } from '@/lib/fehler'
import { BELEG_BUCKET } from '@/lib/buchhaltung/belegAnhang'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Gültigkeit der signierten Adresse in Sekunden */
const GUELTIG_S = 300

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Ungültiger Beleg' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'ea')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('ea_belege') as any)
    .select('storage_pfad').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (error) return NextResponse.json({ error: dbFehlerText(error, 'Beleg konnte nicht geladen werden') }, { status: 500 })
  const pfad = (data as R | null)?.storage_pfad as string | undefined
  if (!pfad) return NextResponse.json({ error: 'Beleg nicht gefunden' }, { status: 404 })

  const { data: signiert, error: sErr } = await supabase.storage.from(BELEG_BUCKET).createSignedUrl(pfad, GUELTIG_S)
  if (sErr || !signiert?.signedUrl) {
    return NextResponse.json({ error: `Die Datei konnte nicht geöffnet werden${sErr ? `: ${dbFehlerText(sErr)}` : ''}.` }, { status: 500 })
  }
  return NextResponse.redirect(signiert.signedUrl, { status: 302, headers: { 'Cache-Control': 'no-store' } })
}
