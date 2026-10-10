// ── Gebindeverzeichnis (Gebinde, Nennvolumen, aktuelle Belegung) – Seite UND CSV (24.09.2026) ──
//
// Zusatzfund der Vollständigkeitsprüfung: Die BKI prüft vor Ort Gebinde, Kennzeichnung und
// Inhalt. Grundlage ist dieselbe Liste wie im Tab „Gebinde“ unter /kellerbuch/gebinde:
// eigene und freigegebene Gebinde über lade_behaelter (Kellergemeinschaft, SECURITY
// DEFINER) plus die aktiven Chargen des eigenen Betriebs. Wein eines Partnerbetriebs im
// Gebinde erscheint nur als „belegt“ mit Menge und Betrieb – nie dessen Chargen.
//
// CSV: eine Zeile je Gebinde × aktueller Charge; ein Gebinde ohne eigene Charge bekommt
// eine Zeile mit leerer Charge.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter, type BehaelterZeile } from '@/lib/keller/behaelter'
import { bkiRebsorteKuerzel, fehlendeKuerzelHinweise } from '@/lib/wein/bki_kuerzel'
import { qualitaetAnzeigeOderNull } from '@/lib/wein/qualitaet'
import { num, text, type R } from './kellerbuch-hilfen'
import { AktionsFehler } from '@/lib/fehler'

export const GEBINDE_TYP_LABEL: Record<string, string> = {
  amphore: 'Amphore', barrique: 'Barrique', betonei: 'Betonei', bottich: 'Bottich',
  doppelbarrique: 'Doppel-Barrique', gaerstaender: 'Gärständer', holzfass: 'Holzfass',
  immervolltank: 'Immervoll-Tank', lagertank: 'Lagertank', stahltank: 'Stahltank',
  presse: 'Presse', zisterne: 'Zisterne', sonstiges: 'Sonstiges',
}

export function gebindeTypLabel(typ: string | null | undefined): string | null {
  if (!typ) return null
  return GEBINDE_TYP_LABEL[typ] ?? typ
}

export type GebindeEintrag = {
  gebinde: BehaelterZeile
  /** aktive Chargen des eigenen Betriebs in diesem Gebinde */
  chargen: R[]
  /** Liter der eigenen Chargen (gerundet) */
  eigenLiter: number
  /** eigene + fremd belegte Liter (gerundet) */
  inhaltLiter: number
  /** Füllstand in % des Nennvolumens (1 Stelle), null ohne Nennvolumen */
  fuellPct: number | null
}

export type GebindeverzeichnisZeile = {
  gebinde: string
  typ: string | null
  nennvolumen: number | null
  standort: string | null
  aktiv: boolean
  eigentuemer: string | null
  charge: string | null
  jahrgang: number | null
  rebsorte: string | null
  kuerzel: string | null
  qualitaet: string | null
  mengeCharge: number | null
  inhaltGebinde: number
  fuellstand: number | null
  fremdLiter: number | null
  belegtDurch: string | null
}

