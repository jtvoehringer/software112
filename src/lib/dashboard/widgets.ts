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
  | 'weingarten' | 'finanzen' | 'morgenbericht' | 'aufgabenTermine' | 'umsatz'

/** Was die Sichtbarkeit entscheidet (aus Rolle und Betriebseinstellungen) */
export type WidgetKontext = {
  /** E&A bzw. Doppik-Übersicht aktiv (tenant_einstellungen.modul_ea) */
  modulEa: boolean
  /** mindestens eine Schnellaktion erlaubt (Schreibrecht in Rieden, Kellerbuch oder Warenwirtschaft) */
  schnellaktionen: boolean
  /** Weingarten-Modul aktiv (tenant_einstellungen.modul_weingarten, KAN-389) – ohne Angabe aus */
  modulWeingarten?: boolean
}

/** Herkunft eines Widgets – gliedert die weiteren Widgets im Fenster „Dashboard anpassen“ (KAN-389) */
export type WidgetBereich = 'uebersicht' | 'verkauf' | 'keller' | 'weingarten' | 'fristen'

export const BEREICH_TITEL: Record<WidgetBereich, string> = {
  uebersicht: 'Übersicht', verkauf: 'Verkauf & CRM', keller: 'Kellerbuch', weingarten: 'Weingarten & Ernte', fristen: 'Meldungen & Fristen',
}

export type WidgetDef = {
  id: string
  titel: string
  bereich: WidgetBereich
  /** false = nicht im Standard, nur über „Dashboard anpassen“ (KAN-389) */
  standard?: boolean
  groesse: WidgetGroesse
  /** wählbare Größen (KAN-388); ohne Angabe nur `groesse` */
  groessen?: readonly WidgetGroesse[]
  quellen: readonly WidgetQuelle[]
  sichtbar?: (k: WidgetKontext) => boolean
  /** nur am Handy (unter sm) – steht in einem eigenen Abschnitt, damit am PC kein leerer Abstand bleibt */
  nurHandy?: boolean
}

export const WIDGETS = [
  { id: 'schnellaktionen', titel: 'Schnellaktionen (Handy)', bereich: 'uebersicht', groesse: 'breit', quellen: [], sichtbar: k => k.schnellaktionen, nurHandy: true },
  { id: 'kellerbestand', titel: 'Kellerbestand', bereich: 'uebersicht', groesse: 'klein', quellen: ['keller'] },
  { id: 'flaschenlager', titel: 'Flaschenlager', bereich: 'uebersicht', groesse: 'klein', quellen: ['flaschen'] },
  { id: 'offene-posten', titel: 'Offene Posten', bereich: 'uebersicht', groesse: 'klein', quellen: ['offenePosten'] },
  { id: 'offene-aufgaben', titel: 'Offene Aufgaben', bereich: 'uebersicht', groesse: 'klein', quellen: ['keller', 'fristen', 'checklisten'] },
  { id: 'finanzen', titel: 'Finanzen', bereich: 'uebersicht', groesse: 'breit', quellen: ['finanzen'], sichtbar: k => k.modulEa },
  { id: 'naechste-schritte', titel: 'Nächste Schritte', bereich: 'uebersicht', groesse: 'mittel', groessen: ['mittel', 'breit'], quellen: ['keller', 'fristen', 'weingarten'] },
  { id: 'morgenbericht', titel: 'Morgenbericht', bereich: 'uebersicht', groesse: 'mittel', groessen: ['mittel', 'breit'], quellen: ['morgenbericht'] },
  { id: 'aufgaben-termine', titel: 'Aufgaben & Termine', bereich: 'uebersicht', groesse: 'breit', groessen: ['mittel', 'breit'], quellen: ['aufgabenTermine'] },
  // KAN-438: offene Support-Anfragen der Betriebe des Benutzers – lädt selbst nach (keine Quelle der Übersicht)
  { id: 'support-anfragen', titel: 'Support-Anfragen', bereich: 'uebersicht', groesse: 'breit', groessen: ['mittel', 'breit'], quellen: [] },
  { id: 'schnellzugriff', titel: 'Schnellzugriff', bereich: 'uebersicht', groesse: 'breit', quellen: [] },
  // KAN-389: weitere Widgets aus den Sichten – nicht im Standard, dieselben Bausteine wie die Sicht (dashboard/_shared)
  { id: 'umsatz-trend', titel: 'Umsatz-Trend (12 Monate)', bereich: 'verkauf', standard: false, groesse: 'mittel', groessen: ['mittel', 'breit'], quellen: ['umsatz'] },
  { id: 'top-kunden', titel: 'Top-Kunden (12 Monate)', bereich: 'verkauf', standard: false, groesse: 'mittel', groessen: ['mittel', 'breit'], quellen: ['umsatz'] },
  { id: 'ueberfaellige-rechnungen', titel: 'Überfällige Rechnungen', bereich: 'verkauf', standard: false, groesse: 'mittel', groessen: ['mittel', 'breit'], quellen: ['offenePosten'] },
  { id: 'gebinde-belegt', titel: 'Gebinde belegt', bereich: 'keller', standard: false, groesse: 'klein', quellen: ['keller'] },
  { id: 'aktive-gaerungen', titel: 'Aktive Gärungen', bereich: 'keller', standard: false, groesse: 'klein', quellen: ['keller'] },
  { id: 'fuellfertig', titel: 'Füllfertig', bereich: 'keller', standard: false, groesse: 'klein', quellen: ['keller'] },
  { id: 'gaerkontrolle', titel: 'Gärkontrolle fällig', bereich: 'keller', standard: false, groesse: 'mittel', groessen: ['mittel', 'breit'], quellen: ['keller'] },
  { id: 'wartefristen', titel: 'Wartefristen je Ried', bereich: 'weingarten', standard: false, groesse: 'mittel', groessen: ['mittel', 'breit'], quellen: ['weingarten'], sichtbar: k => !!k.modulWeingarten },
  { id: 'meldefristen', titel: 'Nächste Meldefristen', bereich: 'fristen', standard: false, groesse: 'mittel', groessen: ['mittel', 'breit'], quellen: ['fristen'] },
] as const satisfies readonly WidgetDef[]

