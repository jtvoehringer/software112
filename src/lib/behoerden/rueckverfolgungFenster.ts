// ── Rückverfolgung: Maßnahmen im Weingarten bis zur Lese – Zeitfenster je Lesezeile (KAN-75, 25.09.2026) ──
//
// BKI-Anforderung R19 „Rieden Rückverfolgung (Maßnahmen in der Riede bis Ernte …) –
// Lebensmittelsicherheit“. Bis 25.09.2026 zeigten Seite und CSV „rueckverfolgung“ alle
// Maßnahmen aller Grundstücke der Weingärten ohne Datumsgrenze – auch Spritzungen NACH der
// Lese und aus späteren Jahren. In einer Kontrolle hätte das einen PSM-Einsatz nach der Lese
// vorgetäuscht.
//
// Reine Funktionen ohne Datenbank und ohne '@/'-Importe (node:test-fähig). ladeChargeKette
// (rueckverfolgung.ts) lädt Lesezeilen, die Lese-Historie der Grundstücke und die Maßnahmen
// und ordnet sie hier zu – Seite /kellerbuch/rueckverfolgung und CSV „rueckverfolgung“ zeigen
// damit dieselben Maßnahmen.
//
// Lesezeile = pressung_weingaerten (Weingarten/GST, Lesedatum, Trauben einer Pressung): Die
// Kette Füllung → Charge → Pressung läuft darüber, nicht über ernte_parzellen (Erntemeldung).
// Die „vorige Lese“ kommt nur aus pressung_weingaerten – ein Datum aus der Erntemeldung soll
// den Fensterbeginn nicht still verkürzen; es dient nur als Ersatz für das Fensterende (s. u.).
//
// Zeitfenster je Lesezeile, beide Grenzen inklusive:
//   bis = Lesedatum der Lesezeile (pressung_weingaerten.ernte_datum). Das Pressungsformular
//         erfasst es NICHT (erntemeldung/actions.ts: pw.ernte_datum wird nie geschrieben) –
//         gesetzt ist es nur in den Demo-Daten des Musterhofs. Im Echtbetrieb greift daher in
//         der Regel der Ersatz, jeweils mit Hinweis (Lesedatum je Pressungszeile erfassen:
//         Folgeticket):
//         1. Lesedatum laut Erntemeldung (ernte_parzellen): der späteste passende Lese-Eintrag
//            desselben Jahrgangs bis einschließlich zum Pressungsdatum
//            (lesedatumLautErntemeldung). Die Pressung wählt ihre GST aus eben diesen
//            Einträgen; der späteste bis zur Pressung liegt nie vor der Lese der verpressten
//            Trauben, solange die Erntemeldung sie enthält. Im Musterhof stimmt er bei allen
//            Lesezeilen mit Erntemeldung mit dem Lesedatum der Lesezeile überein.
//         2. sonst das Pressungsdatum (die Lese war spätestens dann) – Maßnahmen zwischen Lese
//            und Pressung können dann mit aufgeführt sein; der Hinweis sagt das.
//   von = Tag nach der vorigen Lese desselben Grundstücks (GST) im selben Jahrgang,
//         sonst der 01.01. des Jahrgangs
//   ANNAHME (offene Frage KAN-38, hier NICHT entschieden): Das Fenster „bis Ernte“ beginnt mit
//   der vorigen Lese desselben GST, sonst am 01.01. des Jahrgangs – nicht mit dem Austrieb.
//   Fällt KAN-38 anders aus, ändert sich nur leseFenster().
//   Zu bedenken bei KAN-38: Bei einer Mehrfachlese (selektive Lese, Spätlese, Eiswein) hingen
//   die Trauben der späteren Lese auch vor der vorigen Lese am Stock – Maßnahmen davor fallen
//   mit dieser Annahme aus dem Fenster der späteren Lese (Seite und CSV nennen deshalb den
//   Fensterbeginn samt vorigem Lesedatum).
//   - „Vorige Lese“ = eine andere Lesezeile desselben GST und desselben Jahrgangs (Jahrgang
//     der Pressung; ist er unbekannt, entscheidet nur das Datum) mit eigenem Lesedatum, streng
//     vor diesem Lesedatum und nicht vor dem 01.01. des Jahrgangs (die Lese des Vorjahres
//     zählt nicht, auch nicht ein Eiswein des Vorjahrgangs im Jänner – das Fenster beginnt
//     dann am 01.01.). Lesen am selben Tag (eine Lese auf zwei Pressungen verteilt) sind keine
//     vorige Lese – sie bekommen dasselbe Fenster.
//   - Jahrgang = weinjahrgaenge.jahrgang der Pressung, sonst das Jahr des Lesedatums. Liegt
//     das Lesedatum in einem früheren Jahr als der Jahrgang (Datenfehler), gilt der 01.01. des
//     Lesejahres; ein späteres Lesejahr (Eiswein im Jänner) lässt den 01.01. des Jahrgangs.
//   - Lesezeile ohne eigenes Lesedatum: keine Verkürzung durch eine vorige Lese (die Lese
//     könnte am selben Tag wie die vorige gewesen sein; der Ersatz aus Erntemeldung bzw.
//     Pressung ist nur eine obere Grenze) – Fenster ab 01.01. Im Echtbetrieb beginnt das
//     Fenster deshalb bis zum Folgeticket immer am 01.01. (eher eine Maßnahme zu viel).
//
// Zuordnung der Maßnahmen (behandlungen) zu einer Lesezeile:
//   - Lesezeile mit GST: Maßnahmen mit behandlung_grundstuecke-Zeile für genau dieses GST;
//     dazu Maßnahmen, die NUR am Weingarten erfasst sind (keine behandlung_grundstuecke-Zeile),
//     wenn ihr Weingarten der des GST bzw. der Lesezeile ist – mit Kennzeichen und Hinweis.
//     Maßnahmen, die nur andere GST betreffen, gehören nicht dazu (auch nicht, wenn
//     behandlungen.weingarten_id der Weingarten der Lese ist – das Feld ist nur der
//     Haupt-Weingarten der Erfassung, die Grundstücke stehen in behandlung_grundstuecke).
//   - Lesezeile ohne GST (nur weingarten_id): welches GST gelesen wurde, ist unbekannt – daher
//     Maßnahmen ALLER GST des Weingartens plus die nur am Weingarten erfassten, Fenster immer
//     ab 01.01. des Jahrgangs (keine Verkürzung über eine vorige Lese), mit Hinweis.
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
}

