import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { preisEinheit, type LagerBuchung } from '@/lib/behandlungen/lagerVerbrauch'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import NeueBehandlungForm from './NeueBehandlungForm'

export const metadata: Metadata = { title: 'Neue Maßnahme – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type PSM = {
  id: string; name: string; handelsname: string | null
  kategorie: string | null; wartezeit_tage: number | null
  oeko_zugelassen: boolean; cu_gehalt_pct: number | null
  /** Ersatz für den Cu-Gehalt bei Kupfer-Wirkstoffen (wie die Kupfer-Bilanz) */
  wirkstoff: string | null; wirkstoffgehalt_pct: number | null
  preis_pro_einheit: number | null
  /** Einheit, in der der Preis gilt: kg bzw. l, die Grundeinheit des Lagers (preisEinheit); null = keine Lagerbuchung */
  einheit: string | null
}
export type DuengemittelOption = {
  id: string; name: string; handelsname: string | null
  typ: string | null; wartezeit_tage: number | null; oeko_zugelassen: boolean
  preis_pro_einheit: number | null
  /** 'kg' | 'l' – Düngermenge in l nur bei Düngemitteln in l (KAN-133) */
  einheit: string | null
}
export type WeingartenOption = {
  id: string; name: string; ried: string | null; lage_id: string | null; lage_name: string | null
  spritzbar: boolean       // false wenn alle Grundstücke nicht spritzbar
  gst_ha_aktiv: number     // Summe flaeche_ha aktiver Grundstücke (für anteilige Berechnung)
}
export type GSTOption = {
  id: string; weingarten_id: string; gst_nr: string
  rebsorte: string | null; flaeche_ha: number | null
}
export type KostenartOption = { id: string; name: string; kategorie: string | null }
export type SatzOption = { id: string; art: string; bezeichnung: string; satz_pro_ha: number }

