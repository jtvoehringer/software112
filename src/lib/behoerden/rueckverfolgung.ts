// ── Rückverfolgung Füllung → Charge → Pressung → Weingarten/GST – Seite UND CSV (24.09.2026) ──
//
// Die Kette stand bis 24.09.2026 in kellerbuch/rueckverfolgung/page.tsx (ladeChargeKette);
// jetzt hier, damit Bildschirm, Ausdruck und CSV („rueckverfolgung“) gleich rechnen.
//   Füllung → Chargen (fuellung_chargen, sonst fuellungen.weinausbau_id, sonst eindeutiger
//   Treffer über Rebsorte + Jahrgang) → Pressungen (pressung_behaelter) → Lesezeilen
//   Weingarten/GST (pressung_weingaerten) → Maßnahmen im Weingarten bis zur Lese.
// Maßnahmen (KAN-75, 25.09.2026): je Lesezeile nur die des gelesenen Grundstücks im
// Zeitfenster „Ernte bis Ernte“ (KAN-108, seit 29.09.2026): vom Tag nach der letzten Lese des
// Vorjahrgangs an diesem GST (sonst 01.01. des Jahrgangs) bis einschließlich zum Lesedatum –
// Hauptlese und Eiswein desselben Jahrgangs mit demselben Beginn (Jörgen, 25.09.2026). Fehlt das
// Lesedatum an der Lesezeile (im Echtbetrieb die Regel), bis zum Lesedatum laut Erntemeldung
// (nur wenn eindeutig: ein Lesetag, Menge deckt das Verpresste), sonst bis zum Pressungsdatum.
// Regeln in rueckverfolgungFenster.ts.
// Bis dahin standen hier alle Maßnahmen aller GST der Weingärten ohne Datumsgrenze.
// CSV: eine Zeile je Füllung × Ursprung (Charge × Pressung × Weingarten/GST), mit Anteil
// der Charge an der Füllung und den Maßnahmen dieser Lese (Kette.lesen – dieselbe Zuordnung
// wie auf der Seite).
// Die Trefferliste der Seite (Filter Jahrgang/Sorte/Bezeichnung) kommt ebenfalls von hier;
// ihre Listen-CSV entsteht im Browser (SPALTEN_RUECKVERFOLGUNG_TREFFER). Isomorph.
// Rechtsgrundlage: Art. 18 VO (EG) 178/2002 (Rückverfolgbarkeit).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { bkiRebsorteKuerzel, sortenKuerzel } from '@/lib/wein/bki_kuerzel'
import { qualitaetAnzeigeOderNull } from '@/lib/wein/qualitaet'
import { MASSNAHMEN_ART_LABEL } from '@/lib/behandlungen/arten'
import { normalisiereBehandlung } from './psm'
import { verteileMassnahme, type Verteilung } from '@/lib/wein/massnahmeAnteile'
import { num, numOderNull, tag, text, type R } from './kellerbuch-hilfen'
import { datumAT } from './ernte_hilfen'
import { mostgewichtCsvSpalten } from './mostgewicht_export'
import { ladePnVerlauf, pnStandAm, pnStandText, type PnVerlauf } from '@/lib/kellerbuch/pruefnummerVerlauf'
import {
  kalendertag, ladebereich, leseFenster, leseWarnungen, ordneMassnahmenZu, ttmmjjjj,
  type ErnteEintrag, type ErnteErsatz, type FruehereLese, type LeseZeile, type MassnahmeOrt, type VerpressteTrauben, type Zeitfenster,
} from './rueckverfolgungFenster'
import { AktionsFehler } from '@/lib/fehler'

/** Maßnahmenarten (lib/behandlungen/arten.ts, seit KAN-143 mit Laubschneiden) */
export const BEHANDLUNG_ART_LABEL: Readonly<Record<string, string>> = MASSNAHMEN_ART_LABEL

/** Eine Maßnahme im Zeitfenster einer Lese */
export type LeseMassnahme = {
  /** behandlungen-Zeile (id, datum, datum_bis, art, psm, aufwandmenge …) */
  behandlung: R
  /** nur am Weingarten erfasst (keine Grundstückszuordnung) */
  nurWeingarten: boolean
  /** betroffene GST-Nummern dieser Lese (bei Lese ohne GST: die des Weingartens) */
  grundstuecke: string[]
  /** behandelte Fläche auf diesen GST laut behandlung_grundstuecke; null = nicht erfasst */
  flaecheHa: number | null
  /** KAN-132: Mittel- bzw. Düngermenge anteilig auf diese GST (verteileMassnahme); null = keine Menge bzw. nur am Weingarten */
  menge: number | null
  mengeEinheit: string | null
}

/** Maßnahmen im Weingarten bis zur Lese – je Lesezeile (pressung_weingaerten) einmal */
export type LeseMassnahmen = {
  /** pressung_weingaerten.id */
  leseId: string
  /** pressung_weingaerten-Zeile samt weingarten/grundstueck */
  lese: R
  pressungDatum: string | null
  fenster: Zeitfenster | null
  /** Abgleich mit der Erntemeldung (Fensterende ohne Lesedatum an der Pressung), sonst null */
  ersatz: ErnteErsatz | null
  massnahmen: LeseMassnahme[]
  hinweise: string[]
}

/** KAN-201: Umzug, der eine Prüfnummer an eine neue Charge weitergegeben hat */
export type PnWeitergabe = { datum: string; pruefnummer: string; zielCharge: string | null }

export type Kette = {
  weinausbau: R | null
  /** KAN-201: Prüfnummer je Charge (pruefnummer_chargen) – eigene und per Umzug übernommene, mit Ende */
  pnVerlauf?: PnVerlauf[]
  /** KAN-201: Weitergaben dieser Charge per Umzug an neue Chargen */
  pnWeitergaben?: PnWeitergabe[]
  pressungen: R[]
  /** je Lesezeile der Pressungen die Maßnahmen im Zeitfenster bis zur Lese (KAN-75) */
  lesen: LeseMassnahmen[]
  analysen: R[]
  umzuege: R[]
}

function pruefen<T>(res: { data: T; error: { message?: string } | null }, was: string): T {
  if (res.error) throw new AktionsFehler(`Rückverfolgung: ${was} konnte nicht geladen werden (${res.error.message ?? 'unbekannter Fehler'})`)
  return res.data
}

type MassnahmeRoh = MassnahmeOrt & { roh: R; flaeche: Map<string, number | null> }

/**
 * Lesen der angegebenen Jahrgänge im Betrieb – für den Fensterbeginn „Ernte bis Ernte“
 * (rueckverfolgungFenster.ts): Lesedatum an der Pressungszeile, Erntemeldung und Traubenverkauf
 * (ohne Zukauf-Trauben), nur Einträge mit Lesedatum. Leer, wenn keiner der Jahrgänge angelegt ist.
 */
