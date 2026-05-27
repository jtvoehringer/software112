import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import LagerClient from './LagerClient'

export const metadata: Metadata = { title: 'PSM-Lager – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type PSMLager = {
  psm_id: string
  psm_name: string
  einheit: string | null
  kategorie: string | null
  bewegungen: {
    id: string
    datum: string
    typ: 'anfangsbestand' | 'einkauf' | 'korrektur'
    menge: number
    einheit: string | null
    notizen: string | null
  }[]
  verbrauch_gesamt: number   // aus behandlungen berechnet
  einheit_behandlung: string | null
}

export type PSMOption = { id: string; name: string; einheit_default: string | null; kategorie: string | null }

export default async function LagerPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // Alle PSM (aktiv)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPSM } = await (supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, kategorie, menge_einheit')
    .eq('aktiv', true)
    .order('name')

  // Lagerbewegungen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawBew } = await (supabase.from('psm_lager_bewegungen') as any)
    .select('id, psm_id, datum, typ, menge, einheit, notizen')
    .order('datum', { ascending: false })

  // Verbrauch aus Behandlungen (menge_gesamt pro PSM, nur spritzung)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawBehandlungen } = await (supabase.from('behandlungen') as any)
    .select('psm_id, menge_gesamt, menge_einheit')
    .not('psm_id', 'is', null)
    .not('menge_gesamt', 'is', null)

  // Verbrauch je PSM aggregieren
  const verbrauchByPsm = new Map<string, { menge: number; einheit: string | null }>()
  for (const b of ((rawBehandlungen ?? []) as AR[])) {
    const curr = verbrauchByPsm.get(b.psm_id) ?? { menge: 0, einheit: b.menge_einheit ?? null }
    curr.menge += b.menge_gesamt ?? 0
    verbrauchByPsm.set(b.psm_id, curr)
  }

  // Bewegungen je PSM gruppieren
  const bewegungenByPsm = new Map<string, PSMLager['bewegungen']>()
  for (const b of ((rawBew ?? []) as AR[])) {
    const arr = bewegungenByPsm.get(b.psm_id) ?? []
    arr.push({
      id: b.id, datum: b.datum, typ: b.typ,
      menge: b.menge, einheit: b.einheit, notizen: b.notizen,
    })
    bewegungenByPsm.set(b.psm_id, arr)
  }

  // Nur PSM mit Bewegungen ODER Verbrauch anzeigen
  const psms = ((rawPSM ?? []) as AR[])
  const psmOptions: PSMOption[] = psms.map(p => ({
    id: p.id, name: p.name, einheit_default: null, kategorie: p.kategorie ?? null,
  }))

  const aktivePsm = psms
    .filter(p => bewegungenByPsm.has(p.id) || verbrauchByPsm.has(p.id))
    .map(p => {
      const vb = verbrauchByPsm.get(p.id)
      return {
        psm_id:              p.id,
        psm_name:            p.name,
        einheit:             bewegungenByPsm.get(p.id)?.[0]?.einheit ?? null,
        kategorie:           p.kategorie ?? null,
        bewegungen:          bewegungenByPsm.get(p.id) ?? [],
        verbrauch_gesamt:    vb?.menge ?? 0,
        einheit_behandlung:  vb?.einheit ?? null,
      } as PSMLager
    })
    .sort((a, b) => a.psm_name.localeCompare(b.psm_name, 'de'))

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/behandlungen" className="hover:text-s112-teal transition-colors">Behandlungen</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">PSM-Lager</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PSM-Lagerverwaltung</h1>
          <p className="text-sm text-s112-muted mt-0.5">Anfangsbestand · Einkauf · Verbrauch · Inventurkorrektur</p>
        </div>
      </div>

      <LagerClient
        psms={aktivePsm}
        allePsm={psmOptions}
        writeOk={writeOk}
        adminOk={adminOk}
      />
    </div>
  )
}
