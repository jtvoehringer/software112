// Fehler zwischen Server-Actions und Client (20.9.2026)
//
// Next.js maskiert in Produktion JEDEN aus einer Server-Action geworfenen Fehler:
// der Client bekommt ein Error-Objekt mit dem Text „An error occurred in the
// Server Components render …“ – die eigentliche Meldung („Speichern fehlgeschlagen
// (psm_lager_bewegungen): new row violates row-level security policy“) geht
// verloren. Einzig die Eigenschaft `digest` wird unverändert durchgereicht
// (create-error-handler: „If the error already has a digest, respect the
// original digest“). Darüber transportieren wir die Meldung.
//
// Server:  throw new AktionsFehler('Speichern fehlgeschlagen: …')
// Client:  catch (e) { setFehler(fehlerText(e)) }
//
// Diese Datei ist bewusst ohne Server-Importe (client-sicher).

const PRAEFIX = 'S112|'
const NEXT_MASKE = 'An error occurred in the Server Components render'

export class AktionsFehler extends Error {
  digest: string
  constructor(meldung: string) {
    super(meldung)
    this.name = 'AktionsFehler'
    this.digest = PRAEFIX + meldung
  }
}

/** Lesbare Meldung eines gefangenen Fehlers – auch in Produktion.
 *  Bekannte englische Datenbankmeldungen (Prüfregeln, Fremdschlüssel, RLS) werden
 *  dabei ins Deutsche übersetzt (uebersetzeDbMeldung). */
export function fehlerText(e: unknown, ersatz = 'Unerwarteter Fehler – bitte erneut versuchen.'): string {
  if (e && typeof e === 'object') {
    const d = (e as { digest?: unknown }).digest
    if (typeof d === 'string' && d.startsWith(PRAEFIX)) return uebersetzeDbMeldung(d.slice(PRAEFIX.length))
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m.trim() && !m.startsWith(NEXT_MASKE)) return uebersetzeDbMeldung(m)
    return ersatz
  }
  if (typeof e === 'string' && e.trim()) return uebersetzeDbMeldung(e)
  return ersatz
}

// ── Datenbankfehler auf Deutsch (KAN-35, 24.09.2026) ──────────────────────────
// Zentrale Übersetzung der Supabase/PostgREST-Fehler, die seit KAN-35 als
// „Sperre statt Löschen/Überschreiben“ bewusst ausgelöst werden:
//   23514 check_violation        → je Constraint-Name (Migration kan35_datenintegritaet)
//   23503 foreign_key_violation  → je FK (NO ACTION: Gebinde/Charge hat Historie)
// Meldungen der KAN-35-RPCs (schwund_buchen, fuellung_bestand_buchen) und der
// DB-Prüfungen (pruefe_tenant_zugriff, Gebinde-Trigger, Plattformfelder-Schutz)
// sind schon deutsch (22023, P0001, P0002, 42501, 55000) und werden unverändert
// durchgereicht; nur die englischen Standardtexte von PostgreSQL werden ersetzt.
//
// Server:  if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (weinausbau)'))
//          if (error) return { error: dbFehlerText(error) }
// Client:  fehlerText(e) übersetzt bekannte Meldungen zusätzlich automatisch –
//          auch wenn der Server die Rohmeldung in einen eigenen Text eingebaut hat.

/** Deutsche Meldung je CHECK-Constraint (23514) */
const PRUEFREGEL_MELDUNG: Record<string, string> = {
  verkauf_positionen_menge_positiv_check:
    'Die Menge einer Flaschen-, Tank- oder Traubenposition muss größer als 0 sein. Rücknahmen bitte als Storno des Verkaufs buchen.',
  verkauf_positionen_nur_charge_check:
    'Offener Wein (Tank) kann nur aus einer Kellerbuch-Charge verkauft werden. Zukäufe bitte zuerst einem Gebinde zuordnen (dabei entsteht die Charge) und dann die Charge verkaufen.',
  verschneidung_quellen_menge_positiv_check:
    'Jede Quelle eines Verschnitts braucht eine Menge größer als 0 L.',
  weinausbau_menge_liter_nicht_negativ_check:
    'Der Bestand der Charge darf nicht negativ werden – die gebuchte Menge ist größer als der vorhandene Bestand. Bitte Menge und Bestand prüfen.',
  weinausbau_anfangsbestand_nicht_negativ_check:
    'Der Anfangsbestand einer Charge darf nicht negativ sein.',
  keller_umzuege_mengen_nicht_negativ_check:
    'Mengen im Bewegungsbuch (Umzug, Schwund) dürfen nicht negativ sein. Schwund bitte als positive Menge über „Schwund buchen“ erfassen.',
  fuellungen_bestand_flaschen_check:
    'Der Flaschenbestand darf nicht negativ werden – es sind nicht genug Flaschen auf Lager.',
  fuellungen_anzahl_flaschen_check:
    'Die Anzahl der gefüllten Flaschen muss größer als 0 sein.',
  // KAN-73: Rückfall, falls ein Wert an der Serverprüfung (lib/wein/qualitaet.ts, qualitaetFehler) vorbeikommt
  ernte_parzellen_qualitaetsstufe_check:
    'Diese Qualitätsstufe ist bei der Lese nicht vorgesehen – möglich sind Wein, Landwein, Qualitätswein, Kabinett, Spätlese, Auslese, Beerenauslese, Trockenbeerenauslese und Eiswein; Strohwein und Ausbruch derzeit nicht (Entscheidung offen). DAC, Reserve, Erste Lage, Großes Gewächs, Sekt, Perlwein und Sonstiges werden bei der Charge bzw. Füllung vergeben.',
  weinausbau_qualitaetsstufe_check:
    'Diese Qualitätsstufe ist bei einer Kellerbuch-Charge nicht zulässig – bitte eine Stufe aus der Auswahlliste wählen.',
  fuellungen_qualitaet_check:
    'Diese Qualitätsstufe ist bei einer Füllung nicht zulässig – bitte eine Stufe aus der Auswahlliste wählen.',
}

