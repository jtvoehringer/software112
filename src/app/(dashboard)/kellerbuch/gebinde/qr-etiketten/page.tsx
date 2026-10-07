import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { subdomainUrl } from '@/lib/tenant/subdomain'
import { appBasisUrl, qrSvg } from '@/lib/qr'
import { fmtNum } from '@/lib/format'
import { gebindeTypLabel } from '@/lib/behoerden/gebindeverzeichnis'
import { etikettenAuswahl } from '@/lib/keller/qrEtiketten'
import DruckKnopf from '../../_behoerden/DruckKnopf'

export const metadata: Metadata = { title: 'QR-Etiketten Gebinde – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-116 (07.10.2026): Etikettenbogen mit QR-Code je Gebinde (BKI-Sitzung R21: „QR-Code auf Tanks, um direkt Maßnahmen
// zu erfassen“). Der Code führt auf die bestehende Gebindeseite /kellerbuch/behaelter/<id> – mit Subdomain des Betriebs,
// falls eingerichtet (KAN-31). Lokal erzeugt (Paket qrcode), kein externer Dienst. Auswahl: alle, nach Standort oder nach
// Kellerplan. Größe frei (Vorgabe Jörgen 06.10.2026: keine; Material wasserresistent – Druck auf Folien-Etiketten).
export default async function QrEtikettenPage({ searchParams }: { searchParams: Promise<{ standort?: string; plan?: string }> }) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) notFound()
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const [gebinde, planRes, posRes, tRes] = await Promise.all([
    ladeBehaelter(supabase, tenantId, { nurAktiv: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kellerplaene') as any).select('id, name').eq('tenant_id', tenantId).eq('aktiv', true).order('name'),
    alle<R>((supabase.from('kellerplan_positionen') as R).select('id, kellerplan_id, behaelter_id').eq('tenant_id', tenantId).order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenants') as any).select('name, subdomain').eq('id', tenantId).maybeSingle(),
  ])
  const eigene = gebinde.filter(g => !g.fremd)
  const plaene = ((planRes.data ?? []) as R[]).map(p => ({ id: String(p.id), name: String(p.name) }))
  const auswahl = etikettenAuswahl(eigene, (posRes.data ?? []) as R[], { standort: sp.standort ?? null, plan: sp.plan ?? null })
  const standorte = [...new Set(eigene.map(g => (g.standort ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))
  const betrieb = (tRes.data as R | null)?.name ?? ''
  const sub = ((tRes.data as R | null)?.subdomain ?? null) as string | null
  const url = (id: string) => subdomainUrl(sub, `/kellerbuch/behaelter/${id}`) ?? `${appBasisUrl()}/kellerbuch/behaelter/${id}`
  const etiketten = await Promise.all(auswahl.map(async g => ({ g, svg: await qrSvg(url(g.id)) })))
  const feld = 'border border-s112-border rounded-lg px-2.5 py-1.5 text-sm bg-white'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-s112-muted print:hidden">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
        <span>/</span>
        <Link href="/kellerbuch/gebinde" className="hover:text-s112-blue-700">Gebinde</Link>
        <span>/</span>
        <span className="text-s112-text-2">QR-Etiketten</span>
      </div>
      <div className="flex items-end justify-between gap-3 flex-wrap print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-s112-text">QR-Etiketten für Gebinde</h1>
          <p className="text-xs text-s112-muted mt-0.5 max-w-2xl">
            Je Gebinde ein Etikett mit QR-Code, Bezeichnung, Volumen und Betrieb. Der Scan öffnet die Gebindeseite
            (Bewegungen, Behandlungen, Umzüge). Für den Keller auf wasserfeste Folien-Etiketten drucken.
          </p>
        </div>
        <DruckKnopf label={`${etiketten.length} Etiketten drucken`} />
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="text-xs text-s112-text-2">
          <span className="block mb-0.5 font-medium">Standort</span>
          <select name="standort" defaultValue={sp.standort ?? ''} className={feld} aria-label="Standort">
            <option value="">alle</option>
            {standorte.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs text-s112-text-2">
          <span className="block mb-0.5 font-medium">Kellerplan</span>
          <select name="plan" defaultValue={sp.plan ?? ''} className={feld} aria-label="Kellerplan">
            <option value="">alle</option>
            {plaene.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="submit" className="text-xs border border-s112-teal text-s112-blue-700 px-3 py-1.5 rounded-lg hover:bg-s112-teal/5 font-medium">Auswahl anzeigen</button>
      </form>
      {etiketten.length === 0 ? (
        <p className="text-sm text-s112-muted">Keine Gebinde in dieser Auswahl.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 print:grid-cols-3 gap-3 print:gap-2">
          {etiketten.map(({ g, svg }) => (
            <div key={g.id} className="border border-s112-border rounded-lg p-3 flex items-center gap-3 break-inside-avoid bg-white">
              <div role="img" aria-label={`QR-Code ${g.name}`} className="w-24 h-24 shrink-0 [&>svg]:w-full [&>svg]:h-full"
                dangerouslySetInnerHTML={{ __html: svg }} />
              <div className="min-w-0">
                <p className="font-semibold text-s112-text text-base leading-tight break-words">{g.name}</p>
                <p className="text-xs text-s112-text-2">
                  {[gebindeTypLabel(g.typ), g.volumen_liter ? `${fmtNum(g.volumen_liter)} l` : null].filter(Boolean).join(' · ')}
                </p>
                {g.standort && <p className="text-xs text-s112-muted">{g.standort}</p>}
                <p className="text-[10px] text-s112-muted mt-1">{betrieb}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
