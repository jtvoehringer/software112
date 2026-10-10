/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
// ── CRM › Gemeinsames CRM (KAN-212, 06.10.2026) ──────────────────────────────────────────────────────────────────────
// Nur lesende Ansicht der Kontakte und Firmen, die ein anderer Betrieb über die CRM-Gemeinschaft freigegeben hat
// (Administration › Gemeinschaften), samt letzten Aktivitäten (ohne private) und offener Pipeline. Bearbeiten nur im
// Betrieb des Eigentümers; verwenden in eigenen Belegen über die Kunden-/Lieferantensuche (Hinweis „aus <Betrieb>“).
// Kundennummer des Eigentümers nur zur Anzeige – sie geht nicht auf eigene Belege (Momentaufnahme, Migration KAN-212).
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership } from '@/lib/auth/roles'
import { inBloecken } from '@/lib/supabase/alle'
import { suchFilter, KONTAKT_SUCHSPALTEN, FIRMA_SUCHSPALTEN } from '@/lib/crm/liste'
import { fremderBetrieb, ladeCrmGemeinschaft } from '@/lib/crm/gemeinschaft'
import { kontaktAnzeigename } from '@/lib/crm/titel'
import ListenSuche from '@/components/ui/ListenSuche'
import Link from '@/components/ui/Link'
import type { Metadata } from 'next'
import { ZAHL_LOCALE } from '@/lib/format'

export const metadata: Metadata = { title: 'Gemeinsames CRM – software:112' }
export const dynamic = 'force-dynamic'
type R = Record<string, any>

