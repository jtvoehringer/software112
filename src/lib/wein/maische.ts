// ── Maische als eigene Stufe zwischen Ernte und Charge (KAN-480, BKI-Sitzung 16.11.2026) ───────────────────────────
//
// n Ernten können gemeinsam gemaischt und erst nach n Tagen in n Chargen verpresst werden (Rotwein). Eine Maische ist
// eine Pressung in zwei Schritten:
//   1. „Maische ansetzen“: Kopf und Traubenzeilen wie bei jeder Pressung (die Ernten sind damit gebunden), dazu Beginn,
//      Gebinde und eine Nummer je Jahrgang („M 2027/1“) – aber noch keine Mostzeilen. Das Gebinde gilt als belegt.
//   2. „Abpressen“: Pressdatum, Mostausbeute und Mostzeilen in n Gebinde = n Chargen; die Maische ist abgeschlossen.
// Die Direktpressung (Weißwein) bleibt unverändert. Dieselben Regeln prüft die Datenbank (Migration kan480_maische).
// Isomorph und ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (lädt ohne Bundler)
import { pressungZeilenFehler } from './lesePflicht.ts'

/** „M 2027/1“: Jahrgang/laufende Nummer der Maische */
export function maischeNummer(jahrgang: number | string | null | undefined, nr: number | null | undefined): string | null {
  if (jahrgang == null || nr == null) return null
  return `M ${jahrgang}/${nr}`
}

export const MAISCHE_GEBINDE_FEHLT = 'Bitte das Gebinde wählen, in dem die Maische liegt.'
export const MAISCHE_OHNE_MOST = 'Eine Maische hat noch keinen Most: Behälterzeilen und Mostausbeute kommen beim Abpressen. Bitte „Maische ansetzen“ abwählen oder die Behälterzeilen entfernen.'

/**
 * Zeilen einer Pressung bzw. Maische: Die Maische braucht Traubenzeilen, aber weder Behälterzeilen noch Mostausbeute;
 * die Pressung (auch das Abpressen) braucht beides wie bisher.
 */
export function maischeZeilenFehler(maische: boolean, trauben: number, behaelter: number, mostLiter: number | null | undefined): string | null {
  if (!maische) return pressungZeilenFehler(trauben, behaelter)
  if (trauben < 1) return 'Bitte mindestens eine Traubenzeile angeben (Ried/GST aus der Lese oder Trauben-Zukauf).'
  if (behaelter > 0 || (mostLiter != null && !Number.isNaN(mostLiter) && mostLiter > 0)) return MAISCHE_OHNE_MOST
  return null
}

/**
 * Übergänge beim Bearbeiten: Eine offene Maische bleibt offen (Datum = Beginn) oder wird abgepresst (Pressdatum nicht
 * vor dem Beginn). Eine Pressung – auch eine abgepresste Maische – wird nie (wieder) zur offenen Maische.
 */
export function maischeUebergangFehler(p: { modus: boolean; offen: boolean; beginn: string | null; datum: string }): string | null {
  if (p.modus && !p.offen) return 'Eine bestehende Pressung kann nicht nachträglich zur Maische werden. Bitte die Pressung stornieren und die Maische neu ansetzen.'
  if (!p.offen || !p.beginn) return null
  const beginn = p.beginn.slice(0, 10)
  const tt = beginn.split('-').reverse().join('.')
  if (p.modus && p.datum !== beginn) return `Der Beginn der Maische (${tt}) steht fest. Ist er falsch, bitte die Maische stornieren und neu ansetzen.`
  if (!p.modus && p.datum < beginn) return `Das Pressdatum darf nicht vor dem Beginn der Maische (${tt}) liegen.`
  return null
}

export type MaischeZeile = {
  maische_nr?: number | null
  maische_beginn?: string | null
  maische_offen?: boolean | null
  storniert_am?: string | null
  datum?: string | null
}

/** Ist die Pressung eine noch offene (nicht stornierte) Maische? */
export function maischeOffen(p: MaischeZeile | null | undefined): boolean {
  return !!p && p.maische_offen === true && !p.storniert_am
}

/**
 * Lag die Maische am Stichtag (Ende des Tages) noch unverpresst im Gebinde? – für den Hinweis in der Bestandsmeldung:
 * angesetzt bis zum Stichtag und entweder noch offen oder erst danach abgepresst. Stornierte zählen nicht.
 */
export function maischeOffenAm(p: MaischeZeile, stichtag: string): boolean {
  if (!p.maische_beginn || p.storniert_am) return false
  if (p.maische_beginn.slice(0, 10) > stichtag) return false
  if (p.maische_offen === true) return true
  return !!p.datum && p.datum.slice(0, 10) > stichtag
}

/** Hinweis der Bestandsmeldung: Maische zählt nicht als Bestand */
export function maischeBestandHinweis(anzahl: number, stichtagText: string): string | null {
  if (anzahl <= 0) return null
  return `Am ${stichtagText} ${anzahl === 1 ? 'lag 1 Maische' : `lagen ${anzahl} Maischen`} noch unverpresst im Keller – Maische zählt nicht als Weinbestand. `
    + 'Bitte prüfen, ob sie vor dem Stichtag abzupressen und als Charge zu führen ist.'
}
