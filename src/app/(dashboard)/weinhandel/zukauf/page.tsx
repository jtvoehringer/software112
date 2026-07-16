import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import Link from 'next/link'
import ZukaufLoeschen from './ZukaufLoeschen'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const ART_LABEL: Record<string, string> = {
  wein:    '🍷 Wein',
  trauben: '🍇 Trauben',
  most:    '🌊 Most',
}

export default async function ZukaufPage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const { data } = await (supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, art, menge, einheit, preis_gesamt, rebsorte, jahrgang, notizen,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(id, vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(id, name),
      ziel_weinausbau:weinausbau!ziel_weinausbau_id(id, name)
    `)
    .eq('aktiv', true)
    .order('datum', { ascending: false })

  const posten = (data ?? []) as R[]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Zukäufe</h1>
        {writeOk && (
          <Link href="/weinhandel/zukauf/neu"
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            + Neuer Zukauf
          </Link>
        )}
      </div>

      {posten.length === 0 ? (
        <div className="card p-10 text-center text-s112-muted text-sm">
          <p className="text-2xl mb-2">📦</p>
          <p className="font-medium">Noch keine Zukäufe erfasst</p>
          <p className="mt-1">Erfasse zugekauften Wein, Trauben oder Traubenmost.</p>
          {writeOk && (
            <Link href="/weinhandel/zukauf/neu"
              className="mt-4 inline-block text-s112-teal hover:underline text-sm font-medium">
              Ersten Zukauf anlegen →
            </Link>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Datum</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Art</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Lieferant</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Rebsorte / Jg.</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-right">Menge</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-right">Gesamtpreis</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Tank</th>
                {writeOk && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-border">
              {posten.map((p: R) => {
                const lieferant = p.lieferant_kontakt
                  ? [p.lieferant_kontakt.vorname, p.lieferant_kontakt.nachname].filter(Boolean).join(' ')
                  : p.lieferant_firma?.name ?? '–'
                const rebInfo = [p.rebsorte, p.jahrgang].filter(Boolean).join(' ') || '–'
                return (
                  <tr key={p.id} className="hover:bg-s112-bg/50 transition-colors">
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {new Date(p.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{ART_LABEL[p.art] ?? p.art}</td>
                    <td className="px-4 py-3 text-gray-700">{lieferant}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{rebInfo}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-800">
                      {Number(p.menge).toLocaleString('de-AT')} {p.einheit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {p.preis_gesamt != null
                        ? Number(p.preis_gesamt).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
                        : '–'}
                    </td>
                    <td className="px-4 py-3 text-xs text-s112-muted">
                      {p.ziel_weinausbau?.name ?? '–'}
                    </td>
                    {writeOk && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/weinhandel/zukauf/${p.id}/edit`}
                            title="Bearbeiten" aria-label="Bearbeiten"
                            className="text-s112-teal hover:text-s112-teal/70">
                            ✏️
                          </Link>
                          <ZukaufLoeschen id={p.id} info={rebInfo} />
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
