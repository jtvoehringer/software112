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
