import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Boxes, ArrowLeftRight, Filter, Microscope, Leaf, Wine, Search, GitMerge } from 'lucide-react'
import { resolveBlendKompositionFuellung, type KompositionUrsprung } from '@/lib/wein/blendKomposition'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import RueckverfolgungPrintButton from './PrintButton'
import RueckverfolgungCsvExportButton from './CsvExportButton'
import { fmtNum } from '@/lib/format'

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
      <span className="text-s112-text font-medium">{value}</span>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-3">
      <h2 className="text-sm font-semibold text-s112-text flex items-center gap-2">
        <span>{icon}</span>{title}
      </h2>
      {children}
    </div>
  )
}

function herkunftLabel(u: KompositionUrsprung): string {
  if (u.typ === 'pressung') {
    const teile = [u.weingarten_name, u.gst_nr ? `GST ${u.gst_nr}` : null].filter(Boolean)
    return teile.length > 0 ? teile.join(' · ') : 'Pressung (Weingarten unbekannt)'
  }
  if (u.typ === 'zukauf') return u.zukauf_von ? `Zukauf – ${u.zukauf_von}` : 'Zukauf'
  if (u.typ === 'eroeffnungsbestand') return 'Eröffnungsbestand (historisch)'
  return 'Herkunft unbekannt'
}