export async function ladeFruehereLesen(supabase: any, tenantId: string, jahrgaenge: readonly number[]): Promise<FruehereLese[]> {
  const jahre = [...new Set(jahrgaenge.filter(j => Number.isInteger(j)))]
  if (jahre.length === 0) return []
  const jg = pruefen(await alle<R>((supabase.from('weinjahrgaenge') as any)
    .select('id, jahrgang')
    .eq('tenant_id', tenantId)
    .in('jahrgang', jahre)
    .order('id')), 'Jahrgänge')
  const jahrJeId = new Map(jg.map(j => [String(j.id), Number(j.jahrgang)]))
  const ids = [...jahrJeId.keys()]
  if (ids.length === 0) return []
  const [pwRes, epRes, tvRes] = await Promise.all([
    // tenant-isolation-ignore: pressung_weingaerten ohne tenant_id, Filter über die Pressung
    alle<R>((supabase.from('pressung_weingaerten') as any)
      .select('id, weingarten_id, grundstueck_id, ernte_datum, zukauf_posten_id, pressung:pressung_id!inner(tenant_id, jahrgang_id, storniert_am)')
      .eq('pressung.tenant_id', tenantId)
      .in('pressung.jahrgang_id', ids)
      .is('storniert_am', null)
      .not('ernte_datum', 'is', null)
      .order('id')),
    // tenant-isolation-ignore: ernte_parzellen ohne tenant_id, Filter über den Jahrgang
    alle<R>((supabase.from('ernte_parzellen') as any)
      .select('id, jahrgang_id, weingarten_id, grundstueck_id, ernte_datum, jahrgang:jahrgang_id!inner(tenant_id)')
      .eq('jahrgang.tenant_id', tenantId)
      .in('jahrgang_id', ids)
      .is('storniert_am', null)
      .not('ernte_datum', 'is', null)
      .order('id')),
    alle<R>((supabase.from('traubenverkauf') as any)
      .select('id, jahrgang_id, weingarten_id, grundstueck_id, datum, zukauf_posten_id')
      .eq('tenant_id', tenantId)
      .in('jahrgang_id', ids)
      .is('storniert_am', null)
      .is('zukauf_posten_id', null)
      .order('id')),
  ])
  const lesen: FruehereLese[] = []
  const neu = (jahrgangId: unknown, wg: unknown, gst: unknown, datum: unknown) => {
    const jahrgang = jahrJeId.get(String(jahrgangId))
    const lesedatum = kalendertag(datum)
    if (jahrgang !== undefined && lesedatum) lesen.push({ jahrgang, weingartenId: text(wg), grundstueckId: text(gst), lesedatum })
  }
  for (const pw of pruefen(pwRes, 'Lesezeilen der Vorjahre')) {
    const p = pw.pressung as R | null
    if (p?.tenant_id !== tenantId || text(pw.zukauf_posten_id)) continue
    neu(p.jahrgang_id, pw.weingarten_id, pw.grundstueck_id, pw.ernte_datum)
  }
  for (const ep of pruefen(epRes, 'Erntemeldung der Vorjahre')) {
    if ((ep.jahrgang as R | null)?.tenant_id !== tenantId) continue
    neu(ep.jahrgang_id, ep.weingarten_id, ep.grundstueck_id, ep.ernte_datum)
  }
  for (const tv of pruefen(tvRes, 'Traubenverkauf der Vorjahre')) neu(tv.jahrgang_id, tv.weingarten_id, tv.grundstueck_id, tv.datum)
  return lesen
}

/** Vorjahrgänge der Lesezeilen (Jahrgang der Pressung, sonst Jahr des Lese- bzw. Pressungsdatums, minus 1) */
export function vorjahrgaenge(eingaben: readonly LeseZeile[]): number[] {
  const jahre = new Set<number>()
  for (const e of eingaben) {
    const t = kalendertag(e.lesedatum) ?? kalendertag(e.pressungDatum)
    const j = e.jahrgang !== null && Number.isInteger(e.jahrgang) ? e.jahrgang : t ? Number(t.slice(0, 4)) : null
    if (j !== null) jahre.add(j - 1)
  }
  return [...jahre].sort()
}

/**
 * Maßnahmen je Lesezeile der Pressungen (KAN-75): Zeitfenster und Zuordnung in
 * rueckverfolgungFenster.ts; hier nur Laden (je Mandant gefiltert) und Umformen.
 * Seite und CSV bekommen das Ergebnis über ladeChargeKette (Kette.lesen).
 */
export async function ladeLeseMassnahmen(supabase: any, tenantId: string, pressungen: readonly R[]): Promise<LeseMassnahmen[]> {
  // Lesezeilen der Charge – je pressung_weingaerten-Zeile einmal (eine Pressung kann über
  // mehrere Behälter in dieselbe Charge fließen)
  const zeilen = new Map<string, LesezeileEingabe>()
  for (const pb of pressungen) {
    const p = pb.pressung as R | null
    if (!p) continue
    for (const wg of ((p.pressung_weingaerten ?? []) as R[])) {
      const id = text(wg.id)
      if (!id || zeilen.has(id)) continue
      const pressungDatum = tag(p.datum) || null
      zeilen.set(id, {
        lese: wg,
        pressungDatum,
        eingabe: {
          id,
          grundstueckId: text(wg.grundstueck_id),
          weingartenId: text((wg.weingarten as R | null)?.id ?? wg.weingarten_id),
          lesedatum: tag(wg.ernte_datum) || null,
          pressungDatum,
          jahrgang: numOderNull((p.jahrgang as R | null)?.jahrgang),
          jahrgangId: text(p.jahrgang_id),
          leseId: text(p.lese_id),
        },
      })
    }
  }
  return ladeMassnahmenZuLesezeilen(supabase, tenantId, zeilen)
}

/** Eine Lesezeile für die Maßnahmen-Zuordnung: Anzeige-Zeile (lese), Pressungsdatum und Eingabe des Fensters */
export type LesezeileEingabe = { lese: R; pressungDatum: string | null; eingabe: LeseZeile }

/**
 * Maßnahmen je Lesezeile – gemeinsamer Kern von ladeLeseMassnahmen (Kellerbuch-Rückverfolgung) und der
 * Rieden-Rückverfolgung (rv-weingarten.ts, KAN-108): lädt GST, Erntemeldung, verpresste Trauben,
 * Vorjahres-Lesen und Maßnahmen (je Mandant gefiltert) und ordnet sie mit rueckverfolgungFenster.ts zu.
 * lese: Anzeige-Zeile mit ernte_datum, weingarten.name, grundstueck.gst_nr (Sortierung).
 */
