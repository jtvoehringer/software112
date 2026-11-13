// behoerdenmeldung: exportauftrag
import { redirect } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import StornoKarte from '@/components/StornoKarte'
import { stornoExportauftrag, loescheExportauftrag } from './actions'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import WeinexportDetailClient from './WeinexportDetailClient'
import { ladeExportauftrag } from '@/lib/behoerden/exportauftrag'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeExportFaktura } from '@/lib/export/fakturaLaden'
import { steuerfallLabel } from '@/lib/export/fakturierung'
import ExportRechnungPanel, { type ExportRechnungStand } from './ExportRechnungPanel'
export const metadata: Metadata = { title: 'Exportauftrag' }
export const dynamic = 'force-dynamic'

export default async function WeinexportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient()

  // Exportaufträge ist ein optionales Modul (Migration 152) - pro Mandant unter
  // Admin > Mandant > Module ein-/ausschaltbar.
  // Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen
  // Mitgliedschaft – sonst können bei Mehrfach-Mitgliedschaft Daten eines anderen
  // Betriebs angezeigt werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_export').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_export || !tenantId) redirect('/dashboard')

  const { id } = await params
  // Dieselbe Ladefunktion wie die CSV (/meldungen/exportauftrag/csv): Auftrag, Dokumente und
  // Positionszeilen mit gerundetem Wert je Position (Summe = Summe der gerundeten Werte)
  const ergebnis = await ladeExportauftrag(supabase, tenantId, { id })

  if (!ergebnis) return (
    <div className="p-8">
      <p className="text-s112-err-fg">Exportauftrag nicht gefunden.</p>
      <Link href="/weinexport" className="text-s112-blue-700 text-sm mt-2 inline-block">← Zurück</Link>
    </div>
  )

  const a = ergebnis.auftrag
  // KAN-436 E1: Stand von Rechnung bzw. Muster – dieselben Regeln wie Server Action und createVerkauf
  const fk = await ladeExportFaktura(supabase, tenantId, id)
  const vk = a.verkaufsposten_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? geladen(await (supabase.from('verkaufsposten') as any)
      .select('id, rechnungsnummer, datum, bezahlt, steuerfall').eq('id', a.verkaufsposten_id).eq('tenant_id', tenantId).maybeSingle(), 'Rechnung zum Exportauftrag')
    : null
  const rechnungStand: ExportRechnungStand = {
    rechnung: vk ? { verkaufId: String(vk.id), nummer: vk.rechnungsnummer ?? null, datum: vk.datum ?? null, bezahlt: vk.bezahlt === true } : null,
    // „es gibt schon eine Rechnung“ zeigt das Panel selbst – hier nur die Gründe, die einer neuen Rechnung entgegenstehen
    rechnungFehler: a.verkaufsposten_id ? [] : (fk?.faktura.fehler ?? []),
    betrag: fk?.faktura.betrag ?? 0,
    steuerfall: steuerfallLabel(vk?.steuerfall ?? fk?.faktura.steuerfall ?? null),
    mustersendung: a.mustersendung === true,
    musterAusgebuchtAm: a.muster_ausgebucht_am ?? null,
    musterFehler: fk?.muster.fehler ?? [],
    musterFlaschen: fk?.muster.flaschen ?? 0,
  }
  // KAN-150 F2 (Frage 8): Entwurf ohne ausgestelltes Dokument und ohne ARC direkt löschbar (nur Betriebsleitung)
  const entwurfLoeschbar = a.status === 'entwurf' && !a.emcs_arc_nummer && canAdmin(membership?.role ?? null)
    && !ergebnis.dokumente.some(d => d.status === 'ausgestellt')
  return (
    <>
      <WeinexportDetailClient
        auftrag={a}
        zeilen={ergebnis.zeilen}
        gesamtEur={ergebnis.gesamtEur}
        gewicht={ergebnis.gewicht}
        grunddaten={ergebnis.grunddaten}
        darfSchreiben={!!membership && canWrite(membership, 'warenwirtschaft') && !a.storniert_am}
        betriebsleitung={canAdmin(membership?.role ?? null)}
        dokumente={ergebnis.dokumente}
        csvHref={csvPfad('exportauftrag', { id, referenz: a.referenz })}
      />
      {!a.storniert_am && (
        <div className="px-8 max-w-5xl mx-auto">
          <ExportRechnungPanel id={id} referenz={String(a.referenz ?? '')} stand={rechnungStand}
            darfSchreiben={!!membership && canWrite(membership, 'warenwirtschaft')} />
        </div>
      )}
      {membership && canWrite(membership, 'warenwirtschaft') && (
        <div className="max-w-5xl mt-6">
          <StornoKarte was="der Exportauftrag" stand={a as { storniert_am: string | null }}
            stornieren={a.storniert_am ? undefined : stornoExportauftrag.bind(null, id)}
            loeschen={loescheExportauftrag.bind(null, id)}
            entwurfLoeschbar={entwurfLoeschbar}
            nachLoeschen="/weinexport"
            hinweis={a.verkaufsposten_id
              ? 'Zu diesem Exportauftrag gibt es eine Rechnung – bitte zuerst die Rechnung stornieren (Bestand kommt zurück), danach lässt sich der Auftrag stornieren.'
              : a.muster_ausgebucht_am
                ? 'Das Muster ist ausgebucht – bitte zuerst zurückbuchen, danach lässt sich der Auftrag stornieren.'
                : 'Der Auftrag bleibt als storniert in Liste und CSV stehen; Status, EMCS und Dokumente lassen sich danach nicht mehr ändern.'} />
        </div>
      )}
    </>
  )
}
