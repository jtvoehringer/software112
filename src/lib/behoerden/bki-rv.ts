// ── BKI-Schnittstelle: Blätter „RV zum Eingang“ und „RV zum Ausgang“ (KAN-46 Etappe 1, 10.10.2026) ──────────────
//
// RV zum Eingang: Herkunft einer gewählten Charge rückwärts bis zur Lese (Ried, Grundstück, Feldstück- und Schlagnummer
// der AMA) bzw. bis zum Zukauf – dieselbe Mischungsrechnung wie Blend-Protokoll und Herkunfts-Chips (KAN-76,
// ladeBewegungsgraph + zusammensetzung), Zusammensetzung zum Ende des Zeitraums. Alternativ ab einem Grundstück: alle
// Chargen, in die eine Lese dieses Grundstücks im Zeitraum gepresst wurde, mit dem Anteil des Grundstücks.
// RV zum Ausgang: vorwärts von einer Charge oder Füllung bis zum Abnehmer – die Rückruf-Liste (KAN-109) im Zeitraum.
//
// Annahmen (am Ticket KAN-46 dokumentiert):
//   R1 Eingang: eine Zeile je Herkunft (Lese bzw. Zukauf) der Charge; Erzeugnis, Farbe, Qualitätsstufe, Herkunft und
//      Prüfnummer sind die der Charge (des Weins), Sorte/Jahrgang/KMW/Menge die der Herkunft; Gemeinde, KG, Ried, Großlage
//      und Ortswein aus der KG-Nr. der Lese (Kataloge KAN-47). Anteil Fremdsorte/Fremdjahrgang = Anteil der Herkünfte
//      mit anderer Sorte bzw. anderem Jahrgang als die Charge (in %).
//   R2 GST-Einstieg: nur die Chargen, in die direkt gepresst wurde; spätere Verschnitte zeigt „RV zum Ausgang“.
//   R3 Ausgang: Merkmale der Start-Charge bzw. -Füllung für jede Zeile, ChargenNr = Los der Zeile. Die Spezifikation hat
//      keine Käuferspalten – Abnehmer, Adresse und Betriebsnummer stehen hinter den Spezifikationsspalten.
//      Buchungsart BSM: Tankverkauf → VK_FA_AT, Export → VK_FL_AU, Verkauf/Endverbraucher → VK_FL_AT, Verarbeitung → AB_VERAR.
//   R4 Die Behandlungskennzahlen (Anreicherung … Alkoholkorrektur) bleiben wie im Lagerstand leer (KAN-46 Etappe 2).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, type CsvSpalte } from '@/lib/csv'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { ladeBewegungsgraph } from '@/lib/wein/blendKomposition'
import { zusammensetzung, type Herkunftsanteil } from '@/lib/wein/mischungsrechnung'
import { gemeindeName, gemeindeVonKg } from '@/lib/wein/kgGemeinde'
import { getKgBezeichnung } from '@/lib/wein/katastralgemeinden'
import { herkunftKatalog } from '@/lib/wein/herkunftKatalog'
import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { lagerMerkmale, type LagerMerkmale } from './lagerstand'
import { ladeRueckruf, type RueckrufZeile } from './rueckruf'
import { MeldungsFehler } from './typen'
import { num, text, type R } from './kellerbuch-hilfen'

const WEINAUSBAU_SPALTEN = 'id, name, chargennummer, erzeugnis, land_iso, qualitaetsstufe, rebsorte, jahrgang, weinart, herkunft_code, zusatzbezeichnung, menge_liter, storniert_am, behaelter:behaelter_id(name, volumen_liter)'

const pct = (n: number) => runden(n, 2)
const l3 = (n: number) => runden(n, 3)

/** Charge im Betrieb laden (null = gibt es nicht) */
async function ladeCharge(supabase: any, tenantId: string, id: string): Promise<R | null> {
  const { data, error } = await (supabase.from('weinausbau') as any).select(WEINAUSBAU_SPALTEN).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) throw new Error(`Charge konnte nicht geladen werden (${error.message})`)
  return data ?? null
}

