// ── Rückverfolgung Füllung → Charge → Pressung → Weingarten/GST – Seite UND CSV (24.09.2026) ──
//
// Die Kette stand bis 24.09.2026 in kellerbuch/rueckverfolgung/page.tsx (ladeChargeKette);
// jetzt hier, damit Bildschirm, Ausdruck und CSV („rueckverfolgung“) gleich rechnen.
//   Füllung → Chargen (fuellung_chargen, sonst fuellungen.weinausbau_id, sonst eindeutiger
//   Treffer über Rebsorte + Jahrgang) → Pressungen (pressung_behaelter) → Weingärten/GST
//   (pressung_weingaerten) → Behandlungen der Grundstücke (behandlung_grundstuecke).
// CSV: eine Zeile je Füllung × Ursprung (Charge × Pressung × Weingarten/GST), mit Anteil
// der Charge an der Füllung und den Behandlungen des Grundstücks bzw. Weingartens.
// Die Trefferliste der Seite (Filter Jahrgang/Sorte/Bezeichnung) kommt ebenfalls von hier;
// ihre Listen-CSV entsteht im Browser (SPALTEN_RUECKVERFOLGUNG_TREFFER). Isomorph.
// Rechtsgrundlage: Art. 18 VO (EG) 178/2002 (Rückverfolgbarkeit).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { num, numOderNull, tag, text, type R } from './kellerbuch-hilfen'

export const BEHANDLUNG_ART_LABEL: Record<string, string> = {
  spritzung: 'Spritzung', duengung: 'Düngung', bodenbearbeitung: 'Bodenbearbeitung',
  schnitt: 'Schnitt', laubarbeit: 'Laubarbeit', sonstiges: 'Sonstiges',
}

export type Kette = {
  weinausbau: R | null
  pressungen: R[]
  /** je Behandlung einmal, mit Grundstücks-Labels, -IDs und Flächensumme */
  behandlungen: R[]
  analysen: R[]
  umzuege: R[]
}

function pruefen<T>(res: { data: T; error: { message?: string } | null }, was: string): T {
  if (res.error) throw new Error(`Rückverfolgung: ${was} konnte nicht geladen werden (${res.error.message ?? 'unbekannter Fehler'})`)
  return res.data
}

/**
 * Vollständige Kette einer Kellerbuch-Charge: Charge, Pressungen samt Weingärten/GST und
 * Behandlungen; mit details zusätzlich Analysen und Behälter-Verlauf (nur Bildschirm).
 */