const GEBINDE_INAKTIV = 'Gebinde stattdessen inaktiv setzen – die Historie bleibt so erhalten.'
const CHARGE_HISTORIE = 'Die Charge bleibt als Historie erhalten – stattdessen abschließen bzw. Korrekturen als eigene, datierte Buchung erfassen (z. B. Schwund buchen).'

/** Deutsche Meldung je Fremdschlüssel (23503) beim Löschen des referenzierten Datensatzes */
const FK_LOESCHEN_MELDUNG: Record<string, string> = {
  // KAN-35: seit 24.09.2026 NO ACTION (vorher still abgekoppelt bzw. mitgelöscht)
  weinausbau_behaelter_id_fkey:
    `Das Gebinde kann nicht gelöscht werden: Es hat eine Chargen-Historie (auch abgeschlossene Chargen oder Chargen eines Partnerbetriebs). ${GEBINDE_INAKTIV}`,
  keller_behandlungen_behaelter_id_fkey:
    `Das Gebinde kann nicht gelöscht werden: Es sind Kellerbehandlungen dazu erfasst. ${GEBINDE_INAKTIV}`,
  verschneidungen_ziel_weinausbau_id_fkey:
    `Die Charge kann nicht gelöscht werden: Sie ist Ziel eines Verschnitts. ${CHARGE_HISTORIE}`,
  // bereits vorher NO ACTION – gleiche Sprache
  keller_umzuege_von_behaelter_id_fkey:
    `Das Gebinde kann nicht gelöscht werden: Es kommt im Bewegungsbuch vor (Umzug oder Schwund). ${GEBINDE_INAKTIV}`,
  keller_umzuege_nach_behaelter_id_fkey:
    `Das Gebinde kann nicht gelöscht werden: Es kommt im Bewegungsbuch vor (Umzug oder Schwund). ${GEBINDE_INAKTIV}`,
  pressung_behaelter_behaelter_id_fkey:
    `Das Gebinde kann nicht gelöscht werden: Es ist in einer Pressung als Zielgebinde eingetragen. ${GEBINDE_INAKTIV}`,
  verschneidung_quellen_quell_weinausbau_id_fkey:
    `Die Charge kann nicht gelöscht werden: Sie ist Quelle eines Verschnitts. ${CHARGE_HISTORIE}`,
  keller_umzuege_von_weinausbau_id_fkey:
    `Die Charge kann nicht gelöscht werden: Sie kommt im Bewegungsbuch vor (Umzug oder Schwund). ${CHARGE_HISTORIE}`,
  keller_umzuege_nach_weinausbau_id_fkey:
    `Die Charge kann nicht gelöscht werden: Sie ist Ziel eines Umzugs. ${CHARGE_HISTORIE}`,
  fuellung_chargen_weinausbau_id_fkey:
    `Die Charge kann nicht gelöscht werden: Aus ihr wurde bereits abgefüllt. ${CHARGE_HISTORIE}`,
  pressung_behaelter_weinausbau_id_fkey:
    'Die Charge kann nicht gelöscht werden: Sie stammt aus einer Pressung. Bitte die Pressung in der Erntemeldung bearbeiten.',
  traubenverkauf_jahrgang_id_fkey:
    'Der Jahrgang kann nicht gelöscht werden: Es gibt Traubenverkäufe zu diesem Jahrgang.',
}

