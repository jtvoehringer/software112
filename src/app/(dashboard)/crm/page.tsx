import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle, inBloecken } from '@/lib/supabase/alle'
import CRMUebersichtClient from './CRMUebersichtClient'
import type { KalenderEintrag } from './CRMUebersichtClient'
import { AKTIVITAET_ARTEN } from '@/lib/crm/types'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ladeMandantMitglieder } from '@/lib/aufgaben/mitglieder'
import { ladeOutlookStatus } from '@/lib/m365/benutzer'
import { heuteWien } from '@/lib/datum/wien'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'CRM' }

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export default async function CRMUebersichtPage({ searchParams }: { searchParams: Promise<{ aktivitaet?: string }> }) {
  const { aktivitaet: oeffneId } = await searchParams
  const supabase = await createSupabaseServerClient()
  const heute = heuteWien()
  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? null
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Alle Aktivitäten mit Datum
  // Sweep 102: vollständig über alle() – vorher aufsteigend mit .limit(5000), über der Grenze fehlten die kommenden Termine
  const aktivRawAll = geladen(await alle(tf((supabase.from('aktivitaeten') as any)
    .select('id, art, betreff, datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, kontakt_id, firma_id, ist_privat, erstellt_von, bis_datum, verantwortlich_id, fuer_alle, beschreibung')
    .not('datum', 'is', null)
    // Verkauf/Notiz/E-Mail erscheinen nicht im Kalender - gar nicht erst laden
    // (E-Mail-Aktivitäten wachsen mit jeder geöffneten Nachricht, 17.9.2026)
    .not('art', 'in', '("verkauf","notiz","email")')
    .order('datum', { ascending: true }).order('id'))), 'Aktivitäten')

  // "Nur für mich sichtbar"-Termine anderer Nutzer serverseitig herausfiltern (seit KAN-17 sperrt das auch die
  // Datenbank, Policy akt_privat) – sie erscheinen nur als Zeitblock „Privat“ (s112_privat_bloecke, unten)
  type PrivatBlock = { id: string; datum: string; bis_datum: string | null; ganztags: boolean | null; uhrzeit_von: string | null; uhrzeit_bis: string | null; erledigt: boolean | null; erstellt_von: string | null }
  const { data: blRaw } = tenantId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase.rpc as any)('s112_privat_bloecke', { p_tenant_id: tenantId })
    : { data: [] }
  const privatBloecke = (blRaw ?? []) as PrivatBlock[]
  const aktivRaw = ((aktivRawAll ?? []) as AR[]).filter(
    (a: AR) => !a.ist_privat || a.erstellt_von === currentUserId
  )

  // Namen nur für die in Aktivitäten verwiesenen Kontakte/Firmen (17.9.2026 -
  // vorher alle 8.300 Kontakte + 4.600 Firmen; die Auswahlfelder im Termin-
  // Dialog suchen jetzt serverseitig über /api/crm/suche).
  const kontaktIds = [...new Set(aktivRaw.map((a: AR) => a.kontakt_id).filter(Boolean))] as string[]
  const firmaIds   = [...new Set(aktivRaw.map((a: AR) => a.firma_id).filter(Boolean))] as string[]
  // Blöcke zu 100 IDs (inBloecken, 05.10.2026) – vorher 300, knapp unter der gemessenen URL-Grenze (≈ 350 UUIDs)
  const namenLaden = async (tabelle: string, spalten: string, ids: string[]) =>
    (await inBloecken<AR>(ids, b => tf((supabase.from(tabelle) as any).select(spalten).in('id', b)))).data
  const [kontakteRaw, firmenRaw] = await Promise.all([
    namenLaden('kontakte', 'id, vorname, nachname', kontaktIds),
    namenLaden('firmen', 'id, name', firmaIds),
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
    // alle-ausnahme: Benutzer des Betriebs (Ersteller der Aktivitäten), wenige
    const profilesRaw = geladen(await (supabase.from('profiles') as any)
      .select('id, full_name, display_name')
      .in('id', uniqueUserIds), 'Benutzer')
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

    // KAN-17: private Termine anderer Mitglieder nur als Block „Privat“ (Zeit, Ersteller) – ohne Inhalt, nicht anklickbar
    ...privatBloecke.filter(b => !b.erledigt).map((b): KalenderEintrag => ({
      id: `p_${b.id}`,
      datum: b.datum,
      titel: 'Privat',   // Name des Erstellers unten, sobald die Mitglieder geladen sind
      typ: 'privat',
      ganztags: b.ganztags ?? true,
      uhrzeit_von: b.uhrzeit_von,
      uhrzeit_bis: b.uhrzeit_bis,
      bis_datum: b.bis_datum,
      erledigt: false,
      ueberfaellig: false,
      href: '',
      ist_privat: true,
      erstellt_von: b.erstellt_von,
    })),
  ].sort((a, b) => a.datum.localeCompare(b.datum))

  // Mitglieder des Betriebs für die Verantwortlich-Auswahl (Aufgabenzuordnung, 22.9.2026)
  const [mitglieder, outlook] = await Promise.all([
    tenantId ? ladeMandantMitglieder(tenantId) : Promise.resolve([]),
    // Outlook-Status für den Termin-Dialog (Einladung an Kollegen, Frei/Belegt – Migration 225)
    tenantId && currentUserId ? ladeOutlookStatus(tenantId, currentUserId) : Promise.resolve(null),
  ])
  mitglieder.forEach(m => { if (!userProfiles[m.id]) userProfiles[m.id] = m.name })
  for (const e of eintraege) if (e.typ === 'privat' && e.erstellt_von && userProfiles[e.erstellt_von]) e.titel = `Privat · ${userProfiles[e.erstellt_von]}`

  return <CRMUebersichtClient eintraege={eintraege} heute={heute} userProfiles={userProfiles}
    mitglieder={mitglieder.map(m => ({ id: m.id, name: m.name }))} userId={currentUserId} oeffneId={oeffneId ?? null} outlook={outlook} />
}
