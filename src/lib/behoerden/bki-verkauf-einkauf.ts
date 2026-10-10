// ── BKI-Schnittstelle: „Verkauf im Zeitraum“, „Einkauf im Zeitraum“, „TBS-Aufstellung“ (KAN-49, 10.10.2026) ────────
//
// Verkauf und Einkauf: die Lagerbewegungen des Journals (dieselbe Ladefunktion wie das Blatt „Lagerbewegungen“, also
// festgehaltene Merkmale je Buchung), gefiltert auf die BSM-Buchungsarten des Verkaufs (VK_*) bzw. des Zukaufs (ZK_*);
// optional nur eine Qualitätsstufe (Spezifikation: „Qualitätsstufe filterbar“). Spalten wie die Spezifikation: IST-Menge
// statt Anfangs- und Buchungsmenge, „Betrieb Käufer“/„Adresse Käufer“ bzw. „Betrieb Verkäufer“/„Adresse Verkäufer“.
// TBS-Aufstellung: ausgehende Transportbescheinigungen (eine Zeile je Weinposition, ladeTransportbescheinigungen) und
// eingehende (Zukäufe mit der TBS-Nummer des Lieferanten, KAN-90), nach Datum.
//
// Annahmen (am Ticket KAN-49 dokumentiert):
//   V1 IST-Menge = Betrag der Buchungsmenge (Verkauf als positive Menge).
//   V2 TBS-Aufstellung: stornierte Verkäufe bzw. Zukäufe fehlen; Zukäufe von Flaschen (≤ 60 l) brauchen keine TBS und
//      fehlen ebenso; ein Zukauf ohne TBS-Nummer des Lieferanten steht mit Hinweis in der Liste. Die drei Sorte-Spalten
//      der Spezifikation nehmen bis zu drei Sorten der Position auf (BKI-Kürzel, sonst Name).
//   V3 Nummernvergabe bzw. Formular-Register (vorgedruckte Formblätter, Formular-VO § 4) bleibt offen – mit der BKI klären.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { katalogQualitaet } from '@/lib/katalog/bki'
import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { ladeLagerbewegungen, SPALTEN_LAGERBEWEGUNGEN, type LagerbewegungZeile } from './lagerstand'
import { ladeTransportbescheinigungen, type TBZeile } from './transportbescheinigung'
import { parameterFehler, type ParameterFehler } from './typen'
import { text, type R } from './kellerbuch-hilfen'

export const VERKAUF_CODES: readonly string[] = ['VK_FA_AT', 'VK_FA_AU', 'VK_FL_AT', 'VK_FL_AU']
export const EINKAUF_CODES: readonly string[] = ['ZK_FASS', 'ZK_TRAUB', 'ZK_MAISC', 'ZK_MOST', 'ZK_FLA']

export type ZeitraumStufe = { von: string | null; bis: string | null; stufe: string | null }

/** Parameter von/bis (optional) und stufe (BKI-Kürzel der Qualitätsstufe, optional) */
export function zeitraumStufeAus(sp: URLSearchParams): ZeitraumStufe | ParameterFehler {
  const tag = (n: string) => { const v = sp.get(n)?.trim() || null; return v && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? undefined : v }
  const von = tag('von'), bis = tag('bis')
  if (von === undefined || bis === undefined) return parameterFehler('Ungültiges Datum – bitte als JJJJ-MM-TT angeben.')
  if (von && bis && von > bis) return parameterFehler('Der Zeitraum ist ungültig: „von“ liegt nach „bis“.')
  const stufe = sp.get('stufe')?.trim().toUpperCase() || null
  if (stufe && !/^[A-Z]{2,4}$/.test(stufe)) return parameterFehler('Unbekannte Qualitätsstufe (Parameter „stufe“, BKI-Kürzel wie QUW).')
  return { von, bis, stufe }
}

// ── Verkauf / Einkauf ───────────────────────────────────────────────────────

export function filterBewegungen(zeilen: readonly LagerbewegungZeile[], codes: readonly string[], stufe: string | null): LagerbewegungZeile[] {
  return zeilen.filter(z => !!z.buchungsartBsm && codes.includes(z.buchungsartBsm) && (!stufe || z.qualitaet === stufe))
}

