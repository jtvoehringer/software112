// ── Blend-Protokoll (Herkunftsanteile je Füllung bzw. Charge) – Seiten UND CSV (24.09.2026) ──
//
// Quelle: ladeZusammensetzungCharge/-Fuellung() (lib/wein/blendKomposition.ts) mit dem zeitrichtigen
// Rechenkern lib/wein/mischungsrechnung.ts (KAN-76): alle Bewegungen chronologisch, Abgänge anteilig,
// Umzüge und Verschnitte mit der Mischung der Quelle – bis zu Pressung (Weingarten/GST), Zukauf oder
// Eröffnungsbestand, Anteile auf 1 Stelle mit Summe 100,0. Charge: heute oder zum Stichtag (?stichtag=);
// Füllung: Zusammensetzung unmittelbar vor der Abfüllung. Weicht der Bestand vom Saldo ab: Warnung. Die CSV hat eine Zeile
// je Herkunftsanteil; Kopfangaben (Bezeichnung, Prüfnummer, Chargennummer) stehen in jeder
// Zeile. „Menge anteilig“ = Bezugsmenge × Anteil (Füllung: abgefüllte Liter, Charge:
// aktueller Bestand) – eine rechnerische Aufteilung, keine gebuchte Menge.
//
// Prüfnummer (KAN-72, 25.09.2026): Charge – nur eine heute gültige Nummer laut
// pruefnummerGueltig() (lib/kellerbuch/pruefnummer.ts; nach Verschnitt, Zugang, Zukauf oder
// Pressung seit der Einreichung gilt sie nicht mehr, § 25 Abs. 6 WeinG), sonst Hinweiszeile und leere
// CSV-Spalte mit Warnung. Füllung – die Nummer der Füllung (Stichtag = Abfüllung), ersatzweise
// die ihres genehmigten, aktiven DAC-Antrags derselben Charge, wenn zwischen Abfüllung und Beginn
// des Antrags nichts zugebucht wurde (ersatzPruefnummer, wie die TBS). Der Dateiname enthält nie
// eine Prüfnummer.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, wienHeute, type CsvSpalte } from '@/lib/csv'
import { ladeZusammensetzungCharge, ladeZusammensetzungFuellung, type KompositionUrsprung } from '@/lib/wein/blendKomposition'
import { bkiRebsorteKuerzel, fehlendeKuerzelHinweise } from '@/lib/wein/bki_kuerzel'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { ersatzPruefnummer, pruefnummerAusAntrag, pruefnummerGueltig, pruefnummerHinweis } from '@/lib/kellerbuch/pruefnummer'
import { antragAusZeile, ladePruefnummerDaten, PN_ANTRAG_SELECT } from '@/lib/kellerbuch/pruefnummerLaden'
import { num, numOderNull, tag, text, type R } from './kellerbuch-hilfen'

export type BlendArt = 'fuellung' | 'charge'

export type BlendKopf = {
  art: BlendArt
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  qualitaet: string | null
  /** nur eine gültige Prüfnummer (Charge: heute, Füllung: die der Abfüllung) */
  pruefnummer: string | null
  /** warum eine (frühere bzw. Ersatz-)Prüfnummer nicht (mehr) gilt – für Kopf und Warnung, sonst null */
  pruefnummerHinweis: string | null
  chargennummer: string | null
  /** Abfülldatum (Füllung) bzw. Stichtag (Charge, nur wenn angegeben) */
  datum: string | null
  anzahlFlaschen: number | null
  flaschengroesseMl: number | null
  /** Bezugsmenge in l: Füllung = abgefüllte Liter, Charge = aktueller Bestand bzw. Saldo zum Stichtag */
  bezugLiter: number | null
}

