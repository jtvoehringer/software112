// ── Rückverfolgung: Maßnahmen im Weingarten bis zur Lese – Zeitfenster je Lesezeile (KAN-75, 25.09.2026) ──
//
// BKI-Anforderung R19 „Rieden Rückverfolgung (Maßnahmen in der Riede bis Ernte …) –
// Lebensmittelsicherheit“. Bis 25.09.2026 zeigten Seite und CSV „rueckverfolgung“ alle
// Maßnahmen aller Grundstücke der Weingärten ohne Datumsgrenze – auch Spritzungen NACH der
// Lese und aus späteren Jahren. In einer Kontrolle hätte das einen PSM-Einsatz nach der Lese
// vorgetäuscht.
//
// Reine Funktionen ohne Datenbank und ohne '@/'-Importe (node:test-fähig). ladeChargeKette
// (rueckverfolgung.ts) lädt Lesezeilen, Erntemeldung, verpresste Trauben und Maßnahmen und
// ordnet sie hier zu – Seite /kellerbuch/rueckverfolgung und CSV „rueckverfolgung“ zeigen
// damit dieselben Maßnahmen.
//
// Lesezeile = pressung_weingaerten (Weingarten/GST, Lesedatum, Trauben einer Pressung): Die
// Kette Füllung → Charge → Pressung läuft darüber, nicht über ernte_parzellen (Erntemeldung).
// Ein Datum aus der Erntemeldung dient nur als Ersatz für das Fensterende (s. u.).
//
// Zeitfenster je Lesezeile, beide Grenzen inklusive:
//   bis = Lesedatum der Lesezeile (pressung_weingaerten.ernte_datum). Das Pressungsformular
//         erfasst es NICHT (erntemeldung/actions.ts: pw.ernte_datum wird nie geschrieben) –
//         gesetzt ist es nur in den Demo-Daten des Musterhofs. Im Echtbetrieb greift daher in
//         der Regel der Ersatz, jeweils mit Hinweis (Lesedatum je Pressungszeile erfassen:
//         Folgeticket):
//         1. Lesedatum laut Erntemeldung (ernte_parzellen, ersatzAusErntemeldung) – nur wenn es
//            eindeutig ist: Alle passenden Einträge desselben Jahrgangs (auch die nach der
//            Pressung) nennen genau EINEN Lesetag, er liegt am oder vor dem Pressungsdatum, und
//            ihre Menge deckt die bis dahin an diesem Ort verpressten Trauben (Mengenprüfung).
//            Grund (Prüfrunde 2, 25.09.2026): Bei einer Mehrfachlese (Vorlese + Hauptlese,
//            „Kabinett + Spätlese“) ist offen, welche Lese eine Pressung enthält – ist die
//            Hauptlese in der Erntemeldung noch nicht erfasst oder mit einem Datum nach der
//            Pressung vertippt, endete das Fenster sonst an der Vorlese und Maßnahmen zwischen
//            Vorlese und Hauptlese fehlten; ein zusätzlicher richtiger Vorlese-Eintrag hätte
//            das Ergebnis verschlechtert. Die Pressung prüft die kg serverseitig nicht, bietet
//            aber jedes GST mit Lese-Eintrag an – die Mengenprüfung fängt die fehlende
//            Hauptlese ab, sobald mehr verpresst ist, als die Erntemeldung ausweist
//            (Traubenverkäufe zählen dabei nicht mit: notwendige, keine hinreichende
//            Bedingung – eine nicht erfasste Hauptlese, die kleiner ist als die noch
//            unverpresste Vorlese, bleibt unerkannt). Im Musterhof (ein Eintrag je Weingarten
//            und Jahrgang, Menge = verpresst) stimmt der Ersatz bei allen Lesezeilen mit
//            Erntemeldung mit dem Lesedatum der Lesezeile überein.
//         2. sonst das Pressungsdatum (die Lese war spätestens dann) – Maßnahmen zwischen Lese
//            und Pressung können dann mit aufgeführt sein; der Hinweis nennt den Grund (keine
//            Angabe bzw. Erntemeldung nicht eindeutig: mehrere Lesetage, Lesetag nach der
//            Pressung, Menge nicht gedeckt).
//   von = „Ernte bis Ernte“ (Jörgen, 25.09.2026, KAN-108; umgesetzt 29.09.2026): der Tag nach der
//         LETZTEN Lese des Vorjahrgangs am selben Grundstück. Arbeiten nach einer Ernte (z. B.
//         Rebschnitt schon im Dezember) gelten für die nächste Ernte – der 01.01. schnitte sie ab.
//         Eiswein bzw. Ausbruch des Vorjahrgangs im Jänner: Fenster ab dem Tag danach.
//         Lesen des Vorjahrgangs (FruehereLese) kommen aus dem Lesedatum an der Pressungszeile,
//         der Erntemeldung (ernte_parzellen) und dem Traubenverkauf – ohne Zukauf-Trauben, nur
//         mit echtem Lesedatum (ein Pressungsdatum liegt nach der Lese und schnitte Maßnahmen
//         zwischen Lese und Pressung ab, die schon zur nächsten Ernte gehören). Am Ort der Lese
//         zählen Lesen genau dieses GST und Lesen ohne GST am Weingarten der Lese; bei einer
//         Lese ohne GST alle Lesen des Weingartens – die früheste „letzte Lese“ je Ort, damit
//         keine Maßnahme still wegfällt. Nur Lesetage vor dem eigenen Fensterende zählen.
//         Rückfall ohne erfasste Vorjahres-Lese (erste Saison in der App, junge Anlage):
//         01.01. des Jahrgangs (entschieden 29.09.2026); liegt das Fensterende in einem früheren
//         Jahr als der Jahrgang (Datenfehler), der 01.01. dieses früheren Jahres.
//   Weiterhin (Jörgen, 25.09.2026): Hauptlese und spätere Eiswein-Lese DESSELBEN Jahrgangs haben
//   denselben Fensterbeginn – eine frühere Lese des eigenen Jahrgangs verkürzt das Fenster nicht,
//   die Eiswein-Trauben sehen alle Maßnahmen der Saison. Kein Beginn mit dem Austrieb.
//   Jahrgang = weinjahrgaenge.jahrgang der Pressung, sonst das Jahr des Fensterendes.
//
// Zuordnung der Maßnahmen (behandlungen) zu einer Lesezeile:
//   - Lesezeile mit GST: Maßnahmen mit behandlung_grundstuecke-Zeile für genau dieses GST;
//     dazu Maßnahmen, die NUR am Weingarten erfasst sind (keine behandlung_grundstuecke-Zeile),
//     wenn ihr Weingarten der des GST bzw. der Lesezeile ist – mit Kennzeichen und Hinweis.
//     Maßnahmen, die nur andere GST betreffen, gehören nicht dazu (auch nicht, wenn
//     behandlungen.weingarten_id der Weingarten der Lese ist – das Feld ist nur der
//     Haupt-Weingarten der Erfassung, die Grundstücke stehen in behandlung_grundstuecke).
//   - Lesezeile ohne GST (nur weingarten_id): welches GST gelesen wurde, ist unbekannt – daher
//     Maßnahmen ALLER GST des Weingartens plus die nur am Weingarten erfassten, Fenster wie
//     bei jeder Lesezeile („Ernte bis Ernte“), mit Hinweis.
//   - Lesezeile ohne Weingarten und GST (z. B. Traubenzukauf): keine Maßnahmen zuordenbar,
//     Hinweis.
//   - Maßnahmen ohne weingarten_id und ohne GST sind keinem Ort zuzuordnen (KAN-121) und
//     erscheinen hier nicht.
//   - Datum: eine Maßnahme zählt, wenn sie am oder vor dem Ende des Fensters beginnt und nicht
//     vor seinem Beginn endet (datum ≤ bis und datum_bis bzw. datum ≥ von). Mehrtägige
//     Maßnahmen, die in das Fenster hineinreichen, zählen also mit – lieber eine Maßnahme zu
//     viel als eine still weggelassene. Keine Maßnahme beginnt nach dem Fensterende.

