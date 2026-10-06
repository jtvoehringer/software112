// ── Verkauf, Füllung, Zukauf: Pflichtangaben (KAN-208, 05.10.2026; Matrix KAN-85) ─────────────────────────────────────
//
// Entscheidungen Jörgen (05.10.2026):
//  • Kunde Pflicht nur bei Tank- bzw. Fasswein- und Traubenverkauf (TBS-pflichtige Lieferung) – mit Betriebsnummer des
//    Empfängers; der Ab-Hof-Flaschenverkauf geht weiter ohne Kunde (Laufkunde).
//  • Flaschenverkauf einer Füllung ab Qualitätswein (auch DAC, Reserve, Sekt g.U.) ohne zugeteilte Prüfnummer wird
//    abgelehnt. Gültig für Flaschen sind „Zugeteilt“, „Erloschen“ und „Aufgebraucht“ (PN_FLASCHEN_STATUS, KAN-97).
//  • Zukauf: Lieferant Pflicht; bei Wein, Most und Trauben aus Österreich mit Betriebsnummer.
// Formular und Server Action prüfen mit denselben Funktionen.

import { qualitaetsStufe } from '@/lib/wein/qualitaetsrang'
import { PN_FLASCHEN_STATUS } from '@/lib/kellerbuch/pruefnummer'

/** Positionstypen, für die der Kunde samt Betriebsnummer Pflicht ist (Transportbescheinigung) */
export const KUNDE_PFLICHT_TYPEN = ['tank', 'trauben'] as const

/** Kunde bzw. Betriebsnummer fehlt bei Tank-/Traubenverkauf; null = in Ordnung */
export function verkaufKundeFehler(p: { typen: readonly string[]; kunde: boolean; betriebNr: string | null | undefined; kundeName?: string | null }): string | null {
  if (!p.typen.some(t => (KUNDE_PFLICHT_TYPEN as readonly string[]).includes(t))) return null
  if (!p.kunde) return 'Bei Tank- bzw. Traubenverkauf ist der Kunde Pflicht (Empfänger der Transportbescheinigung) – bitte einen Kontakt oder eine Firma wählen.'
  if (!(p.betriebNr ?? '').trim()) {
    return `Bei Tank- bzw. Traubenverkauf braucht der Empfänger${p.kundeName ? ` „${p.kundeName}“` : ''} eine Betriebsnummer – bitte im CRM beim Kontakt bzw. bei der Firma ergänzen.`
  }
  return null
}

/** Braucht die Füllung eine Prüfnummer? Ab Qualitätswein, mit Zusatzbezeichnung (DAC, Reserve …) oder als Sekt g.U. */
export function fuellungBrauchtPruefnummer(f: { qualitaet: string | null; zusatzbezeichnung?: string | null; erzeugnis?: string | null }): boolean {
  if ((qualitaetsStufe(f.qualitaet) ?? -1) >= 2) return true
  if (f.zusatzbezeichnung) return true
  return f.erzeugnis === 'sekt'
}

/** Flaschenverkauf ohne zugeteilte Prüfnummer; null = in Ordnung */
export function flaschePruefnummerFehler(f: {
  name: string | null; qualitaet: string | null; zusatzbezeichnung?: string | null; erzeugnis?: string | null
  pruefnummer: string | null; antragStatus?: string | null
}): string | null {
  if (!fuellungBrauchtPruefnummer(f)) return null
  const nummer = (f.pruefnummer ?? '').trim()
  const statusOk = f.antragStatus == null || (PN_FLASCHEN_STATUS as readonly string[]).includes(f.antragStatus)
  if (nummer && statusOk) return null
  return `„${f.name ?? 'Füllung'}“ hat noch keine zugeteilte staatliche Prüfnummer – Flaschen ab Qualitätswein dürfen erst danach verkauft werden. `
    + 'Bitte die Prüfnummer an der Füllung nachtragen (Weinlager › Füllung › „Prüfnummer nachtragen“).'
}

/** Zukauf: Lieferant Pflicht, bei Wein/Most/Trauben aus Österreich mit Betriebsnummer; null = in Ordnung */
export function zukaufLieferantFehler(z: { art: string; lieferant: boolean; betriebNr: string | null | undefined; landIso: string | null | undefined; lieferantName?: string | null }): string | null {
  if (!z.lieferant) return 'Bitte den Lieferanten angeben (Kontakt oder Firma).'
  const ware = ['wein', 'most', 'trauben', 'maische', 'flaschen'].includes(z.art)   // KAN-41: auch Maische und Flaschen
  if (ware && (z.landIso ?? 'AT') === 'AT' && !(z.betriebNr ?? '').trim()) {
    return `Der Lieferant${z.lieferantName ? ` „${z.lieferantName}“` : ''} braucht eine Betriebsnummer (Wein, Most, Trauben, Maische und Flaschen aus Österreich) – bitte im CRM ergänzen.`
  }
  return null
}

/** Merkmale eines Zukaufs, die nach einer Folgebuchung an der Zielcharge fest sind */
export const ZUKAUF_MERKMALE = [
  'datum', 'art', 'weinart', 'rebsorte', 'jahrgang', 'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'herkunft', 'land_iso',
  'kmw', 'oechsle', 'mostgewicht_einheit', 'alkohol_pct', 'anreicherung', 'menge', 'einheit',
] as const

/** Name des Leerstrings-Verbots für Füllungen */
export function fuellungNameFehler(name: unknown): string | null {
  return typeof name === 'string' && name.trim() ? null : 'Bitte einen Produktnamen für die Füllung angeben.'
}
