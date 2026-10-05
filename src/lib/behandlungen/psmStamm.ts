// ── Pflanzenschutzmittel-Stammdaten (KAN-86, 05.10.2026) ────────────────────────────────────────────────────
//
// Registernummer (Zulassungsnummer, Pflichtangabe der Aufzeichnung nach DVO (EU) 2023/564), EPPO-Code und
// „bienengefährlich“ pflegt jeder Betrieb von Hand (Entscheidung Jörgen: keine Übernahme aus dem PSM-Register).
// Der EPPO-Code am Mittel bezeichnet den Hauptschaderreger (z. B. PLASVI = Peronospora); die Kultur der Aufzeichnung
// ist immer die Weinrebe (VITVI). Formular und Server Action prüfen mit denselben Funktionen.

/** EPPO-Codes: 5 bzw. 6 Zeichen aus Großbuchstaben und Ziffern (VITVI, PLASVI, UNCINE …) */
const EPPO_RE = /^[A-Z0-9]{5,6}$/

/** EPPO-Code normalisieren (Großbuchstaben, ohne Leerzeichen); leer → null */
export function eppoCodeNormal(wert: unknown): string | null {
  const t = typeof wert === 'string' ? wert.replace(/\s+/g, '').toUpperCase() : ''
  return t || null
}

/** Meldung bei einem ungültigen EPPO-Code, sonst null (leer ist erlaubt) */
export function eppoCodeFehler(wert: unknown): string | null {
  const t = eppoCodeNormal(wert)
  if (t === null || EPPO_RE.test(t)) return null
  return `Der EPPO-Code „${t}“ ist ungültig – erwartet sind 5 bzw. 6 Buchstaben oder Ziffern (z. B. PLASVI für Peronospora, UNCINE für Oidium).`
}

/** Registernummer normalisieren (Leerraum gekürzt); leer → null */
export function registernummerNormal(wert: unknown): string | null {
  const t = typeof wert === 'string' ? wert.trim().replace(/\s+/g, ' ') : ''
  return t || null
}

/** Meldung bei einer unplausiblen Registernummer, sonst null (leer ist erlaubt – dann warnt die Aufzeichnung) */
export function registernummerFehler(wert: unknown): string | null {
  const t = registernummerNormal(wert)
  if (t === null) return null
  if (t.length > 30 || !/^[0-9A-Za-z][0-9A-Za-z ./-]*$/.test(t)) {
    return `Die Registernummer „${t}“ ist ungültig – erlaubt sind Ziffern, Buchstaben sowie „-“, „/“ und „.“ (höchstens 30 Zeichen), z. B. „3456-0“.`
  }
  return null
}

/** Hinweis in der Stammdatenliste: Mittel ohne Registernummer (Pflichtangabe der Aufzeichnung) */
export const REGISTERNUMMER_FEHLT = 'Registernummer fehlt – Pflichtangabe der Pflanzenschutz-Aufzeichnung'