export type LeseZeile = {
  /** pressung_weingaerten.id */
  id: string
  grundstueckId: string | null
  weingartenId: string | null
  /** 'JJJJ-MM-TT' oder null */
  lesedatum: string | null
  /** Datum der Pressung ('JJJJ-MM-TT') – Ersatz für ein fehlendes Lesedatum */
  pressungDatum: string | null
  /** weinjahrgaenge.jahrgang der Pressung */
  jahrgang: number | null
  /** pressungen.jahrgang_id – für das Lesedatum laut Erntemeldung */
  jahrgangId?: string | null
  /** pressungen.lese_id (KAN-129) – Ersatz nur aus derselben Lese (Hauptlese und Eiswein am selben GST) */
  leseId?: string | null
}

/** Lese-Eintrag der Erntemeldung (ernte_parzellen) – nur Ersatz für ein fehlendes Lesedatum */
export type ErnteEintrag = {
  /** ernte_parzellen.jahrgang_id */
  jahrgangId: string | null
  /** ernte_parzellen.lese_id (KAN-129) */
  leseId?: string | null
  weingartenId: string | null
  grundstueckId: string | null
  /** 'JJJJ-MM-TT' oder null */
  lesedatum: string | null
  /** ernte_parzellen.menge_kg (fehlt = 0) – für die Mengenprüfung */
  mengeKg?: number | null
}

