import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „massnahmen“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichMassnahmenLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('massnahmen')
  return <>{children}</>
}
