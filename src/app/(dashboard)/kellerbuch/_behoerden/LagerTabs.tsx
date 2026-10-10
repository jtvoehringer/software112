import Link from '@/components/ui/Link'

// KAN-50: „Gesamtexport & Kataloge“ (alle Blätter als XLSX). KAN-44: Reiter der BKI-Blätter „Lagerstand zum Datum“ und „Lagerbewegungen“; KAN-48: „Betriebsdaten & Gebinde“
export default function LagerTabs({ aktiv }: { aktiv: 'lagerstand' | 'lagerbewegungen' | 'stammdaten' | 'weingaerten' | 'gesamt' }) {
  const reiter = [
    { key: 'lagerstand', href: '/kellerbuch/lagerstand', label: 'Lagerstand zum Datum' },
    { key: 'lagerbewegungen', href: '/kellerbuch/lagerbewegungen', label: 'Lagerbewegungen' },
    { key: 'stammdaten', href: '/kellerbuch/bki-stammdaten', label: 'Betriebsdaten & Gebinde' },
    { key: 'weingaerten', href: '/kellerbuch/bki-weingaerten', label: 'Weingärten' },
    { key: 'gesamt', href: '/kellerbuch/bki-schnittstelle', label: 'Gesamtexport & Kataloge' },
  ] as const
  return (
    <div className="space-y-3 print:hidden">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-2">BKI-Schnittstelle</span>
      </div>
      <div className="flex gap-1 overflow-x-auto sm:overflow-visible whitespace-nowrap border-b border-s112-border">
        {reiter.map(r => r.key === aktiv ? (
          <span key={r.key} className="px-4 py-2 text-sm font-medium text-s112-blue-700 border-b-2 border-s112-teal -mb-px">{r.label}</span>
        ) : (
          <Link key={r.key} href={r.href}
            className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors">
            {r.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
