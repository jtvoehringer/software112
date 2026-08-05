import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import OffenePostenClient from './OffenePostenClient'

export const metadata: Metadata = { title: 'Offene Posten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function OffenePostenPage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const { data: raw } = await (supabase.from('verkaufsposten') as any)
    .select(`
      id, datum, rechnungsnummer, storniert, bezahlt, bezahlt_am, erstellt_am,
      kontakt:kontakte!kontakt_id(id, vorname, nachname),
      firma:firmen(id, name),
      positionen:verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)
    `)
    .eq('storniert', false)
    .eq('aktiv',     true)
    .order('datum', { ascending: false })

  const offeneIds = ((raw ?? []) as R[]).filter(p => !p.bezahlt).map(p => p.id as string)
  const bereitsBezahltMap = new Map<string, number>()
  if (offeneIds.length > 0) {
    const { data: zahlungenRaw } = await (supabase.from('zahlungen') as any)
      .select('verkaufsposten_id, betrag')
      .in('verkaufsposten_id', offeneIds)
    for (const z of (zahlungenRaw ?? []) as R[]) {
      const key = z.verkaufsposten_id as string
      bereitsBezahltMap.set(key, (bereitsBezahltMap.get(key) ?? 0) + Number(z.betrag ?? 0))
    }
  }

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
    return {
      id:              p.id as string,
      datum:           p.datum as string,
      rechnungsnummer: (p.rechnungsnummer ?? null) as string | null,
      bezahlt:         (p.bezahlt ?? false) as boolean,
      bezahlt_am:      (p.bezahlt_am ?? null) as string | null,
      gesamt,
      bereitsBezahlt:  bereitsBezahltMap.get(p.id as string) ?? 0,
      kundenName,
      kontaktId:       (p.kontakt as R | null)?.id ?? null,
      firmaId:         (p.firma   as R | null)?.id ?? null,
    }
  })

  const offene     = posten.filter(p => !p.bezahlt)
  const bezahlte   = posten.filter(p => p.bezahlt)
  const summeOffen = offene.reduce((s, p) => s + p.gesamt, 0)

  return (
    <OffenePostenClient
      offene={offene}
      bezahlte={bezahlte}
      summeOffen={summeOffen}
      writeOk={writeOk}
    />
  )
}
