import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „betriebsmittel“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichBetriebsmittelLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('betriebsmittel')
  return <>{children}</>
}
