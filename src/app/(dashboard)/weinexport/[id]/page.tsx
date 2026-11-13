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
import ExportNachweisPanel from './ExportNachweisPanel'
import ExportLaenderhinweise from './ExportLaenderhinweise'
import { ladeExportRegistrierungen } from '@/lib/export/registrierungenLaden'
import { registrierungHinweise } from '@/lib/export/registrierungen'
import { landAnzeige } from '@/lib/katalog/laender'
import { ladeExportNachweise } from '@/lib/export/nachweisLaden'
import { nachweisFrist } from '@/lib/export/nachweise'
import { lieferfall } from '@/lib/export/grunddaten'
import { heuteWien } from '@/lib/datum/wien'
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
  // KAN-440 Teil 2: Nachweise und Stand der Frist (Fristbeginn = Rechnungsdatum, ersatzweise Versanddatum)
  const nachweise = await ladeExportNachweise(supabase, tenantId, id)
  const gebiet = lieferfall(a).gebiet
  const heute = heuteWien()
  const frist = nachweisFrist({
    status: a.status, storniert_am: a.storniert_am, mustersendung: a.mustersendung, verkaufsposten_id: a.verkaufsposten_id,
    abschluss_ohne_nachweis: a.abschluss_ohne_nachweis, versanddatum: a.versanddatum, nachweise: nachweise.length,
    rechnungsdatum: vk?.datum ?? null, gebiet,
  }, heute)
  const darfSchreiben = !!membership && canWrite(membership, 'warenwirtschaft')
  // KAN-437 Teil 2: fehlt eine für das Zielland verlangte Registrierung des Betriebs, ist sie abgelaufen oder läuft sie ab?
  const regHinweise = gebiet === 'drittland' && !a.storniert_am
    ? registrierungHinweise(a.destination_land, await ladeExportRegistrierungen(supabase, tenantId), heute)
    : []
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
        nachweise={nachweise.length}
        dokumente={ergebnis.dokumente}
        csvHref={csvPfad('exportauftrag', { id, referenz: a.referenz })}
      />
      {/* KAN-437 Teil 1: Was verlangt das Zielland? Nur für Drittländer (EU: die Hinweise oben und der Nachweis-Kasten) */}
      {gebiet === 'drittland' && !a.storniert_am && (
        <div className="px-8 max-w-5xl mx-auto">
          <ExportLaenderhinweise land={typeof a.destination_land === 'string' ? a.destination_land : null}
            landName={landAnzeige(a.destination_land) || 'dieses Land'} registrierungen={regHinweise} />
        </div>
      )}
      {/* KAN-440 Teil 2: Nachweis – im Inland ohne Bedeutung, bei stornierten Aufträgen nur, wenn schon etwas abgelegt ist */}
      {gebiet !== 'inland' && (!a.storniert_am || nachweise.length > 0) && (
        <div className="px-8 max-w-5xl mx-auto">
          <ExportNachweisPanel auftragId={id} gebiet={gebiet} nachweise={nachweise} frist={frist}
            mrn={a.ausfuhr_mrn ?? null} anmeldungDatum={a.ausfuhr_anmeldung_datum ?? null} mustersendung={a.mustersendung === true}
            darfAendern={darfSchreiben && !a.storniert_am && a.status !== 'abgeschlossen'}
            gesperrtGrund={a.storniert_am ? 'Der Exportauftrag ist storniert – Nachweise lassen sich nicht mehr ändern.'
              : a.status === 'abgeschlossen' ? 'Der Exportauftrag ist abgeschlossen – Nachweise und die Angaben zur Ausfuhranmeldung lassen sich nicht mehr ändern.' : null}
            heute={heute} />
        </div>
      )}
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
