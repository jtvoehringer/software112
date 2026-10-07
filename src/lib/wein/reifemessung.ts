// Reife-Messungen je Ried – KAN-203 (07.10.2026)
//
// Isomorph und ohne '@/'-Importe, nur ../format (node:test: scripts/tests/kan203-reife-gaer.test.mjs). Das Mostgewicht kommt wie
// überall über MostgewichtEingabe (Messwert + Einheit, beide Werte serverseitig gerechnet, KAN-128); hier nur die
// übrigen Felder und der Verlauf. Zuwachs und Verlauf rechnen ausschließlich in °KMW (Rechenregel: nie °Oe mitteln
// oder vergleichen, die Stufe kommt nur aus °KMW).

import { zahlAus } from '../format'

export interface ReifeFelder {
  datum: string
  gesamtsaeure_gl: number | null
  ph_wert: number | null
}

/** Zahl aus einer Formulareingabe („6,8“, „6.8“, leer = null) über zahlAus(); NaN = ungültig (nicht leer, keine Zahl) */
export function reifeZahl(roh: unknown): number | null {
  if ((roh == null ? '' : String(roh)).trim() === '') return null
  return zahlAus(roh) ?? NaN
}

/** Prüft Datum (Pflicht, nicht in der Zukunft), Gesamtsäure 0–50 g/l und pH 0–14. Gibt den ersten Fehler zurück. */
export function reifeFelderFehler(f: { datum: string; gesamtsaeure_gl: number | null; ph_wert: number | null }, heute: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.datum ?? '')) return 'Bitte das Datum der Messung angeben.'
  if (f.datum > heute) return 'Das Datum der Messung darf nicht in der Zukunft liegen.'
  if (f.gesamtsaeure_gl !== null && !(f.gesamtsaeure_gl >= 0 && f.gesamtsaeure_gl <= 50)) return 'Die Gesamtsäure muss zwischen 0 und 50 g/l liegen.'
  if (f.ph_wert !== null && !(f.ph_wert >= 0 && f.ph_wert <= 14)) return 'Der pH-Wert muss zwischen 0 und 14 liegen.'
  return null
}

export interface ReifeMessung {
  id: string
  datum: string
  kmw: number | string | null
  oechsle: number | string | null
  mostgewicht_einheit: string | null
  gesamtsaeure_gl?: number | string | null
  ph_wert?: number | string | null
  notizen?: string | null
  created_at?: string | null
}

export interface ReifeZeile<M extends ReifeMessung = ReifeMessung> {
  messung: M
  /** Zuwachs gegenüber der vorigen Messung in °KMW (2 Stellen), null bei der ersten */
  zuwachsKmw: number | null
  /** Tage seit der vorigen Messung, null bei der ersten */
  tage: number | null
}

const tagNr = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000)

/** Verlauf: neueste Messung zuerst, je Zeile der Zuwachs in °KMW gegenüber der vorherigen (älteren) Messung. */
export function reifeVerlauf<M extends ReifeMessung>(messungen: M[]): ReifeZeile<M>[] {
  const auf = [...messungen].sort((a, b) => a.datum.localeCompare(b.datum) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id))
  const zeilen: ReifeZeile<M>[] = auf.map((m, i) => {
    const vor = i > 0 ? auf[i - 1] : null
    const k = m.kmw == null ? null : Number(m.kmw)
    const kv = vor?.kmw == null ? null : Number(vor.kmw)
    return {
      messung: m,
      zuwachsKmw: k !== null && kv !== null ? Math.round((k - kv) * 100) / 100 : null,
      tage: vor ? tagNr(m.datum) - tagNr(vor.datum) : null,
    }
  })
  return zeilen.reverse()
}
