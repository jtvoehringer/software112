// ── Umschalter „Neueste zuerst“ / „Chronologisch“ für Protokolle am Bildschirm (KAN-350, 22.10.2026) ──
// Gleiches Aussehen wie der Umschalter der Maßnahmenliste (KAN-324), aber als Link mit ?sort=neu|alt, damit
// Server-Seiten ohne Client-Zustand umschalten. Druck und CSV bleiben chronologisch (Seite bzw. Ladefunktion).

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'
import Link from '@/components/ui/Link'
import { PROTOKOLL_SORT_LABEL, andereSortierung, sortierHref, type ProtokollSortierung } from '@/lib/protokoll/sortierung'

export default function SortierungUmschalter({ sort, pfad, parameter }: {
  sort: ProtokollSortierung
  pfad: string
  /** übrige Suchparameter der Seite (bleiben beim Umschalten erhalten) */
  parameter: Readonly<Record<string, string | number | null | undefined>>
}) {
  const ziel = andereSortierung(sort)
  return (
    <Link href={sortierHref(pfad, parameter, ziel)} scroll={false}
      aria-label={`Sortierung: ${PROTOKOLL_SORT_LABEL[sort]} – umschalten auf ${PROTOKOLL_SORT_LABEL[ziel]}`}
      title="Nur die Bildschirmansicht – Druck und CSV bleiben chronologisch"
      className="inline-flex items-center gap-1.5 border border-s112-border rounded-lg px-3 py-1.5 text-sm bg-white text-s112-text-1 hover:bg-s112-bg focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 print:hidden">
      {sort === 'neu' ? <ArrowDownWideNarrow size={15} aria-hidden /> : <ArrowUpNarrowWide size={15} aria-hidden />}
      {PROTOKOLL_SORT_LABEL[sort]}
    </Link>
  )
}