const CHECK_RE = /new row for relation "([^"]+)" violates check constraint "([^"]+)"/
const FK_RE = /(update or delete|insert or update) on table "([^"]+)" violates foreign key constraint "([^"]+)"(?: on table "([^"]+)")?/
const RLS_RE = /new row violates row-level security policy(?: for table "([^"]+)")?/
const RECHTE_RE = /permission denied for (?:table|relation) ([A-Za-z_0-9."]+)/

function pruefregelText(constraint: string, tabelle?: string): string {
  return PRUEFREGEL_MELDUNG[constraint]
    ?? `Die Eingabe verletzt eine Prüfregel der Datenbank („${constraint}“${tabelle ? ` auf „${tabelle}“` : ''}) – bitte die Werte prüfen.`
}

function fremdschluesselText(art: string, constraint: string, tabelle: string, verweisTabelle?: string): string {
  if (art === 'update or delete') {
    return FK_LOESCHEN_MELDUNG[constraint]
      ?? `„${tabelle}“ kann nicht gelöscht oder geändert werden: Der Datensatz wird noch von „${verweisTabelle ?? '…'}“ verwendet („${constraint}“).`
  }
  return `Der verknüpfte Datensatz existiert nicht (mehr) – bitte die Auswahl neu laden und erneut versuchen („${constraint}“).`
}

/**
 * Ersetzt bekannte englische PostgreSQL-/PostgREST-Meldungen in einem Text durch
 * deutsche – auch mitten in einem zusammengesetzten Text („Speichern fehlgeschlagen:
 * new row for relation …“). Alles andere bleibt unverändert.
 */
export function uebersetzeDbMeldung(text: string): string {
  if (!text) return text
  // Ersetzen per Funktion: „$“ in Constraint-/Tabellennamen nicht als Ersetzungsmuster deuten
  const ersetze = (roh: string, neu: string) => text.replace(roh, () => neu)
  let m = CHECK_RE.exec(text)
  if (m) return ersetze(m[0], pruefregelText(m[2], m[1]))
  m = FK_RE.exec(text)
  if (m) return ersetze(m[0], fremdschluesselText(m[1], m[3], m[2], m[4]))
  m = RLS_RE.exec(text)
  if (m) return ersetze(m[0], `Keine Berechtigung für diese Änderung${m[1] ? ` („${m[1]}“)` : ''} – Rolle oder Modulfreigabe prüfen`)
  m = RECHTE_RE.exec(text)
  if (m) return ersetze(m[0], `Keine Berechtigung für „${m[1].replace(/"/g, '')}“`)
  return text
}

/**
 * Deutsche Meldung für einen Supabase-/PostgREST-Fehler ({ code, message, details, hint }).
 * - 23514/23503: je Constraint-Name übersetzt (siehe Tabellen oben)
 * - deutsche Meldungen aus RPCs/Triggern (22023, P0001, P0002, 42501, 55000): unverändert
 * - PGRST202 (RPC mit diesen Parametern nicht gefunden): Hinweis auf Parameternamen
 * - sonst: Rohmeldung, bei Angabe mit `kontext` davor („Speichern fehlgeschlagen (x): …“)
 * `kontext` wird nur technischen, nicht übersetzten Meldungen vorangestellt.
 */
export function dbFehlerText(error: unknown, kontext?: string): string {
  if (!error) return kontext ? `${kontext}: unbekannter Fehler` : 'Unbekannter Datenbankfehler'
  if (typeof error === 'string') return uebersetzeDbMeldung(error)
  const e = error as { code?: unknown; message?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  const message = typeof e.message === 'string' ? e.message.trim() : ''
  const mitKontext = (t: string) => (kontext ? `${kontext}: ${t}` : t)

  if (code === '23514') {
    const m = CHECK_RE.exec(message)
    if (m) return pruefregelText(m[2], m[1])
    // RAISE … USING ERRCODE = '23514' aus einer Funktion: Text ist bereits deutsch
    return message || mitKontext('Die Eingabe verletzt eine Prüfregel der Datenbank.')
  }
  if (code === '23503') {
    const m = FK_RE.exec(message)
    if (m) return fremdschluesselText(m[1], m[3], m[2], m[4])
    return message || mitKontext('Der Datensatz wird noch von anderen Buchungen verwendet.')
  }
  if (code === 'PGRST202') {
    const fn = /function ([A-Za-z_0-9.]+)/.exec(message)?.[1]
    return mitKontext(`Datenbankfunktion${fn ? ` „${fn}“` : ''} mit diesen Parametern nicht gefunden – Aufruf mit Parameternamen prüfen`)
  }

  const uebersetzt = uebersetzeDbMeldung(message)
  if (uebersetzt !== message) return mitKontext(uebersetzt)
  // Eigene deutsche Meldungen aus RPCs und Triggern unverändert durchreichen
  if (['22023', 'P0001', 'P0002', '42501', '55000'].includes(code) && message) return message
  return mitKontext(message || 'unbekannter Datenbankfehler')
}
