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
// Auch die „vorige Lese“ kommt nur aus pressung_weingaerten – ein zusammenfassendes Datum aus
// der Erntemeldung soll das Fenster nicht still verkürzen.
//
// Zeitfenster je Lesezeile, beide Grenzen inklusive:
//   bis = Lesedatum; fehlt es, das Pressungsdatum (die Lese war spätestens dann) – mit Hinweis
//   von = Tag nach der vorigen Lese desselben Grundstücks (GST) im selben Jahrgang,
//         sonst der 01.01. des Jahrgangs
//   ANNAHME (offene Frage KAN-38, hier NICHT entschieden): Das Fenster „bis Ernte“ beginnt mit
//   der vorigen Lese desselben GST, sonst am 01.01. des Jahrgangs – nicht mit dem Austrieb.
//   Fällt KAN-38 anders aus, ändert sich nur leseFenster().
//   Zu bedenken bei KAN-38: Bei einer Mehrfachlese (selektive Lese, Spätlese, Eiswein) hingen
//   die Trauben der späteren Lese auch vor der vorigen Lese am Stock – Maßnahmen davor fallen
//   mit dieser Annahme aus dem Fenster der späteren Lese (Seite und CSV nennen deshalb den
//   Fensterbeginn samt vorigem Lesedatum).
//   - „Vorige Lese“ = eine andere Lesezeile desselben GST mit eigenem Lesedatum, streng vor
//     diesem Lesedatum und nicht vor dem 01.01. des Jahrgangs (die Lese des Vorjahres zählt
//     nicht, das Fenster beginnt dann am 01.01.). Lesen am selben Tag (eine Lese auf zwei
//     Pressungen verteilt) sind keine vorige Lese – sie bekommen dasselbe Fenster.
//   - Jahrgang = weinjahrgaenge.jahrgang der Pressung, sonst das Jahr des Lesedatums. Liegt
//     das Lesedatum in einem früheren Jahr als der Jahrgang (Datenfehler), gilt der 01.01. des
//     Lesejahres; ein späteres Lesejahr (Eiswein im Jänner) lässt den 01.01. des Jahrgangs.
//   - Lesezeile ohne eigenes Lesedatum: keine Verkürzung durch eine vorige Lese (die Lese
//     könnte am selben Tag wie die vorige gewesen sein) – Fenster ab 01.01.
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
//     viel als eine still weggelassene. Keine Maßnahme beginnt nach dem Lesedatum.

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
}

/** Lesezeilen des Betriebs zu den GST (auch aus anderen Chargen) – nur für „vorige Lese“ */
export type LeseHistorie = { id: string; grundstueckId: string | null; lesedatum: string | null }

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
  bisAus: 'lesedatum' | 'pressungsdatum'
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
 * Zeitfenster einer Lesezeile (Regeln im Dateikopf). null nur, wenn weder Lese- noch
 * Pressungsdatum bekannt ist (pressungen.datum ist NOT NULL – praktisch nie).
 */
export function leseFenster(lese: LeseZeile, historie: readonly LeseHistorie[]): Zeitfenster | null {
  const lesedatum = kalendertag(lese.lesedatum)
  const bis = lesedatum ?? kalendertag(lese.pressungDatum)
  if (!bis) return null
  const jahrBis = jahrVon(bis) as number
  const jahrgang = lese.jahrgang !== null && Number.isInteger(lese.jahrgang) ? lese.jahrgang : jahrBis
  const jahresbeginn = `${String(Math.min(jahrgang, jahrBis)).padStart(4, '0')}-01-01`

  let vorige: string | null = null
  if (lese.grundstueckId && lesedatum) {
    for (const h of historie) {
      if (h.id === lese.id || h.grundstueckId !== lese.grundstueckId) continue
      const d = kalendertag(h.lesedatum)
      if (!d || d >= lesedatum || d < jahresbeginn) continue
      if (!vorige || d > vorige) vorige = d
    }
  }
  return vorige
    ? { von: tagDanach(vorige), bis, beginn: 'vorige_lese', vorigeLese: vorige, bisAus: lesedatum ? 'lesedatum' : 'pressungsdatum' }
    : { von: jahresbeginn, bis, beginn: 'jahresbeginn', vorigeLese: null, bisAus: lesedatum ? 'lesedatum' : 'pressungsdatum' }
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
 * weingartenJeGrundstueck: Weingarten laut grundstuecke (für Maßnahmen nur am Weingarten).
 * Maßnahmen je Lese nach Datum (dann id) sortiert.
 */
export function ordneMassnahmenZu<M extends MassnahmeOrt>(
  lesen: readonly LeseZeile[],
  historie: readonly LeseHistorie[],
  massnahmen: readonly M[],
  grundstueckeJeWeingarten: ReadonlyMap<string, readonly string[]>,
  weingartenJeGrundstueck: ReadonlyMap<string, string>,
): LeseZuordnung<M>[] {
  const sortiert = [...massnahmen].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return lesen.map(lese => {
    const hinweise: string[] = []
    const gst = lese.grundstueckId
    const weingaerten = new Set<string>()
    if (lese.weingartenId) weingaerten.add(lese.weingartenId)
    if (gst && weingartenJeGrundstueck.get(gst)) weingaerten.add(weingartenJeGrundstueck.get(gst) as string)

    // Ohne GST verkürzt leseFenster nie über eine vorige Lese (Beginn 01.01. des Jahrgangs)
    const fenster = leseFenster(lese, historie)
    if (fenster && fenster.bisAus === 'pressungsdatum') {
      hinweise.push(`Lesedatum fehlt – Zeitfenster bis zum Pressungsdatum ${ttmmjjjj(fenster.bis)}.`)
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