export async function ladeVerkaufImZeitraum(supabase: any, tenantId: string, p: ZeitraumStufe) {
  const r = await ladeLagerbewegungen(supabase, tenantId, { von: p.von, bis: p.bis })
  return { zeilen: filterBewegungen(r.zeilen, VERKAUF_CODES, p.stufe), warnungen: r.warnungen ?? [] }
}

export async function ladeEinkaufImZeitraum(supabase: any, tenantId: string, p: ZeitraumStufe) {
  const r = await ladeLagerbewegungen(supabase, tenantId, { von: p.von, bis: p.bis })
  return { zeilen: filterBewegungen(r.zeilen, EINKAUF_CODES, p.stufe), warnungen: r.warnungen ?? [] }
}

const betrag = (n: unknown) => (n === null || n === undefined || n === '' ? null : Math.abs(Number(n)))

/** Spalten des Blatts aus den Lagerbewegungen: IST-Menge statt Anfangs-/Buchungsmenge, nur die Partei der Richtung (V1) */
function spaltenFuer(partei: 'Käufer' | 'Verkäufer'): CsvSpalte<LagerbewegungZeile>[] {
  const weg = new Set(['Anfangsmenge in St.', 'Anfangsmenge in lt.', partei === 'Käufer' ? 'Name Verkäufer' : 'Name Käufer', partei === 'Käufer' ? 'Adresse Verkäufer' : 'Adresse Käufer'])
  return SPALTEN_LAGERBEWEGUNGEN.filter(s => !weg.has(s.kopf)).map(s => {
    if (s.kopf === 'Buchungsmenge in St.') return { ...s, kopf: 'IST-Menge in St.', wert: (z: LagerbewegungZeile) => betrag(s.wert(z)) }
    if (s.kopf === 'Buchungsmenge in lt.') return { ...s, kopf: 'IST-Menge in lt.', wert: (z: LagerbewegungZeile) => betrag(s.wert(z)) }
    if (s.kopf === `Name ${partei}`) return { ...s, kopf: `Betrieb ${partei}` }
    return s
  })
}

export const SPALTEN_VERKAUF_IM_ZEITRAUM = spaltenFuer('Käufer')
export const SPALTEN_EINKAUF_IM_ZEITRAUM = spaltenFuer('Verkäufer')

// ── TBS-Aufstellung ─────────────────────────────────────────────────────────

export type TbsZeile = {
  richtung: 'Ausgang' | 'Eingang'
  datum: string | null
  beleg: string | null
  tbsNummer: string | null
  sorten: [string | null, string | null, string | null]
  jahrgang: string | null
  menge: number | null
  einheit: string | null
  qualitaet: string | null
  versender: string | null
  empfaenger: string | null
}

/** Bis zu drei Sorten aus einem Sortentext („Grüner Veltliner (GV), Welschriesling“) – BKI-Kürzel, sonst Name */
export function dreiSorten(text_: string | null | undefined): TbsZeile['sorten'] {
  const teile = String(text_ ?? '').split(/[,;/+]| und /).map(s => s.replace(/\([^)]*\)/g, '').trim()).filter(Boolean)
  const k = teile.map(s => bkiRebsorteKuerzel(s) ?? s)
  return [k[0] ?? null, k[1] ?? null, k[2] ?? null]
}

const name = (...t: (string | null | undefined)[]) => t.map(x => (x ?? '').trim()).filter(Boolean).join(' ') || null

export function tbsAusgang(z: TBZeile): TbsZeile {
  return {
    richtung: 'Ausgang', datum: z.lieferdatum ?? z.verkaufsdatum, beleg: z.rechnungsnummer,
    tbsNummer: z.laufendeNr ? (z.jahr ? `${z.laufendeNr}/${z.jahr}` : z.laufendeNr) : null,
    sorten: dreiSorten(z.traubensorte), jahrgang: z.jahrgang, menge: z.menge, einheit: z.einheit,
    qualitaet: z.qualitaetsstufe ? katalogQualitaet(z.qualitaetsstufe)?.code ?? z.qualitaetsstufe : null,
    versender: name(z.vName, z.vVorname), empfaenger: name(z.eName, z.eVorname),
  }
}

