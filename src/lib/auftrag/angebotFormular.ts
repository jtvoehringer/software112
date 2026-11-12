import 'server-only'

// KAN-418 Teil 4: Stammdaten für das Angebotsformular (Anlegen und Bearbeiten) – aktive Füllungen mit Verkaufspreis und
// derzeit verfügbarer Menge (nur Hinweis, ein Angebot reserviert nichts), Standard-USt. und Standardfrist des Betriebs.

import { alle } from '@/lib/supabase/alle'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { zahlWert } from '@/lib/format'
import { ladeReservierungen } from './laden'
import { reservierungTage, verfuegbar } from './regeln'

type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export type AngebotFormularDaten = {
  fuellungen: { id: string; name: string; preis: number | null; verfuegbar: number }[]
  ustStandard: number
  fristTage: number
}

/** `mitIds`: Füllungen, die schon im Angebot stehen – bleiben wählbar, auch wenn sie inzwischen inaktiv sind */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeAngebotFormular(supabase: any, tenantId: string, mitIds: readonly string[] = []): Promise<AngebotFormularDaten> {
  const [fRes, reserviert, eRes] = await Promise.all([
    alle<R>((supabase.from('fuellungen') as R)
      .select('id, name, jahrgang, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto, aktiv')
      .eq('tenant_id', tenantId).is('storniert_am', null).order('name').order('id')),
    ladeReservierungen(supabase, tenantId),
    (supabase.from('tenant_einstellungen') as R).select('ust_satz_standard, auftrag_reservierung_tage').eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (fRes.error) throw new AktionsFehler(dbFehlerText(fRes.error, 'Die Füllungen konnten nicht geladen werden'))
  if (eRes.error) throw new AktionsFehler(dbFehlerText(eRes.error, 'Die Einstellungen konnten nicht geladen werden'))
  const drin = new Set(mitIds)
  const einst = (eRes.data ?? {}) as R
  return {
    fuellungen: ((fRes.data ?? []) as R[]).filter(f => f.aktiv || drin.has(f.id)).map(f => ({
      id: f.id as string,
      name: [f.name, f.jahrgang, f.flaschengroesse_ml ? `${f.flaschengroesse_ml} ml` : null].filter(Boolean).join(' · '),
      preis: zahlWert(f.vk_preis_brutto),
      verfuegbar: verfuegbar(f.bestand_flaschen, reserviert.get(f.id)),
    })),
    ustStandard: zahlWert(einst.ust_satz_standard) ?? 13,
    fristTage: reservierungTage(einst.auftrag_reservierung_tage),
  }
}
