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
  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? null

  // Alle Aktivitäten mit Datum
  const { data: aktivRawAll } = await (supabase.from('aktivitaeten') as any)
    .select('id, art, betreff, datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, kontakt_id, firma_id, ist_privat, erstellt_von, bis_datum')
    .not('datum', 'is', null)
    .order('datum', { ascending: true })

  // "Nur für mich sichtbar"-Termine anderer Nutzer serverseitig herausfiltern
  const aktivRaw = ((aktivRawAll ?? []) as AR[]).filter(
    (a: AR) => !a.ist_privat || a.erstellt_von === currentUserId
  )

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
    // Schema 005: id = auth.users.id (PK). full_name ist das Feld, das der User
    // selbst unter /profil pflegt (siehe src/app/api/profil/route.ts) - display_name
    // wird nur einmalig beim Signup gesetzt (Migration 005) und danach nie wieder
    // aktualisiert. Vorher wurde hier faelschlich display_name gelesen, wodurch der
    // Name im Kalender-Filter vom im Profil hinterlegten Namen abweichen konnte
    // (z.B. "Jörgen Vöhringer" statt des spaeter auf "Jörgen" geaenderten Namens).
    const { data: profilesRaw } = await (supabase.from('profiles') as any)
      .select('id, full_name, display_name')
      .in('id', uniqueUserIds)
    ;(profilesRaw as AR[] ?? []).forEach((p: AR) => {
      const name = p.full_name || p.display_name
      if (name && p.id) userProfiles[p.id] = name
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
        // Unerledigte Ganztags-Aktivitäten aus der Vergangenheit → auf heute schieben.
        // Mehrtägige Einträge (bis_datum gesetzt, z.B. Urlaub/Abwesenheit) NICHT verschieben –
        // sonst wandert deren Startdatum täglich auf "heute" und der Balken verschwindet aus
        // zurückliegenden Kalenderwochen, obwohl der Zeitraum noch/schon lief.
        datum: (!a.erledigt && ((a.ganztags as boolean) ?? true) && !a.bis_datum && (a.datum as string) < heute)
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
        ist_privat:   (a.ist_privat as boolean | null) ?? null,
        erstellt_von: (a.erstellt_von as string | null) ?? null,
        bis_datum:    (a.bis_datum as string | null) ?? null,
      }
    }),

  ].sort((a, b) => a.datum.localeCompare(b.datum))

  const kontakteList = (kontakteRaw as AR[] ?? []).map((k: AR) => ({
    id: k.id as string,
    name: [k.vorname, k.nachname].filter(Boolean).join(' ') as string,
  }))
  const firmenList = (firmenRaw as AR[] ?? []).map((f: AR) => ({
    id: f.id as string,
    name: f.name as string,
  }))

  return <CRMUebersichtClient eintraege={eintraege} heute={heute} kontakte={kontakteList} firmen={firmenList} userProfiles={userProfiles} />
}
