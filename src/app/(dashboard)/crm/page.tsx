import { createSupabaseServerClient } from '@/lib/supabase/server'
import CRMUebersichtClient from './CRMUebersichtClient'
import type { KalenderEintrag } from './CRMUebersichtClient'
import { AKTIVITAET_ARTEN } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function CRMUebersichtPage() {
  const supabase = await createSupabaseServerClient()
  const heute = new Date().toISOString().split('T')[0]

  // Alle Aktivitäten mit Datum
  const { data: aktivRaw } = await (supabase.from('aktivitaeten') as any)
    .select('id, art, betreff, datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, kontakt_id, firma_id')
    .not('datum', 'is', null)
    .order('datum', { ascending: true })

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
    // Aktivitäten (ohne Verkaufs-Einträge)
    ...(aktivRaw as AR[] ?? []).filter((a: AR) => a.art !== 'verkauf').map((a: AR) => {
      const artDef = AKTIVITAET_ARTEN.find(x => x.value === a.art)
      return {
        id: `a_${a.id}`,
        // Unerleidigte Ganztags-Aktivitäten aus der Vergangenheit → auf heute schieben
        datum: (!a.erledigt && ((a.ganztags as boolean) ?? true) && (a.datum as string) < heute)
          ? heute
          : (a.datum as string),
        titel: (a.betreff as string | null) || artDef?.label || (a.art as string),
        typ: 'aktivitaet' as const,
        art: a.art as string,
        artIcon: artDef?.icon ?? '📝',
        ganztags: (a.ganztags as boolean) ?? true,
        uhrzeit_von: (a.uhrzeit_von as string | null) ?? null,
        uhrzeit_bis: (a.uhrzeit_bis as string | null) ?? null,
        erledigt:     !!(a.erledigt as boolean),
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

  ].sort((a, b) => a.datum.localeCompare(b.datum))

  const kontakteList = (kontakteRaw as AR[] ?? []).map((k: AR) => ({
    id: k.id as string,
    name: [k.vorname, k.nachname].filter(Boolean).join(' '),
  }))
  const firmenList = (firmenRaw as AR[] ?? []).map((f: AR) => ({
    id: f.id as string,
    name: f.name as string,
  }))

  return <CRMUebersichtClient eintraege={eintraege} heute={heute} kontakte={kontakteList} firmen={firmenList} />
}