/** Merkmale einer Charge für die Spezifikationsspalten (lagerMerkmale erwartet eine Journalzeile) */
export function chargeMerkmale(c: R): LagerMerkmale {
  return lagerMerkmale({ ...c, charge_name: c.name, bestand: 'offen' }, null)
}

// ── RV zum Eingang ──────────────────────────────────────────────────────────

export type RvEingangZeile = LagerMerkmale & {
  datum: string | null
  quelle: 'Lese' | 'Zukauf' | 'Eröffnungsbestand' | 'unbekannt'
  herkunftSorte: string | null
  herkunftJahrgang: number | null
  feldstueck: string | null
  schlag: string | null
  gstNr: string | null
  kgNr: string | null
  gemeinde: string | null
  katastralgemeinde: string | null
  ried: string | null
  grosslage: string | null
  ortswein: string | null
  chargenNr: string | null
  gebinde: string | null
  nennvolumen: number | null
  liter: number
  anteilPct: number
  kmw: number | null
  anteilFremdSorte: number | null
  anteilFremdJg: number | null
  lieferant: string | null
}

const QUELLE: Record<string, RvEingangZeile['quelle']> = { pressung: 'Lese', zukauf: 'Zukauf', eroeffnungsbestand: 'Eröffnungsbestand', unbekannt: 'unbekannt' }
const ziffern = (v: unknown) => { const s = String(v ?? '').replace(/[^0-9]/g, ''); return s || null }

/** R1: Anteil Fremdsorte bzw. Fremdjahrgang der Charge in % (Herkünfte mit anderer Sorte bzw. anderem Jahrgang) */
export function fremdAnteile(anteile: readonly Herkunftsanteil[], sorte: string | null, jahrgang: number | null): { sorte: number | null; jahrgang: number | null } {
  const gesamt = anteile.reduce((s, a) => s + a.liter, 0)
  if (gesamt <= 0) return { sorte: null, jahrgang: null }
  const anders = (f: (a: Herkunftsanteil) => boolean) => pct(anteile.filter(f).reduce((s, a) => s + a.liter, 0) / gesamt * 100)
  return {
    sorte: sorte ? anders(a => !!a.rebsorte && a.rebsorte !== sorte) : null,
    jahrgang: jahrgang ? anders(a => a.jahrgang != null && a.jahrgang !== jahrgang) : null,
  }
}

/** Zeilen einer Charge aus ihren Herkunftsanteilen (rein, testbar) */
export function rvEingangZeilen(charge: R, anteile: readonly Herkunftsanteil[], filter?: (a: Herkunftsanteil) => boolean): RvEingangZeile[] {
  const m = chargeMerkmale(charge)
  const fremd = fremdAnteile(anteile, text(charge.rebsorte), charge.jahrgang == null ? null : Number(charge.jahrgang))
  const behaelter = charge.behaelter as R | null
  return anteile.filter(a => a.liter > 0 && (!filter || filter(a))).map(a => {
    const kgNr = ziffern(a.katastralgemeinde)
    const gkz = kgNr ? gemeindeVonKg(kgNr) : undefined
    const gemeinde = gkz ? gemeindeName(gkz) ?? null : null
    const kat = herkunftKatalog(kgNr, gkz, gemeinde, a.ried ?? null)
    return {
      ...m,
      datum: a.ernte_datum ? a.ernte_datum.slice(0, 10) : null,
      quelle: QUELLE[a.typ] ?? 'unbekannt',
      herkunftSorte: bkiRebsorteKuerzel(a.rebsorte) ?? a.rebsorte,
      herkunftJahrgang: a.jahrgang,
      feldstueck: ziffern(a.feldstueck), schlag: ziffern(a.schlag), gstNr: a.gst_nr,
      kgNr, gemeinde, katastralgemeinde: kgNr ? getKgBezeichnung(kgNr) ?? null : null,
      ried: a.ried ?? null, grosslage: kat.grosslage, ortswein: kat.dacOrtswein,
      chargenNr: text(charge.chargennummer) ?? text(charge.name),
      gebinde: text(behaelter?.name), nennvolumen: behaelter?.volumen_liter == null ? null : l3(num(behaelter.volumen_liter)),
      liter: l3(a.liter), anteilPct: pct(a.anteil_pct), kmw: a.kmw,
      anteilFremdSorte: fremd.sorte, anteilFremdJg: fremd.jahrgang,
      lieferant: a.zukauf_von ?? null,
    }
  })
}

