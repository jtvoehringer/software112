// behoerdenmeldung: pruefnummernantrag
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import StornoKarte from '@/components/StornoKarte'
import { stornoPNA, loeschePNA } from './actions'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import type { Metadata } from 'next'
import PNAFormular from './PNAFormular'
import { ladePruefnummernantrag } from '@/lib/behoerden/pruefnummernantrag'
import { csvPfad } from '@/lib/behoerden/katalog'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Prüfnummernantrag – software:112' }

// Formular (gespeichert oder Vorbelegung) kommt aus derselben Ladefunktion wie die CSV
// (/meldungen/pruefnummernantrag/csv) – siehe lib/behoerden/pruefnummernantrag.ts.
export default async function PruefnummernantragPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()

  const pna = await ladePruefnummernantrag(supabase, tenantId, { id })
  if (!pna) notFound()

  // KAN-150 F2: stornierte Fassungen (gekennzeichnet, endgültig löschbar) – die gültige lädt die Ladefunktion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stornRaw = geladen(await (supabase.from('pruefnummernantraege') as any)
    // storno-sichtbar: nur die stornierten Fassungen für den Vermerk und „Endgültig löschen“
    .select('id, storniert_am, storniert_von_name, storno_grund')
    .eq('tenant_id', tenantId).eq('dac_antrag_id', id).not('storniert_am', 'is', null)
    .order('storniert_am', { ascending: false }), 'Prüfnummernanträge')
  const stornierte = (stornRaw ?? []) as { id: string; storniert_am: string; storniert_von_name: string | null; storno_grund: string | null }[]
  const schreiben = !!membership && canWrite(membership, 'kellerbuch')
  // KAN-97: ab „Eingereicht“ sperrt die Datenbank das Formular (a_freeze) – Storno erst mit dem DAC-Antrag selbst
  const gesperrt = !pna.dac.storniert && pna.dac.status && pna.dac.status !== 'entwurf'
    ? { grund: 'Prüfnummernantrag eingereicht', seit: pna.dac.eingereichtAm } : null
  const sperrDatum = gesperrt?.seit ? new Date(gesperrt.seit).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' }) : null

  return (
    <div className="max-w-4xl space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted no-print">
        <Link href="/dac" className="hover:text-s112-blue-700 transition-colors">DAC & Prüfnummern</Link>
        <span>/</span>
        <Link href={`/dac/${id}`} className="hover:text-s112-blue-700 transition-colors">{pna.dac.bezeichnung}</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Prüfnummernantrag</span>
      </div>

      {/* key: nach einem Storno neu aufbauen (Vorbelegung statt der stornierten Fassung) */}
      <PNAFormular
        key={pna.gespeichertId ?? 'vorbelegung'}
        dacAntragId={id}
        initial={pna.formular}
        csvHref={csvPfad('pruefnummernantrag', { id, bez: pna.dac.bezeichnung })}
        gesperrt={gesperrt ? { grund: gesperrt.grund, seit: sperrDatum } : null}
      />

      {schreiben && pna.gespeichertId && !gesperrt && (
        <StornoKarte was="der Prüfnummernantrag" stand={{ storniert_am: null }}
          stornieren={stornoPNA.bind(null, id, pna.gespeichertId)}
          hinweis="Der gespeicherte Antrag bleibt als storniert im Änderungsprotokoll; danach zeigt das Formular wieder die Vorbelegung." />
      )}
      {schreiben && stornierte.map(s => (
        <StornoKarte key={s.id} was="der Prüfnummernantrag" stand={s} loeschen={loeschePNA.bind(null, id, s.id)}
          hinweis="" />
      ))}
    </div>
  )
}
