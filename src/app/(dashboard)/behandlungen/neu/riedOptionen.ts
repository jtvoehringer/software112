import 'server-only'
import { geladen } from '@/lib/supabase/geladen'

// Ried- und GST-Optionen der Maßnahmen-Formulare (Neue Maßnahme und – seit 30.09.2026 – Maßnahme bearbeiten):
// aktive Rieden mit Lage, Spritzbarkeit (nur mit Grundstück der Nutzart WI, KAN-132 Frage 6) und die WI-GST je Ried.

import type { WeingartenOption, GSTOption } from './page'
import { gstAktivAm } from '@/lib/wein/grundstueckAktiv'
import { wienHeute } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// KAN-150 F1: nur Grundstücke, die am Stichtag bewirtschaftet werden (Neue Maßnahme: heute, Bearbeiten: Tag der Maßnahme)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeRiedOptionen(supabase: any, tenantId: string, stichtag: string = wienHeute()): Promise<{ weingaerten: WeingartenOption[]; gstByWeingarten: Record<string, GSTOption[]> }> {
  const [rawWRes, rawGRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weingarten') as any)
      .select('id, name, ried, lage_id, lagen:lage_id(name)')
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)
      .order('name'),
    // Rückmeldung 24.8.2026: Nutzart WI ersetzt den Status als Quelle für die Spritzbarkeit
    // alle(): sonst fehlen ab dem 1.001. Grundstück Rieden und GST in der Auswahl
    alle<AR>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('grundstuecke') as any)
        .select('id, weingarten_id, gst_nr, rebsorte, nutzart, flaeche_ha, aktiv, deaktiviert_am')
        .eq('tenant_id', tenantId)
        .order('id'),
    ),
  ])
  const rawW = geladen(rawWRes, 'Rieden')
  const rawG = geladen(rawGRes, 'Grundstücke')
  const gstAktiv = ((rawG ?? []) as AR[]).filter(g => gstAktivAm(g, stichtag))
  const gstByWG = new Map<string, { nutzart: string | null; ha: number }[]>()
  for (const g of gstAktiv) {
    const arr = gstByWG.get(g.weingarten_id) ?? []
    arr.push({ nutzart: g.nutzart, ha: g.flaeche_ha ?? 0 })
    gstByWG.set(g.weingarten_id, arr)
  }
  const weingaerten: WeingartenOption[] = ((rawW ?? []) as AR[]).map(w => {
    const gsts = gstByWG.get(w.id) ?? []
    return {
      id: w.id, name: w.name, ried: w.ried ?? null, lage_id: w.lage_id ?? null, lage_name: w.lagen?.name ?? null,
      // KAN-132 (Frage 6): nur Rieden mit Grundstück der Nutzart WI – eine Maßnahme ohne Grundstück ist nicht verteilbar
      spritzbar: gsts.some(g => g.nutzart === 'WI'),
      gst_ha_aktiv: gsts.filter(g => g.nutzart === 'WI').reduce((s, g) => s + g.ha, 0),
    }
  })
  const gstByWeingarten: Record<string, GSTOption[]> = {}
  for (const g of gstAktiv) {
    if (g.nutzart !== 'WI') continue
    ;(gstByWeingarten[g.weingarten_id] ??= []).push({
      id: g.id, weingarten_id: g.weingarten_id, gst_nr: g.gst_nr, rebsorte: g.rebsorte ?? null, flaeche_ha: g.flaeche_ha ?? null,
    })
  }
  return { weingaerten, gstByWeingarten }
}