export type RvEingangParameter = { charge: string | null; gst: string | null; von: string | null; bis: string | null }

/** Zusammensetzung einer Charge zum Stichtag – wie ladeZusammensetzungCharge, aber mit dem Graphen (Feld-/Schlagnummer) */
async function anteileCharge(supabase: any, tenantId: string, c: R, stichtag: string | null): Promise<{ anteile: Herkunftsanteil[]; warnungen: string[] }> {
  const g = await ladeBewegungsgraph(supabase, tenantId, [String(c.id)])
  const z = zusammensetzung(g.ereignisse, String(c.id), { stichtag, gebuchterBestand: stichtag ? null : num(c.menge_liter), name: text(c.name) })
  return { anteile: z.anteile, warnungen: [...g.warnungen, ...z.warnungen] }
}

export async function ladeRvEingang(supabase: any, tenantId: string, p: RvEingangParameter): Promise<{ zeilen: RvEingangZeile[]; warnungen: string[] }> {
  const warnungen: string[] = []
  if (p.charge) {
    const c = await ladeCharge(supabase, tenantId, p.charge)
    if (!c) throw new MeldungsFehler(404, 'Charge nicht gefunden.')
    const z = await anteileCharge(supabase, tenantId, c, p.bis)
    const zeilen = rvEingangZeilen(c, z.anteile, a => !p.von || !a.ernte_datum || a.ernte_datum.slice(0, 10) >= p.von)
    const gesamt = l3(z.anteile.reduce((s, a) => s + a.liter, 0))
    warnungen.push(`Gesamtmenge der Charge ${text(c.chargennummer) ?? text(c.name) ?? ''}${p.bis ? ` zum ${p.bis.split('-').reverse().join('.')}` : ''}: ${String(gesamt).replace('.', ',')} l`)
    return { zeilen, warnungen: [...warnungen, ...z.warnungen] }
  }
  // GST-Einstieg (R2): Lesezeilen des Grundstücks im Zeitraum → Chargen der Pressungen
  const gstNr = await (supabase.from('grundstuecke') as any).select('gst_nr, katastralgemeinde').eq('tenant_id', tenantId).eq('id', p.gst).maybeSingle()
  if (gstNr.error) throw new Error(`Grundstück konnte nicht geladen werden (${gstNr.error.message})`)
  if (!gstNr.data) throw new MeldungsFehler(404, 'Grundstück nicht gefunden.')
  // tenant-isolation-ignore: pressung_weingaerten ohne tenant_id, Mandant über die Pressung (!inner) und das Grundstück oben
  const lz = await alle<R>((supabase.from('pressung_weingaerten') as any)
    .select('id, ernte_datum, grundstueck_id, storniert_am, pressung:pressung_id!inner(id, tenant_id, storniert_am, pressung_behaelter(weinausbau_id, storniert_am))')
    .eq('pressung.tenant_id', tenantId).eq('grundstueck_id', p.gst).is('storniert_am', null).order('id'))
  if (lz.error) throw new Error(`Lesezeilen konnten nicht geladen werden (${lz.error.message})`)
  const imZeitraum = lz.data.filter(z => !z.pressung?.storniert_am && (!p.von || String(z.ernte_datum ?? '') >= p.von) && (!p.bis || String(z.ernte_datum ?? '') <= p.bis))
  const chargenIds = [...new Set(imZeitraum.flatMap(z => ((z.pressung?.pressung_behaelter ?? []) as R[]).filter(b => !b.storniert_am).map(b => String(b.weinausbau_id))))]
  if (!chargenIds.length) return { zeilen: [], warnungen: ['Keine Lese dieses Grundstücks im Zeitraum.'] }
  const ch = await inBloecken<R>(chargenIds, b => alle((supabase.from('weinausbau') as any).select(WEINAUSBAU_SPALTEN).eq('tenant_id', tenantId).in('id', b).order('id')))
  if (ch.error) throw new Error(`Chargen konnten nicht geladen werden (${ch.error.message})`)
  const zeilen: RvEingangZeile[] = []
  for (const c of ch.data.filter(c => !c.storniert_am)) {
    const z = await anteileCharge(supabase, tenantId, c, p.bis)
    zeilen.push(...rvEingangZeilen(c, z.anteile, a => a.gst_nr === gstNr.data.gst_nr && ziffern(a.katastralgemeinde) === ziffern(gstNr.data.katastralgemeinde)))
    warnungen.push(...z.warnungen.map(w => `${text(c.name) ?? ''}: ${w}`))
  }
  return { zeilen: zeilen.sort((a, b) => String(a.datum ?? '').localeCompare(String(b.datum ?? '')) || String(a.chargenNr).localeCompare(String(b.chargenNr), 'de')), warnungen }
}

