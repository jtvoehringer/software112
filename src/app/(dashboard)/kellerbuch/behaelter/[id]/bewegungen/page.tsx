import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { fmtLiter, fmtNum } from '@/lib/format'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { manuellSchwundBuchen } from '../../../actions'
import { Boxes, Droplet } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'

export const metadata: Metadata = { title: 'Bewegungsbuch – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

type Bewegung = {
  datum: string
  art: 'anfangsbestand' | 'zukauf' | 'pressung' | 'umzug_ein' | 'umzug_aus' | 'filtration_ein' | 'filtration_aus' | 'abfuellung' | 'verkauf' | 'behandlung' | 'verschneidung_ein' | 'verschneidung_aus' | 'schwund'
  beschreibung: string
  menge: number
  extra?: string
  fuellung_id?: string
}

export default async function BehaelterBewegungsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role)
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const { data: bhRow } = await tf((supabase.from('behaelter') as any)
    .select('id, name, typ, volumen_liter, standort')
    .eq('id', id))
    .single()

  if (!bhRow) notFound()
  const bh = bhRow as R

  const [
    { data: pressungenRaw },
    { data: umzuegeEinRaw },
    { data: chargenRaw },
    { data: umzuegeVonBehaelterRaw },
    { data: behandlungenRaw },
  ] = await Promise.all([
    (supabase.from('pressung_behaelter') as any)
      .select('id, menge_liter, weinausbau_id, notizen, pressung:pressung_id(id, datum, notizen)')
      .eq('behaelter_id', id)
      .order('id', { ascending: true }),
    tf((supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, nach_weinausbau_id, von_behaelter:von_behaelter_id(name), von_weinausbau:von_weinausbau_id(name, jahrgang, behaelter:behaelter_id(name)), notizen, umzug_batch_id, zeilen_typ')
      .eq('nach_behaelter_id', id)
      .order('datum', { ascending: true })),
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, menge_liter, aktiv, ist_eroeffnungsbestand, anfangsbestand_liter, created_at')
      .eq('behaelter_id', id)
      .order('id', { ascending: true })),
    tf((supabase.from('keller_umzuege') as any)
      .select('von_weinausbau_id')
      .eq('von_behaelter_id', id)),
    tf((supabase.from('keller_behandlungen') as any)
      .select('id, datum, menge, einheit, notizen, typ:typ_id(name)')
      .eq('behaelter_id', id)
      .order('datum', { ascending: true })),
  ])

  const chargeIds = new Set<string>()
  for (const c of (chargenRaw ?? []) as R[]) chargeIds.add(c.id)
  for (const u of (umzuegeEinRaw ?? []) as R[]) {
    if (u.nach_weinausbau_id) chargeIds.add(u.nach_weinausbau_id)
  }
  for (const p of (pressungenRaw ?? []) as R[]) {
    if (p.weinausbau_id) chargeIds.add(p.weinausbau_id)
  }
  for (const u of (umzuegeVonBehaelterRaw ?? []) as R[]) {
    if (u.von_weinausbau_id) chargeIds.add(u.von_weinausbau_id)
  }
  const chargeIdList = Array.from(chargeIds)

  const [
    { data: umzuegeAusRaw },
    { data: fuellungenRaw },
    { data: verkaufRaw },
    { data: zukaufRaw },
  ] = chargeIdList.length > 0
    ? await Promise.all([
        tf((supabase.from('keller_umzuege') as any)
          .select('id, datum, menge_liter, brutto_liter, schwund_liter, zeilen_typ, umzug_typ, nach_behaelter:nach_behaelter_id(name), von_weinausbau_id, von_weinausbau:von_weinausbau_id(name), notizen, umzug_batch_id')
          .in('von_weinausbau_id', chargeIdList)
          .order('datum', { ascending: true })),
        tf((supabase.from('fuellungen') as any)
          .select('id, datum, name, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml, pruefnummer, weinausbau_id')
          .in('weinausbau_id', chargeIdList)
          .eq('aktiv', true)
          .order('datum', { ascending: true })),
        tf((supabase.from('verkauf_positionen') as any)
          .select('id, menge, einheit, weinausbau_id, verkaufsposten:verkaufsposten_id(datum, storniert)')
          .in('weinausbau_id', chargeIdList)
          .eq('typ', 'tank')
          .order('id', { ascending: true })),
        // Zukauf-Eingang (Wein/Most direkt in dieses Gebinde gekauft) – fehlte bisher komplett in
        // diesem Bewegungsbuch, obwohl v_behaelter_fuellstand (Migration 127, siehe zukauf_ein-CTE)
        // ihn längst korrekt mitrechnet. Ohne diesen Zugang lief der hier lokal nachgerechnete Saldo
        // für jede Zukauf-basierte Charge sobald abgefüllt/verkauft wurde ins Negative und die Charge
        // verschwand fälschlich aus "Aktuelle Chargen" / "Aktueller Bestand".
        tf((supabase.from('zukauf_posten') as any)
          .select('id, datum, menge, ziel_weinausbau_id, rebsorte, jahrgang')
          .in('ziel_weinausbau_id', chargeIdList)
          .eq('aktiv', true)
          .in('art', ['wein', 'most'])
          .order('datum', { ascending: true })),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]

  const { data: verschnAusRaw } = chargeIdList.length > 0
    ? await (supabase.from('verschneidung_quellen') as any)
        .select('menge_liter, quell_weinausbau_id, verschneidung:verschneidung_id(datum, notizen, ziel:ziel_weinausbau_id(name, behaelter:behaelter_id(name)))')
        .in('quell_weinausbau_id', chargeIdList)
    : { data: [] }

  const { data: verschnEinRaw } = chargeIdList.length > 0
    ? await tf((supabase.from('verschneidungen') as any)
        .select('id, datum, notizen, ziel_weinausbau_id, quellen:verschneidung_quellen(menge_liter, quelle:quell_weinausbau_id(name, behaelter:behaelter_id(name)))')
        .in('ziel_weinausbau_id', chargeIdList)
        .order('datum', { ascending: true }))
    : { data: [] }

  const einZielBatchIds = [...new Set(
    ((umzuegeEinRaw ?? []) as R[]).filter(u => u.zeilen_typ === 'ziel' && u.umzug_batch_id).map(u => u.umzug_batch_id)
  )] as string[]
  const ausQuelleBatchIds = [...new Set(
    ((umzuegeAusRaw ?? []) as R[]).filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id)
  )] as string[]

  const quelleByBatch: Record<string, R[]> = {}
  const zielByBatch:   Record<string, R[]> = {}

  if (einZielBatchIds.length > 0) {
    const { data: quelleRows } = await tf((supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, von_behaelter:von_behaelter_id(name), von_weinausbau:von_weinausbau_id(name, behaelter:behaelter_id(name))')
      .in('umzug_batch_id', einZielBatchIds)
      .eq('zeilen_typ', 'quelle'))
    for (const q of ((quelleRows ?? []) as R[])) {
      if (!quelleByBatch[q.umzug_batch_id]) quelleByBatch[q.umzug_batch_id] = []
      quelleByBatch[q.umzug_batch_id].push(q)
    }
  }

  if (ausQuelleBatchIds.length > 0) {
    const { data: zielRows } = await tf((supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name), nach_weinausbau:nach_weinausbau_id(name), menge_liter')
      .in('umzug_batch_id', ausQuelleBatchIds)
      .eq('zeilen_typ', 'ziel'))
    for (const z of ((zielRows ?? []) as R[])) {
      if (!zielByBatch[z.umzug_batch_id]) zielByBatch[z.umzug_batch_id] = []
      zielByBatch[z.umzug_batch_id].push(z)
    }
  }

  const eroeffnungsCharge = ((chargenRaw ?? []) as R[]).find(c => c.ist_eroeffnungsbestand)
  const bewegungen: Bewegung[] = []

  if (eroeffnungsCharge) {
    const liter = parseFloat(eroeffnungsCharge.anfangsbestand_liter) || parseFloat(eroeffnungsCharge.menge_liter) || 0
    if (liter > 0) {
      const buchungsJahr = eroeffnungsCharge.created_at
        ? new Date(eroeffnungsCharge.created_at).getFullYear()
        : new Date().getFullYear()
      bewegungen.push({
        datum: `${buchungsJahr}-01-01`,
        art: 'anfangsbestand',
        beschreibung: `Anfangsbestand${eroeffnungsCharge.jahrgang ? ` ${eroeffnungsCharge.jahrgang}` : ''}`,
        menge: liter,
      })
    }
  }

  for (const z of (zukaufRaw ?? []) as R[]) {
    const liter = parseFloat(z.menge) || 0
    if (liter <= 0) continue
    bewegungen.push({
      datum: z.datum ?? '',
      art: 'zukauf',
      beschreibung: `Zukauf${[z.rebsorte ? formatRebsorteMitKuerzel(z.rebsorte) : null, z.jahrgang].filter(Boolean).join(' ') ? `: ${[z.rebsorte ? formatRebsorteMitKuerzel(z.rebsorte) : null, z.jahrgang].filter(Boolean).join(' ')}` : ''}`,
      menge: liter,
    })
  }

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

  for (const u of (umzuegeEinRaw ?? []) as R[]) {
    const rohmenge = parseFloat(u.menge_liter) || 0
    const schwund  = parseFloat(u.schwund_liter) || 0
    const liter    = u.brutto_liter != null
      ? rohmenge
      : Math.max(0, rohmenge - schwund)
    if (liter <= 0) continue

    let vonBeschreibung: string
    if (u.zeilen_typ === 'ziel' && u.umzug_batch_id && quelleByBatch[u.umzug_batch_id]) {
      const quelleRecs = quelleByBatch[u.umzug_batch_id]
      const quelleNames = quelleRecs.map((q: R) => {
        const wa         = q.von_weinausbau as R | null
        const waName     = wa?.name ?? null
        const tankFromWA = (wa?.behaelter as R | null)?.name ?? null
        const tankDirekt = (q.von_behaelter as R | null)?.name ?? null
        const tank       = tankFromWA ?? tankDirekt ?? null
        if (tank && waName) return `${tank} (${waName})`
        return tank ?? waName ?? '?'
      })
      vonBeschreibung = quelleNames.join(', ') || '?'
    } else {
      const vonCharge  = u.von_weinausbau as R | null
      const tankFromWA = (vonCharge?.behaelter as R | null)?.name ?? null
      const tankDirekt = (u.von_behaelter as R | null)?.name ?? null
      const vonTank    = tankFromWA ?? tankDirekt ?? null
      const vonName    = vonCharge?.name ?? '?'
      vonBeschreibung  = vonTank ? `${vonTank} (${vonName})` : vonName
    }

    const istFiltEin = u.umzug_typ === 'filtration'
    bewegungen.push({
      datum: u.datum,
      art: istFiltEin ? 'filtration_ein' : 'umzug_ein',
      beschreibung: istFiltEin
        ? `Filtration von ${vonBeschreibung}`
        : `Zugang von ${vonBeschreibung}`,
      menge: liter,
      extra: schwund > 0
        ? `Schwund: ${fmtNum(schwund)} L${u.notizen ? ` · ${u.notizen}` : ''}`
        : (u.notizen ?? undefined),
    })
  }

  for (const u of (umzuegeAusRaw ?? []) as R[]) {
    const netto  = parseFloat(u.menge_liter) || 0
    const abgang = u.zeilen_typ === 'quelle'
      ? netto
      : (parseFloat(u.brutto_liter) || netto)
    if (abgang <= 0) continue

    let nachBeschreibung: string
    let schwund = parseFloat(u.schwund_liter) || 0

    if (u.zeilen_typ === 'quelle' && u.umzug_batch_id && zielByBatch[u.umzug_batch_id]) {
      const zielRecs = zielByBatch[u.umzug_batch_id]
      const zielNames = zielRecs.map((z: R) => {
        const behName = (z.nach_behaelter as R | null)?.name ?? null
        const waName  = (z.nach_weinausbau as R | null)?.name ?? null
        return behName ?? waName ?? '?'
      })
      const sumNetto = zielRecs.reduce((s: number, z: R) => s + (parseFloat(z.menge_liter) || 0), 0)
      schwund = Math.max(0, abgang - sumNetto)
      nachBeschreibung = zielNames.join(', ') || '?'
    } else {
      nachBeschreibung = (u.nach_behaelter as R | null)?.name ?? '?'
    }

    const vonCharge  = u.von_weinausbau as R | null
    const istFiltAus = u.umzug_typ === 'filtration'
    const istSchwund = u.umzug_typ === 'schwund'
    bewegungen.push({
      datum: u.datum,
      art: istSchwund ? 'schwund' : istFiltAus ? 'filtration_aus' : 'umzug_aus',
      beschreibung: istSchwund
        ? `Schwund / Verlust${vonCharge?.name ? ` (${vonCharge.name})` : ''}`
        : istFiltAus
          ? `Filtration nach ${nachBeschreibung}${schwund > 0.01 ? ` · Schwund: ${fmtNum(schwund)} L` : ''}`
          : `Umzug nach ${nachBeschreibung}${schwund > 0.01 ? ` · Schwund: ${fmtNum(schwund)} L` : ''}`,
      menge: -abgang,
      extra: istSchwund
        ? undefined
        : vonCharge?.name
          ? `aus Charge: ${vonCharge.name}${u.notizen ? ` · ${u.notizen}` : ''}`
          : (u.notizen ?? undefined),
    })
  }

  for (const f of (fuellungenRaw ?? []) as R[]) {
    const liter = parseFloat(f.menge_liter_gefuellt)
      || (parseInt(f.anzahl_flaschen) * parseInt(f.flaschengroesse_ml) / 1000)
    if (!liter || isNaN(liter) || liter <= 0) continue
    bewegungen.push({
      datum: f.datum,
      art: 'abfuellung',
      beschreibung: `Abfuellung: ${f.name}${f.pruefnummer ? ` · Pruefnr. ${f.pruefnummer}` : ''}`,
      menge: -liter,
      extra: `${fmtNum(parseInt(f.anzahl_flaschen))} Fl. a ${parseInt(f.flaschengroesse_ml)} ml`,
      fuellung_id: f.id,
    })
  }

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

  for (const b of (behandlungenRaw ?? []) as R[]) {
    if (!b.datum) continue
    const typName  = (b.typ as R | null)?.name ?? 'Behandlung'
    const mengeStr = b.menge && b.einheit
      ? `${fmtNum(parseFloat(b.menge))} ${b.einheit}`
      : null
    bewegungen.push({
      datum: b.datum,
      art: 'behandlung',
      beschreibung: typName,
      menge: 0,
      extra: [mengeStr, b.notizen].filter(Boolean).join(' · ') || undefined,
    })
  }

  for (const vq of (verschnAusRaw ?? []) as R[]) {
    const liter = parseFloat(vq.menge_liter) || 0
    if (liter <= 0) continue
    const v = vq.verschneidung as R | null
    const ziel = (v?.ziel as R | null)
    const zielName = ziel?.name ?? '?'
    const zielBeh  = (ziel?.behaelter as R | null)?.name ?? null
    bewegungen.push({
      datum: v?.datum ?? '',
      art: 'verschneidung_aus',
      beschreibung: `Verschneidung nach ${zielName}`,
      menge: -liter,
      extra: zielBeh ?? undefined,
    })
  }

  for (const v of (verschnEinRaw ?? []) as R[]) {
    const quellen = (v.quellen as R[]) ?? []
    const gesamtLiter = quellen.reduce((s: number, q: R) => s + (parseFloat(q.menge_liter) || 0), 0)
    if (gesamtLiter <= 0) continue
    const quellenNames = quellen.map((q: R) => {
      const beh = (q.quelle as R | null)?.behaelter?.name ?? null
      const name = (q.quelle as R | null)?.name ?? '?'
      return beh ? `${beh} (${name})` : name
    }).join(', ')
    bewegungen.push({
      datum: v.datum ?? '',
      art: 'verschneidung_ein',
      beschreibung: `Verschneidung von ${quellenNames}`,
      menge: gesamtLiter,
    })
  }

  bewegungen.sort((a, b) => a.datum.localeCompare(b.datum))

  let saldo = 0
  const bewegungenMitSaldo = bewegungen.map(bew => {
    saldo += bew.menge
    return { ...bew, saldo }
  })

  const finalSaldo = bewegungenMitSaldo.length > 0
    ? bewegungenMitSaldo[bewegungenMitSaldo.length - 1].saldo
    : 0
  // Per-Charge event-basierter Saldo (korrigiert veraltetes menge_liter)
  const literByCharge: Record<string, number> = {}
  for (const z of (zukaufRaw ?? []) as R[]) {
    const zid = z.ziel_weinausbau_id
    if (!zid) continue
    literByCharge[zid] = (literByCharge[zid] ?? 0) + (parseFloat(z.menge) || 0)
  }
  for (const p of (pressungenRaw ?? []) as R[]) {
    if (!p.weinausbau_id) continue
    literByCharge[p.weinausbau_id] = (literByCharge[p.weinausbau_id] ?? 0) + (parseFloat(p.menge_liter) || 0)
  }
  for (const v of (verschnEinRaw ?? []) as R[]) {
    const tid = v.ziel_weinausbau_id
    if (!tid) continue
    const sum = ((v.quellen ?? []) as R[]).reduce((s: number, q: R) => s + (parseFloat(q.menge_liter) || 0), 0)
    literByCharge[tid] = (literByCharge[tid] ?? 0) + sum
  }
  for (const vq of (verschnAusRaw ?? []) as R[]) {
    const sid = vq.quell_weinausbau_id
    if (!sid) continue
    literByCharge[sid] = (literByCharge[sid] ?? 0) - (parseFloat(vq.menge_liter) || 0)
  }
  for (const u of (umzuegeEinRaw ?? []) as R[]) {
    const wid = u.nach_weinausbau_id
    if (!wid) continue
    const rohmenge = parseFloat(u.menge_liter) || 0
    const schwund  = parseFloat(u.schwund_liter) || 0
    const netto    = u.brutto_liter != null ? rohmenge : Math.max(0, rohmenge - schwund)
    literByCharge[wid] = (literByCharge[wid] ?? 0) + netto
  }
  for (const u of (umzuegeAusRaw ?? []) as R[]) {
    const wid = u.von_weinausbau_id
    if (!wid) continue
    const abgang = u.zeilen_typ === 'quelle' ? (parseFloat(u.menge_liter) || 0) : (parseFloat(u.brutto_liter) || parseFloat(u.menge_liter) || 0)
    literByCharge[wid] = (literByCharge[wid] ?? 0) - abgang
  }
  for (const f of (fuellungenRaw ?? []) as R[]) {
    const wid = f.weinausbau_id
    if (!wid) continue
    const liter = parseFloat(f.menge_liter_gefuellt) || (parseInt(f.anzahl_flaschen) * parseInt(f.flaschengroesse_ml) / 1000) || 0
    literByCharge[wid] = (literByCharge[wid] ?? 0) - liter
  }
  for (const v of (verkaufRaw ?? []) as R[]) {
    const wid = v.weinausbau_id
    if (!wid || (v.verkaufsposten as R | null)?.storniert) continue
    literByCharge[wid] = (literByCharge[wid] ?? 0) - (parseFloat(v.menge) || 0)
  }

  const aktiveChargen = ((chargenRaw ?? []) as R[]).filter(c => c.aktiv && !c.ist_eroeffnungsbestand && (literByCharge[c.id] ?? parseFloat(c.menge_liter) ?? 0) > 0.001)
  const aktuellDB = aktiveChargen.reduce((s: number, c: R) => s + (parseFloat(c.menge_liter) || 0), 0)
  const aktuell = finalSaldo > 0 ? finalSaldo : aktuellDB

  const kapazitaet = bh.volumen_liter ? parseFloat(bh.volumen_liter) : null
  const auslastung = kapazitaet && kapazitaet > 0 ? Math.min(100, (aktuell / kapazitaet) * 100) : null
  const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{bh.name}</span>
        <span>/</span>
        <span className="text-s112-text-2">Bewegungsbuch</span>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Boxes className="w-7 h-7 mt-0.5 text-s112-muted" />
          <div>
            <h1 className="text-2xl font-semibold text-s112-text">{bh.name}</h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-s112-muted">
              {bh.standort && <span>{bh.standort}</span>}
              {kapazitaet && <span>{fmtLiter(kapazitaet)} Kapazitaet</span>}
            </div>
            {aktuell < 0 && (
              <div className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-s112-err-bg border border-s112-err/30 rounded-lg text-s112-err-fg text-xs font-medium">
                Negativer Bestand: {fmtLiter(aktuell)} — Buchungsfehler pruefen
              </div>
            )}
            {auslastung !== null && (
              <div className="mt-2 flex items-center gap-2">
                <div className="w-36 bg-s112-line rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${aktuell < 0 ? 'bg-s112-err' : auslastung > 90 ? 'bg-s112-warn' : 'bg-s112-teal'}`}
                    style={{ width: `${Math.max(0, Math.min(100, auslastung))}%` }}
                  />
                </div>
                <span className={`text-xs tabular-nums ${aktuell < 0 ? 'text-s112-err-fg font-semibold' : 'text-s112-text-2'}`}>
                  {fmtLiter(aktuell)} / {fmtLiter(kapazitaet)}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {writeOk && (
            <>
              <Link href="/kellerbuch/umziehen"
                className="text-xs border border-s112-teal text-s112-blue-700 px-3 py-1.5 rounded-lg hover:bg-s112-teal/5 font-medium">
                Umziehen
              </Link>
              <Link href={`/kellerbuch/behaelter/${id}`}
                className="text-xs text-s112-muted border border-s112-line px-3 py-1.5 rounded-lg hover:border-s112-teal hover:text-s112-blue-700">
                Bearbeiten
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-s112-border">
        <span className="px-4 py-2 text-sm font-medium text-s112-blue-700 border-b-2 border-s112-teal -mb-px">
          Bewegungsbuch
        </span>
        <Link href={`/kellerbuch/behaelter/${id}/umzuege`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors">
          Umziehen
        </Link>
        <Link href={`/kellerbuch/behaelter/${id}/behandlungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors">
          Kellerbehandlungen
        </Link>
      </div>

      {aktiveChargen.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-s112-text-2 uppercase tracking-wide mb-2">Aktuelle Chargen</h2>
          <div className="flex flex-wrap gap-2">
            {aktiveChargen.map((c: R) => (
              <Link key={c.id} href={`/kellerbuch/weinausbau/${c.id}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-s112-border bg-white hover:border-s112-teal hover:shadow-sm transition-all text-sm">
                <span className="font-medium text-s112-text">{c.name}</span>
                {c.jahrgang && <span className="text-xs text-s112-muted">{c.jahrgang}</span>}
                <span className="text-xs font-semibold text-s112-blue-700 tabular-nums">
                  {fmtLiter(Math.max(0, literByCharge[c.id] ?? parseFloat(c.menge_liter) ?? 0))}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {writeOk && finalSaldo > 0.01 && (chargenRaw ?? []).length > 0 && (
        <section className="card p-5 border-s112-warn/30 bg-s112-warn-bg space-y-3">
          <div className="flex items-start gap-2">
            <Droplet className="w-5 h-5 text-s112-warn-fg shrink-0" />
            <div>
              <p className="text-sm font-semibold text-s112-warn-fg">Schwund ausbuchen</p>
              <p className="text-xs text-s112-warn-fg mt-0.5">
                Laut Bewegungsbuch sind noch{' '}
                <strong>{fmtLiter(finalSaldo)}</strong>{' '}
                nicht verbuchter Schwund vorhanden. Hier kann der Differenzbetrag manuell gebucht werden.
              </p>
            </div>
          </div>
          <form action={manuellSchwundBuchen} className="flex flex-wrap gap-3 items-end">
            <input type="hidden" name="behaelter_id" value={id} />
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Charge</label>
              <select name="weinausbau_id" required className={inputCls}>
                {((chargenRaw ?? []) as R[]).map((c: R) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}{!c.aktiv ? ' abgeschlossen' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge (L)</label>
              <input
                name="menge"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue={finalSaldo.toFixed(2)}
                required
                className={`w-28 ${inputCls}`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum</label>
              <input
                name="datum"
                type="date"
                defaultValue={new Date().toISOString().split('T')[0]}
                required
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              className="bg-s112-warn-fg text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-colors"
            >
              Schwund buchen
            </button>
          </form>
        </section>
      )}

      <section>
        <h2 className="font-semibold text-s112-text mb-3">Bewegungsbuch</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Vorgang</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Menge</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {bewegungenMitSaldo.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-s112-muted italic">
                    Noch keine Bewegungen fuer diesen Behaelter erfasst
                  </td>
                </tr>
              ) : (
                bewegungenMitSaldo.map((bew, i) => {
                  const istAbgang    = bew.menge < 0
                  const istZugang    = bew.menge > 0
                  const istNeutral   = bew.menge === 0
                  const colorClass   = istAbgang ? 'text-s112-err-fg' : istZugang ? 'text-s112-ok-fg' : 'text-s112-tertiary'
                  const isZugangsRow = bew.art === 'anfangsbestand' || bew.art === 'zukauf' || bew.art === 'pressung' || bew.art === 'umzug_ein' || bew.art === 'filtration_ein'
                  const isBehandlung = bew.art === 'behandlung'
                  const rowBg        = isZugangsRow ? 'bg-s112-ok-bg/50' : isBehandlung ? 'bg-s112-blue-50/30' : (i % 2 === 1 ? 'bg-s112-bg/30' : '')
                  return (
                    <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${rowBg}`}>
                      <td className="px-4 py-2.5 text-xs text-s112-text-2 whitespace-nowrap">
                        {bew.datum ? new Date(bew.datum).toLocaleDateString('de-AT') : '-'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-start gap-1.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-s112-text-1">{bew.beschreibung}</p>
                              {writeOk && bew.fuellung_id && (
                                <Link
                                  href={`/weinhandel/fuellungen/${bew.fuellung_id}/edit`}
                                  className="text-[10px] text-s112-blue-700 hover:underline shrink-0"
                                >
                                  Bearbeiten
                                </Link>
                              )}
                            </div>
                            {bew.extra && <p className="text-xs text-s112-muted">{bew.extra}</p>}
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${colorClass}`}>
                        {istNeutral
                          ? <span className="text-s112-tertiary">-</span>
                          : <span>{istAbgang ? '' : '+'}{fmtLiter(bew.menge)}</span>
                        }
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${bew.saldo < 0 ? 'text-s112-err-fg font-semibold' : 'text-s112-text-1'}`}>
                        {istNeutral ? '' : fmtLiter(bew.saldo)}
                      </td>
                    </tr>
                  )
                })
              )}
              <tr className={`border-t-2 ${aktuell < 0 ? 'border-s112-err/50 bg-s112-err-bg/50' : 'border-s112-teal/30 bg-s112-teal/5'}`}>
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-s112-text-1 text-sm">
                  Aktueller Bestand
                </td>
                <td className="px-4 py-2.5 text-right" />
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold text-base ${aktuell < 0 ? 'text-s112-err-fg' : 'text-s112-blue-700'}`}>
                  {fmtLiter(aktuell)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
