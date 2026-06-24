import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()

    const { data: einstellungen } = await (supabase.from('tenant_einstellungen') as any)
      .select('ust_satz_standard').limit(1).maybeSingle()
    const ustStandard: number = parseFloat((einstellungen as any)?.ust_satz_standard) || 13

    const [
      { data: fuellungen },
      { data: weinausbau },
      { data: kontakte },
      { data: firmen },
      { data: sonstigeArtikel },
      { data: zukaufPosten },
      { data: pressungDirektRaw },
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
        .eq('aktiv', true).gt('bestand_flaschen', 0).order('name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weinausbau') as any)
        .select('id, name, menge_liter')
        .eq('aktiv', true).neq('status', 'abgeschlossen').gt('menge_liter', 0).order('name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('kontakte') as any)
        .select('id, vorname, nachname, firma_id, sonderrabatt_pct, skonto_pct, skonto_tage, rabattgruppe:rabattgruppe_id(rabatt_pct)')
        .eq('aktiv', true).order('nachname'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('firmen') as any)
        .select('id, name, sonderrabatt_pct, skonto_pct, skonto_tage, rabattgruppe:rabattgruppe_id(rabatt_pct)')
        .eq('aktiv', true).order('name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('sonstige_artikel') as any)
        .select('id, name, einheit, default_preis')
        .eq('aktiv', true).order('name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('zukauf_posten') as any)
        .select('id, art, menge, einheit, rebsorte, jahrgang, notizen')
        .eq('aktiv', true).gt('menge', 0).order('erstellt_am', { ascending: false }),
      // Pressung-Direktbefüllungen (noch keiner Kellerbuch-Charge zugeordnet)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('pressung_behaelter') as any)
        .select('id, menge_liter, behaelter:behaelter_id(name), pressung:pressung_id(datum, weinbezeichnung)')
        .is('weinausbau_id', null).gt('menge_liter', 0)
        .order('menge_liter', { ascending: false }),
      // Weingärten für Traubenverkauf (mit Ried-Name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weingarten') as any)
        .select('id, name, trauben_herkunft_code, lage:lage_id(name)')
        .order('name'),
      // Jahrgänge
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weinjahrgaenge') as any)
        .select('id, jahrgang')
        .order('jahrgang', { ascending: false }),
      // Grundstücke für Traubenverkauf
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('grundstuecke') as any)
        .select('id, gst_nr, weingarten_id, rebsorte')
        .order('gst_nr'),
      // Verfügbare kg: Lesemeldungen − Pressungen − bereits verkaufte Trauben
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('ernte_parzellen') as any)
        .select('weingarten_id, grundstueck_id, menge_kg'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('pressung_weingaerten') as any)
        .select('weingarten_id, grundstueck_id, trauben_kg'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('traubenverkauf') as any)
        .select('weingarten_id, grundstueck_id, menge_kg'),
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

    // Weingärten: nur jene mit geerntetem Bestand anzeigen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const weingaertenMitKg = ((weingaertenRaw ?? []) as any[])
      .map((wg: any) => ({
        id:                    wg.id,
        name:                  wg.name,
        lage_name:             (wg.lage as any)?.name ?? null,
        trauben_herkunft_code: wg.trauben_herkunft_code ?? null,
        verfuegbar_kg:         Math.max(0, (harvestedByWG[wg.id] ?? 0) - (pressedByWG[wg.id] ?? 0) - (soldByWG[wg.id] ?? 0)),
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
        verfuegbar_kg: Math.max(0, (harvestedByGST[g.id] ?? 0) - (pressedByGST[g.id] ?? 0) - (soldByGST[g.id] ?? 0)),
      }))

    return NextResponse.json({
      fuellungen:       fuellungen    ?? [],
      weinausbau:       weinausbau    ?? [],
      sonstige_artikel: sonstigeArtikel ?? [],
      zukauf_posten:    zukaufPosten  ?? [],
      pressung_direkt:  ((pressungDirektRaw ?? []) as any[]).map((pb: any) => ({
        id:                   pb.id,
        menge_liter:          pb.menge_liter,
        behaelter_name:       (pb.behaelter as any)?.name ?? null,
        pressung_datum:       (pb.pressung as any)?.datum ?? null,
        pressung_bezeichnung: (pb.pressung as any)?.weinbezeichnung ?? null,
      })),
      kontakte: (kontakte ?? []).map((k: any) => ({
        ...k,
        rabatt_pct:       (k.rabattgruppe as any)?.rabatt_pct ?? null,
        sonderrabatt_pct: parseFloat(k.sonderrabatt_pct) || 0,
        skonto_pct:       parseFloat(k.skonto_pct) || 0,
        skonto_tage:      parseInt(k.skonto_tage) || 10,
      })),
      ust_satz_standard: ustStandard,
      firmen: (firmen ?? []).map((f: any) => ({
        ...f,
        rabatt_pct:       (f.rabattgruppe as any)?.rabatt_pct ?? null,
        sonderrabatt_pct: parseFloat(f.sonderrabatt_pct) || 0,
        skonto_pct:       parseFloat(f.skonto_pct) || 0,
        skonto_tage:      parseInt(f.skonto_tage) || 10,
      })),
      weingaerten: weingaertenMitKg,
      jahrgaenge:  (jahrgaenge ?? []) as any[],
      grundstuecke: grundstueckeMitKg,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