export async function ladeGebindeverzeichnis(
  supabase: any,
  tenantId: string,
  p: { nurAktiv?: boolean } = {},
): Promise<{ eintraege: GebindeEintrag[]; zeilen: GebindeverzeichnisZeile[]; warnungen: string[] }> {
  const [gebinde, chargenRes] = await Promise.all([
    ladeBehaelter(supabase, tenantId, { nurAktiv: p.nurAktiv }),
    alle<R>((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, qualitaetsstufe, zusatzbezeichnung, erzeugnis, menge_liter, behaelter_id, status, aktiv')
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)
      .order('name')
      .order('id')),
  ])
  if (chargenRes.error) throw new AktionsFehler(`Chargen konnten nicht geladen werden: ${chargenRes.error.message}`)
  const chargen = chargenRes.data

  const eintraege: GebindeEintrag[] = gebinde.map(g => {
    const inhalt = chargen.filter(c => c.behaelter_id === g.id)
    const eigenLiter = runden(inhalt.reduce((s: number, c: R) => s + num(c.menge_liter), 0), STELLEN.liter)
    const inhaltLiter = runden(eigenLiter + g.fremd_liter, STELLEN.liter)
    const fuellPct = g.volumen_liter && g.volumen_liter > 0 ? runden((inhaltLiter / g.volumen_liter) * 100, 1) : null
    return { gebinde: g, chargen: inhalt, eigenLiter, inhaltLiter, fuellPct }
  })

  const zeilen: GebindeverzeichnisZeile[] = []
  for (const e of eintraege) {
    const g = e.gebinde
    const basis = {
      gebinde: g.name,
      typ: gebindeTypLabel(g.typ),
      nennvolumen: g.volumen_liter === null ? null : runden(g.volumen_liter, STELLEN.liter),
      standort: text(g.standort),
      aktiv: g.aktiv,
      eigentuemer: g.fremd ? text(g.eigentuemer_name) : null,
      inhaltGebinde: e.inhaltLiter,
      fuellstand: e.fuellPct,
      fremdLiter: g.fremd_liter > 0 ? runden(g.fremd_liter, STELLEN.liter) : null,
      belegtDurch: g.fremd_liter > 0 ? (text(g.fremd_betrieb) ?? 'Partnerbetrieb') : null,
    }
    const leer = { charge: null, jahrgang: null, rebsorte: null, kuerzel: null, qualitaet: null, mengeCharge: null }
    if (e.chargen.length === 0) { zeilen.push({ ...basis, ...leer }); continue }
    for (const c of e.chargen) {
      zeilen.push({
        ...basis,
        charge: text(c.name),
        jahrgang: typeof c.jahrgang === 'number' ? c.jahrgang : null,
        rebsorte: text(c.rebsorte),
        kuerzel: bkiRebsorteKuerzel(text(c.rebsorte)),
        qualitaet: qualitaetAnzeigeOderNull(c),   // KAN-186: Stufe + Zusatzbezeichnung/Erzeugnis
        mengeCharge: runden(num(c.menge_liter), STELLEN.liter),
      })
    }
  }

  const warnungen: string[] = []
  const fremdBelegt = eintraege.filter(e => e.gebinde.fremd_liter > 0).length
  if (fremdBelegt > 0) warnungen.push(`Kellergemeinschaft: ${fremdBelegt} ${fremdBelegt === 1 ? 'Gebinde enthält' : 'Gebinde enthalten'} Wein eines Partnerbetriebs – nur Menge und Betrieb, keine Chargen.`)
  const ohneGebinde = chargen.filter(c => !c.behaelter_id).length
  if (ohneGebinde > 0) warnungen.push(`${ohneGebinde} aktive ${ohneGebinde === 1 ? 'Charge ist' : 'Chargen sind'} keinem Gebinde zugeordnet und fehlen im Verzeichnis.`)
  // KAN-36: nur amtliche Kürzel – Sorten ohne Eintrag in der Kürzelliste bleiben leer (mit Hinweis)
  warnungen.push(...fehlendeKuerzelHinweise(zeilen.map(z => z.rebsorte), { einheit: ['Charge', 'Chargen'], stammdaten: 'Charge' }))
  return { eintraege, zeilen, warnungen }
}

export const SPALTEN_GEBINDEVERZEICHNIS: CsvSpalte<GebindeverzeichnisZeile>[] = [
  { kopf: 'Gebinde', typ: 'text', wert: z => z.gebinde },
  { kopf: 'Typ', typ: 'text', wert: z => z.typ },
  { kopf: 'Nennvolumen (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.nennvolumen },
  { kopf: 'Standort', typ: 'text', wert: z => z.standort },
  { kopf: 'Aktiv', typ: 'janein', wert: z => z.aktiv },
  { kopf: 'Eigentümer (Kellergemeinschaft)', typ: 'text', wert: z => z.eigentuemer },
  { kopf: 'Charge', typ: 'text', wert: z => z.charge },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Qualitätsstufe', typ: 'text', wert: z => z.qualitaet },
  { kopf: 'Menge Charge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.mengeCharge },
  { kopf: 'Inhalt Gebinde gesamt (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.inhaltGebinde },
  { kopf: 'Füllstand (%)', typ: 'prozent', stellen: 1, wert: z => z.fuellstand },
  { kopf: 'Belegt durch Partnerbetrieb (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.fremdLiter },
  { kopf: 'Partnerbetrieb', typ: 'text', wert: z => z.belegtDurch },
]