// ── Hilfsfunktion: vollständige Kette für eine Weinausbau-Charge laden ───────
async function ladeChargeKette(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, wId: string, tenantId: string | null) {
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [waRes, prRes, anRes, umRes] = await Promise.all([
    // Weinausbau-Charge
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, status, qualitaetsstufe, behaelter_id, behaelter:behaelter_id(name, typ, volumen_liter)')
      .eq('id', wId))
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
    tf((supabase.from('weinanalysen') as any)
      .select('analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl, bewertung, notizen')
      .eq('weinausbau_id', wId)
      .order('analyse_datum', { ascending: true })),

    // Umzüge (Behälter-Verlauf) – 'quelle'-Zeilen des n:n-Formats
    tf((supabase.from('keller_umzuege') as any)
      .select(`
        datum, menge_liter, brutto_liter, schwund_liter, notizen, zeilen_typ, umzug_batch_id,
        von_behaelter:von_behaelter_id(name),
        nach_behaelter:nach_behaelter_id(name)
      `)
      .eq('von_weinausbau_id', wId)
      .order('datum', { ascending: true })),
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
    const { data: grundstueckeRows } = await tf((supabase.from('grundstuecke') as any)
      .select('id')
      .in('weingarten_id', Array.from(weingartenIds)))
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
    const { data: zielRows } = await tf((supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name), nach_weinausbau:nach_weinausbau_id(name), menge_liter')
      .in('umzug_batch_id', quelleBatchIds)
      .eq('zeilen_typ', 'ziel'))
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
        <InfoRow label="Rebsorte" value={weinausbau.rebsorte ? formatRebsorteMitKuerzel(weinausbau.rebsorte) : null} />
        <InfoRow label="Qualität" value={weinausbau.qualitaetsstufe} />
        <InfoRow label="Status" value={weinausbau.status} />
        <InfoRow label="Behälter" value={(weinausbau.behaelter as R | null)?.name} />
        {anteilLiter != null && (
          <InfoRow label="Anteil dieser Charge"
            value={`${fmtNum(anteilLiter, { min: 2 })} L`} />
        )}
        <Link
          href={`/kellerbuch/weinausbau/${weinausbau.id}/buch`}
          className="inline-flex items-center gap-1 text-xs text-s112-blue-700 hover:underline pt-1"
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
                <span className="text-s112-text-2">{(u.von_behaelter as R | null)?.name ?? '?'}</span>
                <span className="text-s112-muted">→</span>
                <span className="text-s112-text-2">{(u.nach_behaelter as R | null)?.name ?? '?'}</span>
                <span className="text-xs text-s112-muted ml-auto">
                  {u.menge_liter ? `${fmtNum(parseFloat(u.menge_liter))} L` : ''}
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
                  <span className="text-sm font-medium text-s112-text-1">Pressung</span>
                  {p.most_liter_gesamt && (
                    <span className="text-xs text-s112-muted">
                      {fmtNum(parseFloat(p.most_liter_gesamt))} L Most
                    </span>
                  )}
                  <span className="text-xs text-s112-muted ml-auto">
                    Anteil: {pb.menge_liter ? `${fmtNum(parseFloat(pb.menge_liter))} L` : '–'}
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
                            <span className="text-sm font-medium text-s112-text">{w?.name ?? '–'}</span>
                            {w?.flaeche_ha && (
                              <span className="text-xs text-s112-muted">{fmtNum(parseFloat(w.flaeche_ha))} ha</span>
                            )}
                          </div>
                          {g && (
                            <div className="text-xs text-s112-muted">
                              {g.katastralgemeinde}{g.gst_nr ? ` · GST ${g.gst_nr}` : ''}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-s112-text-2">
                            {wg.trauben_kg && <span>{fmtNum(parseFloat(wg.trauben_kg))} kg</span>}
                            {wg.rebsorte && <span>{formatRebsorteMitKuerzel(wg.rebsorte)}</span>}
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
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-s112-text-2">Datum</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-s112-text-2">Alkohol</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-s112-text-2">Restzucker</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-s112-text-2">Gesamtsäure</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-s112-text-2">pH</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-s112-text-2">Flücht. Säure</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-s112-text-2">SO₂ frei</th>
                  <th className="text-right px-2 py-1.5 text-xs font-medium text-s112-text-2">SO₂ gesamt</th>
                  <th className="text-left px-2 py-1.5 text-xs font-medium text-s112-text-2">Labor</th>
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
                    <span className="font-medium text-s112-text">{psm?.name ?? ART_LABELS[b.art] ?? b.art}</span>
                    <span className="text-xs text-s112-muted ml-1">({ART_LABELS[b.art] ?? b.art})</span>
                    <div className="text-xs text-s112-muted">
                      {(b.grundstuecke as string[]).join(', ')}
                      {b.aufwandmenge ? ` · ${b.aufwandmenge} ${b.aufwandmenge_einheit ?? ''}` : ''}
                      {b.flaeche_ha_summe ? ` · ${fmtNum(Number(b.flaeche_ha_summe))} ha` : ''}
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
  searchParams: Promise<{ q?: string; fuellung_id?: string; jahrgang?: string; sorte?: string; bezeichnung?: string }>
}) {
  const { q, fuellung_id, jahrgang, sorte, bezeichnung } = await searchParams
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // ── Autocomplete-Vorschläge ──────────────────────────────────────────────
  const { data: autocompleteRaw } = await tf((supabase.from('fuellungen') as any)
    .select('chargennummer, pruefnummer, name')
    .eq('aktiv', true)
    .order('name', { ascending: true }))
  const autocompleteOptions: string[] = []
  for (const row of ((autocompleteRaw ?? []) as R[])) {
    if (row.chargennummer) autocompleteOptions.push(row.chargennummer)
    if (row.pruefnummer)   autocompleteOptions.push(row.pruefnummer)
    if (row.name)          autocompleteOptions.push(row.name)
  }

  // ── Trefferliste: leichterer Zugang über Jahrgang/Sorte/Bezeichnung ───────
  // Statt zwingend eine exakte Chargen-/Prüfnummer zu kennen, kann hier über
  // Filter eine Liste passender Füllungen durchsucht werden. Ein Klick auf
  // einen Treffer öffnet wie gehabt die volle Rückverfolgungskette (fuellung_id).
  const { data: filterOptionenRaw } = await tf((supabase.from('fuellungen') as any)
    .select('jahrgang, rebsorte, bezeichnung'))
  const filterOptionenRows = (filterOptionenRaw ?? []) as R[]
  const jahrgangOptionen = Array.from(
    new Set(filterOptionenRows.map(f => f.jahrgang).filter((j): j is number => j != null))
  ).sort((a, b) => b - a)
  const sorteOptionen = Array.from(
    new Set(filterOptionenRows.map(f => f.rebsorte).filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, 'de-AT'))
  const bezeichnungOptionen = Array.from(
    new Set(filterOptionenRows.map(f => f.bezeichnung).filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, 'de-AT'))

  let trefferQuery = tf((supabase.from('fuellungen') as any)
    .select('id, name, bezeichnung, jahrgang, rebsorte, qualitaet, chargennummer, pruefnummer, bestand_flaschen, flaschengroesse_ml, aktiv')
    .order('jahrgang', { ascending: false })
    .order('name', { ascending: true }))
  if (jahrgang)     trefferQuery = trefferQuery.eq('jahrgang', parseInt(jahrgang))
  if (sorte)        trefferQuery = trefferQuery.eq('rebsorte', sorte)
  if (bezeichnung)  trefferQuery = trefferQuery.eq('bezeichnung', bezeichnung)
  const { data: trefferRaw } = await trefferQuery
  const trefferliste = (trefferRaw ?? []) as R[]

  const oLagerbestandFlaschen = trefferliste.length > 0
    ? trefferliste.reduce((s, f) => s + (parseInt(f.bestand_flaschen) || 0), 0) / trefferliste.length
    : null

  // ── Direkteinstieg per Fuellung-ID (z.B. Klick aus Warenwirtschaft/Lager) ──
  // ── oder Suche nach Chargennummer/Prüfnummer/Produktname ─────────────────
  let fuellung: R | null = null
  let suchFehler: string | null = null

  if (fuellung_id?.trim()) {
    const { data, error } = await tf((supabase.from('fuellungen') as any)
      .select('*')
      .eq('id', fuellung_id.trim()))
      .single()

    if (error || !data) {
      suchFehler = 'Füllung nicht gefunden.'
    } else {
      fuellung = data as R
    }
  } else if (q?.trim()) {
    const qTrim = q.trim()
    const { data, error } = await tf((supabase.from('fuellungen') as any)
      .select('*')
      .or(`chargennummer.eq.${qTrim},pruefnummer.eq.${qTrim},name.ilike.*${qTrim}*`))
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
    const { data: fcRows } = await tf((supabase.from('fuellung_chargen') as any)
      .select('weinausbau_id, anteil_liter')
      .eq('fuellung_id', fuellung.id))

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
        kette: await ladeChargeKette(supabase, id, tenantId),
      }))
    )
  }

  // ── Blend-Protokoll: vollständige Herkunfts-Zusammensetzung (rekursiv über alle
  // Verschneidungs-Generationen) ────────────────────────────────────────────────
  const blendKomposition: KompositionUrsprung[] = fuellung
    ? await resolveBlendKompositionFuellung(supabase, fuellung.id, tenantId)
    : []

  const filterAktiv = !!(jahrgang || sorte || bezeichnung)
  const inputCls = 'w-full border border-s112-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  return (
    <div className="max-w-5xl space-y-6">

      {/* Header */}
      <div>
        <nav className="flex items-center gap-2 text-sm text-s112-muted mb-4">
          <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
          <span>/</span>
          <span className="text-s112-text font-medium">Rückverfolgung</span>
        </nav>
        <h1 className="text-2xl font-semibold text-s112-text flex items-center gap-2">
          <Search className="w-5 h-5" />Rückverfolgung
        </h1>
        <p className="text-sm text-s112-muted mt-1">
          Nach Jahrgang, Sorte oder Bezeichnung filtern, oder direkt Chargennummer/Prüfnummer eingeben → vollständige Kette von der Flasche zum Weingarten
        </p>
      </div>

      {/* ── Ergebnis (bewusst OBEN, direkt unter dem Header: der Klick auf
          „Details" in der Liste soll sofort sichtbar etwas zeigen) ─────────── */}
      {fuellung && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 print:hidden">
            <p className="text-sm text-s112-muted">Rückverfolgung für <strong className="text-s112-text">{fuellung.name}</strong>{fuellung.chargennummer ? <> · <span className="font-mono text-xs">{fuellung.chargennummer}</span></> : null}</p>
            <Link href="/kellerbuch/rueckverfolgung" className="text-sm text-s112-blue-700 hover:underline shrink-0">← alle Füllungen</Link>
          </div>

          {/* Flasche / Abfüllung */}
          <Section title="Abfüllung" icon={<Wine className="w-4 h-4" />}>
            <InfoRow label="Chargennummer" value={fuellung.chargennummer ?? '–'} />
            <InfoRow label="Prüfnummer" value={fuellung.pruefnummer ?? '–'} />
            <InfoRow label="Produktname" value={fuellung.name} />
            <InfoRow label="Jahrgang" value={fuellung.jahrgang} />
            <InfoRow label="Rebsorte" value={fuellung.rebsorte ? formatRebsorteMitKuerzel(fuellung.rebsorte) : null} />
            <InfoRow label="Qualität" value={fuellung.qualitaet} />
            <InfoRow label="Anbaugebiet" value={fuellung.anbaugebiet} />
            <InfoRow label="Ried / Bezeichnung" value={fuellung.bezeichnung} />
            <InfoRow label="Abfülldatum" value={fuellung.datum ? new Date(fuellung.datum).toLocaleDateString('de-AT') : null} />
            <InfoRow label="Flaschengröße" value={fuellung.flaschengroesse_ml ? `${fuellung.flaschengroesse_ml} ml` : null} />
            <InfoRow label="Anzahl Flaschen" value={(fuellung.anzahl_flaschen == null ? undefined : fmtNum(fuellung.anzahl_flaschen))} />
            <InfoRow label="Liter abgefüllt" value={fuellung.menge_liter_gefuellt ? `${fmtNum(parseFloat(fuellung.menge_liter_gefuellt), { min: 2 })} L` : null} />
            {chargeEntries.length > 1 && (
              <div className="mt-1 text-xs text-s112-muted bg-s112-bg rounded-lg px-3 py-1.5">
                Verschnitt aus {chargeEntries.length} Kellerbuch-Chargen
              </div>
            )}
          </Section>

          {/* Blend-Protokoll: vollständige Herkunfts-Zusammensetzung */}
          {blendKomposition.length > 0 && (
            <Section title="Blend-Protokoll" icon={<GitMerge className="w-4 h-4" />}>
              <div className="space-y-1.5">
                {blendKomposition.map(u => (
                  <div key={u.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-s112-text-1">
                      {herkunftLabel(u)}
                      {(u.rebsorte || u.jahrgang) && (
                        <span className="text-s112-muted"> · {[u.rebsorte ? formatRebsorteMitKuerzel(u.rebsorte) : null, u.jahrgang].filter(Boolean).join(' · ')}</span>
                      )}
                    </span>
                    <span className="text-s112-text font-semibold shrink-0">
                      {fmtNum(u.anteil_pct, 1)} %
                    </span>
                  </div>
                ))}
              </div>
              <Link
                href={`/kellerbuch/fuellung/${fuellung.id}/blend-protokoll`}
                className="inline-block mt-1 text-sm font-medium text-s112-blue-700 hover:underline"
              >
                Vollständiges Blend-Protokoll ansehen / drucken →
              </Link>
            </Section>
          )}

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


      {/* Filtern nach Jahrgang / Sorte / Bezeichnung – leichterer Zugang zum Durchsuchen,
          ohne dass eine exakte Chargen-/Prüfnummer schon bekannt sein muss. */}
      <div className="card p-5 space-y-4 print:hidden">
        <h2 className="font-semibold text-s112-text text-sm">Füllungen filtern</h2>
        <form method="get" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Jahrgang</label>
            <select name="jahrgang" defaultValue={jahrgang ?? ''} className={inputCls}>
              <option value="">– alle –</option>
              {jahrgangOptionen.map(j => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Sorte</label>
            <select name="sorte" defaultValue={sorte ?? ''} className={inputCls}>
              <option value="">– alle –</option>
              {sorteOptionen.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Bezeichnung</label>
            <select name="bezeichnung" defaultValue={bezeichnung ?? ''} className={inputCls}>
              <option value="">– alle –</option>
              {bezeichnungOptionen.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3 flex items-center gap-3">
            <button type="submit"
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              Filtern
            </button>
            {filterAktiv && (
              <Link href="/kellerbuch/rueckverfolgung" className="text-sm text-s112-muted hover:text-s112-blue-700 transition-colors">
                Filter zurücksetzen
              </Link>
            )}
          </div>
        </form>
      </div>

      {/* Trefferliste */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-s112-text text-sm">
              Füllungen{filterAktiv ? ' (gefiltert)' : ''}
            </h2>
            <p className="text-xs text-s112-muted mt-0.5">
              {trefferliste.length} {trefferliste.length === 1 ? 'Treffer' : 'Treffer'}
              {oLagerbestandFlaschen != null && (
                <> · Ø Lagerbestand: <strong className="text-s112-text-1">{fmtNum(oLagerbestandFlaschen, { max: 1 })} Fl.</strong></>
              )}
            </p>
          </div>
          {trefferliste.length > 0 && (
            <div className="flex items-center gap-2 print:hidden">
              <RueckverfolgungPrintButton />
              <RueckverfolgungCsvExportButton treffer={trefferliste} />
            </div>
          )}
        </div>

        {trefferliste.length === 0 ? (
          <p className="text-sm text-s112-muted italic">Keine Füllungen für diese Auswahl gefunden.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-s112-text-2">Produktname</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-s112-text-2">Bezeichnung</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-s112-text-2">Jahrgang</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-s112-text-2">Sorte</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-s112-text-2">Chargennr.</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-s112-text-2">Bestand</th>
                  <th className="px-3 py-2 print:hidden" />
                </tr>
              </thead>
              <tbody>
                {trefferliste.map((f: R, i: number) => (
                  <tr key={f.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''} ${!f.aktiv ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 font-medium text-s112-text">{f.name}</td>
                    <td className="px-3 py-2 text-s112-text-2">{f.bezeichnung ?? '–'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-s112-text-2">{f.jahrgang ?? '–'}</td>
                    <td className="px-3 py-2 text-s112-text-2">{formatRebsorteMitKuerzel(f.rebsorte)}</td>
                    <td className="px-3 py-2 text-s112-text-2 text-xs font-mono">{f.chargennummer ?? '–'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-s112-blue-700 font-medium">
                      {fmtNum((parseInt(f.bestand_flaschen) || 0))} Fl.
                    </td>
                    <td className="px-3 py-2 text-right print:hidden">
                      <Link href={`/kellerbuch/rueckverfolgung?fuellung_id=${f.id}`}
                        className="text-xs text-s112-blue-700 border border-s112-teal/30 rounded-full px-2.5 py-1 hover:bg-s112-teal hover:text-white transition-colors whitespace-nowrap">
                        Details →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Suchfeld: direkter Sprung per Chargen-/Prüfnummer */}
      <div className="card p-5 space-y-3 print:hidden">
        <h2 className="font-semibold text-s112-text text-sm">Oder direkt nach Chargennummer / Prüfnummer suchen</h2>
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
        <div className="mt-3 bg-s112-warn-bg border border-s112-warn/30 rounded-xl p-4 text-sm text-s112-warn-fg">
          {suchFehler}
        </div>
      )}
      </div>

    </div>
  )
}
