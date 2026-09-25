// behoerdenmeldung: rueckverfolgung
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Boxes, ArrowLeftRight, Filter, Microscope, Leaf, Wine, Search, GitMerge } from 'lucide-react'
import { resolveBlendKompositionFuellung, type KompositionUrsprung } from '@/lib/wein/blendKomposition'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import RueckverfolgungPrintButton from './PrintButton'
import RueckverfolgungCsvExportButton from './CsvExportButton'
import { fmtNum } from '@/lib/format'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import {
  BEHANDLUNG_ART_LABEL, ladeFuellungKette, ladeRueckverfolgungTreffer, massnahmeMittel, massnahmeZeitraum,
  type LeseMassnahmen,
} from '@/lib/behoerden/rueckverfolgung'
import { fensterBeginnText, ttmmjjjj } from '@/lib/behoerden/rueckverfolgungFenster'

export const metadata: Metadata = { title: 'Rückverfolgung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

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

// ── Sub-Komponente: eine Charge mit allen Kettendaten ────────────────────────
function ChargeKette({
  weinausbau,
  pressungen,
  lesen,
  analysen,
  umzuege,
  anteilLiter,
  chargeNr,
  total,
}: {
  weinausbau: R | null
  pressungen: R[]
  lesen: LeseMassnahmen[]
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

      {/* Maßnahmen je Lese: nur das gelesene Grundstück, nur bis zum Lesedatum (KAN-75).
          Dieselbe Zuordnung wie die CSV „rueckverfolgung“ (Kette.lesen aus ladeChargeKette). */}
      {lesen.length > 0 && (
        <Section title="Maßnahmen im Weingarten bis zur Lese" icon={<Leaf className="w-4 h-4" />}>
          <p className="text-xs text-s112-muted">
            Je Lese die Maßnahmen des gelesenen Grundstücks ab 01.01. des Jahrgangs bis einschließlich zum
            Lesedatum – auch bei mehreren Lesen am selben Grundstück (z. B. Hauptlese und Eiswein), denn die
            Trauben der späteren Lese hingen die ganze Saison am Stock.
          </p>
          {lesen.map((l, i) => {
            const w = l.lese.weingarten as R | null
            const g = l.lese.grundstueck as R | null
            const ohneGst = !l.lese.grundstueck_id
            return (
              <div key={l.leseId} className={`space-y-2 ${i > 0 ? 'pt-3 border-t border-s112-border/60' : ''}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="text-sm font-medium text-s112-text">
                    {w?.name ?? 'Weingarten unbekannt'}{g?.gst_nr ? ` · GST ${g.gst_nr}` : ''}
                  </span>
                  <span className="text-xs text-s112-muted tabular-nums">
                    Lese {l.lese.ernte_datum ? ttmmjjjj(String(l.lese.ernte_datum).slice(0, 10))
                      : l.fenster?.bisAus === 'erntemeldung' ? `${ttmmjjjj(l.fenster.bis)} (laut Erntemeldung)` : '–'}
                  </span>
                  <span className="text-xs text-s112-muted ml-auto">
                    {l.massnahmen.length} {l.massnahmen.length === 1 ? 'Maßnahme' : 'Maßnahmen'}
                  </span>
                </div>
                {l.fenster && (
                  <div className="text-xs text-s112-muted">
                    Zeitfenster {ttmmjjjj(l.fenster.von)} – {ttmmjjjj(l.fenster.bis)} ({fensterBeginnText(l.fenster)})
                  </div>
                )}
                {l.hinweise.length > 0 && (
                  <div className="text-xs bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-lg px-3 py-1.5">
                    {l.hinweise.join(' ')}
                  </div>
                )}
                {l.massnahmen.length === 0 ? (
                  <p className="text-xs text-s112-muted italic">Keine Maßnahmen im Zeitfenster erfasst.</p>
                ) : (
                  <div className="ml-4 space-y-2">
                    {l.massnahmen.map(m => {
                      const b = m.behandlung
                      const art = BEHANDLUNG_ART_LABEL[b.art] ?? b.art
                      const details = [
                        m.nurWeingarten ? 'nur am Weingarten erfasst (ohne Grundstück)' : ohneGst ? `GST ${m.grundstuecke.join(', ')}` : null,
                        b.aufwandmenge ? `${b.aufwandmenge} ${b.aufwandmenge_einheit ?? ''}`.trim() : null,
                        m.flaecheHa ? `${fmtNum(m.flaecheHa)} ha` : null,
                      ].filter(Boolean).join(' · ')
                      return (
                        <div key={b.id} className="flex items-start gap-3 text-sm border-b border-s112-border/30 last:border-0 pb-2 last:pb-0">
                          <span className="text-xs text-s112-muted tabular-nums w-40 shrink-0 pt-0.5">{massnahmeZeitraum(b)}</span>
                          <div className="flex-1">
                            <span className="font-medium text-s112-text">{massnahmeMittel(b)}</span>
                            {art && (b.psm as R | null)?.name && <span className="text-xs text-s112-muted ml-1">({art})</span>}
                            {details && <div className="text-xs text-s112-muted">{details}</div>}
                            {b.schaderreger && <div className="text-xs text-s112-muted">Grund: {b.schaderreger}</div>}
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

  // Dieselbe Ladefunktion wie die CSV „rueckverfolgung“ (alle Treffer) – ohne 1.000er-Deckel
  const jahrgangZahl = jahrgang && /^\d{4}$/.test(jahrgang.trim()) ? Number(jahrgang.trim()) : null
  const trefferFilter = { jahrgang: jahrgangZahl, sorte: sorte?.trim() || null, bezeichnung: bezeichnung?.trim() || null }
  const trefferliste: R[] = tenantId ? await ladeRueckverfolgungTreffer(supabase, tenantId, trefferFilter) : []

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
  // Dieselbe Ladefunktion wie die CSV „rueckverfolgung“ (lib/behoerden/rueckverfolgung.ts):
  // Junction → weinausbau_id → eindeutiger Treffer über Rebsorte + Jahrgang
  const chargeEntries = fuellung && tenantId
    ? (await ladeFuellungKette(supabase, tenantId, fuellung, { details: true })).chargen
    : []

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
            <div className="flex items-start gap-3 shrink-0">
              <RueckverfolgungPrintButton />
              <CsvExportKnopf label="Rückverfolgung als CSV" href={csvPfad('rueckverfolgung', { fuellung_id: fuellung.id })} />
              <Link href="/kellerbuch/rueckverfolgung" className="text-sm text-s112-blue-700 hover:underline py-1">← alle Füllungen</Link>
            </div>
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
                lesen={entry.kette.lesen}
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
            <select aria-label="Jahrgang" name="jahrgang" defaultValue={jahrgang ?? ''} className={inputCls}>
              <option value="">– alle –</option>
              {jahrgangOptionen.map(j => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Sorte</label>
            <select aria-label="Sorte" name="sorte" defaultValue={sorte ?? ''} className={inputCls}>
              <option value="">– alle –</option>
              {sorteOptionen.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Bezeichnung</label>
            <select aria-label="Bezeichnung" name="bezeichnung" defaultValue={bezeichnung ?? ''} className={inputCls}>
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
            <div className="flex items-start gap-2 print:hidden">
              <RueckverfolgungPrintButton />
              <RueckverfolgungCsvExportButton treffer={trefferliste} filter={trefferFilter} />
              <CsvExportKnopf label="Rückverfolgung aller Treffer als CSV" href={csvPfad('rueckverfolgung', trefferFilter)} />
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
