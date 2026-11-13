import { requireLesen } from '@/lib/auth/lesen'

// KAN-456: Seiten dieses Verzeichnisses gehören zum Lesebereich „crm“ (src/lib/navigation/seitenBereich.ts)
export default async function LesebereichCrmLayout({ children }: { children: React.ReactNode }) {
  await requireLesen('crm')
  return <>{children}</>
}
