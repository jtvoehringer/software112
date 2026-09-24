// ── Arten der Flaschenbewegungen (fuellung_bewegungen.art, KAN-35, 24.09.2026) ──
// Client-sicher (ohne Server-Importe): genutzt vom Formular „Bestand korrigieren“,
// von der Bewegungsliste und von der Server Action bestandKorrigieren.
// Muss zu fuellung_bewegungen_art_check und der RPC fuellung_bestand_buchen passen.
//   abgang = true → die RPC verlangt eine negative Menge (Eingabe als Stückzahl, die
//                   Action setzt das Minus); inventur → gezählter Ist-Bestand, die RPC
//                   rechnet die Differenz; korrektur/anfangsbestand → ± wie eingegeben.

export type BewegungsArt = 'inventur' | 'bruch' | 'eigenverbrauch' | 'schwund' | 'korrektur' | 'anfangsbestand'

export const BEWEGUNGSARTEN: { value: BewegungsArt; label: string; abgang: boolean; grundPflicht: boolean }[] = [
  { value: 'inventur',       label: 'Inventur (gezählter Bestand)',          abgang: false, grundPflicht: false },
  { value: 'bruch',          label: 'Bruch',                                 abgang: true,  grundPflicht: false },
  { value: 'eigenverbrauch', label: 'Eigenverbrauch / Verkostung',           abgang: true,  grundPflicht: false },
  { value: 'schwund',        label: 'Schwund / Fehlmenge',                   abgang: true,  grundPflicht: false },
  { value: 'korrektur',      label: 'Korrektur (±)',                         abgang: false, grundPflicht: true },
  { value: 'anfangsbestand', label: 'Anfangsbestand (Altbestand, ±)',        abgang: false, grundPflicht: true },
]

export function istBewegungsart(x: unknown): x is BewegungsArt {
  return typeof x === 'string' && BEWEGUNGSARTEN.some(a => a.value === x)
}

export function bewegungsartLabel(art: string): string {
  return BEWEGUNGSARTEN.find(a => a.value === art)?.label ?? art
}
