import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { deactivateWeingarten } from './actions'

export const metadata: Metadata = { title: 'Weingarten – software:112' }

const BEWIRTSCHAFTUNG_LABELS: Record<string, string> = {
  konventionell: 'Konventionell',
  bio:           'Bio',
  in_umstellung: 'In Umstellung',
  demeter:       'Demeter',
}

type WRow = {
  id: string; name: string; ried: string | null; rebsorte: string | null
  flaeche_ha: number | null; bewirtschaftung: string | null; aktiv: boolean
}

export default async function WeingartenPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase.from('weingarten') as any)
    .select('id, name, ried, rebsorte, flaeche_ha, bewirtschaftung, aktiv')
    .order('name')
  const weingaerten = (raw ?? []) as WRow[]

  const aktive     = weingaerten.filter(w => w.aktiv)
  const gesamtHa   = aktive.reduce((s, w) => s + (w.flaeche_ha ?? 0), 0)
  const anzahl     = aktive.length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weingarten</h1>
          <p className="text-sm text-s112-muted mt-0.5">Stammdaten aller Weingartenlagen</p>
        </div>
        {writeOk && (
          <Link
            href="/weingarten/neu"
            className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
          >
            <span>＋</span> Neuer Weingarten
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{anzahl}</p>
          <p className="text-xs text-s112-muted mt-1">Aktive Lagen</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">{gesamtHa.toFixed(2)}</p>
          <p className="text-xs text-s112-muted mt-1">Hektar gesamt</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-s112-teal">
            {new Set(aktive.map(w => w.rebsorte).filter(Boolean)).size}
          </p>
          <p className="text-xs text-s112-muted mt-1">Rebsorten</p>
        </div>
      </div>

      {/* Tabelle */}
      {weingaerten && weingaerten.length > 0 ? (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Ried</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Rebsorte</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Fläche (ha)</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Bewirtschaftung</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {weingaerten.map((w, i) => (
                <tr
                  key={w.id}
                  className={`border-b border-s112-border last:border-0 ${!w.aktiv ? 'opacity-50' : ''} ${i % 2 === 0 ? '' : 'bg-s112-bg/50'}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{w.name}</td>
                  <td className="px-4 py-3 text-s112-muted">{w.ried ?? '–'}</td>
                  <td className="px-4 py-3">{w.rebsorte ?? '–'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {w.flaeche_ha != null ? w.flaeche_ha.toFixed(4) : '–'}
                  </td>
                  <td className="px-4 py-3">
                    {w.bewirtschaftung ? (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        w.bewirtschaftung === 'bio' || w.bewirtschaftung === 'demeter'
                          ? 'bg-green-100 text-green-700'
                          : w.bewirtschaftung === 'in_umstellung'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {BEWIRTSCHAFTUNG_LABELS[w.bewirtschaftung]}
                      </span>
                    ) : '–'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${w.aktiv ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {writeOk && (
                        <Link
                          href={`/weingarten/${w.id}`}
                          className="text-s112-teal hover:underline text-xs font-medium"
                        >
                          Bearbeiten
                        </Link>
                      )}
                      {adminOk && w.aktiv && (
                        <form action={deactivateWeingarten.bind(null, w.id)}>
                          <button
                            type="submit"
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            Deaktivieren
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card text-center py-16">
          <p className="text-4xl mb-4">🌿</p>
          <p className="text-gray-700 font-medium">Noch keine Weingärten angelegt</p>
          <p className="text-s112-muted text-sm mt-1 mb-6">Legen Sie Ihren ersten Weingarten an</p>
          {writeOk && (
            <Link
              href="/weingarten/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
            >
              ＋ Erster Weingarten
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
