// ── Lesedatum je Pressungszeile (KAN-126, 29.09.2026) ──────────────────────────────────────────────────
//
// pressung_weingaerten.ernte_datum (seit Migration 072) wurde vom Pressungsformular nie geschrieben; die
// Rückverfolgung (KAN-75) und das Blend-Protokoll rechneten deshalb mit einem Ersatz aus der Erntemeldung.
// Jetzt wählt die Pressung den Lesetag je Traubenzeile: eine Option je Ort UND Lesetag, bei genau einem
// Lesetag vorbelegt, dazu das Mostgewicht dieses Lesetags (änderbar).
//
// Entscheidungen Jörgen (29.09.2026): Zukauf-Zeilen bekommen das Zukaufsdatum; eine Lese im Folgejahr
// (Eiswein) ist bis zum 31.03. zulässig; der Lesedaten-Sync befüllt nur den Eintrag desselben Lesetags.
//
// Ohne '@/'-Importe und ohne JSX, damit node:test sie prüfen kann (Formular und Server nutzen dieselben Regeln).

/** Eintrag der Erntemeldung (ernte_parzellen), soweit für die Pressung nötig */
export type LeseEintrag = {
  weingarten_id: string
  grundstueck_id: string | null
  ernte_datum: string | null
  /** °KMW (ernte_parzellen.klosterneuburger) */
  kmw: number | null
  oechsle: number | null
  mostgewicht_einheit: string | null
}

/** Ein Lesetag an einem Ort; Mostgewicht nur, wenn alle Einträge dieses Tages dasselbe haben */
export type Lesetag = { datum: string; kmw: number | null; oechsle: number | null; einheit: 'kmw' | 'oechsle' | null }

/** Letzter zulässiger Lesetag im Folgejahr des Jahrgangs (Eiswein), als 'MM-TT' */
export const LESE_FOLGEJAHR_BIS = '03-31'

const TAG = /^\d{4}-\d{2}-\d{2}$/

function kalendertag(d: string | null | undefined): string | null {
  const t = String(d ?? '').slice(0, 10)
  if (!TAG.test(t)) return null
  const [j, m, tt] = t.split('-').map(Number)
  const x = new Date(Date.UTC(j, m - 1, tt))
  return x.getUTCFullYear() === j && x.getUTCMonth() === m - 1 && x.getUTCDate() === tt ? t : null
}

/** 'JJJJ-MM-TT' → 'TT.MM.JJJJ' */
export function datumText(d: string): string {
  const [j, m, t] = d.slice(0, 10).split('-')
  return `${t}.${m}.${j}`
}

/**
 * Lesetage eines Orts. Ortsregel wie der Ersatz der Rückverfolgung (ersatzAusErntemeldung): mit GST die
 * Einträge dieses GST plus die Einträge ohne GST am selben Weingarten, ohne GST alle Einträge des Weingartens.
 * Einträge ohne Lesedatum zählen nicht als Lesetag. Aufsteigend nach Datum.
 */
export function lesetageFuerOrt(eintraege: readonly LeseEintrag[], weingartenId: string, grundstueckId: string | null): Lesetag[] {
  const amOrt = (e: LeseEintrag) => grundstueckId
    ? e.grundstueck_id === grundstueckId || (!e.grundstueck_id && e.weingarten_id === weingartenId)
    : e.weingarten_id === weingartenId
  const jeTag = new Map<string, LeseEintrag[]>()
  for (const e of eintraege) {
    const d = kalendertag(e.ernte_datum)
    if (!d || !amOrt(e)) continue
    jeTag.set(d, [...(jeTag.get(d) ?? []), e])
  }
  return [...jeTag.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([datum, liste]) => {
    const mitWert = liste.filter(e => e.kmw != null || e.oechsle != null)
    const erster = mitWert[0]
    const eindeutig = erster && mitWert.length === liste.length
      && mitWert.every(e => e.kmw === erster.kmw && e.oechsle === erster.oechsle)
    const einheit = erster?.mostgewicht_einheit === 'oechsle' ? 'oechsle' : erster?.mostgewicht_einheit === 'kmw' ? 'kmw' : null
    return eindeutig
      ? { datum, kmw: erster.kmw, oechsle: erster.oechsle, einheit: einheit ?? (erster.kmw != null ? 'kmw' : 'oechsle') }
      : { datum, kmw: null, oechsle: null, einheit: null }
  })
}

/** Vorbelegung: genau ein Lesetag → dieser; keiner oder mehrere → null (Feld leer bzw. Auswahl je Tag) */
export function vorbelegterLesetag(tage: readonly Lesetag[]): Lesetag | null {
  return tage.length === 1 ? tage[0] : null
}

/**
 * Prüfregel für das Lesedatum einer Traubenzeile (Server und Formular). null = in Ordnung.
 *   - pflicht (Zeile aus eigener Lese, neu oder geändert): Datum muss gesetzt sein
 *   - nicht nach dem Pressungsdatum
 *   - nicht vor dem 01.01. des Jahrgangs, nicht nach dem 31.03. des Folgejahres (Eiswein)
 */
export function lesedatumFehler(
  datum: string | null | undefined,
  o: { pressungDatum: string; jahrgang: number | null; pflicht: boolean },
): string | null {
  const roh = String(datum ?? '').trim()
  if (!roh) return o.pflicht ? 'Bitte das Lesedatum angeben.' : null
  const d = kalendertag(roh)
  if (!d) return 'Das Lesedatum ist kein gültiges Datum.'
  const p = kalendertag(o.pressungDatum)
  if (p && d > p) return `Das Lesedatum ${datumText(d)} liegt nach dem Pressungsdatum ${datumText(p)}.`
  if (o.jahrgang != null) {
    const von = `${o.jahrgang}-01-01`
    const bis = `${o.jahrgang + 1}-${LESE_FOLGEJAHR_BIS}`
    if (d < von) return `Das Lesedatum ${datumText(d)} liegt vor dem 01.01.${o.jahrgang} (Jahrgang ${o.jahrgang}).`
    if (d > bis) return `Das Lesedatum ${datumText(d)} liegt nach dem ${datumText(bis)} – später als Ende März des Folgejahres (Eiswein) ist keine Lese des Jahrgangs ${o.jahrgang}.`
  }
  return null
}