/**
 * Verpresste Trauben einer Lesezeile (pressung_weingaerten samt Pressung) – nur für die
 * Mengenprüfung des Ersatz-Lesedatums. Die Lesezeile selbst gehört mit dazu.
 */
export type VerpressteTrauben = {
  /** pressung_weingaerten.id */
  id: string
  /** pressungen.jahrgang_id */
  jahrgangId: string | null
  /** pressungen.lese_id (KAN-129) */
  leseId?: string | null
  weingartenId: string | null
  grundstueckId: string | null
  /** pressungen.datum ('JJJJ-MM-TT') */
  pressungDatum: string | null
  traubenKg: number | null
}

/** Abgleich einer Lesezeile ohne eigenes Lesedatum mit der Erntemeldung */
export type ErnteErsatz = {
  /** Fensterende laut Erntemeldung; null → Pressungsdatum */
  datum: string | null
  grund: 'eindeutig' | 'kein_eintrag' | 'mehrere_lesetage' | 'nach_pressung' | 'menge_nicht_gedeckt'
  /** Lesetage der passenden Einträge ('JJJJ-MM-TT', aufsteigend) */
  lesetage: string[]
  /** Menge der passenden Einträge (kg) */
  erfasstKg: number
  /** am Ort der Lesezeile bis einschließlich zum Pressungsdatum verpresst (kg) */
  verpresstKg: number
}

/**
 * Eine Lese eines früheren Jahrgangs an einem Ort – für den Fensterbeginn „Ernte bis Ernte“.
 * Quelle: pressung_weingaerten.ernte_datum, ernte_parzellen.ernte_datum, traubenverkauf.datum.
 */
export type FruehereLese = {
  /** weinjahrgaenge.jahrgang */
  jahrgang: number
  weingartenId: string | null
  grundstueckId: string | null
  /** 'JJJJ-MM-TT' */
  lesedatum: string | null
}

export type MassnahmeOrt = {
  id: string
  /** 'JJJJ-MM-TT' */
  datum: string
  /** Enddatum mehrtägiger Maßnahmen ('JJJJ-MM-TT') oder null */
  datumBis: string | null
  weingartenId: string | null
  /** GST laut behandlung_grundstuecke (leer = nur am Weingarten erfasst) */
  grundstueckIds: readonly string[]
}

export type Zeitfenster = {
  /** erster Tag, inklusive ('JJJJ-MM-TT') – Tag nach der letzten Vorjahres-Lese, sonst 01.01. des Jahrgangs */
  von: string
  /** letzter Tag, inklusive ('JJJJ-MM-TT') */
  bis: string
  /** Jahrgang der Lese (weinjahrgaenge.jahrgang der Pressung, sonst Jahr des Fensterendes) */
  jahrgang: number
  /** Herkunft des Fensterendes: Lesedatum der Lesezeile, Ersatz aus der Erntemeldung bzw. dem Pressungsdatum */
  bisAus: 'lesedatum' | 'erntemeldung' | 'pressungsdatum'
  /** Herkunft des Fensterbeginns: letzte Lese des Vorjahrgangs am Ort bzw. Rückfall 01.01. */
  vonAus: 'vorjahreslese' | 'jahresbeginn'
  /** letzter Lesetag des Vorjahrgangs am Ort ('JJJJ-MM-TT') oder null */
  vorjahresLese: string | null
}

export type ZugeordneteMassnahme<M> = {
  massnahme: M
  /** nur am Weingarten erfasst (keine Grundstückszuordnung) */
  nurWeingarten: boolean
  /** betroffene GST dieser Lese (bei Lese mit GST genau dieses; ohne GST die des Weingartens) */
  grundstueckIds: string[]
}