const herkunftsSpalten = <Z extends LagerMerkmale>(): CsvSpalte<Z>[] => [
  { kopf: 'Erzeugnis lt. Liste', typ: 'code', wert: z => z.erzeugnis },
  { kopf: 'Farbe', typ: 'code', wert: z => z.farbe },
  { kopf: 'Länderkürzel', typ: 'code', wert: z => z.land },
  { kopf: 'Produktbezeichnung', typ: 'text', wert: z => z.produkt },
]

export const SPALTEN_RV_EINGANG: CsvSpalte<RvEingangZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'BelegNr.', typ: 'code', wert: () => null },
  ...herkunftsSpalten<RvEingangZeile>(),
  { kopf: 'Sorte', typ: 'code', wert: z => z.herkunftSorte },
  { kopf: 'Qualitätsstufe', typ: 'code', wert: z => z.qualitaet },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.herkunftJahrgang },
  { kopf: 'zusätzliche Bezeichnung', typ: 'text', wert: z => z.zusatz },
  { kopf: 'Herkunft', typ: 'code', wert: z => z.herkunft },
  { kopf: 'Herkunft Weingarten Feldstücksnummer AMA MFA', typ: 'code', wert: z => z.feldstueck },
  { kopf: 'Herkunft Weingarten SchlagNr. AMA MFA', typ: 'code', wert: z => z.schlag },
  { kopf: 'Herkunft g.g.A', typ: 'text', wert: z => z.herkunftGga },
  { kopf: 'Herkunft Gebiet/Name der g.U.', typ: 'text', wert: z => z.herkunftGu },
  { kopf: 'Gebiets-/Orts-/Riedenwein', typ: 'text', wert: z => z.herkunftStufe },
  { kopf: 'Herkunft Großlage', typ: 'text', wert: z => z.grosslage },
  { kopf: 'Herkunft Ortswein', typ: 'text', wert: z => z.ortswein },
  { kopf: 'Herkunft Gemeinde', typ: 'text', wert: z => z.gemeinde },
  { kopf: 'Herkunft Katastralgemeinde', typ: 'text', wert: z => z.katastralgemeinde },
  { kopf: 'Herkunft Ried', typ: 'text', wert: z => z.ried },
  { kopf: 'Staatl. Prüfnr.', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'ChargenNr.', typ: 'code', wert: z => z.chargenNr },
  { kopf: 'offener Wein / Flasche', typ: 'text', wert: () => 'offen' },
  { kopf: 'Gebinde-Kennzeichnung', typ: 'text', wert: z => z.gebinde },
  { kopf: 'Nennvolumen in lt.', typ: 'dezimal', stellen: 3, wert: z => z.nennvolumen },
  { kopf: 'IST-Menge in St.', typ: 'ganzzahl', wert: () => null },
  { kopf: 'IST-Menge in lt.', typ: 'dezimal', stellen: 3, wert: z => z.liter },
  { kopf: 'Lesegradation in KMW', typ: 'dezimal', stellen: 1, wert: z => z.kmw },
  { kopf: 'Anteil FremdSorte', typ: 'prozent', wert: z => z.anteilFremdSorte },
  { kopf: 'Anteil FremdJG', typ: 'prozent', wert: z => z.anteilFremdJg },
  { kopf: 'Anreicherung kg/hl', typ: 'dezimal', wert: () => null },
  { kopf: 'Süßung g/lt', typ: 'dezimal', wert: () => null },
  { kopf: 'Konzentrierung %', typ: 'dezimal', wert: () => null },
  { kopf: 'Entsäuerung g/lt', typ: 'dezimal', wert: () => null },
  { kopf: 'Säuerung g/lt', typ: 'dezimal', wert: () => null },
  { kopf: 'Alkoholkorrektur %vol', typ: 'dezimal', wert: () => null },
  // hinter den Spezifikationsspalten
  { kopf: 'Quelle', typ: 'text', wert: z => z.quelle },
  { kopf: 'Grundstücksnummer', typ: 'code', wert: z => z.gstNr },
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.kgNr },
  { kopf: 'Anteil an der Charge (%)', typ: 'prozent', wert: z => z.anteilPct },
  { kopf: 'Lieferant (Zukauf)', typ: 'text', wert: z => z.lieferant },
]