const ANZAHL = 100
const datum = (d: unknown) => (typeof d === 'string' && d ? new Date(d).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' }) : '')

export default async function GemeinsamesCrmPage({ searchParams }: { searchParams: Promise<{ q?: string; art?: string }> }) {
  const sp = await searchParams
  const q = (sp.q ?? '').trim().slice(0, 100)
  const art: 'kontakte' | 'firmen' = sp.art === 'firmen' ? 'firmen' : 'kontakte'
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const g = await ladeCrmGemeinschaft(supabase, tenantId)
  const eigentuemer = g.alsNutzer.map(p => p.tenant_id)

  let rows: R[] = []
  const aktJe = new Map<string, R[]>()
  const pipeJe = new Map<string, R[]>()
  if (tenantId && eigentuemer.length > 0) {
    const fk = art === 'kontakte' ? 'kontakt_id' : 'firma_id'
    let abfrage: any = art === 'kontakte'
      ? (supabase.from('kontakte') as any).select('id, tenant_id, titel, vorname, nachname, titel_nachgestellt, accountnummer, strasse, plz, ort, telefon, telefon_vorwahl, mobil, mobil_vorwahl, email, betrieb_nr, firmen:firma_id(name)').in('tenant_id', eigentuemer).limit(ANZAHL)   // tenant-isolation-ignore: KAN-212 CRM-Gemeinschaft – nur die freigebenden Betriebe (RLS kontakte_crm_partner)
      : (supabase.from('firmen') as any).select('id, tenant_id, name, accountnummer, strasse, plz, ort, telefon, telefon_vorwahl, email, uid_nummer, betrieb_nr').in('tenant_id', eigentuemer).limit(ANZAHL)   // tenant-isolation-ignore: KAN-212 CRM-Gemeinschaft – nur die freigebenden Betriebe (RLS firmen_crm_partner)
    abfrage = abfrage.eq('aktiv', true)
    for (const f of suchFilter(art === 'kontakte' ? KONTAKT_SUCHSPALTEN : FIRMA_SUCHSPALTEN, q)) abfrage = abfrage.or(f)
    abfrage = art === 'kontakte' ? abfrage.order('nachname').order('vorname', { nullsFirst: false }) : abfrage.order('name')
    const data = geladen(await abfrage.order('id'), 'Kontakte der Gemeinschaft')   // erste 100 Treffer (limit oben), die Suche grenzt ein
    rows = (data ?? []) as R[]
    const ids = rows.map(r => String(r.id))
    const [aktRes, pipeRes] = await Promise.all([
      inBloecken<R>(ids, b =>
        // tenant-isolation-ignore: KAN-212 CRM-Gemeinschaft – Aktivitäten der freigebenden Betriebe (ohne private, RLS akt_crm_partner)
        (supabase.from('aktivitaeten') as any).select(`id, ${fk}, art, betreff, datum, erledigt`).in('tenant_id', eigentuemer).in(fk, b)
          .order('datum', { ascending: false }).limit(500)),   // alle-ausnahme: letzte Aktivitäten je Block, Anzeige je Datensatz höchstens 5
      inBloecken<R>(ids, b =>
        // tenant-isolation-ignore: KAN-212 CRM-Gemeinschaft – Pipeline der freigebenden Betriebe (RLS pipe_crm_partner)
        (supabase.from('pipeline_eintraege') as any).select(`id, ${fk}, titel, stufe, wert_euro, erwartetes_datum`).in('tenant_id', eigentuemer).in(fk, b)
          .order('aktualisiert_am', { ascending: false }).limit(500)),   // alle-ausnahme: offene Chancen je Block, Anzeige je Datensatz
    ])
    const akt = geladen(aktRes, 'Aktivitäten')
    const pipe = geladen(pipeRes, 'Pipeline')
    for (const a of (akt ?? []) as R[]) { const k = String(a[fk]); aktJe.set(k, [...(aktJe.get(k) ?? []), a]) }
    for (const p of (pipe ?? []) as R[]) { const k = String(p[fk]); pipeJe.set(k, [...(pipeJe.get(k) ?? []), p]) }
  }

  const reiter = (a: 'kontakte' | 'firmen', label: string) => (
    <Link href={`/crm/gemeinsam?art=${a}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
      className={`px-3 py-1.5 rounded-lg text-sm ${art === a ? 'bg-s112-teal text-s112-yellow font-semibold' : 'text-s112-text-2 hover:bg-s112-bg'}`}>{label}</Link>
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">Gemeinsames CRM</h1>
        <p className="text-sm text-s112-muted mt-0.5">
          {eigentuemer.length > 0
            ? `Kontakte und Firmen aus ${g.alsNutzer.map(p => p.name).join(', ')} – nur lesen. Bearbeiten kann nur der jeweilige Betrieb; in eigenen Verkäufen, Zukäufen und Traubenverkäufen sind sie über die Kunden- bzw. Lieferantensuche wählbar (ohne dessen Rabatt und Kundennummer).`
            : 'Für diesen Betrieb ist keine CRM-Gemeinschaft eingerichtet. Sie wird vom Plattform-Admin unter Administration › Gemeinschaften freigegeben.'}
        </p>
      </div>
      {eigentuemer.length > 0 && (
        <>
          <div className="flex gap-2" role="tablist" aria-label="Kontakte oder Firmen">
            {reiter('kontakte', 'Kontakte')}
            {reiter('firmen', 'Firmen')}
          </div>
          <ListenSuche q={q} pfad="/crm/gemeinsam" behalten={{ art }} platzhalter={art === 'kontakte' ? 'Name, Ort, E-Mail, Kundennr. …' : 'Name, Ort, UID, Kundennr. …'} />
          {rows.length === 0 ? (
            <div className="card p-8 text-center text-sm text-s112-muted">{q ? `Nichts gefunden zu „${q}“.` : 'Keine Einträge.'}</div>
          ) : (
            <div className="card p-0 divide-y divide-s112-border">
              {rows.map(r => {
                const akt = (aktJe.get(String(r.id)) ?? []).slice(0, 5)
                const pipe = (pipeJe.get(String(r.id)) ?? []).filter(p => !['abschluss', 'stammkunde', 'verloren'].includes(String(p.stufe)))
                const name = art === 'kontakte' ? kontaktAnzeigename(r) : String(r.name ?? '')
                return (
                  <details key={r.id} className="group px-4 py-3">
                    <summary className="flex flex-wrap items-center gap-x-3 gap-y-1 cursor-pointer list-none">
                      <span className="font-medium text-s112-text">{name}</span>
                      {art === 'kontakte' && (r.firmen as R | null)?.name && <span className="text-xs text-s112-text-2">{(r.firmen as R).name}</span>}
                      <span className="text-xs text-s112-muted">{[r.plz, r.ort].filter(Boolean).join(' ')}</span>
                      <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-s112-blue-100 text-s112-blue-700">aus {fremderBetrieb(r.tenant_id, tenantId ?? '', g)}</span>
                    </summary>
                    <div className="mt-3 grid gap-4 sm:grid-cols-3 text-xs text-s112-text-2">
                      <div className="space-y-0.5">
                        {r.strasse && <p>{r.strasse}</p>}
                        {r.telefon && <p>Tel. {[r.telefon_vorwahl, r.telefon].filter(Boolean).join(' ')}</p>}
                        {r.mobil && <p>Mobil {[r.mobil_vorwahl, r.mobil].filter(Boolean).join(' ')}</p>}
                        {r.email && <p>{r.email}</p>}
                        {r.uid_nummer && <p>UID {r.uid_nummer}</p>}
                        {r.betrieb_nr && <p>Betr.Nr. {r.betrieb_nr}</p>}
                        {r.accountnummer && <p className="text-s112-muted">Kundennr. beim Eigentümer: {r.accountnummer}</p>}
                      </div>
                      <div>
                        <p className="font-semibold text-s112-text-1 mb-1">Letzte Aktivitäten</p>
                        {akt.length === 0 ? <p className="text-s112-muted">–</p> : akt.map(a => (
                          <p key={a.id}>{datum(a.datum)} · {a.betreff || a.art}{a.erledigt ? '' : ' (offen)'}</p>
                        ))}
                      </div>
                      <div>
                        <p className="font-semibold text-s112-text-1 mb-1">Offene Pipeline</p>
                        {pipe.length === 0 ? <p className="text-s112-muted">–</p> : pipe.map(p => (
                          <p key={p.id}>{p.titel || p.stufe}{p.wert_euro != null ? ` · ${Number(p.wert_euro).toLocaleString(ZAHL_LOCALE, { style: 'currency', currency: 'EUR' })}` : ''}{p.erwartetes_datum ? ` · bis ${datum(p.erwartetes_datum)}` : ''}</p>
                        ))}
                      </div>
                    </div>
                  </details>
                )
              })}
              {rows.length === ANZAHL && <p className="px-4 py-3 text-xs text-s112-muted">Die ersten {ANZAHL} Einträge – bitte die Suche verwenden.</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
