'use client'

// KAN-172: Hoch- oder Querformat wählbar (DruckFormatKnopf); KAN-373: Standardformat je Seite
import DruckFormatKnopf from '@/components/DruckFormatKnopf'
import type { DruckFormat } from '@/lib/druck'

export default function PrintButton({ standard }: { standard?: DruckFormat }) {
  return <DruckFormatKnopf standard={standard} />
}