export async function ladeMassnahmenZuLesezeilen(
  supabase: any,
  tenantId: string,
  zeilen: ReadonlyMap<string, LesezeileEingabe>,
): Promise<LeseMassnahmen[]> {
  if (zeilen.size === 0) return []
  const eingaben = [...zeilen.values()].map(z => z.eingabe)
  const gstIds = [...new Set(eingaben.map(e => e.grundstueckId).filter((x): x is string => !!x))]
  const wgIds = [...new Set(eingaben.map(e => e.weingartenId).filter((x): x is string => !!x))]
  // Jahrgänge der Lesezeilen ohne eigenes Lesedatum – dort gilt das Lesedatum laut Erntemeldung
  // (pw.ernte_datum schreibt das Pressungsformular nicht, siehe rueckverfolgungFenster.ts)
  const jgOhneLesedatum = [...new Set(eingaben
    .filter(e => !e.lesedatum && (e.grundstueckId || e.weingartenId))
    .map(e => e.jahrgangId)
    .filter((x): x is string => !!x))]

  const leer = Promise.resolve({ data: [] as R[], error: null })
  const [gstWgRes, gstLeseRes, ernteRes, verpresstRes, fruehere] = await Promise.all([
    // alle GST der Weingärten (für Lesen ohne GST) …
    wgIds.length > 0
      ? alle<R>((supabase.from('grundstuecke') as any)
          .select('id, weingarten_id, gst_nr')
          .eq('tenant_id', tenantId)
          .in('weingarten_id', wgIds)
          .order('id'))
      : leer,
    // … und die GST der Lesen selbst (Weingarten laut Grundstück für Maßnahmen am Weingarten)
    gstIds.length > 0
      ? alle<R>((supabase.from('grundstuecke') as any)
          .select('id, weingarten_id, gst_nr')
          .eq('tenant_id', tenantId)
          .in('id', gstIds)
          .order('id'))
      : leer,
    // Lese-Einträge der Erntemeldung – nur Ersatz für ein fehlendes Lesedatum (Fensterende).
    // ernte_parzellen hat keine tenant_id – Mandant über den Jahrgang (!inner)
    jgOhneLesedatum.length > 0
      // tenant-isolation-ignore: ernte_parzellen ohne tenant_id, Filter über den Jahrgang
      ? alle<R>((supabase.from('ernte_parzellen') as any)
          .select('id, jahrgang_id, lese_id, weingarten_id, grundstueck_id, ernte_datum, menge_kg, jahrgang:jahrgang_id!inner(tenant_id)')
          .eq('jahrgang.tenant_id', tenantId)
          .in('jahrgang_id', jgOhneLesedatum)
          .is('storniert_am', null)
          .order('id'))
      : leer,
    // Verpresste Trauben dieser Jahrgänge im Betrieb – Mengenprüfung des Ersatz-Lesedatums
    // (deckt die Erntemeldung das Verpresste nicht, gilt das Pressungsdatum).
    // pressung_weingaerten hat keine tenant_id – Mandant über die Pressung (!inner)
    jgOhneLesedatum.length > 0
      // tenant-isolation-ignore: pressung_weingaerten ohne tenant_id, Filter über die Pressung
      ? alle<R>((supabase.from('pressung_weingaerten') as any)
          .select('id, weingarten_id, grundstueck_id, trauben_kg, pressung:pressung_id!inner(tenant_id, datum, jahrgang_id, lese_id, storniert_am)')
          .eq('pressung.tenant_id', tenantId)
          .in('pressung.jahrgang_id', jgOhneLesedatum)
          .is('storniert_am', null)
          .order('id'))
      : leer,
    // Lesen der Vorjahrgänge – Fensterbeginn „Ernte bis Ernte“ (KAN-108)
    gstIds.length > 0 || wgIds.length > 0 ? ladeFruehereLesen(supabase, tenantId, vorjahrgaenge(eingaben)) : Promise.resolve([] as FruehereLese[]),
  ])

  const gstNr = new Map<string, string>()
  const weingartenJeGst = new Map<string, string>()
  const gstJeWeingarten = new Map<string, string[]>()
  for (const g of [...pruefen(gstWgRes, 'Grundstücke'), ...pruefen(gstLeseRes, 'Grundstücke')]) {
    const id = text(g.id)
    if (!id || gstNr.has(id)) continue
    gstNr.set(id, text(g.gst_nr) ?? '?')
    const wgId = text(g.weingarten_id)
    if (!wgId) continue
    weingartenJeGst.set(id, wgId)
    gstJeWeingarten.set(wgId, [...(gstJeWeingarten.get(wgId) ?? []), id])
  }

  const ernte: ErnteEintrag[] = pruefen(ernteRes, 'Erntemeldung')
    .filter(e => (e.jahrgang as R | null)?.tenant_id === tenantId)
    .map(e => ({ jahrgangId: text(e.jahrgang_id), leseId: text(e.lese_id), weingartenId: text(e.weingarten_id), grundstueckId: text(e.grundstueck_id), lesedatum: tag(e.ernte_datum) || null, mengeKg: numOderNull(e.menge_kg) }))
  const verpresst: VerpressteTrauben[] = pruefen(verpresstRes, 'Verpresste Trauben')
    .filter(v => (v.pressung as R | null)?.tenant_id === tenantId)
    .map(v => ({
      id: String(v.id), jahrgangId: text((v.pressung as R).jahrgang_id), leseId: text((v.pressung as R).lese_id), weingartenId: text(v.weingarten_id), grundstueckId: text(v.grundstueck_id),
      pressungDatum: tag((v.pressung as R).datum) || null, traubenKg: numOderNull(v.trauben_kg),
    }))

  // Maßnahmen des Betriebs im Gesamtbereich aller Fenster; Ort und Fenster prüft ordneMassnahmenZu.
  // Mehrtägige Maßnahmen, die vor dem Bereich beginnen und hineinreichen, zählen mit (datum_bis).
  let massnahmen: MassnahmeRoh[] = []
  if (gstIds.length > 0 || wgIds.length > 0) {
    const bereich = ladebereich(eingaben.map(e => leseFenster(e, ernte, verpresst, fruehere)))
    let q = (supabase.from('behandlungen') as any)
      .select(`
        id, datum, datum_bis, art, weingarten_id, aufwandmenge, aufwandmenge_einheit, schaderreger, witterung, notizen,
        ernte_fruehesteins, wartezeit_eingehalten, bbch_stadium,
        menge_gesamt, menge_einheit, wasseraufwand_l_ha, behandelte_flaeche_ha,
        psm:psm_id(name, handelsname, zulassungsnr, wartezeit_tage),
        duengemittel:duengemittel_id(id, name, einheit),
        behandlung_grundstuecke(grundstueck_id, flaeche_ha, grundstueck:grundstueck_id(id, gst_nr, katastralgemeinde, flaeche_ha))
      `)
      .eq('tenant_id', tenantId)
      .is('storniert_am', null)   // KAN-88: stornierte Maßnahmen zählen nicht
    if (bereich.bis) q = q.lte('datum', bereich.bis)
    if (bereich.von) q = q.or(`datum.gte.${bereich.von},datum_bis.gte.${bereich.von}`)
    massnahmen = pruefen(await alle<R>(q.order('datum').order('id')), 'Maßnahmen').map(b => {
      const flaeche = new Map<string, number | null>()
      for (const bg of ((b.behandlung_grundstuecke ?? []) as R[])) {
        const g = text(bg.grundstueck_id)
        if (!g) continue
        const f = numOderNull(bg.flaeche_ha)
        flaeche.set(g, f === null ? (flaeche.get(g) ?? null) : (flaeche.get(g) ?? 0) + f)
      }
      return { id: String(b.id), datum: tag(b.datum), datumBis: tag(b.datum_bis) || null, weingartenId: text(b.weingarten_id), grundstueckIds: [...flaeche.keys()], roh: b, flaeche }
    })
  }

  const zuordnung = ordneMassnahmenZu(eingaben, massnahmen, gstJeWeingarten, weingartenJeGst, ernte, verpresst, fruehere)
  // KAN-132: Menge je GST über die zentrale Anteilsfunktion – je Maßnahme einmal verteilt
  const verteilungen = new Map<string, Verteilung>()
  const verteilung = (m: MassnahmeRoh) => {
    let v = verteilungen.get(m.id)
    if (!v) { v = verteileMassnahme(normalisiereBehandlung(m.roh)); verteilungen.set(m.id, v) }
    return v
  }
  const lesen: LeseMassnahmen[] = zuordnung.map(z => {
    const { lese, pressungDatum } = zeilen.get(z.leseId)!
    return {
      leseId: z.leseId,
      lese,
      pressungDatum,
      fenster: z.fenster,
      ersatz: z.ersatz,
      hinweise: z.hinweise,
      massnahmen: z.massnahmen.map(t => {
        const flaechen = t.grundstueckIds.map(g => t.massnahme.flaeche.get(g) ?? null).filter((f): f is number => f !== null)
        const orte = new Set(t.grundstueckIds)
        const anteile = t.nurWeingarten ? [] : verteilung(t.massnahme).anteile.filter(a => a.grundstueckId && orte.has(a.grundstueckId))
        const mitMenge = anteile.filter(a => a.mittel !== null)
        return {
          behandlung: t.massnahme.roh,
          nurWeingarten: t.nurWeingarten,
          grundstuecke: t.grundstueckIds.map(g => gstNr.get(g) ?? '?'),
          flaecheHa: flaechen.length > 0 ? flaechen.reduce((s, f) => s + f, 0) : null,
          menge: mitMenge.length > 0 ? runden(mitMenge.reduce((s, a) => s + (a.mittel as number), 0), 3) : null,
          mengeEinheit: mitMenge[0]?.mittelEinheit ?? null,
        }
      }),
    }
  })
  // Reihenfolge: Lesedatum (sonst Ersatz aus Erntemeldung bzw. Pressungsdatum), Weingarten, GST
  const schluessel = (l: LeseMassnahmen) => [
    tag(l.lese.ernte_datum) || l.fenster?.bis || l.pressungDatum || '',
    text((l.lese.weingarten as R | null)?.name) ?? '',
    text((l.lese.grundstueck as R | null)?.gst_nr) ?? '',
    l.leseId,
  ]
  return lesen.sort((a, b) => {
    const ka = schluessel(a), kb = schluessel(b)
    for (let i = 0; i < ka.length; i++) {
      const c = ka[i].localeCompare(kb[i], 'de-AT')
      if (c !== 0) return c
    }
    return 0
  })
}

