// ── Ried-Auswahl: Gruppen und „Alle auswählen“ ↔ „Alle abwählen“ ─────────────────────────────────────
//
// Gemeinsam für „Maßnahme erfassen“ (KAN-155) und „Lesedaten erfassen“ (KAN-160). Weingärten ohne Ried
// standen bisher in einer Gruppe „Alle Rieden“ bzw. „Alle“ – das las sich wie „alle“, enthielt aber nur die
// Weingärten ohne Ried-Zuordnung. Die Gruppe heißt wie in /lagen und den Berichten („ohne Ried“) und steht
// immer am Ende, die Rieden davor alphabetisch.
// Ohne '@/'-Importe und ohne JSX, damit node:test sie prüfen kann.

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
 * Knopf über der Ried-Auswahl: „Alle abwählen“, sobald alle auswählbaren (spritzbaren bzw. erntebaren) Weingärten
 * ganz ausgewählt sind (ein Klick leert dann die ganze Auswahl, auch einzeln gewählte Grundstücke), sonst
 * „Alle auswählen“. Ohne auswählbare Weingärten „Alle auswählen“ (wählt nichts).
 */
export function alleAuswahlModus(auswaehlbareIds: readonly string[], ausgewaehlt: ReadonlySet<string>): 'auswaehlen' | 'abwaehlen' {
  return auswaehlbareIds.length > 0 && auswaehlbareIds.every(id => ausgewaehlt.has(id)) ? 'abwaehlen' : 'auswaehlen'
}

/**
 * Ried mit genau einem Weingarten (bei Gebeshuber der Regelfall: eine Ried je Weingarten, gleicher Name) –
 * die Auswahl zeigt dann EINE Zeile statt Ried-Kopf und Weingarten darunter (Pilot-Rückmeldung 29.09.2026).
 */
export function istEinzelRied<T>(g: RiedGruppe<T>): boolean {
  return !g.ohneRied && g.weingaerten.length === 1
}

/** Weingarten-Name als Zusatz zur Ried – nur wenn er sich vom Ried-Namen unterscheidet (Groß-/Kleinschreibung egal) */
export function weingartenZusatz(riedName: string, weingartenName: string): string | null {
  const n = (s: string) => s.trim().toLocaleLowerCase('de')
  return n(riedName) === n(weingartenName) ? null : weingartenName
}
