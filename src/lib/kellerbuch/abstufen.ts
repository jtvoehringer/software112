// ── Aktion „Abstufen“ an der Charge (KAN-82, 05.10.2026) ───────────────────────────────────────────────────
//
// R8 „händisch downgraden … auch im Kellerplan“: Qualitätsstufe, Zusatzbezeichnung und Herkunft einer Charge nur
// niedriger, mit Datum und Pflichtgrund (RPC s112_charge_abstufen, Protokoll charge_umstufungen). Entscheidungen Jörgen:
// eine Teilmenge nur zusammen mit einem Umzug in ein leeres Gebinde (die neue Charge dort wird abgestuft); Rückdatieren
// bis zum Kellerbuch-Abschluss. Das Erzeugnis bleibt (Sekt/Perlwein → Wein ist keine Abstufung der Charge).
// Formular und Server Action prüfen mit denselben Funktionen; die RPC prüft Grund, Datum und Periodensperre.

import { istAbstufung, istAbstufungQualitaet, type QualitaetsAngabe, type Zusatz } from '@/lib/wein/qualitaetsrang'
import { ZUSATZ_OPTS, qualitaetAnzeige, qualitaetsAngabeFehler, type QualitaetsOption } from '@/lib/wein/qualitaet'
import { HERKUNFT_LABEL, herkunftZulaessig, zulaessigeHerkuenfte } from '@/lib/herkunft'

export type ChargeMerkmale = QualitaetsAngabe & { herkunft: string | null }

/** Mindestlänge des Grundes (wie die RPC) */
export const ABSTUFEN_GRUND_MIN = 10

/** Wählbare Stufen aus der Liste der Charge (QUALITAET_OPTS, vom Formular übergeben – KAN-73): die bisherige und jede
 *  niedrigere (kein „Sonstiges“) */
export function abstufenStufen(alt: ChargeMerkmale, liste: readonly QualitaetsOption[]): { value: string; label: string }[] {
  return liste
    .filter(o => o.value !== 'sonstiges' && (o.value === alt.stufe || (!!alt.stufe && istAbstufung(alt.stufe, o.value))))
    .slice().sort((a, b) => b.rang - a.rang)
    .map(o => ({ value: o.value, label: o.label }))
}

/** Wählbare Zusatzbezeichnungen: keine, die bisherige und jede darunter */
export function abstufenZusaetze(alt: ChargeMerkmale): { value: Zusatz; label: string }[] {
  if (!alt.zusatz) return []
  return ZUSATZ_OPTS.filter(o => o.value === alt.zusatz
    || istAbstufungQualitaet(alt, { stufe: alt.stufe, zusatz: o.value, erzeugnis: alt.erzeugnis }))
    .map(o => ({ value: o.value, label: o.label }))
}

/** Wählbare Herkünfte: die bisherige und jede breitere Stufe im Baum (ohne Herkunft: keine Auswahl) */
export function abstufenHerkuenfte(alt: ChargeMerkmale): { value: string; label: string }[] {
  return (zulaessigeHerkuenfte(alt.herkunft) ?? []).map(c => ({ value: c, label: HERKUNFT_LABEL[c] ?? c }))
}

/** Prüfung vor der Abstufung: null = zulässig, sonst die Meldung */
export function abstufenFehler(alt: ChargeMerkmale, neu: ChargeMerkmale): string | null {
  const qualitaetGleich = (alt.stufe ?? null) === (neu.stufe ?? null) && (alt.zusatz ?? null) === (neu.zusatz ?? null)
    && (alt.erzeugnis ?? null) === (neu.erzeugnis ?? null)
  const herkunftGleich = (alt.herkunft ?? null) === (neu.herkunft ?? null)
  if (qualitaetGleich && herkunftGleich) return 'Nichts zu ändern – bitte eine niedrigere Qualität, Zusatzbezeichnung oder Herkunft wählen.'
  if ((alt.erzeugnis ?? null) !== (neu.erzeugnis ?? null)) return 'Das Erzeugnis kann beim Abstufen nicht geändert werden.'
  if (!qualitaetGleich && !istAbstufungQualitaet(alt, neu)) {
    return `„${qualitaetAnzeige(neu)}“ ist keine Abstufung von „${qualitaetAnzeige(alt)}“ – nur niedriger ist möglich.`
  }
  if (!qualitaetGleich) {
    const kombination = qualitaetsAngabeFehler(neu)   // z. B. Reserve nur auf Qualitätswein
    if (kombination) return kombination
  }
  if (!herkunftGleich) {
    if (!alt.herkunft) return 'Die Charge hat keine Herkunft – eine Herkunft kann beim Abstufen nicht neu gesetzt werden.'
    if (!neu.herkunft || !herkunftZulaessig(alt.herkunft, neu.herkunft)) {
      return `Die Herkunft „${HERKUNFT_LABEL[neu.herkunft ?? ''] ?? neu.herkunft ?? '–'}“ ist keine Abstufung von „${HERKUNFT_LABEL[alt.herkunft] ?? alt.herkunft}“ – nur eine breitere Stufe ist möglich.`
    }
  }
  return null
}

/** Teilmenge: Meldung, wenn die Menge nicht zwischen 0,01 L und dem Bestand (exklusive) liegt */
export function teilmengeFehler(menge: number | null, bestand: number): string | null {
  if (menge == null || !Number.isFinite(menge) || menge < 0.01) return 'Bitte die abzustufende Teilmenge angeben (mindestens 0,01 L).'
  if (menge >= bestand - 0.005) return 'Die Teilmenge ist so groß wie der Bestand – bitte „ganze Charge“ wählen.'
  return null
}

/** „Qualitätswein → Landwein · Kremstal → Niederösterreich“ für Protokoll und Weinbuch */
export function abstufungText(alt: ChargeMerkmale, neu: ChargeMerkmale): string {
  const teile: string[] = []
  if (qualitaetAnzeige(alt) !== qualitaetAnzeige(neu)) teile.push(`${qualitaetAnzeige(alt)} → ${qualitaetAnzeige(neu)}`)
  if ((alt.herkunft ?? null) !== (neu.herkunft ?? null)) {
    teile.push(`${HERKUNFT_LABEL[alt.herkunft ?? ''] ?? alt.herkunft ?? '–'} → ${HERKUNFT_LABEL[neu.herkunft ?? ''] ?? neu.herkunft ?? '–'}`)
  }
  return teile.join(' · ')
}