export type LeseZuordnung<M> = {
  leseId: string
  fenster: Zeitfenster | null
  /** Abgleich mit der Erntemeldung – nur bei Fensterende laut Erntemeldung bzw. Pressungsdatum */
  ersatz: ErnteErsatz | null
  massnahmen: ZugeordneteMassnahme<M>[]
  hinweise: string[]
}

const TAG_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Kalendertag 'JJJJ-MM-TT' (auch aus timestamptz-Text) oder null */
export function kalendertag(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, 10)
  return TAG_RE.test(s) ? s : null
}

/** 'JJJJ-MM-TT' → 'TT.MM.JJJJ' */
export function ttmmjjjj(t: string | null): string {
  return t ? `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}` : ''
}

function jahrVon(t: string | null): number | null {
  return t ? Number(t.slice(0, 4)) : null
}

function kg(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/**
 * Abgleich einer Lesezeile ohne eigenes Lesedatum mit der Erntemeldung (Regeln im Dateikopf).
 * Passend sind Einträge desselben Jahrgangs am Ort der Lesezeile:
 *   Lesezeile mit GST: Einträge genau dieses GST und Einträge ohne GST am Weingarten der Lesezeile
 *   Lesezeile ohne GST: alle Einträge des Weingartens
 * Ein Datum gibt es nur, wenn alle passenden Einträge (auch die nach der Pressung) denselben
 * Lesetag nennen, dieser am oder vor dem Pressungsdatum liegt und ihre Menge die an diesem Ort
 * (gleiche Ortsregel) bis einschließlich zum Pressungsdatum verpressten Trauben deckt. Sonst
 * null (→ Pressungsdatum) mit Grund – auch wenn ein passender Eintrag kein Lesedatum hat:
 * Dann ist offen, welche Lese verpresst wurde, und das Fenster soll nicht zu früh enden.
 * verpresst: Lesezeilen des Betriebs im Jahrgang samt der Lesezeile selbst.
 */
export function ersatzAusErntemeldung(
  lese: LeseZeile,
  ernte: readonly ErnteEintrag[],
  verpresst: readonly VerpressteTrauben[] = [],
): ErnteErsatz {
  const ohne = (grund: ErnteErsatz['grund'], lesetage: string[] = [], erfasstKg = 0, verpresstKg = 0): ErnteErsatz =>
    ({ datum: null, grund, lesetage, erfasstKg, verpresstKg })
  const pressung = kalendertag(lese.pressungDatum)
  if (!pressung || !lese.jahrgangId || (!lese.grundstueckId && !lese.weingartenId)) return ohne('kein_eintrag')
  // KAN-129 Soll 7: mit Lese der Pressung nur Einträge und Verpresstes derselben Lese – Hauptlese und Eiswein am
  // selben GST ergeben so einen eindeutigen Lesetag statt „mehrere_lesetage“; ohne Lese wie bisher je Jahrgang
  const gleicheLese = (o: { jahrgangId: string | null; leseId?: string | null }) =>
    (lese.leseId ? o.leseId === lese.leseId : o.jahrgangId === lese.jahrgangId)
  const amOrt = (o: { grundstueckId: string | null; weingartenId: string | null }) => lese.grundstueckId
    ? o.grundstueckId === lese.grundstueckId || (!o.grundstueckId && !!lese.weingartenId && o.weingartenId === lese.weingartenId)
    : o.weingartenId === lese.weingartenId

  const tage = new Set<string>()
  let erfasstKg = 0
  for (const e of ernte) {
    if (!gleicheLese(e) || !amOrt(e)) continue
    const d = kalendertag(e.lesedatum)
    if (!d) return ohne('kein_eintrag')
    tage.add(d)
    erfasstKg += kg(e.mengeKg)
  }
  const lesetage = [...tage].sort()
  if (lesetage.length === 0) return ohne('kein_eintrag')
  if (lesetage.length > 1) return ohne('mehrere_lesetage', lesetage, erfasstKg)
  if (lesetage[0] > pressung) return ohne('nach_pressung', lesetage, erfasstKg)

  let verpresstKg = 0
  for (const v of verpresst) {
    if (!gleicheLese(v) || !amOrt(v)) continue
    const d = kalendertag(v.pressungDatum)
    if (d && d > pressung) continue
    verpresstKg += kg(v.traubenKg)
  }
  // Toleranz wie bei der Lesemengen-Prüfung der Erntemeldung (KAN-35)
  if (verpresstKg > erfasstKg + 0.01) return ohne('menge_nicht_gedeckt', lesetage, erfasstKg, verpresstKg)
  return { datum: lesetage[0], grund: 'eindeutig', lesetage, erfasstKg, verpresstKg }
}

/** Ersatz-Lesedatum aus der Erntemeldung oder null (→ Pressungsdatum) – siehe ersatzAusErntemeldung */
export function lesedatumLautErntemeldung(
  lese: LeseZeile,
  ernte: readonly ErnteEintrag[],
  verpresst: readonly VerpressteTrauben[] = [],
): string | null {
  return ersatzAusErntemeldung(lese, ernte, verpresst).datum
}

/** Folgetag von 'JJJJ-MM-TT' */
export function folgetag(t: string): string {
  const [j, m, d] = t.split('-').map(Number)
  return new Date(Date.UTC(j, m - 1, d + 1)).toISOString().slice(0, 10)
}

/**
 * Letzter Lesetag des Jahrgangs `jahrgang` am Ort der Lesezeile vor `bis` (Regeln im Dateikopf):
 * mit GST die Lesen dieses GST und die ohne GST am Weingarten; ohne GST je Ort (GST bzw. „nur
 * Weingarten“) die letzte Lese, davon die früheste. null = keine erfasst.
 */
export function letzteVorjahresLese(
  lese: Pick<LeseZeile, 'grundstueckId' | 'weingartenId'>,
  jahrgang: number,
  bis: string,
  fruehere: readonly FruehereLese[],
): string | null {
  const jeOrt = new Map<string, string>()
  for (const f of fruehere) {
    if (f.jahrgang !== jahrgang) continue
    const d = kalendertag(f.lesedatum)
    if (!d || d >= bis) continue
    const passt = lese.grundstueckId
      ? f.grundstueckId === lese.grundstueckId || (!f.grundstueckId && !!lese.weingartenId && f.weingartenId === lese.weingartenId)
      : !!lese.weingartenId && f.weingartenId === lese.weingartenId
    if (!passt) continue
    const ort = lese.grundstueckId ? '' : f.grundstueckId ?? ''
    const bisher = jeOrt.get(ort)
    if (!bisher || d > bisher) jeOrt.set(ort, d)
  }
  const tage = [...jeOrt.values()].sort()
  return tage[0] ?? null
}

/**
 * Zeitfenster einer Lesezeile (Regeln im Dateikopf): vom Tag nach der letzten Lese des
 * Vorjahrgangs am Ort (sonst 01.01. des Jahrgangs) bis zum Lesedatum bzw. Ersatz – andere Lesen
 * desselben Jahrgangs spielen keine Rolle. null nur, wenn weder Lese- noch Pressungsdatum
 * bekannt ist (pressungen.datum ist NOT NULL – praktisch nie).
 */
export function leseFenster(
  lese: LeseZeile,
  ernte: readonly ErnteEintrag[] = [],
  verpresst: readonly VerpressteTrauben[] = [],
  fruehere: readonly FruehereLese[] = [],
): Zeitfenster | null {
  const lesedatum = kalendertag(lese.lesedatum)
  const ausErnte = lesedatum ? null : lesedatumLautErntemeldung(lese, ernte, verpresst)
  const bis = lesedatum ?? ausErnte ?? kalendertag(lese.pressungDatum)
  if (!bis) return null
  const bisAus: Zeitfenster['bisAus'] = lesedatum ? 'lesedatum' : ausErnte ? 'erntemeldung' : 'pressungsdatum'
  const jahrBis = jahrVon(bis) as number
  const jahrgang = lese.jahrgang !== null && Number.isInteger(lese.jahrgang) ? lese.jahrgang : jahrBis
  // Eiswein im Jänner des Folgejahres: 01.01. des Jahrgangs; Fensterende vor dem Jahrgang
  // (Datenfehler): 01.01. des Jahres des Fensterendes
  const vorjahresLese = letzteVorjahresLese(lese, jahrgang - 1, bis, fruehere)
  if (vorjahresLese) return { von: folgetag(vorjahresLese), bis, jahrgang, bisAus, vonAus: 'vorjahreslese', vorjahresLese }
  const von = `${String(Math.min(jahrgang, jahrBis)).padStart(4, '0')}-01-01`
  return { von, bis, jahrgang, bisAus, vonAus: 'jahresbeginn', vorjahresLese: null }
}

/** Liegt die Maßnahme (ggf. mehrtägig) im Fenster? Beginn ≤ bis und Ende ≥ von */
export function massnahmeImFenster(m: Pick<MassnahmeOrt, 'datum' | 'datumBis'>, f: Pick<Zeitfenster, 'von' | 'bis'>): boolean {
  const beginn = kalendertag(m.datum)
  if (!beginn) return false
  const ende = kalendertag(m.datumBis) ?? beginn
  return beginn <= f.bis && (ende >= beginn ? ende : beginn) >= f.von
}

/** Gesamter Datumsbereich aller Fenster – für die Datenbankabfrage; null = ohne Grenze */
export function ladebereich(fenster: readonly (Zeitfenster | null)[]): { von: string | null; bis: string | null } {
  if (fenster.length === 0 || fenster.some(f => f === null)) return { von: null, bis: null }
  const fs = fenster as Zeitfenster[]
  return {
    von: fs.reduce((a, f) => (f.von < a ? f.von : a), fs[0].von),
    bis: fs.reduce((a, f) => (f.bis > a ? f.bis : a), fs[0].bis),
  }
}

export const HINWEIS_OHNE_GST = 'Lese ohne Grundstück erfasst – Maßnahmen aller Grundstücke des Weingartens im Zeitfenster aufgeführt.'
export const HINWEIS_OHNE_ORT = 'Lesezeile ohne Weingarten und Grundstück (z. B. Traubenzukauf) – keine Maßnahmen zuordenbar.'
export const HINWEIS_WEINGARTEN_OHNE_GST = 'Zum Weingarten sind keine Grundstücke erfasst – nur Maßnahmen, die am Weingarten erfasst sind.'
export const HINWEIS_OHNE_FENSTER = 'Weder Lese- noch Pressungsdatum bekannt – Zeitfenster nicht bestimmbar, alle Maßnahmen des Grundstücks aufgeführt.'

/** Menge für Hinweistexte: ganze kg bzw. eine Nachkommastelle mit Dezimalkomma */
function kgText(v: number): string {
  // runden-ok: Fenstermodul bleibt importfrei (node:test), nur kg-Hinweistext mit einer Stelle
  return `${String(Math.round(v * 10) / 10).replace('.', ',')} kg`
}

/** Hinweis zum Fensterende, wenn es nicht das Lesedatum der Lesezeile ist */
function ersatzHinweis(f: Zeitfenster, ersatz: ErnteErsatz | null, pressungDatum: string | null): string | null {
  if (f.bisAus === 'erntemeldung') {
    return `Lesedatum an der Pressung nicht erfasst – Zeitfenster bis zum Lesedatum laut Erntemeldung ${ttmmjjjj(f.bis)} (einziger passender Lesetag im Jahrgang, Pressung am ${ttmmjjjj(kalendertag(pressungDatum))}).`
  }
  if (f.bisAus !== 'pressungsdatum') return null
  const ende = `Zeitfenster bis zum Pressungsdatum ${ttmmjjjj(f.bis)}; Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.`
  const tage = (ersatz?.lesetage ?? []).map(ttmmjjjj)
  switch (ersatz?.grund) {
    case 'mehrere_lesetage':
      return `Lesedatum an der Pressung nicht erfasst und laut Erntemeldung nicht eindeutig (mehrere Lesetage: ${tage.join(', ')}) – ${ende}`
    case 'nach_pressung':
      return `Lesedatum an der Pressung nicht erfasst und laut Erntemeldung nicht eindeutig (Lesetag ${tage[0]} liegt nach der Pressung) – ${ende}`
    case 'menge_nicht_gedeckt':
      return `Lesedatum an der Pressung nicht erfasst und laut Erntemeldung nicht eindeutig (Lesetag ${tage[0]} ${ersatz.erfasstKg > 0 ? `mit ${kgText(ersatz.erfasstKg)}` : 'ohne Menge'} deckt die bis zur Pressung verpressten ${kgText(ersatz.verpresstKg)} nicht – weitere Lese nicht erfasst?) – ${ende}`
    default:
      return `Lesedatum weder an der Pressung noch in der Erntemeldung erfasst – ${ende}`
  }
}

/**
 * Maßnahmen je Lesezeile im Zeitfenster „bis zur Lese“ (Regeln im Dateikopf).
 * grundstueckeJeWeingarten: alle GST je Weingarten (für Lesen ohne GST);
 * weingartenJeGrundstueck: Weingarten laut grundstuecke (für Maßnahmen nur am Weingarten);
 * ernte: Lese-Einträge der Erntemeldung (Ersatz für ein fehlendes Lesedatum);
 * verpresst: Lesezeilen des Betriebs in diesen Jahrgängen (Mengenprüfung des Ersatzes);
 * fruehere: Lesen der Vorjahrgänge (Fensterbeginn „Ernte bis Ernte“).
 * Maßnahmen je Lese nach Datum (dann id) sortiert.
 */
export function ordneMassnahmenZu<M extends MassnahmeOrt>(
  lesen: readonly LeseZeile[],
  massnahmen: readonly M[],
  grundstueckeJeWeingarten: ReadonlyMap<string, readonly string[]>,
  weingartenJeGrundstueck: ReadonlyMap<string, string>,
  ernte: readonly ErnteEintrag[] = [],
  verpresst: readonly VerpressteTrauben[] = [],
  fruehere: readonly FruehereLese[] = [],
): LeseZuordnung<M>[] {
  const sortiert = [...massnahmen].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return lesen.map(lese => {
    const hinweise: string[] = []
    const gst = lese.grundstueckId
    const weingaerten = new Set<string>()
    if (lese.weingartenId) weingaerten.add(lese.weingartenId)
    if (gst && weingartenJeGrundstueck.get(gst)) weingaerten.add(weingartenJeGrundstueck.get(gst) as string)

    const fenster = leseFenster(lese, ernte, verpresst, fruehere)
    const ersatz = fenster && fenster.bisAus !== 'lesedatum' ? ersatzAusErntemeldung(lese, ernte, verpresst) : null
    const zumEnde = fenster ? ersatzHinweis(fenster, ersatz, lese.pressungDatum) : null
    if (zumEnde) hinweise.push(zumEnde)
    if (!fenster) hinweise.push(HINWEIS_OHNE_FENSTER)

    // Orte der Lese: GST (genau eines oder alle des Weingartens)
    let orte: Set<string>
    if (gst) {
      orte = new Set([gst])
    } else if (lese.weingartenId) {
      orte = new Set(grundstueckeJeWeingarten.get(lese.weingartenId) ?? [])
      hinweise.push(HINWEIS_OHNE_GST)
      if (orte.size === 0) hinweise.push(HINWEIS_WEINGARTEN_OHNE_GST)
    } else {
      hinweise.push(HINWEIS_OHNE_ORT)
      return { leseId: lese.id, fenster, ersatz, massnahmen: [], hinweise }
    }

    const treffer: ZugeordneteMassnahme<M>[] = []
    for (const m of sortiert) {
      if (fenster && !massnahmeImFenster(m, fenster)) continue
      if (m.grundstueckIds.length === 0) {
        if (m.weingartenId && weingaerten.has(m.weingartenId)) treffer.push({ massnahme: m, nurWeingarten: true, grundstueckIds: [] })
        continue
      }
      const betroffen = m.grundstueckIds.filter(g => orte.has(g))
      if (betroffen.length > 0) treffer.push({ massnahme: m, nurWeingarten: false, grundstueckIds: [...new Set(betroffen)] })
    }
    const nurWg = treffer.filter(t => t.nurWeingarten).length
    if (nurWg > 0) {
      hinweise.push(nurWg === 1
        ? '1 Maßnahme ist nur am Weingarten erfasst (ohne Grundstück) und hier mit aufgeführt.'
        : `${nurWg} Maßnahmen sind nur am Weingarten erfasst (ohne Grundstück) und hier mit aufgeführt.`)
    }
    return { leseId: lese.id, fenster, ersatz, massnahmen: treffer, hinweise }
  })
}

/**
 * Beschreibung des Fensterbeginns für die Seite: „ab 01.10.2024, Tag nach der letzten Lese des
 * Jahrgangs 2024 (30.09.2024)“ bzw. im Rückfall „ab 01.01. des Jahrgangs 2025 (keine Lese des
 * Jahrgangs 2024 erfasst)“. Beim Datenfehler (Fensterende vor dem Jahrgang) das tatsächliche Datum.
 */
export function fensterBeginnText(f: Pick<Zeitfenster, 'von' | 'jahrgang'> & Partial<Pick<Zeitfenster, 'vonAus' | 'vorjahresLese'>>): string {
  if (f.vonAus === 'vorjahreslese' && f.vorjahresLese) {
    return `ab ${ttmmjjjj(f.von)}, Tag nach der letzten Lese des Jahrgangs ${f.jahrgang - 1} (${ttmmjjjj(f.vorjahresLese)})`
  }
  const ohne = f.vonAus === 'jahresbeginn' ? ` (keine Lese des Jahrgangs ${f.jahrgang - 1} erfasst)` : ''
  return f.von === `${String(f.jahrgang).padStart(4, '0')}-01-01`
    ? `ab 01.01. des Jahrgangs ${f.jahrgang}${ohne}`
    : `ab ${ttmmjjjj(f.von)}, Fensterende vor dem Jahrgang ${f.jahrgang}`
}

/**
 * Sammelwarnungen der Sonderfälle für den CSV-Download (X-Warnungen) – die Einzelheiten
 * stehen je Zeile in „Hinweis Behandlungen“. Jede Lesezeile nur einmal übergeben.
 */
export function leseWarnungen(
  lesen: readonly {
    fenster: Zeitfenster | null
    ersatz?: Pick<ErnteErsatz, 'grund'> | null
    hinweise: readonly string[]
    massnahmen: readonly { nurWeingarten: boolean }[]
  }[],
): string[] {
  const zaehle = (f: (l: (typeof lesen)[number]) => boolean) => lesen.filter(f).length
  const mitZahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`
  const warnungen: string[] = []
  // Fensterende am Pressungsdatum: ohne Angabe in der Erntemeldung bzw. weil sie nicht eindeutig ist
  const unklar = zaehle(l => l.fenster?.bisAus === 'pressungsdatum'
    && ['mehrere_lesetage', 'nach_pressung', 'menge_nicht_gedeckt'].includes(l.ersatz?.grund ?? ''))
  const pressung = zaehle(l => l.fenster?.bisAus === 'pressungsdatum') - unklar
  if (pressung > 0) warnungen.push(`${mitZahl(pressung, 'Lese hat', 'Lesen haben')} weder an der Pressung noch in der Erntemeldung ein Lesedatum – Zeitfenster bis zum Pressungsdatum, Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.`)
  if (unklar > 0) warnungen.push(`${mitZahl(unklar, 'Lese hat', 'Lesen haben')} kein Lesedatum an der Pressung, und die Erntemeldung ist dafür nicht eindeutig (mehrere Lesetage, Lesetag nach der Pressung oder Menge nicht gedeckt) – Zeitfenster bis zum Pressungsdatum, Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.`)
  const ernte = zaehle(l => l.fenster?.bisAus === 'erntemeldung')
  if (ernte > 0) warnungen.push(`${mitZahl(ernte, 'Lese hat', 'Lesen haben')} kein Lesedatum an der Pressung – Zeitfenster bis zum Lesedatum laut Erntemeldung.`)
  const ohneFenster = zaehle(l => l.hinweise.includes(HINWEIS_OHNE_FENSTER))
  if (ohneFenster > 0) warnungen.push(`${mitZahl(ohneFenster, 'Lese hat', 'Lesen haben')} weder Lese- noch Pressungsdatum – alle Maßnahmen des Grundstücks aufgeführt.`)
  const ohneGst = zaehle(l => l.hinweise.includes(HINWEIS_OHNE_GST))
  if (ohneGst > 0) warnungen.push(`${mitZahl(ohneGst, 'Lese ist', 'Lesen sind')} ohne Grundstück erfasst – Maßnahmen aller Grundstücke des Weingartens im Zeitfenster aufgeführt.`)
  const ohneVorjahr = zaehle(l => l.fenster?.vonAus === 'jahresbeginn')
  if (ohneVorjahr > 0) warnungen.push(`${mitZahl(ohneVorjahr, 'Lese hat', 'Lesen haben')} keine erfasste Lese des Vorjahrgangs am Grundstück – Zeitfenster ab 01.01. des Jahrgangs (Maßnahmen nach der Vorjahres-Ernte, z. B. Rebschnitt im Dezember, fehlen dann).`)
  const ohneOrt = zaehle(l => l.hinweise.includes(HINWEIS_OHNE_ORT))
  if (ohneOrt > 0) warnungen.push(`${mitZahl(ohneOrt, 'Lesezeile hat', 'Lesezeilen haben')} weder Weingarten noch Grundstück (z. B. Traubenzukauf) – keine Maßnahmen zuordenbar.`)
  const nurWg = zaehle(l => l.massnahmen.some(m => m.nurWeingarten))
  if (nurWg > 0) warnungen.push(`Bei ${mitZahl(nurWg, 'Lese sind', 'Lesen sind')} Maßnahmen mit aufgeführt, die nur am Weingarten erfasst sind (ohne Grundstück).`)
  return warnungen
}