export type WidgetId = (typeof WIDGETS)[number]['id']

/** Ein Eintrag eines Layouts: eingeblendetes Widget und (seit KAN-388 wählbar) Größe */
export type LayoutEintrag = { id: string; groesse?: WidgetGroesse }

/** Die Übersicht wie bis KAN-387 – Standard für alle ohne eigenes Layout (keine Zeile in benutzer_dashboard);
 *  Widgets mit standard: false (KAN-389) gehören nicht dazu */
export const STANDARD_LAYOUT: readonly LayoutEintrag[] = (WIDGETS as readonly WidgetDef[]).filter(w => w.standard !== false).map(w => ({ id: w.id }))

const NACH_ID = new Map<string, WidgetDef>(WIDGETS.map(w => [w.id, w]))

export function erlaubteGroessen(def: WidgetDef): readonly WidgetGroesse[] {
  return def.groessen ?? [def.groesse]
}

function groesseFuer(def: WidgetDef, g: WidgetGroesse | undefined): WidgetGroesse {
  return g && erlaubteGroessen(def).includes(g) ? g : def.groesse
}

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
    out.push({ def, groesse: groesseFuer(def, e.groesse) })
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

// ── Eigenes Layout (KAN-388) ─────────────────────────────────────────────────────────────────────────────

/** Höchstzahl der Einträge – dieselbe Grenze prüft die Datenbank (CHECK benutzer_dashboard_layout_form) */
export const LAYOUT_MAX = 50

/** Gespeichertes bzw. gesendetes Layout prüfen: nur bekannte ids, keine doppelten, nur wählbare Größen (sonst ohne
 *  Größe = Standardgröße), höchstens LAYOUT_MAX Einträge. null = keine Liste (dann gilt der Standard). */
export function layoutPruefen(roh: unknown): LayoutEintrag[] | null {
  if (!Array.isArray(roh)) return null
  const out: LayoutEintrag[] = []
  const gesehen = new Set<string>()
  for (const e of roh) {
    if (out.length >= LAYOUT_MAX) break
    const id = e && typeof e === 'object' ? (e as { id?: unknown }).id : undefined
    const def = typeof id === 'string' ? NACH_ID.get(id) : undefined
    if (!def || gesehen.has(def.id)) continue
    gesehen.add(def.id)
    const g = (e as { groesse?: unknown }).groesse
    const groesse = typeof g === 'string' ? groesseFuer(def, g as WidgetGroesse) : def.groesse
    out.push(groesse === def.groesse ? { id: def.id } : { id: def.id, groesse })
  }
  return out
}

