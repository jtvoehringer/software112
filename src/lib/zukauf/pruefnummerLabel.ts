// KAN-225 (07.10.2026): Beschriftung des Prüfnummer-Felds im Zukauf – bei Flaschenware Pflicht ab Qualitätswein (mit
// Zusatzbezeichnung oder als Sekt g.U.), darunter (Wein, Landwein) ohne Prüfnummer; bei Fasswein immer optional.
// Gemeinsam für „Neuer Zukauf“ und „Zukauf bearbeiten“.

import { flaschenPruefnummerPflicht, istFlaschenArt } from './ware'

export function pruefnummerLabel(art: string, qualitaet: string | null | undefined, gespeichert: { zusatz?: string | null; erzeugnis?: string | null } = {}): string {
  if (!istFlaschenArt(art)) return 'Staatl. Prüfnummer (optional)'
  if (!qualitaet) return 'Staatl. Prüfnummer des Erzeugers (Pflicht ab Qualitätswein)'
  return flaschenPruefnummerPflicht({ qualitaetsstufe: qualitaet, zusatzbezeichnung: gespeichert.zusatz ?? null, erzeugnis: gespeichert.erzeugnis ?? null })
    ? 'Staatl. Prüfnummer des Erzeugers *'
    : 'Staatl. Prüfnummer des Erzeugers (keine – Wein/Landwein)'
}
