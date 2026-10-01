// ── Einheitliche Hinweistexte zu Bestandskorrekturen (KAN-35, 24.09.2026) ───────
// Client-sicher (keine Server-Importe): genutzt von Server Actions, lib/kellerbuch/storno.ts
// und Formularen. Übergangsregel bis zum Journal (AP3): Bestände werden nur über datierte
// Buchungen korrigiert – nach unten mit „Schwund buchen“, nach oben gibt es (noch) keinen
// Buchungsweg. Solche Fälle laufen über den Support, damit jede Mehrmenge begründet ist.

/** Kein Buchungsweg nach oben – immer dieser Text statt „Inventur“/„richtigstellen“ */
export const KORREKTUR_NACH_OBEN_HINWEIS =
  'Eine Korrektur nach oben (Mehrmenge) ist im Kellerbuch derzeit nicht möglich – bitte den Support kontaktieren und dabei Charge, Menge und Grund angeben.'

/** Korrektur nach unten */
export const KORREKTUR_NACH_UNTEN_HINWEIS =
  'Eine Korrektur nach unten bitte über „Schwund buchen“ auf der Chargen-Seite erfassen.'

/** Falsch erfasste Schwundbuchung */
export const SCHWUND_STORNO_HINWEIS =
  'Eine falsch erfasste Schwundbuchung kann ein Betriebs-Manager oder ein Mitarbeiter mit Kellerbuch im Umzugsprotokoll (Kellerbuch › Gebinde › Umziehen) mit Grund stornieren, solange an der Charge seither nichts weiter gebucht wurde.'
