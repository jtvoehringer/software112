import 'server-only'
import { definiereMeldung, type MeldungenZu } from '../typen'
import { KATALOG_FLAECHEN } from '../katalog/flaechen'
import { ladeFlaechenverzeichnis, SPALTEN_FLAECHENVERZEICHNIS } from '../flaechenverzeichnis'

// Register der Behördenmeldungen – Gruppe „Flächen & Kataster“ (Rieden/Grundstücke, Flächenverzeichnis).
// Je Katalog-Eintrag aus katalog/flaechen.ts genau ein Eintrag mit CSV (laden + spalten).

export const MELDUNGEN_FLAECHEN = {
  // GET /meldungen/flaechenverzeichnis/csv – ohne Parameter (alle Rieden und Grundstücke,
  // auch inaktive mit „Aktiv: Nein“ wie bisher). Datei z. B.
  // Flächenverzeichnis_1234567_2026-09-24.csv (ASCII: Flaechenverzeichnis_…).
  flaechenverzeichnis: definiereMeldung(KATALOG_FLAECHEN.flaechenverzeichnis, {
    parameter: () => ({}),
    laden: ctx => ladeFlaechenverzeichnis(ctx.supabase, ctx.tenantId),
    spalten: SPALTEN_FLAECHENVERZEICHNIS,
    dateiteile: (_p, betrieb) => ['Flächenverzeichnis', betrieb.betriebsnummer],
  }),
} satisfies MeldungenZu<typeof KATALOG_FLAECHEN>