/** Eine Zeile im Fenster „Dashboard anpassen“. verfuegbar = false: im aktiven Betrieb nicht sichtbar (Modul, Rechte) –
 *  wird nicht angeboten, bleibt aber an seiner Stelle gespeichert. */
export type EditorEintrag = { id: string; titel: string; bereich: WidgetBereich; an: boolean; verfuegbar: boolean; groesse: WidgetGroesse; groessen: readonly WidgetGroesse[] }

/** Zeilen fürs Anpassen: zuerst die eingeblendeten in Layout-Reihenfolge, dann die übrigen verfügbaren (aus) in
 *  Register-Reihenfolge – neue Widgets erscheinen so nie ungefragt. Nicht verfügbare, ausgeblendete fallen weg. */
export function editorEintraege(layout: readonly LayoutEintrag[] | null, k: WidgetKontext): EditorEintrag[] {
  const zeile = (def: WidgetDef, an: boolean, g?: WidgetGroesse): EditorEintrag => ({
    id: def.id, titel: def.titel, bereich: def.bereich, an, verfuegbar: !def.sichtbar || def.sichtbar(k), groesse: groesseFuer(def, g), groessen: erlaubteGroessen(def),
  })
  const out: EditorEintrag[] = []
  for (const e of layoutPruefen(layout ?? STANDARD_LAYOUT) ?? []) out.push(zeile(NACH_ID.get(e.id)!, true, e.groesse))
  const drin = new Set(out.map(e => e.id))
  for (const def of WIDGETS as readonly WidgetDef[]) {
    if (drin.has(def.id)) continue
    const z = zeile(def, false)
    if (z.verfuegbar) out.push(z)
  }
  return out
}

/** Verfügbare, eingeblendete Zeile um eine Stelle nach oben (-1) bzw. unten (+1) – über nicht verfügbare hinweg, die an
 *  ihrem Platz bleiben; nie über die Grenze zu den ausgeblendeten (KAN-389) */
export function verschieben(liste: readonly EditorEintrag[], id: string, richtung: -1 | 1): EditorEintrag[] {
  const out = [...liste]
  const i = out.findIndex(e => e.id === id)
  if (i < 0 || !out[i].verfuegbar) return out
  let j = i + richtung
  while (j >= 0 && j < out.length && !out[j].verfuegbar) j += richtung
  if (j < 0 || j >= out.length || out[j].an !== out[i].an) return out
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Zeile an die Stelle einer anderen ziehen (am PC) – nur zwischen verfügbaren, eingeblendeten */
export function verschiebenNach(liste: readonly EditorEintrag[], id: string, zielId: string): EditorEintrag[] {
  const von = liste.findIndex(e => e.id === id)
  const nach = liste.findIndex(e => e.id === zielId)
  if (von < 0 || nach < 0 || von === nach || !liste[von].verfuegbar || !liste[nach].verfuegbar || !liste[von].an || !liste[nach].an) return [...liste]
  const out = [...liste]
  const [e] = out.splice(von, 1)
  out.splice(nach, 0, e)
  return out
}

/** Ein- bzw. ausblenden (KAN-389): eingeblendet rückt ans Ende der eingeblendeten, ausgeblendet an den Anfang der
 *  ausgeblendeten – die Liste bleibt „eingeblendete zuerst“, die Reihenfolge der übrigen bleibt unverändert */
export function umschalten(liste: readonly EditorEintrag[], id: string, an: boolean): EditorEintrag[] {
  const e = liste.find(x => x.id === id)
  if (!e || e.an === an) return [...liste]
  const rest = liste.filter(x => x.id !== id)
  const grenze = rest.findIndex(x => !x.an)
  const stelle = grenze < 0 ? rest.length : grenze
  return [...rest.slice(0, stelle), { ...e, an }, ...rest.slice(stelle)]
}

/** Zu speicherndes Layout: alle eingeblendeten (auch hier nicht verfügbare) in Reihenfolge, Größe nur, wenn abweichend */
export function layoutAusEditor(liste: readonly EditorEintrag[]): LayoutEintrag[] {
  return layoutPruefen(liste.filter(e => e.an).map(e => ({ id: e.id, groesse: e.groesse }))) ?? []
}
