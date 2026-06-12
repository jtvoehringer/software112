import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fmtLiter } from '@/lib/format'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import WeinausbauForm from '@/components/kellerbuch/WeinausbauForm'
import { updateWeinausbau } from '../../actions'

export const metadata: Metadata = { title: 'Charge bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:        { label: 'Ernte',         color: 'bg-yellow-100 text-yellow-700' },
  gaerung:      { label: 'Gärung',        color: 'bg-orange-100 text-orange-700' },
  ausbau:       { label: 'Ausbau',        color: 'bg-blue-100 text-blue-700' },
  abfuellung:   { label: 'Abfüllung',     color: 'bg-purple-100 text-purple-700' },
  abgeschlossen:{ label: 'Abgeschlossen', color: 'bg-green-100 text-green-700' },
}

export default async function WeinausbauDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const [
    { data: rows },
    { data: wgRaw },
    { data: bhRaw },
    { data: umzuegeAusRaw },
    { data: umzuegeEinRaw },
    { data: fuellungenRaw },
    { data: verkaufRaw },
    { data: pressungenRaw },
  ] = await Promise.all([
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, anfangsbestand_liter, status, qualitaetsstufe, notizen, aktiv, einstandspreis_pro_liter, behaelter:behaelter_id(name)')
      .eq('id', id).limit(1),
    (supabase.from('weingarten') as any).select('id, name').eq('aktiv', true).order('name'),
    (supabase.from('behaelter') as any).select('id, name').eq('aktiv', true).order('name'),
    // Ausgehende Umzüge (von dieser Charge weg) – enthält 'transfer' und 'quelle'-Zeilen
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, brutto_liter, schwund_liter, nach_behaelter:nach_behaelter_id(name), notizen, umzug_batch_id, zeilen_typ')
      .eq('von_weinausbau_id', id)
      .order('datum', { ascending: true }),
    // Eingehende Umzüge (in diese Charge rein) – enthält 'transfer' und 'ziel'-Zeilen
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, von_weinausbau:von_weinausbau_id(name, behaelter:behaelter_id(name)), notizen, umzug_batch_id, zeilen_typ')
      .eq('nach_weinausbau_id', id)
      .order('datum', { ascending: true }),
    // Abfüllungen
    (supabase.from('fuellungen') as any)
      .select('id, datum, name, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml, pruefnummer, chargennummer')
      .eq('weinausbau_id', id)
      .order('datum', { ascending: true }),
    // Tank-Verkäufe
    (supabase.from('verkauf_positionen') as any)
      .select('id, menge, einheit, verkaufsposten:verkaufsposten_id(datum, storniert)')
      .eq('weinausbau_id', id)
      .eq('typ', 'tank')
      .order('id', { ascending: true }),
    // Pressungen / Ernte
    (supabase.from('pressung_behaelter') as any)
      .select('id, menge_liter, notizen, pressung:pressung_id(datum, notizen)')
      .eq('weinausbau_id', id)
      .order('id', { ascending: true }),
  ])

  const ausRecs = (umzuegeAusRaw ?? []) as R[]
  const einRecs = (umzuegeEinRaw ?? []) as R[]

  // Sekundäre Abfragen für das neue n:n-Format
  // Für 'quelle'-Zeilen: Ziel-Gebinde-Namen laden
  const quelleAusBatchIds = [...new Set(
    ausRecs.filter(u => u.zeilen_typ === 'quelle').map(u => u.umzug_batch_id).filter(Boolean)
  )] as string[]
  // Für 'ziel'-Zeilen: Quell-Chargen-Namen laden
  const zielEinBatchIds = [...new Set(
    einRecs.filter(u => u.zeilen_typ === 'ziel').map(u => u.umzug_batch_id).filter(Boolean)
  )] as string[]

  const zielRecsByBatch:  Record<string, R[]> = {}
  const quelleRecsByBatch: Record<string, R[]> = {}

  if (quelleAusBatchIds.length > 0) {
    const { data: zielRaw } = await (supabase.from('keller_umzuege') as any)
      // nach_weinausbau als Fallback wenn nach_behaelter_id NULL ist
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name), nach_weinausbau:nach_weinausbau_id(name), menge_liter')
      .in('umzug_batch_id', quelleAusBatchIds)
      .eq('zeilen_typ', 'ziel')
    for (const z of ((zielRaw ?? []) as R[])) {
      if (!zielRecsByBatch[z.umzug_batch_id]) zielRecsByBatch[z.umzug_batch_id] = []
      zielRecsByBatch[z.umzug_batch_id].push(z)
    }
  }

  if (zielEinBatchIds.length > 0) {
    const { data: quelleRaw } = await (supabase.from('keller_umzuege') as any)
      // von_behaelter direkt (einstufig) als Fallback wenn doppelter Join fehlschlägt
      .select('umzug_batch_id, von_behaelter:von_behaelter_id(name), von_weinausbau:von_weinausbau_id(name, behaelter:behaelter_id(name)), brutto_liter')
      .in('umzug_batch_id', zielEinBatchIds)
      .eq('zeilen_typ', 'quelle')
    for (const q of ((quelleRaw ?? []) as R[])) {
      if (!quelleRecsByBatch[q.umzug_batch_id]) quelleRecsByBatch[q.umzug_batch_id] = []
      quelleRecsByBatch[q.umzug_batch_id].push(q)
    }
  }

  type WeinausbauRow = {
    id: string; name: string; jahrgang: number | null; rebsorte: string | null
    weingarten_id: string | null; behaelter_id: string | null; menge_liter: number | null
    anfangsbestand_liter: number | null; status: string; qualitaetsstufe: string | null
    notizen: string | null; aktiv: boolean; einstandspreis_pro_liter: number | null; behaelter: { name: string } | null
  }
  type NameRow = { id: string; name: string }

  const weinausbau = (((rows ?? []) as R[])[0] ?? null) as WeinausbauRow | null
  if (!weinausbau) notFound()

  const weingaerten = (wgRaw ?? []) as NameRow[]
  const behaelter   = (bhRaw  ?? []) as NameRow[]

  const anfangsbestand    = parseFloat(String(weinausbau.anfangsbestand_liter ?? 0)) || 0
  const aktuell           = parseFloat(String(weinausbau.menge_liter ?? 0)) || 0
  const hatAnfangsbestand = anfangsbestand > 0

  type Bewegung = {
    datum: string
    art: 'ernte' | 'umziehen_ein' | 'umziehen_aus' | 'abfuellung' | 'verkauf'
    beschreibung: string
    menge: number
    extra?: string
  }

  const bewegungen: Bewegung[] = []

  // Pressungen / Ernte (Zugänge)
  for (const p of ((pressungenRaw ?? []) as R[])) {
    const liter = parseFloat(p.menge_liter) || 0
    const press = p.pressung as R | null
    bewegungen.push({
      datum: press?.datum ?? '',
      art: 'ernte',
      beschreibung: `Ernte / Pressung${press?.notizen ? ` – ${press.notizen}` : ''}`,
      menge: liter,
      extra: p.notizen ?? undefined,
    })
  }

  // Eingehende Umzüge (Zugänge)
  for (const u of einRecs) {
    const liter = parseFloat(u.menge_liter) || 0
    let beschreibung: string

    if (u.zeilen_typ === 'ziel') {
      // Neues Format: Quell-Namen aus quelleRecsByBatch holen
      const quelleRecs = quelleRecsByBatch[u.umzug_batch_id] ?? []
      const quelleNames = quelleRecs.map((q: R) => {
        const wa         = q.von_weinausbau as R | null
        const waName     = wa?.name ?? null
        // Behälter: zuerst aus doppeltem Join, dann aus direktem FK-Join
        const tankFromWA = (wa?.behaelter as R | null)?.name ?? null
        const tankDirekt = (q.von_behaelter as R | null)?.name ?? null
        const tank       = tankFromWA ?? tankDirekt ?? null
        if (tank && waName) return `${tank} (${waName})`
        if (tank) return tank
        if (waName) return waName
        return '?'
      })
      beschreibung = `Zugang aus ${quelleNames.length > 0 ? quelleNames.join(', ') : '?'}`
    } else {
      // Altes Format (transfer / null)
      const vonCharge = u.von_weinausbau as R | null
      const vonTank   = (vonCharge?.behaelter as R | null)?.name ?? null
      const vonName   = vonCharge?.name ?? '?'
      beschreibung    = `Zugang aus ${vonTank ? `${vonTank} (${vonName})` : vonName}`
    }

    bewegungen.push({
      datum: u.datum,
      art: 'umziehen_ein',
      beschreibung,
      menge: liter,
      extra: u.notizen ?? undefined,
    })
  }

  // Ausgehende Umzüge (Abgänge)
  for (const u of ausRecs) {
    // 'ziel'-Zeilen gehören nicht in diese Charge als Abgang
    if (u.zeilen_typ === 'ziel') continue

    let abgangLiter: number
    let beschreibung: string

    if (u.zeilen_typ === 'quelle') {
      // Neues Format: brutto_liter ist der tatsächliche Abgang
      abgangLiter = parseFloat(u.brutto_liter) || parseFloat(u.menge_liter) || 0
      const zielRecs  = zielRecsByBatch[u.umzug_batch_id] ?? []
      const zielNames = zielRecs.map((z: R) => {
        // nach_behaelter bevorzugen, nach_weinausbau als Fallback
        const behName = (z.nach_behaelter as R | null)?.name ?? null
        const waName  = (z.nach_weinausbau as R | null)?.name ?? null
        return behName ?? waName ?? '?'
      })
      const sumNetto  = zielRecs.reduce((s: number, z: R) => s + (parseFloat(z.menge_liter) || 0), 0)
      const schwund   = abgangLiter - sumNetto
      beschreibung    = `Umziehen → ${zielNames.length > 0 ? zielNames.join(', ') : '?'}${schwund > 0.01 ? ` (Schwund: ${schwund.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L)` : ''}`
    } else {
      // Altes Format (transfer)
      const netto   = parseFloat(u.menge_liter) || 0
      const schwund = parseFloat(u.schwund_liter) || 0
      // brutto_liter bevorzugen, sonst netto + schwund
      abgangLiter   = parseFloat(u.brutto_liter) || (netto + schwund) || netto
      const destName = (u.nach_behaelter as R | null)?.name ?? '?'
      beschreibung   = `Umziehen → ${destName}${schwund > 0.01 ? ` (Schwund: ${schwund.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L)` : ''}`
    }

    bewegungen.push({
      datum: u.datum,
      art: 'umziehen_aus',
      beschreibung,
      menge: -abgangLiter,
      extra: u.notizen ?? undefined,
    })
  }

  // Abfüllungen (Abgänge)
  for (const f of ((fuellungenRaw ?? []) as R[])) {
    const liter = parseFloat(f.menge_liter_gefuellt) || (parseInt(f.anzahl_flaschen) * parseInt(f.flaschengroesse_ml) / 1000)
    bewegungen.push({
      datum: f.datum,
      art: 'abfuellung',
      beschreibung: `Abfüllung: ${f.name}${f.pruefnummer ? ` · Prüfnr. ${f.pruefnummer}` : ''}${f.chargennummer ? ` · Ch. ${f.chargennummer}` : ''}`,
      menge: -liter,
      extra: `${parseInt(f.anzahl_flaschen).toLocaleString('de-AT')} Fl. à ${parseInt(f.flaschengroesse_ml)} ml`,
    })
  }

  // Tank-Verkäufe (Abgänge)
  for (const v of ((verkaufRaw ?? []) as R[])) {
    const vp = v.verkaufsposten as R | null
    if (vp?.storniert) continue
    const liter = parseFloat(v.menge) || 0
    bewegungen.push({
      datum: vp?.datum ?? '',
      art: 'verkauf',
      beschreibung: 'Tank-Verkauf',
      menge: -liter,
    })
  }

  bewegungen.sort((a, b) => a.datum.localeCompare(b.datum))

  // Saldo: startet beim Anfangsbestand (wenn vorhanden), sonst 0
  let saldo = hatAnfangsbestand ? anfangsbestand : 0
  const bewegungenMitSaldo = bewegungen.map(bew => {
    saldo += bew.menge
    return { ...bew, saldo }
  })

  // Berechneter Saldo aus dem Bewegungsbuch = autoritativer Wert
  // (weinausbau.menge_liter kann durch direkte Bearbeitung ohne Pressung-Sync veraltet sein)
  const berechneterSaldo = bewegungenMitSaldo.length > 0
    ? bewegungenMitSaldo[bewegungenMitSaldo.length - 1].saldo
    : hatAnfangsbestand ? anfangsbestand : aktuell

  const st = STATUS_LABELS[weinausbau.status] ?? { label: weinausbau.status, color: 'bg-gray-100 text-gray-600' }

  const artIcon: Record<string, string> = {
    ernte:        '🍇',
    umziehen_ein: '⬆️',
    umziehen_aus: '⬇️',
    abfuellung:   '🍾',
    verkauf:      '💰',
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{weinausbau.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{weinausbau.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
            {weinausbau.jahrgang && <span className="text-xs text-s112-muted">Jahrgang {weinausbau.jahrgang}</span>}
            {weinausbau.behaelter && <span className="text-xs text-s112-muted">in {weinausbau.behaelter.name}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold text-s112-teal tabular-nums">{fmtLiter(berechneterSaldo)}</p>
          <p className="text-xs text-s112-muted mt-0.5">verfügbarer Bestand</p>
          {writeOk && berechneterSaldo > 0.01 && (
            <Link href={`/weinhandel/fuellungen/neu?charge=${weinausbau.id}`}
              className="mt-2 inline-block text-xs bg-s112-teal text-white px-3 py-1 rounded-lg hover:bg-opacity-90 transition-colors">
              🍾 Abfüllen
            </Link>
          )}
        </div>
      </div>

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
              {/* Anfangsbestand – immer zeigen wenn > 0 */}
              {hatAnfangsbestand && (
                <tr className="border-b border-s112-border/40 bg-green-50/50">
                  <td className="px-4 py-2.5 text-xs text-gray-500">–</td>
                  <td className="px-4 py-2.5 font-medium text-gray-700">Anfangsbestand</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-green-700 font-semibold">
                    +{fmtLiter(anfangsbestand, { noUnit: false })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">
                    {fmtLiter(anfangsbestand)}
                  </td>
                </tr>
              )}

              {bewegungenMitSaldo.length === 0 && !hatAnfangsbestand && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-xs text-s112-muted italic">
                    Noch keine Bewegungen erfasst
                  </td>
                </tr>
              )}

              {bewegungenMitSaldo.map((bew, i) => {
                const istAbgang    = bew.menge < 0
                const istZugang    = bew.menge > 0
                const colorClass   = istAbgang ? 'text-red-600' : istZugang ? 'text-green-600' : 'text-gray-500'
                const isZugangsRow = bew.art === 'ernte' || bew.art === 'umziehen_ein'
                const rowBg        = isZugangsRow ? 'bg-green-50/50' : (i % 2 === 1 ? 'bg-s112-bg/30' : '')
                return (
                  <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${rowBg}`}>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {bew.datum ? new Date(bew.datum).toLocaleDateString('de-AT') : '–'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-start gap-1.5">
                        <span>{artIcon[bew.art] ?? '•'}</span>
                        <div>
                          <p className="text-gray-700">{bew.beschreibung}</p>
                          {bew.extra && <p className="text-xs text-s112-muted">{bew.extra}</p>}
                        </div>
                      </div>
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${colorClass}`}>
                      {istAbgang ? '' : '+'}{fmtLiter(bew.menge)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                      {fmtLiter(bew.saldo)}
                    </td>
                  </tr>
                )
              })}

              {/* Saldo-Zeile */}
              <tr className="border-t-2 border-s112-teal/30 bg-s112-teal/5">
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-gray-700 text-sm">
                  Aktueller Bestand
                </td>
                <td className="px-4 py-2.5 text-right" />
                <td className="px-4 py-2.5 text-right tabular-nums font-bold text-s112-teal text-base">
                  {fmtLiter(berechneterSaldo)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit-Formular */}
      {writeOk && (
        <section>
          <h2 className="font-semibold text-gray-800 mb-3">Charge bearbeiten</h2>
          <WeinausbauForm
            weinausbau={weinausbau}
            weingaerten={weingaerten}
            behaelter={behaelter}
            action={updateWeinausbau.bind(null, id)}
          />
        </section>
      )}
    </div>
  )
}
