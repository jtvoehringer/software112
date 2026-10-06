// ── Übersicht „Behördenmeldungen (Drucken & CSV)“ (24.09.2026) ──────────────────
//
// Darstellung der Liste aus behoerdenUebersicht() (lib/behoerden/uebersicht.ts, server-only):
// je Gruppe die Meldungen, die die aktive Mitgliedschaft abrufen darf, mit Kurzbeschreibung,
// Rechtsgrundlage, Link auf die Druck- bzw. Auswahlseite und – wenn keine Auswahl nötig ist –
// direktem CSV-Export (Standardauswahl der Seite) über die zentrale Route /meldungen/<id>/csv.
// Ohne Hooks: nutzbar in Server-Komponenten (/dashboard/fristen) und im Client (Tab „Behörden“
// in /reports). Die Daten bekommt die Komponente als Props, sie importiert nur Typen aus der
// Server-Datei. gruppen = null: Übersicht konnte nicht geladen werden (Hinweis statt Fehlerseite).

import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import type { UebersichtGruppe } from '@/lib/behoerden/uebersicht'

export default function BehoerdenUebersicht({ gruppen }: { gruppen: UebersichtGruppe[] | null }) {
  if (gruppen === null) {
    return (
      <p role="alert" className="text-[13px] text-s112-err-fg py-2">
        Die Behördenmeldungen konnten nicht geladen werden – bitte die Seite neu laden. Der Fehler wurde protokolliert.
      </p>
    )
  }
  if (gruppen.length === 0) {
    return (
      <p className="text-[13px] text-s112-text-2 py-2">
        Für deine Rolle sind in diesem Betrieb keine Behördenmeldungen freigeschaltet.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-x-8 gap-y-5">
      {gruppen.map(g => (
        <section key={g.gruppe} aria-labelledby={`behoerden-${g.gruppe}`}>
          <h3 id={`behoerden-${g.gruppe}`} className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-s112-text-2 mb-1">
            {g.label}
          </h3>
          <ul className="divide-y divide-s112-line">
            {g.eintraege.map(e => (
              <li key={e.id} className="py-2">
                <p className="text-[13px] font-medium text-s112-text leading-snug">
                  {e.titel}
                  {e.pflicht && (
                    <span className="ml-1.5 align-middle inline-flex font-mono text-[10.5px] font-semibold tracking-[.03em] uppercase rounded-sm px-1.5 py-px bg-s112-blue-50 text-s112-blue-700">
                      Pflicht
                    </span>
                  )}
                </p>
                <p className="text-[11.5px] text-s112-text-2 leading-snug">{e.behoerde}</p>
                {e.beschreibung && (
                  <p className="text-[11.5px] text-s112-text-2 leading-snug mt-0.5 line-clamp-2" title={e.beschreibung}>{e.beschreibung}</p>
                )}
                {e.rechtsgrundlage && (
                  <details className="text-[11px] text-s112-text-2 mt-0.5">
                    <summary className="cursor-pointer select-none w-fit">Rechtsgrundlage<span className="sr-only">: {e.titel}</span></summary>
                    <p className="leading-snug mt-0.5">{e.rechtsgrundlage}</p>
                  </details>
                )}
                <div className="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1">
                  {e.seite && (
                    <Link href={e.seite.href} className="text-[12px] font-medium text-s112-blue-700 hover:underline py-1.5 whitespace-nowrap">
                      {e.seite.label}<span className="sr-only">: {e.titel}</span> <span aria-hidden="true">→</span>
                    </Link>
                  )}
                  {e.csv
                    ? <CsvExportKnopf href={e.csv} label="CSV exportieren" ariaLabel={`CSV exportieren: ${e.titel}`} hinweis={e.csvHinweis ?? undefined} />
                    : <span className="text-[11.5px] text-s112-tertiary py-1.5">CSV auf der Seite nach Auswahl</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
