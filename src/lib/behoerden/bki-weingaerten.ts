// ── BKI-Blatt „Weingärten“ (KAN-47 AP10 Schritt 1, 09.10.2026) ──
//
// Spalten nach der BKI-Schnittstelle („SchnittstelleDatenMitDefinitionTypen“, Blatt „Weingärten“, 26 Spalten). Eine
// Zeile je Grundstück (Sorte, Fläche und Pflanzjahr stehen am Grundstück); eine Ried ohne Grundstücke bekommt eine
// eigene Zeile mit Hinweis. Schritt 2: Großlage, Gemeindeteil, DAC-Orts- und Riedenwein aus den amtlichen Katalogen
// (`herkunftKatalog`, bisher Thermenregion, Kremstal, Wachau, Kamptal und Traisental, Annahmen K1–K10 dort); Erste/Große Lage bleibt leer.
//
// Annahmen (wie AP11 nach bestem Wissen, im Workshop KAN-38 zu bestätigen):
//   W1 Die Spezifikation führt „Katastralgemeinde“ zweimal: als int (Spalte B) und als Text (Spalte S). B = KG-Nr.
//      (wie C), S = Name der KG.
//   W2 Feldstück-Nr. (AMA) = Feldstück der Ried (weingarten.ama_feldnummer), nur Ziffern; Fläche (Feldstück) = Fläche der
//      Ried in ha (4 Stellen).
//   W3 Eigen/Pacht: Ja = Eigentum, Nein = Pacht; Nutzung bzw. ohne Angabe leer.
//   W4 Sorte = amtliches BKI-Kürzel, sonst der erfasste Name (mit Hinweis); Qualitätsrebsorte = Sorte mit amtlichem
//      Kürzel außer den Sortenverschnitten (SW, SO, SR, SP).
//   W5 Bundesland und Gemeinde aus der KG-Nr. (BEV-Verzeichnis); g.U. = Weinbaugebiet des Herkunft-Codes (Grundstück,
//      sonst Ried), DAC-Gebiet nur bei einem DAC-Code.
//   W6 Kommentar: „nicht mehr bewirtschaftet ab TT.MM.JJJJ“ bei deaktivierten Grundstücken.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { getKgBezeichnung } from '@/lib/wein/katastralgemeinden'
import { gemeindeName, gemeindeVonKg } from '@/lib/wein/kgGemeinde'
import { gemeindeteil, herkunftKatalog, KATALOG_GEBIETE } from '@/lib/wein/herkunftKatalog'
import { herkunftKnotenTolerant } from '@/lib/herkunft'
import { NUTZART_OPTIONS } from '@/lib/wein/nutzart'
import { text, type R } from './kellerbuch-hilfen'

const BUNDESLAND_GKZ: Record<string, string> = {
  1: 'Burgenland', 2: 'Kärnten', 3: 'Niederösterreich', 4: 'Oberösterreich', 5: 'Salzburg',
  6: 'Steiermark', 7: 'Tirol', 8: 'Vorarlberg', 9: 'Wien',
}
const SORTENVERSCHNITT = new Set(['SW', 'SO', 'SR', 'SP'])

export type WeingartenZeile = {
  gstNr: string | null
  kgNr: string | null
  kommentar: string | null
  feldstueck: string | null
  flaecheFeldstueckHa: number | null
  nutzungsart: string | null
  bezeichnung: string | null
  eigen: boolean | null
  sorte: string | null
  qualitaetsrebsorte: boolean | null
  flaecheSorteM2: number | null
  pflanzjahr: number | null
  bundesland: string | null
  gU: string | null
  grosslage: string | null
  dacGebiet: string | null
  gemeinde: string | null
  katastralgemeinde: string | null
  gemeindeteil: string | null
  dacOrtswein: string | null
  dacRiedenwein: string | null
  ersteLage: string | null
  ersteLageMaxErtrag: number | null
  grosseLage: string | null
  grosseLageMaxErtrag: number | null
}

const nurZiffern = (v: unknown) => { const s = String(v ?? '').replace(/[^0-9]/g, ''); return s || null }
const tagDe = (d: string) => d.slice(0, 10).split('-').reverse().join('.')

