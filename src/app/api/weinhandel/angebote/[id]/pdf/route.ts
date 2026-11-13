// GET /api/weinhandel/angebote/[id]/pdf – Angebot als PDF (KAN-418 Teil 4).
// Nur lesend: jedes Mitglied des Betriebs, das das Angebot sehen darf (RLS), bekommt das PDF. Kein Versandvermerk.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { ladeAngebot } from '@/lib/auftrag/angebotLaden'
import { angebotDateiname } from '@/lib/auftrag/angebot'
import { renderAngebotPdf } from '@/lib/pdf/angebotPdf'
import { fehlerText } from '@/lib/fehler'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'verkauf')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  if (!membership?.tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })

  const geladen = await ladeAngebot(supabase, membership.tenantId, id)
  if (!geladen.ok) return NextResponse.json({ error: geladen.fehler }, { status: geladen.status })

  let pdf: Buffer
  try {
    pdf = await renderAngebotPdf(geladen.daten.pdf)
  } catch (err) {
    return NextResponse.json({ error: `PDF-Erzeugung fehlgeschlagen: ${fehlerText(err, 'unbekannter Fehler')}` }, { status: 500 })
  }
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${angebotDateiname(geladen.daten.nummer)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
