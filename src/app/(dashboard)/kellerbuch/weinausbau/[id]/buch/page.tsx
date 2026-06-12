import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const metadata: Metadata = { title: 'Weinbuch – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// ── Typen für Timeline-Events ─────────────────────────────────────────────────
type EventTyp =
  | 'feldbehandlung'
  | 'ernte'
  | 'pressung'
  | 'umzug'
  | 'kellerbehandlung'
  | 'analyse'
  | 'dac'
  | 'fuellung'

interface TimelineEvent {
  datum: string        // ISO date string zum Sortieren
  typ: EventTyp
  titel: string
  details: string[]
  badge?: string
}

// ── Hilfsfunktion: Datum formatieren ─────────────────────────────────────────
function fmtDate(d: string | null | undefined) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Icon + Farbe je Event-Typ ────────────────────────────────────────────────
const EVENT_STYLE: Record<EventTyp, { icon: string; dot: string; card: string }> = {
  feldbehandlung: { icon: '🌿', dot: 'bg-green-500',   card: 'border-green-100  bg-green-50/40'  },
  ernte:          { icon: '🍇', dot: 'bg-purple-500',  card: 'border-purple-100 bg-purple-50/40' },
  pressung:       { icon: '⚙️', dot: 'bg-orange-400',  card: 'border-orange-100 bg-orange-50/40' },
  umzug:          { icon: '🔄', dot: 'bg-blue-400',    card: 'border-blue-100   bg-blue-50/40'   },
  kellerbehandlung:{ icon: '🧪', dot: 'bg-teal-500',   card: 'border-teal-100   bg-teal-50/40'   },
  analyse:        { icon: '🔬', dot: 'bg-indigo-400',  card: 'border-indigo-100 bg-indigo-50/40' },
  dac:            { icon: '🏅', dot: 'bg-yellow-500',  card: 'border-yellow-100 bg-yellow-50/40' },
  fuellung:       { icon: '🍾', dot: 'bg-s112-teal',   card: 'border-s112-teal/20 bg-s112-teal/5'},
}

export default async function WeinbuchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  // ── 1. Weinausbau-Charge laden ────────────────────────────────────────────
  const { data: waRaw, error: waErr } = await (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, qualitaet, status, menge_liter, behaelter:behaelter_id(name)')
    .eq('id', id)
    .maybeSingle()

  if (waErr || !waRaw) {
    return (
      <div className="max-w-xl p-8 space-y-3">
        <h1 className="text-xl font-bold text-red-600">Weinbuch – Charge nicht geladen</h1>
        <p className="text-sm text-gray-700">ID: <code className="font-mono bg-gray-100 px-1">{id}</code></p>
        <p className="text-sm text-red-500">{waErr?.message ?? 'Keine Daten zurückgegeben'}</p>
        <p className="text-xs text-gray-500">Route funktioniert – Problem liegt beim Supabase-Query.</p>
      </div>
    )
  }
  const wa = waRaw as R

  // ── 2. Alle Daten parallel laden ─────────────────────────────────────────
  const [
    prRes,      // Pressungen → Weingärten
    umRes,      // Umzüge
    kbRes,      // Kellerbehandlungen
    anRes,      // Analysen
    dacRes,     // DAC-Anträge
    fuellRes,   // Füllungen via fuellung_chargen
  ] = await Promise.all([
    // Pressungen + Weingärten + Grundstücke
    (supabase.from('pressung_behaelter') as any)
      .select(`
        menge_liter,
        pressung:pressung_id(
          id, datum, most_liter_gesamt, weinbezeichnung,
          pressung_weingaerten(
            trauben_kg, rebsorte, ernte_datum, kmw,
            weingarten:weingarten_id(
              id, name, flaeche_ha,
              grundstueck:grundstueck_id(name, katastralgemeinde, grundstuecksnummer)
            )
          )
        )
      `)
      .eq('weinausbau_id', id),

    // Umzüge aus dieser Charge
    (supabase.from('keller_umzuege') as any)
      .select(`
        datum, menge_liter, brutto_liter, schwund_liter, zeilen_typ, umzug_batch_id,
        von_behaelter:von_behaelter_id(name),
        nach_behaelter:nach_behaelter_id(name)
      `)
      .eq('von_weinausbau_id', id)
      .order('datum', { ascending: true }),

    // Kellerbehandlungen: direkt via weinausbau_id ODER via Behälter-History
    (supabase.from('keller_behandlungen') as any)
      .select('datum, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name)')
      .eq('weinausbau_id', id)
      .order('datum', { ascending: true }),

    // Analysen
    (supabase.from('analysen') as any)
      .select('datum, parameter, wert, einheit, labor')
      .eq('weinausbau_id', id)
      .order('datum', { ascending: true }),

    // DAC-Antrag
    (supabase.from('dac_antrag') as any)
      .select('id, bezeichnung, dac_region, status, pruefnummer, eingereicht_am, bescheid_am')
      .eq('weinausbau_id', id)
      .order('created_at', { ascending: true }),

    // Füllungen via fuellung_chargen
    (supabase.from('fuellung_chargen') as any)
      .select(`
        anteil_liter,
        fuellung:fuellung_id(
          id, datum, chargennummer, pruefnummer, name,
          anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt
        )
      `)
      .eq('weinausbau_id', id),
  ])

  const pressungen    = (prRes.data ?? []) as R[]
  const umzuegeRaw    = (umRes.data ?? []) as R[]
  const kellerBeh     = (kbRes.data ?? []) as R[]
  const analysen      = (anRes.data ?? []) as R[]
  const dacAntraege   = (dacRes.data ?? []) as R[]
  const fuellChargen  = (fuellRes.data ?? []) as R[]

  // Umzüge: Ziel-Behälter via Batch-Lookup ergänzen
  const batchIds = [...new Set(
    umzuegeRaw.filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id)
  )] as string[]
  const zielByBatch: Record<string, R> = {}
  if (batchIds.length > 0) {
    const { data: zielRows } = await (supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name)')
      .in('umzug_batch_id', batchIds)
      .eq('zeilen_typ', 'ziel')
    for (const z of ((zielRows ?? []) as R[])) {
      if (!zielByBatch[z.umzug_batch_id]) zielByBatch[z.umzug_batch_id] = z
    }
  }
  const umzuege = umzuegeRaw.map(u => {
    if (u.zeilen_typ === 'quelle' && u.umzug_batch_id && zielByBatch[u.umzug_batch_id]) {
      return { ...u, nach_behaelter: zielByBatch[u.umzug_batch_id].nach_behaelter }
    }
    return u
  })

  // Feldbehandlungen: aus Grundstücken der verknüpften Weingärten laden
  // Schritt 1: Grundstück-IDs aus Pressungen sammeln
  const grundstueckIds = new Set<string>()
  const ernteDaten: Array<{ datum: string; details: string[] }> = []

  for (const pb of pressungen) {
    const p = pb.pressung as R | null
    if (!p) continue
    for (const wg of ((p.pressung_weingaerten ?? []) as R[])) {
      const w = wg.weingarten as R | null
      const g = w?.grundstueck as R | null
      if (g?.id ?? w?.grundstueck_id) {
        const gid = g?.id
        if (gid) grundstueckIds.add(gid)
      }
      // Ernte-Events sammeln
      if (wg.ernte_datum) {
        const details: string[] = []
        if (w?.name) details.push(`Weingarten: ${w.name}`)
        if (wg.trauben_kg) details.push(`${parseFloat(wg.trauben_kg).toLocaleString('de-AT')} kg`)
        if (wg.kmw) details.push(`${wg.kmw} °KMW`)
        if (wg.rebsorte) details.push(wg.rebsorte)
        if (g?.katastralgemeinde) details.push(g.katastralgemeinde)
        ernteDaten.push({ datum: wg.ernte_datum, details })
      }
    }
  }

  // Schritt 2: Feldbehandlungen für diese Grundstücke laden (vor Ernte)
  let feldbehandlungen: R[] = []
  if (grundstueckIds.size > 0) {
    const fruehestesErnteDatum = ernteDaten.length > 0
      ? ernteDaten.map(e => e.datum).sort()[0]
      : null
    let query = (supabase.from('behandlungen') as any)
      .select(`
        id, datum, art, mittel, aufwandmenge, aufwandmenge_einheit, bbch_stadium,
        grundstueck:weingarten_id(name),
        behandlung_grundstuecke(grundstueck:grundstueck_id(name, katastralgemeinde))
      `)
      .in('weingarten_id',
        // Feldbehandlungen via weingarten → grundstueck filtern
        Array.from(grundstueckIds)
      )
      .order('datum', { ascending: true })
    if (fruehestesErnteDatum) query = query.lte('datum', fruehestesErnteDatum)
    // Alternativweg: über behandlung_grundstuecke
    const { data: fbRaw } = await (supabase.from('behandlungen') as any)
      .select(`
        id, datum, art, mittel, aufwandmenge, aufwandmenge_einheit, bbch_stadium, notizen,
        behandlung_grundstuecke!inner(grundstueck_id, grundstueck:grundstueck_id(id, name, katastralgemeinde))
      `)
      .in('behandlung_grundstuecke.grundstueck_id', Array.from(grundstueckIds))
      .order('datum', { ascending: true })
    feldbehandlungen = (fbRaw ?? []) as R[]
  }

  // ── 3. Timeline zusammenbauen ─────────────────────────────────────────────
  const events: TimelineEvent[] = []

  // Feldbehandlungen
  for (const b of feldbehandlungen) {
    const gst = ((b.behandlung_grundstuecke ?? []) as R[])
      .map((bg: R) => (bg.grundstueck as R | null)?.name)
      .filter(Boolean).join(', ')
    events.push({
      datum: b.datum,
      typ: 'feldbehandlung',
      titel: b.mittel ?? b.art ?? 'Behandlung',
      details: [
        b.art && `Art: ${b.art}`,
        b.aufwandmenge && `${b.aufwandmenge} ${b.aufwandmenge_einheit ?? ''}`,
        b.bbch_stadium && `BBCH ${b.bbch_stadium}`,
        gst && `Grundstück: ${gst}`,
        b.notizen,
      ].filter(Boolean) as string[],
    })
  }

  // Ernte-Events (aus pressung_weingaerten)
  for (const e of ernteDaten) {
    events.push({
      datum: e.datum,
      typ: 'ernte',
      titel: 'Lese',
      details: e.details,
    })
  }

  // Pressungen
  for (const pb of pressungen) {
    const p = pb.pressung as R | null
    if (!p || !p.datum) continue
    const wgListe = (p.pressung_weingaerten ?? []) as R[]
    const weingaertenText = wgListe
      .map((wg: R) => (wg.weingarten as R | null)?.name)
      .filter(Boolean).join(', ')
    events.push({
      datum: p.datum,
      typ: 'pressung',
      titel: p.weinbezeichnung ? `Pressung – ${p.weinbezeichnung}` : 'Pressung',
      details: [
        p.most_liter_gesamt && `${parseFloat(p.most_liter_gesamt).toLocaleString('de-AT')} L Most`,
        pb.menge_liter && `Anteil: ${parseFloat(pb.menge_liter).toLocaleString('de-AT')} L`,
        weingaertenText && `Weingärten: ${weingaertenText}`,
      ].filter(Boolean) as string[],
    })
  }

  // Umzüge
  for (const u of umzuege) {
    const von = (u.von_behaelter as R | null)?.name ?? '?'
    const nach = (u.nach_behaelter as R | null)?.name ?? '?'
    const liter = u.brutto_liter ?? u.menge_liter
    events.push({
      datum: u.datum,
      typ: 'umzug',
      titel: `${von} → ${nach}`,
      details: [
        liter && `${parseFloat(liter).toLocaleString('de-AT')} L`,
        u.schwund_liter && `Schwund: ${parseFloat(u.schwund_liter).toLocaleString('de-AT')} L`,
      ].filter(Boolean) as string[],
    })
  }

  // Kellerbehandlungen
  for (const kb of kellerBeh) {
    const typName = (kb.typ as R | null)?.name ?? kb.typ_name_snapshot ?? 'Kellerbehandlung'
    events.push({
      datum: kb.datum,
      typ: 'kellerbehandlung',
      titel: typName,
      details: [
        kb.menge != null && kb.einheit ? `${parseFloat(kb.menge).toLocaleString('de-AT')} ${kb.einheit}` : null,
        kb.volumen_liter_ist ? `Volumen Ist: ${parseFloat(kb.volumen_liter_ist).toLocaleString('de-AT')} L` : null,
        kb.notizen,
      ].filter(Boolean) as string[],
    })
  }

  // Analysen – gruppiert nach Datum als ein Event
  const analysenByDatum = new Map<string, R[]>()
  for (const a of analysen) {
    const existing = analysenByDatum.get(a.datum) ?? []
    existing.push(a)
    analysenByDatum.set(a.datum, existing)
  }
  for (const [datum, gruppe] of analysenByDatum) {
    events.push({
      datum,
      typ: 'analyse',
      titel: gruppe.length === 1 ? gruppe[0].parameter : `${gruppe.length} Analysewerte`,
      details: gruppe.map((a: R) => `${a.parameter}: ${a.wert} ${a.einheit ?? ''}${a.labor ? ` (${a.labor})` : ''}`),
    })
  }

  // DAC-Anträge
  for (const dac of dacAntraege) {
    const datum = dac.bescheid_am ?? dac.eingereicht_am ?? null
    if (!datum) continue
    events.push({
      datum,
      typ: 'dac',
      titel: dac.bezeichnung,
      badge: dac.status === 'genehmigt' ? '✅ Genehmigt' : dac.status === 'eingereicht' ? '📬 Eingereicht' : dac.status,
      details: [
        dac.pruefnummer && `Prüfnummer: ${dac.pruefnummer}`,
        dac.bescheid_am && `Bescheid: ${fmtDate(dac.bescheid_am)}`,
      ].filter(Boolean) as string[],
    })
  }

  // Füllungen
  for (const fc of fuellChargen) {
    const f = fc.fuellung as R | null
    if (!f || !f.datum) continue
    events.push({
      datum: f.datum,
      typ: 'fuellung',
      titel: f.name ?? 'Abfüllung',
      details: [
        f.chargennummer && `Charge: ${f.chargennummer}`,
        f.pruefnummer && `Prüfnr.: ${f.pruefnummer}`,
        f.anzahl_flaschen && f.flaschengroesse_ml
          ? `${parseInt(f.anzahl_flaschen).toLocaleString('de-AT')} × ${f.flaschengroesse_ml} ml`
          : null,
        f.menge_liter_gefuellt
          ? `${parseFloat(f.menge_liter_gefuellt).toLocaleString('de-AT')} L`
          : null,
        fc.anteil_liter
          ? `Anteil diese Charge: ${parseFloat(fc.anteil_liter).toLocaleString('de-AT')} L`
          : null,
      ].filter(Boolean) as string[],
    })
  }

  // Chronologisch sortieren
  events.sort((a, b) => a.datum.localeCompare(b.datum))

  return (
    <div className="max-w-3xl space-y-6">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted flex-wrap">
        <Link href="/kellerbuch" className="hover:text-s112-teal">Kellerbuch</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${id}`} className="hover:text-s112-teal">{wa.name}</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Weinbuch</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">📖 Weinbuch</h1>
        <p className="text-s112-muted text-sm mt-1">
          {wa.name}
          {wa.jahrgang ? ` · Jahrgang ${wa.jahrgang}` : ''}
          {wa.rebsorte ? ` · ${wa.rebsorte}` : ''}
        </p>
        <p className="text-xs text-s112-muted mt-0.5">
          Von der Rebe bis zur Flasche – vollständige Prozesshistorie dieser Charge
        </p>
      </div>

      {/* Timeline */}
      {events.length === 0 ? (
        <div className="card p-8 text-center text-s112-muted">
          <p className="text-3xl mb-3">📖</p>
          <p className="text-sm">Noch keine Ereignisse für diese Charge erfasst.</p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertikale Linie */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-s112-border/60" />

          <div className="space-y-4">
            {events.map((ev, i) => {
              const style = EVENT_STYLE[ev.typ]
              return (
                <div key={i} className="relative flex gap-4">
                  {/* Dot */}
                  <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-lg ${style.dot} shadow-sm`}>
                    <span>{style.icon}</span>
                  </div>

                  {/* Card */}
                  <div className={`flex-1 rounded-xl border p-4 ${style.card}`}>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-semibold text-gray-800 text-sm">{ev.titel}</p>
                        {ev.badge && (
                          <span className="inline-block text-xs font-medium text-gray-600 bg-white/70 border border-gray-200 rounded-full px-2 py-0.5 mt-0.5">
                            {ev.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 tabular-nums shrink-0">
                        {fmtDate(ev.datum)}
                      </span>
                    </div>
                    {ev.details.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {ev.details.map((d, j) => (
                          <li key={j} className="text-xs text-gray-600">{d}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Abschluss-Marker */}
            <div className="relative flex gap-4 items-center">
              <div className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-gray-200 text-gray-400 text-lg shadow-sm">
                ∎
              </div>
              <p className="text-xs text-s112-muted">Ende der Aufzeichnung</p>
            </div>
          </div>
        </div>
      )}

      {/* Legende */}
      <div className="card p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Legende</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(Object.entries(EVENT_STYLE) as [EventTyp, typeof EVENT_STYLE[EventTyp]][]).map(([typ, style]) => (
            <div key={typ} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
              <span className="text-xs text-gray-600">{style.icon} {
                typ === 'feldbehandlung' ? 'Feldbehandlung'
                : typ === 'ernte' ? 'Ernte / Lese'
                : typ === 'pressung' ? 'Pressung'
                : typ === 'umzug' ? 'Umzug'
                : typ === 'kellerbehandlung' ? 'Kellerbehandlung'
                : typ === 'analyse' ? 'Analyse'
                : typ === 'dac' ? 'DAC / Prüfnummer'
                : 'Füllung'
              }</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
