// Sorten- und Jahrgangsangabe nach einem Verschnitt aus den tatsächlichen Anteilen (KAN-93, 02.10.2026)
//
// Vorher rechnete der Verschnitt den GESAMTEN Zielbestand der aktuellen Rebsorte der Ziel-Charge zu (1.000 L Riesling
// mit 150 L GV darin + 150 L GV blieb „Riesling“, rechnerisch 88 % statt tatsächlich 76,9 %), und der Jahrgang wurde
// nie geprüft (350 L GV 2025 in 2.750 L Weißburgunder 2026 = 11,3 % Fremdjahrgang – erlaubt; bei 20 % nicht mehr).
//
// Regel (85 %, Art. 49/50 Del. VO (EU) 2019/33; Wortlaut in AP0/KAN-38 zu bestätigen):
//  • Rebsorte: Eine Sorte mit mindestens 85 % der Menge bleibt die Angabe; sonst „Sortenverschnitt weiß/rot/Rosé“
//    (BKI-Kürzel SW/SO/SR, lib/wein/bki_kuerzel.ts) nach der Weinart der Charge.
//  • Jahrgang: Ein Jahrgang mit mindestens 85 % bleibt; sonst kein Jahrgang („Jahrgangsverschnitt“). Eine Charge ohne
//    Jahrgang bekommt durch einen Verschnitt keinen (der Storno stellt nur einen bisherigen Jahrgang wieder her).
// Die Anteile kommen aus dem Rechenkern (KAN-76, lib/wein/mischungsrechnung.ts: sortenAnteile/jahrgangsAnteile);
// „unbekannt“ (Anteile ohne Rebsorte bzw. Jahrgang) kann nie die Angabe sein.
//
// Isomorph und ohne Importe (node:test, Formular-Vorschau und Server Action rechnen gleich).

export interface GruppenMenge { wert: string; liter: number }

export const SCHWELLE = 0.85

/** „Sortenverschnitt“ mit Farbe nach der Weinart (weiss/rot/rose); ohne bekannte Weinart ohne Farbe */
export function sortenverschnittBezeichnung(weinart: string | null | undefined): string {
  if (weinart === 'weiss') return 'Sortenverschnitt weiß'
  if (weinart === 'rot') return 'Sortenverschnitt rot'
  if (weinart === 'rose') return 'Sortenverschnitt Rosé'
  return 'Sortenverschnitt'
}

/**
 * KAN-89: Rebsorte einer Pressung aus mehreren Sorten – nie mehr „Sortenverschnitt“ ohne Farbe. Bekannte Weinart der
 * Grundstücke bzw. Rieden (weiss/rot/rose) → „Sortenverschnitt weiß/rot/Rosé“; sonst nach der Farbe der Sorten laut
 * BKI-Kürzelliste (`farben`, z. B. aus bkiFarbe()): nur weiß → weiß, nur rot → rot, rot und weiß gemeinsam gepresst →
 * „Sortenverschnitt gleichgepresst“ (SP). Ohne bekannte Farbe einer Sorte bleibt es „Sortenverschnitt“ – die Prüfseite
 * „Rebsorten ohne Kürzel“ zeigt das an.
 */
export function pressungSortenverschnitt(weinart: string | null | undefined, farben: readonly ('weiss' | 'rot' | null)[]): string {
  if (weinart === 'weiss' || weinart === 'rot' || weinart === 'rose') return sortenverschnittBezeichnung(weinart)
  if (farben.length === 0 || farben.some(f => f === null)) return 'Sortenverschnitt'
  const weiss = farben.includes('weiss')
  const rot = farben.includes('rot')
  if (weiss && rot) return 'Sortenverschnitt gleichgepresst'
  return sortenverschnittBezeichnung(rot ? 'rot' : 'weiss')
}

/** KAN-113: Weinart aus „Sortenverschnitt weiß/rot/Rosé“ (für die Farbe des Vorschlags), sonst null */
export function weinartAusSortenverschnitt(rebsorte: string | null | undefined): 'weiss' | 'rot' | 'rose' | null {
  if (!istSortenverschnitt(rebsorte)) return null
  const t = (rebsorte ?? '').toLocaleLowerCase('de')
  // ohne \b am Ende: ß und é zählen in JS-Regex nicht als Wortzeichen
  if (/\bros[ée]/.test(t)) return 'rose'
  if (/\brot\b/.test(t)) return 'rot'
  if (/\bwei(ß|ss)/.test(t)) return 'weiss'
  return null
}