/**
 * Lesezeilen des Betriebs zu den GST (auch aus anderen Chargen) – nur für „vorige Lese“.
 * jahrgang: weinjahrgaenge.jahrgang der Pressung (fehlt er, entscheidet nur das Datum).
 */
export type LeseHistorie = { id: string; grundstueckId: string | null; lesedatum: string | null; jahrgang?: number | null }

/** Lese-Eintrag der Erntemeldung (ernte_parzellen) – nur Ersatz für ein fehlendes Lesedatum */
export type ErnteEintrag = {
  /** ernte_parzellen.jahrgang_id */
  jahrgangId: string | null
  weingartenId: string | null
  grundstueckId: string | null
  /** 'JJJJ-MM-TT' oder null */
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
  /** erster Tag, inklusive ('JJJJ-MM-TT') */
  von: string
  /** letzter Tag, inklusive ('JJJJ-MM-TT') */
  bis: string
  beginn: 'jahresbeginn' | 'vorige_lese'
  /** Lesedatum der vorigen Lese desselben GST (nur bei beginn = 'vorige_lese') */
  vorigeLese: string | null
  /** Herkunft des Fensterendes: Lesedatum der Lesezeile, Ersatz aus der Erntemeldung bzw. dem Pressungsdatum */
  bisAus: 'lesedatum' | 'erntemeldung' | 'pressungsdatum'
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

/** Folgetag eines 'JJJJ-MM-TT' (UTC-Kalender, ohne Zeitzonen-Einfluss) */
export function tagDanach(t: string): string {
  const m = TAG_RE.exec(t)
  if (!m) throw new Error(`Ungültiger Kalendertag: ${t}`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
  return d.toISOString().slice(0, 10)
}

/** 'JJJJ-MM-TT' → 'TT.MM.JJJJ' */
export function ttmmjjjj(t: string | null): string {
  return t ? `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}` : ''
}

function jahrVon(t: string | null): number | null {
  return t ? Number(t.slice(0, 4)) : null
}

/**
 * Ersatz-Lesedatum aus der Erntemeldung für eine Lesezeile ohne eigenes Lesedatum: der
 * späteste passende Lese-Eintrag desselben Jahrgangs bis einschließlich zum Pressungsdatum.
 *   Lesezeile mit GST: Einträge genau dieses GST und Einträge ohne GST am Weingarten der Lesezeile
 *   Lesezeile ohne GST: alle Einträge des Weingartens
 * null (→ Pressungsdatum), wenn kein Eintrag passt oder ein passender Eintrag kein Lesedatum
 * hat – dann ist offen, welche Lese verpresst wurde, und das Fenster soll nicht zu früh enden.
 */
export function lesedatumLautErntemeldung(lese: LeseZeile, ernte: readonly ErnteEintrag[]): string | null {
  const pressung = kalendertag(lese.pressungDatum)
  if (!pressung || !lese.jahrgangId || (!lese.grundstueckId && !lese.weingartenId)) return null
  let spaetester: string | null = null
  for (const e of ernte) {
    if (e.jahrgangId !== lese.jahrgangId) continue
    const passt = lese.grundstueckId
      ? e.grundstueckId === lese.grundstueckId || (!e.grundstueckId && !!lese.weingartenId && e.weingartenId === lese.weingartenId)
      : e.weingartenId === lese.weingartenId
    if (!passt) continue
    const d = kalendertag(e.lesedatum)
    if (!d) return null
    if (d <= pressung && (!spaetester || d > spaetester)) spaetester = d
  }
  return spaetester
}

/**
 * Zeitfenster einer Lesezeile (Regeln im Dateikopf). null nur, wenn weder Lese- noch
 * Pressungsdatum bekannt ist (pressungen.datum ist NOT NULL – praktisch nie).
 */
export function leseFenster(lese: LeseZeile, historie: readonly LeseHistorie[], ernte: readonly ErnteEintrag[] = []): Zeitfenster | null {
  const lesedatum = kalendertag(lese.lesedatum)
  const ausErnte = lesedatum ? null : lesedatumLautErntemeldung(lese, ernte)
  const bis = lesedatum ?? ausErnte ?? kalendertag(lese.pressungDatum)
  if (!bis) return null
  const bisAus: Zeitfenster['bisAus'] = lesedatum ? 'lesedatum' : ausErnte ? 'erntemeldung' : 'pressungsdatum'
  const jahrBis = jahrVon(bis) as number
  const jahrgang = lese.jahrgang !== null && Number.isInteger(lese.jahrgang) ? lese.jahrgang : jahrBis
  const jahresbeginn = `${String(Math.min(jahrgang, jahrBis)).padStart(4, '0')}-01-01`

  let vorige: string | null = null
  if (lese.grundstueckId && lesedatum) {
    for (const h of historie) {
      if (h.id === lese.id || h.grundstueckId !== lese.grundstueckId) continue
      // Lesen eines anderen Jahrgangs zählen nie (z. B. Eiswein des Vorjahrgangs im Jänner)
      if (h.jahrgang != null && h.jahrgang !== jahrgang) continue
      const d = kalendertag(h.lesedatum)
      if (!d || d >= lesedatum || d < jahresbeginn) continue
      if (!vorige || d > vorige) vorige = d
    }
  }
  return vorige
    ? { von: tagDanach(vorige), bis, beginn: 'vorige_lese', vorigeLese: vorige, bisAus }
    : { von: jahresbeginn, bis, beginn: 'jahresbeginn', vorigeLese: null, bisAus }
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

export const HINWEIS_OHNE_GST = 'Lese ohne Grundstück erfasst – Maßnahmen aller Grundstücke des Weingartens ab 01.01. des Jahrgangs aufgeführt.'
export const HINWEIS_OHNE_ORT = 'Lesezeile ohne Weingarten und Grundstück (z. B. Traubenzukauf) – keine Maßnahmen zuordenbar.'
export const HINWEIS_WEINGARTEN_OHNE_GST = 'Zum Weingarten sind keine Grundstücke erfasst – nur Maßnahmen, die am Weingarten erfasst sind.'
export const HINWEIS_OHNE_FENSTER = 'Weder Lese- noch Pressungsdatum bekannt – Zeitfenster nicht bestimmbar, alle Maßnahmen des Grundstücks aufgeführt.'

/**
 * Maßnahmen je Lesezeile im Zeitfenster „bis zur Lese“ (Regeln im Dateikopf).
 * grundstueckeJeWeingarten: alle GST je Weingarten (für Lesen ohne GST);
 * weingartenJeGrundstueck: Weingarten laut grundstuecke (für Maßnahmen nur am Weingarten);
 * ernte: Lese-Einträge der Erntemeldung (Ersatz für ein fehlendes Lesedatum).
 * Maßnahmen je Lese nach Datum (dann id) sortiert.
 */
export function ordneMassnahmenZu<M extends MassnahmeOrt>(
  lesen: readonly LeseZeile[],
  historie: readonly LeseHistorie[],
  massnahmen: readonly M[],
  grundstueckeJeWeingarten: ReadonlyMap<string, readonly string[]>,
  weingartenJeGrundstueck: ReadonlyMap<string, string>,
  ernte: readonly ErnteEintrag[] = [],
): LeseZuordnung<M>[] {
  const sortiert = [...massnahmen].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return lesen.map(lese => {
    const hinweise: string[] = []
    const gst = lese.grundstueckId
    const weingaerten = new Set<string>()
    if (lese.weingartenId) weingaerten.add(lese.weingartenId)
    if (gst && weingartenJeGrundstueck.get(gst)) weingaerten.add(weingartenJeGrundstueck.get(gst) as string)

    // Ohne GST verkürzt leseFenster nie über eine vorige Lese (Beginn 01.01. des Jahrgangs)
    const fenster = leseFenster(lese, historie, ernte)
    if (fenster?.bisAus === 'erntemeldung') {
      hinweise.push(`Lesedatum an der Pressung nicht erfasst – Zeitfenster bis zum Lesedatum laut Erntemeldung ${ttmmjjjj(fenster.bis)} (spätester Lese-Eintrag bis zur Pressung am ${ttmmjjjj(kalendertag(lese.pressungDatum))}).`)
    }
    if (fenster?.bisAus === 'pressungsdatum') {
      hinweise.push(`Lesedatum weder an der Pressung noch in der Erntemeldung erfasst – Zeitfenster bis zum Pressungsdatum ${ttmmjjjj(fenster.bis)}; Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.`)
    }
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
      return { leseId: lese.id, fenster, massnahmen: [], hinweise }
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
    return { leseId: lese.id, fenster, massnahmen: treffer, hinweise }
  })
}

/** Beschreibung des Fensterbeginns für Seite und CSV */
export function fensterBeginnText(f: Zeitfenster): string {
  return f.beginn === 'vorige_lese'
    ? `ab dem Tag nach der vorigen Lese dieses Grundstücks am ${ttmmjjjj(f.vorigeLese)}`
    : 'ab 01.01. des Jahrgangs'
}

/**
 * Sammelwarnungen der Sonderfälle für den CSV-Download (X-Warnungen) – die Einzelheiten
 * stehen je Zeile in „Hinweis Behandlungen“. Jede Lesezeile nur einmal übergeben.
 */
export function leseWarnungen(
  lesen: readonly { fenster: Zeitfenster | null; hinweise: readonly string[]; massnahmen: readonly { nurWeingarten: boolean }[] }[],
): string[] {
  const zaehle = (f: (l: (typeof lesen)[number]) => boolean) => lesen.filter(f).length
  const mitZahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`
  const warnungen: string[] = []
  const pressung = zaehle(l => l.fenster?.bisAus === 'pressungsdatum')
  if (pressung > 0) warnungen.push(`${mitZahl(pressung, 'Lese hat', 'Lesen haben')} weder an der Pressung noch in der Erntemeldung ein Lesedatum – Zeitfenster bis zum Pressungsdatum, Maßnahmen zwischen Lese und Pressung können mit aufgeführt sein.`)
  const ernte = zaehle(l => l.fenster?.bisAus === 'erntemeldung')
  if (ernte > 0) warnungen.push(`${mitZahl(ernte, 'Lese hat', 'Lesen haben')} kein Lesedatum an der Pressung – Zeitfenster bis zum Lesedatum laut Erntemeldung.`)
  const ohneFenster = zaehle(l => l.hinweise.includes(HINWEIS_OHNE_FENSTER))
  if (ohneFenster > 0) warnungen.push(`${mitZahl(ohneFenster, 'Lese hat', 'Lesen haben')} weder Lese- noch Pressungsdatum – alle Maßnahmen des Grundstücks aufgeführt.`)
  const ohneGst = zaehle(l => l.hinweise.includes(HINWEIS_OHNE_GST))
  if (ohneGst > 0) warnungen.push(`${mitZahl(ohneGst, 'Lese ist', 'Lesen sind')} ohne Grundstück erfasst – Maßnahmen aller Grundstücke des Weingartens ab 01.01. des Jahrgangs aufgeführt.`)
  const ohneOrt = zaehle(l => l.hinweise.includes(HINWEIS_OHNE_ORT))
  if (ohneOrt > 0) warnungen.push(`${mitZahl(ohneOrt, 'Lesezeile hat', 'Lesezeilen haben')} weder Weingarten noch Grundstück (z. B. Traubenzukauf) – keine Maßnahmen zuordenbar.`)
  const nurWg = zaehle(l => l.massnahmen.some(m => m.nurWeingarten))
  if (nurWg > 0) warnungen.push(`Bei ${mitZahl(nurWg, 'Lese sind', 'Lesen sind')} Maßnahmen mit aufgeführt, die nur am Weingarten erfasst sind (ohne Grundstück).`)
  return warnungen
}