/** Datum einer Maßnahme: TT.MM.JJJJ, mehrtägig TT.MM.JJJJ–TT.MM.JJJJ */
export function massnahmeZeitraum(b: R): string {
  const von = tag(b.datum), bis = tag(b.datum_bis)
  return bis && bis !== von ? `${ttmmjjjj(von)}–${ttmmjjjj(bis)}` : ttmmjjjj(von)
}

/** Mittel bzw. Art einer Maßnahme */
export function massnahmeMittel(b: R): string {
  return text((b.psm as R | null)?.name) ?? BEHANDLUNG_ART_LABEL[b.art] ?? text(b.art) ?? 'Behandlung'
}

/** Maßnahme als Text (CSV): „10.06.2024 Cuprozin“, ggf. mit GST bzw. Vermerk Weingarten */
export function massnahmeText(m: LeseMassnahme, mitGst: boolean): string {
  const zusatz = m.nurWeingarten ? ' (am Weingarten erfasst)'
    : mitGst && m.grundstuecke.length > 0 ? ` (GST ${m.grundstuecke.join(', ')})` : ''
  return `${massnahmeZeitraum(m.behandlung)} ${massnahmeMittel(m.behandlung)}${zusatz}`.trim()
}

/**
 * Hinweistext einer Lese für die CSV-Spalte „Hinweis Behandlungen“ (die Seite zeigt dieselben
 * Hinweise). Den Fensterbeginn („Ernte bis Ernte“: Tag nach der letzten Lese des Vorjahrgangs am
 * GST, sonst 01.01. des Jahrgangs – dann als X-Warnung) nennt die Spalte „Behandlungen ab“.
 */
export function leseHinweisText(l: LeseMassnahmen): string | null {
  return l.hinweise.length > 0 ? l.hinweise.join(' ') : null
}

/**
 * Vollständige Kette einer Kellerbuch-Charge: Charge, Pressungen samt Weingärten/GST und
 * je Lese die Maßnahmen bis zur Lese (lesen); mit details zusätzlich Analysen und
 * Behälter-Verlauf (nur Bildschirm).
 */