export async function ladeChargeKette(
  supabase: any,
  wId: string,
  tenantId: string,
  opts: { details?: boolean } = {},
): Promise<Kette> {
  const [waRes, prRes, anRes, umRes] = await Promise.all([
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, status, qualitaetsstufe, behaelter_id, behaelter:behaelter_id(name, typ, volumen_liter)')
      .eq('tenant_id', tenantId)
      .eq('id', wId)
      .maybeSingle(),
    // Pressungen, die in diese Charge geflossen sind (pressung_behaelter hat keine tenant_id –
    // Mandant über die Pressung)
    alle<R>((supabase.from('pressung_behaelter') as any)
      .select(`
        id, menge_liter, notizen,
        pressung:pressung_id(
          id, datum, most_liter_gesamt, tenant_id, jahrgang:jahrgang_id(jahrgang),
          pressung_weingaerten(
            id, trauben_kg, rebsorte, ernte_datum, kmw, weingarten_id, grundstueck_id,
            weingarten:weingarten_id(id, name, flaeche_ha),
            grundstueck:grundstueck_id(gst_nr, katastralgemeinde)
          )
        )
      `)
      .eq('weinausbau_id', wId)
      .order('id')),
    opts.details
      ? alle<R>((supabase.from('weinanalysen') as any)
          .select('id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl, bewertung, notizen')
          .eq('tenant_id', tenantId)
          .eq('weinausbau_id', wId)
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
          .eq('tenant_id', tenantId)
          .eq('von_weinausbau_id', wId)
          .order('datum', { ascending: true })
          .order('id'))
      : Promise.resolve({ data: [] as R[], error: null }),
  ])

  const weinausbau = pruefen(waRes as { data: R | null; error: { message?: string } | null }, 'Charge')
  const pressungen = pruefen(prRes, 'Pressungen').filter(pb => (pb.pressung as R | null)?.tenant_id === tenantId)
  const analysen = pruefen(anRes, 'Analysen')
  const umzuegeRaw = pruefen(umRes, 'Umzüge')

  // Behandlungen hängen über behandlung_grundstuecke an den Grundstücken der Weingärten
  const weingartenIds = new Set<string>()
  for (const pb of pressungen) {
    for (const wg of (((pb.pressung as R | null)?.pressung_weingaerten ?? []) as R[])) {
      const id = (wg.weingarten as R | null)?.id ?? wg.weingarten_id
      if (id) weingartenIds.add(id)
    }
  }

  let behandlungen: R[] = []
  if (weingartenIds.size > 0) {
    const grundstuecke = pruefen(await alle<R>((supabase.from('grundstuecke') as any)
      .select('id, weingarten_id')
      .eq('tenant_id', tenantId)
      .in('weingarten_id', Array.from(weingartenIds))
      .order('id')), 'Grundstücke')
    const wgJeGst = new Map(grundstuecke.map(g => [g.id as string, g.weingarten_id as string]))
    const grundstueckIds = grundstuecke.map(g => g.id as string)

    if (grundstueckIds.length > 0) {
      const bgRows = pruefen(await alle<R>((supabase.from('behandlung_grundstuecke') as any)
        .select(`
          behandlung_id, grundstueck_id, flaeche_ha,
          grundstueck:grundstueck_id(gst_nr, weingarten:weingarten_id(name)),
          behandlung:behandlung_id(
            id, tenant_id, datum, art, aufwandmenge, aufwandmenge_einheit, schaderreger, witterung, notizen,
            psm:psm_id(name, handelsname)
          )
        `)
        .in('grundstueck_id', grundstueckIds)
        .order('behandlung_id')
        .order('grundstueck_id')), 'Behandlungen')

      // Nach Behandlung dedupliziert (eine Behandlung betrifft oft mehrere Grundstücke)
      const byBehandlung = new Map<string, R>()
      for (const row of bgRows) {
        const b = row.behandlung as R | null
        if (!b || b.tenant_id !== tenantId) continue
        const g = row.grundstueck as R | null
        const label = `${(g?.weingarten as R | null)?.name ?? '?'} · GST ${g?.gst_nr ?? '?'}`
        const wgId = wgJeGst.get(row.grundstueck_id) ?? null
        const e = byBehandlung.get(b.id)
        if (e) {
          e.grundstuecke.push(label)
          e.grundstueckIds.push(row.grundstueck_id)
          if (wgId && !e.weingartenIds.includes(wgId)) e.weingartenIds.push(wgId)
          e.flaeche_ha_summe += num(row.flaeche_ha)
        } else {
          byBehandlung.set(b.id, { ...b, grundstuecke: [label], grundstueckIds: [row.grundstueck_id], weingartenIds: wgId ? [wgId] : [], flaeche_ha_summe: num(row.flaeche_ha) })
        }
      }
      behandlungen = Array.from(byBehandlung.values()).sort((a, b) => tag(a.datum).localeCompare(tag(b.datum)))
    }
  }

  // Quell-Zeilen der n:n-Umzüge: Ziel-Behälter nachladen
  const quelleBatchIds = [...new Set(umzuegeRaw.filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id as string))]
  const zielByBatch: Record<string, R> = {}
  if (quelleBatchIds.length > 0) {
    const zielRows = pruefen(await alle<R>((supabase.from('keller_umzuege') as any)
      .select('id, umzug_batch_id, nach_behaelter:nach_behaelter_id(name), nach_weinausbau:nach_weinausbau_id(name), menge_liter')
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

  return { weinausbau, pressungen, behandlungen, analysen, umzuege }
}

export type ChargeEintrag = { weinausbauId: string; anteilLiter: number | null; kette: Kette }
export type FuellungKette = {
  fuellung: R
  chargen: ChargeEintrag[]
  /** Wie die Chargen gefunden wurden */
  zuordnung: 'fuellung_chargen' | 'direkt' | 'automatisch' | 'keine'
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
  if (junction.length > 0) {
    ids = junction.filter(r => r.weinausbau_id).map(r => ({ id: r.weinausbau_id as string, anteil: numOderNull(r.anteil_liter) }))
    zuordnung = 'fuellung_chargen'
  } else if (fuellung.weinausbau_id) {
    ids = [{ id: fuellung.weinausbau_id, anteil: null }]
    zuordnung = 'direkt'
  } else {
    // Auto-Match: Rebsorte + Jahrgang – nur wenn eindeutig (genau 1 Treffer)
    const { data: auto, error } = await (supabase.from('weinausbau') as any)
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('rebsorte', fuellung.rebsorte ?? '%')
      .eq('jahrgang', fuellung.jahrgang ?? 0)
      .limit(2)
    if (error) throw new Error(`Rückverfolgung: Chargen-Zuordnung konnte nicht geladen werden (${error.message})`)
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
  return { fuellung, chargen, zuordnung }
}

export type RueckverfolgungFilter = { jahrgang: number | null; sorte: string | null; bezeichnung: string | null }

const TREFFER_SELECT = 'id, name, bezeichnung, jahrgang, rebsorte, qualitaet, chargennummer, pruefnummer, bestand_flaschen, flaschengroesse_ml, anzahl_flaschen, menge_liter_gefuellt, datum, weinausbau_id, aktiv'

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
  if (error) throw new Error(`Rückverfolgung: Füllung konnte nicht geladen werden (${error.message})`)
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
  kmw: number | null
  behandlungenAnzahl: number | null
  behandlungen: string | null
}

const ZUORDNUNG_TEXT: Record<FuellungKette['zuordnung'], string> = {
  fuellung_chargen: '', direkt: ' (direkt verknüpft)', automatisch: ' (automatisch über Rebsorte und Jahrgang)', keine: '',
}

function tt(datum: string): string {
  return datum ? `${datum.slice(8, 10)}.${datum.slice(5, 7)}.${datum.slice(0, 4)}` : ''
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
      charge: null, chargeJahrgang: null, anteilLiter: null, anteilPct: null, pressungDatum: null, pressungLiter: null,
      weingarten: null, katastralgemeinde: null, gstNr: null, rebsorteLese: null, traubenKg: null, lesedatum: null, kmw: null,
      behandlungenAnzahl: null, behandlungen: null,
    }
    if (fk.chargen.length === 0) {
      zeilen.push({ ...basis, ...leer, herkunft: 'keine Kellerbuch-Charge verknüpft – Rückverfolgung nur bis zur Abfüllung' })
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
      }
      const vorher = zeilen.length
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
          const wgId = w?.id ?? wg.weingarten_id ?? null
          const gstId = wg.grundstueck_id ?? null
          const beh = c.kette.behandlungen.filter(b => gstId ? (b.grundstueckIds as string[]).includes(gstId) : !!wgId && (b.weingartenIds as string[]).includes(wgId))
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
            kmw: numOderNull(wg.kmw) === null ? null : runden(num(wg.kmw), STELLEN.kmw),
            behandlungenAnzahl: beh.length,
            behandlungen: beh.map(b => {
              const mittel = (b.psm as R | null)?.name ?? BEHANDLUNG_ART_LABEL[b.art] ?? b.art ?? 'Behandlung'
              return `${tt(tag(b.datum))} ${mittel}`.trim()
            }).join(' | ') || null,
          })
        }
      }
      if (zeilen.length === vorher) {
        zeilen.push({ ...basis, ...leer, ...chargeTeil, herkunft: 'ohne Pressung (Zukauf, Eröffnungsbestand oder Verschnitt – siehe Blend-Protokoll)' })
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
  return { zeilen: rueckverfolgungZeilen(ketten), warnungen, fuellung: einzel }
}

