// Verarbeitung einer Charge (KAN-41 Paket 3a, 06.10.2026) – BSM-Buchungsart AB_VERAR „Abgang durch Verarbeitung“.
//
// Eine Menge verlässt den Weinbestand, weil sie zu etwas anderem verarbeitet wird: Traubensaft (BKI R10, KAN-115),
// Essig, Brennerei/Destillation oder Sonstiges (z. B. Produktion, KAN-118). Gebucht wird nur über die RPC
// s112_verarbeitung_buchen (Datum, Menge, Zweck; ganze Menge schließt die Charge ab), korrigiert über
// s112_verarbeitung_stornieren (Gegenbuchung am Storno-Tag). Umsetzung nach bestem Wissen (Entscheidung Jörgen
// 06.10.2026, ohne BKI-Abnahme). Gemeinsam für Formular und Server Action.
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { ZAHL_LOCALE } from '../format.ts'

export const VERARBEITUNG_ZWECKE = [
  { value: 'traubensaft', label: 'Traubensaft' },
  { value: 'essig', label: 'Essig' },
  { value: 'brennerei', label: 'Brennerei / Destillation' },
  { value: 'sonstiges', label: 'Sonstiges (z. B. Produktion)' },
] as const

export type VerarbeitungZweck = (typeof VERARBEITUNG_ZWECKE)[number]['value']

export const VERARBEITUNG_ZWECK_LABEL: Record<VerarbeitungZweck, string> = Object.fromEntries(
  VERARBEITUNG_ZWECKE.map(z => [z.value, z.label]),
) as Record<VerarbeitungZweck, string>

export function istVerarbeitungZweck(z: unknown): z is VerarbeitungZweck {
  return VERARBEITUNG_ZWECKE.some(o => o.value === z)
}

/**
 * Prüfung vor dem Buchen (dieselbe Regel wie die RPC): Zweck aus der Liste, Menge über 0 und höchstens der Bestand
 * (0,005 L Toleranz), Datum gültig und nicht in der Zukunft. null = in Ordnung.
 */
export function verarbeitungFehler(p: { zweck: unknown; menge: number | null; bestand: number; datum: string; heute: string }): string | null {
  if (!istVerarbeitungZweck(p.zweck)) return 'Bitte den Zweck der Verarbeitung wählen.'
  if (p.menge == null || !Number.isFinite(p.menge) || p.menge <= 0) return 'Bitte die verarbeitete Menge in Litern angeben (größer als 0).'
  if (p.menge > p.bestand + 0.005) return `Die Menge übersteigt den Bestand der Charge (${p.bestand.toLocaleString(ZAHL_LOCALE, { maximumFractionDigits: 2 })} L).`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.datum)) return 'Bitte ein gültiges Datum angeben.'
  if (p.datum > p.heute) return 'Das Datum der Verarbeitung liegt in der Zukunft.'
  return null
}