export async function ladeChargeKette(
  supabase: any,
  wId: string,
  tenantId: string,
  opts: { details?: boolean } = {},
): Promise<Kette> {
  const [waRes, prRes, anRes, umRes, pnVerlauf, wgRes] = await Promise.all([
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, status, qualitaetsstufe, zusatzbezeichnung, erzeugnis, kmw, oechsle, mostgewicht_einheit, behaelter_id, behaelter:behaelter_id(name, typ, volumen_liter)')
      .eq('tenant_id', tenantId)
      .eq('id', wId)
      .maybeSingle(),
    // Pressungen, die in diese Charge geflossen sind (pressung_behaelter hat keine tenant_id –
    // Mandant über die Pressung)
    alle<R>((supabase.from('pressung_behaelter') as any)
      .select(`
        id, menge_liter, notizen,
        pressung:pressung_id(
          id, datum, most_liter_gesamt, tenant_id, jahrgang_id, lese_id, storniert_am, jahrgang:jahrgang_id(jahrgang),
          lese:lesen!pressungen_lese_fkey(lfd_nr, art),
          pressung_weingaerten(
            id, trauben_kg, rebsorte, ernte_datum, kmw, oechsle, mostgewicht_einheit, weingarten_id, grundstueck_id, storniert_am,
            weingarten:weingarten_id(id, name, flaeche_ha),
            grundstueck:grundstueck_id(gst_nr, katastralgemeinde)
          )
        )
      `)
      .eq('weinausbau_id', wId)
      .is('storniert_am', null)   // KAN-148 C1c: stornierte Pressungszeilen sind keine Herkunft
      .order('id')),
    opts.details
      ? alle<R>((supabase.from('weinanalysen') as any)
          .select('id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl, bewertung, notizen')
          .eq('tenant_id', tenantId)
          .eq('weinausbau_id', wId)
          .is('storniert_am', null)   // KAN-150 F2: stornierte Analysen sind kein Nachweis
          .order('analyse_datum', { ascending: true })
          .order('id'))
      : Promise.resolve({ data: [] as R[], error: null }),
    // Umzüge (Behälter-Verlauf) – 'quelle'-Zeilen des n:n-Formats
    opts.details
      ? alle<R>((supabase.from('keller_umzuege') as any)
          .select(`
            id, datum, menge_liter, brutto_liter, schwund_liter, notizen, zeilen_typ, umzug_batch_id,
            von_behaelter:von_behaelter_id(name),
            nach_behaelter:nach_behaelter_id(name)
          `)
          .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
          .eq('tenant_id', tenantId)
          .eq('von_weinausbau_id', wId)
          .order('datum', { ascending: true })
          .order('id'))
      : Promise.resolve({ data: [] as R[], error: null }),
    // KAN-201: Prüfnummer je Charge und Weitergaben per Umzug
    ladePnVerlauf(supabase, tenantId, [wId]).then(m => m.get(wId) ?? []),
    // alle-ausnahme: Weitergaben einer einzelnen Charge per Umzug, wenige Zeilen
    alle<R>((supabase.from('pruefnummer_chargen') as any)
      .select('id, gueltig_ab, antrag:dac_antrag_id(pruefnummer, storniert_am), ziel:weinausbau_id(name)')
      .eq('tenant_id', tenantId)
      .eq('quelle_weinausbau_id', wId)
      .order('gueltig_ab')
      .order('id')),
  ])

  const weinausbau = pruefen(waRes as { data: R | null; error: { message?: string } | null }, 'Charge')
  const pressungen = pruefen(prRes, 'Pressungen').filter(pb => (pb.pressung as R | null)?.tenant_id === tenantId)
  const analysen = pruefen(anRes, 'Analysen')
  const umzuegeRaw = pruefen(umRes, 'Umzüge')
  const pnWeitergaben: PnWeitergabe[] = pruefen(wgRes, 'Prüfnummer-Weitergaben')
    .filter(w => (w.antrag as R | null)?.pruefnummer && !(w.antrag as R | null)?.storniert_am)
    .map(w => ({ datum: tag(w.gueltig_ab), pruefnummer: String((w.antrag as R).pruefnummer), zielCharge: text((w.ziel as R | null)?.name) }))

  // Maßnahmen im Weingarten je Lese – nur das gelesene GST, nur bis zum Lesedatum (KAN-75)
  const lesen = await ladeLeseMassnahmen(supabase, tenantId, pressungen)

  // Quell-Zeilen der n:n-Umzüge: Ziel-Behälter nachladen
  const quelleBatchIds = [...new Set(umzuegeRaw.filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id as string))]
  const zielByBatch: Record<string, R> = {}
  if (quelleBatchIds.length > 0) {
    // alle-ausnahme: Umzüge der Rückverfolgungskette einer Charge, wenige
    const zielRows = pruefen(await alle<R>((supabase.from('keller_umzuege') as any)
      .select('id, umzug_batch_id, nach_behaelter:nach_behaelter_id(name), nach_weinausbau:nach_weinausbau_id(name), menge_liter')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .eq('tenant_id', tenantId)
      .in('umzug_batch_id', quelleBatchIds)
      .eq('zeilen_typ', 'ziel')
      .order('id')), 'Umzüge')
    for (const z of zielRows) if (!zielByBatch[z.umzug_batch_id]) zielByBatch[z.umzug_batch_id] = z
  }
  const umzuege = umzuegeRaw.map(u => {
    const z = u.zeilen_typ === 'quelle' && u.umzug_batch_id ? zielByBatch[u.umzug_batch_id] : null
    return z ? { ...u, nach_behaelter: z.nach_behaelter ?? z.nach_weinausbau ?? null, menge_liter: u.brutto_liter ?? u.menge_liter } : u
  })

  return { weinausbau, pressungen, lesen, analysen, umzuege, pnVerlauf, pnWeitergaben }
}

/** KAN-201: Prüfnummer der Charge für den Tankbestand am Tag der Abfüllung (eigene bzw. übernommene, sonst erloschen) */
export function pruefnummerTank(k: Pick<Kette, 'pnVerlauf'>, datum: string | null): string | null {
  return pnStandText(pnStandAm(k.pnVerlauf ?? [], datum))
}

/** KAN-201: Weitergaben eines Umzugs (gleicher Tag) als Text – „Prüfnummer N 1/26 weitergegeben an „GV neu““ */
export function pnWeitergabeText(k: Pick<Kette, 'pnWeitergaben'>, datum: string | null): string | null {
  const d = tag(datum)
  const w = (k.pnWeitergaben ?? []).filter(x => x.datum === d)
  return w.length === 0 ? null : w.map(x => `Prüfnummer ${x.pruefnummer} weitergegeben${x.zielCharge ? ` an „${x.zielCharge}“` : ''}`).join(', ')
}

export type ChargeEintrag = { weinausbauId: string; anteilLiter: number | null; kette: Kette }
export type FuellungKette = {
  fuellung: R
  chargen: ChargeEintrag[]
  /** Wie die Chargen gefunden wurden; 'zukauf' = Handelsware aus einem Flaschenzukauf (KAN-41 Paket 2b, keine Charge) */
  zuordnung: 'fuellung_chargen' | 'direkt' | 'automatisch' | 'zukauf' | 'keine'
  /** nur bei zuordnung 'zukauf': Lieferant, Lieferdatum und Beleg des Flaschenzukaufs */
  zukauf?: { lieferant: string | null; datum: string | null; beleg: string | null }
}

