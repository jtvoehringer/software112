// ── Nährstoffbilanz / Düngeaufzeichnung (Behördenmeldung „naehrstoffbilanz“, 24.09.2026) ──
//
// Eine Berechnung für die Druckseite /reports/naehrstoffbilanz und die CSV (eine Zeile je Düngung).
// Isomorph, Ladefunktion wie psm.ts (Mandantenfilter, alle()).
//
// Rechenweg:
//   • Menge (kg) = mittelmengeKg() ohne Liter-Näherung: Düngermenge („Menge gesamt“ einer Düngung)
//     in kg bzw. g, sonst Aufwand kg/ha × behandelte Fläche bzw. kg (gesamt) – Basis „Düngermenge“
//     bzw. „Aufwand × Fläche“ (KAN-133). Düngungen in Litern (Dichte unbekannt) oder ohne Düngemittel
//     gehen NICHT in die Bilanz – bis 24.09.2026 still übersprungen, jetzt als Hinweis (X-Warnungen,
//     auf der Druckseite als Liste).
//   • N (kg) = Menge × N-Gehalt / 100, P (kg) = Menge × P-Gehalt / 100 (Stammdaten Düngemittel).
//   • N/P (kg/ha) je Düngung = N/P (kg) / behandelte Fläche (Σ Grundstücke der Maßnahme; bisher
//     die Fläche des EINEN Weingartens aus weingarten_id).
//   • Betrieb: Σ N/P (kg) / Σ Fläche der aktiven Weingärten – wie bisher.

import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import type { LadeErgebnis } from './typen'
import {
  behandlungKurz, betriebsflaecheHa, jahrZeitraum, ladeBehandlungen, ladeWeingaerten, liste,
  mittelmenge, mittelmengeKg, riedText, weingartenText, einheitText, STELLEN_MENGE,
  type PsmBehandlung, type WeingartenStamm,
} from './psm'

// Orientierungswerte für Weinbau in Österreich (Stand 2026, übernommen von der Druckseite):
// - Stickstoff: Nitrat-Aktionsprogramm-Verordnung (NAPV) 2023 legt für Wein in "Gebieten mit
//   verstärkten Aktionen" (nitratbelastete Gebiete) erstmals eine Düngeobergrenze von 50 kg N/ha
//   und Jahr fest. Außerhalb dieser Gebiete gibt es (Stand dieser Recherche) keine eigene
//   gesetzliche Obergrenze für Wein - hier wird der Wert dennoch als Orientierung/Ampel verwendet.
// - Phosphor: keine bundesweite gesetzliche Obergrenze wie bei Stickstoff gefunden. Richtwert ist
//   die fachliche Erhaltungsdüngung bei mittlerer Bodengehaltsklasse (~15 kg P2O5/ha/Jahr) - dient
//   hier nur als grobe Orientierung, keine rechtliche Grenze. Wichtig: ob die in den
//   Düngemittel-Stammdaten hinterlegten "P-Gehalt %"-Werte als elementares P oder als P2O5
//   deklariert sind, hängt vom jeweiligen Produktetikett ab - bitte beim Erfassen der Stammdaten
//   prüfen, da sich P2O5 und elementares P um den Faktor ~2,29 unterscheiden.
/** NAPV 2023: Düngeobergrenze Wein in Gebieten mit verstärkten Aktionen (kg N/ha/Jahr) */
export const N_RICHTWERT_KG_HA = 50
/** Fachliche Erhaltungsdüngung bei mittlerer Bodengehaltsklasse (kg P/ha/Jahr), keine gesetzliche Grenze */
export const P_RICHTWERT_KG_HA = 15
/** N/P (kg) und (kg/ha): 3 Nachkommastellen wie bisher auf der Druckseite */
export const STELLEN_NP = 3