/** Reine Abbildung Ried + Grundstück → Zeile (für Seite, CSV und Tests) */
export function weingartenZeile(w: R | null, g: R | null): WeingartenZeile {
  const kgNr = nurZiffern(g?.katastralgemeinde)
  const gkz = kgNr ? gemeindeVonKg(kgNr) : undefined
  const sorteName = text(g?.rebsorte)
  const kuerzel = bkiRebsorteKuerzel(sorteName)
  const knoten = herkunftKnotenTolerant(text(g?.trauben_herkunft_code) ?? text(w?.trauben_herkunft_code))   // auch BKI-Kürzel („WLTH“)
  const rv = text(g?.rechtsverhaeltnis)
  const ha = g?.flaeche_ha == null || g.flaeche_ha === '' ? null : Number(g.flaeche_ha)
  const gemeinde = gkz ? gemeindeName(gkz) ?? null : null
  const kgName = text(g?.kg_bezeichnung) ?? (kgNr ? getKgBezeichnung(kgNr) ?? null : null)
  const ried = text((w?.lage as R | null | undefined)?.amtliche_ried)
  const kat = herkunftKatalog(kgNr, gkz, gemeinde, ried)
  return {
    gstNr: text(g?.gst_nr),
    kgNr,
    kommentar: g && g.aktiv === false ? `nicht mehr bewirtschaftet${g.deaktiviert_am ? ` ab ${tagDe(String(g.deaktiviert_am))}` : ''}` : null,
    feldstueck: nurZiffern(w?.ama_feldnummer),
    flaecheFeldstueckHa: w?.flaeche_ha == null ? null : runden(Number(w.flaeche_ha), STELLEN.ha),
    nutzungsart: NUTZART_OPTIONS.find(o => o.value === g?.nutzart)?.label ?? text(g?.nutzart),
    bezeichnung: text(w?.interne_bezeichnung) ?? text(w?.name),
    eigen: rv === 'eigentum' ? true : rv === 'pacht' ? false : null,
    sorte: kuerzel ?? sorteName,
    qualitaetsrebsorte: sorteName ? !!kuerzel && !SORTENVERSCHNITT.has(kuerzel) : null,
    flaecheSorteM2: ha !== null && Number.isFinite(ha) ? Math.round(ha * 10000) : null,
    pflanzjahr: g?.pflanzjahr == null ? null : Number(g.pflanzjahr),
    bundesland: gkz ? BUNDESLAND_GKZ[gkz[0]] ?? null : null,
    gU: knoten && knoten.ebene !== 'oesterreich' && knoten.ebene !== 'landwein' ? knoten.gebiet : null,
    grosslage: kat.grosslage,
    dacGebiet: knoten && knoten.ebene.startsWith('dac_') ? knoten.gebiet : null,
    gemeinde,
    katastralgemeinde: kgName,
    gemeindeteil: gemeindeteil(kgName, gemeinde),
    dacOrtswein: kat.dacOrtswein,
    dacRiedenwein: kat.imDacGebiet ? ried : null,
    ersteLage: null, ersteLageMaxErtrag: null, grosseLage: null, grosseLageMaxErtrag: null,
  }
}

/** Zeilen je Grundstück, Rieden ohne Grundstück mit eigener Zeile; Hinweise für die Datei bzw. Seite */
export function weingartenZeilen(weingaerten: readonly R[], grundstuecke: readonly R[]): { zeilen: WeingartenZeile[]; warnungen: string[] } {
  const jeRied = new Map<string, R[]>()
  for (const g of grundstuecke) jeRied.set(g.weingarten_id, [...(jeRied.get(g.weingarten_id) ?? []), g])
  const zeilen: WeingartenZeile[] = []
  const ohneGst: string[] = []
  for (const w of weingaerten) {
    const gsts = [...(jeRied.get(w.id) ?? [])].sort((a, b) => String(a.gst_nr ?? '').localeCompare(String(b.gst_nr ?? ''), 'de', { numeric: true }))
    if (gsts.length === 0) { ohneGst.push(String(w.name ?? w.id)); zeilen.push(weingartenZeile(w, null)); continue }
    for (const g of gsts) zeilen.push(weingartenZeile(w, g))
  }
  const w: string[] = []
  if (ohneGst.length) w.push(`${ohneGst.length} Ried(en) ohne Grundstück (eine Zeile ohne Grundstücksnummer): ${ohneGst.slice(0, 5).join(', ')}${ohneGst.length > 5 ? ' …' : ''}`)
  const ohneKuerzel = [...new Set(grundstuecke.filter(g => text(g.rebsorte) && !bkiRebsorteKuerzel(text(g.rebsorte))).map(g => text(g.rebsorte)))]
  if (ohneKuerzel.length) w.push(`Sorte ohne amtliches BKI-Kürzel (Name statt Kürzel): ${ohneKuerzel.join(', ')}`)
  const ohneKg = zeilen.filter(z => z.gstNr && !z.kgNr).length
  if (ohneKg) w.push(`${ohneKg} Grundstück(e) ohne KG-Nr.`)
  const ausserhalb = zeilen.filter(z => z.kgNr && !z.grosslage && !z.dacOrtswein).length
  if (ausserhalb) w.push(`${ausserhalb} Zeile(n) außerhalb der erfassten Kataloge (${KATALOG_GEBIETE.join(', ')}): Großlage und DAC-Orts-/Riedenwein leer.`)
  const ohneRied = zeilen.filter(z => z.dacOrtswein && !z.dacRiedenwein).length
  if (ohneRied) w.push(`${ohneRied} Zeile(n) im DAC-Gebiet ohne amtliche Ried an der Lage: DAC-Riedenwein leer.`)
  w.push('DAC-Riedenwein = amtliche Ried der Lage, nicht gegen die NÖ Riedenverordnung geprüft; Erste/Große Lage bleibt leer (in den erfassten Gebieten nicht geregelt).')
  return { zeilen, warnungen: w }
}