export function herkunftLabel(u: Pick<KompositionUrsprung, 'typ' | 'weingarten_name' | 'gst_nr' | 'zukauf_von'>): string {
  if (u.typ === 'pressung') {
    const teile = [u.weingarten_name, u.gst_nr ? `GST ${u.gst_nr}` : null].filter(Boolean)
    return teile.length > 0 ? teile.join(' · ') : 'Pressung (Weingarten unbekannt)'
  }
  if (u.typ === 'zukauf') return u.zukauf_von ? `Zukauf – ${u.zukauf_von}` : 'Zukauf'
  if (u.typ === 'eroeffnungsbestand') return 'Eröffnungsbestand (historisch)'
  return 'Herkunft unbekannt'
}

const HERKUNFT_ART: Record<KompositionUrsprung['typ'], string> = {
  pressung: 'Pressung', zukauf: 'Zukauf', eroeffnungsbestand: 'Eröffnungsbestand', unbekannt: 'unbekannt',
}

export type BlendZeile = {
  bezugArt: string
  bezeichnung: string
  pruefnummer: string | null
  chargennummer: string | null
  herkunft: string
  herkunftArt: string
  rebsorte: string | null
  kuerzel: string | null
  jahrgang: number | null
  weingarten: string | null
  katastralgemeinde: string | null
  gstNr: string | null
  lesedatum: string | null
  kmw: number | null
  lieferant: string | null
  anteilPct: number
  bezugLiter: number | null
  mengeLiter: number | null
}

/** Herkunftsanteile als CSV-Zeilen (reine Umformung, testbar) */
export function blendZeilen(kopf: BlendKopf, komposition: readonly (Omit<KompositionUrsprung, 'liter'> & { liter?: number })[]): BlendZeile[] {
  // KAN-76: Liter aus der Mischungsrechnung auf die Bezugsmenge bezogen (Summe = Bezugsmenge);
  // ohne Liter (ältere Aufrufer) wie bisher Bezugsmenge × Anteil
  const literSumme = komposition.reduce((s, u) => s + (u.liter ?? 0), 0)
  return komposition.map(u => {
    const anteilPct = runden(u.anteil_pct, 1)
    return {
      bezugArt: kopf.art === 'fuellung' ? 'Füllung' : 'Charge',
      bezeichnung: kopf.name,
      pruefnummer: kopf.pruefnummer,
      chargennummer: kopf.chargennummer,
      herkunft: herkunftLabel(u),
      herkunftArt: HERKUNFT_ART[u.typ] ?? u.typ,
      rebsorte: text(u.rebsorte),
      kuerzel: bkiRebsorteKuerzel(text(u.rebsorte)),
      jahrgang: u.jahrgang ?? null,
      weingarten: text(u.weingarten_name),
      katastralgemeinde: text(u.katastralgemeinde),
      gstNr: text(u.gst_nr),
      lesedatum: tag(u.ernte_datum) || null,
      kmw: u.kmw === null ? null : runden(u.kmw, STELLEN.kmw),
      lieferant: text(u.zukauf_von),
      anteilPct,
      bezugLiter: kopf.bezugLiter,
      mengeLiter: kopf.bezugLiter === null ? null
        : u.liter != null && literSumme > 0 ? runden(kopf.bezugLiter * u.liter / literSumme, STELLEN.liter)
        : runden(kopf.bezugLiter * anteilPct / 100, STELLEN.liter),
    }
  })
}

export type BlendProtokoll = { kopf: BlendKopf; komposition: KompositionUrsprung[]; zeilen: BlendZeile[]; warnungen: string[] }

