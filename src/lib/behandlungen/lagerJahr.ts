// ── Lagerbewegung je Mittel im laufenden Geschäftsjahr (KAN-173, 01.10.2026) ──
//
// Für die Stammdaten-Tabellen der Betriebsmittel-Lagerverwaltung (PSM, Düngemittel, Weinbehandlungs- und
// Produktionsmittel): Anfangsbestand | Zukäufe | Verbräuche | Saldo. lagerKonto() (PSM/Dünger) und bmKonto()
// (Betriebsmittel) rufen jahresBewegung() mit ihren schon in die Lager-Einheit umgerechneten Buchungen und
// Verbrauchszeilen auf – die Tabellen zeigen damit dieselben Mengen wie die Lagerkarten in „Bestand & Bewegungen“.
//
// Geschäftsjahr = Kalenderjahr (wie UVA/E&A).
// Anfangsbestand = Saldo zum 1.1. (alle Buchungen und Verbräuche davor) + im Jahr gebuchte Anfangsbestände
// Zukäufe        = Einkäufe und Inventurkorrekturen nach oben im Jahr
// Verbräuche     = Verbrauch aus Maßnahmen und Inventurkorrekturen nach unten im Jahr
// Saldo          = Anfangsbestand + Zukäufe − Verbräuche = aktueller Bestand der Lagerkarte
// Nachtrag 02.10.2026 (Jörgen: „ja, mit Anmerkung ‚Inventurkorrektur‘“): die Inventurkorrektur-Anteile von Zukäufen
// und Verbräuchen kommen getrennt mit (korrekturPlus/korrekturMinus, beide als positive Menge) – die Tabellen zeigen
// sie unter der Summe als „davon Inventurkorrektur“.
// Isomorph, ohne Datenbank und ohne Imports außer lib/csv (node:test: scripts/tests/kan173-lager-jahr.test.mjs).

import { runden } from '@/lib/csv'

export type JahresBewegung = {
  jahr: number; anfangsbestand: number; zukauf: number; verbrauch: number; saldo: number
  /** davon Inventurkorrekturen nach oben (in zukauf enthalten) */
  korrekturPlus: number
  /** davon Inventurkorrekturen nach unten (in verbrauch enthalten, positive Menge) */
  korrekturMinus: number
}

/** Gezählte Buchung in der Lager-Einheit (Abgänge negativ); typ = anfangsbestand | einkauf | korrektur */
export type GezaehlteBuchung = { datum: string; menge: number; typ?: string | null }

export function jahresBewegung(
  buchungen: readonly GezaehlteBuchung[],
  verbrauch: readonly { datum: string; menge: number }[],
  jahr: number,
  stellen = 3,
): JahresBewegung {
  const beginn = `${String(jahr).padStart(4, '0')}-01-01`
  let vorher = 0, anfang = 0, zukauf = 0, ab = 0, korrPlus = 0, korrMinus = 0
  for (const b of buchungen) {
    if (String(b.datum).slice(0, 10) < beginn) vorher += b.menge
    else if (b.typ === 'anfangsbestand') anfang += b.menge
    else if (b.menge > 0) {
      zukauf += b.menge
      if (b.typ === 'korrektur') korrPlus += b.menge
    } else {
      ab -= b.menge
      if (b.typ === 'korrektur') korrMinus -= b.menge
    }
  }
  for (const p of verbrauch) {
    if (String(p.datum).slice(0, 10) < beginn) vorher -= p.menge
    else ab += p.menge
  }
  const anfangsbestand = runden(vorher + anfang, stellen)
  const zukaeufe = runden(zukauf, stellen)
  const verbraeuche = runden(ab, stellen)
  return {
    jahr, anfangsbestand, zukauf: zukaeufe, verbrauch: verbraeuche, saldo: runden(anfangsbestand + zukaeufe - verbraeuche, stellen),
    korrekturPlus: runden(korrPlus, stellen), korrekturMinus: runden(korrMinus, stellen),
  }
}
