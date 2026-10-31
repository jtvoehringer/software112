// ── Widgets der Übersicht (KAN-386/387, 31.10.2026) ─────────────────────────────
//
// Die Übersicht (/dashboard) besteht aus Widgets. Dieses Register beschreibt je Widget Größe, benötigte Daten
// und Sichtbarkeit; STANDARD_LAYOUT ist die Übersicht, wie sie bis KAN-387 fest gebaut war. Die Darstellung je
// Widget liegt unter app/(dashboard)/dashboard/_widgets/, die Ladefunktionen in dashboard/_shared/widgetDaten.ts.
// Ab KAN-388 kann jeder Benutzer eine eigene Reihenfolge speichern – das Register bleibt die einzige Quelle für
// das, was es gibt und wer es sehen darf.
//
// Rein (ohne Supabase und '@/'-Importe), damit node:test es ohne Bundler lädt.

/** klein = Kachel (2 je Zeile am Handy, 4 am PC), mittel = halbe Breite am PC, breit = ganze Zeile */
export type WidgetGroesse = 'klein' | 'mittel' | 'breit'

/** Datenquellen der Übersicht – jede wird höchstens einmal geladen, auch wenn mehrere Widgets sie brauchen */
export type WidgetQuelle =
  | 'keller' | 'flaschen' | 'offenePosten' | 'fristen' | 'checklisten'
  | 'weingarten' | 'finanzen' | 'morgenbericht' | 'aufgabenTermine'

/** Was die Sichtbarkeit entscheidet (aus Rolle und Betriebseinstellungen) */
export type WidgetKontext = {
  /** E&A bzw. Doppik-Übersicht aktiv (tenant_einstellungen.modul_ea) */
  modulEa: boolean
  /** mindestens eine Schnellaktion erlaubt (Schreibrecht in Rieden, Kellerbuch oder Warenwirtschaft) */
  schnellaktionen: boolean
}

export type WidgetDef = {
  id: string
  titel: string
  groesse: WidgetGroesse
  quellen: readonly WidgetQuelle[]
  sichtbar?: (k: WidgetKontext) => boolean
  /** nur am Handy (unter sm) – steht in einem eigenen Abschnitt, damit am PC kein leerer Abstand bleibt */
  nurHandy?: boolean
}

export const WIDGETS = [
  { id: 'schnellaktionen', titel: 'Schnellaktionen (Handy)', groesse: 'breit', quellen: [], sichtbar: k => k.schnellaktionen, nurHandy: true },
  { id: 'kellerbestand', titel: 'Kellerbestand', groesse: 'klein', quellen: ['keller'] },
  { id: 'flaschenlager', titel: 'Flaschenlager', groesse: 'klein', quellen: ['flaschen'] },
  { id: 'offene-posten', titel: 'Offene Posten', groesse: 'klein', quellen: ['offenePosten'] },
  { id: 'offene-aufgaben', titel: 'Offene Aufgaben', groesse: 'klein', quellen: ['keller', 'fristen', 'checklisten'] },
  { id: 'finanzen', titel: 'Finanzen', groesse: 'breit', quellen: ['finanzen'], sichtbar: k => k.modulEa },
  { id: 'naechste-schritte', titel: 'Nächste Schritte', groesse: 'mittel', quellen: ['keller', 'fristen', 'weingarten'] },
  { id: 'morgenbericht', titel: 'Morgenbericht', groesse: 'mittel', quellen: ['morgenbericht'] },
  { id: 'aufgaben-termine', titel: 'Aufgaben & Termine', groesse: 'breit', quellen: ['aufgabenTermine'] },
  { id: 'schnellzugriff', titel: 'Schnellzugriff', groesse: 'breit', quellen: [] },
] as const satisfies readonly WidgetDef[]

export type WidgetId = (typeof WIDGETS)[number]['id']

/** Ein Eintrag eines Layouts: Widget und (ab KAN-388 wählbar) Größe */
export type LayoutEintrag = { id: string; groesse?: WidgetGroesse }

/** Die Übersicht wie bis KAN-387 – Standard für alle ohne eigenes Layout */
export const STANDARD_LAYOUT: readonly LayoutEintrag[] = WIDGETS.map(w => ({ id: w.id }))

const NACH_ID = new Map<string, WidgetDef>(WIDGETS.map(w => [w.id, w]))

export type SichtbaresWidget = { def: WidgetDef; groesse: WidgetGroesse }

/** Widgets eines Layouts in dessen Reihenfolge – unbekannte, doppelte und hier nicht sichtbare fallen weg */
export function sichtbareWidgets(layout: readonly LayoutEintrag[], k: WidgetKontext): SichtbaresWidget[] {
  const out: SichtbaresWidget[] = []
  const gesehen = new Set<string>()
  for (const e of layout) {
    const def = NACH_ID.get(e.id)
    if (!def || gesehen.has(def.id)) continue
    gesehen.add(def.id)
    if (def.sichtbar && !def.sichtbar(k)) continue
    out.push({ def, groesse: e.groesse ?? def.groesse })
  }
  return out
}

/** Quellen, die die sichtbaren Widgets brauchen – nur diese werden geladen */
export function benoetigteQuellen(widgets: readonly SichtbaresWidget[]): Set<WidgetQuelle> {
  return new Set(widgets.flatMap(w => w.def.quellen))
}

/** Folgen der Übersicht: Kacheln stehen in eigenen Reihen, alles andere im Karten-Raster; Widgets nur fürs Handy
 *  in eigenen Abschnitten (am PC ganz ausgeblendet) */
export type WidgetAbschnitt = { art: 'kacheln' | 'karten'; nurHandy: boolean; widgets: SichtbaresWidget[] }

export function abschnitte(widgets: readonly SichtbaresWidget[]): WidgetAbschnitt[] {
  const out: WidgetAbschnitt[] = []
  for (const w of widgets) {
    const art = w.groesse === 'klein' ? 'kacheln' : 'karten'
    const nurHandy = !!w.def.nurHandy
    const letzter = out[out.length - 1]
    if (letzter && letzter.art === art && letzter.nurHandy === nurHandy) letzter.widgets.push(w)
    else out.push({ art, nurHandy, widgets: [w] })
  }
  return out
}