export const SPALTEN_RUECKVERFOLGUNG: CsvSpalte<RueckverfolgungZeile>[] = [
  { kopf: 'Füllung', typ: 'text', wert: z => z.fuellung },
  { kopf: 'Chargennummer', typ: 'code', wert: z => z.chargennummer },
  { kopf: 'Prüfnummer', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'Abfülldatum', typ: 'datum', wert: z => z.abfuelldatum },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Sorte', typ: 'text', wert: z => z.sorte },
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
  { kopf: 'Trauben (kg)', typ: 'dezimal', stellen: STELLEN.kg, wert: z => z.traubenKg },
  { kopf: 'Lesedatum', typ: 'datum', wert: z => z.lesedatum },
  { kopf: 'KMW (°)', typ: 'dezimal', stellen: STELLEN.kmw, wert: z => z.kmw },
  { kopf: 'Behandlungen (Anzahl)', typ: 'ganzzahl', wert: z => z.behandlungenAnzahl },
  { kopf: 'Behandlungen (Datum Mittel)', typ: 'text', wert: z => z.behandlungen },
]

// ── Trefferliste (Listen-CSV im Browser) ──────────────────────────────────────

export const SPALTEN_RUECKVERFOLGUNG_TREFFER: CsvSpalte<R>[] = [
  { kopf: 'Produktname', typ: 'text', wert: f => f.name },
  { kopf: 'Bezeichnung', typ: 'text', wert: f => f.bezeichnung },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: f => f.jahrgang },
  { kopf: 'Sorte', typ: 'text', wert: f => f.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: f => bkiRebsorteKuerzel(text(f.rebsorte)) },
  { kopf: 'Qualität', typ: 'text', wert: f => f.qualitaet },
  { kopf: 'Chargennummer', typ: 'code', wert: f => f.chargennummer },
  { kopf: 'Prüfnummer', typ: 'code', wert: f => f.pruefnummer },
  { kopf: 'Flaschengröße (ml)', typ: 'ganzzahl', wert: f => f.flaschengroesse_ml },
  { kopf: 'Bestand (Flaschen)', typ: 'ganzzahl', wert: f => Math.trunc(num(f.bestand_flaschen)) },
  { kopf: 'Aktiv', typ: 'janein', wert: f => f.aktiv },
]
