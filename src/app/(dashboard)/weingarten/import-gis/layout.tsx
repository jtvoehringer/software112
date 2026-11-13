import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „rieden“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichRiedenLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('rieden')
  return <>{children}</>
}
