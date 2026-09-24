// ── Blend-Protokoll (Herkunftsanteile je Füllung bzw. Charge) – Seiten UND CSV (24.09.2026) ──
//
// Quelle bleibt resolveBlendKomposition[Fuellung]() (lib/wein/blendKomposition.ts): rekursiv
// über alle Verschneidungs-Generationen bis zu Pressung (Weingarten/GST), Zukauf oder
// Eröffnungsbestand, auf 100 % normalisiert (Anteil auf 1 Stelle). Die CSV hat eine Zeile
// je Herkunftsanteil; Kopfangaben (Bezeichnung, Prüfnummer, Chargennummer) stehen in jeder
// Zeile. „Menge anteilig“ = Bezugsmenge × Anteil (Füllung: abgefüllte Liter, Charge:
// aktueller Bestand) – eine rechnerische Aufteilung, keine gebuchte Menge.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { resolveBlendKomposition, resolveBlendKompositionFuellung, type KompositionUrsprung } from '@/lib/wein/blendKomposition'
import { bkiRebsorteKuerzel, fehlendeKuerzelHinweise } from '@/lib/wein/bki_kuerzel'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { num, numOderNull, tag, text, type R } from './kellerbuch-hilfen'

export type BlendArt = 'fuellung' | 'charge'

export type BlendKopf = {
  art: BlendArt
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  qualitaet: string | null
  pruefnummer: string | null
  chargennummer: string | null
  /** Abfülldatum (nur Füllung) */
  datum: string | null
  anzahlFlaschen: number | null
  flaschengroesseMl: number | null
  /** Bezugsmenge in l: Füllung = abgefüllte Liter, Charge = aktueller Bestand */
  bezugLiter: number | null
}

export function herkunftLabel(u: KompositionUrsprung): string {
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
export function blendZeilen(kopf: BlendKopf, komposition: readonly KompositionUrsprung[]): BlendZeile[] {
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
      mengeLiter: kopf.bezugLiter === null ? null : runden(kopf.bezugLiter * anteilPct / 100, STELLEN.liter),
    }
  })
}

export type BlendProtokoll = { kopf: BlendKopf; komposition: KompositionUrsprung[]; zeilen: BlendZeile[]; warnungen: string[] }

/** Blend-Protokoll einer Füllung oder Charge – null, wenn sie im aktiven Betrieb nicht existiert */
export async function ladeBlendProtokoll(
  supabase: any,
  tenantId: string,
  p: { art: BlendArt; id: string },
): Promise<BlendProtokoll | null> {
  let kopf: BlendKopf
  let komposition: KompositionUrsprung[]
  if (p.art === 'fuellung') {
    const { data, error } = await (supabase.from('fuellungen') as any)
      .select('id, name, chargennummer, pruefnummer, jahrgang, rebsorte, qualitaet, datum, anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt')
      .eq('tenant_id', tenantId)
      .eq('id', p.id)
      .maybeSingle()
    if (error) throw new Error(`Blend-Protokoll: Füllung konnte nicht geladen werden (${error.message})`)
    const f = data as R | null
    if (!f) return null
    const flaschen = numOderNull(f.anzahl_flaschen)
    const groesse = numOderNull(f.flaschengroesse_ml)
    const bezug = num(f.menge_liter_gefuellt) || (flaschen && groesse ? flaschen * groesse / 1000 : 0)
    kopf = {
      art: 'fuellung', id: f.id, name: text(f.name) ?? 'Füllung',
      jahrgang: numOderNull(f.jahrgang), rebsorte: text(f.rebsorte), qualitaet: f.qualitaet ? qualitaetLabel(f.qualitaet) : null,
      pruefnummer: text(f.pruefnummer), chargennummer: text(f.chargennummer), datum: tag(f.datum) || null,
      anzahlFlaschen: flaschen === null ? null : Math.trunc(flaschen), flaschengroesseMl: groesse,
      bezugLiter: bezug > 0 ? runden(bezug, STELLEN.liter) : null,
    }
    komposition = await resolveBlendKompositionFuellung(supabase, p.id, tenantId)
  } else {
    const [waRes, dacRes] = await Promise.all([
      (supabase.from('weinausbau') as any)
        .select('id, name, jahrgang, rebsorte, qualitaetsstufe, menge_liter')
        .eq('tenant_id', tenantId)
        .eq('id', p.id)
        .maybeSingle(),
      // Prüfnummer der Charge: jüngster DAC-/Prüfnummernantrag mit erteilter Nummer
      (supabase.from('dac_antrag') as any)
        .select('pruefnummer, created_at')
        .eq('tenant_id', tenantId)
        .eq('weinausbau_id', p.id)
        .not('pruefnummer', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1),
    ])
    if (waRes.error) throw new Error(`Blend-Protokoll: Charge konnte nicht geladen werden (${waRes.error.message})`)
    if (dacRes.error) throw new Error(`Blend-Protokoll: Prüfnummer konnte nicht geladen werden (${dacRes.error.message})`)
    const wa = waRes.data as R | null
    if (!wa) return null
    const bestand = num(wa.menge_liter)
    kopf = {
      art: 'charge', id: wa.id, name: text(wa.name) ?? 'Charge',
      jahrgang: numOderNull(wa.jahrgang), rebsorte: text(wa.rebsorte), qualitaet: wa.qualitaetsstufe ? qualitaetLabel(wa.qualitaetsstufe) : null,
      pruefnummer: text(((dacRes.data ?? []) as R[])[0]?.pruefnummer), chargennummer: null, datum: null,
      anzahlFlaschen: null, flaschengroesseMl: null,
      bezugLiter: bestand > 0 ? runden(bestand, STELLEN.liter) : null,
    }
    komposition = await resolveBlendKomposition(supabase, p.id, tenantId)
  }

  const warnungen: string[] = []
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
