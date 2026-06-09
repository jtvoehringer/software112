import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const metadata: Metadata = { title: 'Bewegungsbuch – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const TYP_ICONS: Record<string, string> = {
  stahltank: '🪣', holzfass: '🪵', betonei: '⚪', amphore: '🏺', sonstiges: '📦',
}

const ART_ICON: Record<string, string> = {
  pressung:  '🍇',
  umzug_ein: '⬇️',
  umzug_aus: '⬆️',
  abfuellung:'🍾',
  verkauf:   '💰',
}

type Bewegung = {
  datum: string
  art: 'pressung' | 'umzug_ein' | 'umzug_aus' | 'abfuellung' | 'verkauf'
  beschreibung: string
  menge: number
  extra?: string
}

export default async function BehaelterBewegungsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  // Behälter info
  const { data: bhRow } = await (supabase.from('behaelter') as any)
    .select('id, name, typ, volumen_liter, standort')
    .eq('id', id)
    .single()

  if (!bhRow) notFound()
  const bh = bhRow as R

  // Parallel-Queries: Pressungen + eingehende Umzüge + Chargen
  const [
    { data: pressungenRaw },
    { data: umzuegeEinRaw },
    { data: chargenRaw },
  ] = await Promise.all([
    // Pressungen für diesen Behälter – via behaelter_id (korrekte Verknüpfung!)
    (supabase.from('pressung_behaelter') as any)
      .select('id, menge_liter, weinausbau_id, notizen, pressung:pressung_id(id, datum, notizen)')
      .eq('behaelter_id', id)
      .order('id', { ascending: true }),

    // Eingehende Umzüge – inkl. schwund_liter für Netto-Berechnung
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, schwund_liter, nach_weinausbau_id, von_weinausbau:von_weinausbau_id(name, jahrgang, behaelter:behaelter_id(name)), notizen')
      .eq('nach_behaelter_id', id)
      .order('datum', { ascending: true }),

    // Alle Chargen in diesem Behälter (aktiv + inaktiv, die noch zugewiesen sind)
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, menge_liter, aktiv')
      .eq('behaelter_id', id)
      .order('id', { ascending: true }),
  ])

  // Charge-IDs sammeln aus 3 Quellen:
  // 1. Direkt zugewiesene Chargen (behaelter_id = id)
  // 2. Via eingehende Umzüge (nach_weinausbau_id)
  // 3. Via Pressungen verknüpfte Chargen (pressung_behaelter.weinausbau_id)
  //    → deckt den Fall ab wenn Charge nach vollständigem Umzug behaelter_id=null hat
  const chargeIds = new Set<string>()
  for (const c of (chargenRaw ?? []) as R[]) chargeIds.add(c.id)
  for (const u of (umzuegeEinRaw ?? []) as R[]) {
    if (u.nach_weinausbau_id) chargeIds.add(u.nach_weinausbau_id)
  }
  for (const p of (pressungenRaw ?? []) as R[]) {
    if (p.weinausbau_id) chargeIds.add(p.weinausbau_id)
  }
  const chargeIdList = Array.from(chargeIds)

  // Abgangs-Queries (nur wenn Chargen vorhanden)
  const [
    { data: umzuegeAusRaw },
    { data: fuellungenRaw },
    { data: verkaufRaw },
  ] = chargeIdList.length > 0
    ? await Promise.all([
        (supabase.from('keller_umzuege') as any)
          .select('id, datum, menge_liter, schwund_liter, nach_behaelter:nach_behaelter_id(name), von_weinausbau:von_weinausbau_id(name), notizen')
          .in('von_weinausbau_id', chargeIdList)
          .order('datum', { ascending: true }),
        (supabase.from('fuellungen') as any)
          .select('id, datum, name, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml, pruefnummer')
          .in('weinausbau_id', chargeIdList)
          .order('datum', { ascending: true }),
        (supabase.from('verkauf_positionen') as any)
          .select('id, menge, einheit, verkaufsposten:verkaufsposten_id(datum, storniert)')
          .in('weinausbau_id', chargeIdList)
          .eq('typ', 'tank')
          .order('id', { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]

  // ── Bewegungen aufbauen ──────────────────────────────────────────────────────
  const bewegungen: Bewegung[] = []

  // Pressungen / Ernte (Zugänge)
  for (const p of (pressungenRaw ?? []) as R[]) {
    const liter = parseFloat(p.menge_liter) || 0
    if (liter <= 0) continue
    const press = p.pressung as R | null
    bewegungen.push({
      datum: press?.datum ?? '',
      art: 'pressung',
      beschreibung: `Ernte / Pressung${press?.notizen ? ` – ${press.notizen}` : ''}`,
      menge: liter,
      extra: p.notizen ?? undefined,
    })
  }

  // Eingehende Umzüge (Zugänge) – Nettomenge = brutto − Schwund
  for (const u of (umzuegeEinRaw ?? []) as R[]) {
    const brutto  = parseFloat(u.menge_liter)  || 0
    const schwund = parseFloat(u.schwund_liter) || 0
    const liter   = Math.max(0, +(brutto - schwund).toFixed(3))   // netto
    if (liter <= 0 && brutto <= 0) continue
    const vonCharge = u.von_weinausbau as R | null
    const vonTank   = (vonCharge?.behaelter as R | null)?.name ?? null
    const vonName   = vonCharge?.name ?? '?'
    bewegungen.push({
      datum: u.datum,
      art: 'umzug_ein',
      beschreibung: `Umzug von ${vonTank ?? vonName}${vonTank ? ` (${vonName})` : ''}`,
      menge: liter,
      extra: schwund > 0
        ? `Schwund: ${schwund.toLocaleString('de-AT')} L${u.notizen ? ` · ${u.notizen}` : ''}`
        : (u.notizen ?? undefined),
    })
  }

  // Ausgehende Umzüge (Abgänge) – Schwund ist KEIN zusätzlicher Abgang
  // (Quelle verliert genau menge_liter; der Schwund erklärt die Differenz zum Ziel)
  for (const u of (umzuegeAusRaw ?? []) as R[]) {
    const abgang  = parseFloat(u.menge_liter) || 0
    const schwund = parseFloat(u.schwund_liter) || 0
    if (abgang <= 0) continue
    const nachTank  = (u.nach_behaelter as R | null)?.name ?? '?'
    const vonCharge = u.von_weinausbau as R | null
    bewegungen.push({
      datum: u.datum,
      art: 'umzug_aus',
      beschreibung: `Umzug nach ${nachTank}${schwund > 0 ? ` · Schwund: ${schwund.toLocaleString('de-AT')} L` : ''}`,
      menge: -abgang,   // Quelle verliert exakt abgang; Schwund nicht doppelt zählen
      extra: vonCharge?.name
        ? `aus Charge: ${vonCharge.name}${u.notizen ? ` · ${u.notizen}` : ''}`
        : (u.notizen ?? undefined),
    })
  }

  // Abfüllungen (Abgänge)
  for (const f of (fuellungenRaw ?? []) as R[]) {
    const liter = parseFloat(f.menge_liter_gefuellt)
      || (parseInt(f.anzahl_flaschen) * parseInt(f.flaschengroesse_ml) / 1000)
    if (!liter || isNaN(liter) || liter <= 0) continue
    bewegungen.push({
      datum: f.datum,
      art: 'abfuellung',
      beschreibung: `Abfüllung: ${f.name}${f.pruefnummer ? ` · Prüfnr. ${f.pruefnummer}` : ''}`,
      menge: -liter,
      extra: `${parseInt(f.anzahl_flaschen).toLocaleString('de-AT')} Fl. à ${parseInt(f.flaschengroesse_ml)} ml`,
    })
  }

  // Tank-Verkäufe (Abgänge)
  for (const v of (verkaufRaw ?? []) as R[]) {
    const vp = v.verkaufsposten as R | null
    if (vp?.storniert) continue
    const liter = parseFloat(v.menge) || 0
    if (liter <= 0) continue
    bewegungen.push({
      datum: vp?.datum ?? '',
      art: 'verkauf',
      beschreibung: 'Tank-Verkauf',
      menge: -liter,
    })
  }

  // Nach Datum sortieren (leere Datums an den Anfang)
  bewegungen.sort((a, b) => a.datum.localeCompare(b.datum))

  // Laufenden Saldo berechnen (startet bei 0)
  let saldo = 0
  const bewegungenMitSaldo = bewegungen.map(bew => {
    saldo += bew.menge
    return { ...bew, saldo }
  })

  // Aktueller Bestand: finaler Saldo aus Bewegungsrechnung (Quelle der Wahrheit)
  // Fallback: DB-Summe der aktiven Chargen
  const finalSaldo = bewegungenMitSaldo.length > 0
    ? bewegungenMitSaldo[bewegungenMitSaldo.length - 1].saldo
    : 0
  const aktiveChargen = ((chargenRaw ?? []) as R[]).filter(c => c.aktiv)
  const aktuellDB = aktiveChargen.reduce((s: number, c: R) => s + (parseFloat(c.menge_liter) || 0), 0)
  // Für Anzeige: Saldo aus Bewegungen (stimmt auch wenn charge.behaelter_id=null nach Umzug)
  const aktuell = finalSaldo > 0 ? finalSaldo : aktuellDB

  const kapazitaet = bh.volumen_liter ? parseFloat(bh.volumen_liter) : null
  const auslastung = kapazitaet && kapazitaet > 0 ? Math.min(100, (aktuell / kapazitaet) * 100) : null

  return (
    <div className="max-w-4xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{bh.name}</span>
        <span>/</span>
        <span className="text-gray-500">Bewegungsbuch</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <span className="text-3xl mt-0.5">{TYP_ICONS[bh.typ] ?? '📦'}</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{bh.name}</h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-s112-muted">
              {bh.standort && <span>{bh.standort}</span>}
              {kapazitaet && <span>{kapazitaet.toLocaleString('de-AT')} L Kapazität</span>}
            </div>
            {auslastung !== null && (
              <div className="mt-2 flex items-center gap-2">
                <div className="w-36 bg-gray-200 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${auslastung > 90 ? 'bg-amber-500' : 'bg-s112-teal'}`}
                    style={{ width: `${auslastung}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-gray-600">
                  {aktuell.toLocaleString('de-AT')} / {kapazitaet!.toLocaleString('de-AT')} L
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {writeOk && (
            <>
              <Link href="/kellerbuch/umziehen"
                className="text-xs border border-s112-teal text-s112-teal px-3 py-1.5 rounded-lg hover:bg-s112-teal/5 font-medium">
                ↔️ Umziehen
              </Link>
              <Link href={`/kellerbuch/behaelter/${id}`}
                className="text-xs text-s112-muted border border-gray-200 px-3 py-1.5 rounded-lg hover:border-s112-teal hover:text-s112-teal">
                Bearbeiten
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Aktuelle Chargen */}
      {aktiveChargen.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Aktuelle Chargen</h2>
          <div className="flex flex-wrap gap-2">
            {aktiveChargen.map((c: R) => (
              <Link key={c.id} href={`/kellerbuch/weinausbau/${c.id}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-s112-border bg-white hover:border-s112-teal hover:shadow-sm transition-all text-sm">
                <span className="font-medium text-gray-800">{c.name}</span>
                {c.jahrgang && <span className="text-xs text-s112-muted">{c.jahrgang}</span>}
                <span className="text-xs font-semibold text-s112-teal tabular-nums">
                  {(parseFloat(c.menge_liter) || 0).toLocaleString('de-AT')} L
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Bewegungsbuch */}
      <section>
        <h2 className="font-semibold text-gray-800 mb-3">Bewegungsbuch</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Vorgang</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Menge</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {bewegungenMitSaldo.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-s112-muted italic">
                    Noch keine Bewegungen für diesen Behälter erfasst
                  </td>
                </tr>
              ) : (
                bewegungenMitSaldo.map((bew, i) => {
                  const istAbgang    = bew.menge < 0
                  const istZugang    = bew.menge > 0
                  const colorClass   = istAbgang ? 'text-red-600' : istZugang ? 'text-green-600' : 'text-gray-500'
                  const isZugangsRow = bew.art === 'pressung' || bew.art === 'umzug_ein'
                  const rowBg        = isZugangsRow ? 'bg-green-50/50' : (i % 2 === 1 ? 'bg-s112-bg/30' : '')
                  return (
                    <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${rowBg}`}>
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                        {bew.datum ? new Date(bew.datum).toLocaleDateString('de-AT') : '–'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-start gap-1.5">
                          <span>{ART_ICON[bew.art] ?? '•'}</span>
                          <div>
                            <p className="text-gray-700">{bew.beschreibung}</p>
                            {bew.extra && <p className="text-xs text-s112-muted">{bew.extra}</p>}
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${colorClass}`}>
                        {istAbgang ? '' : '+'}{bew.menge.toLocaleString('de-AT')} L
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                        {bew.saldo.toLocaleString('de-AT')} L
                      </td>
                    </tr>
                  )
                })
              )}

              {/* Schluss-Zeile */}
              <tr className="border-t-2 border-s112-teal/30 bg-s112-teal/5">
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-gray-700 text-sm">
                  Aktueller Bestand
                </td>
                <td className="px-4 py-2.5 text-right" />
                <td className="px-4 py-2.5 text-right tabular-nums font-bold text-s112-teal text-base">
                  {aktuell.toLocaleString('de-AT')} L
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
