import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter, type BehaelterZeile } from '@/lib/keller/behaelter'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { fmtLiter } from '@/lib/format'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Pencil, Boxes, ChevronRight } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { gebindePasst, pickerlText, vorherrschendeWeinart, WEINART_FARBE } from '@/lib/keller/gebindeAnzeige'
import PickerlEntfernen from './PickerlEntfernen'

export const metadata: Metadata = { title: 'Kellerbuch' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:        { label: 'Ernte',        color: 'bg-s112-warn-bg text-s112-warn-fg' },
  gaerung:      { label: 'Gärung',       color: 'bg-s112-warn-bg text-s112-warn-fg' },
  ausbau:       { label: 'Ausbau',       color: 'bg-s112-blue-100 text-s112-blue-700' },
  abfuellung:   { label: 'Abfüllung',   color: 'bg-[#F2F3F5] text-s112-text-1' },
  abgeschlossen:{ label: 'Abgeschlossen',color: 'bg-s112-ok-bg text-s112-ok-fg' },
}

// KAN-174 E: Füllstand als Kreis in der Farbe des Inhalts (weiß/rot/rosé) statt Balken und Weinart-Knöpfen
function FuellKreis({ pct, farbe, negativ }: { pct: number | null; farbe: string; negativ: boolean }) {
  const r = 9, u = 2 * Math.PI * r
  const anteil = pct === null ? 1 : Math.max(0, Math.min(1, pct / 100))
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r={r} fill="none" stroke="#E4E6EA" strokeWidth="4" />
      <circle cx="12" cy="12" r={r} fill="none" stroke={negativ ? '#C9564E' : farbe} strokeWidth="4"
        strokeDasharray={`${anteil * u} ${u}`} transform="rotate(-90 12 12)" opacity={pct === null ? 0.5 : 1} />
    </svg>
  )
}

