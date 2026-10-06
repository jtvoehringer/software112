// Etikettierung (KAN-41 Paket 3d, 06.10.2026) – unetikettiert abgefüllte Flaschen und der Vorgang „Etikettieren“.
//
// BKI-Blatt „Lagerstand zum Zeitraum“: Flaschenbestand etikettiert / unetikettiert. Eine Füllung kann ganz oder teilweise
// unetikettiert abgefüllt werden (fuellungen.anzahl_unetikettiert); der datierte Vorgang „Etikettieren“
// (RPC s112_fuellung_etikettieren, Storno s112_etikettierung_stornieren) senkt bestand_unetikettiert. Unetikettierte
// Flaschen dürfen weder verkauft noch ausgebucht werden (Trigger a_etikett_bestand). BSM-neutral.
// Umsetzung nach bestem Wissen (Entscheidung Jörgen 06.10.2026). Gemeinsam für Formulare und Server Actions.

/** Anzahl unetikettiert beim Anlegen einer Füllung: 0 … Anzahl Flaschen, ganze Zahl; null = in Ordnung */
export function unetikettiertFehler(unetikettiert: number | null, anzahl: number): string | null {
  if (unetikettiert == null || unetikettiert === 0) return null
  if (!Number.isInteger(unetikettiert) || unetikettiert < 0) return 'Bitte die Anzahl unetikettierter Flaschen als ganze Zahl angeben.'
  if (unetikettiert > anzahl) return `Es können höchstens alle ${anzahl} Flaschen unetikettiert sein.`
  return null
}

/** Etikettieren: ganze Stückzahl über 0, höchstens der unetikettierte Bestand, Datum nicht in der Zukunft */
export function etikettierenFehler(p: { menge: number | null; bestandUnetikettiert: number; datum: string; heute: string; abfuelldatum?: string | null }): string | null {
  if (p.menge == null || !Number.isInteger(p.menge) || p.menge <= 0) return 'Bitte die Anzahl der etikettierten Flaschen angeben (ganze Zahl über 0).'
  if (p.menge > p.bestandUnetikettiert) return `Es sind nur noch ${p.bestandUnetikettiert} Flaschen ohne Etikett.`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.datum)) return 'Bitte ein gültiges Datum angeben.'
  if (p.datum > p.heute) return 'Das Datum der Etikettierung liegt in der Zukunft.'
  if (p.abfuelldatum && p.datum < p.abfuelldatum) return 'Etikettiert werden kann frühestens am Tag der Füllung.'
  return null
}

/** Verkaufbar sind nur etikettierte Flaschen */
export function etikettierterBestand(bestandFlaschen: number, bestandUnetikettiert: number | null | undefined): number {
  return Math.max(0, bestandFlaschen - (bestandUnetikettiert ?? 0))
}