/** KAN-41 Paket 2b: Text zur Herkunft zugekaufter Flaschen (Seite und CSV) */
export function flaschenzukaufText(z: FuellungKette['zukauf']): string {
  const teile = [z?.lieferant ? `von ${z.lieferant}` : null, z?.datum ? `am ${datumAT(z.datum)}` : null, z?.beleg ? `Beleg ${z.beleg}` : null].filter(Boolean)
  return `Flaschenzukauf (Handelsware)${teile.length ? ` ${teile.join(', ')}` : ''} – Rückverfolgung über den Lieferanten`
}

/** Kette einer Füllung (Chargen-Kaskade wie bisher auf der Seite). cache teilt Chargen über mehrere Füllungen. */
export async function ladeFuellungKette(
  supabase: any,
  tenantId: string,
  fuellung: R,
  opts: { details?: boolean; cache?: Map<string, Promise<Kette>> } = {},
): Promise<FuellungKette> {
  const junction = pruefen(await alle<R>((supabase.from('fuellung_chargen') as any)
    .select('id, weinausbau_id, anteil_liter')
    .eq('tenant_id', tenantId)
    .eq('fuellung_id', fuellung.id)
    .order('id')), 'Füllungs-Chargen')

  let ids: { id: string; anteil: number | null }[]
  let zuordnung: FuellungKette['zuordnung']
  let zukauf: FuellungKette['zukauf']
  if (junction.length > 0) {
    ids = junction.filter(r => r.weinausbau_id).map(r => ({ id: r.weinausbau_id as string, anteil: numOderNull(r.anteil_liter) }))
    zuordnung = 'fuellung_chargen'
  } else if (fuellung.weinausbau_id) {
    ids = [{ id: fuellung.weinausbau_id, anteil: null }]
    zuordnung = 'direkt'
  } else if (fuellung.zukauf_posten_id) {
    // KAN-41 Paket 2b: zugekaufte Flaschen nie einer eigenen Charge zuordnen – Herkunft ist der Lieferant
    const { data: z, error } = await (supabase.from('zukauf_posten') as any)
      .select('datum, eingangsrechnungsnummer, lieferant_firma:firmen!lieferant_firma_id(name), lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname)')
      .eq('tenant_id', tenantId)
      .eq('id', fuellung.zukauf_posten_id)
      .maybeSingle()
    if (error) throw new AktionsFehler(`Rückverfolgung: Flaschenzukauf konnte nicht geladen werden (${error.message})`)
    const zr = (z ?? null) as R | null
    const kontakt = zr?.lieferant_kontakt as R | null
    zukauf = {
      lieferant: text((zr?.lieferant_firma as R | null)?.name) ?? text([kontakt?.vorname, kontakt?.nachname].filter(Boolean).join(' ')),
      datum: tag(zr?.datum) || null,
      beleg: text(zr?.eingangsrechnungsnummer),
    }
    ids = []
    zuordnung = 'zukauf'
  } else {
    // Auto-Match: Rebsorte + Jahrgang – nur wenn eindeutig (genau 1 Treffer)
    const { data: auto, error } = await (supabase.from('weinausbau') as any)
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('rebsorte', fuellung.rebsorte ?? '%')
      .eq('jahrgang', fuellung.jahrgang ?? 0)
      .limit(2)
    if (error) throw new AktionsFehler(`Rückverfolgung: Chargen-Zuordnung konnte nicht geladen werden (${error.message})`)
    const treffer = (auto ?? []) as R[]
    ids = treffer.length === 1 ? [{ id: treffer[0].id, anteil: null }] : []
    zuordnung = ids.length > 0 ? 'automatisch' : 'keine'
  }

  const cache = opts.cache ?? new Map<string, Promise<Kette>>()
  const chargen = await Promise.all(ids.map(async ({ id, anteil }) => {
    let k = cache.get(id)
    if (!k) { k = ladeChargeKette(supabase, id, tenantId, { details: opts.details }); cache.set(id, k) }
    return { weinausbauId: id, anteilLiter: anteil, kette: await k }
  }))
  return zuordnung === 'zukauf' ? { fuellung, chargen, zuordnung, zukauf } : { fuellung, chargen, zuordnung }
}

export type RueckverfolgungFilter = { jahrgang: number | null; sorte: string | null; bezeichnung: string | null }

const TREFFER_SELECT = 'id, name, bezeichnung, jahrgang, rebsorte, qualitaet, zusatzbezeichnung, erzeugnis, chargennummer, pruefnummer, bestand_flaschen, flaschengroesse_ml, anzahl_flaschen, menge_liter_gefuellt, datum, weinausbau_id, zukauf_posten_id, aktiv'

/** Trefferliste: alle Füllungen des Betriebs nach Jahrgang/Sorte/Bezeichnung (neueste Jahrgänge zuerst) */
export async function ladeRueckverfolgungTreffer(supabase: any, tenantId: string, f: RueckverfolgungFilter): Promise<R[]> {
  let q = (supabase.from('fuellungen') as any).select(TREFFER_SELECT).eq('tenant_id', tenantId)
  if (f.jahrgang !== null) q = q.eq('jahrgang', f.jahrgang)
  if (f.sorte) q = q.eq('rebsorte', f.sorte)
  if (f.bezeichnung) q = q.eq('bezeichnung', f.bezeichnung)
  return pruefen(await alle<R>(q.order('jahrgang', { ascending: false }).order('name', { ascending: true }).order('id')), 'Füllungen')
}

/** Eine Füllung des Betriebs (null, wenn nicht vorhanden) */
export async function ladeFuellung(supabase: any, tenantId: string, fuellungId: string): Promise<R | null> {
  const { data, error } = await (supabase.from('fuellungen') as any)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', fuellungId)
    .maybeSingle()
  if (error) throw new AktionsFehler(`Rückverfolgung: Füllung konnte nicht geladen werden (${error.message})`)
  return (data as R | null) ?? null
}

// ── CSV ─────────────────────────────────────────────────────────────────────

export type RueckverfolgungZeile = {
  fuellung: string | null
  chargennummer: string | null
  pruefnummer: string | null
  abfuelldatum: string | null
  jahrgang: number | null
  sorte: string | null
  flaschen: number | null
  flaschengroesseMl: number | null
  charge: string | null
  chargeJahrgang: number | null
  anteilLiter: number | null
  anteilPct: number | null
  herkunft: string
  pressungDatum: string | null
  pressungLiter: number | null
  weingarten: string | null
  katastralgemeinde: string | null
  gstNr: string | null
  rebsorteLese: string | null
  traubenKg: number | null
  lesedatum: string | null
  /** KAN-201: Prüfnummer der Charge für den Tankbestand am Abfülltag (übernommen bzw. erloschen) */
  pruefnummerTank: string | null
  /** KAN-131: Mostgewicht wie gespeichert (Lese; ohne Pressung die Charge) – die CSV rundet über mostgewichtCsvSpalten */
  kmw: number | null
  oechsle: number | null
  mostgewichtEinheit: string | null
  /** Zeitfenster der Maßnahmen dieser Lese ('JJJJ-MM-TT', inklusive) */
  fensterVon: string | null
  fensterBis: string | null
  behandlungenAnzahl: number | null
  behandlungen: string | null
  behandlungenHinweis: string | null
}