export type NaehrstoffZeile = {
  behandlungId: string
  datum: string
  weingarten: string | null
  ried: string | null
  /** behandelte Fläche (ha) */
  flaecheHa: number | null
  duengemittel: string
  typ: string | null
  menge: number | null
  einheit: string
  /** Düngermenge in kg (Grundlage) */
  mengeKg: number
  mengeBasis: string
  nPct: number | null
  pPct: number | null
  nKg: number | null
  pKg: number | null
  nKgHa: number | null
  pKgHa: number | null
}

export type Naehrstoffbilanz = {
  zeilen: NaehrstoffZeile[]
  /** Betriebsfläche (aktive Weingärten, ha) */
  gesamtHa: number
  /** Σ der gerundeten Zeilenwerte */
  nKg: number
  pKg: number
  nKgHa: number | null
  pKgHa: number | null
  /** Düngungen, die nicht in die Bilanz gehen (ohne Düngemittel, Menge nicht in kg) */
  uebersprungen: number
  warnungen: string[]
}

function durch(z: number | null, n: number | null): number | null {
  return z !== null && n !== null && n > 0 ? runden(z / n, STELLEN_NP) : null
}

function anteil(menge: number, pct: number | null): number | null {
  return pct === null ? null : runden(menge * pct / 100, STELLEN_NP)
}

/** Nährstoffbilanz aus den Düngungen (andere Maßnahmenarten werden ignoriert) */
export function naehrstoffbilanz(behandlungen: readonly PsmBehandlung[], weingaerten: readonly WeingartenStamm[]): Naehrstoffbilanz {
  const gesamtHa = betriebsflaecheHa(weingaerten)
  const ohneMittel: string[] = []
  const ohneMenge: string[] = []
  const ohneFlaeche: string[] = []
  const ohneGehalt: string[] = []
  const zeilen: NaehrstoffZeile[] = []

  for (const b of behandlungen) {
    if (b.art !== 'duengung') continue
    const d = b.duengemittel
    if (!d) { ohneMittel.push(behandlungKurz(b)); continue }
    const mm = mittelmengeKg(b, { literAlsKg: false })
    if (!mm) {
      const erfasst = b.mengeGesamt !== null ? `${String(b.mengeGesamt).replace('.', ',')} ${einheitText(b.mengeEinheit)}`.trim() : 'ohne Düngermenge'
      // Grund aus mittelmenge(); Düngemittel in l haben eine Menge, aber keine in kg (keine Dichte-Annahme)
      const m = mittelmenge(b)
      const grund = m.warnung ?? (m.einheit === 'l' ? 'in l, ohne Dichte nicht in kg umrechenbar' : null)
      ohneMenge.push(`${behandlungKurz(b)}: ${d.name}, ${erfasst}${grund ? ` (${grund})` : ''}`)
      continue
    }
    if (b.flaecheHa === null) ohneFlaeche.push(behandlungKurz(b))
    if (d.nPct === null || d.pPct === null) ohneGehalt.push(d.name)
    const nKg = anteil(mm.kg, d.nPct)
    const pKg = anteil(mm.kg, d.pPct)
    zeilen.push({
      behandlungId: b.id, datum: b.datum,
      weingarten: weingartenText(b), ried: riedText(b),
      flaecheHa: b.flaecheHa,
      duengemittel: d.name, typ: d.typ,
      menge: b.mengeGesamt !== null ? runden(b.mengeGesamt, STELLEN_MENGE) : null,
      einheit: einheitText(b.mengeEinheit),
      mengeKg: mm.kg, mengeBasis: mm.basis,
      nPct: d.nPct, pPct: d.pPct,
      nKg, pKg,
      nKgHa: durch(nKg, b.flaecheHa),
      pKgHa: durch(pKg, b.flaecheHa),
    })
  }

  const nKg = runden(zeilen.reduce((s, z) => s + (z.nKg ?? 0), 0), STELLEN_NP)
  const pKg = runden(zeilen.reduce((s, z) => s + (z.pKg ?? 0), 0), STELLEN_NP)
  const warnungen: string[] = []
  if (ohneMittel.length > 0) warnungen.push(`${ohneMittel.length} ${ohneMittel.length === 1 ? 'Düngung' : 'Düngungen'} ohne Düngemittel – nicht in der Bilanz: ${liste(ohneMittel)}`)
  if (ohneMenge.length > 0) warnungen.push(`${ohneMenge.length} ${ohneMenge.length === 1 ? 'Düngung' : 'Düngungen'} ohne Düngermenge in kg (bzw. Aufwand in kg/ha oder kg) – nicht in der Bilanz: ${liste(ohneMenge)}`)
  if (ohneFlaeche.length > 0) warnungen.push(`${ohneFlaeche.length} ${ohneFlaeche.length === 1 ? 'Düngung' : 'Düngungen'} ohne behandelte Fläche – N/P (kg/ha) bleibt leer: ${liste(ohneFlaeche)}`)
  if (ohneGehalt.length > 0) warnungen.push(`N- oder P-Gehalt fehlt in den Düngemittel-Stammdaten: ${liste([...new Set(ohneGehalt)])} – Feld bleibt leer, zählt in der Summe als 0.`)
  if (gesamtHa <= 0 && zeilen.length > 0) warnungen.push('Keine aktiven Weingärten mit Fläche – N/P je ha des Betriebs nicht berechenbar.')

  return {
    zeilen, gesamtHa, nKg, pKg,
    nKgHa: durch(nKg, gesamtHa),
    pKgHa: durch(pKg, gesamtHa),
    uebersprungen: ohneMittel.length + ohneMenge.length,
    warnungen,
  }
}