export default async function NeueBehandlungPage() {
  const role = await getCurrentUserRole()
  if (!canWrite(role, 'rieden')) redirect('/behandlungen')

  const supabase = await createSupabaseServerClient()

  // Tenant + Bio-Status (steuert Warn-/Sperrlogik bei der Mittelwahl)
  // Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen
  // Mitgliedschaft – sonst können bei Mehrfach-Mitgliedschaft Daten eines anderen
  // Betriebs angezeigt werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  let bioStatus: string = 'konventionell'
  if (tenantId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenantRow } = await (supabase.from('tenants') as any)
      .select('bio_status').eq('id', tenantId).maybeSingle()
    bioStatus = (tenantRow as AR | null)?.bio_status ?? 'konventionell'
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // PSM laden (global + eigene) — inkl. cu_gehalt_pct (bzw. Kupfer-Wirkstoff) + preis_pro_einheit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPSM } = await tf((supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, handelsname, kategorie, wartezeit_tage, oeko_zugelassen, cu_gehalt_pct, wirkstoff, wirkstoffgehalt_pct, preis_pro_einheit')
    .eq('aktiv', true)
    .order('name'))

  // Preis-Einheit je PSM (pflanzenschutzmittel hat keine Einheit-Spalte): Grundeinheit des Lagers nach
  // derselben Regel wie die Lager-Seite (lagerEinheit), g → kg, ml → l. Der Material-Vorschlag rechnet
  // Preis je kg bzw. l × Mittelmenge (KAN-133); ohne Lagerbuchung bleibt die Einheit unbekannt – dann
  // kein Vorschlag.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawBew } = await alle(tf((supabase.from('psm_lager_bewegungen') as any)
    .select('id, psm_id, datum, menge, einheit')
    .order('datum', { ascending: false })
    .order('id')))
  const buchungenJePsm = new Map<string, LagerBuchung[]>()
  for (const b of ((rawBew ?? []) as AR[])) {
    if (!b.einheit) continue
    const arr = buchungenJePsm.get(b.psm_id) ?? []
    arr.push({ datum: b.datum, menge: Number(b.menge), einheit: b.einheit })
    buchungenJePsm.set(b.psm_id, arr)
  }
  const psmEinheit = new Map(Array.from(buchungenJePsm, ([id, buchungen]) => [id, preisEinheit(buchungen)]))

  const psm: PSM[] = ((rawPSM ?? []) as AR[]).map(p => ({
    id:             p.id,
    name:           p.name,
    handelsname:    p.handelsname ?? null,
    kategorie:      p.kategorie ?? null,
    wartezeit_tage: p.wartezeit_tage ?? null,
    oeko_zugelassen: p.oeko_zugelassen ?? false,
    cu_gehalt_pct:  p.cu_gehalt_pct ?? null,
    wirkstoff:      p.wirkstoff ?? null,
    wirkstoffgehalt_pct: p.wirkstoffgehalt_pct ?? null,
    preis_pro_einheit: p.preis_pro_einheit ?? null,
    einheit:        psmEinheit.get(p.id) ?? null,
  }))

  // Düngemittel laden (global + eigene) — inkl. preis_pro_einheit + einheit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawDuenger } = await tf((supabase.from('duengemittel') as any)
    .select('id, name, handelsname, typ, wartezeit_tage, oeko_zugelassen, preis_pro_einheit, einheit')
    .eq('aktiv', true)
    .order('name'))
  const duengemittel: DuengemittelOption[] = ((rawDuenger ?? []) as AR[]).map(d => ({
    id:              d.id,
    name:            d.name,
    handelsname:     d.handelsname ?? null,
    typ:             d.typ ?? null,
    wartezeit_tage:  d.wartezeit_tage ?? null,
    oeko_zugelassen: d.oeko_zugelassen ?? false,
    preis_pro_einheit: d.preis_pro_einheit ?? null,
    einheit:         d.einheit ?? null,
  }))

  // Kostenarten (für die Kosten-Vorschlagsfunktion)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawKostenarten } = await tf((supabase.from('kostenarten') as any)
    .select('id, name, kategorie')
    .eq('aktiv', true)
    .order('name'))
  const kostenarten: KostenartOption[] = ((rawKostenarten ?? []) as AR[]).map(k => ({
    id: k.id, name: k.name, kategorie: k.kategorie ?? null,
  }))

  // Hektarsätze je Maßnahmenart (für die Kosten-Vorschlagsfunktion, migration 133)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawSaetze } = await tf((supabase.from('saetze_massnahmen') as any)
    .select('id, art, bezeichnung, satz_pro_ha')
    .eq('aktiv', true)
    .order('art')
    .order('bezeichnung'))
  const saetzeMassnahmen: SatzOption[] = ((rawSaetze ?? []) as AR[]).map(s => ({
    id: s.id, art: s.art, bezeichnung: s.bezeichnung, satz_pro_ha: s.satz_pro_ha,
  }))

  // Aktive Weingärten mit Lage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawW } = await tf((supabase.from('weingarten') as any)
    .select('id, name, ried, lage_id, lagen:lage_id(name)')
    .eq('aktiv', true)
    .order('name'))

  // Grundstücke laden: nutzart + flaeche_ha + gst_nr (für Ried→GST-Auswahl)
  // Rückmeldung 24.8.2026: vorher "status" - "aktiv" abgelöst durch
  // nutzart==='WI' (Nutzart ersetzt Status als Quelle für Spritzbarkeit).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawG } = await tf((supabase.from('grundstuecke') as any)
    .select('id, weingarten_id, gst_nr, rebsorte, nutzart, flaeche_ha'))

  // Flächensumme und Spritzbarkeit je Weingarten berechnen
  const gstByWG = new Map<string, { nutzart: string | null; ha: number }[]>()
  for (const g of ((rawG ?? []) as AR[])) {
    const arr = gstByWG.get(g.weingarten_id) ?? []
    arr.push({ nutzart: g.nutzart, ha: g.flaeche_ha ?? 0 })
    gstByWG.set(g.weingarten_id, arr)
  }

  const weingaerten: WeingartenOption[] = ((rawW ?? []) as AR[]).map(w => {
    const gsts = gstByWG.get(w.id) ?? []
    // KAN-132 (Frage 6): nur Rieden mit Grundstück der Nutzart WI – eine Maßnahme ohne Grundstück ist nicht verteilbar
    const spritzbar = gsts.some(g => g.nutzart === 'WI')
    const gst_ha_aktiv = gsts.filter(g => g.nutzart === 'WI').reduce((s, g) => s + g.ha, 0)
    return {
      id:           w.id,
      name:         w.name,
      ried:         w.ried ?? null,
      lage_id:      w.lage_id ?? null,
      lage_name:    w.lagen?.name ?? null,
      spritzbar,
      gst_ha_aktiv,
    }
  })

  // Einzelne (aktive) Grundstücke je Weingarten – für die GST-Feinauswahl im Formular
  const gstByWeingarten: Record<string, GSTOption[]> = {}
  for (const g of ((rawG ?? []) as AR[])) {
    if (g.nutzart !== 'WI') continue
    if (!gstByWeingarten[g.weingarten_id]) gstByWeingarten[g.weingarten_id] = []
    gstByWeingarten[g.weingarten_id].push({
      id: g.id, weingarten_id: g.weingarten_id, gst_nr: g.gst_nr,
      rebsorte: g.rebsorte ?? null, flaeche_ha: g.flaeche_ha ?? null,
    })
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <a href="/behandlungen" className="hover:text-s112-blue-700 transition-colors">Maßnahmen</a>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neue Maßnahme</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-6">Neue Maßnahme erfassen</h1>
      <NeueBehandlungForm
        psm={psm}
        duengemittel={duengemittel}
        weingaerten={weingaerten}
        gstByWeingarten={gstByWeingarten}
        bioStatus={bioStatus}
        kostenarten={kostenarten}
        saetzeMassnahmen={saetzeMassnahmen}
      />
    </div>
  )
}
