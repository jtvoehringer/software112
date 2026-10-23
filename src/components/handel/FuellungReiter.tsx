'use client'

// UAT 23.10.2026: Reiter je Füllung – Füllung (bearbeiten), E-Label, Rückverfolgung. Vorher führte der Klick auf das
// Produkt im Warenlager in die Rückverfolgung, bearbeiten ging nur über den Stift; zwischen den Seiten gab es keinen Weg.
// Der aktive Reiter ergibt sich aus der Adresse (Layout der Füllung bzw. Rückverfolgung mit fuellung_id).

import Link from '@/components/ui/Link'
import { usePathname } from 'next/navigation'

export type FuellungReiterArt = 'fuellung' | 'elabel' | 'rueckverfolgung'

/** Aktiver Reiter aus der Adresse */
export function aktiverFuellungReiter(pfad: string): FuellungReiterArt | null {
  if (/^\/weinhandel\/fuellungen\/[^/]+\/edit\/?$/.test(pfad)) return 'fuellung'
  if (/^\/weinhandel\/fuellungen\/[^/]+\/elabel\/?$/.test(pfad)) return 'elabel'
  if (pfad.startsWith('/kellerbuch/rueckverfolgung')) return 'rueckverfolgung'
  return null
}

export default function FuellungReiter({ id, bearbeiten }: { id: string; bearbeiten: boolean }) {
  const aktiv = aktiverFuellungReiter(usePathname() ?? '')
  const reiter: { art: FuellungReiterArt; label: string; href: string }[] = [
    ...(bearbeiten ? [{ art: 'fuellung' as const, label: 'Füllung', href: `/weinhandel/fuellungen/${id}/edit` }] : []),
    { art: 'elabel', label: 'E-Label', href: `/weinhandel/fuellungen/${id}/elabel` },
    { art: 'rueckverfolgung', label: 'Rückverfolgung', href: `/kellerbuch/rueckverfolgung?fuellung_id=${id}` },
  ]
  return (
    <nav aria-label="Füllung" className="mb-4 flex gap-1 border-b border-s112-border print:hidden" data-print="hide">
      {reiter.map(r => (
        <Link key={r.art} href={r.href} aria-current={aktiv === r.art ? 'page' : undefined}
          className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${aktiv === r.art
            ? 'border-s112-teal text-s112-text font-semibold'
            : 'border-transparent text-s112-muted hover:text-s112-blue-700'}`}>
          {r.label}
        </Link>
      ))}
    </nav>
  )
}
