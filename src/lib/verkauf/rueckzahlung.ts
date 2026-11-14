// ── Rückzahlung am Guthaben einer Rechnung (KAN-453 G3c, 14.11.2026) ───────────────────────────────────────────────
//
// Seit KAN-419 kann eine Rechnung ein Guthaben haben (Zahlungen + Gutschriften über dem Rechnungsbetrag). Eine
// Rückzahlung zahlt es aus: eine negative Zahlung in `zahlungen`, anlegbar nur über die RPC s112_rueckzahlung_erfassen –
// höchstens das Guthaben, auch in Teilen; Datum nicht vor der Rechnung, nicht in der Zukunft, nicht im abgeschlossenen
// Zeitraum. Alle Summen über Zahlungen rechnen damit von selbst (bezahlt, offene Posten, Kontosaldo, Kassabuch); die
// E&A-Einnahme der Rückzahlung ist negativ (verkaufEinnahmenPlan). Dieselben Regeln wie die RPC – dort wird endgültig
// geprüft. Isomorph und ohne @/-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund, rundText } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { stornoDatumFehler } from '../storno/datum.ts'

/** Zahlungsarten einer Rückzahlung (ohne „Gutschrift“ – die ist der Beleg, nicht der Geldfluss) */
export const RUECKZAHLUNG_ARTEN = ['bank', 'bar', 'karte', 'sonstig'] as const

/** Ist die Zahlung eine Rückzahlung (negativer Betrag)? */
export function istRueckzahlung(z: { betrag?: unknown }): boolean {
  return Number(z.betrag) < 0
}

const eur = (x: number) => `${rundText(x, 2).replace('.', ',')} €`

/** Eingabeprüfung wie die Datenbank; `feld` sagt, wo die Meldung hingehört. null = in Ordnung */
export function rueckzahlungEingabeFehler(
  e: { betrag: number; datum: unknown },
  r: { guthaben: number; rechnungDatum: string | null; heute: string },
): { feld: 'betrag' | 'datum'; text: string } | null {
  const datumFehler = stornoDatumFehler(e.datum, { ab: r.rechnungDatum, heute: r.heute })
  if (datumFehler) return { feld: 'datum', text: datumFehler.replace(/Storno-Datum/g, 'Datum der Rückzahlung').replace('Belegdatum', 'Rechnungsdatum') }
  if (!Number.isFinite(e.betrag) || rund(e.betrag, 2) <= 0) return { feld: 'betrag', text: 'Bitte den Betrag der Rückzahlung angeben (größer als 0).' }
  if (rund(e.betrag, 2) > rund(r.guthaben, 2)) {
    return { feld: 'betrag', text: `Die Rückzahlung (${eur(e.betrag)}) übersteigt das Guthaben der Rechnung (${eur(r.guthaben)}).` }
  }
  return null
}
