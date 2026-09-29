// ── Lese erfassen: Auswahl, Suche und Verteilung der Menge (KAN-160, KAN-161, KAN-162) ────────────────
//
// Reine Logik für „Lesedaten erfassen“ (erntemeldung/[id]/ErnteDetailClient.tsx) und die Server Action
// createMultipleErnteParzellen – beide rechnen die Verteilung mit denselben Funktionen, die Action mit den
// Flächen aus der Datenbank (nie mit denen aus dem Formular).
// Ohne '@/'-Importe und ohne JSX, damit node:test sie prüfen kann (scripts/tests/ernte.test.mjs).

// ── Erntebar ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Erntebar ist ein Weingarten mit mindestens einem Grundstück der Nutzart WI (Weingarten) – oder ohne erfasste
 * Grundstücke (dann wird die Lese am Weingarten selbst gebucht). Ein Weingarten, dessen Grundstücke alle Acker,
 * Grünland, Brache o. Ä. sind, ist es nicht (dieselbe Regel wie „spritzbar“ bei den Maßnahmen).
 */
export function istErntebar(anzahlGrundstuecke: number, anzahlWeingartenGst: number): boolean {
  return anzahlWeingartenGst > 0 || anzahlGrundstuecke === 0
}

// ── Zielflächen der Auswahl ─────────────────────────────────────────────────────────────────────────────

export type LeseGst = { id: string; flaeche_ha: number | null }

/** Eine Lesezeile, die gespeichert wird: Grundstück (bzw. Weingarten ohne Grundstück) mit Bezugsfläche */
export type LeseZiel = { weingarten_id: string; grundstueck_id: string | null; flaeche_ha: number | null }

/**
 * Zielflächen einer Auswahl, in Reihenfolge der Auswahl:
 *   - ganz gewählter Weingarten → alle seine WI-Grundstücke (`gstJeWeingarten` enthält nur WI);
 *     ohne Grundstück eine Zeile am Weingarten mit dessen Fläche (`weingartenFlaeche`)
 *   - einzeln gewählte Grundstücke (ein Grundstück, das schon über seinen Weingarten drin ist, nur einmal)
 */
export function leseZiele(
  ganzeWeingaerten: readonly string[],
  einzelneGst: readonly { gst_id: string; weingarten_id: string }[],
  gstJeWeingarten: Readonly<Record<string, readonly LeseGst[]>>,
  weingartenFlaeche: Readonly<Record<string, number | null | undefined>> = {},
): LeseZiel[] {
  const ziele: LeseZiel[] = []
  const gesehen = new Set<string>()
  const ganze = new Set<string>()
  for (const wgId of ganzeWeingaerten) {
    if (ganze.has(wgId)) continue
    ganze.add(wgId)
    const gsts = gstJeWeingarten[wgId] ?? []
    if (gsts.length === 0) {
      ziele.push({ weingarten_id: wgId, grundstueck_id: null, flaeche_ha: weingartenFlaeche[wgId] ?? null })
      continue
    }
    for (const g of gsts) {
      if (gesehen.has(g.id)) continue
      gesehen.add(g.id)
      ziele.push({ weingarten_id: wgId, grundstueck_id: g.id, flaeche_ha: g.flaeche_ha })
    }
  }
  for (const e of einzelneGst) {
    if (gesehen.has(e.gst_id)) continue
    gesehen.add(e.gst_id)
    const g = (gstJeWeingarten[e.weingarten_id] ?? []).find(x => x.id === e.gst_id)
    ziele.push({ weingarten_id: e.weingarten_id, grundstueck_id: e.gst_id, flaeche_ha: g?.flaeche_ha ?? null })
  }
  return ziele
}

// ── Verteilung der Gesamtmenge ──────────────────────────────────────────────────────────────────────────

