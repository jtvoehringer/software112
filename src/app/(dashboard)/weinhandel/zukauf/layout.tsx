import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „lager“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichLagerLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('lager')
  return <>{children}</>
}
