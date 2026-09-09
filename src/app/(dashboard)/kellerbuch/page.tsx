import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { fmtLiter } from '@/lib/format'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Pencil, Boxes } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'

export const metadata: Metadata = { title: 'Kellerbuch – software:112' }
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

const WEINART_BADGE: Record<string, { label: string; color: string }> = {
  weiss:    { label: 'Weiß',    color: 'bg-s112-warn-bg text-s112-warn-fg' },
  rot:      { label: 'Rot',     color: 'bg-s112-err-bg text-s112-err-fg' },
  rose:     { label: 'Rosé',    color: 'bg-[#F2F3F5] text-s112-text-1' },
  unbekannt:{ label: '?',       color: 'bg-[#F2F3F5] text-s112-text-2' },
}

export default async function KellerbuchPage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  // Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
  // beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
  // Daten eines anderen Betriebs als des gerade ausgewählten angezeigt werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    { data: behaelterRaw },
    { data: weinausbauRaw },
    { data: fuellstandRaw },
  ] = await Promise.all([
    tf((supabase.from('behaelter') as any)
      .select('id, name, typ, volumen_liter, standort, aktiv')
      .order('name')),
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, weinart, menge_liter, status, aktiv, behaelter_id, ist_eroeffnungsbestand')
      .order('jahrgang', { ascending: false })),
    // Event-basierter Füllstand pro Behälter (identisch zur Bewegungen-Page)
    tf((supabase.from('v_behaelter_fuellstand') as any)
      .select('behaelter_id, liter_aktuell')),
  ])

  const behaelter  = (behaelterRaw  ?? []) as R[]
  const weinausbau = (weinausbauRaw ?? []) as R[]

  // Füllstand-Map aus View (event-basiert, konsistent zur Bewegungen-Page)
  const fuellstandMap = new Map<string, number>()
  for (const f of (fuellstandRaw ?? []) as R[]) {
    fuellstandMap.set(f.behaelter_id, parseFloat(f.liter_aktuell) || 0)
  }

  // Alle Chargen mit Wein im Behälter (unabhängig von aktiv-Flag):
  // aktiv=false + status≠abgeschlossen = Wein ist physisch noch im Behälter
  const alleAktiven    = weinausbau.filter((w: R) => w.status !== 'abgeschlossen')
  // Reguläre Chargen (ohne Eröffnungsbestand, aktiv=true) für die Stats-Card
  const aktiveChargen  = alleAktiven.filter((w: R) => !w.ist_eroeffnungsbestand && w.aktiv)

  // Gesamtliter aus event-basierter View (Summe aller Behälter, min. 0)
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
        <Link href="/kellerbuch/gebinde" className="card text-center p-4 hover:shadow-sm hover:border-s112-teal/30 transition-all cursor-pointer">
          <p className="text-3xl font-semibold text-s112-blue-700">{behaelter.filter((b: R) => b.aktiv).length}</p>
          <p className="text-xs text-s112-muted mt-1">Aktive Behälter</p>
          <p className="text-[10px] text-s112-blue-700/60 mt-1">→ Gebinde verwalten</p>
        </Link>
        <Link href="/kellerbuch/weinausbau" className="card text-center p-4 hover:shadow-sm hover:border-s112-teal/30 transition-all cursor-pointer">
          <p className="text-3xl font-semibold text-s112-blue-700">{aktiveChargen.length}</p>
          <p className="text-xs text-s112-muted mt-1">Laufende Chargen</p>
          <p className="text-[10px] text-s112-blue-700/60 mt-1">→ Weinausbau</p>
        </Link>
        <Link href="/kellerbuch/rueckverfolgung" className="card text-center p-4 hover:shadow-sm hover:border-s112-teal/30 transition-all cursor-pointer">
          <p className="text-3xl font-semibold text-s112-blue-700">{fmtLiter(gesamtLiter)}</p>
          <p className="text-xs text-s112-muted mt-1">Liter in Ausbau</p>
          <p className="text-[10px] text-s112-blue-700/60 mt-1">→ Rückverfolgung</p>
        </Link>
      </div>

      {/* Behälter mit Chargen */}
      <div className="space-y-4">
        {behaelter.filter((b: R) => b.aktiv).map((b: R) => {
          const chargen        = chargenByBehaelter.get(b.id) ?? []
          // Event-basierter Füllstand aus View (konsistent mit Bewegungen-Page)
          const literImBehaelter = fuellstandMap.get(b.id) ?? 0
          const kapazitaet     = b.volumen_liter ? parseFloat(b.volumen_liter) : null
          const auslastung     = kapazitaet && kapazitaet > 0 ? Math.min(100, (literImBehaelter / kapazitaet) * 100) : null

          return (
            <div key={b.id} className="card p-0 overflow-hidden">
              {/* Behälter-Header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-s112-bg border-b border-s112-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-s112-text text-sm">{b.name}</span>
                    {b.standort && <span className="text-xs text-s112-muted">{b.standort}</span>}
                    {kapazitaet && (
                      <span className="text-xs text-s112-muted">
                        {fmtLiter(kapazitaet)} Kapazität
                      </span>
                    )}
                  </div>
                  {auslastung !== null && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 bg-s112-line rounded-full h-1.5 max-w-40">
                        <div
                          className={`h-1.5 rounded-full ${literImBehaelter < 0 ? 'bg-s112-err' : auslastung > 90 ? 'bg-s112-warn' : 'bg-s112-teal'}`}
                          style={{ width: `${Math.max(0, Math.min(100, auslastung))}%` }}
                        />
                      </div>
                      <span className={`text-xs tabular-nums ${literImBehaelter < 0 ? 'text-s112-err-fg font-semibold' : 'text-s112-text-2'}`}>
                        {fmtLiter(literImBehaelter)} / {fmtLiter(kapazitaet)}
                      </span>
                    </div>
                  )}
                  {!kapazitaet && literImBehaelter !== 0 && (
                    <p className={`text-xs mt-0.5 ${literImBehaelter < 0 ? 'text-s112-err-fg font-semibold' : 'text-s112-text-2'}`}>
                      {fmtLiter(literImBehaelter)} belegt
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Link href={`/kellerbuch/behaelter/${b.id}/bewegungen`}
                    className="text-xs text-s112-blue-700 hover:underline whitespace-nowrap font-medium">
                    Bewegungen →
                  </Link>
                  {writeOk && (
                    <Link href={`/kellerbuch/behaelter/${b.id}`}
                      title="Bearbeiten" aria-label="Bearbeiten"
                      className="text-s112-muted hover:text-s112-blue-700">
                      <Pencil className="w-4 h-4" />
                    </Link>
                  )}
                </div>
              </div>

              {/* Negativer Bestand – Warnung */}
              {literImBehaelter < 0 && (
                <div className="flex items-center gap-2 px-4 py-2 bg-s112-err-bg border-b border-s112-err/30 text-s112-err-fg text-xs font-medium">
                  Negativer Bestand: {fmtLiter(literImBehaelter)} — Buchungsfehler prüfen
                </div>
              )}

              {/* Chargen im Behälter */}
              {chargen.length > 0 ? (
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col className="w-[46%]" />
                    <col className="w-[10%]" />
                    <col className="w-[19%]" />
                    <col className="w-[19%]" />
                    <col className="w-[6%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-s112-border/50">
                      <th className="text-left px-4 py-2 text-xs font-medium text-s112-text-2">Charge</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-s112-text-2">Jg.</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-s112-text-2">Status</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-s112-text-2">Liter</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {chargen.map((w: R) => {
                      const st = STATUS_LABELS[w.status] ?? { label: w.status, color: 'bg-[#F2F3F5] text-s112-text-2' }
                      // Bei einer einzigen Charge im Behälter: View-Wert (event-basiert) verwenden,
                      // da weinausbau.menge_liter durch direkte Bearbeitung veralten kann
                      const menge = chargen.length === 1
                        ? literImBehaelter
                        : parseFloat(w.menge_liter) || 0
                      const istEB = w.ist_eroeffnungsbestand === true
                      const wa = WEINART_BADGE[w.weinart ?? 'unbekannt'] ?? WEINART_BADGE.unbekannt
                      return (
                        <tr key={w.id} className={`relative border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40 cursor-pointer ${istEB ? 'opacity-75' : ''}`}>
                          <td className="px-4 py-2.5 font-medium text-s112-text">
                            <Link href={`/kellerbuch/weinausbau/${w.id}`}
                              className="after:absolute after:inset-0">
                              {w.name}
                            </Link>
                            {w.rebsorte && <span className="text-xs text-s112-muted ml-1">· {formatRebsorteMitKuerzel(w.rebsorte)}</span>}
                            {istEB && <span className="text-xs text-s112-muted ml-1 italic">(Eröffnungsbestand)</span>}
                            {(w.weinart && w.weinart !== 'unbekannt') && (
                              <span className={`inline-block ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${wa.color}`}>{wa.label}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-s112-muted text-xs">{w.jahrgang ?? '–'}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-s112-text">
                            {menge > 0
                              ? fmtLiter(menge)
                              : menge < 0
                                ? <span className="text-s112-err-fg font-semibold">{fmtLiter(menge)}</span>
                                : <span className="text-s112-err">0,00 L</span>}
                          </td>
                          {/* Abfüllen-Aktion bewusst entfernt (5.8.2026) - erfolgt jetzt nur
                              noch auf der Chargen-Detailseite, nicht mehr aus der Übersicht. */}
                          <td className="relative z-10 px-4 py-2.5 text-right" />
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-3 text-xs text-s112-muted italic">Kein Wein in diesem Behälter</p>
              )}
            </div>
          )
        })}

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

        {behaelter.filter((b: R) => b.aktiv).length === 0 && (
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
