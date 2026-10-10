// behoerdenmeldung: transportbescheinigung
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import StornoKarte from '@/components/StornoKarte'
import { stornoTB, loescheTB } from './actions'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import type { Metadata } from 'next'
import TBFormular from './TBFormular'
import { ladeTransportbescheinigung } from '@/lib/behoerden/transportbescheinigung'
import { csvPfad } from '@/lib/behoerden/katalog'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Transportbescheinigung – software:112' }

// Formular (gespeichert oder Vorbelegung) kommt aus derselben Ladefunktion wie die CSV
// (/meldungen/transportbescheinigung/csv) – siehe lib/behoerden/transportbescheinigung.ts.
export default async function TransportbescheinigungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()

  const tb = await ladeTransportbescheinigung(supabase, tenantId, { id })
  if (!tb) notFound()
  const { posten } = tb

  // KAN-150 F2: stornierte Fassungen (gekennzeichnet, endgültig löschbar) – die gültige lädt die Ladefunktion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stornRaw = geladen(await (supabase.from('transportbescheinigungen') as any)
    // storno-sichtbar: nur die stornierten Fassungen für den Vermerk und „Endgültig löschen“
    .select('id, storniert_am, storniert_von_name, storno_grund')
    .eq('tenant_id', tenantId).eq('verkaufsposten_id', id).not('storniert_am', 'is', null)
    .order('storniert_am', { ascending: false }), 'Transportbescheinigungen')
  const stornierte = (stornRaw ?? []) as { id: string; storniert_am: string; storniert_von_name: string | null; storno_grund: string | null }[]
  const schreiben = !!membership && canWrite(membership, 'warenwirtschaft')

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-s112-muted no-print">
        <Link href="/weinhandel/verkauf" className="hover:text-s112-blue-700 transition-colors">Verkauf</Link>
        <span>/</span>
        <Link href={`/weinhandel/verkauf/${id}`} className="hover:text-s112-blue-700 transition-colors">
          {posten.rechnungsnummer ?? (posten.datum ? new Date(posten.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' }) : 'Verkauf')}
        </Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Transportbescheinigung</span>
      </div>

      {/* Hinweise zur Vorbelegung (z. B. Prüfnummer gilt nach Verschnitt nicht mehr, KAN-72) –
          dieselben Texte wie X-Warnungen der CSV; nur solange das Formular nicht gespeichert ist */}
      {tb.vorbelegungHinweise.length > 0 && (
        <div className="no-print rounded-lg border border-s112-warn/30 bg-s112-warn-bg px-4 py-3 text-sm text-s112-warn-fg space-y-1">
          <p className="font-semibold">Vorbelegung bitte prüfen</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {tb.vorbelegungHinweise.map((h, i) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}

      {/* key: nach einem Storno neu aufbauen (Vorbelegung statt der stornierten Fassung) */}
      <TBFormular
        key={`${tb.gespeichertId ?? 'vorbelegung'}-${tb.status}`}
        verkaufspostenId={id}
        initial={tb.formular}
        csvHref={csvPfad('transportbescheinigung', { id, beleg: posten.rechnungsnummer })}
        ausgestellt={tb.status === 'ausgestellt'}
        ausgestelltAm={tb.ausgestelltAm}
        ausgestelltVon={tb.ausgestelltVon}
      />

      {schreiben && tb.gespeichertId && (
        <StornoKarte was="die Transportbescheinigung" stand={{ storniert_am: null }}
          stornieren={stornoTB.bind(null, id, tb.gespeichertId)}
          hinweis="Die gespeicherte Bescheinigung bleibt als storniert im Änderungsprotokoll; danach zeigt das Formular wieder die Vorbelegung." />
      )}
      {schreiben && stornierte.map(s => (
        <StornoKarte key={s.id} was="die Transportbescheinigung" stand={s} loeschen={loescheTB.bind(null, id, s.id)}
          hinweis="" />
      ))}
    </div>
  )
}
