// ── Korrektur trotz Sperre durch die Betriebsleitung – Bedienoberfläche (KAN-196, 06.10.2026) ──────────
// Die RPC s112_freeze_korrektur(tenant, tabelle, id, werte, grund) ändert gesperrte Felder (KAN-96), nur für
// system_admin/tenant_admin, mit Grund (≥ 10 Zeichen), protokolliert im Bestandsprotokoll. Hier je Tabelle die Felder,
// die der Baustein <FreezeKorrektur> anbietet, und die Umrechnung der Formulareingaben in die geänderten Werte.
// Erster Einsatz: Prüfnummernantrag (dac_antrag) – auch der Status (z. B. versehentlich eingereicht), bewusst an der
// Übergangsmatrix vorbei (Entscheidung KAN-196). Die Charge eines Antrags bleibt außen vor (Gültigkeit je Charge,
// KAN-99): dafür Storno und neuer Antrag. Isomorph, ohne '@/'-Importe (node:test).

import { PN_STATUS, PN_STATUS_LABEL } from '../dac/workflow'
import { zahlAus } from '../format'

export type KorrekturFeldTyp = 'text' | 'zahl' | 'datum' | 'auswahl'

export type KorrekturFeld = {
  spalte: string
  label: string
  typ: KorrekturFeldTyp
  optionen?: readonly { wert: string; label: string }[]
  /** Pflichtfeld: leer ist nicht zulässig */
  pflicht?: boolean
}

export const KORREKTUR_FELDER: Readonly<Record<string, readonly KorrekturFeld[]>> = {
  dac_antrag: [
    { spalte: 'status', label: 'Status', typ: 'auswahl', pflicht: true, optionen: PN_STATUS.map(s => ({ wert: s, label: PN_STATUS_LABEL[s] })) },
    { spalte: 'pruefnummer', label: 'Prüfnummer', typ: 'text' },
    { spalte: 'eingereicht_am', label: 'Eingereicht am', typ: 'datum' },
    { spalte: 'bescheid_am', label: 'Bescheid am', typ: 'datum' },
    { spalte: 'antragsnummer', label: 'Antragsnummer', typ: 'text' },
    { spalte: 'untersuchungsnummer', label: 'Untersuchungsnummer', typ: 'text' },
    { spalte: 'bezeichnung', label: 'Bezeichnung', typ: 'text', pflicht: true },
    { spalte: 'jahrgang', label: 'Jahrgang', typ: 'zahl' },
    { spalte: 'rebsorte', label: 'Rebsorte', typ: 'text' },
    { spalte: 'menge_liter', label: 'Menge (l)', typ: 'zahl' },
    { spalte: 'alkohol_prozent', label: 'Alkohol (% vol)', typ: 'zahl' },
  ],
  // KAN-222 (Entscheidung 06.10.2026): weitere gesperrte Tabellen. Felder, die Bestand oder Folgebuchungen verfälschen
  // würden, bleiben außen vor – dafür Storno und Neuanlage bzw. der fachliche Vorgang (Abstufen, Umziehen …). Das Journal
  // (y_journal) und die Prüfnummer je Charge (z_pn_chargen) ziehen eine Korrektur über ihre Update-Trigger nach; die
  // Periodensperre des Kellerbuchs gilt weiter.
  // Füllung (KAN-101): Anzahl und Flaschengröße nicht (Bestand der Charge) – Storno + Neuanlage
  fuellungen: [
    { spalte: 'datum', label: 'Abfülldatum', typ: 'datum', pflicht: true },
    { spalte: 'chargennummer', label: 'Los-/Chargennummer', typ: 'text' },
    { spalte: 'jahrgang', label: 'Jahrgang', typ: 'zahl' },
    { spalte: 'rebsorte', label: 'Rebsorte', typ: 'text' },
  ],
  // Kellerbehandlung unter einer Prüfnummer (KAN-206): Typ nicht (Wirkung auf die Prüfnummer), Zugang nicht (Bestand)
  keller_behandlungen: [
    { spalte: 'datum', label: 'Datum', typ: 'datum', pflicht: true },
    { spalte: 'menge', label: 'Menge', typ: 'zahl' },
    { spalte: 'einheit', label: 'Einheit', typ: 'text' },
  ],
  // Charge bei eingereichtem Prüfnummernantrag (KAN-204): Qualität, Zusatz, Herkunft nur über „Abstufen“ (KAN-82),
  // Aufwertungssperre gilt weiter
  weinausbau: [
    { spalte: 'jahrgang', label: 'Jahrgang', typ: 'zahl' },
    { spalte: 'rebsorte', label: 'Rebsorte', typ: 'text' },
    { spalte: 'weinart', label: 'Weinart', typ: 'auswahl', optionen: [
      { wert: 'weiss', label: 'Weißwein' }, { wert: 'rot', label: 'Rotwein' }, { wert: 'rose', label: 'Rosé' }, { wert: 'unbekannt', label: 'unbekannt' },
    ] },
  ],
  // Maßnahme nach der Lese der Ried (KAN-169): Ried, Mittel und Grundstücke nicht (Struktur der Aufzeichnung)
  behandlungen: [
    { spalte: 'datum', label: 'Datum', typ: 'datum', pflicht: true },
    { spalte: 'datum_bis', label: 'Datum bis', typ: 'datum' },
    { spalte: 'aufwandmenge', label: 'Aufwandmenge', typ: 'zahl' },
    { spalte: 'menge_gesamt', label: 'Menge gesamt', typ: 'zahl' },
    { spalte: 'wasseraufwand_l_ha', label: 'Wasseraufwand (l/ha)', typ: 'zahl' },
    { spalte: 'behandelte_flaeche_ha', label: 'Behandelte Fläche (ha)', typ: 'zahl' },
    { spalte: 'bbch_stadium', label: 'BBCH-Stadium', typ: 'text' },
    { spalte: 'schaderreger', label: 'Schaderreger', typ: 'text' },
    { spalte: 'temperatur_c', label: 'Temperatur (°C)', typ: 'zahl' },
    { spalte: 'anwender_name', label: 'Anwender', typ: 'text' },
  ],
}