/** Fläche, die bei der Verteilung zählt (> 0 ha; numeric auch als Text) – sonst null */
export function bezugsflaeche(ha: number | string | null | undefined): number | null {
  const n = typeof ha === 'string' && ha.trim() !== '' ? Number(ha) : ha
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/** Nachkommastellen der Eingabe, auf die verteilt wird (0–2): 1.200 kg → ganze kg, 1.200,5 kg → Zehntel */
function stellenDerMenge(kg: number): number {
  for (let d = 0; d < 2; d++) {
    const f = 10 ** d
    if (Math.abs(Math.round(kg * f) - kg * f) < 1e-6) return d
  }
  return 2
}

/**
 * Gesamtmenge (kg) nach Fläche auf die Zielflächen verteilen (KAN-161):
 *   - Anteil je Fläche abgerundet in der Genauigkeit der Eingabe (ganze kg, bei Dezimaleingabe Zehntel bzw.
 *     Hundertstel), der Rundungsrest geht auf die größte Fläche (bei Gleichstand die erste) –
 *     die Summe ist exakt die Eingabe
 *   - Flächen ohne Fläche (null/0) bekommen keine Menge (null), solange es Flächen mit Fläche gibt;
 *     hat keine Zielfläche eine Fläche, wird gleichmäßig verteilt (Rest auf die erste)
 *   - keine Menge (null, NaN) oder negative Menge → alle null; 0 kg → alle 0 (z. B. Totalausfall, KAN-144)
 */
export function verteileKg(gesamtKg: number | null | undefined, flaechen: readonly (number | null | undefined)[]): (number | null)[] {
  if (flaechen.length === 0) return []
  if (gesamtKg == null || !Number.isFinite(gesamtKg) || gesamtKg < 0) return flaechen.map(() => null)
  if (gesamtKg === 0) return flaechen.map(() => 0)
  const stellen = stellenDerMenge(gesamtKg)
  const faktor = 10 ** stellen
  const einheiten = Math.round(gesamtKg * faktor)
  const ha = flaechen.map(bezugsflaeche)
  const mitFlaeche = ha.filter((a): a is number => a != null)
  let teile: (number | null)[]
  let restIndex: number
  if (mitFlaeche.length === 0) {
    const je = Math.floor(einheiten / flaechen.length)
    teile = flaechen.map(() => je)
    restIndex = 0
  } else {
    const summeHa = mitFlaeche.reduce((s, a) => s + a, 0)
    // + 1e-9: 0,3 / 0,6 ergibt in Gleitkomma 0,49999… – sonst fiele ein ganzer kg unnötig in den Rest
    teile = ha.map(a => (a == null ? null : Math.floor(einheiten * a / summeHa + 1e-9)))
    restIndex = 0
    let groesste = -1
    ha.forEach((a, i) => { if (a != null && a > groesste) { groesste = a; restIndex = i } })
  }
  const verteilt = teile.reduce<number>((s, t) => s + (t ?? 0), 0)
  teile[restIndex] = (teile[restIndex] ?? 0) + (einheiten - verteilt)
  return teile.map(t => (t == null ? null : t / faktor))
}

/** Hinweis unter der Verteilungsvorschau, wenn Zielflächen keine Fläche haben – sonst null */
export function verteilungsHinweis(flaechen: readonly (number | null | undefined)[]): string | null {
  const ohne = flaechen.filter(f => bezugsflaeche(f) == null).length
  if (ohne === 0) return null
  if (ohne === flaechen.length) return 'Für die Auswahl ist keine Fläche hinterlegt – die Menge wird gleichmäßig aufgeteilt.'
  return ohne === 1
    ? '1 Grundstück hat keine Fläche und bekommt keinen Anteil – bei Bedarf „Mengen je Grundstück einzeln erfassen“.'
    : `${ohne} Grundstücke haben keine Fläche und bekommen keinen Anteil – bei Bedarf „Mengen je Grundstück einzeln erfassen“.`
}

// ── Suche (KAN-162) ─────────────────────────────────────────────────────────────────────────────────────

export type SuchWeingarten = { id: string; name: string; lage_name: string | null; ama_feldnummer: string | null }
export type SuchGst = { id: string; gst_nr: string }

/** Ergebnis der Suche: sichtbare Weingärten; `gstTreffer` nur für Weingärten, die allein über Grundstücke passen */
export type LeseSuche = {
  aktiv: boolean
  weingaerten: Set<string>
  /** Weingarten → passende Grundstücke (Treffer auf GST-Ebene: aufklappen, nur diese zeigen) */
  gstTreffer: Map<string, Set<string>>
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()
}

/** „23“, „FS 23“, „Feldstück 023“ → „23“ (für den Vergleich der AMA-Feldstücknummer) – sonst null */
function feldstueckNummer(suche: string): string | null {
  const m = /^(?:fs|feldst(?:ü|ue)ck)?\s*(?:nr\.?)?\s*0*(\d+)$/.exec(suche)
  return m ? (m[1] === '' ? '0' : m[1]) : null
}

function fsGleich(fs: string | null, nummer: string): boolean {
  const f = (fs ?? '').trim().replace(/^0+(?=\d)/, '')
  return f !== '' && f === nummer
}

/**
 * Filter der Lese-Auswahl: passt der Weingarten über Name, Ried-Name (Lage) oder AMA-Feldstücknummer
 * (exakt, führende Nullen egal, „FS 23“ erlaubt), ist er mit allen Grundstücken sichtbar; sonst passt er, wenn
 * eine GST-Nummer den Suchtext enthält – dann nur mit diesen Grundstücken (aufgeklappt).
 * Leerer Suchtext → nicht aktiv, alles sichtbar.
 */
export function leseSuche(
  suchtext: string,
  weingaerten: readonly SuchWeingarten[],
  gstJeWeingarten: Readonly<Record<string, readonly SuchGst[]>>,
): LeseSuche {
  const q = norm(suchtext)
  if (!q) return { aktiv: false, weingaerten: new Set(weingaerten.map(w => w.id)), gstTreffer: new Map() }
  const nummer = feldstueckNummer(q)
  const sichtbar = new Set<string>()
  const gstTreffer = new Map<string, Set<string>>()
  for (const w of weingaerten) {
    if (norm(w.name).includes(q) || norm(w.lage_name).includes(q) || (nummer != null && fsGleich(w.ama_feldnummer, nummer))) {
      sichtbar.add(w.id)
      continue
    }
    const treffer = (gstJeWeingarten[w.id] ?? []).filter(g => norm(g.gst_nr).includes(q))
    if (treffer.length > 0) {
      sichtbar.add(w.id)
      gstTreffer.set(w.id, new Set(treffer.map(g => g.id)))
    }
  }
  return { aktiv: true, weingaerten: sichtbar, gstTreffer }
}

// ── „Alle (Treffer) auswählen“ ↔ „… abwählen“ ─────────────────────────────────────────────────────────

/** Was ein Klick auf „Alle (Treffer) auswählen“ bzw. eine Gruppe wählt: ganze Weingärten und einzelne Grundstücke */
export type LeseTreffer = { ganze: string[]; einzeln: { gst_id: string; weingarten_id: string }[] }

/**
 * Treffer einer Liste von (erntebaren) Weingärten unter der Suche: passt ein Weingarten nur über Grundstücke,
 * zählen nur diese Grundstücke, sonst der ganze Weingarten. Ohne aktive Suche alle ganz.
 */
export function leseTreffer(weingartenIds: readonly string[], suche: LeseSuche): LeseTreffer {
  const ganze: string[] = []
  const einzeln: { gst_id: string; weingarten_id: string }[] = []
  for (const id of weingartenIds) {
    if (!suche.weingaerten.has(id)) continue
    const gsts = suche.aktiv ? suche.gstTreffer.get(id) : undefined
    if (gsts) gsts.forEach(g => einzeln.push({ gst_id: g, weingarten_id: id }))
    else ganze.push(id)
  }
  return { ganze, einzeln }
}

export type LeseAuswahl = { weingaerten: ReadonlySet<string>; gst: ReadonlyMap<string, string> }

/**
 * Sind alle Treffer ausgewählt? Ein Grundstück zählt auch über seinen ganz gewählten Weingarten, ein Weingarten
 * auch, wenn alle seine WI-Grundstücke einzeln gewählt sind (`gstJeWeingarten`). Keine Treffer → nein.
 */
export function trefferAusgewaehlt(
  t: LeseTreffer, a: LeseAuswahl, gstJeWeingarten: Readonly<Record<string, readonly { id: string }[]>> = {},
): boolean {
  if (t.ganze.length === 0 && t.einzeln.length === 0) return false
  const ganzGewaehlt = (id: string) => a.weingaerten.has(id)
    || ((gstJeWeingarten[id]?.length ?? 0) > 0 && gstJeWeingarten[id].every(g => a.gst.has(g.id)))
  return t.ganze.every(ganzGewaehlt)
    && t.einzeln.every(e => a.weingaerten.has(e.weingarten_id) || a.gst.has(e.gst_id))
}

/** Ist aus den Treffern etwas ausgewählt (für den halb gesetzten Haken einer Gruppe)? */
export function trefferTeilweise(t: LeseTreffer, a: LeseAuswahl): boolean {
  const gewaehlteWg = new Set(a.gst.values())
  return t.ganze.some(id => a.weingaerten.has(id) || gewaehlteWg.has(id))
    || t.einzeln.some(e => a.weingaerten.has(e.weingarten_id) || a.gst.has(e.gst_id))
}

/** Treffer zur Auswahl hinzufügen: ganze Weingärten ersetzen ihre einzeln gewählten Grundstücke */
export function trefferHinzufuegen(t: LeseTreffer, a: LeseAuswahl): { weingaerten: Set<string>; gst: Map<string, string> } {
  const weingaerten = new Set(a.weingaerten)
  const gst = new Map(a.gst)
  for (const id of t.ganze) {
    weingaerten.add(id)
    for (const [g, w] of gst) if (w === id) gst.delete(g)
  }
  for (const e of t.einzeln) if (!weingaerten.has(e.weingarten_id)) gst.set(e.gst_id, e.weingarten_id)
  return { weingaerten, gst }
}

/**
 * Treffer aus der Auswahl nehmen. Ist ein Grundstücks-Treffer nur über seinen ganz gewählten Weingarten drin,
 * bleiben dessen übrige Grundstücke einzeln gewählt (`gstJeWeingarten`: WI-Grundstücke je Weingarten).
 */
export function trefferEntfernen(
  t: LeseTreffer, a: LeseAuswahl, gstJeWeingarten: Readonly<Record<string, readonly { id: string }[]>>,
): { weingaerten: Set<string>; gst: Map<string, string> } {
  const weingaerten = new Set(a.weingaerten)
  const gst = new Map(a.gst)
  for (const id of t.ganze) {
    weingaerten.delete(id)
    for (const [g, w] of gst) if (w === id) gst.delete(g)
  }
  const weg = new Set(t.einzeln.map(e => e.gst_id))
  for (const e of t.einzeln) {
    if (weingaerten.has(e.weingarten_id)) {
      weingaerten.delete(e.weingarten_id)
      for (const g of gstJeWeingarten[e.weingarten_id] ?? []) if (!weg.has(g.id)) gst.set(g.id, e.weingarten_id)
    }
    gst.delete(e.gst_id)
  }
  return { weingaerten, gst }
}

/** Beschriftung des Knopfs über der Auswahl (bei aktiver Suche wirkt er nur auf die Treffer) */
export function alleKnopfText(abwaehlen: boolean, sucheAktiv: boolean): string {
  if (sucheAktiv) return abwaehlen ? 'Alle Treffer abwählen' : 'Alle Treffer auswählen'
  return abwaehlen ? 'Alle abwählen' : 'Alle auswählen'
}
