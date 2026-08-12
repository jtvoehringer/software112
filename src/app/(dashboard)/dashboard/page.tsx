import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ReceiptText, Package, Users, ShoppingCart, Calendar, Wallet } from 'lucide-react'

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
  // Für den "Meine Aktivitäten"-Filter unten (5.8.2026: die Sektion zeigte bisher ALLE
  // Aktivitäten des Betriebs, nicht nur die eigenen - kein User-Bezug im Code vorhanden).
  const { data: { user: currentUser } } = await supabase.auth.getUser()
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
    { data: offenePostenRaw },
    { data: monatsVerkaufRaw },
    { data: vormonatsVerkaufRaw },
    { data: letzteVerkaeufRaw },
    { count: kontakteCount },
    { count: leadCount },
    { count: firmaLeadCount },
    { count: auftraegeWocheCount },
    { count: auftraegeVorwocheCount },
    { data: absatzSeriesRaw },
  ] = await Promise.all([
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

    // Überfällige Rechnungen (bis 5.8.2026: letzte 5 Belege unabhängig vom Status - auf
    // Wunsch auf ausschließlich überfällige umgestellt). Weiter gefasste Vorab-Filterung
    // (unbezahlt + nicht storniert, größeres Limit) - die eigentliche >30-Tage-Filterung
    // und Sortierung nach längster Überfälligkeit passiert unten in JS wie bei den übrigen
    // Überfällig-Berechnungen dieser Seite (ZAHLUNGSZIEL_TAGE).
    tf(q('verkaufsposten')
      .select('id, datum, rechnungsnummer, bezahlt, storniert, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name), positionen:verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).eq('bezahlt', false).eq('storniert', false).order('datum', { ascending: true }).limit(200)),

    tf(q('kontakte').select('*', { count: 'exact', head: true }).eq('aktiv', true)),
    tf(q('kontakte').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('is_lead', true)),
    // Firmen-Leads separat zählen (Bugreport 12.8.2026: Leads-Kachel zeigte nur Kontakt-Leads,
    // Firmen können aber genauso als Lead gefuehrt werden - siehe firmen.is_lead, Migration 034)
    tf(q('firmen').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('is_lead', true)),

    // Aufträge diese Woche / Vorwoche (für Vergleich)
    tf(q('verkaufsposten').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('storniert', false).gte('datum', wochenStartStr)),
    tf(q('verkaufsposten').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('storniert', false).gte('datum', vorwochenStartStr).lte('datum', vorwochenEndeStr)),

    // Umsatzreihe der letzten 12 Monate für das Balkendiagramm (bis 5.8.2026: Flaschen-
    // Absatz/Menge statt Umsatz - auf Wunsch umgestellt, daher jetzt Preis/Rabatt-Felder
    // statt nur Menge, um wie bei posSum() den tatsächlichen Netto-Umsatz zu berechnen)
    tf(q('verkaufsposten')
      .select('datum, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
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

  // Umsatzreihe: 12 Monate, älteste zuerst (auf Wunsch von Flaschen-Absatz auf Umsatz
  // umgestellt, 5.8.2026 - posSum() pro Zeile statt reiner Mengen-Summe)
  const absatzMap = new Map<string, number>()
  for (let i = 0; i < 12; i++) {
    const d = new Date(heute.getFullYear(), heute.getMonth() - 11 + i, 1)
    absatzMap.set(`${d.getFullYear()}-${d.getMonth()}`, 0)
  }
  for (const row of (absatzSeriesRaw ?? []) as R[]) {
    const d = new Date(row.datum)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (!absatzMap.has(key)) continue
    const umsatz = posSum([row])
    absatzMap.set(key, (absatzMap.get(key) ?? 0) + umsatz)
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

  // Überfällige Rechnungen inkl. Betrag/Tage pro Zeile (bis 5.8.2026: letzte 5 Belege
  // unabhängig vom Status - auf Wunsch auf ausschließlich überfällige umgestellt, längste
  // Überfälligkeit zuerst). Die Vorab-Query liefert bereits nur unbezahlte/nicht stornierte
  // Belege, hier zusätzlich auf > ZAHLUNGSZIEL_TAGE gefiltert.
  const belege: R[] = ((letzteVerkaeufRaw ?? []) as R[])
    .map(v => {
      const betrag = posSum([v])
      const tage = Math.floor((heuteMs - new Date(v.datum).getTime()) / 86400000)
      return { ...v, betrag, tage, kunde: kundenName(v) } as R
    })
    .filter(v => v.tage > ZAHLUNGSZIEL_TAGE)
    .sort((a, b) => b.tage - a.tage)
    .slice(0, 5)

  // Nächste unerledigte Aktivitäten (für "Nächste Termine")
  // art-Ausschluss analog zum Kalender (crm/page.tsx) ergänzt (7.8.2026): automatisch
  // angelegte E-Mail-/Verkaufs-/Notiz-Einträge sind keine "Termine" und haben hier bisher
  // die wenigen Plätze (limit 4) belegt, wodurch die Sektion faelschlich leer wirkte.
  const { data: naechsteAktivitaetenRaw } = await tf(q('aktivitaeten')
    .select('id, art, betreff, datum, erledigt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name)')
    .eq('erledigt', false).gte('datum', heuteStr)
    .not('art', 'in', '(verkauf,notiz,email)')
    .order('datum', { ascending: true }).limit(4))
  const naechsteAkt = (naechsteAktivitaetenRaw ?? []) as R[]
  function aktKundenName(a: R): string {
    if (a.kontakt) return [a.kontakt.vorname, a.kontakt.nachname].filter(Boolean).join(' ')
    if (a.firma)   return a.firma.name
    return ''
  }

  // Meine Aktivitäten (nächste 30 Tage, offen, NUR eigene - auf Wunsch echter User-Filter
  // auf erstellt_von ergänzt, 5.8.2026: vorher wurden hier alle Aktivitäten des ganzen
  // Betriebs gezeigt, nicht nur die des angemeldeten Users)
  //
  // Zusatz 7.8.2026: erstellt_von ist bei Alt-/Importdaten (von vor der Nachverfolgung)
  // sowie bei inzwischen entfernten Erstellern (ON DELETE SET NULL, Migration 050) oft
  // NULL - ein reines .eq('erstellt_von', currentUser.id) liess dadurch fast alle
  // Aktivitäten verschwinden ("eher leer"-Feedback), obwohl sie inhaltlich durchaus dem
  // aktuellen User zuzurechnen waeren. Solche unattribuierten Eintraege daher zusaetzlich
  // mit anzeigen, statt sie stillschweigend auszublenden (gleiche Logik wie im
  // Kalender-Filter, CRMUebersichtClient.tsx).
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const { data: meineAkts } = currentUser
    ? await tf((supabase.from('aktivitaeten') as any)
        .select('id, art, betreff, datum, erledigt, kontakt_id, firma_id, kontakte(vorname,nachname), firmen(name)')
        .eq('erledigt', false).or(`erstellt_von.eq.${currentUser.id},erstellt_von.is.null`)
        .gte('datum', heuteStr).lte('datum', in30)
        .order('datum', { ascending: true }).limit(10))
    : { data: [] }

  const wirtschaftsjahr = heute.getMonth() >= 8
    ? `${heute.getFullYear()}/${String(heute.getFullYear() + 1).slice(2)}`
    : `${heute.getFullYear() - 1}/${String(heute.getFullYear()).slice(2)}`

  return (
    <div className="space-y-6">

      {/* Begrüßung */}
      {/* "+ Neuer Auftrag"-Button auf Wunsch entfernt (7.8.2026). */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-semibold text-s112-text">{tenantName ?? 'Übersicht'}</h1>
          <p className="text-s112-tertiary text-[11.5px] mt-1">
            Wirtschaftsjahr {wirtschaftsjahr} · Stand {heute.toLocaleDateString('de-AT', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>
        </div>
      </div>

      {/* ── KPI-Kacheln ─────────────────────────────────────────────── */}
      {/* Lagerbestand-Kachel auf Wunsch entfernt (5.8.2026) - daher 3 statt 4 Kacheln,
          Grid entsprechend auf lg:grid-cols-3 angepasst. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3.5">
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

        {/* Leads (auf Wunsch von "Kontakte" umgestellt, 5.8.2026: Hauptzahl jetzt Leads,
            Gesamt-Kontakte in der Unterzeile). Bugfix 12.8.2026: Leads gibt es sowohl bei
            Kontakten als auch bei Firmen (jeweils eigenes is_lead-Feld) - die Kachel zeigte
            bisher nur die Kontakt-Leads, Firmen-Leads fehlten in der Summe. */}
        <Link href="/crm/kontakte" className="bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-1.5">
            <Users size={18} strokeWidth={1.5} className="text-s112-tertiary" />
            <p className="text-[11.5px] font-semibold text-s112-text-2">Leads</p>
          </div>
          <p className="font-mono text-2xl text-s112-text tabular-nums">{(leadCount ?? 0) + (firmaLeadCount ?? 0)}</p>
          <p className="text-[11.5px] text-s112-tertiary">{kontakteCount ?? 0} Kontakte gesamt</p>
        </Link>
      </div>

      {/* ── Balkendiagramm + Tabelle ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Umsatz (bis 5.8.2026: Absatz in Flaschen - auf Wunsch auf Umsatz in € umgestellt) */}
        <div className="lg:col-span-2 bg-white border border-s112-line rounded-xl p-[18px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-[14px] text-s112-text">Umsatz</h2>
            <span className="text-[11.5px] text-s112-tertiary">letzte 12 Monate</span>
          </div>
          <div className="h-[120px] flex items-end gap-2.5">
            {absatzSeries.map((s, i) => {
              const color = i === 11 ? 'bg-s112-teal' : i >= 9 ? 'bg-s112-blue-300' : 'bg-s112-blue-100'
              const heightPct = Math.max(3, Math.round((s.value / absatzMax) * 100))
              return (
                <div key={i} className={`flex-1 h-full flex flex-col justify-end ${i < 6 ? 'hidden sm:flex' : ''}`} title={`${s.label}: ${s.value.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}`}>
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

        {/* Überfällige Rechnungen (bis 5.8.2026: Letzte Belege - auf Wunsch umgestellt) */}
        <div className="lg:col-span-3 bg-white border border-s112-line rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-[18px] pt-4 pb-2">
            <h2 className="font-display font-semibold text-[14px] text-s112-text">Überfällige Rechnungen</h2>
            <Link href="/weinhandel/offene-posten" className="text-[11.5px] text-s112-blue-700 hover:underline">alle →</Link>
          </div>
          {belege.length === 0 ? (
            <p className="text-sm text-s112-text-2 px-[18px] pb-5">Keine überfälligen Rechnungen.</p>
          ) : (
            <div>
              <div className="grid grid-cols-[1.6fr_1fr_.9fr_.9fr_40px] px-[18px] py-[11px] bg-[#FBFBFC] border-b border-s112-line text-[11px] font-semibold uppercase tracking-[.08em] text-s112-tertiary">
                <span>Kunde</span>
                <span>Beleg-Nr.</span>
                <span>Überfällig</span>
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
                      <span className="inline-block px-2.5 py-1 rounded-full text-[11.5px] font-semibold bg-s112-err-bg text-s112-err-fg">
                        {v.tage} Tage
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
            <div className="flex items-center gap-3">
              <Link href="/crm" className="text-xs text-s112-blue-700 hover:underline">alle →</Link>
              <Link href="/crm" className="text-xs text-s112-blue-700 hover:underline">Kalender →</Link>
            </div>
          </div>
          {naechsteAkt.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-s112-muted">Keine offenen Termine</p>
              <Link href="/crm" className="text-xs text-s112-blue-700 hover:underline mt-1 inline-block">Aktivität anlegen →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {naechsteAkt.map((a: R) => (
                <div key={a.id} className="flex items-start gap-2 py-2 border-b border-s112-border last:border-0">
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
      {/* "Füllen" und "Umziehen" auf Wunsch entfernt (5.8.2026) - Grid entsprechend auf
          sm:grid-cols-3 angepasst. */}
      <div>
        <h2 className="text-xs font-semibold text-s112-muted uppercase tracking-wider mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { href: '/weinhandel/verkauf/neu',    icon: ShoppingCart,   label: 'Neuer Verkauf'    },
            { href: '/crm',                        icon: Calendar,       label: 'Aktivität'        },
            { href: '/weinhandel/offene-posten',   icon: Wallet,         label: 'Offene Posten'    },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="card p-4 flex items-center gap-3 hover:border-s112-teal hover:shadow-sm transition-all">
              <item.icon size={20} strokeWidth={1.75} className="text-s112-teal" />
              <span className="text-sm font-medium text-gray-700">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
