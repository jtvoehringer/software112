// ── Behördenmeldungen: gemeinsame Typen und Helfer (24.09.2026) ─────────────────
//
// Isomorph: nur Typ-Importe (werden beim Übersetzen entfernt), damit katalog.ts samt
// Gruppen-Katalogen auch in Client-Komponenten nutzbar bleibt. lib/auth/roles ist
// server-only – von dort hier ausschließlich `import type`.
//
// Aufbau je Meldung (Beispiel siehe register/ernte.ts bzw. die PR-Beschreibung):
//   1. src/lib/behoerden/<meldung>.ts – Ladefunktion (von Druckseite UND CSV genutzt),
//      Zeilentyp, Spalten (CsvSpalte<Z>[]).
//   2. src/lib/behoerden/katalog/<gruppe>.ts – Katalog-Eintrag (id, Titel, Behörde,
//      Zugriff, Druckpfad …) über katalogGruppe().
//   3. src/lib/behoerden/register/<gruppe>.ts – definiereMeldung(KATALOG_X.id, { parameter,
//      laden, spalten, dateiteile, profil? }). `satisfies MeldungenZu<typeof KATALOG_X>`
//      erzwingt: jede Katalog-id hat genau einen Register-Eintrag (mit CSV) und umgekehrt.
//   4. Druckseite: CsvExportKnopf neben dem Druckknopf, erste Zeile der Seite
//      `// behoerdenmeldung: <id>`.

import type { CsvProfil, CsvSpalte } from '@/lib/csv'
import type { Membership } from '@/lib/auth/roles'
import type { ModulFlag } from '@/lib/auth/modul'
import type { Modul } from '@/lib/auth/module'
import { AktionsFehler } from '@/lib/fehler'

/** Gruppen der Meldungen – je Gruppe eine Datei katalog/<gruppe>.ts und register/<gruppe>.ts */
export type MeldungsGruppe = 'ernte' | 'pflanzenschutz' | 'verkehr' | 'kellerbuch' | 'buchhaltung' | 'flaechen'

/**
 * Wer die CSV (und die Druckseite) abrufen darf:
 *  betriebsleitung  Pflichtmeldungen (Entscheidung 24.09.2026): Super-Admin, Betriebs-Manager
 *                   und Mitarbeiter (system_admin, tenant_admin, winzer) OHNE Modul Controlling;
 *                   Leser wie bisher nur mit Modul Controlling + Auswertungsrecht
 *                   (gleiche Regel wie darfPflichtmeldungen() in lib/auth/modul.ts)
 *  auswertungen     Modul „Controlling“ + Auswertungsrecht (canSeeAuswertungen)
 *  mitglied         jedes aktive Mitglied des Betriebs (auch Leser)
 *  schreiben        Bearbeitungsrecht (canWrite) – im Modul `schreibModul`, sonst irgendwo
 *  verwaltung       nur Super-Admin und Betriebs-Manager (wie canAdmin), z. B. Änderungsprotokoll
 * Zusätzlich muss ein gesetztes `modul` (tenant_einstellungen.modul_*) freigeschaltet sein.
 * Rollenlisten: lib/auth/pflichtmeldung.ts (isomorph, auch für Navigation und Seiten-Guards).
 */
export type Zugriff = 'betriebsleitung' | 'auswertungen' | 'mitglied' | 'schreiben' | 'verwaltung'

export type KatalogEintrag = {
  /** URL-Segment: /meldungen/<id>/csv – nur a–z, 0–9 und Bindestrich */
  id: string
  /** Titel wie auf der Druckseite, z. B. „Weinerntemeldung“ */
  titel: string
  /** Empfänger, z. B. „AMA / BKI“, „Bio-Kontrollstelle“, „Finanzamt“ */
  behoerde: string
  gruppe: MeldungsGruppe
  zugriff: Zugriff
  rechtsgrundlage?: string
  /** Routenmuster der Druckseite wie im App-Verzeichnis ohne Gruppen-Klammern,
   *  z. B. '/reports/ama' oder '/dac/[id]/antrag'. Die Seite trägt den Marker. */
  druckPfad?: string
  /** Zusätzlich nötiges Modul des Betriebs (tenant_einstellungen) */
  modul?: ModulFlag
  /** Nur bei zugriff 'schreiben': Modul der Benutzer-Matrix */
  schreibModul?: Modul
  /** Amtliche Pflichtmeldung (Übersicht „Meldungen & Fristen“) */
  pflicht?: boolean
  /** Kurzbeschreibung für Übersichten */
  beschreibung?: string
  /** Standardauswahl der Druckseite als Query-Parameter (z. B. laufendes Jahr) – für den
   *  Direkt-Export der Übersicht, damit CSV und „Öffnen →“ dasselbe zeigen. Ohne Angabe:
   *  leere Parameter (so, wie die Druckseite ohne Auswahl öffnet). */
  standardParameter?: () => Record<string, string | number | null>
}

/** Angaben je Katalog-Eintrag – id (= Schlüssel) und gruppe setzt katalogGruppe() */
export type KatalogAngaben = Omit<KatalogEintrag, 'id' | 'gruppe'>

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Katalog einer Gruppe: Schlüssel = Meldungs-id.
 *   export const KATALOG_ERNTE = katalogGruppe('ernte', {
 *     erntemeldung: { titel: 'Weinerntemeldung', behoerde: 'AMA / BKI', zugriff: 'betriebsleitung', druckPfad: '/reports/ama', pflicht: true },
 *   })
 */
