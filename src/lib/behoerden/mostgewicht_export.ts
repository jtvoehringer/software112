// ── Mostgewicht in Behördenmeldungen und eigenen CSVs – KAN-128 Teil A, S8 (26.09.2026) ─────
//
// Eine Regel für alle Export-Zeilen (Rechenregel 9, Entscheidungen 8 und 9):
//   • beide Werte wie gespeichert – nichts neu gerechnet, nur ein fehlender Wert aus dem Messwert
//     (mostgewichtAusGespeichert);
//   • °KMW mit weniger Stellen als gespeichert ABGERUNDET (18,95 → „18,9“, nie über eine
//     Stufenschwelle) – die Ladefunktion liefert den schon abgerundeten Wert, csvText() rundet
//     sonst kaufmännisch;
//   • °Oe mit einer Stelle (numeric(5,1));
//   • Hinweis (X-Warnung) nur für GEMESSENE Werte, deren exportierte Rundung eine andere Stufe
//     ergibt als der gespeicherte °KMW – nach Entscheidung 8 eine reine Absicherung (z. B. Zeilen,
//     deren °KMW und °Oe vor Migration A nicht zusammenpassen).
// Isomorph, ohne Server-/Next-Importe (scripts/tests/ernte.test.mjs lädt die Datei direkt).

import { abrunden, ausMessung, EINHEIT_ZEICHEN, formatKmw, formatOechsle, runden, OECHSLE_STELLEN, type MostgewichtEinheit } from '@/lib/wein/mostgewicht'
import { mostgewichtAusGespeichert, type GespeichertesMostgewicht } from '@/lib/wein/mostgewichtFormular'
import { kmwZuQualitaet } from '@/lib/weinqualitaet'
import { qualitaetLabel } from '@/lib/wein/qualitaet'

export type MostgewichtExport = {
  /** °KMW, auf `kmwStellen` abgerundet */
  kmw: number | null
  /** °Oe mit einer Stelle */
  oechsle: number | null
  /** gemessene Einheit ('kmw' | 'oechsle'), ohne Mostgewicht null */
  einheit: MostgewichtEinheit | null
  /** X-Warnung, falls die exportierte Rundung des Messwerts die Stufe ändert – sonst null */
  stufenHinweis: string | null
}

const LEER: MostgewichtExport = { kmw: null, oechsle: null, einheit: null, stufenHinweis: null }

/** Mostgewicht einer Zeile für den Export (siehe Dateikopf). `kmwStellen`: 2 = verlustfrei
 *  (Lesedaten, Erntemeldung), 1 = BKI-EDV-Liste und Traubenverkauf-Liste. */
export function mostgewichtFuerExport(g: GespeichertesMostgewicht | null | undefined, kmwStellen: 1 | 2): MostgewichtExport {
  const m = mostgewichtAusGespeichert(g)
  if (!m) return LEER
  const kmw = abrunden(m.kmw, kmwStellen)
  const oechsle = runden(m.oechsle, OECHSLE_STELLEN)

  // Stufe des exportierten Messwerts gegen die Stufe des gespeicherten °KMW (Rechenregel 1)
  let stufeExport: string | null = null
  if (m.einheit === 'kmw') {
    stufeExport = kmwZuQualitaet(kmw)
  } else {
    try {
      const aus = ausMessung(oechsle, 'oechsle')
      stufeExport = aus ? kmwZuQualitaet(aus.kmw) : null
    } catch {
      stufeExport = null   // außerhalb des Eingabebereichs (Altbestand) – keine Aussage
    }
  }
  const stufeGespeichert = kmwZuQualitaet(m.kmw)
  const exportiert = m.einheit === 'kmw' ? `${formatKmw(kmw, kmwStellen)} °KMW` : `${formatOechsle(oechsle)} °Oe`
  const stufenHinweis = stufeExport !== null && stufeExport !== stufeGespeichert
    ? `Mostgewicht gemessen in ${EINHEIT_ZEICHEN[m.einheit]}: exportiert ${exportiert} ergibt rechnerisch ${qualitaetLabel(stufeExport)}, `
      + `der gespeicherte Wert ${formatKmw(m.kmw, 2)} °KMW ${qualitaetLabel(stufeGespeichert)} – Mostgewicht bitte prüfen.`
    : null
  return { kmw, oechsle, einheit: m.einheit, stufenHinweis }
}

/** Text der Spalte „Mostgewicht gemessen in“ („°KMW“ / „°Oe“), ohne Mostgewicht null */
export function gemessenInText(einheit: MostgewichtEinheit | null | undefined): string | null {
  return einheit ? EINHEIT_ZEICHEN[einheit] : null
}
