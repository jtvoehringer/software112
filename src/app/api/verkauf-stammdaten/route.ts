import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { leseOrtSchluessel, verfuegbarJeLese } from '@/lib/wein/leseBilanz'
import { leseTitel } from '@/lib/wein/lesen'
import { zahlWert } from '@/lib/format'

export const dynamic = 'force-dynamic'

export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })

    const supabase = await createSupabaseServerClient()

    const { data: einstellungen, error: einstErr } = await (supabase.from('tenant_einstellungen') as any)
      .select('ust_satz_standard').eq('tenant_id', tenantId).maybeSingle()
    // KAN-252: sonst stünde im Verkauf still 13 % statt des Standard-Satzes des Betriebs (Weinhändler 20 %)
    if (einstErr) return NextResponse.json({ error: `Betriebseinstellungen konnten nicht geladen werden: ${einstErr.message}` }, { status: 500 })
    const ustStandard: number = (zahlWert((einstellungen as any)?.ust_satz_standard) ?? 13)

    const [
      { data: fuellungen, error: fuellungenErr },
      { data: weinausbau, error: weinausbauErr },
      { data: sonstigeArtikel, error: sonstigeArtikelErr },
      { data: weingaertenRaw, error: weingaertenRawErr },
      { data: jahrgaenge, error: jahrgaengeErr },
      { data: grundstuecke, error: grundstueckeErr },
      { data: lesemeldungenRaw, error: lesemeldungenRawErr },
      { data: pressungWGRaw, error: pressungWGRawErr },
      { data: tvSoldRaw, error: tvSoldRawErr },
      { data: lesenRaw, error: lesenRawErr },
    ] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alle((supabase.from('fuellungen') as any)
        .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto')
        .eq('tenant_id', tenantId).eq('aktiv', true).gt('bestand_flaschen', 0).order('name').order('id')),
      // Offener Wein (Tank) wird seit KAN-35 (24.09.2026) NUR aus Kellerbuch-Chargen
      // verkauft. Zukäufe ohne Gebinde und Pressungs-Direktbefüllungen werden hier
      // nicht mehr angeboten: ein Verkauf über sie setzte die Beleg- bzw. Zugangsmenge
      // (zukauf_posten.menge, pressung_behaelter.menge_liter) herab. Zukäufe erst über
      // „Zukauf bearbeiten“ einem Gebinde zuordnen – dann erscheint die Charge hier.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alle((supabase.from('weinausbau') as any)
        .select('id, name, menge_liter')
        .eq('tenant_id', tenantId).eq('aktiv', true).neq('status', 'abgeschlossen').gt('menge_liter', 0).order('name').order('id')),
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
      // Grundstücke für Traubenverkauf – alle(): sonst fehlen ab dem 1.001. Grundstück Einträge in der Auswahl
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alle((supabase.from('grundstuecke') as any)
        .select('id, gst_nr, weingarten_id, rebsorte')
        .eq('tenant_id', tenantId)
        .eq('aktiv', true)   // KAN-150 F1: nur bewirtschaftete Grundstücke zur Auswahl
        .order('gst_nr').order('id')),
      // Verfügbare kg: Lesemeldungen − Pressungen − bereits verkaufte Trauben
      // tenant-isolation-ignore: ernte_parzellen ohne tenant_id, Filter über den Jahrgang
      (supabase.from('ernte_parzellen') as any)
        .select('weingarten_id, grundstueck_id, menge_kg, klosterneuburger, oechsle, mostgewicht_einheit, qualitaetsstufe, ernte_datum, jahrgang_id, lese_id, jahrgang:jahrgang_id!inner(tenant_id)')
        .eq('jahrgang.tenant_id', tenantId)
        .is('storniert_am', null)
        .order('ernte_datum', { ascending: false }),
      // tenant-isolation-ignore: pressung_weingaerten ohne tenant_id, Filter über die Pressung
      (supabase.from('pressung_weingaerten') as any)
        .select('weingarten_id, grundstueck_id, trauben_kg, pressung:pressung_id!inner(tenant_id, lese_id, storniert_am)')
        .eq('pressung.tenant_id', tenantId)
        .is('storniert_am', null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alle((supabase.from('traubenverkauf') as any)
        .select('weingarten_id, grundstueck_id, menge_kg, lese_id')
        .eq('tenant_id', tenantId)
        .is('storniert_am', null).order('id')),
      // KAN-129: Lesen des Betriebs (Auswahl je Trauben-Position)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('lesen') as any)
        .select('id, jahrgang_id, lfd_nr, art, bezeichnung, jahrgang:weinjahrgaenge!lesen_jahrgang_fkey(jahrgang)')
        .eq('tenant_id', tenantId),
    ])
    { const ladeFehler = [fuellungenErr, weinausbauErr, sonstigeArtikelErr, weingaertenRawErr, jahrgaengeErr, grundstueckeErr, lesemeldungenRawErr, pressungWGRawErr, tvSoldRawErr, lesenRawErr].find(Boolean)
      if (ladeFehler) return NextResponse.json({ error: `Daten konnten nicht geladen werden: ${ladeFehler.message}` }, { status: 500 }) }

    // ── Verfügbare kg je Lese und Ort (KAN-129: kg-Bilanz je Lese, lib/wein/leseBilanz.ts) ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parzellen = (lesemeldungenRaw ?? []) as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pressungWG = (pressungWGRaw ?? []) as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tvSold = (tvSoldRaw ?? []) as any[]
    // Lesen neueste zuerst (Jahrgang, dann Nummer)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lesen = ((lesenRaw ?? []) as any[]).map(l => {
      const jahr = Number(l.jahrgang?.jahrgang)
      return { id: l.id as string, jahrgang_id: l.jahrgang_id as string, jahrgang: jahr, lfd_nr: Number(l.lfd_nr),
        titel: leseTitel(jahr, { lfd_nr: Number(l.lfd_nr), art: l.art, bezeichnung: l.bezeichnung ?? null }) }
    }).sort((a, b) => (b.jahrgang - a.jahrgang) || (b.lfd_nr - a.lfd_nr))

    const verfuegbar = verfuegbarJeLese(
      parzellen.map(l => ({ lese_id: l.lese_id ?? null, weingarten_id: l.weingarten_id, grundstueck_id: l.grundstueck_id ?? null, kg: l.menge_kg == null ? null : Number(l.menge_kg) })),
      [
        ...pressungWG.map(p => ({ lese_id: p.pressung?.lese_id ?? null, weingarten_id: p.weingarten_id ?? null, grundstueck_id: p.grundstueck_id ?? null, kg: Number(p.trauben_kg) || 0 })),
        ...tvSold.map(v => ({ lese_id: v.lese_id ?? null, weingarten_id: v.weingarten_id ?? null, grundstueck_id: v.grundstueck_id ?? null, kg: parseFloat(v.menge_kg) || 0 })),
      ],
    )

    // Mostgewicht + Qualität je Lese und Ort: neuester Lese-Eintrag (parzellen nach ernte_datum desc).
    // Mostgewicht mit gemessener Einheit (KAN-128) – Vorbelegung im Verkaufsformular
    type Mg = { kmw: number | null; oechsle: number | null; einheit: string | null } | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mgAus = (l: any): Mg => (l.klosterneuburger == null && l.oechsle == null ? null : {
      kmw: l.klosterneuburger != null ? Number(l.klosterneuburger) : null,
      oechsle: l.oechsle != null ? Number(l.oechsle) : null,
      einheit: l.mostgewicht_einheit ?? null,
    })
    const mgJe = new Map<string, { mostgewicht: Mg; qualitaetsstufe: string | null }>()
    for (const l of parzellen) {
      if (!l.lese_id) continue
      for (const ort of [l.weingarten_id, l.grundstueck_id].filter(Boolean) as string[]) {
        const k = leseOrtSchluessel(l.lese_id, ort)
        if (!mgJe.has(k)) mgJe.set(k, { mostgewicht: mgAus(l), qualitaetsstufe: l.qualitaetsstufe ?? null })
      }
    }
    /** Je Lese (neueste zuerst) die verfügbaren kg an einem Ort; Standard = neueste Lese mit Menge */
    const jeLese = (ortId: string, karte: Map<string, number>) => {
      const eintraege = lesen
        .filter(l => karte.has(leseOrtSchluessel(l.id, ortId)))
        .map(l => {
          const k = leseOrtSchluessel(l.id, ortId)
          return { lese_id: l.id, jahrgang_id: l.jahrgang_id, verfuegbar_kg: karte.get(k) ?? 0,
            mostgewicht: mgJe.get(k)?.mostgewicht ?? null, qualitaetsstufe: mgJe.get(k)?.qualitaetsstufe ?? null }
        })
      const standard = eintraege.find(x => x.verfuegbar_kg > 0) ?? null
      return { eintraege, standard }
    }

    // Weingärten: nur jene mit verfügbarer Menge in mindestens einer Lese
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const weingaertenMitKg = ((weingaertenRaw ?? []) as any[])
      .map((wg: any) => {
        const { eintraege, standard } = jeLese(wg.id, verfuegbar.ried)
        return {
          id:                    wg.id,
          name:                  wg.name,
          lage_name:             (wg.lage as any)?.name ?? null,
          trauben_herkunft_code: wg.trauben_herkunft_code ?? null,
          verfuegbar_kg:         standard?.verfuegbar_kg ?? 0,
          kmw_grad:              standard?.mostgewicht?.kmw ?? null,
          mostgewicht:           standard?.mostgewicht ?? null,
          qualitaetsstufe:       standard?.qualitaetsstufe ?? null,
          jahrgang_id:           standard?.jahrgang_id ?? null,
          lese_id:               standard?.lese_id ?? null,
          je_lese:               eintraege,
        }
      })
      .filter((wg: any) => wg.je_lese.some((x: any) => x.verfuegbar_kg > 0))

    // Grundstücke: nur gelesene (Lese-Eintrag mit Menge in einer Lese)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grundstueckeMitKg = ((grundstuecke ?? []) as any[])
      .map((g: any) => {
        const { eintraege, standard } = jeLese(g.id, verfuegbar.gst)
        return {
          id:              g.id,
          gst_nr:          g.gst_nr,
          weingarten_id:   g.weingarten_id,
          rebsorte:        g.rebsorte ?? null,
          verfuegbar_kg:   standard?.verfuegbar_kg ?? 0,
          kmw_grad:        standard?.mostgewicht?.kmw ?? null,
          mostgewicht:     standard?.mostgewicht ?? null,
          qualitaetsstufe: standard?.qualitaetsstufe ?? null,
          jahrgang_id:     standard?.jahrgang_id ?? null,
          lese_id:         standard?.lese_id ?? null,
          je_lese:         eintraege,
        }
      })
      .filter((g: any) => g.je_lese.length > 0)

    return NextResponse.json({
      fuellungen:       fuellungen    ?? [],
      weinausbau:       weinausbau    ?? [],
      sonstige_artikel: sonstigeArtikel ?? [],
      ust_satz_standard: ustStandard,
      weingaerten: weingaertenMitKg,
      jahrgaenge:  (jahrgaenge ?? []) as any[],
      grundstuecke: grundstueckeMitKg,
      lesen,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