export default async function KellerbuchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  // KAN-174 A: Suche nach Gebinde (Name, Standort, Charge, Rebsorte, Pickerl)
  const suche = ((await searchParams).q ?? '').trim()
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role, 'kellerbuch')

  // Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
  // beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
  // Daten eines anderen Betriebs als des gerade ausgewählten angezeigt werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    behaelter,
    weinausbauRawRes,
    fuellstandRawRes,
  ] = await Promise.all([
    // Eigene + freigegebene Gebinde (Kellergemeinschaft, Migration 203)
    ladeBehaelter(supabase, tenantId),
    alle(tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, weinart, menge_liter, status, aktiv, behaelter_id, ist_eroeffnungsbestand')
      .order('jahrgang', { ascending: false }).order('id'))),
    // Füllstand pro Behälter = Bestand der Chargen im Gebinde (KAN-44 Teil 2, = Saldo des Bewegungsjournals)
    tf((supabase.from('v_behaelter_fuellstand') as any)
      .select('behaelter_id, liter_aktuell')),
  ])
  const weinausbauRaw = geladen(weinausbauRawRes, 'Chargen')
  const fuellstandRaw = geladen(fuellstandRawRes, 'Füllstände')

  const weinausbau = (weinausbauRaw ?? []) as R[]

  // Füllstand-Map aus der View (Bestand der Chargen, konsistent zur Charge-Liste der Karte)
  const fuellstandMap = new Map<string, number>()
  for (const f of (fuellstandRaw ?? []) as R[]) {
    fuellstandMap.set(f.behaelter_id, parseFloat(f.liter_aktuell) || 0)
  }

  // Alle Chargen mit Wein im Behälter (unabhängig von aktiv-Flag):
  // aktiv=false + status≠abgeschlossen = Wein ist physisch noch im Behälter
  const alleAktiven    = weinausbau.filter((w: R) => w.status !== 'abgeschlossen')
  // Reguläre Chargen (ohne Eröffnungsbestand, aktiv=true) für die Stats-Card
  const aktiveChargen  = alleAktiven.filter((w: R) => !w.ist_eroeffnungsbestand && w.aktiv)

  // Gesamtliter aus der View (Summe aller Behälter, min. 0)
  const gesamtLiter = Array.from(fuellstandMap.values())
    .filter(v => v > 0)
    .reduce((s, v) => s + v, 0)

  // Chargen nach Behälter gruppieren (für Charge-Liste in der Karte)
  const chargenByBehaelter = new Map<string, R[]>()
  const chargenOhneBehaelter: R[] = []

  for (const w of alleAktiven) {
    const menge = parseFloat(w.menge_liter ?? '0') || 0
    if (menge <= 0) continue  // Chargen ohne Liter nicht in Karten anzeigen
    if (w.behaelter_id) {
      if (!chargenByBehaelter.has(w.behaelter_id)) chargenByBehaelter.set(w.behaelter_id, [])
      chargenByBehaelter.get(w.behaelter_id)!.push(w)
    } else if (!w.ist_eroeffnungsbestand) {
      chargenOhneBehaelter.push(w)
    }
  }

  // Gruppierung je Keller (Standort): belegte Gebinde zuerst, dann leere, jeweils alphanumerisch (a1, a2, a10 …)
  const literVon = (b: BehaelterZeile) => (fuellstandMap.get(b.id) ?? 0) + b.fremd_liter
  const istBelegt = (b: BehaelterZeile) => literVon(b) > 0.01 || (chargenByBehaelter.get(b.id)?.length ?? 0) > 0
  const cmpName = (x: BehaelterZeile, y: BehaelterZeile) => x.name.localeCompare(y.name, 'de', { numeric: true, sensitivity: 'base' })
  const gruppenMap = new Map<string, BehaelterZeile[]>()
  const trifft = (b: BehaelterZeile) => gebindePasst(suche, [
    b.name, b.standort, b.lp_pickerl, b.fremd_betrieb,
    ...(chargenByBehaelter.get(b.id) ?? []).flatMap((w: R) => [w.name, w.rebsorte, w.jahrgang != null ? String(w.jahrgang) : null]),
  ])
  for (const b of behaelter.filter(b => b.aktiv && trifft(b))) {
    const key = b.standort?.trim() || 'Ohne Standort'
    if (!gruppenMap.has(key)) gruppenMap.set(key, [])
    gruppenMap.get(key)!.push(b)
  }
  const gruppen = [...gruppenMap.entries()]
    .sort(([a], [b]) => a === 'Ohne Standort' ? 1 : b === 'Ohne Standort' ? -1 : a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' }))
    .map(([name, liste]) => ({
      name,
      belegt: liste.filter(istBelegt).sort(cmpName),
      leer: liste.filter(b => !istBelegt(b)).sort(cmpName),
      liter: liste.reduce((sum, b) => sum + Math.max(0, literVon(b)), 0),
      kapazitaet: liste.reduce((sum, b) => sum + (b.volumen_liter ?? 0), 0),
    }))

  // KAN-174 E: ein belegtes Gebinde je Zeile – Kreis (Füllstand, Farbe des Inhalts), Name, Chargen, Liter, Aktionen
  const zeile = (b: BehaelterZeile) => {
    const chargen = chargenByBehaelter.get(b.id) ?? []
    // Event-basierter Füllstand aus View (je Betrieb, Migration 204) + fremd belegte Liter eines Partnerbetriebs
    const literImBehaelter = literVon(b)
    const kapazitaet = b.volumen_liter
    const auslastung = kapazitaet && kapazitaet > 0 ? (literImBehaelter / kapazitaet) * 100 : null
    const farbe = WEINART_FARBE[vorherrschendeWeinart(chargen.map((w: R) => ({ weinart: w.weinart, liter: parseFloat(w.menge_liter) || 0 })))]
    const lp = pickerlText(b.lp_pickerl)
    return (
      <div key={b.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${literImBehaelter < 0 ? 'bg-s112-err-bg' : ''}`}>
        <span title={auslastung === null ? 'ohne Kapazität' : `${Math.round(auslastung)} % gefüllt`}>
          <FuellKreis pct={auslastung} farbe={farbe} negativ={literImBehaelter < 0} />
        </span>
        {/* KAN-285: Gebindename führt zu den Bewegungen (ersetzt den Knopf „Bewegungen →“) */}
        <Link href={`/kellerbuch/behaelter/${b.id}/bewegungen`} title={`${b.name} – Bewegungen`} className="font-semibold text-s112-text hover:text-s112-blue-700 hover:underline w-32 sm:w-56 shrink-0 truncate">{b.name}</Link>
        <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {b.fremd && <span title={`Gebinde von ${b.eigentuemer_name}`} className="text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded-sm bg-s112-blue-50 text-s112-blue-700">{b.eigentuemer_name}</span>}
          {b.gesperrt && <span title="Ein anderer Betrieb hat Wein in diesem Gebinde – kein Ziel für Umzüge" className="text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded-sm bg-s112-warn-bg text-s112-warn-fg">belegt · {b.fremd_betrieb} · {fmtLiter(b.fremd_liter)}</span>}
          {lp && (writeOk && !b.fremd ? <PickerlEntfernen behaelterId={b.id} text={lp} /> : <span className="text-[10.5px] font-semibold px-1.5 py-px rounded-sm bg-s112-warn-bg text-s112-warn-fg">{lp}</span>)}
          {chargen.map((w: R) => {
            const st = STATUS_LABELS[w.status] ?? { label: w.status, color: '' }
            // Bei einer einzigen Charge im Behälter: View-Wert (event-basiert), da menge_liter veralten kann
            const menge = chargen.length === 1 ? literImBehaelter : parseFloat(w.menge_liter) || 0
            return (
              <span key={w.id} className={`inline-flex items-baseline gap-1 ${w.ist_eroeffnungsbestand ? 'opacity-75' : ''}`}>
                <Link href={`/kellerbuch/weinausbau/${w.id}`} className="font-medium text-s112-blue-700 hover:underline">{w.name}</Link>
                <span className="text-xs text-s112-muted">
                  {[w.jahrgang, w.rebsorte ? formatRebsorteMitKuerzel(w.rebsorte) : null, st.label, w.ist_eroeffnungsbestand ? 'Eröffnungsbestand' : null].filter(Boolean).join(' · ')}
                  {chargen.length > 1 && <> · <span className="tabular-nums">{fmtLiter(menge)}</span></>}
                </span>
              </span>
            )
          })}
          {chargen.length === 0 && !b.gesperrt && <span className="text-xs text-s112-muted italic">Kein eigener Wein</span>}
        </span>
        <span className={`text-xs tabular-nums whitespace-nowrap ${literImBehaelter < 0 ? 'text-s112-err-fg font-semibold' : 'text-s112-text-2'}`}
          title={literImBehaelter < 0 ? 'Negativer Bestand – Buchungsfehler prüfen' : undefined}>
          {fmtLiter(literImBehaelter)}{kapazitaet ? <span className="text-s112-tertiary"> / {fmtLiter(kapazitaet)}</span> : null}
        </span>
        {writeOk && !b.fremd && (
          <Link href={`/kellerbuch/behaelter/${b.id}`} title="Bearbeiten" aria-label="Bearbeiten" className="text-s112-muted hover:text-s112-blue-700">
            <Pencil className="w-4 h-4" />
          </Link>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Kellerbuch</h1>
          <p className="text-sm text-s112-muted mt-0.5">Übersicht Behälter &amp; Chargen</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <Link href="/kellerbuch/gebinde" className="card text-center p-4 hover:shadow-xs hover:border-s112-teal/30 transition-all cursor-pointer">
          <p className="text-xl sm:text-3xl font-semibold text-s112-blue-700">{behaelter.filter(b => b.aktiv).length}</p>
          <p className="text-xs text-s112-muted mt-1">Aktive Behälter</p>
          <p className="text-[11px] text-s112-blue-700/60 mt-1">→ Gebinde verwalten</p>
        </Link>
        <Link href="/kellerbuch/weinausbau" className="card text-center p-4 hover:shadow-xs hover:border-s112-teal/30 transition-all cursor-pointer">
          <p className="text-xl sm:text-3xl font-semibold text-s112-blue-700">{aktiveChargen.length}</p>
          <p className="text-xs text-s112-muted mt-1">Laufende Chargen</p>
          <p className="text-[11px] text-s112-blue-700/60 mt-1">→ Weinausbau</p>
        </Link>
        <Link href="/kellerbuch/rueckverfolgung" className="card text-center p-4 hover:shadow-xs hover:border-s112-teal/30 transition-all cursor-pointer">
          <p className="text-xl sm:text-3xl font-semibold text-s112-blue-700">{fmtLiter(gesamtLiter)}</p>
          <p className="text-xs text-s112-muted mt-1">Liter in Ausbau</p>
          <p className="text-[11px] text-s112-blue-700/60 mt-1">→ Rückverfolgung</p>
        </Link>
      </div>

      {/* KAN-174 A: Gebinde suchen */}
      <form method="get" className="mb-4 flex items-center gap-2 print:hidden" role="search">
        <input type="search" name="q" defaultValue={suche} aria-label="Gebinde suchen"
          placeholder="Gebinde suchen – Name, Keller, Charge, Rebsorte …"
          className="form-input flex-1 max-w-md" />
        <button type="submit" className="px-3 py-2 rounded-lg text-sm font-medium border border-s112-border text-s112-text-2 hover:text-s112-text">Suchen</button>
        {suche && <Link href="/kellerbuch" className="text-xs text-s112-blue-700 hover:underline">Suche löschen</Link>}
      </form>
      {suche && gruppen.length === 0 && <p className="mb-4 text-sm text-s112-muted">Kein Gebinde passt zu „{suche}“.</p>}

      {/* Behälter je Keller (Standort), aufklappbar; belegte zuerst, dann leere - jeweils alphanumerisch (Rückmeldung 16.9.2026) */}
      <div className="space-y-4">
        {gruppen.map(g => (
          <details key={g.name} open className="card p-0 overflow-hidden group">
            <summary className="cursor-pointer select-none flex items-center gap-3 px-4 py-3 bg-s112-bg border-b border-s112-border list-none [&::-webkit-details-marker]:hidden">
              <ChevronRight className="w-4 h-4 text-s112-tertiary transition-transform group-open:rotate-90 shrink-0" />
              <span className="font-semibold text-s112-text text-sm">{g.name}</span>
              <span className="text-xs text-s112-text-2">{g.belegt.length} von {g.belegt.length + g.leer.length} Gebinden belegt</span>
              <span className="ml-auto text-xs font-mono tabular-nums text-s112-text">{fmtLiter(g.liter)}{g.kapazitaet > 0 ? <span className="text-s112-tertiary"> / {fmtLiter(g.kapazitaet)}</span> : null}</span>
            </summary>
            <div className="p-3 space-y-3">
              {g.belegt.length > 0 && <div className="rounded-lg border border-s112-line divide-y divide-s112-line">{g.belegt.map(b => zeile(b))}</div>}
              {g.belegt.length === 0 && <p className="px-1 text-xs text-s112-muted italic">Kein Gebinde in diesem Keller belegt</p>}
              {g.leer.length > 0 && (
                <>
                  <p className="px-1 pt-1 text-[10.5px] font-mono uppercase tracking-[.04em] text-s112-tertiary">Leer · {g.leer.length}</p>
                  <div className="rounded-lg border border-s112-line divide-y divide-s112-line">
                    {g.leer.map(b => (
                      <div key={b.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                        <Link href={`/kellerbuch/behaelter/${b.id}/bewegungen`} title={`${b.name} – Bewegungen`} className="font-medium text-s112-text hover:text-s112-blue-700 hover:underline w-32 sm:w-56 shrink-0 truncate">{b.name}</Link>
                        {b.fremd && <span title={`Gebinde von ${b.eigentuemer_name}`} className="text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded-sm bg-s112-blue-50 text-s112-blue-700">{b.eigentuemer_name}</span>}
                        <span className="text-xs text-s112-text-2 capitalize">{b.typ ?? '–'}</span>
                        <span className="text-xs text-s112-text-2 font-mono tabular-nums">{b.volumen_liter ? fmtLiter(b.volumen_liter) : '–'}</span>
                        {b.stapler && <span className="text-[9.5px] font-mono uppercase tracking-[.04em] px-1 py-px rounded-sm bg-s112-bg text-s112-text-2 border border-s112-line">Stapler</span>}
                        {pickerlText(b.lp_pickerl) && (writeOk && !b.fremd
                          ? <PickerlEntfernen behaelterId={b.id} text={pickerlText(b.lp_pickerl) as string} />
                          : <span className="text-[10.5px] font-semibold px-1.5 py-px rounded-sm bg-s112-warn-bg text-s112-warn-fg">{pickerlText(b.lp_pickerl)}</span>)}
                        <span className="ml-auto flex items-center gap-3 shrink-0">
                          {writeOk && !b.fremd && <Link href={`/kellerbuch/behaelter/${b.id}`} title="Bearbeiten" aria-label="Bearbeiten" className="text-s112-muted hover:text-s112-blue-700"><Pencil className="w-3.5 h-3.5" /></Link>}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </details>
        ))}

        {/* Chargen ohne Behälter */}
        {chargenOhneBehaelter.length > 0 && (
          <div className="card p-0 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-s112-warn-bg border-b border-s112-warn/30">
              <span className="font-semibold text-s112-warn-fg text-sm">Chargen ohne Behälterzuweisung</span>
            </div>
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[46%]" />
                <col className="w-[10%]" />
                <col className="w-[19%]" />
                <col className="w-[19%]" />
                <col className="w-[6%]" />
              </colgroup>
              <tbody>
                {chargenOhneBehaelter.map((w: R) => {
                  const st = STATUS_LABELS[w.status] ?? { label: w.status, color: 'bg-[#F2F3F5] text-s112-text-2' }
                  return (
                    <tr key={w.id} className="relative border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40 cursor-pointer">
                      <td className="px-4 py-2.5 font-medium text-s112-text">
                        <Link href={`/kellerbuch/weinausbau/${w.id}`}
                          className="after:absolute after:inset-0">
                          {w.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-s112-muted text-xs">{w.jahrgang ?? '–'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-s112-text">
                        {fmtLiter(parseFloat(w.menge_liter) || 0)}
                      </td>
                      <td className="relative z-10 px-4 py-2.5 text-right" />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {behaelter.filter(b => b.aktiv).length === 0 && (
          <div className="card text-center py-10">
            <Boxes className="w-8 h-8 mx-auto mb-2 text-s112-muted" />
            <p className="text-sm text-s112-muted">Noch keine Behälter angelegt</p>
            {writeOk && (
              <Link href="/kellerbuch/behaelter/neu"
                className="mt-3 inline-block text-xs text-s112-blue-700 font-semibold hover:underline">
                + Ersten Behälter anlegen
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
