// UAT 23.10.2026: Reiter Füllung · E-Label · Rückverfolgung über allen Seiten einer Füllung
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import FuellungReiter from '@/components/handel/FuellungReiter'

export default async function FuellungLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const membership = await getCurrentMembership()
  // „Füllung bearbeiten“ verlangt das Schreibrecht der Warenwirtschaft (sonst Umleitung) – Leser sehen den Reiter nicht
  const bearbeiten = !!membership && canWrite(membership, 'warenwirtschaft')
  return (
    <>
      <FuellungReiter id={id} bearbeiten={bearbeiten} />
      {children}
    </>
  )
}
