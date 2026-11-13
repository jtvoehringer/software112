import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „keller“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichKellerLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('keller')
  return <>{children}</>
}
