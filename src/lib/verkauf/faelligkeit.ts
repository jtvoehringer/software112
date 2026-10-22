// KAN-374 (Entscheidung Jörgen 22.10.2026): Eine Rechnung ist überfällig ab ihrer FÄLLIGKEIT, nicht nach einem festen
// Rechnungsalter. Zahlungsziel = Kundenziel (zahlungsziel_tage an Kontakt bzw. Firma, sonst 14 Tage) – genau wie die
// Rechnung selbst rechnet (weinhandel/rechnungen/[id], weinhandel/verkauf/[id]): Kontakt vor Firma, 0 = „bei Erhalt“.
// Hält die Rechnung eine Momentaufnahme des Käufers (partner_daten, KAN-150 F1c, enthält zahlungsziel_tage), gilt
// diese – der Aufrufer wendet sie vorher mit momentaufnahmeAnwenden(…, ['kontakt', 'firma']) an.
//
// Vorher: Dashboard, Offene Posten, Morgenbericht und Finanzübersicht zählten „überfällig“ ab 30 Tagen nach dem
// Rechnungsdatum – eine Rechnung mit Ziel 14 Tage war 16 Tage lang nicht überfällig, eine mit Ziel 60 Tage zu früh.
//
// Reine Datumsrechnung über UTC-Mitternacht (Projektregel KAN-255), „heute“ kommt vom Aufrufer als 'JJJJ-MM-TT'
// (heuteWien() bzw. lokalerTag(wienJetzt())). Ohne '@/'-Importe, damit node:test sie prüfen kann.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { tageZwischen, tagPlus } from '../datum/wien.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Zahlungsziel, wenn weder Kontakt noch Firma eines haben (wie die Rechnung) */
export const ZAHLUNGSZIEL_STANDARD_TAGE = 14

/** Zahlungsziel der Rechnung in Tagen: Kontakt, sonst Firma, sonst 14 (0 = bei Erhalt ist gültig) */
export function zahlungszielTage(beleg: { kontakt?: R | null; firma?: R | null } | null | undefined): number {
  const roh = beleg?.kontakt?.zahlungsziel_tage ?? beleg?.firma?.zahlungsziel_tage
  const n = roh === null || roh === undefined || roh === '' ? NaN : Number(roh)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : ZAHLUNGSZIEL_STANDARD_TAGE
}

/** Fälligkeitstag 'JJJJ-MM-TT' = Rechnungsdatum + Zahlungsziel (Kalendertage, Monats- und Jahreswechsel inklusive) */
export function faelligAm(rechnungsdatum: string, zielTage: number): string {
  return tagPlus(rechnungsdatum, Number.isFinite(zielTage) ? zielTage : ZAHLUNGSZIEL_STANDARD_TAGE)
}

/** Tage im Verzug am Tag `heute` ('JJJJ-MM-TT'): 0 bis einschließlich Fälligkeitstag, danach je Kalendertag eins mehr */
export function verzugTage(faellig: string, heute: string): number {
  const tage = tageZwischen(faellig, heute)
  return Number.isFinite(tage) && tage > 0 ? tage : 0
}

export type Faelligkeit = { zielTage: number; faelligAm: string; verzugTage: number; ueberfaellig: boolean }

/** Alles zur Fälligkeit einer Rechnung (Rechnungsdatum, Kontakt/Firma nach Momentaufnahme) am Tag `heute` */
export function faelligkeit(beleg: { datum: string; kontakt?: R | null; firma?: R | null }, heute: string): Faelligkeit {
  const zielTage = zahlungszielTage(beleg)
  const faellig = faelligAm(beleg.datum, zielTage)
  const verzug = verzugTage(faellig, heute)
  return { zielTage, faelligAm: faellig, verzugTage: verzug, ueberfaellig: verzug > 0 }
}

/** Anzeige „fällig am 31.10.2026 · 5 Tage überfällig“ (bzw. nur „fällig am …“, solange nicht überfällig) */
export function faelligText(f: { faelligAm: string; verzugTage: number }): string {
  const [j, m, t] = f.faelligAm.split('-')
  const datum = `${t}.${m}.${j}`
  return f.verzugTage > 0 ? `fällig am ${datum} · ${f.verzugTage} ${f.verzugTage === 1 ? 'Tag' : 'Tage'} überfällig` : `fällig am ${datum}`
}
