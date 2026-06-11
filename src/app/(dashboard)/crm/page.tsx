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
    .select('id, art, betreff, datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, kontakt_id, firma_id, ist_privat, erstellt_von, bis_datum')
    .not('datum', 'is', null)
    .order('datum', { ascending: true })

  // Namen aus Kontakte & Firmen
  const { data: kontakteRaw } = await (supabase.from('kontakte') as any)
    .select('id, vorname, nachname')
  const { data: firmenRaw } = await (supabase.from('firmen') as any)
    .select('id, name')

  // User-Profile für Klarname in Filter-Chips
  const uniqueUserIds = [...new Set(
    (aktivRaw as AR[] ?? []).map((a: AR) => a.erstellt_von).filter(Boolean)
  )] as string[]
  const userProfiles: Record<string, string> = {}
  if (uniqueUserIds.length > 0) {
    // profiles.id = auth.users.id (Migration 005: PK ist id, nicht user_id)
    const { data: profilesRaw } = await (supabase.from('profiles') as any)
      .select('id, display_name')
      .in('id', uniqueUserIds)
    ;(profilesRaw as AR[] ?? []).forEach((p: AR) => {
      if (p.display_name) userProfiles[p.id] = p.display_name
    })
  }

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
    ...(aktivRaw as AR[] ?? []).filter((a: AR) => a.art !== 'verkauf' && a.art !== 'notiz' && a.art !== 'email').map((a: AR) => {
      const artDef = AKTIVITAET_ARTEN.find(x => x.value === a.art)
      return {
        id: `a_${a.id}`,
        // Unerledigte Ganztags-Aktivitäten aus der Vergangenheit → auf heute schieben
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
            : `/crm?editAkt=${a.id}`,
        kontaktName: a.kontakt_id ? (kontakteMap[a.kontakt_id] ?? null) : null,
        firmaName: a.firma_id ? (firmenMap[a.firma_id] ?? null) : null,
        ist_privat:   (a.ist_privat as boolean | nul