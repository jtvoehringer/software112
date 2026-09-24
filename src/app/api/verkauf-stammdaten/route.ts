import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'

export const dynamic = 'force-dynamic'

export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })

    const supabase = await createSupabaseServerClient()

    const { data: einstellungen } = await (supabase.from('tenant_einstellungen') as any)
      .select('ust_satz_standard').eq('tenant_id', tenantId).maybeSingle()
    const ustStandard: number = parseFloat((einstellungen as any)?.ust_satz_standard) || 13

    const [
      { data: fuellungen },
      { data: weinausbau },
      { data: sonstigeArtikel },
      { data: weingaertenRaw },
      { data: jahrgaenge },
      { data: grundstuecke },
      { data: lesemeldungenRaw },
      { data: pressungWGRaw },
      { data: tvSoldRaw },
    ] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('fuellungen') as any)
        .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto')
        .eq('tenant_id', tenantId).eq('aktiv', true).gt('bestand_flaschen', 0).order('name'),
      // Offener Wein (Tank) wird seit KAN-35 (24.09.2026) NUR aus Kellerbuch-Chargen
      // verkauft. Zukäufe ohne Gebinde und Pressungs-Direktbefüllungen werden hier
      // nicht mehr angeboten: ein Verkauf über sie setzte die Beleg- bzw. Zugangsmenge
      // (zukauf_posten.menge, pressung_behaelter.menge_liter) herab. Zukäufe erst über
      // „Zukauf bearbeiten“ einem Gebinde zuordnen – dann erscheint die Charge hier.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weinausbau') as any)
        .select('id, name, menge_liter')
        .eq('tenant_id', tenantId).eq('aktiv', true).neq('status', 'abgeschlossen').gt('menge_liter', 0).order('name'),
      // Kontakte/Firmen werden seit 17.9.2026 nicht mehr mitgeliefert - die
      // Kundenauswahl sucht serverseitig über /api/crm/suche (PartnerSuche).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('sonstige_artikel') as any)
        .select('id, name, einheit, default_preis')
        .eq('tenant_id', tenantId).eq('aktiv', true).order('name'),
      // Weingärten für Traubenverkauf (mit Ried-Name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weingarten') as any)
        .select('id, name, trauben_herkunft_code, lage:lage_id(name)')
        .eq('tenant_id', tenantId)
        .order('name'),
      // Jahrgänge
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weinjahrgaenge') as any)
        .select('id, jahrgang')
        .eq('tenant_id', tenantId)
        .order('jahrgang', { ascending: false }),
      // Grundstücke für Traubenverkauf
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('grundstuecke') as any)
        .select('id, gst_nr, weingarten_id, rebsorte')
        .eq('tenant_id', tenantId)
        .order('gst_nr'),
      // Verfügbare kg: Lesemeldungen − Pressungen − bereits verkaufte Trauben
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // tenant-isolation-ignore: ernte_parzellen ohne tenant_id, Filter über den Jahrgang
      (supabase.from('ernte_parzellen') as any)
        .select('weingarten_id, grundstueck_id, menge_kg, klosterneuburger, qualitaetsstufe, ernte_datum, jahrgang_id, jahrgang:jahrgang_id!inner(tenant_id)')
        .eq('jahrgang.tenant_id', tenantId)
        .order('ernte_datum', { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // tenant-isolation-ignore: pressung_weingaerten ohne tenant_id, Filter über die Pressung
      (supabase.from('pressung_weingaerten') as any)
        .select('weingarten_id, grundstueck_id, trauben_kg, pressung:pressung_id!inner(tenant_id)')
        .eq('pressung.tenant_id', tenantId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('traubenverkauf') as any)
        .select('weingarten_id, grundstueck_id, menge_kg')
        .eq('tenant_id', tenantId),
    ])

    // ── Verfügbare kg pro Weingarten + Grundstück berechnen ─────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parzellen = (lesemeldungenRaw ?? []) as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pressungWG = (pressungWGRaw ?? []) as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tvSold = (tvSoldRaw ?? []) as any[]

    // Pro Weingarten
    const harvestedByWG: Record<string, number> = {}
    for (const l of parzellen) {
      if (l.menge_kg) harvestedByWG[l.weingarten_id] = (harvestedByWG[l.weingarten_id] ?? 0) + Number(l.menge_kg)
    }
    const pressedByWG: Record<string, number> = {}
    for (const p of pressungWG) {
      if (p.trauben_kg) pressedByWG[p.weingarten_id] = (pressedByWG[p.weingarten_id] ?? 0) + Number(p.trauben_kg)
    }
    const soldByWG: Record<string, number> = {}
    for (const v of tvSold) {
      soldByWG[v.weingarten_id] = (soldByWG[v.weingarten_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
    }

    // Pro Grundstück (GST)
    const harvestedByGST: Record<string, number> = {}
    for (const l of parzellen) {
      if (l.grundstueck_id && l.menge_kg)
        harvestedByGST[l.grundstueck_id] = (harvestedByGST[l.grundstueck_id] ?? 0) + Number(l.menge_kg)
    }
    const pressedByGST: Record<string, number> = {}
    for (const p of pressungWG) {
      if (p.grundstueck_id && p.trauben_kg)
        pressedByGST[p.grundstueck_id] = (pressedByGST[p.grundstueck_id] ?? 0) + Number(p.trauben_kg)
    }
    const soldByGST: Record<string, number> = {}
    for (const v of tvSold) {
      if (v.grundstueck_id)
        soldByGST[v.grundstueck_id] = (soldByGST[v.grundstueck_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
    }

    // Letztes KMW + Qualität pro Weingarten und pro GST (neueste ernte_parzelle)
    const kmwByWG: Record<string, number | null> = {}
    const qualByWG: Record<string, string | null> = {}
    const kmwByGST: Record<string, number | null> = {}
    const qualByGST: Record<string, string | null> = {}
    // parzellen sind bereits nach ernte_datum desc sortiert → erster Treffer = neuester
    for (const l of parzellen) {
      if (!(l.weingarten_id in kmwByWG)) {
        kmwByWG[l.weingarten_id] = l.klosterneuburger != null ? Number(l.klosterneuburger) : null
        qualByWG[l.weingarten_id] = l.qualitaetsstufe ?? null
      }
      if (l.grundstueck_id && !(l.grundstueck_id in kmwByGST)) {
        kmwByGST[l.grundstueck_id] = l.klosterneuburger != null ? Number(l.klosterneuburger) : null
        qualByGST[l.grundstueck_id] = l.qualitaetsstufe ?? null
      }
    }

    // Letztes Jahrgang pro Weingarten und GST
    const jahrgangIdByWG: Record<string, string | null> = {}
    const jahrgangIdByGST: Record<string, string | null> = {}
    for (const l of parzellen) {
      if (!(l.weingarten_id in jahrgangIdByWG)) {
        jahrgangIdByWG[l.weingarten_id] = l.jahrgang_id ?? null
      }
      if (l.grundstueck_id && !(l.grundstueck_id in jahrgangIdByGST)) {
        jahrgangIdByGST[l.grundstueck_id] = l.jahrgang_id ?? null
      }
    }

    // Weingärten: nur jene mit geerntetem Bestand anzeigen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const weingaertenMitKg = ((weingaertenRaw ?? []) as any[])
      .map((wg: any) => ({
        id:                    wg.id,
        name:                  wg.name,
        lage_name:             (wg.lage as any)?.name ?? null,
        trauben_herkunft_code: wg.trauben_herkunft_code ?? null,
        verfuegbar_kg:         Math.max(0, (harvestedByWG[wg.id] ?? 0) - (pressedByWG[wg.id] ?? 0) - (soldByWG[wg.id] ?? 0)),
        kmw_grad:              kmwByWG[wg.id] ?? null,
        qualitaetsstufe:       qualByWG[wg.id] ?? null,
        jahrgang_id:           jahrgangIdByWG[wg.id] ?? null,
      }))
      .filter((wg: any) => wg.verfuegbar_kg > 0)

    // Grundstücke: nur jene anzeigen die geerntet wurden (gst_id in ernte_parzellen)
    const gstMitErnte = new Set(parzellen.filter(l => l.grundstueck_id).map((l: any) => l.grundstueck_id as string))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grundstueckeMitKg = ((grundstuecke ?? []) as any[])
      .filter((g: any) => gstMitErnte.has(g.id))
      .map((g: any) => ({
        id:            g.id,
        gst_nr:        g.gst_nr,
        weingarten_id: g.weingarten_id,
        rebsorte:      g.rebsorte ?? null,
        verfuegbar_kg:   Math.max(0, (harvestedByGST[g.id] ?? 0) - (pressedByGST[g.id] ?? 0) - (soldByGST[g.id] ?? 0)),
        kmw_grad:        kmwByGST[g.id] ?? null,
        qualitaetsstufe: qualByGST[g.id] ?? null,
        jahrgang_id:     jahrgangIdByGST[g.id] ?? null,
      }))

    return NextResponse.json({
      fuellungen:       fuellungen    ?? [],
      weinausbau:       weinausbau    ?? [],
      sonstige_artikel: sonstigeArtikel ?? [],
      ust_satz_standard: ustStandard,
      weingaerten: weingaertenMitKg,
      jahrgaenge:  (jahrgaenge ?? []) as any[],
      grundstuecke: grundstueckeMitKg,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
