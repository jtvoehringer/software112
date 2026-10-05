import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import OffenePostenClient from './OffenePostenClient'

export const metadata: Metadata = { title: 'Offene Posten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Rückmeldung 29.8.2026: "die überfälligen bitte rot markieren (in der
// Übersicht, werden die ja bereits erkannt)" - dieselbe Zahlungsziel-Annahme
// wie im Dashboard (dashboard/page.tsx, dort bereits als "X überfällig"-KPI
// und "Überfällige Rechnungen"-Widget sichtbar): kein eigenes Fälligkeitsdatum
// im Datenmodell vorhanden, daher gilt ein offener Posten ab 30 Tagen nach
// Belegdatum als überfällig. Hier bisher nur berechnet, aber nicht an die
// Tabelle durchgereicht/farblich markiert - wird jetzt nachgeholt.
const ZAHLUNGSZIEL_TAGE = 30

export default async function OffenePostenPage() {
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'warenwirtschaft')
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // alle(): sonst fehlen ab dem 1.001. Verkauf offene Posten in Liste und Summe
  const { data: raw } = await alle(tf((supabase.from('verkaufsposten') as any)
    .select(`
      id, datum, rechnungsnummer, storniert, bezahlt, bezahlt_am, erstellt_am,
      kontakt:kontakte!kontakt_id(id, vorname, nachname),
      firma:firmen(id, name),
      positionen:verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)
    `)
    .eq('storniert', false)
    .eq('aktiv',     true)
    .order('datum', { ascending: false })
    .order('id')))

  const offeneIds = ((raw ?? []) as R[]).filter(p => !p.bezahlt).map(p => p.id as string)
  const bereitsBezahltMap = new Map<string, number>()
  if (offeneIds.length > 0) {
    const { data: zahlungenRaw } = await alle(tf((supabase.from('zahlungen') as any)
      .select('verkaufsposten_id, betrag')
      .in('verkaufsposten_id', offeneIds)
      .is('storniert_am', null)   // KAN-149 D2b: stornierte Zahlungen zählen nicht
      .order('id')))
    for (const z of (zahlungenRaw ?? []) as R[]) {
      const key = z.verkaufsposten_id as string
      bereitsBezahltMap.set(key, (bereitsBezahltMap.get(key) ?? 0) + Number(z.betrag ?? 0))
    }
  }

  const heuteMs = Date.now()
  const posten = ((raw ?? []) as R[]).map((p: R) => {
    const gesamt = ((p.positionen ?? []) as R[]).reduce((s: number, pos: R) => {
      if (pos.preis_brutto == null) return s
      const brutto = Number(pos.preis_brutto) * Number(pos.menge)
      const rabatt = Number(pos.rabatt_pct ?? 0) / 100
      const sonder = Number(pos.sonderrabatt_pct ?? 0) / 100
      return s + brutto * (1 - rabatt) * (1 - sonder)
    }, 0)
    const kontakt = p.kontakt as R | null
    const firma   = p.firma   as R | null
    const kundenName = firma
      ? firma.name
      : kontakt
        ? [kontakt.vorname, kontakt.nachname].filter(Boolean).join(' ')
        : '–'
    const bezahlt = (p.bezahlt ?? false) as boolean
    const tage = Math.floor((heuteMs - new Date(p.datum).getTime()) / 86400000)
    const ueberfaellig = !bezahlt && Number.isFinite(tage) && tage > ZAHLUNGSZIEL_TAGE
    return {
      id:              p.id as string,
      datum:           p.datum as string,
      rechnungsnummer: (p.rechnungsnummer ?? null) as string | null,
      bezahlt,
      bezahlt_am:      (p.bezahlt_am ?? null) as string | null,
      gesamt,
      bereitsBezahlt:  bereitsBezahltMap.get(p.id as string) ?? 0,
      kundenName,
      kontaktId:       (p.kontakt as R | null)?.id ?? null,
      firmaId:         (p.firma   as R | null)?.id ?? null,
      ueberfaellig,
      tageUeberfaellig: ueberfaellig ? tage : 0,
    }
  })

  const offene     = posten.filter(p => !p.bezahlt)
  const bezahlte   = posten.filter(p => p.bezahlt)
  const summeOffen = offene.reduce((s, p) => s + p.gesamt, 0)

  const { data: kontenRaw } = await tf((supabase.from('konten') as any)
    .select('id, name').eq('aktiv', true).order('sortierung').order('name'))
  const konten = ((kontenRaw ?? []) as R[]).map(k => ({ id: k.id as string, name: k.name as string }))

  return (
    <OffenePostenClient
      offene={offene}
      bezahlte={bezahlte}
      summeOffen={summeOffen}
      writeOk={writeOk}
      konten={konten}
    />
  )
}
