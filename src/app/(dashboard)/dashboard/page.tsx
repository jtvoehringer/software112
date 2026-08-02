import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ReceiptText, Warehouse, Package, Users, Plus } from 'lucide-react'

export const metadata: Metadata = { title: 'Übersicht – software:112' }
export const dynamic = 'force-dynamic'
type AR = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Zahlungsziel-Annahme für "überfällig" (kein eigenes Feld im Datenmodell vorhanden):
// offene Posten gelten ab 30 Tagen nach Belegdatum als überfällig. Bei Bedarf anpassen,
// sobald es ein echtes Fälligkeitsdatum gibt.
const ZAHLUNGSZIEL_TAGE = 30

function startOfWeek(d: Date) {
  const day = d.getDay() // 0 = Sonntag ... 6 = Samstag
  const diff = (day === 0 ? -6 : 1) - day // auf Montag verschieben
  const s = new Date(d)
  s.setDate(d.getDate() + diff)
  s.setHours(0, 0, 0, 0)
  return s
}
function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()

  // Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
  // beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
  // KPIs/Daten eines anderen Betriebs als des gerade ausgewählten angezeigt werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  let tenantName: string | null = null
  if (tenantId) {
    const { data: tenantRow } = await (supabase.from('tenants') as any).select('name').eq('id', tenantId).maybeSingle()
    tenantName = (tenantRow as { name?: string } | null)?.name ?? null
  }

  const heute = new Date()
  const monatVon  = new Date(heute.getFullYear(), heute.getMonth(), 1).toISOString().split('T')[0]
  const monatBis  = new Date(heute.getFullYear(), heute.getMonth() + 1, 0).toISOString().split('T')[0]
  const vorMonVon = new Date(heute.getFullYear(), heute.getMonth() - 1, 1).toISOString().split('T')[0]
  const vorMonBis = new Date(heute.getFullYear(), heute.getMonth(), 0).toISOString().split('T')[0]
  const heuteStr  = heute.toISOString().split('T')[0]

  const wochenStart      = startOfWeek(heute)
  const wochenStartStr   = toDateStr(wochenStart)
  const vorwochenStart   = new Date(wochenStart); vorwochenStart.setDate(vorwochenStart.getDate() - 7)
  const vorwochenStartStr = toDateStr(vorwochenStart)
  const vorwochenEndeStr  = toDateStr(new Date(wochenStart.getTime() - 86400000))

  // 12-Monats-Fenster für die Absatzreihe im Balkendiagramm
  const absatzVon = toDateStr(new Date(heute.getFullYear(), heute.getMonth() - 11, 1))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (t: string) => (supabase.from(t) as any)
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft KPIs vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    { count: fuellungenCount },
    { data: offenePostenRaw },
    { data: monatsVerkaufRaw },
    { data: vormonatsVerkaufRaw },
    { data: letzteVerkaeufRaw },
    { count: kontakteCount },
    { count: leadCount },
    { count: auftraegeWocheCount },
    { count: auftraegeVorwocheCount },
    { data: absatzSeriesRaw },
  ] = await Promise.all([
    tf(q('fuellungen').select('*', { count: 'exact', head: true }).eq('aktiv', true).gt('bestand_flaschen', 0)),

    // Offene Posten (unbezahlt, nicht storniert) — inkl. Datum für Überfällig-/Ø-Tage-Berechnung
    tf(q('verkaufsposten')
      .select('id, datum, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).eq('bezahlt', false).eq('storniert', false)),

    // Verkäufe aktueller Monat
    tf(q('verkaufsposten')
      .select('id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).gte('datum', monatVon).lte('datum', monatBis)),

    // Verkäufe Vormonat
    tf(q('verkaufsposten')
      .select('id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).gte('datum', vorMonVon).lte('datum', vorMonBis)),

    // Letzte 5 Belege
    tf(q('verkaufsposten')
      .select('id, datum, rechnungsnummer, bezahlt, storniert, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name), positionen:verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).order('datum', { ascending: false }).order('erstellt_am', { ascending: false }).limit(5)),

    tf(q('kontakte').select('*', { count: 'exact', head: true }).eq('aktiv', true)),
    tf(q('kontakte').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('is_lead', true)),

    // Aufträge diese Woche / Vorwoche (für Vergleich)
    tf(q('verkaufsposten').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('storniert', false).gte('datum', wochenStartStr)),
    tf(q('verkaufsposten').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('storniert', false).gte('datum', vorwochenStartStr).lte('datum', vorwochenEndeStr)),

    // Absatzreihe (Flaschen/Menge) der letzten 12 Monate für das Balkendiagramm
    tf(q('verkaufsposten')
      .select('datum, verkauf_positionen(menge)')
      .eq('aktiv', true).eq('storniert', false).gte('datum', absatzVon)),
  ])

  function posSum(posten: R[]): number {
    return (posten ?? []).reduce((s: number, p: R) => {
      const pos = (p.positionen ?? p.verkauf_positionen ?? []) as R[]
      return s + pos.reduce((ps: number, pos: R) => {
        const brutto = (Number(pos.preis_brutto) || 0) * (Number(pos.menge) || 0)
        const r = (Number(pos.rabatt_pct) || 0) / 100
        const sr = (Number(pos.sonderrabatt_pct) || 0) / 100
        return ps + brutto * (1 - r) * (1 - sr)
      }, 0)
    }, 0)
  }

  const monatUmsatz   = posSum((monatsVerkaufRaw    ?? []) as R[])
  const vormonUmsatz  = posSum((vormonatsVerkaufRaw ?? []) as R[])
  const offenePostenListe = (offenePostenRaw ?? []) as R[]
  const offenePosten  = posSum(offenePostenListe)

  const heuteMs = heute.getTime()
  const offenePostenTage = offenePostenListe
    .map(p => Math.floor((heuteMs - new Date(p.datum).getTime()) / 86400000))
    .filter(d => Number.isFinite(d))
  const offenePostenUeberfaellig = offenePostenTage.filter(d => d > ZAHLUNGSZIEL_TAGE).length
  const offenePostenAvgTage = offenePostenTage.length
    ? Math.round(offenePostenTage.reduce((s, d) => s + d, 0) / offenePostenTage.length)
    : 0

  const auftraegeWoche    = auftraegeWocheCount ?? 0
  const auftraegeVorwoche = auftraegeVorwocheCount ?? 0
  const auftraegeDelta    = auftraegeWoche - auftraegeVorwoche

  // Absatzreihe: 12 Monate, älteste zuerst
  const absatzMap = new Map<string, number>()
  for (let i = 0; i < 12; i++) {
    const d = new Date(heute.getFullYear(), heute.getMonth() - 11 + i, 1)
    absatzMap.set(`${d.getFullYear()}-${d.getMonth()}`, 0)
  }
  for (const row of (absatzSeriesRaw ?? []) as R[]) {
    const d = new Date(row.datum)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (!absatzMap.has(key)) continue
    const menge = (row.verkauf_positionen ?? []).reduce((s: number, p: R) => s + (Number(p.menge) || 0), 0)
    absatzMap.set(key, (absatzMap.get(key) ?? 0) + menge)
  }
  const absatzSeries = Array.from(absatzMap.entries()).map(([key, value]) => {
    const [y, m] = key.split('-').map(Number)
    return { label: new Date(y, m, 1).toLocaleDateString('de-AT', { month: 'short' }), value }
  })
  const absatzMax = Math.max(1, ...absatzSeries.map(s => s.value))

  function kundenName(p: R): string {
    if (p.kontakt) return [p.kontakt.vorname, p.kontakt.nachname].filter(Boolean).join(' ')
    if (p.firma)   return p.firma.name
    return '–'
  }

  // Letzte Belege inkl. Betrag/Status pro Zeile
  const belege: R[] = ((letzteVerkaeufRaw ?? []) as R[]).map(v => {
    const betrag = posSum([v])
    const tage = Math.floor((heuteMs - new Date(v.datum).getTime()) / 86400000)
    let status: 'bezahlt' | 'ueberfaellig' | 'offen' | 'storniert' = 'offen'
    if (v.storniert) status = 'storniert'
    else if (v.bezahlt) status = 'bezahlt'
    else if (tage > ZAHLUNGSZIEL_TAGE) status = 'ueberfaellig'
    return { ...v, betrag, status, kunde: kundenName(v) } as R
  })

  const STATUS_LABEL: Record<string, string> = { bezahlt: 'Bezahlt', ueberfaellig: 'Überfällig', offen: 'Offen', storniert: 'Storniert' }
  const STATUS_CLASS: Record<string, string> = {
    bezahlt:     'bg-s112-ok-bg text-s112-ok-fg',
    ueberfaellig:'bg-s112-err-bg text-s112-err-fg',
    offen:       'bg-s112-warn-bg text-s112-warn-fg',
    storniert:   'bg-gray-100 text-gray-500',
  }

  const ART_ICON: Record<string, string> = {
    anruf: '📞', email: '✉', besuch: '🚗', notiz: '📝',
    angebot: '📋', verkostung: '🍷', messe: '🎪',
  }

  // Nächste unerledigte Aktivitäten (für "Nächste Termine")
  const { data: naechsteAktivitaetenRaw } = await tf(q('aktivitaeten')
    .select('id, art, betreff, datum, erledigt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name)')
    .eq('erledigt', false).gte('datum', heuteStr)
    .order('datum', { ascending: true }).limit(4))
  const naechsteAkt = (naechsteAktivitaetenRaw ?? []) as R[]
  function aktKundenName(a: R): string {
    if (a.kontakt) return [a.kontakt.vorname, a.kontakt.nachname].filter(Boolean).join(' ')
    if (a.firma)   return a.firma.name
    return ''
  }

  // Meine Aktivitäten (nächste 30 Tage, offen)
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const { data: meineAkts } = await tf((supabase.from('aktivitaeten') as any)
    .select('id, art, betreff, datum, erledigt, kontakt_id, firma_id, kontakte(vorname,nachname), firmen(name)')
    .eq('erledigt', false)
    .gte('datum', heuteStr).lte('datum', in30)
    .order('datum', { ascending: true }).limit(10))

  const wirtschaftsjahr = heute.getMonth() >= 8
    ? `${heute.getFullYear()}/${String(heute.getFullYear() + 1).slice(2)}`
    : `${heute.getFullYear() - 1}/${String(heute.getFullYear()).slice(2)}`

  return (
    <div className="space-y-6">

      {/* Begrüßung + Primäraktion */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-semibold text-s112-text">{tenantName ?? 'Übersicht'}</h1>
          <p className="text-s112-tertiary text-[11.5px] mt-1">
            Wirtschaftsjahr {wirtschaftsjahr} · Stand {heute.toLocaleDateString('de-AT', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>
        </div>
        <Link href="/weinhandel/verkauf/neu" className="btn-primary inline-flex items-center gap-1.5">
          <Plus size={16} strokeWidth={2} />
          Neuer Auftrag
        </Link>
      </div>

      {/* ── KPI-Kacheln ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Offene Rechnungen */}
        <Link href="/weinhandel/offene-posten" className="bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-1.5">
            <ReceiptText size={18} strokeWidth={1.5} className="text-s112-tertiary" />
            <p className="text-[11.5px] font-semibold text-s112-text-2">Offene Rechnungen</p>
          </div>
          <p className="font-mono text-2xl text-s112-text tabular-nums">
            {offenePosten.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
          </p>
          <p className={`text-[11.5px] ${offenePostenUeberfaellig > 0 ? 'text-s112-err-fg' : 'text-s112-tertiary'}`}>
            {offenePostenListe.length === 0
              ? 'Keine offenen Posten'
              : `${offenePostenUeberfaellig} überfällig · Ø ${offenePostenAvgTage} Tage`}
          </p>
        </Link>

        {/* Lagerbestand */}
        <Link href="/weinhandel" className="bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-1.5">
            <Warehouse size={18} strokeWidth={1.5} className="text-s112-tertiary" />
            <p className="text-[11.5px] font-semibold text-s112-text-2">Lagerbestand</p>
          </div>
          <p className="font-mono text-2xl text-s112-text tabular-nums">{fuellungenCount ?? 0}</p>
          <p className="text-[11.5px] text-s112-tertiary">Artikel mit Bestand</p>
        </Link>

        {/* Aufträge diese Woche */}
        <Link href="/weinhandel/verkauf" className="bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-1.5">
            <Package size={18} strokeWidth={1.5} className="text-s112-tertiary" />
            <p className="text-[11.5px] font-semibold text-s112-text-2">Aufträge diese Woche</p>
          </div>
          <p className="font-mono text-2xl text-s112-text tabular-nums">{auftraegeWoche}</p>
          <p className={`text-[11.5px] ${auftraegeDelta >= 0 ? 'text-s112-ok-fg' : 'text-s112-err-fg'}`}>
            {auftraegeDelta >= 0 ? '▲' : '▼'} {Math.abs(auftraegeDelta)} gegenüber Vorwoche
          </p>
        </Link>

        {/* Kontakte & Leads */}
        <Link href="/crm/kontakte" className="bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-1.5">
            <Users size={18} strokeWidth={1.5} className="text-s112-tertiary" />
            <p className="text-[11.5px] font-semibold text-s112-text-2">Kontakte</p>
          </div>
          <p className="font-mono text-2xl text-s112-text tabular-nums">{kontakteCount ?? 0}</p>
          <p className="text-[11.5px] text-s112-tertiary">{leadCount ?? 0} Leads</p>
        </Link>
      </div>

      {/* ── Balkendiagramm + Tabelle ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Absatz in Flaschen */}
        <div className="lg:col-span-2 bg-white border border-s112-line rounded-xl p-[18px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-[14px] text-s112-text">Absatz in Flaschen</h2>
            <span className="text-[11.5px] text-s112-tertiary">letzte 12 Monate</span>
          </div>
          <div className="h-[120px] flex items-end gap-2.5">
            {absatzSeries.map((s, i) => {
              const color = i === 11 ? 'bg-s112-teal' : i >= 9 ? 'bg-s112-blue-300' : 'bg-s112-blue-100'
              const heightPct = Math.max(3, Math.round((s.value / absatzMax) * 100))
              return (
                <div key={i} className={`flex-1 h-full flex flex-col justify-end ${i < 6 ? 'hidden sm:flex' : ''}`} title={`${s.label}: ${s.value.toLocaleString('de-AT')} Flaschen`}>
                  <div className={`w-full rounded-t-[5px] ${color}`} style={{ height: `${heightPct}%` }} />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-2">
            {absatzSeries.map((s, i) => (
              <span key={i} className={`flex-1 text-center font-mono text-[10.5px] text-s112-tertiary ${i < 6 ? 'hidden sm:block' : ''}`}>{s.label}</span>
            ))}
          </div>
        </div>

        {/* Letzte Belege */}
        <div className="lg:col-span-3 bg-white border border-s112-line rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-[18px] pt-4 pb-2">
            <h2 className="font-display font-semibold text-[14px] text-s112-text">Letzte Belege</h2>
            <Link href="/weinhandel/verkauf" className="text-[11.5px] text-s112-blue-700 hover:underline">alle →</Link>
          </div>
          {belege.length === 0 ? (
            <p className="text-sm text-s112-text-2 px-[18px] pb-5">Noch keine Belege vorhanden.</p>
          ) : (
            <div>
              <div className="grid grid-cols-[1.6fr_1fr_.9fr_.9fr_40px] px-[18px] py-[11px] bg-[#FBFBFC] border-b border-s112-line text-[11px] font-semibold uppercase tracking-[.08em] text-s112-tertiary">
                <span>Kunde</span>
                <span>Beleg-Nr.</span>
                <span>Status</span>
                <span className="text-right">Betrag</span>
                <span />
              </div>
              {belege.map(v => (
                <Link key={v.id} href={`/weinhandel/verkauf/${v.id}`}
                  className="contents">
                  <div className="col-span-5 grid grid-cols-[1.6fr_1fr_.9fr_.9fr_40px] items-center px-[18px] py-[13px] border-t border-[#F4F5F7] text-[13px] hover:bg-[#FAFCFF] transition-colors">
                    <span className="text-s112-text truncate">{v.kunde}</span>
                    <span className="font-mono text-s112-text-2">{v.rechnungsnummer ?? '–'}</span>
                    <span>
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[11.5px] font-semibold ${STATUS_CLASS[v.status]}`}>
                        {STATUS_LABEL[v.status]}
                      </span>
                    </span>
                    <span className="font-mono text-right text-s112-text tabular-nums">
                      {v.betrag.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
                    </span>
                    <span className="text-right text-s112-tertiary">⋯</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Untere zwei Spalten ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Meine Aktivitäten */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 text-sm">Meine Aktivitäten</h2>
            <Link href="/crm" className="text-xs text-s112-blue-700 hover:underline">Kalender →</Link>
          </div>
          {(meineAkts ?? []).length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-s112-muted">Keine offenen Aktivitäten in den nächsten 30 Tagen</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(meineAkts as AR[]).map(a => {
                const who = a.kontakte ? [a.kontakte.vorname, a.kontakte.nachname].filter(Boolean).join(' ') : a.firmen?.name ?? ''
                return (
                  <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-s112-border/30 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{a.betreff}</p>
                      {who && <p className="text-[10px] text-s112-muted truncate">{who}</p>}
                    </div>
                    <span className="text-[10px] text-s112-muted flex-shrink-0">{new Date(a.datum).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Nächste Termine */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 text-sm">Nächste Termine</h2>
            <Link href="/crm" className="text-xs text-s112-blue-700 hover:underline">Kalender →</Link>
          </div>
          {naechsteAkt.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xl mb-1">📅</p>
              <p className="text-xs text-s112-muted">Keine offenen Termine</p>
              <Link href="/crm" className="text-xs text-s112-blue-700 hover:underline mt-1 inline-block">Aktivität anlegen →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {naechsteAkt.map((a: R) => (
                <div key={a.id} className="flex items-start gap-2 py-2 border-b border-s112-border last:border-0">
                  <span className="text-base flex-shrink-0 mt-0.5">{ART_ICON[a.art] ?? '📝'}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{a.betreff || a.art}</p>
                    <p className="text-xs text-s112-muted">
                      {new Date(a.datum).toLocaleDateString('de-AT')}
                      {aktKundenName(a) && <span className="ml-1">· {aktKundenName(a)}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Schnellzugriff ───────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-s112-muted uppercase tracking-wider mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { href: '/weinhandel/verkauf/neu',    icon: '🛒', label: 'Neuer Verkauf'    },
            { href: '/weinhandel/fuellungen/neu',  icon: '🍾', label: 'Füllen'           },
            { href: '/crm',                        icon: '📅', label: 'Aktivität'        },
            { href: '/kellerbuch/umziehen',        icon: '🔄', label: 'Umziehen'         },
            { href: '/weinhandel/offene-posten',   icon: '💶', label: 'Offene Posten'    },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="card p-4 flex items-center gap-3 hover:border-s112-teal hover:shadow-sm transition-all">
              <span className="text-xl">{item.icon}</span>
              <span className="text-sm font-medium text-gray-700">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