export const SPALTEN_NAEHRSTOFFBILANZ: CsvSpalte<NaehrstoffZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Weingarten', typ: 'text', wert: z => z.weingarten },
  { kopf: 'Ried', typ: 'text', wert: z => z.ried },
  { kopf: 'Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  { kopf: 'Düngemittel', typ: 'text', wert: z => z.duengemittel },
  { kopf: 'Typ', typ: 'text', wert: z => z.typ },
  { kopf: 'Menge', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.menge },
  { kopf: 'Einheit', typ: 'text', wert: z => z.einheit },
  { kopf: 'Menge (kg)', typ: 'dezimal', stellen: STELLEN_MENGE, wert: z => z.mengeKg },
  { kopf: 'Mengenbasis', typ: 'text', wert: z => z.mengeBasis },
  { kopf: 'N (%)', typ: 'prozent', wert: z => z.nPct },
  { kopf: 'P (%)', typ: 'prozent', wert: z => z.pPct },
  { kopf: 'N (kg)', typ: 'dezimal', stellen: STELLEN_NP, wert: z => z.nKg },
  { kopf: 'P (kg)', typ: 'dezimal', stellen: STELLEN_NP, wert: z => z.pKg },
  { kopf: 'N (kg/ha)', typ: 'dezimal', stellen: STELLEN_NP, wert: z => z.nKgHa },
  { kopf: 'P (kg/ha)', typ: 'dezimal', stellen: STELLEN_NP, wert: z => z.pKgHa },
]

/** Ladefunktion der Druckseite /reports/naehrstoffbilanz UND der CSV „naehrstoffbilanz“ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeNaehrstoffbilanz(supabase: any, tenantId: string, p: { jahr: number | null }): Promise<LadeErgebnis<NaehrstoffZeile> & Naehrstoffbilanz> {
  const [{ behandlungen, warnungen }, weingaerten] = await Promise.all([
    ladeBehandlungen(supabase, tenantId, { ...jahrZeitraum(p.jahr), art: 'duengung' }),
    ladeWeingaerten(supabase, tenantId),
  ])
  const bilanz = naehrstoffbilanz(behandlungen, weingaerten)
  return { ...bilanz, warnungen: [...warnungen, ...bilanz.warnungen] }
}
