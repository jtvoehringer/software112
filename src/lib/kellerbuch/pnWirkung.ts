// KAN-100 (04.10.2026): Wirkung eines Kellerbehandlungstyps auf die Prüfnummer (keller_behandlungstypen.pn_wirkung).
// Entscheidung Jörgen: Säurekorrektur u. Ä. verändern den Wein – die Prüfnummer erlischt für den Tankbestand der Charge
// (mit Rückfrage); Schwefelung, Filtration, Schönung, Gärtemperatur, Hefegabe, Schwund sind Pflege. Neue Typen starten
// als „nicht eingestuft“: Die App warnt nur, die Nummer bleibt.

export const PN_WIRKUNGEN = ['pflege', 'veraenderung', 'unklar'] as const
export type PnWirkung = typeof PN_WIRKUNGEN[number]

export const PN_WIRKUNG_TEXT: Record<PnWirkung, string> = {
  pflege: 'Pflege – Prüfnummer bleibt',
  veraenderung: 'Verändert den Wein – Prüfnummer erlischt',
  unklar: 'Nicht eingestuft – nur Warnung',
}

/** Wert aus Formular bzw. Tool – Unbekanntes wird „unklar“ */
export function pnWirkungAus(wert: unknown): PnWirkung {
  return (PN_WIRKUNGEN as readonly string[]).includes(String(wert)) ? (String(wert) as PnWirkung) : 'unklar'
}

/** Warnung bei einem nicht eingestuften Typ in einer Charge mit Prüfnummer (die Behandlung wird trotzdem gespeichert) */
export function pnWirkungUnklarHinweis(typName: string): string {
  return `Der Behandlungstyp „${typName || 'ohne Namen'}“ ist für die Prüfnummer nicht eingestuft. Verändert die Behandlung den Wein `
    + '(z. B. Säuerung, Entsäuerung, Anreicherung, Süßung), gilt die Prüfnummer der Charge für den Tankbestand nicht mehr – '
    + 'bitte den Typ einstufen, solange er noch in keiner Charge mit Prüfnummer verwendet wurde, bzw. einen eigenen Typ anlegen.'
}
