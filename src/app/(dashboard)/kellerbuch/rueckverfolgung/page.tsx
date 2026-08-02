import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Boxes, ArrowLeftRight, Filter, Microscope, Leaf, Wine, Search } from 'lucide-react'

export const metadata: Metadata = { title: 'Rückverfolgung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const ART_LABELS: Record<string, string> = {
  spritzung:        'Spritzung',
  duengung:         'Düngung',
  bodenbearbeitung: 'Bodenbearbeitung',
  schnitt:          'Schnitt',
  laubarbeit:       'Laubarbeit',
  sonstiges:        'Sonstiges',
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-s112-muted w-40 shrink-0">{label}</span>
      <span className="text-gray-800 font-medium">{value}</span>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-3">
      <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        <span>{icon}</span>{title}
      </h2>
      {children}
    </div>
  )
}

// ── Hilfsfunktion: vollständige Kette für eine Weinausbau-Charge laden ───────
async function ladeChargeKette(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, wId: string) {
  const [waRes, prRes, anRes, umRes] = await Promise.all([
    // Weinausbau-Charge
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, status, qualitaetsstufe, behaelter_id, behaelter:behaelter_id(name, typ, volumen_liter)')
      .eq('id', wId)
      .single(),

    // Pressungen die in diese Charge geflossen sind
    (supabase.from('pressung_behaelter') as any)
      .select(`
        menge_liter, notizen,
        pressung:pressung_id(
          id, datum, most_liter_gesamt, jahrgang:jahrgang_id(jahrgang),
          pressung_weingaerten(
            trauben_kg, rebsorte, ernte_datum, kmw,
            weingarten:weingarten_id(id, name, flaeche_ha),
            grundstueck:grundstueck_id(gst_nr, katastralgemeinde)
          )
        )
      `)
      .eq('weinausbau_id', wId),

    // Analysen der Charge (Tabelle heißt weinanalysen, ein Datensatz pro Analyse-Termin)
    (supabase.from('weinanalysen') as any)
      .select('analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl, bewertung, notizen')
      .eq('weinausbau_id', wId)
      .order('analyse_datum', { ascending: true }),

    // Umzüge (Behälter-Verlauf) – 'quelle'-Zeilen des n:n-Formats
    (supabase.from('keller_umzuege') as any)
      .select(`
        datum, menge_liter, brutto_liter, schwund_liter, notizen, zeilen_typ, umzug_batch_id,
        von_behaelter:von_behaelter_id(name),
        nach_behaelter:nach_behaelter_id(name)
      `)
      .eq('von_weinausbau_id', wId)
      .order('datum', { ascending: true }),
  ])

  const weinausbau = waRes.data as R | null
  const pressungen = (prRes.data ?? []) as R[]
  const analysen = (anRes.data ?? []) as R[]
  const umzuegeRaw = (umRes.data ?? []) as R[]

  // ── Behandlungen für die Weingärten dieser Charge ────────────────────────
  // Behandlungen hängen NICHT direkt an der Weinausbau-Charge, sondern über
  // die Junction-Tabelle behandlung_grundstuecke an einzelnen Grundstücken.
  // Weg: Weingarten-IDs aus den Pressungen sammeln → zugehörige Grundstücke
  // laden → darüber behandlung_grundstuecke + behandlungen joinen.
  const weingartenIds = new Set<string>()
  for (const pb of pressungen) {
    const wgListe = ((pb.pressung as R | null)?.pressung_weingaerten ?? []) as R[]
    for (const wg of wgListe) {
      const w = wg.weingarten as R | null
      if (w?.id) weingartenIds.add(w.id)
    }
  }

  let behandlungen: R[] = []
  if (weingartenIds.size > 0) {
    const { data: grundstueckeRows } = await (supabase.from('grundstuecke') as any)
      .select('id')
      .in('weingarten_id', Array.from(weingartenIds))
    const grundstueckIds = ((grundstueckeRows ?? []) as R[]).map(g => g.id)

    if (grundstueckIds.length > 0) {
      const { data: bgRows } = await (supabase.from('behandlung_grundstuecke') as any)
        .select(`
          flaeche_ha,
          grundstueck:grundstueck_id(gst_nr, weingarten:weingarten_id(name)),
          behandlung:behandlung_id(
            id, datum, art, aufwandmenge, aufwandmenge_einheit, schaderreger, witterung, notizen,
            psm:psm_id(name, handelsname)
          )
        `)
        .in('grundstueck_id', grundstueckIds)

      // Nach Behandlung dedupliziert gruppieren (eine Behandlung betrifft oft mehrere Grundstücke)
      const byBehandlung = new Map<string, R>()
      for (const row of ((bgRows ?? []) as R[])) {
        const b = row.behandlung as R | null
        if (!b) continue
        const g = row.grundstueck as R | null
        const label = `${(g?.weingarten as R | null)?.name ?? '?'} · GST ${g?.gst_nr ?? '?'}`
        const existing = byBehandlung.get(b.id)
        if (existing) {
          existing.grundstuecke.push(label)
          existing.flaeche_ha_summe += Number(row.flaeche_ha ?? 0)
        } else {
          byBehandlung.set(b.id, { ...b, grundstuecke: [label], flaeche_ha_summe: Number(row.flaeche_ha ?? 0) })
        }
      }
      behandlungen = Array.from(byBehandlung.values())
        .sort((a, b) => new Date(a.datum).getTime() - new Date(b.datum).getTime())
    }
  }

  // Sekundäre Abfrage: für 'quelle'-Zeilen den Ziel-Behälter holen
  const quelleBatchIds = [...new Set(
    umzuegeRaw.filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id)
  )] as string[]

  const zielByBatch: Record<string, R> = {}
  if (quelleBatchIds.length > 0) {
    const { data: zielRows } = await (supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name), nach_weinausbau:nach_weinausbau_id(name), menge_liter')
      .in('umzug_batch_id', quelleBatchIds)
      .eq('zeilen_typ', 'ziel')
    for (const z of ((zielRows ?? []) as R[])) {
      if (!zielByBatch[z.umzug_batch_id]) zielByBatch[z.umzug_batch_id] = z
    }
  }

  const umzuege = umzuegeRaw.map(u => {
    if (u.zeilen_typ === 'quelle' && u.umzug_batch_id && zielByBatch[u.umzug_batch_id]) {
      const z = zielByBatch[u.umzug_batch_id]
      return {
        ...u,
        nach_behaelter: z.nach_behaelter ?? z.nach_weinausbau ?? null,
        menge_liter: u.brutto_liter ?? u.menge_liter,
      }
    }
    return u
  })

  return { weinausbau, pressungen, behandlungen, analysen, umzuege }
}

