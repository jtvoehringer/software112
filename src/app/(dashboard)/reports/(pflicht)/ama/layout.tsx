import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „lese“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichLeseLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('lese')
  return <>{children}</>
}