export function katalogGruppe<T extends Record<string, KatalogAngaben>>(
  gruppe: MeldungsGruppe,
  eintraege: T,
): { [K in keyof T & string]: KatalogEintrag & { id: K } } {
  const out: Record<string, KatalogEintrag> = {}
  for (const [id, e] of Object.entries(eintraege)) {
    if (!ID_RE.test(id)) throw new AktionsFehler(`Behördenmeldung „${id}“: id nur aus a–z, 0–9 und Bindestrich`)
    out[id] = { ...e, id, gruppe }
  }
  return out as { [K in keyof T & string]: KatalogEintrag & { id: K } }
}

// ── Laden ───────────────────────────────────────────────────────────────────

export type Betriebsdaten = {
  /** tenant_einstellungen.betrieb_name */
  name: string | null
  /** tenant_einstellungen.betrieb_betriebsnummer (LFBIS/BKI) – für den Dateinamen */
  betriebsnummer: string | null
}

export type LadeKontext = {
  /** Supabase-Server-Client im Benutzerkontext (RLS). Jede Abfrage mit .eq('tenant_id', tenantId)
   *  und alle() statt 1.000er-Deckel; Kellergemeinschaft über die SECURITY-DEFINER-Ladefunktionen. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  tenantId: string
  membership: Membership
  betrieb: Betriebsdaten
}

export type LadeErgebnis<Z> = {
  /** Eine Zeile je fachlicher Position, Zahlen bereits gerundet (runden() aus lib/csv) */
  zeilen: Z[]
  /** Hinweise für X-Warnungen (übersprungene Datensätze, unbekannte Kürzel, Fremdbelegung …) */
  warnungen?: string[]
}

/** Fehler aus parameter(): parameterFehler('Jahrgang fehlt') → HTTP 400 */
export type ParameterFehler = { readonly fehler: string; readonly parameterFehler: true }

export function parameterFehler(fehler: string): ParameterFehler {
  return { fehler, parameterFehler: true }
}

export function istParameterFehler(x: unknown): x is ParameterFehler {
  return typeof x === 'object' && x !== null && (x as { parameterFehler?: unknown }).parameterFehler === true
}

/** Erwarteter Abbruch mit eigenem Status (z. B. 404 „Antrag nicht gefunden“) – wird nicht als Systemfehler protokolliert */
export class MeldungsFehler extends Error {
  status: 400 | 403 | 404 | 409 | 422
  constructor(status: 400 | 403 | 404 | 409 | 422, meldung: string) {
    super(meldung)
    this.name = 'MeldungsFehler'
    this.status = status
  }
}

export type Dateiteil = string | number | null | undefined

/** Server-Teile einer Meldung. Eine Meldung ohne laden + spalten kompiliert nicht. */
export type MeldungsTeile<P, Z> = {
  /** Empfängerprofil, Standard PROFIL_EXCEL_AT */
  profil?: CsvProfil
  /** Query-Parameter der CSV-Route (1:1 die searchParams der Druckseite) prüfen */
  parameter: (sp: URLSearchParams) => P | ParameterFehler
  /** Dieselbe Ladefunktion wie die Druckseite. Fehler werfen (→ 500 + Systemereignis) bzw. MeldungsFehler. */
  laden: (ctx: LadeKontext, p: P) => Promise<LadeErgebnis<Z>>
  spalten: CsvSpalte<Z>[]
  /** Teile des Dateinamens ohne Erstelldatum: [Meldung, Betriebsnummer, Jahrgang|Zeitraum|Beleg] */
  dateiteile: (p: P, betrieb: Betriebsdaten) => Dateiteil[]
  /** KAN-95 (01.10.2026): BKI-Bericht – die Route benennt die Datei dann nach dem BKI-Schema
   *  <Betriebsnummer>_<Jahr>_<Berichtsname>[_von_JJJJMMTT_bis_JJJJMMTT].csv (meldungsDateiname()
   *  in dateiname.ts) statt nach dateiteile. Gesetzt für alle Katalogeinträge, deren Behörde die
   *  BKI nennt, und die Bestandsmeldung (Test kan95-bki-dateiname). */
  bki?: (p: P) => BkiBericht
}

/** KAN-95: Angaben für den BKI-Dateinamen. jahr bei Stichtag bzw. Jahrgang (Ernte-, Bestandsmeldung, Lesedaten) – sonst Exporttag. */
export type BkiBericht = {
  /** Berichtsname, ggf. mit Zusätzen (Gebinde, Charge, Beleg …) */
  bericht: string | readonly Dateiteil[]
  /** Jahr des Stichtags; ohne Angabe das Jahr des Exporttags (Wiener Zeit) */
  jahr?: number | null
  von?: string | null
  bis?: string | null
}

export type Behoerdenmeldung<P, Z> = KatalogEintrag & MeldungsTeile<P, Z>

/** Katalog-Eintrag + Server-Teile zu einer registrierbaren Meldung verbinden */
export function definiereMeldung<P, Z>(eintrag: KatalogEintrag, teile: MeldungsTeile<P, Z>): Behoerdenmeldung<P, Z> {
  return { ...eintrag, ...teile }
}

/** Register einer Gruppe muss genau die ids ihres Katalogs enthalten */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MeldungenZu<K> = { [id in keyof K]: Behoerdenmeldung<any, any> }
