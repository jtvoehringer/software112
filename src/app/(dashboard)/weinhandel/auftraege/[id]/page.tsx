import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { LIEFERBAR_STATUS, offeneMenge } from '@/lib/auftrag/lieferung'
import { geladen } from '@/lib/supabase/geladen'
import { heuteWien } from '@/lib/datum/wien'
import { fmtNum } from '@/lib/format'
import { AUFTRAG_STATUS_LABEL, RESERVIERT_STATUS, reservierungAbgelaufen, type AuftragStatus } from '@/lib/auftrag/regeln'
import AuftragAktionen from './AuftragAktionen'
import AuftragsbestaetigungPanel from './AuftragsbestaetigungPanel'
import { abMoeglich } from '@/lib/auftrag/bestaetigung'

export const metadata: Metadata = { title: 'Auftrag' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
const tag = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '–')

export default async function AuftragPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = geladen(await (supabase.from('auftraege') as any)
    .select('id, nummer, datum, status, reserviert_bis, notizen, kontakt_id, firma_id, storniert_am, storno_grund, abgeschlossen_am, ab_versendet_am, ab_versendet_an, erstellt_am, angebot_id')
    .eq('id', id).eq('tenant_id', tenantId).eq('art', 'auftrag').maybeSingle(), 'Auftrag') as R | null   // KAN-418 Teil 4: Angebote haben ihre eigene Seite
  if (!a) notFound()
  // KAN-418 Teil 4: Auftrag aus einem Angebot – dessen Preise sind der Vorschlag für die Lieferung
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const angebot = a.angebot_id ? geladen(await (supabase.from('auftraege') as any)
    .select('id, nummer').eq('id', a.angebot_id).eq('tenant_id', tenantId).eq('art', 'angebot').maybeSingle(), 'Angebot') as R | null : null

  const [posRes, kRes, fRes, lRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('auftrag_positionen') as any).select('id, fuellung_id, name, menge, geliefert').eq('tenant_id', tenantId).eq('auftrag_id', id).order('erstellt_am').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.kontakt_id ? (supabase.from('kontakte') as any).select('id, vorname, nachname, email').eq('id', a.kontakt_id).eq('tenant_id', tenantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.firma_id ? (supabase.from('firmen') as any).select('id, name, email').eq('id', a.firma_id).eq('tenant_id', tenantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    // KAN-418 Teil 2: Lieferungen – auch zurückgenommene (Storno des Verkaufs), gekennzeichnet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('auftrag_lieferungen') as any).select('id, verkaufsposten_id, menge, erstellt_am, zurueckgenommen_am')
      .eq('tenant_id', tenantId).eq('auftrag_id', id).order('erstellt_am').order('id')),
  ])
  const positionen = (geladen(posRes, 'Positionen') ?? []) as R[]
  const kontakt = geladen(kRes, 'Kontakt') as R | null
  const firma = geladen(fRes, 'Firma') as R | null
  const lieferZeilen = (geladen(lRes, 'Lieferungen') ?? []) as R[]
  // je Verkauf eine Zeile (Flaschen summiert); Belegnummern der Verkäufe dazu
  const jeVerkauf = new Map<string, { verkauf: string; flaschen: number; am: string; zurueck: boolean }>()
  for (const l of lieferZeilen) {
    const z = jeVerkauf.get(l.verkaufsposten_id) ?? { verkauf: l.verkaufsposten_id as string, flaschen: 0, am: l.erstellt_am as string, zurueck: false }
    z.flaschen += Number(l.menge) || 0
    z.zurueck = z.zurueck || !!l.zurueckgenommen_am
    jeVerkauf.set(l.verkaufsposten_id, z)
  }
  const verkaufIds = [...jeVerkauf.keys()]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vkRes = verkaufIds.length ? await inBloecken<R>(verkaufIds, b => alle<R>((supabase.from('verkaufsposten') as any)
    .select('id, datum, rechnungsnummer, lieferscheinnummer, storniert').eq('tenant_id', tenantId).in('id', b).order('id'))) : { data: [] as R[], error: null }
  const verkaeufe = new Map(((geladen(vkRes, 'Verkäufe') ?? []) as R[]).map(v => [v.id as string, v]))
  const lieferungen = [...jeVerkauf.values()]
  const lieferbar = LIEFERBAR_STATUS.includes(a.status)
  const darfSchreiben = canWrite(membership, 'warenwirtschaft')
  const heute = heuteWien()
  const reserviert = (RESERVIERT_STATUS as readonly string[]).includes(a.status)
  const abgelaufen = reservierungAbgelaufen(a as { status: string; reserviert_bis: string | null }, heute)
  const kunde = firma?.name ?? ([kontakt?.vorname, kontakt?.nachname].filter(Boolean).join(' ') || '–')

  return (
    <div className="max-w-3xl space-y-4">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/auftraege" className="hover:text-s112-blue-700">Aufträge</Link>
        <span>/</span>
        <span className="font-medium text-s112-text">{a.nummer}</span>
      </nav>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Auftrag {a.nummer}</h1>
          <p className="text-sm text-s112-muted mt-1">
            {tag(a.datum)} · {AUFTRAG_STATUS_LABEL[a.status as AuftragStatus] ?? a.status}
            {angebot && <> · aus Angebot <Link href={`/weinhandel/angebote/${angebot.id}`} className="text-s112-blue-700 hover:underline">{angebot.nummer}</Link></>}
          </p>
        </div>
        {darfSchreiben && reserviert && (
          <div className="flex flex-col items-end gap-2">
            {lieferbar && positionen.some(p => offeneMenge(p as { menge: number; geliefert: number }) > 0) && (
              <Link href={`/weinhandel/verkauf/neu?auftrag=${a.id}`}
                className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
                Liefern
              </Link>
            )}
            <AuftragAktionen id={a.id} nummer={a.nummer} reserviertBis={a.reserviert_bis ?? heute} heute={heute}
              kannStornieren={a.status === 'offen'} kannAbschliessen={a.status === 'teilgeliefert'} />
          </div>
        )}
      </div>

      {/* KAN-418 Teil 3: Auftragsbestätigung (PDF für alle mit Lesezugriff, Senden mit Schreibrecht) – nicht bei Storno */}
      {abMoeglich(a as { status: string; storniert_am: string | null }) && (
        <AuftragsbestaetigungPanel id={a.id} nummer={a.nummer} darfSenden={darfSchreiben}
          defaultEmail={String((firma?.email ?? kontakt?.email ?? '') || '')}
          gesendetText={a.ab_versendet_am
            ? `Gesendet am ${new Date(a.ab_versendet_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' })}${a.ab_versendet_an ? ` an ${a.ab_versendet_an}` : ''}.`
            : null} />
      )}

      {abgelaufen && (
        <div role="status" className="bg-s112-warn-bg border border-s112-warn/30 text-sm text-s112-warn-fg rounded-xl px-4 py-3">
          Die Reservierung ist seit {tag(a.reserviert_bis)} abgelaufen. Die Flaschen bleiben reserviert, bis du die Frist verlängerst oder den Auftrag stornierst.
        </div>
      )}
      {a.status === 'abgeschlossen' && (
        <div role="status" className="bg-s112-bg border border-s112-border text-sm text-s112-text-2 rounded-xl px-4 py-3">
          Abgeschlossen{a.abgeschlossen_am ? ` am ${new Date(a.abgeschlossen_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' })}` : ''} –
          der Rest wird nicht mehr geliefert, die Reservierung ist aufgehoben.
        </div>
      )}
      {a.storniert_am && (
        <div role="status" className="bg-s112-bg border border-s112-border text-sm text-s112-text-2 rounded-xl px-4 py-3">
          Storniert am {new Date(a.storniert_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' })}
          {a.storno_grund ? ` – ${a.storno_grund}` : ''}. Die Reservierung ist aufgehoben.
        </div>
      )}

      <div className="card p-6 space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div><dt className="text-xs text-s112-muted">Kunde</dt>
            <dd className="mt-0.5">
              {a.firma_id ? <Link href={`/crm/firmen/${a.firma_id}`} className="text-s112-blue-700 hover:underline">{kunde}</Link>
                : a.kontakt_id ? <Link href={`/crm/kontakte/${a.kontakt_id}`} className="text-s112-blue-700 hover:underline">{kunde}</Link> : kunde}
            </dd></div>
          <div><dt className="text-xs text-s112-muted">Reserviert bis</dt><dd className={`mt-0.5 tabular-nums ${abgelaufen ? 'text-s112-err-fg font-medium' : ''}`}>{reserviert ? tag(a.reserviert_bis) : '–'}</dd></div>
          <div><dt className="text-xs text-s112-muted">Notiz</dt><dd className="mt-0.5 whitespace-pre-wrap">{a.notizen || '–'}</dd></div>
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border text-left text-xs text-s112-muted">
                <th className="py-2 pr-3 font-semibold">Füllung</th>
                <th className="py-2 px-3 font-semibold text-right">Bestellt</th>
                <th className="py-2 px-3 font-semibold text-right">Geliefert</th>
                <th className="py-2 px-3 font-semibold text-right">Offen</th>
                <th className="py-2 pl-3 font-semibold text-right">Reserviert</th>
              </tr>
            </thead>
            <tbody>
              {positionen.map(p => (
                <tr key={p.id} className="border-b border-s112-border last:border-0">
                  <td className="py-2 pr-3"><Link href={`/weinhandel/fuellungen/${p.fuellung_id}/edit`} className="hover:text-s112-blue-700 hover:underline">{p.name}</Link></td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtNum(Number(p.menge), 0)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtNum(Number(p.geliefert), 0)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtNum(offeneMenge(p as { menge: number; geliefert: number }), 0)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{fmtNum(reserviert ? Math.max(0, Number(p.menge) - Number(p.geliefert)) : 0, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-s112-muted">
          {angebot ? `Bei der Lieferung werden die Preise aus dem Angebot ${angebot.nummer} vorgeschlagen (änderbar).` : 'Preise und Rabatte entstehen bei der Lieferung.'}
          {' '}Positionen lassen sich nicht ändern – bei Bedarf den Auftrag stornieren und neu erfassen.
        </p>
      </div>

      {lieferungen.length > 0 && (
        <div className="card p-6 space-y-3">
          <h2 className="text-sm font-semibold text-s112-text">Lieferungen</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-s112-border text-left text-xs text-s112-muted">
                  <th className="py-2 pr-3 font-semibold">Datum</th>
                  <th className="py-2 px-3 font-semibold">Verkauf</th>
                  <th className="py-2 px-3 font-semibold text-right">Flaschen</th>
                  <th className="py-2 pl-3 font-semibold">Stand</th>
                </tr>
              </thead>
              <tbody>
                {lieferungen.map(l => {
                  const v = verkaeufe.get(l.verkauf)
                  const nr = v?.rechnungsnummer ?? v?.lieferscheinnummer ?? 'Verkauf'
                  return (
                    <tr key={l.verkauf} className={`border-b border-s112-border last:border-0 ${l.zurueck ? 'text-s112-muted' : ''}`}>
                      <td className="py-2 pr-3 tabular-nums">{tag(v?.datum ?? String(l.am).slice(0, 10))}</td>
                      <td className="py-2 px-3">
                        {v ? <Link href={`/weinhandel/verkauf/${l.verkauf}`} className="text-s112-blue-700 hover:underline">{nr}</Link> : '–'}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtNum(l.flaschen, 0)}</td>
                      <td className="py-2 pl-3">{l.zurueck ? (v?.storniert ? 'Verkauf storniert – zurückgenommen' : 'Zurückgenommen') : 'Geliefert'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