/** Seiten, die nach einer Korrektur neu geladen werden ('[id]' = Datensatz) */
export const KORREKTUR_PFADE: Readonly<Record<string, readonly string[]>> = {
  dac_antrag: ['/dac', '/dac/[id]'],
  fuellungen: ['/weinhandel', '/weinhandel/fuellungen/[id]/edit'],
  keller_behandlungen: ['/kellerbuch'],
  weinausbau: ['/kellerbuch', '/kellerbuch/weinausbau/[id]'],
  behandlungen: ['/behandlungen', '/behandlungen/[id]/edit'],
}

export function korrekturGrundFehler(grund: string | null | undefined): string | null {
  return (grund ?? '').trim().length < 10 ? 'Bitte einen Grund für die Korrektur angeben (mindestens 10 Zeichen).' : null
}

/** Anzeigewert eines gespeicherten Werts für das Formular (Datum als JJJJ-MM-TT, Zahl mit Komma) */
export function korrekturAnzeige(feld: KorrekturFeld, wert: unknown): string {
  if (wert === null || wert === undefined) return ''
  if (feld.typ === 'datum') return String(wert).slice(0, 10)
  if (feld.typ === 'zahl') return String(wert).replace('.', ',')
  return String(wert)
}

const TAG_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Geänderte Werte aus den Formulareingaben (nur Felder der Tabelle, nur echte Änderungen).
 * Fehler bei unbekannter Tabelle, ungültiger Zahl/Datum, leerem Pflichtfeld bzw. ohne Änderung.
 */
export function korrekturAenderungen(
  tabelle: string,
  alt: Readonly<Record<string, unknown>>,
  eingabe: Readonly<Record<string, string | null | undefined>>,
  heute: string,
): { werte: Record<string, unknown> } | { fehler: string } {
  const felder = KORREKTUR_FELDER[tabelle]
  if (!felder) return { fehler: 'Für diese Daten gibt es keine Korrektur durch die Betriebsleitung.' }
  const werte: Record<string, unknown> = {}
  for (const f of felder) {
    if (!(f.spalte in eingabe)) continue
    const roh = (eingabe[f.spalte] ?? '').trim()
    let neu: unknown
    if (roh === '') {
      if (f.pflicht) return { fehler: `${f.label} darf nicht leer sein.` }
      neu = null
    } else if (f.typ === 'zahl') {
      const n = zahlAus(roh)
      if (n === null) return { fehler: `${f.label}: bitte eine Zahl angeben.` }
      neu = n
    } else if (f.typ === 'datum') {
      if (!TAG_RE.test(roh)) return { fehler: `${f.label}: bitte ein Datum angeben.` }
      if (roh > heute) return { fehler: `${f.label} liegt in der Zukunft.` }
      neu = roh
    } else if (f.typ === 'auswahl') {
      if (!f.optionen?.some(o => o.wert === roh)) return { fehler: `${f.label}: ungültiger Wert.` }
      neu = roh
    } else {
      neu = roh
    }
    const bisher = alt[f.spalte] ?? null
    const gleich = f.typ === 'zahl'
      ? (bisher === null ? neu === null : neu !== null && Number(bisher) === neu)
      : f.typ === 'datum' ? (bisher === null ? neu === null : String(bisher).slice(0, 10) === neu)
      : bisher === neu
    if (!gleich) werte[f.spalte] = neu
  }
  if (Object.keys(werte).length === 0) return { fehler: 'Keine Änderung – bitte mindestens einen Wert ändern.' }
  if (tabelle === 'dac_antrag') {
    // Entzug braucht Datum und Grund (CHECK dac_antrag_entzug_chk) – nur über den Statuswechsel
    if ('status' in werte && (werte.status === 'entzogen' || alt.status === 'entzogen')) {
      return { fehler: 'Entzug und Aufhebung eines Entzugs nur über den Statuswechsel (mit Datum und Grund).' }
    }
    const f = pnKorrekturFehler({ ...alt, ...werte })
    if (f) return { fehler: f }
  }
  return { werte }
}

/** Stimmigkeit eines Prüfnummernantrags nach der Korrektur (wie der Statuswechsel sie verlangt) */
export function pnKorrekturFehler(a: Readonly<Record<string, unknown>>): string | null {
  const s = String(a.status ?? '')
  const leer = (k: string) => a[k] === null || a[k] === undefined || String(a[k]).trim() === ''
  if (s !== 'entwurf' && leer('eingereicht_am')) return 'Ab „Eingereicht“ braucht der Antrag ein Einreichdatum.'
  if (s === 'entwurf' && !leer('eingereicht_am')) return 'Ein Entwurf hat kein Einreichdatum – bitte das Datum leeren.'
  if (s === 'genehmigt' && leer('pruefnummer')) return 'Für „Zugeteilt“ fehlt die Prüfnummer.'
  if (s === 'genehmigt' && leer('bescheid_am')) return 'Für „Zugeteilt“ fehlt das Bescheiddatum.'
  if (!leer('eingereicht_am') && !leer('bescheid_am') && String(a.bescheid_am).slice(0, 10) < String(a.eingereicht_am).slice(0, 10)) {
    return 'Der Bescheid liegt vor der Einreichung.'
  }
  return null
}
