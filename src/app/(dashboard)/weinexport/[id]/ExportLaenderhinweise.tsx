// KAN-437 Teil 1 (13.11.2026): „Was ist für dieses Land nötig?“ am Exportauftrag – Registrierungen, Dokumente,
// Etikett, Zoll je Zielland. Jede nicht geprüfte Aussage ist als solche gekennzeichnet (lib/export/laenderprofile).
// Reine Anzeige ohne Zustand (Server-Komponente); eingeklappt, damit der Auftrag übersichtlich bleibt.
import Link from '@/components/ui/Link'
import {
  ABSCHNITTE, ABSCHNITT_TITEL, DRITTLAND_GEMEINSAM, LAENDER_HAFTUNG, NICHT_GEPRUEFT, OHNE_ANGABEN, PROFIL_STAND_TEXT,
  laenderprofil, profilStand,
} from '@/lib/export/laenderprofile'

const STAND_FARBE: Record<string, string> = {
  geprueft: 'bg-s112-ok-bg text-s112-ok-fg', teilweise: 'bg-s112-warn-bg text-s112-warn-fg',
  ungeprueft: 'bg-s112-warn-bg text-s112-warn-fg', ohne: 'bg-[#F2F3F5] text-s112-text-1',
}

export default function ExportLaenderhinweise({ land, landName, registrierungen }: {
  land: string | null
  landName: string
  /** KAN-437 Teil 2: Hinweise zu den Registrierungen des Betriebs für dieses Land (fehlt, abgelaufen, läuft ab) */
  registrierungen: string[]
}) {
  const profil = laenderprofil(land)
  const stand = profil ? profilStand(profil) : null
  return (
    <>
    {/* immer sichtbar, nicht im eingeklappten Kasten: eine fehlende bzw. ablaufende Registrierung (blockiert nichts) */}
    {registrierungen.length > 0 && (
      <div role="status" className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 mt-6 text-sm text-s112-warn-fg" data-registrierung-hinweise>
        <p className="font-semibold">Registrierungen des Betriebs für {profil?.name ?? landName}:</p>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          {registrierungen.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
        <p className="mt-1"><Link href="/weinexport/registrierungen" className="underline">Registrierungen verwalten</Link></p>
      </div>
    )}
    <details className="bg-white rounded-xl border border-s112-border p-5 mt-6 group" data-laenderhinweise={profil?.land ?? 'allgemein'}>
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 flex-wrap">
        <span className="font-semibold text-s112-text">Was ist für {profil?.name ?? landName} nötig?</span>
        <span className="flex items-center gap-2">
          {stand && <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STAND_FARBE[stand]}`} data-profil-stand={stand}>{PROFIL_STAND_TEXT[stand]}</span>}
          <span className="text-sm text-s112-blue-700 group-open:hidden">Anzeigen</span>
          <span className="text-sm text-s112-blue-700 hidden group-open:inline">Ausblenden</span>
        </span>
      </summary>

      <div className="mt-4 space-y-4 text-sm">
        {profil && stand === 'ohne' && <p className="text-s112-text-2" data-ohne-angaben>{OHNE_ANGABEN}</p>}
        {!profil && <p className="text-s112-text-2">Für dieses Land ist kein Länderprofil hinterlegt – es gilt, was für jede Ausfuhr in ein Drittland nötig ist. Länderspezifische Anforderungen bitte mit dem Importeur klären.</p>}

        {profil && ABSCHNITTE.filter(a => profil.abschnitte[a].length > 0).map(a => (
          <section key={a}>
            <h3 className="font-medium text-s112-text-1 mb-1">{ABSCHNITT_TITEL[a]}</h3>
            <ul className="list-disc pl-5 space-y-1 text-s112-text-2">
              {profil.abschnitte[a].map((x, i) => (
                <li key={i}>
                  {x.text}
                  {!x.geprueft && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-s112-warn-bg text-s112-warn-fg whitespace-nowrap" data-nicht-geprueft>{NICHT_GEPRUEFT}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section>
          <h3 className="font-medium text-s112-text-1 mb-1">Für jede Ausfuhr in ein Drittland</h3>
          <ul className="list-disc pl-5 space-y-1 text-s112-text-2">
            {DRITTLAND_GEMEINSAM.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </section>

        <p className="text-xs text-s112-muted">
          {profil && stand !== 'ohne' && <>Quellen: {profil.quelle}. </>}
          {LAENDER_HAFTUNG}
        </p>
      </div>
    </details>
    </>
  )
}
