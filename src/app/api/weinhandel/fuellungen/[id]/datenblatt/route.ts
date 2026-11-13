// KAN-220 (07.10.2026): Produktdatenblatt einer Füllung als PDF (GET, ohne Seiteneffekte) – für jedes Mitglied des
// Betriebs; Daten über den Benutzer-Client (RLS) mit .eq('tenant_id', …), Bilder über signierte Adressen.
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { ladeDatenblatt } from '@/lib/handel/datenblattLaden'
import { renderDatenblattPdf } from '@/lib/pdf/datenblattPdf'
import { datenblattDateiname } from '@/lib/handel/datenblatt'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'lager')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  if (!membership?.tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ fehler: 'Ungültige Füllung' }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const daten = await ladeDatenblatt(supabase, membership.tenantId, id)
  if (!daten) return NextResponse.json({ fehler: 'Füllung nicht gefunden' }, { status: 404 })

  const stand = new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Vienna' })
  let pdf: Buffer
  try {
    pdf = await renderDatenblattPdf(daten, stand)
  } catch {
    // Bild bzw. Logo nicht ladbar (z. B. abgelaufene Adresse, beschädigte Datei) – Datenblatt ohne Bilder statt Fehler
    pdf = await renderDatenblattPdf({ ...daten, bilder: {}, betrieb: { ...daten.betrieb, logoUrl: null } }, stand)
  }
  const name = datenblattDateiname(daten.name, daten.jahrgang)
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
