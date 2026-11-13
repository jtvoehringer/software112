import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „ea“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichEaLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('ea')
  return <>{children}</>
}
