import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { alle } from '@/lib/supabase/alle'
import { geladen } from '@/lib/supabase/geladen'
import { heuteWien } from '@/lib/datum/wien'
import { fmtNum, fmtEur } from '@/lib/format'
import {
  ANGEBOT_STATUS_LABEL, angebotAbgelaufen, angebotOffen, angebotRabattText, angebotSummen, angebotVersendbar, angebotZeileBrutto, type AngebotStatus,
} from '@/lib/auftrag/angebot'
import AuftragsbestaetigungPanel from '../../auftraege/[id]/AuftragsbestaetigungPanel'
import AngebotAktionen from './AngebotAktionen'

export const metadata: Metadata = { title: 'Angebot' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
const tag = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '–')
const zeit = (z: string) => new Date(z).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' })

// KAN-418 Teil 4 (12.11.2026): Angebot – Positionen mit Preisen, PDF/Mail, Übernahme in einen Auftrag
export default async function AngebotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = geladen(await (supabase.from('auftraege') as any)
    .select('id, nummer, datum, status, gueltig_bis, notizen, kontakt_id, firma_id, storniert_am, storno_grund, abgelehnt_am, abgelehnt_grund, ab_versendet_am, ab_versendet_an')
    .eq('id', id).eq('tenant_id', tenantId).eq('art', 'angebot').maybeSingle(), 'Angebot') as R | null
  if (!a) notFound()

  const [posRes, kRes, fRes, aufRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('auftrag_positionen') as any)
      .select('id, fuellung_id, name, menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz').eq('tenant_id', tenantId).eq('auftrag_id', id).order('erstellt_am').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.kontakt_id ? (supabase.from('kontakte') as any).select('id, vorname, nachname, email').eq('id', a.kontakt_id).eq('tenant_id', tenantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a.firma_id ? (supabase.from('firmen') as any).select('id, name, email').eq('id', a.firma_id).eq('tenant_id', tenantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    // der Auftrag, der aus diesem Angebot entstanden ist (höchstens einer)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('auftraege') as any).select('id, nummer').eq('tenant_id', tenantId).eq('art', 'auftrag').eq('angebot_id', id).maybeSingle(),
  ])
  const positionen = (geladen(posRes, 'Positionen') ?? []) as R[]
  const kontakt = geladen(kRes, 'Kontakt') as R | null
  const firma = geladen(fRes, 'Firma') as R | null
  const auftrag = geladen(aufRes, 'Auftrag') as R | null
  const darfSchreiben = canWrite(membership, 'warenwirtschaft')
  const heute = heuteWien()
  const offen = angebotOffen(a as { status: string; storniert_am: string | null })
  const abgelaufen = angebotAbgelaufen(a as { status: string; gueltig_bis: string | null }, heute)
  const kunde = firma?.name ?? ([kontakt?.vorname, kontakt?.nachname].filter(Boolean).join(' ') || '–')
  const summen = angebotSummen(positionen)
  const mitRabatt = positionen.some(p => angebotRabattText(p))

  return (
    <div className="max-w-3xl space-y-4">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/angebote" className="hover:text-s112-blue-700">Angebote</Link>
        <span>/</span>
        <span className="font-medium text-s112-text">{a.nummer}</span>
      </nav>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Angebot {a.nummer}</h1>
          <p className="text-sm text-s112-muted mt-1">{tag(a.datum)} · {ANGEBOT_STATUS_LABEL[a.status as AngebotStatus] ?? a.status}</p>
        </div>
        {darfSchreiben && offen && <AngebotAktionen id={a.id} nummer={a.nummer} />}
      </div>

      {/* PDF für alle mit Lesezugriff, Senden mit Schreibrecht – nicht bei Storno */}
      {angebotVersendbar(a as { status: string; storniert_am: string | null }) && (
        <AuftragsbestaetigungPanel id={a.id} nummer={a.nummer} darfSenden={darfSchreiben}
          beleg={{ titel: 'Angebot', api: `/api/weinhandel/angebote/${a.id}`, hinweis: 'Das PDF enthält Positionen, Preise, Summe und die Gültigkeit.' }}
          defaultEmail={String((firma?.email ?? kontakt?.email ?? '') || '')}
          gesendetText={a.ab_versendet_am ? `Gesendet am ${zeit(a.ab_versendet_am)}${a.ab_versendet_an ? ` an ${a.ab_versendet_an}` : ''}.` : null} />
      )}

      {abgelaufen && (
        <div role="status" className="bg-s112-warn-bg border border-s112-warn/30 text-sm text-s112-warn-fg rounded-xl px-4 py-3">
          Das Angebot ist seit {tag(a.gueltig_bis)} abgelaufen. Es lässt sich weiterhin bearbeiten oder in einen Auftrag übernehmen.
        </div>
      )}
      {a.status === 'angenommen' && (
        <div role="status" className="bg-s112-bg border border-s112-border text-sm text-s112-text-2 rounded-xl px-4 py-3">
          Angenommen{auftrag ? <> – übernommen in Auftrag <Link href={`/weinhandel/auftraege/${auftrag.id}`} className="text-s112-blue-700 hover:underline">{auftrag.nummer}</Link>.</> : '.'}
        </div>
      )}
      {a.status === 'abgelehnt' && (
        <div role="status" className="bg-s112-bg border border-s112-border text-sm text-s112-text-2 rounded-xl px-4 py-3">
          Abgelehnt{a.abgelehnt_am ? ` am ${zeit(a.abgelehnt_am)}` : ''}{a.abgelehnt_grund ? ` – ${a.abgelehnt_grund}` : ''}.
        </div>
      )}
      {a.storniert_am && (
        <div role="status" className="bg-s112-bg border border-s112-border text-sm text-s112-text-2 rounded-xl px-4 py-3">
          Storniert am {zeit(a.storniert_am)}{a.storno_grund ? ` – ${a.storno_grund}` : ''}.
        </div>
      )}

      <div className="card p-6 space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div><dt className="text-xs text-s112-muted">Kunde</dt>
            <dd className="mt-0.5">
              {a.firma_id ? <Link href={`/crm/firmen/${a.firma_id}`} className="text-s112-blue-700 hover:underline">{kunde}</Link>
                : a.kontakt_id ? <Link href={`/crm/kontakte/${a.kontakt_id}`} className="text-s112-blue-700 hover:underline">{kunde}</Link> : kunde}
            </dd></div>
          <div><dt className="text-xs text-s112-muted">Gültig bis</dt><dd className={`mt-0.5 tabular-nums ${abgelaufen ? 'text-s112-err-fg font-medium' : ''}`}>{tag(a.gueltig_bis)}</dd></div>
          <div><dt className="text-xs text-s112-muted">Notiz (intern)</dt><dd className="mt-0.5 whitespace-pre-wrap">{a.notizen || '–'}</dd></div>
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border text-left text-xs text-s112-muted">
                <th className="py-2 pr-3 font-semibold">Füllung</th>
                <th className="py-2 px-3 font-semibold text-right">Flaschen</th>
                <th className="py-2 px-3 font-semibold text-right">Preis (brutto)</th>
                {mitRabatt && <th className="py-2 px-3 font-semibold text-right">Rabatt</th>}
                <th className="py-2 px-3 font-semibold text-right">USt.</th>
                <th className="py-2 pl-3 font-semibold text-right">Betrag</th>
              </tr>
            </thead>
            <tbody>
              {positionen.map(p => (
                <tr key={p.id} className="border-b border-s112-border last:border-0">
                  <td className="py-2 pr-3"><Link href={`/weinhandel/fuellungen/${p.fuellung_id}/edit`} className="hover:text-s112-blue-700 hover:underline">{p.name}</Link></td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtNum(Number(p.menge), 0)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtEur(Number(p.preis_brutto) || 0)}</td>
                  {mitRabatt && <td className="py-2 px-3 text-right tabular-nums">{angebotRabattText(p) || '–'}</td>}
                  <td className="py-2 px-3 text-right tabular-nums">{fmtNum(Number(p.ust_satz) || 0, 0)} %</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{fmtEur(angebotZeileBrutto(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="text-sm ml-auto max-w-xs space-y-1 tabular-nums">
          <div className="flex justify-between gap-6"><dt className="text-s112-muted">Flaschen gesamt</dt><dd>{fmtNum(summen.flaschen, 0)}</dd></div>
          <div className="flex justify-between gap-6"><dt className="text-s112-muted">Summe netto</dt><dd>{fmtEur(summen.netto)}</dd></div>
          {summen.ust.map(u => (
            <div key={u.satz} className="flex justify-between gap-6"><dt className="text-s112-muted">USt. {fmtNum(u.satz, 0)} %</dt><dd>{fmtEur(u.steuer)}</dd></div>
          ))}
          <div className="flex justify-between gap-6 font-semibold text-s112-text border-t border-s112-border pt-1"><dt>Gesamt brutto</dt><dd>{fmtEur(summen.brutto)}</dd></div>
        </dl>
        <p className="text-xs text-s112-muted">Ein Angebot reserviert keine Flaschen. Bei der Übernahme in einen Auftrag gelten diese Preise als Vorschlag für die Lieferung.</p>
      </div>
    </div>
  )
}