export async function ladeBkiWeingaerten(supabase: any, tenantId: string, p: { nurAktiv?: boolean } = {}): Promise<{ zeilen: WeingartenZeile[]; warnungen: string[] }> {
  const [w, g] = await Promise.all([
    alle<R>((supabase.from('weingarten') as any)
      .select('id, name, interne_bezeichnung, ama_feldnummer, flaeche_ha, trauben_herkunft_code, aktiv, lage:lage_id(amtliche_ried)')
      .eq('tenant_id', tenantId).order('name').order('id')),
    alle<R>((supabase.from('grundstuecke') as any)
      .select('id, weingarten_id, gst_nr, katastralgemeinde, kg_bezeichnung, flaeche_ha, nutzart, rechtsverhaeltnis, rebsorte, pflanzjahr, trauben_herkunft_code, aktiv, deaktiviert_am')
      .eq('tenant_id', tenantId).order('gst_nr').order('id')),
  ])
  if (w.error) throw new Error(`Rieden konnten nicht geladen werden: ${w.error.message}`)
  if (g.error) throw new Error(`Grundstücke konnten nicht geladen werden: ${g.error.message}`)
  const rieden = p.nurAktiv ? w.data.filter(x => x.aktiv !== false) : w.data
  const gsts = p.nurAktiv ? g.data.filter(x => x.aktiv !== false) : g.data
  return weingartenZeilen(rieden, gsts)
}

export const SPALTEN_BKI_WEINGAERTEN: CsvSpalte<WeingartenZeile>[] = [
  { kopf: 'Grundstücksnummer', typ: 'code', wert: z => z.gstNr },
  { kopf: 'Katastralgemeinde', typ: 'code', wert: z => z.kgNr },   // W1
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.kgNr },
  { kopf: 'Kommentar', typ: 'text', wert: z => z.kommentar },
  { kopf: 'Feldstück-Nr. (AMA)', typ: 'code', wert: z => z.feldstueck },
  { kopf: 'Fläche (Feldstück) (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheFeldstueckHa },
  { kopf: 'Nutzungsart', typ: 'text', wert: z => z.nutzungsart },
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Eigen/Pacht', typ: 'janein', wert: z => z.eigen },
  { kopf: 'Sorte', typ: 'code', wert: z => z.sorte },
  { kopf: 'Qualitätsrebsorte', typ: 'janein', wert: z => z.qualitaetsrebsorte },
  { kopf: 'Fläche (Sorte) (m²)', typ: 'ganzzahl', wert: z => z.flaecheSorteM2 },
  { kopf: 'Pflanzjahr', typ: 'ganzzahl', wert: z => z.pflanzjahr },
  { kopf: 'Bundesland', typ: 'text', wert: z => z.bundesland },
  { kopf: 'g.U.', typ: 'text', wert: z => z.gU },
  { kopf: 'Großlage', typ: 'text', wert: z => z.grosslage },
  { kopf: 'DAC-Gebiet', typ: 'text', wert: z => z.dacGebiet },
  { kopf: 'Gemeinde', typ: 'text', wert: z => z.gemeinde },
  { kopf: 'Katastralgemeinde (Name)', typ: 'text', wert: z => z.katastralgemeinde },
  { kopf: 'Gemeindeteil', typ: 'text', wert: z => z.gemeindeteil },
  { kopf: 'DAC-Ortswein', typ: 'text', wert: z => z.dacOrtswein },
  { kopf: 'DAC-Riedenwein', typ: 'text', wert: z => z.dacRiedenwein },
  { kopf: 'Erste Lage', typ: 'text', wert: z => z.ersteLage },
  { kopf: 'Erste Lage max. Ha-Ertrag', typ: 'ganzzahl', wert: z => z.ersteLageMaxErtrag },
  { kopf: 'Große Lage', typ: 'text', wert: z => z.grosseLage },
  { kopf: 'Große Lage max. Ha-Ertrag', typ: 'ganzzahl', wert: z => z.grosseLageMaxErtrag },
]
