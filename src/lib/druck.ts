// ── Drucken im Hoch- oder Querformat (KAN-172, 07.10.2026) ──────────────────────────────────────────────
// Ticket: „Druck soll auch in Querformat möglich sein“. Die globale Druckvorgabe (globals.css) legt kein Papierformat
// mehr fest – so bietet der Druckdialog des Browsers Hoch- und Querformat an. Die Druckknöpfe können das Format
// zusätzlich vorgeben: für die Dauer des Drucks ein @page-Stil mit „A4 portrait/landscape“, danach wieder entfernt.

export type DruckFormat = 'hoch' | 'quer'

export const DRUCK_STIL_ID = 's112-druckformat'

/** @page-Regel für das gewählte Format */
export function druckStil(format: DruckFormat): string {
  return `@media print { @page { size: A4 ${format === 'quer' ? 'landscape' : 'portrait'}; } }`
}

/** Seite im gewählten Format drucken (nur im Browser) */
export function druckeSeite(format: DruckFormat): void {
  document.getElementById(DRUCK_STIL_ID)?.remove()
  const stil = document.createElement('style')
  stil.id = DRUCK_STIL_ID
  stil.textContent = druckStil(format)
  document.head.appendChild(stil)
  const weg = () => { stil.remove(); window.removeEventListener('afterprint', weg) }
  window.addEventListener('afterprint', weg)
  window.print()
}
