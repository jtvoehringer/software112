import 'server-only'
import { ereignisMelden } from '@/lib/system/ereignis'
import { HINWEIS_BKI_UPLOAD } from '@/lib/csv'
import { csvPfad, GRUPPEN_LABEL, type MeldungsId } from './katalog'
import { meldungFinden } from './register'
import { istParameterFehler, type KatalogEintrag, type MeldungsGruppe } from './typen'
import { erlaubteMeldungen } from './zugriff'

// ── Übersicht „Behördenmeldungen (Drucken & CSV)“ (server-only, 24.09.2026) ──────
//
// Gespeist aus dem Katalog (katalog.ts), gefiltert mit derselben Zugriffsprüfung wie die
// zentrale CSV-Route (zugriff.ts, erlaubteMeldungen()): Betriebsleiter sehen die
// Pflichtmeldungen auch ohne Modul Controlling, das Änderungsprotokoll nur Verwaltung
// (Zugriff 'verwaltung'), alle anderen nur, was sie auch exportieren dürfen. Genutzt von
// /dashboard/fristen (Karte) und /reports (Tab „Behörden“) über
// components/behoerden/BehoerdenUebersicht.tsx – die Daten sind serialisierbar.
//
// Je Meldung:
//   seite  Druckseite bzw. – wenn die Meldung einen Datensatz braucht ([id] im Druckpfad) –
//          die Seite, auf der man ihn auswählt (EINSTIEG)
//   csv    Direkt-Link auf /meldungen/<id>/csv mit der STANDARDAUSWAHL der Druckseite
//          (KatalogEintrag.standardParameter, z. B. laufendes Jahr bzw. ab 1. Jänner; ohne
//          Angabe leere Parameter wie die Seite ohne Auswahl) – nur, wenn parameter() der
//          Meldung damit auskommt. Sonst CSV auf der Seite nach Auswahl.
// check-behoerden-csv.js prüft, dass jeder Druckpfad und jede Einstiegsseite existiert.

export type UebersichtEintrag = {
  id: string
  titel: string
  behoerde: string
  pflicht: boolean
  beschreibung: string | null
  rechtsgrundlage: string | null
  /** Druckseite bzw. Auswahlseite (null, wenn die Meldung keine eigene Seite hat) */
  seite: { href: string; label: string } | null
  /** CSV mit der Standardauswahl – null, wenn erst ein Jahrgang/Beleg/Gebinde zu wählen ist */
  csv: string | null
  /** Tooltip des CSV-Knopfs, wenn die Datei kein Excel-Export ist (BKI-Upload); sonst null */
  csvHinweis: string | null
}

export type UebersichtGruppe = {
  gruppe: MeldungsGruppe
  label: string
  eintraege: UebersichtEintrag[]
}

/** Druckpfade mit Datensatz-Auswahl → Seite, auf der man den Datensatz wählt */
export const EINSTIEG: Readonly<Record<string, { pfad: string; label: string }>> = {
  '/erntemeldung/[id]': { pfad: '/erntemeldung', label: 'Jahrgang wählen' },
  '/weinhandel/verkauf/[id]/transportbescheinigung': { pfad: '/weinhandel/transportbescheinigungen', label: 'Verkauf wählen' },
  '/dac/[id]/antrag': { pfad: '/dac', label: 'Antrag wählen' },
  '/weinexport/[id]': { pfad: '/weinexport', label: 'Auftrag wählen' },
  '/weinexport/[id]/emcs-datenblatt': { pfad: '/weinexport', label: 'Auftrag wählen' },
  '/kellerbuch/behaelter/[id]/bewegungen': { pfad: '/kellerbuch', label: 'Gebinde wählen' },
  '/kellerbuch/behaelter/[id]/behandlungen': { pfad: '/kellerbuch', label: 'Gebinde wählen' },
  '/kellerbuch/weinausbau/[id]/buch': { pfad: '/kellerbuch/weinausbau', label: 'Charge wählen' },
  '/kellerbuch/fuellung/[id]/blend-protokoll': { pfad: '/kellerbuch/rueckverfolgung', label: 'Füllung wählen' },
}

/** Ohne Filter sehr umfangreich (alle Füllungen × Herkunft) – CSV nur nach Auswahl auf der Seite.
 *  Die Weinbuch-Sammlung bietet ihre Seite ohne Auswahl für alle Chargen an – hier ebenso. */
const NUR_MIT_AUSWAHL: ReadonlySet<string> = new Set<MeldungsId>(['rueckverfolgung'])

function seiteFuer(e: KatalogEintrag): UebersichtEintrag['seite'] {
  if (!e.druckPfad) return null
  if (!e.druckPfad.includes('[')) return { href: e.druckPfad, label: 'Öffnen' }
  const einstieg = EINSTIEG[e.druckPfad]
  return einstieg ? { href: einstieg.pfad, label: einstieg.label } : null
}

/** Direkt-CSV mit der Standardauswahl der Druckseite, wenn die Meldung damit auskommt (reine Prüfung, kein Laden) */
function csvMitStandardauswahl(e: KatalogEintrag): string | null {
  const meldung = meldungFinden(e.id)
  if (!meldung || NUR_MIT_AUSWAHL.has(e.id)) return null
  try {
    const standard = e.standardParameter?.() ?? {}
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(standard)) if (v !== null && v !== '') sp.set(k, String(v))
    return istParameterFehler(meldung.parameter(sp)) ? null : csvPfad(e.id as MeldungsId, standard)
  } catch {
    return null
  }
}

/**
 * Behördenmeldungen der aktiven Mitgliedschaft, gruppiert wie GRUPPEN_LABEL (leere Gruppen
 * entfallen). null = Übersicht konnte nicht geladen werden (Datenbankfehler, protokolliert) –
 * die aufrufende Seite bleibt benutzbar und zeigt einen Hinweis.
 */
export async function behoerdenUebersicht(): Promise<UebersichtGruppe[] | null> {
  let erlaubt: KatalogEintrag[]
  try {
    erlaubt = await erlaubteMeldungen()
  } catch (e) {
    await ereignisMelden({
      art: 'server',
      quelle: 'lib/behoerden/uebersicht',
      meldung: e instanceof Error ? e.message : String(e),
      digest: null,
      tenantId: null,
      details: {},
    })
    return null
  }

  return (Object.keys(GRUPPEN_LABEL) as MeldungsGruppe[])
    .map(gruppe => ({
      gruppe,
      label: GRUPPEN_LABEL[gruppe],
      eintraege: erlaubt.filter(e => e.gruppe === gruppe).map(e => ({
        id: e.id,
        titel: e.titel,
        behoerde: e.behoerde,
        pflicht: e.pflicht === true,
        beschreibung: e.beschreibung ?? null,
        rechtsgrundlage: e.rechtsgrundlage ?? null,
        seite: seiteFuer(e),
        csv: csvMitStandardauswahl(e),
        csvHinweis: meldungFinden(e.id)?.profil?.name === 'BKI' ? HINWEIS_BKI_UPLOAD : null,
      })),
    }))
    .filter(g => g.eintraege.length > 0)
}
