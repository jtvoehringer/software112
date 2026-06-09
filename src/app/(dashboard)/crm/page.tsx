import { createSupabaseServerClient } from '@/lib/supabase/server'
import CRMUebersichtClient from './CRMUebersichtClient'
import type { KalenderEintrag } from './CRMUebersichtClient'
import { AKTIVITAET_ARTEN } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

const PIPELINE_ABGESCHLOSSEN = new Set(['stammkunde', 'abschluss', 'verloren'])

export default async function CRMUebersichtPage() {
  const supabase = await createSupabaseServerClient()
  const heute = new Date().toISOString().split('T')[0]

  // Alle Aktivitäten mit Datum
  const { data: aktivRaw } = await (supabase.from('aktivitaeten') as any)
    .select('id, art, betreff, datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, kontakt_id, firma_id')
    .not('datum', 'is', null)
    .order('datum', { ascending: true })

  // Alle Pipeline-Einträge mit Erwartungsdatum
  const { data: pipelineRaw } = await (supabase.from('pipeline_eintraege') as any)
    .select('id, titel, stufe, erwartetes_datum, ganztags, uhrzeit_von, uhrzeit_bis, kontakt_id, firma_id')
    .not('erwartetes_datum', 'is', null)
    .order('erwartetes_datum', { ascending: true })

  // Namen aus Kontakte & Firmen
  const { data: kontakteRaw } = await (supabase.from('kontakte') as any)
    .select('id, vorname, nachname')
  const { data: firmenRaw } = await (supabase.from('firmen') as any)
    .select('id, name')

  const kontakteMap: Record<string, string> = {}
  ;(kontakteRaw as AR[] ?? []).forEach((k: AR) => {
    kontakteMap[k.id] = [k.vorname, k.nachname].filter(Boolean).join(' ')
  })
  const firmenMap: Record<string, string> = {}
  ;(firmenRaw as AR[] ?? []).forEach((f: AR) => {
    firmenMap[f.id] = f.name
  })

  const eintraege: KalenderEintrag[] = [
    // Aktivitäten
    ...(aktivRaw as AR[] ?? []).map((a: AR) => {
      const artDef = AKTIVITAET_ARTEN.find(x => x.value === a.art)
      return {
        id: `a_${a.id}`,
        datum: a.datum as string,
        titel: (a.betreff as string | null) || artDef?.label || (a.art as string),
        typ: 'aktivitaet' as const,
        art: a.art as string,
        artIcon: artDef?.icon ?? '📝',
        ganztags: (a.ganztags as boolean) ?? true,
        uhrzeit_von: (a.uhrzeit_von as string | null) ?? null,
        uhrzeit_bis: (a.uhrzeit_bis as string | null) ?? null,
        ueberfaellig: !a.erledigt && (a.datum as string) < heute,
        href: a.kontakt_id
          ? `/crm/kontakte/${a.kontakt_id}`
          : a.firma_id
            ? `/crm/firmen/${a.firma_id}`
            : '/crm/kontakte',
        kontaktName: a.kontakt_id ? (kontakteMap[a.kontakt_id] ?? null) : null,
        firmaName: a.firma_id ? (firmenMap[a.firma_id] ?? null) : null,
      }
    }),

    // Pipeline-Einträge
    ...(pipelineRaw as AR[] ?? []).map((p: AR) => ({
      id: `p_${p.id}`,
      datum: p.erwartetes_datum as string,
      titel: p.titel as string,
      typ: 'pipeline' as const,
      art: p.stufe as string,
      artIcon: '💼',
      ganztags: (p.ganztags as boolean) ?? true,
      uhrzeit_von: (p.uhrzeit_von as string | null) ?? null,
      uhrzeit_bis: (p.uhrzeit_bis as string | null) ?? null,
      ueberfaellig:
        !PIPELINE_ABGESCHLOSSEN.has(p.stufe as string) &&
        (p.erwartetes_datum as string) < heute,
      href: '/crm/pipeline',
      kontaktName: p.kontakt_id ? (kontakteMap[p.kontakt_id] ?? null) : null,
      firmaName: p.firma_id ? (firmenMap[p.firma_id] ?? null) : null,
      stufe: p.stufe as string,
    })),
  ].sort((a, b) => a.datum.localeCompare(b.datum))

  return <CRMUebersichtClient eintraege={eintraege} heute={heute} />
}
