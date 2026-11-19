// ── Übersicht „Behördenmeldungen (Drucken & CSV)“ (24.09.2026) ──────────────────
//
// Darstellung der Liste aus behoerdenUebersicht() (lib/behoerden/uebersicht.ts, server-only):
// je Gruppe die Meldungen, die die aktive Mitgliedschaft abrufen darf, mit Kurzbeschreibung,
// Rechtsgrundlage, Link auf die Druck- bzw. Auswahlseite und – wenn keine Auswahl nötig ist –
// direktem CSV-Export (Standardauswahl der Seite) über die zentrale Route /meldungen/<id>/csv.
// Ohne Hooks: nutzbar in Server-Komponenten (/dashboard/fristen) und im Client (Tab „Behörden“
// in /reports). Die Daten bekommt die Komponente als Props, sie importiert nur Typen aus der
// Server-Datei. gruppen = null: Übersicht konnte nicht geladen werden (Hinweis statt Fehlerseite).
//
// KAN-471 Nebenbefund (19.11.2026): Jede Stelle ist eine Klappleiste (<details>, beim ersten Besuch alle zu) mit
// Anzahl der Dokumente und Pflichtmeldungen; darüber Sprungleiste, „Alle auf-/zuklappen“ und Merken je Browser
// (BehoerdenKlappen) – statt aller 56 Dokumente aufgeklappt im Raster.

import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import type { UebersichtGruppe } from '@/lib/behoerden/uebersicht'
import { stelleKurz, stelleZaehler } from '@/lib/behoerden/stellen'
import BehoerdenKlappen from './BehoerdenKlappen'

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
    <BehoerdenKlappen stellen={gruppen.map(g => ({ gruppe: g.gruppe, kurz: stelleKurz(g.gruppe) }))}>
    <div className="divide-y divide-s112-line border-y border-s112-line">
      {gruppen.map(g => (
        <details key={g.gruppe} data-stelle={g.gruppe} className="group scroll-mt-20">
          <summary className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-s112-bg rounded-sm">
            <span aria-hidden="true" className="inline-block w-3 text-s112-text-2 transition-transform group-open:rotate-90">▸</span>
            <h3 className="text-[13px] font-semibold text-s112-text">{g.label}</h3>
            <span className="text-[11.5px] text-s112-text-2">{stelleZaehler(g.eintraege)}</span>
          </summary>
          <ul className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-x-8 pl-6 pb-3">
            {g.eintraege.map(e => (
              <li key={e.id} className="py-2 border-t border-s112-line">
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
        </details>
      ))}
    </div>
    </BehoerdenKlappen>
  )
}
