import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „verwaltung“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichVerwaltungLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('verwaltung')
  return <>{children}</>
}