// ── Sub-Komponente: eine Charge mit allen Kettendaten ────────────────────────
function ChargeKette({
  weinausbau,
  pressungen,
  behandlungen,
  analysen,
  umzuege,
  anteilLiter,
  chargeNr,
  total,
}: {
  weinausbau: R | null
  pressungen: R[]
  behandlungen: R[]
  analysen: R[]
  umzuege: R[]
  anteilLiter?: number | null
  chargeNr: number
  total: number
}) {
  if (!weinausbau) return null
  const showNr = total > 1

  return (
    <div className="space-y-4">
      {/* Kellerbuch-Charge */}
      <Section title={showNr ? `Kellerbuch-Charge ${chargeNr} / ${total}` : 'Kellerbuch-Charge'} icon={<Boxes className="w-4 h-4" />}>
        <InfoRow label="Charge" value={weinausbau.name} />
        <InfoRow label="Jahrgang" value={weinausbau.jahrgang} />
        <InfoRow label="Rebsorte" value={weinausbau.rebsorte} />
        <InfoRow label="Qualität" value={weinausbau.qualitaetsstufe} />
        <InfoRow label="Status" value={weinausbau.status} />
        <InfoRow label="Behälter" value={(weinausbau.behaelter as R | null)?.name} />
        {anteilLiter != null && (
          <InfoRow label="Anteil dieser Charge"
            value={`${anteilLiter.toLocaleString('de-AT', { minimumFractionDigits: 2 })} L`} />
        )}
        <Link
          href={`/kellerbuch/weinausbau/${weinausbau.id}/buch`}
          className="inline-flex items-center gap-1 text-xs text-s112-teal hover:underline pt-1"
        >
          Weinbuch dieser Charge öffnen
        </Link>
      </Section>

      {/* Behälter-Verlauf */}
      {umzuege.length > 0 && (
        <Section title="Behälter-Verlauf" icon={<ArrowLeftRight className="w-4 h-4" />}>
          <div className="space-y-2">
            {umzuege.map((u: R, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-s112-muted tabular-nums w-24 shrink-0">
                  {new Date(u.datum).toLocaleDateString('de-AT')}
                </span>
                <span className="text-gray-600">{(u.von_behaelter as R | null)?.name ?? '?'}</span>
                <span className="text-s112-muted">→</span>
                <span className="text-gray-600">{(u.nach_behaelter as R | null)?.name ?? '?'}</span>
                <span className="text-xs text-s112-muted ml-auto">
                  {u.menge_liter ? `${parseFloat(u.menge_liter).toLocaleString('de-AT')} L` : ''}
                  {u.schwund_liter ? ` (Schwund: ${u.schwund_liter} L)` : ''}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Pressungen / Weingärten */}
      {pressungen.length > 0 && (
        <Section title="Pressung & Herkunft" icon={<Filter className="w-4 h-4" />}>
          {pressungen.map((pb: R, i: number) => {
            const p = pb.pressung as R
            if (!p) return null
            const wgListe = (p.pressung_weingaerten ?? []) as R[]
            return (
              <div key={i} className={i > 0 ? 'pt-3 border-t border-s112-border/60' : ''}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs text-s112-muted tabular-nums">
                    {p.datum ? new Date(p.datum).toLocaleDateString('de-AT') : ''}
                  </span>
                  <span className="text-sm font-medium text-gray-700">Pressung</span>
                  {p.most_liter_gesamt && (
                    <span className="text-xs text-s112-muted">
                      {parseFloat(p.most_liter_gesamt).toLocaleString('de-AT')} L Most
                    </span>
                  )}
                  <span className="text-xs text-s112-muted ml-auto">
                    Anteil: {pb.menge_liter ? `${parseFloat(pb.menge_liter).toLocaleString('de-AT')} L` : '–'}
                  </span>
                </div>
                {wgListe.length > 0 && (
                  <div className="ml-4 space-y-2">
                    {wgListe.map((wg: R, j: number) => {
                      const w = wg.weingarten as R | null
                      const g = wg.grundstueck as R | null
                      return (
                        <div key={j} className="bg-s112-bg rounded-lg p-3 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">{w?.name ?? '–'}</span>
                            {w?.flaeche_ha && (
                              <span className="text-xs text-s112-muted">{parseFloat(w.flaeche_ha).toLocaleString('de-AT')} ha</span>
                            )}
                          </div>
                          {g && (
                            <div className="text-xs text-s112-muted">
                              {g.katastralgemeinde}{g.gst_nr ? ` · GST ${g.gst_nr}` : ''}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-600">
                            {wg.trauben_kg && <span>{parseFloat(wg.trauben_kg).toLocaleString('de-AT')} kg</span>}
                            {wg.rebsorte && <span>{wg.rebsorte}</span>}
                            {wg.ernte_datum && <span>Lese: {new Date(wg.ernte_datum).toLocaleDateString('de-AT')}</span>}
                            {wg.kmw && <span>{wg.kmw} °KMW</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </Section>
      )}

      {/* Analysen */}
      {analysen.length > 0 && (
        <Section title="Analysen" icon={<Microscope className="w-4 h-4" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-s112-border/50">
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-gray-500">Datum</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-gray-500">Alkohol</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-gray-500">Restzucker</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-gray-500">Gesamtsäure</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-gray-500">pH</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-gray-500">Flücht. Säure</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-gray-500">SO₂ frei</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-gray-500">SO₂ gesamt</th>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-gray-500">Labor</th>
                </tr>
              </thead>
              <tbody>
                {analysen.map((a: R, i: number) => (
                  <tr key={i} className="border-b border-s112-border/30 last:border-0">
                    <td className="px-2 py-1.5 text-xs text-s112-muted tabular-nums whitespace-nowrap">
                      {new Date(a.analyse_datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.alkohol_vol != null ? `${a.alkohol_vol} % vol` : '–'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.restzucker_gl != null ? `${a.restzucker_gl} g/l` : '–'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.gesamtsaeure_gl != null ? `${a.gesamtsaeure_gl} g/l` : '–'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.ph_wert ?? '–'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a['flüchtige_saeure_gl'] != null ? `${a['flüchtige_saeure_gl']} g/l` : '–'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.freie_so2_mgl != null ? `${a.freie_so2_mgl} mg/l` : '–'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{a.gesamt_so2_mgl != null ? `${a.gesamt_so2_mgl} mg/l` : '–'}</td>
                    <td className="px-2 py-1.5 text-s112-muted text-xs">{a.labor ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Behandlungen */}
      {behandlungen.length > 0 && (
        <Section title="Behandlungen / PSM" icon={<Leaf className="w-4 h-4" />}>
          <div className="space-y-2">
            {behandlungen.map((b: R, i: number) => {
              const psm = b.psm as R | null
              return (
                <div key={i} className="flex items-start gap-3 text-sm border-b border-s112-border/30 last:border-0 pb-2 last:pb-0">
                  <span className="text-xs text-s112-muted tabular-nums w-20 shrink-0 pt-0.5">
                    {new Date(b.datum).toLocaleDateString('de-AT')}
                  </span>
                  <div className="flex-1">
                    <span className="font-medium text-gray-800">{psm?.name ?? ART_LABELS[b.art] ?? b.art}</span>
                    <span className="text-xs text-s112-muted ml-1">({ART_LABELS[b.art] ?? b.art})</span>
                    <div className="text-xs text-s112-muted">
                      {(b.grundstuecke as string[]).join(', ')}
                      {b.aufwandmenge ? ` · ${b.aufwandmenge} ${b.aufwandmenge_einheit ?? ''}` : ''}
                      {b.flaeche_ha_summe ? ` · ${Number(b.flaeche_ha_summe).toLocaleString('de-AT')} ha` : ''}
                    </div>
                    {b.schaderreger && <div className="text-xs text-s112-muted">Grund: {b.schaderreger}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}

export default async function RueckverfolgungPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; fuellung_id?: string }>
}) {
  const { q, fuellung_id } = await searchParams
  const supabase = await createSupabaseServerClient()

  // ── Autocomplete-Vorschläge ──────────────────────────────────────────────
  const { data: autocompleteRaw } = await (supabase.from('fuellungen') as any)
    .select('chargennummer, pruefnummer, name')
    .eq('aktiv', true)
    .order('name', { ascending: true })
  const autocompleteOptions: string[] = []
  for (const row of ((autocompleteRaw ?? []) as R[])) {
    if (row.chargennummer) autocompleteOptions.push(row.chargennummer)
    if (row.pruefnummer)   autocompleteOptions.push(row.pruefnummer)
    if (row.name)          autocompleteOptions.push(row.name)
  }

  // ── Direkteinstieg per Fuellung-ID (z.B. Klick aus Warenwirtschaft/Lager) ──
  // ── oder Suche nach Chargennummer/Prüfnummer/Produktname ─────────────────
  let fuellung: R | null = null
  let suchFehler: string | null = null

  if (fuellung_id?.trim()) {
    const { data, error } = await (supabase.from('fuellungen') as any)
      .select('*')
      .eq('id', fuellung_id.trim())
      .single()

    if (error || !data) {
      suchFehler = 'Füllung nicht gefunden.'
    } else {
      fuellung = data as R
    }
  } else if (q?.trim()) {
    const qTrim = q.trim()
    const { data, error } = await (supabase.from('fuellungen') as any)
      .select('*')
      .or(`chargennummer.eq.${qTrim},pruefnummer.eq.${qTrim},name.ilike.*${qTrim}*`)
      .limit(1)
      .single()

    if (error || !data) {
      suchFehler = `Keine Füllung mit Chargennummer, Prüfnummer oder Produktname „${q}" gefunden.`
    } else {
      fuellung = data as R
    }
  }

  // ── Kettendaten laden (unterstützt Verschnitte via fuellung_chargen) ──────
  type ChargeEntry = {
    weinausbauId: string
    anteilLiter: number | null
    kette: Awaited<ReturnType<typeof ladeChargeKette>>
  }
  let chargeEntries: ChargeEntry[] = []

  if (fuellung) {
    // 1. fuellung_chargen abfragen
    const { data: fcRows } = await (supabase.from('fuellung_chargen') as any)
      .select('weinausbau_id, anteil_liter')
      .eq('fuellung_id', fuellung.id)

    const junctionRows = (fcRows ?? []) as R[]

    // 2. Fallback-Kaskade: Junction → weinausbau_id → Auto-Match per Rebsorte+Jahrgang
    let weinausbauIds: Array<{ id: string; anteil: number | null }>

    if (junctionRows.length > 0) {
      weinausbauIds = junctionRows.map(r => ({ id: r.weinausbau_id, anteil: r.anteil_liter ?? null }))
    } else if (fuellung.weinausbau_id) {
      weinausbauIds = [{ id: fuellung.weinausbau_id, anteil: null }]
    } else {
      // Auto-Match: Rebsorte + Jahrgang abgleichen – nur wenn eindeutig (genau 1 Treffer)
      const { data: autoRows } = await (supabase.from('weinausbau') as any)
        .select('id')
        .eq('tenant_id', fuellung.tenant_id)
        .ilike('rebsorte', fuellung.rebsorte ?? '%')
        .eq('jahrgang', fuellung.jahrgang ?? 0)
      const autoMatches = (autoRows ?? []) as R[]
      weinausbauIds = autoMatches.length === 1
        ? [{ id: autoMatches[0].id, anteil: null }]
        : []
    }

    // 3. Alle Ketten parallel laden
    chargeEntries = await Promise.all(
      weinausbauIds.map(async ({ id, anteil }) => ({
        weinausbauId: id,
        anteilLiter: anteil,
        kette: await ladeChargeKette(supabase, id),
      }))
    )
  }

  return (
    <div className="max-w-3xl space-y-6">

      {/* Header */}
      <div>
        <nav className="flex items-center gap-2 text-sm text-s112-muted mb-4">
          <Link href="/kellerbuch" className="hover:text-s112-teal">Kellerbuch</Link>
          <span>/</span>
          <span className="text-gray-800 font-medium">Rückverfolgung</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Search className="w-5 h-5" />Rückverfolgung
        </h1>
        <p className="text-sm text-s112-muted mt-1">
          Chargennummer oder Prüfnummer eingeben → vollständige Kette von der Flasche zum Weingarten
        </p>
      </div>

      {/* Suchfeld */}
      <form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={q ?? fuellung?.chargennummer ?? ''}
          list="rueckverfolgung-vorschlaege"
          placeholder="Chargennummer z.B. CH-2025-001 oder Prüfnummer"
          className="flex-1 border border-s112-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
          autoFocus
        />
        <datalist id="rueckverfolgung-vorschlaege">
          {autocompleteOptions.map(opt => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
        <button type="submit"
          className="bg-s112-teal text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90">
          Suchen
        </button>
      </form>

      {suchFehler && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {suchFehler}
        </div>
      )}

      {/* ── Ergebnis ─────────────────────────────────────────────────────── */}
      {fuellung && (
        <div className="space-y-4">

          {/* Flasche / Abfüllung */}
          <Section title="Abfüllung" icon={<Wine className="w-4 h-4" />}>
            <InfoRow label="Chargennummer" value={fuellung.chargennummer ?? '–'} />
            <InfoRow label="Prüfnummer" value={fuellung.pruefnummer ?? '–'} />
            <InfoRow label="Produktname" value={fuellung.name} />
            <InfoRow label="Jahrgang" value={fuellung.jahrgang} />
            <InfoRow label="Rebsorte" value={fuellung.rebsorte} />
            <InfoRow label="Qualität" value={fuellung.qualitaet} />
            <InfoRow label="Anbaugebiet" value={fuellung.anbaugebiet} />
            <InfoRow label="Ried / Bezeichnung" value={fuellung.bezeichnung} />
            <InfoRow label="Abfülldatum" value={fuellung.datum ? new Date(fuellung.datum).toLocaleDateString('de-AT') : null} />
            <InfoRow label="Flaschengröße" value={fuellung.flaschengroesse_ml ? `${fuellung.flaschengroesse_ml} ml` : null} />
            <InfoRow label="Anzahl Flaschen" value={fuellung.anzahl_flaschen?.toLocaleString('de-AT')} />
            <InfoRow label="Liter abgefüllt" value={fuellung.menge_liter_gefuellt ? `${parseFloat(fuellung.menge_liter_gefuellt).toLocaleString('de-AT', { minimumFractionDigits: 2 })} L` : null} />
            {chargeEntries.length > 1 && (
              <div className="mt-1 text-xs text-s112-muted bg-s112-bg rounded-lg px-3 py-1.5">
                Verschnitt aus {chargeEntries.length} Kellerbuch-Chargen
              </div>
            )}
          </Section>

          {/* Charge-Ketten */}
          {chargeEntries.length > 0 ? (
            chargeEntries.map((entry, idx) => (
              <ChargeKette
                key={entry.weinausbauId}
                weinausbau={entry.kette.weinausbau}
                pressungen={entry.kette.pressungen}
                behandlungen={entry.kette.behandlungen}
                analysen={entry.kette.analysen}
                umzuege={entry.kette.umzuege}
                anteilLiter={chargeEntries.length > 1 ? entry.anteilLiter : undefined}
                chargeNr={idx + 1}
                total={chargeEntries.length}
              />
            ))
          ) : (
            <div className="bg-s112-bg border border-s112-border rounded-xl p-4 text-sm text-s112-muted">
              Diese Füllung hat keine verknüpfte Kellerbuch-Charge – Rückverfolgung nur bis zur Abfüllung möglich.
            </div>
          )}

        </div>
      )}

      {!q && !fuellung_id && (
        <div className="card p-8 text-center text-s112-muted">
          <Search className="w-8 h-8 mx-auto mb-3" />
          <p className="text-sm">Chargennummer oder Prüfnummer eingeben um die vollständige Herkunftskette anzuzeigen.</p>
        </div>
      )}

    </div>
  )
}
