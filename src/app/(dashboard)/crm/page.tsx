import { createSupabaseServerClient } from '@/lib/supabase/server'
import CRMUebersichtClient from './CRMUebersichtClient'
import type { KalenderEintrag } from './CRMUebersichtClient'
import { AKTIVITAET_ARTEN } from '@/lib/crm/types'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ladeMandantMitglieder } from '@/lib/aufgaben/mitglieder'
import { ladeOutlookStatus } from '@/lib/m365/benutzer'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function CRMUebersichtPage({ searchParams }: { searchParams: Promise<{ aktivitaet?: string }> }) {
  const { aktivitaet: oeffneId } = await searchParams
  const supabase = await createSupabaseServerClient()
  const heute = new Date().toISOString().split('T')[0]
  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? null
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Alle Aktivitäten mit Datum
  const { data: aktivRawAll } = await tf((supabase.from('aktivitaeten') as any)
    .select('id, art, betreff, datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, kontakt_id, firma_id, ist_privat, erstellt_von, bis_datum, verantwortlich_id, fuer_alle, beschreibung')
    .not('datum', 'is', null)
    // Verkauf/Notiz/E-Mail erscheinen nicht im Kalender - gar nicht erst laden
    // (E-Mail-Aktivitäten wachsen mit jeder geöffneten Nachricht, 17.9.2026)
    .not('art', 'in', '("verkauf","notiz","email")')
    .order('datum', { ascending: true })
    .limit(5000))

  // "Nur für mich sichtbar"-Termine anderer Nutzer serverseitig herausfiltern
  const aktivRaw = ((aktivRawAll ?? []) as AR[]).filter(
    (a: AR) => !a.ist_privat || a.erstellt_von === currentUserId
  )

  // Namen nur für die in Aktivitäten verwiesenen Kontakte/Firmen (17.9.2026 -
  // vorher alle 8.300 Kontakte + 4.600 Firmen; die Auswahlfelder im Termin-
  // Dialog suchen jetzt serverseitig über /api/crm/suche).
  const kontaktIds = [...new Set(aktivRaw.map((a: AR) => a.kontakt_id).filter(Boolean))] as string[]
  const firmaIds   = [...new Set(aktivRaw.map((a: AR) => a.firma_id).filter(Boolean))] as string[]
  const inBloecken = async (tabelle: string, spalten: string, ids: string[]) => {
    const out: AR[] = []
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await tf((supabase.from(tabelle) as any).select(spalten).in('id', ids.slice(i, i + 300)))
      out.push(...((data ?? []) as AR[]))
    }
    return out
  }
  const [kontakteRaw, firmenRaw] = await Promise.all([
    inBloecken('kontakte', 'id, vorname, nachname', kontaktIds),
    inBloecken('firmen', 'id, name', firmaIds),
  ])

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
    // Erledigte Aufgaben verschwinden aus dem Kalender (anders als sonstige
    // erledigte Termine, die nur ausgegraut bleiben) - siehe chipFarbe() in
    // CRMUebersichtClient.tsx fuer die generelle "erledigt"-Ausgrauung.
    ...(aktivRaw as AR[] ?? []).filter((a: AR) =>
      a.art !== 'verkauf' && a.art !== 'notiz' && a.art !== 'email' &&
      !(a.art === 'aufgabe' && a.erledigt)
    ).map((a: AR) => {
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
        verantwortlich_id: (a.verantwortlich_id as string | null) ?? null,
        fuer_alle:    !!(a.fuer_alle as boolean),
        beschreibung: (a.beschreibung as string | null) ?? null,
      }
    }),

  ].sort((a, b) => a.datum.localeCompare(b.datum))

  // Mitglieder des Betriebs für die Verantwortlich-Auswahl (Aufgabenzuordnung, 22.9.2026)
  const [mitglieder, outlook] = await Promise.all([
    tenantId ? ladeMandantMitglieder(tenantId) : Promise.resolve([]),
    // Outlook-Status für den Termin-Dialog (Einladung an Kollegen, Frei/Belegt – Migration 225)
    tenantId && currentUserId ? ladeOutlookStatus(tenantId, currentUserId) : Promise.resolve(null),
  ])
  mitglieder.forEach(m => { if (!userProfiles[m.id]) userProfiles[m.id] = m.name })

  return <CRMUebersichtClient eintraege={eintraege} heute={heute} userProfiles={userProfiles}
    mitglieder={mitglieder.map(m => ({ id: m.id, name: m.name }))} userId={currentUserId} oeffneId={oeffneId ?? null} outlook={outlook} />
}
