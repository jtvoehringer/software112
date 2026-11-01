// Preis beim Zukauf (KAN-397, Epic KAN-391): „Gesamtpreis (€)“ und „Preis / Einheit (€)“ sind gekoppelte Eingaben wie
// °KMW/°Oe – das zuletzt bearbeitete Feld ist die Eingabe (`quelle`), das andere wird gerechnet:
//   Gesamt  = Preis je Einheit × Menge, kaufmännisch auf Cent (gespeichert wird preis_gesamt)
//   Einheit = Gesamt ÷ Menge, auf 4 Stellen (nur Anzeige bzw. Vorbelegung des Einstandspreises je Liter)
// Ändert sich die Menge, rechnet dieselbe Funktion das jeweils andere Feld neu. Werte wie aus <input type="number">
// (Dezimalpunkt, leer = nichts eingegeben). Gemeinsam für „Zukauf erfassen“ und „Zukauf bearbeiten“.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rundText } from '../zahl/runden.ts'

export type PreisQuelle = 'gesamt' | 'einheit'

const zahl = (s: string): number | null => {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Beide Preisfelder aus Menge, den aktuellen Eingaben und dem zuletzt bearbeiteten Feld */
export function preisFelder(menge: string, gesamt: string, einheit: string, quelle: PreisQuelle): { gesamt: string; einheit: string } {
  const m = zahl(menge)
  const mengeOk = m != null && m > 0
  if (quelle === 'einheit') {
    const p = zahl(einheit)
    return { gesamt: mengeOk && p != null ? rundText(p * (m as number), 2) : '', einheit }
  }
  const g = zahl(gesamt)
  return { gesamt, einheit: mengeOk && g != null ? ohneNullen(rundText(g / (m as number), 4)) : '' }
}

/** „2.4000“ → „2.40“, „2.3456“ bleibt: mindestens 2, höchstens 4 Nachkommastellen */
function ohneNullen(text: string): string {
  return text.replace(/(\.\d\d\d*?)0+$/, '$1')
}
