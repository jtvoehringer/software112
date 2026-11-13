import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „betrieb“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichBetriebLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('betrieb')
  return <>{children}</>
}