/** true für alle Schreibweisen von „Sortenverschnitt …“ */
export function istSortenverschnitt(rebsorte: string | null | undefined): boolean {
  return !!rebsorte && /^sortenverschnitt\b/i.test(rebsorte.trim())
}

function dominant(gruppen: readonly GruppenMenge[]): { wert: string; anteil: number } | null {
  const summe = gruppen.reduce((s, g) => s + (g.liter > 0 ? g.liter : 0), 0)
  if (!(summe > 0)) return null
  const top = [...gruppen].filter(g => g.liter > 0).sort((a, b) => b.liter - a.liter)[0]
  return top ? { wert: top.wert, anteil: top.liter / summe } : null
}

export interface SortenErgebnis {
  rebsorte: string | null
  jahrgang: number | null
  /** Anteil der führenden Sorte bzw. des führenden Jahrgangs (0–1), null ohne Daten */
  sortenAnteil: number | null
  jahrgangsAnteil: number | null
  /** Hinweise, wenn eine Angabe wegfällt oder wechselt – für Vorschau und Vermerk */
  hinweise: string[]
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('de-AT')} %`

/**
 * Angaben der Ziel-Charge nach dem Verschnitt. `bisher` = Rebsorte/Jahrgang der Ziel-Charge vorher (bleiben, wenn es
 * keine Anteile gibt), `weinart` = Weinart der Ziel-Charge (Farbe des Sortenverschnitts).
 */
export function sortenBezeichnung(
  sorten: readonly GruppenMenge[],
  jahrgaenge: readonly GruppenMenge[],
  bisher: { rebsorte: string | null; jahrgang: number | null; weinart: string | null },
): SortenErgebnis {
  const hinweise: string[] = []
  // Rebsorte
  let rebsorte = bisher.rebsorte
  const ds = dominant(sorten)
  let sortenAnteil: number | null = null
  // Ohne jede bekannte Sorte gibt es nichts zu entscheiden – die bisherige Angabe bleibt
  const mitSorte = sorten.some(g => g.liter > 0 && g.wert !== 'unbekannt')
  if (ds && mitSorte) {
    sortenAnteil = ds.anteil
    const echteSorte = ds.wert !== 'unbekannt' && !istSortenverschnitt(ds.wert)
    rebsorte = echteSorte && ds.anteil >= SCHWELLE - 1e-9 ? ds.wert : sortenverschnittBezeichnung(bisher.weinart)
    if (rebsorte !== bisher.rebsorte && bisher.rebsorte) {
      hinweise.push(istSortenverschnitt(rebsorte) && !istSortenverschnitt(bisher.rebsorte)
        ? `Rebsorte „${bisher.rebsorte}“ entfällt: keine Sorte erreicht 85 % (führend ${ds.wert === 'unbekannt' ? 'unbekannt' : ds.wert} mit ${pct(ds.anteil)}) – neu „${rebsorte}“`
        : `Rebsorte wechselt von „${bisher.rebsorte}“ auf „${rebsorte}“`)
    }
  }
  // Jahrgang
  let jahrgang = bisher.jahrgang
  const dj = dominant(jahrgaenge)
  let jahrgangsAnteil: number | null = null
  const mitJahrgang = jahrgaenge.some(g => g.liter > 0 && g.wert !== 'unbekannt')
  if (dj && mitJahrgang && bisher.jahrgang != null) {
    jahrgangsAnteil = dj.anteil
    const j = Number(dj.wert)
    if (dj.wert !== 'unbekannt' && Number.isInteger(j) && dj.anteil >= SCHWELLE - 1e-9) {
      jahrgang = j
    } else {
      jahrgang = null
    }
    if (jahrgang !== bisher.jahrgang) {
      hinweise.push(jahrgang == null
        ? `Jahrgang ${bisher.jahrgang} entfällt: kein Jahrgang erreicht 85 % (führend ${dj.wert} mit ${pct(dj.anteil)}) – Jahrgangsverschnitt`
        : `Jahrgang wechselt von ${bisher.jahrgang} auf ${jahrgang} (${pct(dj.anteil)})`)
    }
  }
  return { rebsorte, jahrgang, sortenAnteil, jahrgangsAnteil, hinweise }
}

/** Gruppen zusammenfassen (Anteile mehrerer Chargen addieren) */
export function addiereGruppen(...listen: readonly (readonly GruppenMenge[])[]): GruppenMenge[] {
  const m = new Map<string, number>()
  for (const l of listen) for (const g of l) m.set(g.wert, (m.get(g.wert) ?? 0) + g.liter)
  return [...m.entries()].map(([wert, liter]) => ({ wert, liter }))
}

// ── Sortenangabe auf Füllung und Etikett (KAN-113, 07.10.2026) ──────────────────────────────────────────────
// Art. 50 Del. VO (EU) 2019/33 (Wortlaut in AP0/KAN-38 zu bestätigen): Bei mehreren Sorten müssen die genannten Sorten
// 100 % ergeben, absteigend nach Menge und in gleicher Schriftgröße; eine Sorte allein erst ab 85 % (SCHWELLE, dieselbe
// Regel wie sortenBezeichnung). Grundlage sind die Anteile aus dem Rechenkern (sortenAnteile, KAN-76) – hier entsteht
// keine eigene Mischungsrechnung. Entscheidung Jörgen 06.10.2026: „Cuvée“ und „Gemischter Satz“ als Bezeichnung ohne
// Sorte mit anbieten. Rechnung und Lieferschein bleiben unverändert.

/** Anteil einer Sorte – `liter` (falls bekannt) gewichtet, sonst `anteil_pct` */
export interface SortenAnteil { wert: string; liter?: number | null; anteil_pct: number }

export const CUVEE = 'Cuvée'
export const GEMISCHTER_SATZ = 'Gemischter Satz'
/** Trennzeichen der Aufzählung auf Füllung und Etikett („Zweigelt – Blaufränkisch – St. Laurent“) */
export const SORTEN_TRENNER = ' – '

const gewicht = (a: SortenAnteil) => (a.liter != null && a.liter > 0 ? a.liter : a.anteil_pct > 0 ? a.anteil_pct : 0)
const istUnbekannt = (w: string) => w.trim() === '' || w === 'unbekannt'
const fmtPct = (x: number) => `${(Math.round(x * 10) / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`

function aufbereitet(anteile: readonly SortenAnteil[]) {
  const mit = anteile.filter(a => gewicht(a) > 0)
  const summe = mit.reduce((s, a) => s + gewicht(a), 0)
  const sorten = mit.filter(a => !istUnbekannt(a.wert) && !istSortenverschnitt(a.wert))
    .map(a => ({ wert: a.wert.trim(), gewicht: gewicht(a), anteil: summe > 0 ? gewicht(a) / summe : 0 }))
    .sort((x, y) => (y.gewicht - x.gewicht) || x.wert.localeCompare(y.wert, 'de'))
  const ohneSorte = summe > 0 ? mit.filter(a => istUnbekannt(a.wert) || istSortenverschnitt(a.wert)).reduce((s, a) => s + gewicht(a), 0) / summe : 0
  return { sorten, ohneSorte }
}

/** „Zweigelt 60 % · Blaufränkisch 30 % · St. Laurent 10 %“ – absteigend; Anteile ohne Rebsorte als „ohne Rebsorte“ am Ende */
export function sortenAnteilText(anteile: readonly SortenAnteil[]): string | null {
  const { sorten, ohneSorte } = aufbereitet(anteile)
  if (sorten.length === 0) return null
  const teile = sorten.map(s => `${s.wert} ${fmtPct(s.anteil * 100)}`)
  if (ohneSorte > 0.0005) teile.push(`ohne Rebsorte ${fmtPct(ohneSorte * 100)}`)
  return teile.join(' · ')
}

export interface SortenVorschlag {
  /** Vorschlag für das Feld Rebsorte (Füllung) bzw. die Sortenangabe am Etikett; null ohne bekannte Sorte */
  vorschlag: string | null
  /** weitere zulässige Angaben (Aufzählung, Sortenverschnitt, Cuvée, Gemischter Satz) */
  alternativen: string[]
  /** Anteile als Text (sortenAnteilText) */
  text: string | null
  /** Hinweis, warum keine Aufzählung möglich ist */
  hinweis: string | null
}

/**
 * Vorschlag der Sortenangabe: eine Sorte ab 85 % allein, sonst alle Sorten absteigend („Zweigelt – Blaufränkisch –
 * St. Laurent“); mit Anteilen ohne Rebsorte nur „Sortenverschnitt <Farbe>“ (eine Aufzählung ergäbe keine 100 %).
 */
export function sortenAngabeVorschlag(anteile: readonly SortenAnteil[], weinart: string | null | undefined): SortenVorschlag {
  const { sorten, ohneSorte } = aufbereitet(anteile)
  const text = sortenAnteilText(anteile)
  if (sorten.length === 0) return { vorschlag: null, alternativen: [], text, hinweis: null }
  const aufzaehlung = ohneSorte > 0.0005 ? null : sorten.map(s => s.wert).join(SORTEN_TRENNER)
  const einzel = sorten[0].anteil >= SCHWELLE - 1e-9 ? sorten[0].wert : null
  const generisch = [sortenverschnittBezeichnung(weinart), CUVEE, GEMISCHTER_SATZ]
  const vorschlag = einzel ?? aufzaehlung ?? generisch[0]
  const alternativen = [...new Set([...(sorten.length > 1 && aufzaehlung ? [aufzaehlung] : []), ...generisch])].filter(a => a !== vorschlag)
  const hinweis = !einzel && !aufzaehlung
    ? `Ein Teil des Weins (${fmtPct(ohneSorte * 100)}) hat keine bekannte Rebsorte – eine Aufzählung der Sorten ergäbe keine 100 %.`
    : null
  return { vorschlag, alternativen, text, hinweis }
}

const norm = (s: string) => s.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()

/** Bezeichnung ohne Sortenaufzählung (Sortenverschnitt, Cuvée, Gemischter Satz) – keine Prüfung der Sorten */
export function istSortenfreieAngabe(angabe: string | null | undefined): boolean {
  const t = (angabe ?? '').trim()
  return istSortenverschnitt(t) || /^cuv[ée]e\b/i.test(t) || /^gemischter satz\b/i.test(t)
}

/**
 * Prüfung einer Sortenangabe gegen die Zusammensetzung – Warnungen (keine Sperre): genannte Sorte nicht im Wein, eine
 * Sorte allein unter 85 %, bei mehreren Sorten fehlende Sorten (keine 100 %) und falsche Reihenfolge. Leer bzw.
 * Sortenverschnitt/Cuvée/Gemischter Satz: keine Warnung.
 */
export function sortenAngabePruefen(angabe: string | null | undefined, anteile: readonly SortenAnteil[]): string[] {
  const t = (angabe ?? '').trim()
  if (!t || istSortenfreieAngabe(t)) return []
  const { sorten, ohneSorte } = aufbereitet(anteile)
  if (sorten.length === 0) return []
  const teile = [...new Set(t.split(/\s+[–-]\s+|\s*[,·/&]\s*|\s+und\s+/i).map(x => x.trim()).filter(Boolean).map(norm))]
  const warnungen: string[] = []
  const genannt: typeof sorten = []
  for (const teil of teile) {
    const s = sorten.find(x => norm(x.wert) === teil)
    if (s) genannt.push(s)
    else warnungen.push(`„${t.split(/\s+[–-]\s+|\s*[,·/&]\s*|\s+und\s+/i).map(x => x.trim()).find(x => norm(x) === teil) ?? teil}“ ist laut Zusammensetzung nicht im Wein.`)
  }
  const reihenfolge = sorten.map(s => s.wert).join(SORTEN_TRENNER)
  if (genannt.length === 1 && teile.length === 1) {
    const s = genannt[0]
    if (s.anteil < SCHWELLE - 1e-9) {
      warnungen.push(`„${s.wert}“ allein erst ab 85 % – hier ${fmtPct(s.anteil * 100)}. Alle Sorten absteigend angeben (${reihenfolge}) oder eine Bezeichnung ohne Sorte wählen.`)
    }
  } else if (genannt.length > 1) {
    const fehlend = sorten.filter(s => !genannt.includes(s))
    if (fehlend.length > 0) {
      warnungen.push(`Bei mehreren Sorten alle angeben (100 %) – es fehlt: ${fehlend.map(s => `${s.wert} (${fmtPct(s.anteil * 100)})`).join(', ')}.`)
    }
    if (ohneSorte > 0.0005) warnungen.push(`${fmtPct(ohneSorte * 100)} des Weins haben keine bekannte Rebsorte – die genannten Sorten ergeben keine 100 %.`)
    for (let i = 1; i < genannt.length; i++) {
      if (genannt[i].gewicht > genannt[i - 1].gewicht + 1e-9) {
        warnungen.push(`Reihenfolge absteigend nach Menge: ${genannt.slice().sort((x, y) => y.gewicht - x.gewicht).map(s => s.wert).join(SORTEN_TRENNER)}.`)
        break
      }
    }
  }
  return warnungen
}
