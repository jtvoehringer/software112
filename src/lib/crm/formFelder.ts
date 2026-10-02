// Bearbeiten von Kontakten/Firmen (02.10.2026): nur Felder ändern, die das
// Formular tatsächlich sendet (FormData-Schlüssel vorhanden). Fehlt ein Feld –
// anderes Formular, ältere Version im offenen Tab –, bleibt der gespeicherte
// Wert unverändert, statt mit null bzw. einem Standardwert überschrieben zu
// werden. Schlüssel im Payload = Feldname im Formular. Ja/Nein-Felder senden die
// Formulare immer (Hidden-Feld bzw. fd.set), ein fehlender Schlüssel heißt also
// „nicht im Formular“, nicht „false“.
//
// Ohne Importe, damit scripts/tests/ die Funktion direkt laden kann.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export function nurGesendeteFelder(formData: { has(name: string): boolean }, payload: R): R {
  return Object.fromEntries(Object.entries(payload).filter(([feld]) => formData.has(feld)))
}