/** Blend-Protokoll einer Füllung oder Charge – null, wenn sie im aktiven Betrieb nicht existiert */
export async function ladeBlendProtokoll(
  supabase: any,
  tenantId: string,
  p: { art: BlendArt; id: string; stichtag?: string | null },
): Promise<BlendProtokoll | null> {
  let kopf: BlendKopf
  let komposition: KompositionUrsprung[]
  const warnungen: string[] = []
  if (p.art === 'fuellung') {
    const { data, error } = await (supabase.from('fuellungen') as any)
      .select('id, name, chargennummer, pruefnummer, dac_antrag_id, weinausbau_id, jahrgang, rebsorte, qualitaet, datum, anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt')
      .eq('tenant_id', tenantId)
      .eq('id', p.id)
      .maybeSingle()
    if (error) throw new Error(`Blend-Protokoll: Füllung konnte nicht geladen werden (${error.message})`)
    const f = data as R | null
    if (!f) return null
    // Prüfnummer der Füllung (Stichtag = Abfüllung); ohne eigene Nummer die des verknüpften,
    // genehmigten und aktiven DAC-Antrags (Nummer erst nach der Abfüllung erteilt) – nur, wenn
    // der Antrag zur Charge der Füllung gehört (in /dac umgehängt → keine Nummer) und zwischen
    // Abfüllung und Beginn des Antrags nichts zugebucht wurde – wie die TBS
    let pruefnummer = text(f.pruefnummer)
    let pnHinweis: string | null = null
    if (!pruefnummer && f.dac_antrag_id) {
      // storno-sichtbar: antragAusZeile führt stornierte DAC-Anträge als inaktiv (keine gültige Prüfnummer, KAN-150 F2)
      const { data: dac, error: dacErr } = await (supabase.from('dac_antrag') as any)
        .select(PN_ANTRAG_SELECT)
        .eq('tenant_id', tenantId)
        .eq('id', f.dac_antrag_id)
        .maybeSingle()
      if (dacErr) throw new Error(`Blend-Protokoll: DAC-Antrag der Füllung konnte nicht geladen werden (${dacErr.message})`)
      const antrag = dac ? antragAusZeile(dac as R) : null
      const chargeId = f.weinausbau_id ? String(f.weinausbau_id) : null
      const zugaenge = antrag && chargeId && pruefnummerAusAntrag(antrag, chargeId)
        ? (await ladePruefnummerDaten(supabase, tenantId, [chargeId])).get(chargeId)?.zugaenge ?? []
        : []
      const e = ersatzPruefnummer(antrag, { datum: tag(f.datum) || null, chargeId }, zugaenge)
      pruefnummer = e.pruefnummer
      pnHinweis = e.hinweis
      if (pnHinweis) warnungen.push(`${pnHinweis} Die Spalte „Prüfnummer“ bleibt leer.`)
    }
    const flaschen = numOderNull(f.anzahl_flaschen)
    const groesse = numOderNull(f.flaschengroesse_ml)
    const bezug = num(f.menge_liter_gefuellt) || (flaschen && groesse ? flaschen * groesse / 1000 : 0)
    kopf = {
      art: 'fuellung', id: f.id, name: text(f.name) ?? 'Füllung',
      jahrgang: numOderNull(f.jahrgang), rebsorte: text(f.rebsorte), qualitaet: f.qualitaet ? qualitaetLabel(f.qualitaet) : null,
      pruefnummer, pruefnummerHinweis: pnHinweis, chargennummer: text(f.chargennummer), datum: tag(f.datum) || null,
      anzahlFlaschen: flaschen === null ? null : Math.trunc(flaschen), flaschengroesseMl: groesse,
      bezugLiter: bezug > 0 ? runden(bezug, STELLEN.liter) : null,
    }
    const z = await ladeZusammensetzungFuellung(supabase, tenantId, p.id)
    komposition = z.anteile
    warnungen.push(...z.warnungen)
  } else {
    // KAN-76: Stichtag (optional) – Zusammensetzung, Bestand und Prüfnummer zu diesem Tag
    const stichtag = p.stichtag ?? null
    const heute = stichtag ?? wienHeute()
    const [waRes, pnDaten] = await Promise.all([
      (supabase.from('weinausbau') as any)
        .select('id, name, jahrgang, rebsorte, qualitaetsstufe, menge_liter')
        .eq('tenant_id', tenantId)
        .eq('id', p.id)
        .maybeSingle(),
      // KAN-72: Prüfnummer nur, wenn sie für den heutigen Bestand gilt (dieselbe Regel wie
      // TBS-Vorbelegung und Füllungsvorschlag) – nicht mehr „jüngster Antrag mit Nummer“
      ladePruefnummerDaten(supabase, tenantId, [p.id], { heute }),
    ])
    if (waRes.error) throw new Error(`Blend-Protokoll: Charge konnte nicht geladen werden (${waRes.error.message})`)
    const wa = waRes.data as R | null
    if (!wa) return null
    const daten = pnDaten.get(p.id)
    const pn = daten ? pruefnummerGueltig(daten, heute) : null
    const hinweis = pn ? pruefnummerHinweis(pn) : null
    if (hinweis) warnungen.push(`${hinweis} Die Spalte „Prüfnummer“ bleibt leer.`)
    const z = await ladeZusammensetzungCharge(supabase, tenantId, p.id, stichtag)
    const bestand = stichtag ? z.saldoLiter : num(wa.menge_liter)
    kopf = {
      art: 'charge', id: wa.id, name: text(wa.name) ?? 'Charge',
      jahrgang: numOderNull(wa.jahrgang), rebsorte: text(wa.rebsorte), qualitaet: wa.qualitaetsstufe ? qualitaetLabel(wa.qualitaetsstufe) : null,
      pruefnummer: pn?.gueltig ? pn.pruefnummer : null, pruefnummerHinweis: hinweis, chargennummer: null, datum: stichtag,
      anzahlFlaschen: null, flaschengroesseMl: null,
      bezugLiter: bestand > 0 ? runden(bestand, STELLEN.liter) : null,
    }
    komposition = z.anteile
    warnungen.push(...z.warnungen)
  }

  if (komposition.length === 0) warnungen.push('Keine Herkunftsdaten ermittelbar – die Datei enthält nur die Kopfzeile.')
  const unbekannt = komposition.filter(u => u.typ === 'unbekannt').length
  if (unbekannt > 0) warnungen.push(`${unbekannt} ${unbekannt === 1 ? 'Anteil hat' : 'Anteile haben'} keine ermittelbare Herkunft (Pressungs- oder Verschneidungsdaten unvollständig).`)
  if (kopf.bezugLiter === null && komposition.length > 0) warnungen.push(kopf.art === 'charge'
    ? 'Die Charge hat keinen Bestand mehr – „Menge anteilig (l)“ bleibt leer.'
    : 'Die abgefüllte Menge ist unbekannt – „Menge anteilig (l)“ bleibt leer.')
  const zeilen = blendZeilen(kopf, komposition)
  warnungen.push(...fehlendeKuerzelHinweise(zeilen.map(z => z.rebsorte), { einheit: ['Herkunftsanteil', 'Herkunftsanteile'] }))
  return { kopf, komposition, zeilen, warnungen }
}

export const SPALTEN_BLEND: CsvSpalte<BlendZeile>[] = [
  { kopf: 'Bezug', typ: 'text', wert: z => z.bezugArt },
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Prüfnummer', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'Chargennummer', typ: 'code', wert: z => z.chargennummer },
  { kopf: 'Herkunft', typ: 'text', wert: z => z.herkunft },
  { kopf: 'Art der Herkunft', typ: 'text', wert: z => z.herkunftArt },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Weingarten / Ried', typ: 'text', wert: z => z.weingarten },
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.katastralgemeinde },
  { kopf: 'GST-Nr.', typ: 'code', wert: z => z.gstNr },
  { kopf: 'Lesedatum', typ: 'datum', wert: z => z.lesedatum },
  { kopf: 'KMW (°)', typ: 'dezimal', stellen: STELLEN.kmw, wert: z => z.kmw },
  { kopf: 'Lieferant (Zukauf)', typ: 'text', wert: z => z.lieferant },
  { kopf: 'Anteil (%)', typ: 'prozent', stellen: 1, wert: z => z.anteilPct },
  { kopf: 'Bezugsmenge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.bezugLiter },
  { kopf: 'Menge anteilig (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.mengeLiter },
]