// ── RV zum Ausgang ──────────────────────────────────────────────────────────

export type RvAusgangZeile = LagerMerkmale & RueckrufZeile & { buchungsartBsm: string | null; offen: boolean }

/** R3: BSM-Buchungsart einer Rückruf-Zeile */
export function bsmAusgang(art: RueckrufZeile['art']): string | null {
  switch (art) {
    case 'Tankverkauf': return 'VK_FA_AT'
    case 'Export': return 'VK_FL_AU'
    case 'Verkauf': case 'Endverbraucher (summiert)': return 'VK_FL_AT'
    case 'Verarbeitung': return 'AB_VERAR'
    default: return null
  }
}

export type RvAusgangParameter = { charge: string | null; fuellung: string | null; von: string | null; bis: string | null }

export async function ladeRvAusgang(supabase: any, tenantId: string, p: RvAusgangParameter): Promise<{ zeilen: RvAusgangZeile[]; warnungen: string[] }> {
  let merkmale: LagerMerkmale
  if (p.charge) {
    const c = await ladeCharge(supabase, tenantId, p.charge)
    if (!c) throw new MeldungsFehler(404, 'Charge nicht gefunden.')
    merkmale = chargeMerkmale(c)
  } else {
    const { data: f, error } = await (supabase.from('fuellungen') as any)
      .select('id, name, pruefnummer, weinausbau:weinausbau_id(' + WEINAUSBAU_SPALTEN + ')').eq('tenant_id', tenantId).eq('id', p.fuellung).maybeSingle()
    if (error) throw new Error(`Füllung konnte nicht geladen werden (${error.message})`)
    if (!f) throw new MeldungsFehler(404, 'Füllung nicht gefunden.')
    merkmale = { ...chargeMerkmale(f.weinausbau ?? {}), produkt: text(f.name), pruefnummer: text(f.pruefnummer) }
  }
  const r = await ladeRueckruf(supabase, tenantId, p.charge ? { art: 'charge', id: p.charge } : { art: 'fuellung', id: p.fuellung as string })
  if (!r) throw new MeldungsFehler(404, 'Start der Rückverfolgung nicht gefunden.')
  const zeilen = r.zeilen
    .filter(z => (!p.von || !z.datum || z.datum >= p.von) && (!p.bis || !z.datum || z.datum <= p.bis))
    .map(z => ({ ...merkmale, ...z, produkt: z.produkt, buchungsartBsm: bsmAusgang(z.art), offen: z.art === 'Tankverkauf' }))
  return { zeilen, warnungen: [`${r.chargen.length} Charge(n) im Weg (Umzüge, Verschnitte)`, ...r.warnungen] }
}

