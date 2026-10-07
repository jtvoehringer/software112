'use client'

// KAN-172: Hoch- oder Querformat wählbar (DruckFormatKnopf)
import DruckFormatKnopf from '@/components/DruckFormatKnopf'

export default function RueckverfolgungPrintButton() {
  return <DruckFormatKnopf label="PDF / Drucken" klein />
}
