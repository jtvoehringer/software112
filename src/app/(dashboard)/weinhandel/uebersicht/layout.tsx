import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „verkauf“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichVerkaufLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('verkauf')
  return <>{children}</>
}
