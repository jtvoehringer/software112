import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { exportBearbeitbar } from '@/lib/export/auftragEingabe'
import { KARTON_STANDARD, flaschenJeKarton } from '@/lib/export/grunddaten'
import WeinexportFormClient from '../../neu/WeinexportFormClient'

export const metadata: Metadata = { title: 'Exportauftrag bearbeiten' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-429 (12.11.2026): Exportauftrag bearbeiten – dasselbe Formular wie beim Anlegen, vorbelegt. Nur mit Schreibrecht
// Warenwirtschaft und Export-Modul, nur in Entwurf oder Bestätigt (ab Versendet sperrt auch die Datenbank).
export default async function ExportauftragBearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId || !canWrite(membership, 'warenwirtschaft')) redirect(`/weinexport/${id}`)
  const tenantId = membership.tenantId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_export, export_flaschen_je_karton, rechnung_zahlungsziel').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen') as R | null
  if (!einst?.modul_export) redirect('/dashboard')

  // storno-sichtbar: ein stornierter Auftrag wird geladen, um auf die Detailseite zurückzuleiten (nicht bearbeitbar)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auftrag = geladen(await (supabase.from('exportauftraege') as any)
    .select('id, referenz, status, storniert_am, kontakt_id, firma_id, datum, lieferdatum, incoterms, transport_art, destination_land, destination_stadt, eori_kunde, versicherungswert, verpackung_kg, notizen, versanddatum, zahlungsbedingungen, kunde_uid, mustersendung')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle(), 'Exportauftrag') as R | null
  if (!auftrag) redirect('/weinexport')
  if (!exportBearbeitbar(auftrag as { status: string | null; storniert_am: string | null })) redirect(`/weinexport/${id}`)

  const [posRes, kontakteRes, firmenRes, fuellungenRes] = await Promise.all([
    // Positionen hängen am mandantengefilterten Auftrag (keine eigene tenant_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('exportauftrag_positionen') as any)
      .select('id, fullung_id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order, flaschen_je_karton').eq('exportauftrag_id', id).order('sort_order').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('kontakte') as any).select('id,vorname,nachname,zahlungsziel_tage').eq('tenant_id', tenantId).eq('aktiv', true).order('nachname').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('firmen') as any).select('id,name,uid_nummer,zahlungsziel_tage').eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<R>((supabase.from('fuellungen') as any).select('id,name,bezeichnung,jahrgang,flaschengroesse_ml,bestand_flaschen,zolltarifnummer,aktiv')
      .eq('tenant_id', tenantId).is('storniert_am', null).order('name').order('id')),
  ])
  const positionen = (geladen(posRes, 'Positionen') ?? []) as R[]
  const kontakte = (geladen(kontakteRes, 'Kontakte') ?? []) as R[]
  const firmen = (geladen(firmenRes, 'Firmen') ?? []) as R[]
  // aktive Füllungen wie beim Anlegen – dazu die schon im Auftrag verwendeten, auch wenn sie inzwischen inaktiv sind
  const verwendet = new Set(positionen.map(p => p.fullung_id).filter(Boolean))
  const fuellungen = ((geladen(fuellungenRes, 'Füllungen') ?? []) as R[]).filter(f => f.aktiv || verwendet.has(f.id))

  return <WeinexportFormClient kontakte={kontakte} firmen={firmen} fuellungen={fuellungen} tenantId={tenantId}
    bearbeiten={{ id, referenz: (auftrag.referenz as string | null) ?? null, auftrag, positionen }}
    vorgaben={{ flaschenJeKarton: flaschenJeKarton(einst?.export_flaschen_je_karton) ?? KARTON_STANDARD, zahlungszielTage: (einst?.rechnung_zahlungsziel as number | null) ?? null }} />
}