const istLiter = (e: string) => /^l$/i.test(e)

export const SPALTEN_RV_AUSGANG: CsvSpalte<RvAusgangZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'BelegNr.', typ: 'code', wert: z => z.beleg },
  ...herkunftsSpalten<RvAusgangZeile>(),
  { kopf: 'Sorte', typ: 'code', wert: z => z.sorte },
  { kopf: 'Qualitätsstufe', typ: 'code', wert: z => z.qualitaet },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Herkunft', typ: 'code', wert: z => z.herkunft },
  { kopf: 'zusätzliche Bezeichnung', typ: 'text', wert: z => z.zusatz },
  { kopf: 'Herkunft g.g.A', typ: 'text', wert: z => z.herkunftGga },
  { kopf: 'Herkunft Gebiet/Name der g.U.', typ: 'text', wert: z => z.herkunftGu },
  { kopf: 'Gebiets-/Orts-/Riedenwein', typ: 'text', wert: z => z.herkunftStufe },
  { kopf: 'Herkunft Großlage', typ: 'text', wert: () => null },
  { kopf: 'Herkunft Ortswein', typ: 'text', wert: () => null },
  { kopf: 'Herkunft Gemeinde', typ: 'text', wert: () => null },
  { kopf: 'Herkunft Katastralgemeinde', typ: 'text', wert: () => null },
  { kopf: 'Herkunft Ried', typ: 'text', wert: () => null },
  { kopf: 'Staatl. Prüfnr.', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'ChargenNr.', typ: 'code', wert: z => z.los },
  { kopf: 'offener Wein / Flasche', typ: 'text', wert: z => (z.offen ? 'offen' : 'Flasche') },
  { kopf: 'Gebinde-Kennzeichnung', typ: 'text', wert: () => null },
  { kopf: 'Nennvolumen in lt.', typ: 'dezimal', stellen: 3, wert: () => null },
  { kopf: 'IST-Menge in St.', typ: 'ganzzahl', wert: z => (istLiter(z.einheit) ? null : z.menge) },
  { kopf: 'IST-Menge in lt.', typ: 'dezimal', stellen: 3, wert: z => (istLiter(z.einheit) ? z.menge : null) },
  { kopf: 'Lesegradation in KMW', typ: 'dezimal', stellen: 1, wert: () => null },
  { kopf: 'Anteil FremdSorte', typ: 'prozent', wert: () => null },
  { kopf: 'Anteil FremdJG', typ: 'prozent', wert: () => null },
  { kopf: 'Anreicherung kg/hl', typ: 'dezimal', wert: () => null },
  { kopf: 'Süßung g/lt', typ: 'dezimal', wert: () => null },
  { kopf: 'Konzentrierung %', typ: 'dezimal', wert: () => null },
  { kopf: 'Entsäuerung g/lt', typ: 'dezimal', wert: () => null },
  { kopf: 'Säuerung g/lt', typ: 'dezimal', wert: () => null },
  { kopf: 'Alkoholkorrektur %vol', typ: 'dezimal', wert: () => null },
  { kopf: 'Buchungsart BSM', typ: 'code', wert: z => z.buchungsartBsm },
  { kopf: 'Buchungsart', typ: 'text', wert: z => z.art },
  { kopf: 'Anmerkungen', typ: 'text', wert: z => (z.einheit && !istLiter(z.einheit) ? `Einheit ${z.einheit}` : null) },
  // hinter den Spezifikationsspalten (R3)
  { kopf: 'Abnehmer', typ: 'text', wert: z => z.abnehmer },
  { kopf: 'Adresse Abnehmer', typ: 'text', wert: z => z.adresse },
  { kopf: 'Betriebsnummer Abnehmer', typ: 'code', wert: z => z.betriebNr },
]
