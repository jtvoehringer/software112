// ── Absenden des Anlegen-Formulars (KAN-153) ─────────────────────────────────────
//
// „Maßnahme erfassen“ ist nur noch während des Speicherns gesperrt. Fehlt die Auswahl der Rieden bzw.
// Grundstücke oder sperrt der Bio-Status das gewählte Mittel, zeigt ein Klick den Grund an der betroffenen
// Stelle, statt still gesperrt zu bleiben – ein gesperrter Knopf ist per Tastatur nicht erreichbar und erklärt
// sich nicht. Die Server Action prüft die Auswahl weiterhin selbst (createBehandlung).
// Ohne JSX, damit node:test sie prüfen kann (scripts/tests/massnahmen-arten.test.mjs).

import { fmtNum } from '@/lib/format'

/** Meldung am Abschnitt „Ried(en) auswählen“ (role="alert") */
export const RIED_AUSWAHL_FEHLT = 'Bitte mindestens ein Ried oder Grundstück auswählen.'

/**
 * Was einem Klick auf „Maßnahme erfassen“ im Weg steht – in der Reihenfolge des Formulars (das Mittel steht
 * über der Ried-Auswahl), wie die Pflichtfeld-Prüfung des Browsers:
 *   'bio'  – Mittel nicht öko-zugelassen bei Bio-EU bzw. biodynamisch: Grund am Mittel zeigen, Mittel fokussieren
 *   'ried' – weder Ried noch Grundstück gewählt: Abschnitt aufklappen, hinscrollen, erste Checkbox fokussieren,
 *            Meldung am Abschnitt
 *   null   – absenden (die Mengenprüfung folgt wie bisher)
 * Bei 'bio' und 'ried' wird nichts gesendet.
 */
export type AbsendenHindernis = 'bio' | 'ried' | null

export function absendenHindernis(auswahl: number, bioSperre: boolean): AbsendenHindernis {
  if (bioSperre) return 'bio'
  if (!(auswahl > 0)) return 'ried'
  return null
}

/** Kopfzeile „Ried(en) auswählen *“: ohne Auswahl ein Hinweis in Warnfarbe, sonst Anzahl und Fläche */
export function auswahlKopf(auswahl: number, ha: number): { text: string; warnung: boolean } {
  return auswahl > 0
    ? { text: `${auswahl} ausgewählt · ${fmtNum(ha, { max: 4 })} ha`, warnung: false }
    : { text: 'noch keine Auswahl', warnung: true }
}

/** Beschriftung des Knopfs – ohne Auswahl ohne „(0 ausgewählt)“ */
export function erfassenKnopfText(pending: boolean, auswahl: number): string {
  if (pending) return 'Speichert…'
  return auswahl > 0 ? `Maßnahme erfassen (${auswahl} ausgewählt)` : 'Maßnahme erfassen'
}

// ── Ried-Auswahl: Gruppen und „Alle auswählen“ ↔ „Alle abwählen“ (KAN-155, Pilotbetrieb) ──────────────
//
// Weingärten ohne Ried standen bisher in einer Gruppe „Alle Rieden“ – das las sich wie „alle“, enthielt aber nur
// die Weingärten ohne Ried-Zuordnung. Die Gruppe heißt jetzt wie in /lagen und den Berichten („ohne Ried“) und
// steht immer am Ende, die Rieden davor alphabetisch.

/** Name der Gruppe für Weingärten ohne Ried (lage_name leer) */
export const OHNE_RIED_GRUPPE = 'Ohne Ried-Zuordnung'

export type RiedGruppe<T> = { schluessel: string; name: string; ohneRied: boolean; weingaerten: T[] }

/** Weingärten nach Ried gruppieren: Rieden alphabetisch (de), „Ohne Ried-Zuordnung“ zuletzt */
export function riedGruppen<T extends { lage_name: string | null }>(weingaerten: readonly T[]): RiedGruppe<T>[] {
  const rieden = new Map<string, T[]>()
  const ohne: T[] = []
  for (const w of weingaerten) {
    const name = w.lage_name?.trim()
    if (!name) { ohne.push(w); continue }
    const liste = rieden.get(name) ?? []
    liste.push(w)
    rieden.set(name, liste)
  }
  const gruppen: RiedGruppe<T>[] = Array.from(rieden.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'de'))
    .map(([name, liste]) => ({ schluessel: `ried:${name}`, name, ohneRied: false, weingaerten: liste }))
  if (ohne.length > 0) gruppen.push({ schluessel: 'ohne-ried', name: OHNE_RIED_GRUPPE, ohneRied: true, weingaerten: ohne })
  return gruppen
}

/**
 * Knopf über der Ried-Auswahl: „Alle abwählen“, sobald alle spritzbaren Weingärten ganz ausgewählt sind (ein Klick
 * leert dann die ganze Auswahl, auch einzeln gewählte Grundstücke), sonst „Alle auswählen“. Ohne spritzbare
 * Weingärten „Alle auswählen“ (wählt nichts).
 */
export function alleAuswahlModus(spritzbareIds: readonly string[], ausgewaehlt: ReadonlySet<string>): 'auswaehlen' | 'abwaehlen' {
  return spritzbareIds.length > 0 && spritzbareIds.every(id => ausgewaehlt.has(id)) ? 'abwaehlen' : 'auswaehlen'
}
