import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import OffenePostenClient from './OffenePostenClient'
import { ladeOffenePostenListe, offenePostenSumme } from '@/lib/verkauf/umsatz'
import { heuteWien } from '@/lib/datum/wien'

export const metadata: Metadata = { title: 'Offene Posten' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Rückmeldung 29.8.2026: "die überfälligen bitte rot markieren". KAN-374 (Entscheidung Jörgen 22.10.2026): überfällig ab
// der FÄLLIGKEIT – Rechnungsdatum + Zahlungsziel des Kunden (Kontakt bzw. Firma, sonst 14 Tage, wie die Rechnung) –
// statt pauschal 30 Tage nach dem Rechnungsdatum. Liste, Beträge und Fälligkeit kommen aus ladeOffenePostenListe
// (lib/verkauf/umsatz) – dieselbe Rechnung wie Dashboard, Finanzübersicht und Morgenbericht.

export default async function OffenePostenPage() {
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'warenwirtschaft')
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // KAN-105: offene Posten sind Rechnungen (rechnungen) mit den Positionen aller ihrer Lieferscheine; nicht berechnete
  // Lieferscheine sind keine offenen Posten. Zahlungen zählen je Rechnung (zahlungen.rechnung_id), Teilzahlungen mindern.
  const liste = geladen(tenantId
    ? await ladeOffenePostenListe(supabase, tenantId, heuteWien(), { mitBezahlten: true })
    : { data: [], error: null }, 'Rechnungen')

  // neueste zuerst (wie bisher)
  const posten = [...(liste ?? [])].sort((a, b) => b.datum.localeCompare(a.datum) || b.id.localeCompare(a.id)).map(p => ({
    // Link und Zahlung über den (ersten) Lieferschein – die Zahlung hängt der Trigger an dessen Rechnung (KAN-105)
    id:              p.verkaufspostenIds[0],
    rechnungId:      p.id,
    // KAN-104: Sammelrechnung (mehrere Lieferscheine) → Rechnungsseite statt Lieferschein
    href:            p.verkaufspostenIds.length > 1 ? `/weinhandel/rechnungen/${p.id}` : undefined,
    datum:           p.datum,
    rechnungsnummer: p.rechnungsnummer,
    bezahlt:         p.bezahlt,
    bezahlt_am:      p.bezahltAm,
    gesamt:          p.brutto,
    bereitsBezahlt:  p.gezahlt,   // je Rechnung
    kundenName:      p.kunde,
    kontaktId:       p.kontaktId,
    firmaId:         p.firmaId,
    faelligAm:       p.faelligAm,
    ueberfaellig:    !p.bezahlt && p.ueberfaellig,
    tageUeberfaellig: p.bezahlt ? 0 : p.verzugTage,
  }))

  const offene     = posten.filter(p => !p.bezahlt)
  const bezahlte   = posten.filter(p => p.bezahlt)
  // KAN-346: offener Betrag nach Teilzahlungen (vorher Summe der Rechnungsbeträge)
  const summeOffen = offenePostenSumme(liste ?? []).summe

  const kontenRaw = geladen(await tf((supabase.from('konten') as any)
    .select('id, name').eq('aktiv', true).order('sortierung').order('name')), 'Konten')
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
