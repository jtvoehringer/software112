import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const TYP_FARBE: Record<string, string> = {
  aktivkonto:   'bg-green-100 text-green-700',
  passivkonto:  'bg-red-100 text-red-600',
  aufwandskonto:'bg-orange-100 text-orange-700',
  ertragskonto: 'bg-blue-100 text-blue-700',
  gemischt:     'bg-gray-100 text-gray-600',
}

const TYP_LABEL: Record<string, string> = {
  aktivkonto:   'Aktiv',
  passivkonto:  'Passiv',
  aufwandskonto:'Aufwand',
  ertragskonto: 'Ertrag',
  gemischt:     'Gemischt',
}

export default async function KontenplanPage() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_fibu').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_fibu) redirect('/dashboard')

  const { data: konten } = await (supabase.from('fibu_kontenplan') as any)
    .select('*')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('aktiv', true)
    .order('konto_nr')

  const systemKonten  = (konten as R[])?.filter(k => !k.tenant_id) ?? []
  const mandantKonten = (konten as R[])?.filter(k =>  k.tenant_id) ?? []

  // Gruppen: Klasse 0-8
  const klassen = [0,1,2,3,4,5,6,7,8,9]
  const klassenLabel: Record<number, string> = {
    0: 'Klasse 0 – Anlagevermögen',
    1: 'Klasse 1 – Umlaufvermögen',
    2: 'Klasse 2 – Kasse, Bank',
    3: 'Klasse 3 – Verbindlichkeiten & EK',
    4: 'Klasse 4 – Erträge',
    5: 'Klasse 5 – Materialaufwand',
    6: 'Klasse 6 – Personalaufwand',
    7: 'Klasse 7 – Sonstiger Betriebsaufwand',
    8: 'Klasse 8 – Finanzaufwand/-ertrag',
    9: 'Klasse 9 – Sonstiges',
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/fibu" className="text-sm text-s112-muted hover:text-gray-700">← Journal</Link>
        <h1 className="text-2xl font-bold text-gray-900">Kontenplan</h1>
        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">EKR</span>
      </div>

      {mandantKonten.length > 0 && (
        <div className="bg-white rounded-2xl border border-s112-border mb-6">
          <div className="px-5 py-3 border-b border-s112-border">
            <h2 className="font-semibold text-gray-800">Eigene Konten</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg">
                <th className="text-left px-4 py-2 font-medium text-gray-600 w-20">Nr.</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Bezeichnung</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Typ</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">USt</th>
              </tr>
            </thead>
            <tbody>
              {mandantKonten.map((k: R) => (
                <tr key={k.id} className="border-b border-s112-border/40">
                  <td className="px-4 py-2 font-mono text-s112-teal font-medium">{k.konto_nr}</td>
                  <td className="px-4 py-2 text-gray-800">{k.konto_name}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${TYP_FARBE[k.typ] ?? 'bg-gray-100 text-gray-600'}`}>
                      {TYP_LABEL[k.typ] ?? k.typ}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{k.ust_satz != null ? k.ust_satz + '%' : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Systemkonten nach Klasse */}
      {klassen.map(kl => {
        const gruppe = systemKonten.filter(k => Math.floor(k.konto_nr / 1000) === kl)
        if (gruppe.length === 0) return null
        return (
          <div key={kl} className="bg-white rounded-2xl border border-s112-border mb-4">
            <div className="px-5 py-3 border-b border-s112-border">
              <h2 className="font-semibold text-gray-800 text-sm">{klassenLabel[kl]}</h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {gruppe.map((k: R) => (
                  <tr key={k.id} className="border-b border-s112-border/30 hover:bg-s112-bg/30">
                    <td className="px-4 py-2 font-mono text-s112-teal font-medium w-20">{k.konto_nr}</td>
                    <td className="px-4 py-2 text-gray-700">{k.konto_name}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${TYP_FARBE[k.typ] ?? 'bg-gray-100 text-gray-600'}`}>
                        {TYP_LABEL[k.typ] ?? k.typ}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-right">{k.ust_satz != null ? k.ust_satz + '%' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
