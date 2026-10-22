import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen, gezaehlt } from '@/lib/supabase/geladen'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { ReceiptText, Package, Users, ShoppingCart, Calendar, Wallet } from 'lucide-react'
import { DashHeader, Card, BarRow, Empty, fmtNum, fmtEur } from '../_shared/ui'
import { getCtx, ladeFlaschenlager, ladeOffenePosten } from '../_shared/data'
import { ladeUmsatzRechnungen, umsatzJeMonat, UMSATZ_BESCHRIFTUNG } from '@/lib/verkauf/umsatz'
import { faelligText } from '@/lib/verkauf/faelligkeit'
import { AktionsFehler } from '@/lib/fehler'
import { wienJetzt, lokalerTag } from '@/lib/datum/wien'

export const metadata: Metadata = { title: 'Verkauf & CRM' }
export const dynamic = 'force-dynamic'
type AR = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function startOfWeek(d: Date) {
  const day = d.getDay() // 0 = Sonntag ... 6 = Samstag
  const diff = (day === 0 ? -6 : 1) - day // auf Montag verschieben
  const s = new Date(d)
  s.setDate(d.getDate() + diff)
  s.setHours(0, 0, 0, 0)
  return s
}
// KAN-158: aus den lokalen Feldern (Wiener Wandzeit), nicht über toISOString
const toDateStr = lokalerTag

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
    const tenantRow = geladen(await (supabase.from('tenants') as any).select('name').eq('id', tenantId).maybeSingle(), 'Betrieb')
    tenantName = (tenantRow as { name?: string } | null)?.name ?? null
  }

  const heute = wienJetzt()   // KAN-158: Monatswechsel nach Wiener Uhr
  const heuteStr  = toDateStr(heute)

  const wochenStart      = startOfWeek(heute)
  const wochenStartStr   = toDateStr(wochenStart)
  const vorwochenStart   = new Date(wochenStart); vorwochenStart.setDate(vorwochenStart.getDate() - 7)
  const vorwochenStartStr = toDateStr(vorwochenStart)
  const vorwochenEndeStr  = toDateStr(new Date(wochenStart.getTime() - 86400000))

  // 12-Monats-Fenster für die Absatzreihe im Balkendiagramm
  const absatzVon = toDateStr(new Date(heute.getFullYear(), heute.getMonth() - 11, 1))
  const absatzBis = toDateStr(new Date(heute.getFullYear(), heute.getMonth() + 1, 0))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (t: string) => (supabase.from(t) as any)
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft KPIs vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    leadRes,
    firmaLeadRes,
    auftraegeWocheRes,
    auftraegeVorwocheRes,
    umsatzRes,
  ] = await Promise.all([
    // Gesamt-Kontaktzahl bewusst nicht mehr abgefragt (Feedback 12.8.2026: "Gesamtzahl ist
    // irrelevant") - die Unterzeile zeigt stattdessen die Aufteilung Kontakte-Leads/Firmen-Leads.
    tf(q('kontakte').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('is_lead', true)),
    // Firmen-Leads separat zählen (Bugreport 12.8.2026: Leads-Kachel zeigte nur Kontakt-Leads,
    // Firmen können aber genauso als Lead gefuehrt werden - siehe firmen.is_lead, Migration 034)
    tf(q('firmen').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('is_lead', true)),

    // Aufträge diese Woche / Vorwoche (für Vergleich)
    tf(q('verkaufsposten').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('storniert', false).gte('datum', wochenStartStr)),
    tf(q('verkaufsposten').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('storniert', false).gte('datum', vorwochenStartStr).lte('datum', vorwochenEndeStr)),

    // KAN-346: Umsatzreihe der letzten 12 Monate netto nach Rechnungsdatum (zentral, wie Auswertung und Finanzübersicht;
    // vorher brutto nach Lieferdatum über alle Lieferscheine, auch nicht berechnete)
    tenantId ? ladeUmsatzRechnungen(supabase, tenantId, absatzVon, absatzBis) : Promise.resolve({ data: [], error: null }),
  ])
  // Sweep 89 (KAN-281): Lesefehler werfen (Fehlergrenze) statt falscher Umsätze und offener Posten
  const umsatzRechnungen = geladen(umsatzRes, 'Umsatzreihe')
  const leadCount = gezaehlt(leadRes, 'Leads')
  const firmaLeadCount = gezaehlt(firmaLeadRes, 'Firmen-Leads')
  const auftraegeWocheCount = gezaehlt(auftraegeWocheRes, 'Aufträge der Woche')
  const auftraegeVorwocheCount = gezaehlt(auftraegeVorwocheRes, 'Aufträge der Vorwoche')

  const ctx = await getCtx()
  const [flaschen, offen] = await Promise.all([ladeFlaschenlager(ctx), ladeOffenePosten(ctx)])
  // KAN-346/374: offene Posten zentral (Rechnungen, nach Teilzahlungen, überfällig ab Fälligkeit nach Kundenziel)
  if (offen.fehler) throw new AktionsFehler(`Offene Posten konnten nicht geladen werden: ${offen.fehler}`)

  const auftraegeWoche    = auftraegeWocheCount ?? 0
  const auftraegeVorwoche = auftraegeVorwocheCount ?? 0
  const auftraegeDelta    = auftraegeWoche - auftraegeVorwoche

  // Umsatzreihe: 12 Monate, älteste zuerst, netto nach Rechnungsdatum (KAN-346)
  const monate = Array.from({ length: 12 }, (_, i) => toDateStr(new Date(heute.getFullYear(), heute.getMonth() - 11 + i, 1)).slice(0, 7))
  const jeMonat = umsatzJeMonat(umsatzRechnungen ?? [], monate)
  const absatzSeries = monate.map(m => {
    const [y, mo] = m.split('-').map(Number)
    return { label: new Date(y, mo - 1, 1).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', month: 'short' }), value: jeMonat.get(m)?.umsatz ?? 0 }
  })
  const absatzMax = Math.max(1, ...absatzSeries.map(s => s.value))

  // Überfällige Rechnungen (KAN-374): ab Fälligkeit nach Kundenziel, längster Verzug zuerst
  const belege = offen.liste
    .filter(p => p.ueberfaellig)
    .sort((a, b) => b.verzugTage - a.verzugTage)
    .slice(0, 5)

  // Nächste unerledigte Aktivitäten (für "Nächste Termine")
  // art-Ausschluss analog zum Kalender (crm/page.tsx) ergänzt (7.8.2026): automatisch
  // angelegte E-Mail-/Verkaufs-/Notiz-Einträge sind keine "Termine" und haben hier bisher
  // die wenigen Plätze (limit 4) belegt, wodurch die Sektion faelschlich leer wirkte.
  const naechsteAktivitaetenRaw = geladen(await tf(q('aktivitaeten')
    .select('id, art, betreff, datum, erledigt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name)')
    .eq('erledigt', false).gte('datum', heuteStr)
    .not('art', 'in', '(verkauf,notiz,email)')
    .order('datum', { ascending: true }).limit(4)), 'Termine')
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
  // Kalender-Filter; den Privat-Filter dort macht crm/page.tsx serverseitig).
  //
  // Zusatz 24.9.2026: private Einträge ohne Ersteller (Ersteller gelöscht, FK seit
  // Migration legacy_nachtrag_025_050_052 ON DELETE SET NULL) bleiben ausgeblendet -
  // sonst sähe jeder im Betrieb Betreff und Kunde fremder privater Termine.
  const in30 = toDateStr(new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + 30))
  const { data: meineAkts } = currentUser
    ? await tf((supabase.from('aktivitaeten') as any)
        .select('id, art, betreff, datum, erledigt, kontakt_id, firma_id, kontakte(vorname,nachname), firmen(name)')
        .eq('erledigt', false).or(`erstellt_von.eq.${currentUser.id},and(erstellt_von.is.null,ist_privat.not.is.true)`)
        .gte('datum', heuteStr).lte('datum', in30)
        .order('datum', { ascending: true }).limit(10))
    : { data: [] }

  return (
    <div className="space-y-6">

      {/* Sicht "Verkauf & CRM" des Dashboard-Relaunch (27.8.2026): Inhalt = das
          bisherige Dashboard (Umbau 5./12.8.2026) unverändert, ergänzt um den
          Flaschenbestand nach Rebsorte. */}
      <DashHeader
        title="Verkauf & CRM"
        sub={`Umsatz, Aufträge und offene Posten laufend im Blick – Stand ${heute.toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'long', day: '2-digit', month: 'long' })}${tenantName ? ` · ${tenantName}` : ''}`}
      />

      {/* ── KPI-Kacheln ─────────────────────────────────────────────── */}
      {/* Lagerbestand-Kachel auf Wunsch entfernt (5.8.2026) - daher 3 statt 4 Kacheln,
          Grid entsprechend auf lg:grid-cols-3 angepasst. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3.5">
        {/* Offene Rechnungen */}
        <Link href="/weinhandel/offene-posten" className="bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2 hover:shadow-xs transition-shadow">
          <div className="flex items-center gap-1.5">
            <ReceiptText size={18} strokeWidth={1.5} className="text-s112-tertiary" />
            <p className="text-[11.5px] font-semibold text-s112-text-2">Offene Rechnungen</p>
          </div>
          <p className="font-mono text-xl sm:text-2xl text-s112-text tabular-nums">
            {fmtEur(offen.summe)}
          </p>
          <p className={`text-[11.5px] ${offen.ueberfaellig > 0 ? 'text-s112-err-fg' : 'text-s112-tertiary'}`}>
            {offen.anzahl === 0
              ? 'Keine offenen Posten'
              : offen.ueberfaellig > 0 ? `${offen.ueberfaellig} überfällig · ${fmtEur(offen.ueberfaelligSumme)}` : `${offen.anzahl} offen · Ø ${offen.avgAlterTage} Tage seit Rechnung`}
          </p>
        </Link>

        {/* Aufträge diese Woche */}
        <Link href="/weinhandel/verkauf" className="bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2 hover:shadow-xs transition-shadow">
          <div className="flex items-center gap-1.5">
            <Package size={18} strokeWidth={1.5} className="text-s112-tertiary" />
            <p className="text-[11.5px] font-semibold text-s112-text-2">Aufträge diese Woche</p>
          </div>
          <p className="font-mono text-xl sm:text-2xl text-s112-text tabular-nums">{auftraegeWoche}</p>
          <p className={`text-[11.5px] ${auftraegeDelta >= 0 ? 'text-s112-ok-fg' : 'text-s112-err-fg'}`}>
            {auftraegeDelta >= 0 ? '▲' : '▼'} {Math.abs(auftraegeDelta)} gegenüber Vorwoche
          </p>
        </Link>

        {/* Leads (auf Wunsch von "Kontakte" umgestellt, 5.8.2026: Hauptzahl jetzt Leads,
            Gesamt-Kontakte in der Unterzeile). Bugfix 12.8.2026: Leads gibt es sowohl bei
            Kontakten als auch bei Firmen (jeweils eigenes is_lead-Feld) - die Kachel zeigte
            bisher nur die Kontakt-Leads, Firmen-Leads fehlten in der Summe. Anpassung
            12.8.2026 (2): Unterzeile zeigt jetzt die Aufteilung Kontakte/Firmen statt der
            (fachlich irrelevanten) Gesamt-Kontaktanzahl. Anpassung 12.8.2026 (3): Kachel ist
            nicht mehr als Ganzes ein Link (zwei unterschiedliche Ziele je nach Kontakt/Firma
            möglich) - stattdessen sind "Kontakt(e)" und "Firma/Firmen" in der Unterzeile
            jeweils einzeln verlinkt und springen direkt auf die entsprechend gefilterte
            Lead-Liste (?filter=lead). */}
        <div className="bg-white border border-s112-line rounded-xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Users size={18} strokeWidth={1.5} className="text-s112-tertiary" />
            <p className="text-[11.5px] font-semibold text-s112-text-2">Leads</p>
          </div>
          <p className="font-mono text-xl sm:text-2xl text-s112-text tabular-nums">{(leadCount ?? 0) + (firmaLeadCount ?? 0)}</p>
          <p className="text-[11.5px] text-s112-tertiary">
            <Link href="/crm/kontakte?filter=lead" className="hover:text-s112-blue-700 hover:underline">
              {leadCount ?? 0} {(leadCount ?? 0) === 1 ? 'Kontakt' : 'Kontakte'}
            </Link>
            {' · '}
            <Link href="/crm/firmen?filter=lead" className="hover:text-s112-blue-700 hover:underline">
              {firmaLeadCount ?? 0} {(firmaLeadCount ?? 0) === 1 ? 'Firma' : 'Firmen'}
            </Link>
          </p>
        </div>
      </div>

      {/* ── Balkendiagramm + Tabelle ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Umsatz (bis 5.8.2026: Absatz in Flaschen - auf Wunsch auf Umsatz in € umgestellt) */}
        <div className="lg:col-span-2 bg-white border border-s112-line rounded-xl p-[18px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-[14px] text-s112-text">{UMSATZ_BESCHRIFTUNG}</h2>
            <span className="text-[11.5px] text-s112-tertiary">letzte 12 Monate</span>
          </div>
          <div className="h-[120px] flex items-end gap-2.5">
            {absatzSeries.map((s, i) => {
              const color = i === 11 ? 'bg-s112-teal' : i >= 9 ? 'bg-s112-blue-300' : 'bg-s112-blue-100'
              const heightPct = Math.max(3, Math.round((s.value / absatzMax) * 100))
              return (
                <div key={i} className={`flex-1 h-full flex flex-col justify-end ${i < 6 ? 'hidden sm:flex' : ''}`} title={`${s.label}: ${fmtEur(s.value)}`}>
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
              <div className="grid grid-cols-[1.6fr_.9fr_.9fr] sm:grid-cols-[1.6fr_1fr_.9fr_.9fr_40px] px-[18px] py-[11px] bg-s112-bg border-b border-s112-line text-[11px] font-semibold uppercase tracking-[.08em] text-s112-tertiary">
                <span>Kunde</span>
                <span className="max-sm:hidden">Rechnung</span>
                <span>Verzug</span>
                <span className="text-right">Offen</span>
                <span className="max-sm:hidden" />
              </div>
              {belege.map(v => (
                <Link key={v.id} href={`/weinhandel/rechnungen/${v.id}`}
                  className="contents">
                  <div className="col-span-5 grid grid-cols-[1.6fr_.9fr_.9fr] sm:grid-cols-[1.6fr_1fr_.9fr_.9fr_40px] items-center px-[18px] py-[13px] border-t border-[#F2F3F5] text-[13px] hover:bg-s112-bg transition-colors">
                    <span className="text-s112-text truncate">{v.kunde}</span>
                    <span className="max-sm:hidden font-mono text-s112-text-2">{v.rechnungsnummer ?? '–'}</span>
                    <span>
                      <span title={faelligText(v)} className="inline-block px-2.5 py-1 rounded-full text-[11.5px] font-semibold bg-s112-err-bg text-s112-err-fg">
                        {v.verzugTage} Tage
                      </span>
                    </span>
                    <span className="font-mono text-right text-s112-text tabular-nums">
                      {fmtEur(v.offen)}
                    </span>
                    <span className="max-sm:hidden text-right text-s112-tertiary">⋯</span>
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
            <h2 className="font-semibold text-s112-text-1 text-sm">Meine Aktivitäten</h2>
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
                      <p className="text-xs font-medium text-s112-text truncate">{a.betreff}</p>
                      {who && <p className="text-[11px] text-s112-muted truncate">{who}</p>}
                    </div>
                    <span className="text-[11px] text-s112-muted shrink-0">{new Date(a.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit' })}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Nächste Termine */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-s112-text-1 text-sm">Nächste Termine</h2>
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
                    <p className="text-sm font-medium text-s112-text truncate">{a.betreff || a.art}</p>
                    <p className="text-xs text-s112-muted">
                      {new Date(a.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
                      {aktKundenName(a) && <span className="ml-1">· {aktKundenName(a)}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Flaschenbestand nach Rebsorte (neu, Dashboard-Relaunch) ───────── */}
      <Card title="Flaschenbestand nach Rebsorte" right={<Link href="/weinhandel" className="text-[11.5px] text-s112-blue-700 hover:underline">Warenlager →</Link>}>
        {flaschen.nachRebsorte.length === 0 ? (
          <Empty action={{ href: '/weinhandel/fuellungen/neu', label: 'Erste Füllung anlegen' }}>Noch keine Füllungen mit Bestand.</Empty>
        ) : (
          <div>
            {flaschen.nachRebsorte.slice(0, 8).map((r, i) => (
              <BarRow key={r.rebsorte} label={r.rebsorte} value={r.flaschen} max={flaschen.nachRebsorte[0].flaschen} text={`${fmtNum(r.flaschen)} Fl.`} tone={i === 0 ? 1 : 2} labelWidth={130} />
            ))}
            <p className="text-[11.5px] text-s112-tertiary mt-2">Gesamt {fmtNum(flaschen.bestand)} Flaschen · {fmtNum(flaschen.abgefuelltWoche)} abgefüllt diese Woche</p>
          </div>
        )}
      </Card>

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
              className="card p-4 flex items-center gap-3 hover:border-s112-teal hover:shadow-xs transition-all">
              <item.icon size={20} strokeWidth={1.75} className="text-s112-blue-700" />
              <span className="text-sm font-medium text-s112-text-1">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
