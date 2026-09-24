// Katalog der Behördenmeldungen – Gruppe „Flächen & Kataster“ (Rieden/Grundstücke, Flächenverzeichnis).
// Isomorph (auch in Client-Komponenten nutzbar). Je Eintrag: Schlüssel = id (URL /meldungen/<id>/csv).
// Zu jedem Eintrag gehört genau ein Eintrag in register/flaechen.ts (erzwingt der Typ MeldungenZu).

import { katalogGruppe } from '../typen'

export const KATALOG_FLAECHEN = katalogGruppe('flaechen', {
  // Grundlage (Ausfüllhilfe) für den Mehrfachantrag in eAMA und Meldungen an den
  // Weinbaukataster – eingereicht wird dort, nicht aus software:112. Deshalb keine
  // Pflichtmeldung im Sinne der Entscheidung 24.09.2026 und – wie die Rieden-Übersicht
  // selbst – für jedes Mitglied abrufbar (bisheriger Rieden-CSV-Export, jetzt serverseitig).
  flaechenverzeichnis: {
    titel: 'Flächenverzeichnis (Rieden & Grundstücke)',
    behoerde: 'AMA (Mehrfachantrag, eAMA) / Weinbaukataster',
    zugriff: 'mitglied',
    druckPfad: '/weingarten',
    beschreibung: 'Eine Zeile je Grundstück: Ried, AMA-Feldstück- und Schlagnummer, KG-Nr., GST-Nr., Rebsorte mit BKI-Kürzel, Nutzart, Bewirtschaftung, Rechtsverhältnis und Flächen lt. Kataster und AMA (ha).',
  },
})