const ZUORDNUNG_TEXT: Record<FuellungKette['zuordnung'], string> = {
  fuellung_chargen: '', direkt: ' (direkt verknüpft)', automatisch: ' (automatisch über Rebsorte und Jahrgang)', zukauf: '', keine: '',
}

/** Füllung × Ursprung – eine Zeile je Charge × Pressung × Weingarten/GST (reine Umformung, testbar) */
export function rueckverfolgungZeilen(ketten: readonly FuellungKette[]): RueckverfolgungZeile[] {
  const zeilen: RueckverfolgungZeile[] = []
  for (const fk of ketten) {
    const f = fk.fuellung
    const flaschen = numOderNull(f.anzahl_flaschen)
    const basis = {
      fuellung: text(f.name),
      chargennummer: text(f.chargennummer),
      pruefnummer: text(f.pruefnummer),
      abfuelldatum: tag(f.datum) || null,
      jahrgang: typeof f.jahrgang === 'number' ? f.jahrgang : numOderNull(f.jahrgang),
      sorte: text(f.rebsorte),
      flaschen: flaschen === null ? null : Math.trunc(flaschen),
      flaschengroesseMl: numOderNull(f.flaschengroesse_ml),
    }
    const leer = {
      charge: null, chargeJahrgang: null, anteilLiter: null, anteilPct: null, pruefnummerTank: null, pressungDatum: null, pressungLiter: null,
      weingarten: null, katastralgemeinde: null, gstNr: null, rebsorteLese: null, traubenKg: null, lesedatum: null, kmw: null,
      oechsle: null, mostgewichtEinheit: null,
      fensterVon: null, fensterBis: null, behandlungenAnzahl: null, behandlungen: null, behandlungenHinweis: null,
    }
    if (fk.chargen.length === 0) {
      zeilen.push({ ...basis, ...leer, herkunft: fk.zuordnung === 'zukauf' ? flaschenzukaufText(fk.zukauf) : 'keine Kellerbuch-Charge verknüpft – Rückverfolgung nur bis zur Abfüllung' })
      continue
    }
    const summeAnteil = fk.chargen.every(c => c.anteilLiter !== null) ? fk.chargen.reduce((s, c) => s + (c.anteilLiter ?? 0), 0) : null
    for (const c of fk.chargen) {
      const wa = c.kette.weinausbau
      const anteilPct = fk.chargen.length === 1 ? 100
        : summeAnteil && summeAnteil > 0 && c.anteilLiter !== null ? runden((c.anteilLiter / summeAnteil) * 100, 1) : null
      const chargeTeil = {
        charge: text(wa?.name) ?? `Charge ${c.weinausbauId.slice(0, 8)}`,
        chargeJahrgang: typeof wa?.jahrgang === 'number' ? wa.jahrgang : null,
        anteilLiter: c.anteilLiter === null ? null : runden(c.anteilLiter, STELLEN.liter),
        anteilPct,
        pruefnummerTank: pruefnummerTank(c.kette, basis.abfuelldatum),
      }
      const vorher = zeilen.length
      const leseJeId = new Map(c.kette.lesen.map(l => [l.leseId, l]))
      for (const pb of c.kette.pressungen) {
        const p = pb.pressung as R | null
        if (!p) continue
        const pressungTeil = { pressungDatum: tag(p.datum) || null, pressungLiter: numOderNull(pb.menge_liter) === null ? null : runden(num(pb.menge_liter), STELLEN.liter) }
        const wgListe = (p.pressung_weingaerten ?? []) as R[]
        if (wgListe.length === 0) {
          zeilen.push({ ...basis, ...leer, ...chargeTeil, ...pressungTeil, herkunft: `Pressung (Weingarten unbekannt)${ZUORDNUNG_TEXT[fk.zuordnung]}` })
          continue
        }
        for (const wg of wgListe) {
          const w = wg.weingarten as R | null
          const g = wg.grundstueck as R | null
          // Maßnahmen dieser Lese – dieselbe Zuordnung wie auf der Seite (Kette.lesen, KAN-75)
          const l = wg.id ? leseJeId.get(String(wg.id)) : undefined
          const kg = numOderNull(wg.trauben_kg)
          zeilen.push({
            ...basis, ...leer, ...chargeTeil, ...pressungTeil,
            herkunft: `Pressung${ZUORDNUNG_TEXT[fk.zuordnung]}`,
            weingarten: text(w?.name),
            katastralgemeinde: text(g?.katastralgemeinde),
            gstNr: text(g?.gst_nr),
            rebsorteLese: text(wg.rebsorte),
            traubenKg: kg === null ? null : runden(kg, STELLEN.kg),
            lesedatum: tag(wg.ernte_datum) || null,
            kmw: numOderNull(wg.kmw), oechsle: numOderNull(wg.oechsle), mostgewichtEinheit: text(wg.mostgewicht_einheit),
            fensterVon: l?.fenster?.von ?? null,
            fensterBis: l?.fenster?.bis ?? null,
            behandlungenAnzahl: l ? l.massnahmen.length : null,
            behandlungen: l ? l.massnahmen.map(m => massnahmeText(m, !l.lese.grundstueck_id)).join(' | ') || null : null,
            behandlungenHinweis: l ? leseHinweisText(l) : 'Maßnahmen nicht ermittelt (Lesezeile ohne Kennung).',
          })
        }
      }
      if (zeilen.length === vorher) {
        // KAN-131: ohne Pressung das Mostgewicht der Charge (Zukauf, Eröffnungsbestand bzw. aus Umzug/Verschnitt übernommen)
        zeilen.push({ ...basis, ...leer, ...chargeTeil, herkunft: 'ohne Pressung (Zukauf, Eröffnungsbestand oder Verschnitt – siehe Blend-Protokoll)',
          kmw: numOderNull(wa?.kmw), oechsle: numOderNull(wa?.oechsle), mostgewichtEinheit: text(wa?.mostgewicht_einheit) })
      }
    }
  }
  return zeilen
}

/**
 * CSV „rueckverfolgung“: eine Füllung (fuellungId) oder alle Füllungen der Trefferliste.
 * null, wenn die angegebene Füllung nicht existiert.
 */
