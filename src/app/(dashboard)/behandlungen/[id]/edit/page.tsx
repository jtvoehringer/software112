import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import BehandlungEditForm from './BehandlungEditForm'
import type { BehandlungEdit, PSMOption, DuengemittelOption, BestehenderKostenEintrag } from './BehandlungEditForm'
import type { KostenartOption } from '../../neu/page'
import { summeFlaecheHa } from '@/lib/behandlungen/massnahmeMengen'

export const metadata: Metadata = { title: 'Maßnahme bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function BehandlungEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()

  if (!canWrite(role, 'rieden')) redirect('/behandlungen')

  // Tenant + Bio-Status (steuert Warn-/Sperrlogik bei der Mittelwahl, siehe Neu-Formular)
  // Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen
  // Mitgliedschaft – sonst können bei Mehrfach-Mitgliedschaft Daten eines anderen
  // Betriebs angezeigt/bearbeitet werden.
  const membership = await getCurrentMembership()
  if (!membership) notFound()
  const tenantId = membership.tenantId
  let bioStatus: string = 'konventionell'
  if (tenantId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenantRow } = await (supabase.from('tenants') as any)
      .select('bio_status').eq('id', tenantId).maybeSingle()
    bioStatus = (tenantRow as AR | null)?.bio_status ?? 'konventionell'
  }

  const [{ data: rawB }, { data: rawPsm }, { data: rawDuenger }, { data: rawKostenarten }, { data: rawKE }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('behandlungen') as any)
      .select(`
        id, datum, datum_bis, art, psm_id, duengemittel_id, aufwandmenge, aufwandmenge_einheit,
        menge_gesamt, menge_einheit, konzentration, wasseraufwand_l_ha,
        bbch_stadium, schaderreger, witterung, temperatur_c, notizen,
        bearbeitungstiefe_cm, bearbeitungsgeraet, schnittart, laubarbeit_art,
        einarbeitung, einarbeitung_zeitpunkt,
        weingarten:weingarten_id(name),
        psm:psm_id(wartezeit_tage),
        behandlung_grundstuecke(flaeche_ha, grundstueck:grundstueck_id(flaeche_ha))
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pflanzenschutzmittel') as any)
      .select('id, name, handelsname, oeko_zugelassen, cu_gehalt_pct, wirkstoff, wirkstoffgehalt_pct, wartezeit_tage')
      .eq('aktiv', true)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('name'),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('duengemittel') as any)
      .select('id, name, handelsname, typ, wartezeit_tage, oeko_zugelassen, einheit')
      .eq('aktiv', true)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('name'),

    // Kostenarten (für die Kosten-Sektion im Bearbeiten-Formular, Punkte 6, 9)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kostenarten') as any)
      .select('id, name, kategorie')
      .eq('aktiv', true)
      .eq('tenant_id', tenantId)
      .order('name'),

    // Bestehender Kosteneintrag dieser Maßnahme, falls vorhanden (Migration 139)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kosteneintraege') as any)
      .select('id, kostenart_id, betrag, beschreibung')
      .eq('behandlung_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  if (!rawB) notFound()

  const b = rawB as AR
  const behandlung: BehandlungEdit = {
    id:                   b.id,
    datum:                b.datum,
    datum_bis:            b.datum_bis ?? null,
    art:                  b.art ?? 'spritzung',
    psm_id:               b.psm_id ?? null,
    duengemittel_id:      b.duengemittel_id ?? null,
    aufwandmenge:         b.aufwandmenge ?? null,
    aufwandmenge_einheit: b.aufwandmenge_einheit ?? null,
    menge_gesamt:         b.menge_gesamt ?? null,
    menge_einheit:        b.menge_einheit ?? null,
    konzentration:        b.konzentration ?? null,
    wasseraufwand_l_ha:   b.wasseraufwand_l_ha ?? null,
    bbch_stadium:         b.bbch_stadium ?? null,
    schaderreger:         b.schaderreger ?? null,
    witterung:            b.witterung ?? null,
    temperatur_c:         b.temperatur_c ?? null,
    notizen:              b.notizen ?? null,
    bearbeitungstiefe_cm: b.bearbeitungstiefe_cm ?? null,
    bearbeitungsgeraet:   b.bearbeitungsgeraet ?? null,
    schnittart:           b.schnittart ?? null,
    laubarbeit_art:       b.laubarbeit_art ?? null,
    einarbeitung:         b.einarbeitung ?? null,
    einarbeitung_zeitpunkt: b.einarbeitung_zeitpunkt ?? null,
    wartezeit_tage:       b.psm?.wartezeit_tage ?? null,
    weingarten_name:      b.weingarten?.name ?? null,
  }

  // Behandelte Fläche = Σ Grundstücke der Maßnahme (ha, je GST und gesamt 4 Stellen) – dieselbe Funktion,
  // mit der updateBehandlung Spritzbrühe ↔ Wasseraufwand und Reinkupfer rechnet (KAN-133)
  const flaecheHa = summeFlaecheHa(((b.behandlung_grundstuecke ?? []) as AR[]).map(bg => bg.flaeche_ha ?? bg.grundstueck?.flaeche_ha))

  const psm: PSMOption[] = ((rawPsm ?? []) as AR[]).map(p => ({
    id:              p.id,
    name:            p.name,
    handelsname:     p.handelsname ?? null,
    oeko_zugelassen: p.oeko_zugelassen ?? false,
    cu_gehalt_pct:   p.cu_gehalt_pct ?? null,
    wirkstoff:       p.wirkstoff ?? null,
    wirkstoffgehalt_pct: p.wirkstoffgehalt_pct ?? null,
    wartezeit_tage:  p.wartezeit_tage ?? null,
  }))

  const duengemittel: DuengemittelOption[] = ((rawDuenger ?? []) as AR[]).map(d => ({
    id:              d.id,
    name:            d.name,
    handelsname:     d.handelsname ?? null,
    typ:             d.typ ?? null,
    wartezeit_tage:  d.wartezeit_tage ?? null,
    oeko_zugelassen: d.oeko_zugelassen ?? false,
    einheit:         d.einheit ?? null,
  }))

  const kostenarten: KostenartOption[] = ((rawKostenarten ?? []) as AR[]).map(k => ({
    id: k.id, name: k.name, kategorie: k.kategorie ?? null,
  }))

  const ke = rawKE as AR | null
  const bestehenderKostenEintrag: BestehenderKostenEintrag | null = ke
    ? { kostenart_id: ke.kostenart_id ?? null, betrag: ke.betrag, beschreibung: ke.beschreibung ?? null }
    : null

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/behandlungen" className="hover:text-s112-blue-700 transition-colors">Maßnahmen</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Bearbeiten</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Maßnahme bearbeiten</h1>
        <p className="text-sm text-s112-muted mt-0.5">Daten korrigieren oder ergänzen</p>
      </div>
      <BehandlungEditForm
        behandlung={behandlung} psm={psm} duengemittel={duengemittel} bioStatus={bioStatus}
        kostenarten={kostenarten} bestehenderKostenEintrag={bestehenderKostenEintrag}
        flaecheHa={flaecheHa}
      />
    </div>
  )
}
