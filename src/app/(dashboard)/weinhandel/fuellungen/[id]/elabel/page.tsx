import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Tag } from 'lucide-react'
import type { KatalogEintrag } from '@/lib/elabel/katalog'
import ElabelFormular, { type AnalyseWahl, type TypZuordnung, type ElabelStand } from './ElabelFormular'
import { speichereElabel, elabelFreigeben, setzeBehandlungstypZutat } from './actions'

export const metadata: Metadata = { title: 'E-Label – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-216: E-Label je Füllung – Zutatenliste (Vorschlag aus den Kellerbehandlungen der Chargen), Nährwerte aus der
// jüngsten Analyse, Freigabe. Die öffentliche Seite mit QR-Code folgt mit KAN-217.
export default async function ElabelPage({ params }: { params: Promise<{ id: string }> }) {
  const membership = await getCurrentMembership()
  if (!membership) redirect('/weinhandel')
  const tenantId = membership.tenantId
  const schreiben = canWrite(membership, 'kellerbuch') || canWrite(membership, 'warenwirtschaft')
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fRaw } = await (supabase.from('fuellungen') as any)
    .select('id, name, jahrgang, flaschengroesse_ml, chargennummer, weinausbau_id, storniert_am')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!fRaw) redirect('/weinhandel')
  const f = fRaw as R

  // Chargen der Füllung: Hauptcharge und Anteile (fuellung_chargen) – wenige je Füllung
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fcRaw } = await (supabase.from('fuellung_chargen') as any)
    .select('weinausbau_id').eq('tenant_id', tenantId).eq('fuellung_id', id)
    .limit(200)   // alle-ausnahme: Chargenanteile einer einzelnen Füllung
  const chargen = [...new Set([f.weinausbau_id, ...((fcRaw ?? []) as R[]).map(c => c.weinausbau_id)].filter(Boolean).map(String))]

  const [katalogRes, elabelRes, analysenRes, behandlungenRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('elabel_zutaten') as any)
      .select('id, kategorie, name_de, name_en, e_nummer, allergen, sortierung').eq('aktiv', true)
      .order('kategorie').order('sortierung').order('id')
      .limit(1000),   // alle-ausnahme: globaler Katalog mit wenigen Dutzend Einträgen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('elabels') as any).select('*').eq('tenant_id', tenantId).eq('fuellung_id', id).maybeSingle(),
    chargen.length === 0 ? Promise.resolve({ data: [] }) :
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weinanalysen') as any)
        .select('id, analyse_datum, labor, alkohol_vol, restzucker_gl, gesamtsaeure_gl, weinausbau_id')
        .eq('tenant_id', tenantId).in('weinausbau_id', chargen)   // alle-ausnahme: Chargen einer einzelnen Füllung
        .is('storniert_am', null).order('analyse_datum', { ascending: false }).order('id')
        .limit(50),   // alle-ausnahme: jüngste Analysen der Chargen einer Füllung zur Auswahl
    chargen.length === 0 ? Promise.resolve({ data: [] }) :
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('keller_behandlungen') as any)
        .select('typ_id, typ:keller_behandlungstypen(id, name, elabel_zutat_id)')
        .eq('tenant_id', tenantId).in('weinausbau_id', chargen)   // alle-ausnahme: Chargen einer einzelnen Füllung
        .is('storniert_am', null).order('id')
        .limit(1000),   // alle-ausnahme: Behandlungen der Chargen einer Füllung (nur Typen werden gebraucht)
  ])

  const katalog = (katalogRes.data ?? []) as KatalogEintrag[]
  const elabel = (elabelRes.data ?? null) as R | null
  const analysen: AnalyseWahl[] = ((analysenRes.data ?? []) as R[]).map(a => ({
    id: String(a.id), datum: a.analyse_datum ?? null, labor: a.labor ?? null,
    alkoholVol: a.alkohol_vol == null ? null : Number(a.alkohol_vol),
    restzuckerGl: a.restzucker_gl == null ? null : Number(a.restzucker_gl),
    gesamtsaeureGl: a.gesamtsaeure_gl == null ? null : Number(a.gesamtsaeure_gl),
  }))
  const typen = new Map<string, TypZuordnung>()
  for (const b of (behandlungenRes.data ?? []) as R[]) {
    const t = b.typ as R | null
    if (t?.id && !typen.has(String(t.id))) typen.set(String(t.id), { id: String(t.id), name: String(t.name ?? ''), zutatId: t.elabel_zutat_id ?? null })
  }

  const stand: ElabelStand | null = elabel ? {
    code: String(elabel.code), status: elabel.status, zutatenIds: (elabel.zutaten_ids ?? []) as string[],
    analyseId: elabel.analyse_id ?? null,
    alkoholVol: elabel.alkohol_vol == null ? null : Number(elabel.alkohol_vol),
    restzuckerGl: elabel.restzucker_gl == null ? null : Number(elabel.restzucker_gl),
    gesamtsaeureGl: elabel.gesamtsaeure_gl == null ? null : Number(elabel.gesamtsaeure_gl),
    glycerinGl: elabel.glycerin_gl == null ? null : Number(elabel.glycerin_gl),
    manuell: !!elabel.manuell, manuellGrund: elabel.manuell_grund ?? null,
    werte: {
      energieKj: elabel.energie_kj, energieKcal: elabel.energie_kcal,
      kohlenhydrateG: elabel.kohlenhydrate_g == null ? undefined : Number(elabel.kohlenhydrate_g),
      zuckerG: elabel.zucker_g == null ? undefined : Number(elabel.zucker_g),
      fettG: Number(elabel.fett_g ?? 0), fettGesaettigtG: Number(elabel.fett_gesaettigt_g ?? 0),
      eiweissG: Number(elabel.eiweiss_g ?? 0), salzG: Number(elabel.salz_g ?? 0),
    },
    freigegebenAm: elabel.freigegeben_am ?? null, freigegebenVonName: elabel.freigegeben_von_name ?? null,
  } : null

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/weinhandel/fuellungen/${id}/edit`} className="text-sm text-s112-muted hover:text-s112-text">← Zurück zur Füllung</Link>
        <h1 className="text-2xl font-semibold text-s112-text mt-2 flex items-center gap-2">
          <Tag className="w-6 h-6 text-s112-blue-700" aria-hidden /> E-Label
        </h1>
        <p className="text-sm text-s112-muted mt-0.5">
          {f.name}{f.jahrgang ? ` ${f.jahrgang}` : ''}{f.flaschengroesse_ml ? ` · ${(Number(f.flaschengroesse_ml) / 1000).toLocaleString('de-AT')} l` : ''}
          {f.chargennummer ? ` · ${f.chargennummer}` : ''}
        </p>
      </div>
      {f.storniert_am && <div className="card text-sm text-s112-err-fg">Die Füllung ist storniert – kein E-Label möglich.</div>}
      <ElabelFormular
        fuellungId={id}
        katalog={katalog}
        analysen={analysen}
        typen={[...typen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'))}
        stand={stand}
        schreiben={schreiben && !f.storniert_am}
        typenSchreiben={canWrite(membership, 'kellerbuch')}
        speichern={speichereElabel.bind(null, id)}
        freigeben={elabelFreigeben.bind(null, id)}
        zuordnen={setzeBehandlungstypZutat.bind(null, id)}
      />
    </div>
  )
}
