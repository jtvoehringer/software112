import { createSupabaseServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ZukaufEditForm from './ZukaufEditForm'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function ZukaufEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data } = await (supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, art, menge, einheit, preis_gesamt, rebsorte, jahrgang, notizen,
      lieferant_kontakt_id, lieferant_firma_id, ziel_weinausbau_id,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(id, vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(id, name),
      ziel_weinausbau:weinausbau!ziel_weinausbau_id(behaelter_id)
    `)
    .eq('id', id)
    .eq('aktiv', true)
    .single()

  if (!data) notFound()
  const z = data as R

  return (
    <ZukaufEditForm
      id={z.id}
      initial={{
        datum:                 z.datum,
        art:                   z.art,
        lieferant_kontakt_id:  z.lieferant_kontakt_id ?? '',
        lieferant_firma_id:    z.lieferant_firma_id   ?? '',
        menge:                 String(z.menge ?? ''),
        einheit:               z.einheit ?? 'L',
        preis_gesamt:          z.preis_gesamt != null ? String(z.preis_gesamt) : '',
        rebsorte:              z.rebsorte   ?? '',
        jahrgang:              z.jahrgang   != null ? String(z.jahrgang) : '',
        ziel_behaelter_id:     (z.ziel_weinausbau as R | null)?.behaelter_id ?? '',
        notizen:               z.notizen    ?? '',
      }}
      lieferantName={
        z.lieferant_kontakt
          ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
          : z.lieferant_firma?.name ?? ''
      }
    />
  )
}
