import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Barrierefreiheit',
  description: 'Informationen zur Barrierefreiheit von software:112: Stand, bekannte Einschränkungen und Kontakt.',
}

// Barrierefreiheitsinformation (B9, 23.9.2026) – öffentlich erreichbar (siehe PUBLIC_ROUTES in src/proxy.ts)
export default function BarrierefreiheitSeite() {
  return (
    <main id="inhalt" className="min-h-screen bg-s112-bg px-4 py-10">
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-s112-line p-6 sm:p-8 space-y-5 text-sm text-s112-text leading-relaxed">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/software112-logo.svg" alt="software:112" className="h-9 w-auto mb-4" />
          <h1 className="text-2xl font-semibold">Barrierefreiheit</h1>
          <p className="text-s112-text-2 mt-1">Stand: 23. September 2026</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Unser Ziel</h2>
          <p>
            software:112 soll für alle Menschen in Weinbaubetrieben gut bedienbar sein – auch mit Tastatur, Vorleseprogramm,
            starker Vergrößerung oder eingeschränktem Farbsehen. Maßstab sind die Web Content Accessibility Guidelines
            (WCAG) 2.1 auf Stufe AA, die auch der europäischen Norm EN 301 549 zugrunde liegen.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Was bereits umgesetzt ist</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Ausreichende Farbkontraste für Text und Schaltflächen, auch bei betriebseigenen Farben (werden bei Bedarf automatisch abgedunkelt).</li>
            <li>Vollständige Bedienung mit der Tastatur, sichtbarer Fokusrahmen und ein Sprunglink „Zum Inhalt springen“.</li>
            <li>Dialoge halten den Fokus, schließen mit Escape und springen danach zum Ausgangspunkt zurück.</li>
            <li>Beschriftete Eingabefelder, Schalter und Symbol-Schaltflächen für Vorleseprogramme.</li>
            <li>Rücksicht auf die Systemeinstellung „Bewegung reduzieren“; Mindestschriftgrößen auch in kompakten Ansichten.</li>
            <li>Eine automatische Prüfung bei jeder neuen Version verhindert unbeschriftete Felder, Schaltflächen und Bilder.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Bekannte Einschränkungen</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Erzeugte PDF-Dokumente und Druckformulare sind noch nicht für Vorleseprogramme ausgezeichnet (keine „Tagged PDFs“). Die Inhalte sind in der Anwendung selbst zugänglich.</li>
            <li>Verschieben per Ziehen (z. B. im Kalender oder Kanban) funktioniert nur mit der Maus; mit der Tastatur geht das über den Bearbeiten-Dialog des Eintrags.</li>
            <li>Einige Beschriftungen mit berechnetem Text sind noch nicht automatisch geprüft und werden schrittweise überarbeitet.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Rückmeldung und Kontakt</h2>
          <p>
            Ist Ihnen eine Barriere aufgefallen oder brauchen Sie Inhalte in einer anderen Form? Schreiben Sie uns an{' '}
            <a href="mailto:security@icp-consultants.at?subject=Barrierefreiheit%20software%3A112" className="text-s112-blue-700 underline">security@icp-consultants.at</a>{' '}
            (Betreff „Barrierefreiheit“). Wir melden uns so rasch wie möglich.
          </p>
          <p className="text-s112-text-2">
            software:112 ist ein Produkt von hohenstein consulting solutions · technischer Betrieb: IC&amp;P Consultants e.U.
          </p>
        </section>

        <p><a href="/login" className="text-s112-blue-700 underline">Zur Anmeldung</a></p>
      </div>
    </main>
  )
}