export async function ladeRueckverfolgung(
  supabase: any,
  tenantId: string,
  p: { fuellungId: string | null } & RueckverfolgungFilter,
): Promise<{ zeilen: RueckverfolgungZeile[]; warnungen: string[]; fuellung: R | null } | null> {
  let fuellungen: R[]
  let einzel: R | null = null
  if (p.fuellungId) {
    einzel = await ladeFuellung(supabase, tenantId, p.fuellungId)
    if (!einzel) return null
    fuellungen = [einzel]
  } else {
    fuellungen = await ladeRueckverfolgungTreffer(supabase, tenantId, p)
  }
  // Füllungen nacheinander, Chargen je Füllung parallel; gemeinsame Chargen nur einmal laden
  const cache = new Map<string, Promise<Kette>>()
  const ketten: FuellungKette[] = []
  for (const f of fuellungen) ketten.push(await ladeFuellungKette(supabase, tenantId, f, { cache }))

  const warnungen: string[] = []
  const ohne = ketten.filter(k => k.chargen.length === 0).length
  if (ohne > 0) warnungen.push(`${ohne} ${ohne === 1 ? 'Füllung hat' : 'Füllungen haben'} keine verknüpfte Kellerbuch-Charge – Rückverfolgung nur bis zur Abfüllung.`)
  const auto = ketten.filter(k => k.zuordnung === 'automatisch').length
  if (auto > 0) warnungen.push(`${auto} ${auto === 1 ? 'Füllung ist' : 'Füllungen sind'} nur automatisch über Rebsorte und Jahrgang einer Charge zugeordnet – bitte prüfen.`)
  // Sonderfälle der Maßnahmen-Zuordnung (KAN-75) auch als Warnung beim Download – je Lesezeile
  // einmal, auch wenn ihre Charge in mehreren Füllungen steckt; Einzelheiten je Zeile in der CSV
  const lesen = new Map<string, LeseMassnahmen>()
  for (const k of ketten) for (const c of k.chargen) for (const l of c.kette.lesen) lesen.set(l.leseId, l)
  warnungen.push(...leseWarnungen([...lesen.values()]))
  return { zeilen: rueckverfolgungZeilen(ketten), warnungen, fuellung: einzel }
}

export const SPALTEN_RUECKVERFOLGUNG: CsvSpalte<RueckverfolgungZeile>[] = [
  { kopf: 'Füllung', typ: 'text', wert: z => z.fuellung },
  { kopf: 'Chargennummer', typ: 'code', wert: z => z.chargennummer },
  { kopf: 'Prüfnummer', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'Abfülldatum', typ: 'datum', wert: z => z.abfuelldatum },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Sorte', typ: 'text', wert: z => z.sorte },
  // KAN-89: Vorgabe BKI – neben der Sorte das Sortenkürzel
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => sortenKuerzel(z.sorte) },
  { kopf: 'Flaschen (Stk)', typ: 'ganzzahl', wert: z => z.flaschen },
  { kopf: 'Flaschengröße (ml)', typ: 'ganzzahl', wert: z => z.flaschengroesseMl },
  { kopf: 'Kellerbuch-Charge', typ: 'text', wert: z => z.charge },
  { kopf: 'Jahrgang Charge', typ: 'ganzzahl', wert: z => z.chargeJahrgang },
  { kopf: 'Anteil Charge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.anteilLiter },
  { kopf: 'Anteil Charge (%)', typ: 'prozent', stellen: 1, wert: z => z.anteilPct },
  { kopf: 'Herkunft', typ: 'text', wert: z => z.herkunft },
  { kopf: 'Pressung (Datum)', typ: 'datum', wert: z => z.pressungDatum },
  { kopf: 'Most aus Pressung (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.pressungLiter },
  { kopf: 'Weingarten / Ried', typ: 'text', wert: z => z.weingarten },
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.katastralgemeinde },
  { kopf: 'GST-Nr.', typ: 'code', wert: z => z.gstNr },
  { kopf: 'Rebsorte (Lese)', typ: 'text', wert: z => z.rebsorteLese },
  { kopf: 'BKI-Kürzel (Lese)', typ: 'code', wert: z => sortenKuerzel(z.rebsorteLese) },
  { kopf: 'Trauben (kg)', typ: 'dezimal', stellen: STELLEN.kg, wert: z => z.traubenKg },
  { kopf: 'Lesedatum', typ: 'datum', wert: z => z.lesedatum },
  // KAN-131: °KMW (abgerundet, 2 Stellen) vor °Oe, gemessene Einheit
  ...mostgewichtCsvSpalten<RueckverfolgungZeile>(z => ({ kmw: z.kmw, oechsle: z.oechsle, einheit: z.mostgewichtEinheit }), 2),
  { kopf: 'Behandlungen ab', typ: 'datum', wert: z => z.fensterVon },
  // bewusst ohne „(Lese)“: fehlt das Lesedatum, endet das Fenster am Ersatzdatum (Hinweis-Spalte)
  { kopf: 'Behandlungen bis', typ: 'datum', wert: z => z.fensterBis },
  { kopf: 'Behandlungen (Anzahl)', typ: 'ganzzahl', wert: z => z.behandlungenAnzahl },
  { kopf: 'Behandlungen (Datum Mittel)', typ: 'text', wert: z => z.behandlungen },
  { kopf: 'Hinweis Behandlungen', typ: 'text', wert: z => z.behandlungenHinweis },
  // KAN-201: Prüfnummer der Charge am Abfülltag (eigene oder per Umzug übernommen, sonst „erloschen am …“) – am Ende
  { kopf: 'Prüfnummer (Tank)', typ: 'text', wert: z => z.pruefnummerTank },
]

// ── Trefferliste (Listen-CSV im Browser) ──────────────────────────────────────

export const SPALTEN_RUECKVERFOLGUNG_TREFFER: CsvSpalte<R>[] = [
  { kopf: 'Produktname', typ: 'text', wert: f => f.name },
  { kopf: 'Bezeichnung', typ: 'text', wert: f => f.bezeichnung },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: f => f.jahrgang },
  { kopf: 'Sorte', typ: 'text', wert: f => f.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: f => bkiRebsorteKuerzel(text(f.rebsorte)) },
  { kopf: 'Qualität', typ: 'text', wert: f => qualitaetAnzeigeOderNull(f) },   // KAN-186: Stufe + Zusatzbezeichnung/Erzeugnis
  { kopf: 'Chargennummer', typ: 'code', wert: f => f.chargennummer },
  { kopf: 'Prüfnummer', typ: 'code', wert: f => f.pruefnummer },
  { kopf: 'Flaschengröße (ml)', typ: 'ganzzahl', wert: f => f.flaschengroesse_ml },
  { kopf: 'Bestand (Flaschen)', typ: 'ganzzahl', wert: f => Math.trunc(num(f.bestand_flaschen)) },
  { kopf: 'Aktiv', typ: 'janein', wert: f => f.aktiv },
]