export function tbsEingang(zp: R, eigenerBetrieb: string | null): TbsZeile {
  const lieferant = zp.lieferant_firma?.name ?? name(zp.lieferant_kontakt?.vorname, zp.lieferant_kontakt?.nachname) ?? text((zp.partner_daten as R | null)?.name)
  return {
    richtung: 'Eingang', datum: text(zp.datum), beleg: text(zp.eingangsrechnungsnummer),
    tbsNummer: zp.tbs_nummer_lieferant ? (zp.tbs_jahr_lieferant ? `${zp.tbs_nummer_lieferant}/${zp.tbs_jahr_lieferant}` : String(zp.tbs_nummer_lieferant)) : null,
    sorten: dreiSorten(text(zp.rebsorte)), jahrgang: zp.jahrgang == null ? null : String(zp.jahrgang),
    menge: zp.menge == null ? null : runden(Number(zp.menge), STELLEN.liter), einheit: text(zp.einheit),
    qualitaet: zp.qualitaetsstufe ? katalogQualitaet(zp.qualitaetsstufe)?.code ?? text(zp.qualitaetsstufe) : null,
    versender: lieferant ?? null, empfaenger: eigenerBetrieb,
  }
}

export async function ladeTbsAufstellung(supabase: any, tenantId: string, p: ZeitraumStufe & { betriebName: string | null }): Promise<{ zeilen: TbsZeile[]; warnungen: string[] }> {
  const von = p.von ?? '1900-01-01', bis = p.bis ?? '2999-12-31'
  const [aus, ein] = await Promise.all([
    ladeTransportbescheinigungen(supabase, tenantId, { von, bis }),
    alle<R>((supabase.from('zukauf_posten') as any)
      .select('id, datum, art, menge, einheit, rebsorte, jahrgang, qualitaetsstufe, eingangsrechnungsnummer, tbs_nummer_lieferant, tbs_jahr_lieferant, partner_daten, storniert_am, aktiv, lieferant_firma:firmen!lieferant_firma_id(name), lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname)')
      .eq('tenant_id', tenantId).gte('datum', von).lte('datum', bis).is('storniert_am', null).order('datum').order('id')),
  ])
  if (ein.error) throw new Error(`Zukäufe konnten nicht geladen werden (${ein.error.message})`)
  const warnungen = [...aus.warnungen]
  const ausgang = aus.zeilen.filter(z => !z.storniertAm).map(tbsAusgang)
  const zukaeufe = ein.data.filter(z => z.aktiv !== false && z.art !== 'flaschen')
  const ohneNr = zukaeufe.filter(z => !z.tbs_nummer_lieferant).length
  if (ohneNr) warnungen.push(`${ohneNr} Zukauf/Zukäufe ohne TBS-Nummer des Lieferanten (Zukauf bearbeiten: „TBS-Nr. Lieferant“).`)
  const eingang = zukaeufe.map(z => tbsEingang(z, p.betriebName))
  const zeilen = [...ausgang, ...eingang]
    .filter(z => !p.stufe || z.qualitaet === p.stufe)
    .sort((a, b) => String(a.datum ?? '').localeCompare(String(b.datum ?? '')) || a.richtung.localeCompare(b.richtung))
  return { zeilen, warnungen }
}

export const SPALTEN_TBS_AUFSTELLUNG: CsvSpalte<TbsZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'BelegNr.', typ: 'code', wert: z => z.beleg },
  { kopf: 'TBS Nummer', typ: 'code', wert: z => z.tbsNummer },
  { kopf: 'Sorte', typ: 'code', wert: z => z.sorten[0] },
  { kopf: 'Sorte 2', typ: 'code', wert: z => z.sorten[1] },
  { kopf: 'Sorte 3', typ: 'code', wert: z => z.sorten[2] },
  { kopf: 'JG', typ: 'code', wert: z => z.jahrgang },
  { kopf: 'Menge', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.menge },
  { kopf: 'Versender Name', typ: 'text', wert: z => z.versender },
  { kopf: 'Empfänger Name', typ: 'text', wert: z => z.empfaenger },
  // hinter den Spezifikationsspalten
  { kopf: 'Richtung', typ: 'text', wert: z => z.richtung },
  { kopf: 'Einheit', typ: 'text', wert: z => z.einheit },
  { kopf: 'Qualitätsstufe', typ: 'code', wert: z => z.qualitaet },
]
