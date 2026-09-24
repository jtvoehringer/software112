import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'

export const dynamic = 'force-dynamic'

// GET /api/me/active-tenant
//
// Liefert die aktive Tenant-ID (und Rolle) des eingeloggten Users über die kanonische
// getCurrentMembership()-Logik (Cookie-validiert gegen echte, aktive Mitgliedschaften,
// mit Fallback auf die erste Mitgliedschaft). Existiert für CLIENT-Komponenten, die den
// aktiven Mandanten brauchen, aber getCurrentMembership() nicht direkt aufrufen können
// (das ist eine Server-only-Funktion, die den httpOnly Active-Tenant-Cookie liest) - vorher
// haben solche Client-Komponenten stattdessen eine eigene, ungefilterte
// .from('tenant_memberships').limit(1).maybeSingle()-Abfrage gemacht, die bei
// Mehrfach-Mitgliedschaft (z.B. konventionell/biodynamisch/handel unter einem Account)
// eine BELIEBIGE statt der aktiv gewählten Mitgliedschaft treffen konnte - siehe
// check-tenant-isolation.js ARBITRARY_MEMBERSHIP_LOOKUP.
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  return NextResponse.json({ tenantId: membership?.tenantId ?? null, role: membership?.role ?? null })
}
