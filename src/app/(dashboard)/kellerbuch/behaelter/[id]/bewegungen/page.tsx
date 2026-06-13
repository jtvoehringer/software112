import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { fmtLiter } from '@/lib/format'
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
  anfangsbestand:  '📋',
  pressung:        '🍇',
  umzug_ein:       '⬆️',
  umzug_aus:       '⬇️',
  filtration_ein:  '🔼',
  filtration_aus:  '🔽',
  abfuellung:      '🍾',
  verkauf:         '💰',
  behandlung:      '🧪',
  verschneidung_ein: '🍷',
  verschneidung_aus: '🍷',
}

type Bewegung = {
  datum: string
  art: 'anfangsbestand' | 'pressung' | 'umzug_ein' | 'umzug_aus' | 'filtration_ein' | 'filtration_aus' | 'abfuellung' | 'verkauf' | 'behandlung' | 'verschneidung_ein' | 'verschneidung_aus'
  beschreibung: string
  menge: number
  extra?: string
  fuellung_id?: string
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

  // Parallel-Queries
  const [
    { data: pressungenRaw },
    { data: umzuegeEinRaw },
    { data: chargenRaw },
    { data: umzuegeVonBehaelterRaw },
    { data: behandlungenRaw },
  ] = await Promise.all([
    // Pressungen für diesen Behälter
    (supabase.from('pressung_behaelter') as any)
      .select('id, menge_liter, weinausbau_id, notizen, pressung:pressung_id(id, datum, notizen)')
      .eq('behaelter_id', id)
      .order('id', { ascending: true }),

    // Eingehende Umzüge – inkl. brutto_liter/schwund_liter für korrekte Netto-Berechnung
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, nach_weinausbau_id, von_behaelter:von_behaelter_id(name), von_weinausbau:von_weinausbau_id(name, jahrgang, behaelter:behaelter_id(name)), notizen, umzug_batch_id, zeilen_typ')
      .eq('nach_behaelter_id', id)
      .order('datum', { ascending: true }),

    // Alle Chargen in diesem Behälter (aktiv + inaktiv, die noch zugewiesen sind)
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, menge_liter, aktiv, ist_eroeffnungsbestand, anfangsbestand_liter, created_at')
      .eq('behaelter_id', id)
      .order('id', { ascending: true }),

    // Ausgehende Umzüge via von_behaelter_id
    (supabase.from('keller_umzuege') as any)
      .select('von_weinausbau_id')
      .eq('von_behaelter_id', id),

    // Kellerbehandlungen für diesen Behälter
    (supabase.from('keller_behandlungen') as any)
      .select('id, datum, menge, einheit, notizen, typ:typ_id(name)')
      .eq('behaelter_id', id)
      .order('datum', { ascending: true }),
  ])

  // Charge-IDs sammeln aus 4 Quellen
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

  // Abgangs-Queries (nur wenn Chargen vorhanden)
  const [
    { data: umzuegeAusRaw },
    { data: fuellungenRaw },
    { data: verkaufRaw },
  ] = chargeIdList.length > 0
    ? await Promise.all([
        (supabase.from('keller_umzuege') as any)
          .select('id, datum, menge_liter, brutto_liter, schwund_liter, zeilen_typ, umzug_typ, nach_behaelter:nach_behaelter_id(name), von_weinausbau:von_weinausbau_id(name), notizen, umzug_batch_id')
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

  // Verschneidungen: diese Behälter-Chargen als Quelle (Abgang)
  const { data: verschnAusRaw } = chargeIdList.length > 0
    ? await (supabase.from('verschneidung_quellen') as any)
        .select('menge_liter, quell_weinausbau_id, verschneidung:verschneidung_id(datum, notizen, ziel:ziel_weinausbau_id(name, behaelter:behaelter_id(name)))')
        .in('quell_weinausbau_id', chargeIdList)
    : { data: [] }

  // Verschneidungen: diese Behälter-Chargen als Ziel (Zugang)
  const { data: verschnEinRaw } = chargeIdList.length > 0
    ? await (supabase.from('verschneidungen') as any)
        .select('id, datum, notizen, quellen:verschneidung_quellen(menge_liter, quelle:quell_weinausbau_id(name, behaelter:behaelter_id(name)))')
        .in('ziel_weinausbau_id', chargeIdList)
        .order('datum', { ascending: true })
    : { data: [] }

  // ── Sekundäre Batch-Lookups für n:n-Umzug-Format ────────────────────────────
  // 'ziel'-Zeilen haben von_weinausbau_id = null → Quelle aus 'quelle'-Row holen
  const einZielBatchIds = [...new Set(
    ((umzuegeEinRaw ?? []) as R[]).filter(u => u.zeilen_typ === 'ziel' && u.umzug_batch_id).map(u => u.umzug_batch_id)
  )] as string[]
  // 'quelle'-Zeilen haben nach_behaelter_id = null → Ziel aus 'ziel'-Row holen
  const ausQuelleBatchIds = [...new Set(
    ((umzuegeAusRaw ?? []) as R[]).filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id)
  )] as string[]

  const quelleByBatch: Record<string, R[]> = {}
  const zielByBatch:   Record<string, R[]> = {}

  if (einZielBatchIds.length > 0) {
    const { data: quelleRows } = await (supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, von_behaelter:von_behaelter_id(name), von_weinausbau:von_weinausbau_id(name, behaelter:behaelter_id(name))')
      .in('umzug_batch_id', einZielBatchIds)
      .eq('zeilen_typ', 'quelle')
    for (const q of ((quelleRows ?? []) as R[])) {
      if (!quelleByBatch[q.umzug_batch_id]) quelleByBatch[q.umzug_batch_id] = []
      quelleByBatch[q.umzug_batch_id].push(q)
    }
  }

  if (ausQuelleBatchIds.length > 0) {
    const { data: zielRows } = await (supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name), nach_weinausbau:nach_weinausbau_id(name), menge_liter')
      .in('umzug_batch_id', ausQuelleBatchIds)
      .eq('zeilen_typ', 'ziel')
    for (const z of ((zielRows ?? []) as R[])) {
      if (!zielByBatch[z.umzug_batch_id]) zielByBatch[z.umzug_batch_id] = []
      zielByBatch[z.umzug_batch_id].push(z)
    }
  }

  // Eröffnungsbestand-Charge ermitteln
  const eroeffnungsCharge = ((chargenRaw ?? []) as R[]).find(c => c.ist_eroeffnungsbestand)

  // ── Bewegungen aufbauen ──────────────────────────────────────────────────────
  const bewegungen: Bewegung[] = []

  // Eröffnungsbestand als erste Bewegung
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

  // Eingehende Umzüge (Zugänge)
  // Altes Format (brutto_liter=null): menge_liter war Brutto → Netto = menge - schwund
  // Neues Format (brutto_liter gesetzt): menge_liter ist bereits Netto
  for (const u of (umzuegeEinRaw ?? []) as R[]) {
    const rohmenge = parseFloat(u.menge_liter) || 0
    const schwund  = parseFloat(u.schwund_liter) || 0
    const liter    = u.brutto_liter != null
      ? rohmenge
      : Math.max(0, rohmenge - schwund)
    if (liter <= 0) continue

    let vonBeschreibung: string
    if (u.zeilen_typ === 'ziel' && u.umzug_batch_id && quelleByBatch[u.umzug_batch_id]) {
      // Neues N:N-Format: Quelle aus sekundärer Abfrage
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
      // Altes Format oder direkte Verlinkung
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
        ? `Schwund: ${schwund.toLocaleString('de-AT')} L${u.notizen ? ` · ${u.notizen}` : ''}`
        : (u.notizen ?? undefined),
    })
  }

  // Ausgehende Umzüge (Abgänge) – Quelle verliert Bruttomenge
  for (const u of (umzuegeAusRaw ?? []) as R[]) {
    const netto   = parseFloat(u.menge_liter) || 0
    // 'quelle'-Zeilen (N:N-Format): menge_liter = brutto direkt
    // 'transfer'-Zeilen: brutto_liter (neues Format) ODER menge_liter (altes Format, war brutto)
    const abgang  = u.zeilen_typ === 'quelle'
      ? netto
      : (parseFloat(u.brutto_liter) || netto)
    if (abgang <= 0) continue

    let nachBeschreibung: string
    let schwund = parseFloat(u.schwund_liter) || 0

    if (u.zeilen_typ === 'quelle' && u.umzug_batch_id && zielByBatch[u.umzug_batch_id]) {
      // Neues N:N-Format: Ziel aus sekundärer Abfrage
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
      // Altes Format
      nachBeschreibung = (u.nach_behaelter as R | null)?.name ?? '?'
    }

    const vonCharge  = u.von_weinausbau as R | null
    const istFiltAus = u.umzug_typ === 'filtration'
    bewegungen.push({
      datum: u.datum,
      art: istFiltAus ? 'filtration_aus' : 'umzug_aus',
      beschreibung: istFiltAus
        ? `Filtration nach ${nachBeschreibung}${schwund > 0.01 ? ` · Schwund: ${schwund.toLocaleString('de-AT')} L` : ''}`
        : `Umzug nach ${nachBeschreibung}${schwund > 0.01 ? ` · Schwund: ${schwund.toLocaleString('de-AT')} L` : ''}`,
      menge: -abgang,
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
      fuellung_id: f.id,
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

  // Kellerbehandlungen (keine Mengenänderung, nur informativer Eintrag)
  for (const b of (behandlungenRaw ?? []) as R[]) {
    if (!b.datum) continue
    const typName  = (b.typ as R | null)?.name ?? 'Behandlung'
    const mengeStr = b.menge && b.einheit
      ? `${parseFloat(b.menge).toLocaleString('de-AT')} ${b.einheit}`
      : null
    bewegungen.push({
      datum: b.datum,
      art: 'behandlung',
      beschreibung: typName,
      menge: 0,
      extra: [mengeStr, b.notizen].filter(Boolean).join(' · ') || undefined,
    })
  }

  // Verschneidungen – Abgänge (diese Charge als Quelle)
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

  // Verschneidungen – Zugänge (diese Charge als Ziel)
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

  // Nach Datum sortieren (leere Datums an den Anfang)
  bewegungen.sort((a, b) => a.datum.localeCompare(b.datum))

  // Laufenden Saldo berechnen (startet bei 0; Behandlungen mit menge=0 ändern den Saldo nicht)
  let saldo = 0
  const bewegungenMitSaldo = bewegungen.map(bew => {
    saldo += bew.menge
    return { ...bew, saldo }
  })

  const finalSaldo = bewegungenMitSaldo.length > 0
    ? bewegungenMitSaldo[bewegungenMitSaldo.length - 1].saldo
    : 0
  // Aktueller Bestand = letzter Saldo im Bewegungsbuch (konsistent mit der Saldo-Spalte)
  // Fallback auf menge_liter-Summe wenn noch keine Bewegungseinträge vorhanden
  const aktiveChargen = ((chargenRaw ?? []) as R[]).filter(c => c.aktiv && !c.ist_eroeffnungsbestand)
  const aktuellDB = aktiveChargen.reduce((s: number, c: R) => s + (parseFloat(c.menge_liter) || 0), 0)
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
              {kapazitaet && <span>{fmtLiter(kapazitaet)} Kapazität</span>}
            </div>
            {aktuell < 0 && (
              <div className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-medium">
                ⚠️ Negativer Bestand: {fmtLiter(aktuell)} — Buchungsfehler prüfen
              </div>
            )}
            {auslastung !== null && (
              <div className="mt-2 flex items-center gap-2">
                <div className="w-36 bg-gray-200 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${aktuell < 0 ? 'bg-red-500' : auslastung > 90 ? 'bg-amber-500' : 'bg-s112-teal'}`}
                    style={{ width: `${Math.max(0, Math.min(100, auslastung))}%` }}
                  />
                </div>
                <span className={`text-xs tabular-nums ${aktuell < 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-s112-border">
        <span className="px-4 py-2 text-sm font-medium text-s112-teal border-b-2 border-s112-teal -mb-px">
          📊 Bewegungsbuch
        </span>
        <Link href={`/kellerbuch/behaelter/${id}/umzuege`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300 -mb-px transition-colors">
          ↔️ Umziehen
        </Link>
        <Link href={`/kellerbuch/behaelter/${id}/behandlungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300 -mb-px transition-colors">
          🧪 Kellerbehandlungen
        </Link>
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
                  {fmtLiter(parseFloat(c.menge_liter) || 0)}
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
                  const istNeutral   = bew.menge === 0
                  const colorClass   = istAbgang ? 'text-red-600' : istZugang ? 'text-green-600' : 'text-gray-400'
                  const isZugangsRow = bew.art === 'anfangsbestand' || bew.art === 'pressung' || bew.art === 'umzug_ein' || bew.art === 'filtration_ein'
                  const isBehandlung = bew.art === 'behandlung'
                  const rowBg        = isZugangsRow ? 'bg-green-50/50' : isBehandlung ? 'bg-blue-50/30' : (i % 2 === 1 ? 'bg-s112-bg/30' : '')
                  return (
                    <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${rowBg}`}>
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                        {bew.datum ? new Date(bew.datum).toLocaleDateString('de-AT') : '–'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-start gap-1.5">
                          <span>{ART_ICON[bew.art] ?? '•'}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-gray-700">{bew.beschreibung}</p>
                              {writeOk && bew.fuellung_id && (
                                <Link
                                  href={`/weinhandel/fuellungen/${bew.fuellung_id}/edit`}
                                  className="text-[10px] text-s112-teal hover:underline shrink-0"
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
                          ? <span className="text-gray-300">–</span>
                          : <span>{istAbgang ? '' : '+'}{fmtLiter(bew.menge)}</span>
                        }
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${bew.saldo < 0 ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                        {istNeutral ? '' : fmtLiter(bew.saldo)}
                      </td>
                    </tr>
                  )
                })
              )}

              {/* Schluss-Zeile */}
              <tr className={`border-t-2 ${aktuell < 0 ? 'border-red-400/50 bg-red-50/50' : 'border-s112-teal/30 bg-s112-teal/5'}`}>
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-gray-700 text-sm">
                  Aktueller Bestand
                </td>
                <td className="px-4 py-2.5 text-right" />
                <td className={`px-4 py-2.5 text-right tabular-nums font-bold text-base ${aktuell < 0 ? 'text-red-600' : 'text-s112-teal'}`}>
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
