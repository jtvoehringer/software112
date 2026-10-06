// KAN-41 Paket 1 (06.10.2026): datierter Statuswechsel einer Charge.
// Most bzw. teilweise gegorener Most (Status ernte, gaerung) und Wein (übrige Status) stehen in der Bestandsmeldung in
// verschiedenen Spalten – der Wechsel wird im Kellerbuch-Journal als Umstufungspaar gebucht (s112_journal_umstufung).
// Das Datum dieses Wechsels setzt die RPC s112_charge_status_setzen. Isomorph und ohne @/-Importe (node:test).

export const MOST_STATUS = ['ernte', 'gaerung'] as const

/** Status, in dem die Charge als Most (bzw. teilweise gegorener Most) zählt */
export function istMostStatus(status: string | null | undefined): boolean {
  return (MOST_STATUS as readonly string[]).includes(status ?? '')
}

/** Wechsel zwischen Most und Wein – nur dann zählt das Datum für Journal und Bestandsmeldung */
export function statusWechselBuchungsrelevant(alt: string | null | undefined, neu: string | null | undefined): boolean {
  return (alt ?? '') !== (neu ?? '') && istMostStatus(alt) !== istMostStatus(neu)
}

/** Datum des Statuswechsels aus dem Formular prüfen (JJJJ-MM-TT, nicht in der Zukunft); leer = heute */
export function statusDatumFehler(wert: string | null | undefined, heute: string): string | null {
  const d = (wert ?? '').trim()
  if (!d) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return 'Bitte ein gültiges Datum für den Statuswechsel angeben.'
  if (d > heute) return 'Das Datum des Statuswechsels liegt in der Zukunft.'
  return null
}
