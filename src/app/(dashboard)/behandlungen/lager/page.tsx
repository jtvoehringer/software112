import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import LagerClient from './LagerClient'
import PSMClient from './PSMClient'

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

export type PSMEintrag = {
  id: string; name: string; handelsname: string | null
  kategorie: string | null; wirkstoff: string | null
  wirkstoffgehalt_pct: number | null; cu_gehalt_pct: number | null
  max_aufwand_kg_ha: number | null; max_anwendungen: number | null
  wartezeit_tage: number | null; oeko_zugelassen: boolean
  notizen: string | null
}

export default async function LagerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab = 'bestand' } = await searchParams
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // Alle PSM (aktiv) – Basisdaten für Bestand
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPSM } = await (supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, kategorie')
    .eq('aktiv', true)
    .order('name')

  // Vollständige PSM-Stammdaten (für den Stammdaten-Tab)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPSMStamm } = await (supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, handelsname, kategorie, wirkstoff, wirkstoffgehalt_pct, cu_gehalt_pct, max_aufwand_kg_ha, max_anwendungen, wartezeit_tage, oeko_zugelassen, notizen')
    .eq('aktiv', true)
    .order('name')

  const psmStammdaten: PSMEintrag[] = ((rawPSMStamm ?? []) as AR[]).map(p => ({
    id:                  p.id,
    name:                p.name,
    handelsname:         p.handelsname ?? null,
    kategorie:           p.kategorie ?? null,
    wirkstoff:           p.wirkstoff ?? null,
    wirkstoffgehalt_pct: p.wirkstoffgehalt_pct ?? null,
    cu_gehalt_pct:       p.cu_gehalt_pct ?? null,
    max_aufwand_kg_ha:   p.max_aufwand_kg_ha ?? null,
    max_anwendungen:     p.max_anwendungen ?? null,
    wartezeit_tage:      p.wartezeit_tage ?? null,
    oeko_zugelassen:     p.oeko_zugelassen ?? false,
    notizen:             p.notizen ?? null,
  }))

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
  // Alle PSM für Dropdown (nicht nur aktive mit Bewegungen)
  // bereits in rawPSM enthalten

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

  const TABS = [
    { key: 'bestand',    label: 'Bestand & Bewegungen' },
    { key: 'stammdaten', label: 'Stammdaten' },
  ]

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/behandlungen" className="hover:text-s112-teal transition-colors">Maßnahmen</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">PSM-Lager</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PSM-Lagerverwaltung</h1>
          <p className="text-sm text-s112-muted mt-0.5">
            {tab === 'stammdaten'
              ? 'Pflanzenschutzmittel anlegen und pflegen · Cu-Gehalt · Grenzwerte · Bio-Zulassung'
              : 'Anfangsbestand · Einkauf · Verbrauch · Inventurkorrektur'}
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-s112-border mb-6">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/behandlungen/lager?tab=${t.key}`}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors
              ${tab === t.key
                ? 'bg-white border border-b-white border-s112-border text-s112-teal -mb-px'
                : 'text-s112-muted hover:text-s112-teal'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'stammdaten' ? (
        <PSMClient psm={psmStammdaten} writeOk={writeOk} adminOk={adminOk} />
      ) : (
        <LagerClient
          psms={aktivePsm}
          allePsm={psmOptions}
          writeOk={writeOk}
          adminOk={adminOk}
        />
      )}
    </div>
  )
}
