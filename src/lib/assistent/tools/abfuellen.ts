// Tool "abfuellen" für den Prozess-Assistenten (Bot) – Phase 4a (Release 2:
// Kellerbuch/Bewegungsbuch).
//
// Deckt das Abfüllen einer bestehenden Kellerbuch-Charge (Weinausbau) in
// Flaschen ab (Füllung anlegen). Freie Füllungen OHNE Chargen-Verknüpfung
// unterstützt der Bot bewusst noch nicht – dafür weiterhin das bestehende
// Formular unter Weinhandel > Neue Füllung nutzen.
//
// Ruft am Ende dieselbe Server Action (createFuellung) mit denselben
// Parametern auf, die auch das bestehende Formular übergibt. WICHTIG:
// createFuellung/das Formular erzwingen serverseitig bereits, dass
// Qualitätsstufe und Herkunft-Code (BKI) gegenüber der Kellerbuch-Charge NUR
// abgestuft, NIE aufgestuft werden dürfen (hart blockiert) – der Bot muss
// diese Regel nicht selbst prüfen, sie greift automatisch.
import { createFuellung } from '@/app/(dashboard)/weinhandel/actions'
import { getCurrentMembership } from '@/lib/auth/roles'
import { FUELLUNG_QUALITAETEN, qualitaetFehler } from '@/lib/wein/qualitaet'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const FLASCHENGROESSEN_ML = [187, 375, 500, 750, 1000, 1500, 3000, 6000]
// KAN-73: erlaubte Qualitätsbezeichnungen der Füllung (= CHECK fuellungen)
const FUELLUNG_WERTE = FUELLUNG_QUALITAETEN.map(o => o.value)

export const ABFUELLEN_FELD_MATRIX_TEXT = `
FELD-MATRIX für "Abfüllen" (aktuell NUR Füllungen mit Kellerbuch-Chargen-Verknüpfung –
freie Füllungen ohne Charge werden vom Bot noch nicht unterstützt, dafür freundlich auf das
bestehende Formular unter Weinhandel > Neue Füllung verweisen):

weinausbau_id (pflicht, ID der abzufüllenden Charge aus WEINAUSBAU-CHARGEN im
Stammdaten-Kontext), name (pflicht, Produktname – ohne Angabe den Chargennamen verwenden),
datum (pflicht, Abfülldatum YYYY-MM-DD), flaschengroesse_ml (pflicht, eine von
187/375/500/750/1000/1500/3000/6000), anzahl_flaschen (pflicht).

qualitaet (optional – ohne Angabe wird die aktuelle Qualitätsstufe der Charge übernommen;
NUR Abstufung möglich, eine Aufstufung wird vom Server hart blockiert), herkunft_code
(optional, gleiche Regel: nur Abstufung), jahrgang/rebsorte/anbaugebiet/bezeichnung/
pruefnummer/chargennummer (optional, chargennummer wird sonst automatisch vergeben;
pruefnummer: hat die Charge einen DAC-Antrag, NUR die Nummer ihres genehmigten Antrags, die der
User nennt – der Server verknüpft dann den Antrag, wenn die Nummer für den Bestand gilt, sonst
kommt eine Fehlermeldung, die du wörtlich weitergibst; eine andere Nummer lehnt er ab. Einen
offenen Antrag ohne Nummer verknüpft nur das Formular Weinhandel > Neue Füllung – soll die
Füllung ihn tragen, auf das Formular verweisen statt ohne Nummer abzufüllen (die Bearbeitung
kann Prüfnummer und Antrag später nicht mehr setzen). Eine freie Nummer, z. B. die des
Lieferanten bei einem Zukauf, nur bei Chargen ohne DAC-Antrag),
vk_preis_brutto/einstandspreis (optional, pro Flasche), notizen (optional), abschliessen
(optional, boolean – Charge nach dieser Füllung explizit als abgeschlossen markieren, auch
wenn noch Restwein übrig bleibt; wird ohnehin automatisch gesetzt, wenn kein/kaum Restwein
übrig bleibt).

ERGEBNIS: Liefert das Tool erfolg=true UND einen "hinweis" (nacharbeit_noetig=true), ist die
Füllung zwar angelegt, aber ein Folgeschritt fehlgeschlagen (z. B. Restmenge nicht als
Schwund ausgebucht, Charge noch offen). Dann NICHT einfach "erledigt" melden, sondern den
Hinweis dem User wörtlich weitergeben und die Füllung NICHT erneut anlegen.
`.trim()

export const ABFUELLEN_TOOL = {
  name: 'abfuellen',
  description:
    'Füllt eine bestehende Kellerbuch-Charge (Weinausbau) in Flaschen ab und legt eine neue ' +
    'Füllung im Weinhandel-Bestand an. WICHTIG: Rufe dieses Tool ausschließlich MIT ' +
    'bestaetigt_vom_user=true auf, und das auch nur, nachdem du dem User in einer normalen ' +
    'Textnachricht eine Zusammenfassung gezeigt und er ausdrücklich zugestimmt hat (z.B. "ja", ' +
    '"passt", "ok"). Rufe es NIEMALS vorher auf (auch nicht testweise).',
  input_schema: {
    type: 'object' as const,
    properties: {
      bestaetigt_vom_user: {
        type: 'boolean',
        description: 'true NUR wenn der User die Zusammenfassung in seiner letzten Nachricht ausdrücklich bestätigt hat.',
      },
      weinausbau_id: { type: 'string', description: 'ID der abzufüllenden Charge aus dem Stammdaten-Kontext' },
      name: { type: 'string', description: 'Produktname' },
      datum: { type: 'string', description: 'Abfülldatum, Format YYYY-MM-DD' },
      flaschengroesse_ml: { type: 'number', enum: FLASCHENGROESSEN_ML },
      anzahl_flaschen: { type: 'number' },
      menge_liter_gefuellt: { type: 'number', description: 'Nur falls die tatsächlich abgefüllte Menge von Anzahl×Größe abweicht (sonst automatisch berechnet)' },
      qualitaet: {
        type: 'string',
        enum: FUELLUNG_WERTE,
        description: 'Nur Abstufung gegenüber der Charge möglich (sonst wird die aktuelle Stufe übernommen)',
      },
      herkunft_code: { type: 'string', description: 'Nur Abstufung gegenüber der Charge möglich' },
      jahrgang: { type: 'number' },
      rebsorte: { type: 'string' },
      anbaugebiet: { type: 'string' },
      bezeichnung: { type: 'string', description: 'Subbezeichnung/Ried, z.B. "Ried Hohenberg · Reserve"' },
      pruefnummer: { type: 'string', description: 'Charge mit DAC-Antrag: nur die Nummer ihres genehmigten Antrags (der Server prüft, ob sie für den Bestand gilt, und verknüpft den Antrag); Charge ohne DAC-Antrag: freie Nummer, z. B. des Lieferanten (KAN-72)' },
      chargennummer: { type: 'string', description: 'Leer lassen = wird automatisch vergeben' },
      vk_preis_brutto: { type: 'number', description: 'VK-Preis brutto pro Flasche' },
      einstandspreis: { type: 'number', description: 'Einstandspreis pro Flasche' },
      notizen: { type: 'string' },
      abschliessen: { type: 'boolean' },
    },
    required: ['bestaetigt_vom_user', 'weinausbau_id', 'name', 'datum', 'flaschengroesse_ml', 'anzahl_flaschen'],
  },
}

export async function fuehreAbfuellenAus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<R> {
  if (input?.bestaetigt_vom_user !== true) {
    return {
      erfolg: false,
      hinweis: 'Noch nicht bestätigt. Fasse die geplante Füllung (Charge, Produktname, Menge, ' +
        'Flaschengröße, Anzahl) in einer normalen Textnachricht zusammen und frage den User ' +
        'ausdrücklich um Bestätigung, bevor du dieses Tool erneut mit bestaetigt_vom_user=true ' +
        'aufrufst. Es wurde NICHTS gespeichert.',
    }
  }

  if (!input.weinausbau_id) {
    return { erfolg: false, hinweis: 'Keine Charge angegeben. Beim User nachfragen, welche Kellerbuch-Charge abgefüllt werden soll, und die exakte ID aus dem Stammdaten-Kontext verwenden.' }
  }
  if (!input.name || !input.datum || !input.flaschengroesse_ml || !(Number(input.anzahl_flaschen) > 0)) {
    return { erfolg: false, hinweis: 'Produktname, Datum, Flaschengröße und Anzahl Flaschen (> 0) sind Pflichtfelder – bitte beim User nachfragen.' }
  }
  // KAN-73: unbekannte Stufe freundlich zurückmelden (createFuellung prüft ebenfalls)
  const qualitaetUnzulaessig = qualitaetFehler('fuellung', input.qualitaet ? String(input.qualitaet) : null)
  if (qualitaetUnzulaessig) {
    return { erfolg: false, hinweis: `${qualitaetUnzulaessig} Mögliche Werte: ${FUELLUNG_WERTE.join(', ')}. Es wurde NICHTS gespeichert.` }
  }

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) {
    return { erfolg: false, fehler: 'Kein Betrieb gefunden – Abfüllung konnte nicht gespeichert werden.' }
  }

  const { data: charge } = await (supabase.from('weinausbau') as any)
    .select('id, name, jahrgang, rebsorte, menge_liter, qualitaetsstufe, herkunft_code')
    .eq('id', input.weinausbau_id).eq('tenant_id', tenantId).eq('aktiv', true).maybeSingle()
  if (!charge) {
    return { erfolg: false, hinweis: `Charge mit ID ${input.weinausbau_id} nicht gefunden. Beim User nachfragen bzw. Stammdaten-Kontext erneut prüfen.` }
  }
  const ch = charge as R

  const fd = new FormData()
  fd.set('weinausbau_id', String(input.weinausbau_id))
  fd.set('name', String(input.name))
  fd.set('datum', String(input.datum))
  fd.set('flaschengroesse_ml', String(input.flaschengroesse_ml))
  fd.set('anzahl_flaschen', String(input.anzahl_flaschen))
  if (input.menge_liter_gefuellt != null) fd.set('menge_liter_gefuellt', String(input.menge_liter_gefuellt))
  fd.set('qualitaet', input.qualitaet ? String(input.qualitaet) : String(ch.qualitaetsstufe ?? 'qualitaetswein'))
  if (input.herkunft_code) fd.set('herkunft_code', String(input.herkunft_code))
  else if (ch.herkunft_code) fd.set('herkunft_code', String(ch.herkunft_code))
  fd.set('jahrgang', input.jahrgang != null ? String(input.jahrgang) : String(ch.jahrgang ?? ''))
  fd.set('rebsorte', input.rebsorte ? String(input.rebsorte) : String(ch.rebsorte ?? ''))
  if (input.anbaugebiet) fd.set('anbaugebiet', String(input.anbaugebiet))
  if (input.bezeichnung) fd.set('bezeichnung', String(input.bezeichnung))
  if (input.pruefnummer) fd.set('pruefnummer', String(input.pruefnummer))
  if (input.chargennummer) fd.set('chargennummer', String(input.chargennummer))
  if (input.vk_preis_brutto != null) fd.set('vk_preis_brutto', String(input.vk_preis_brutto))
  if (input.einstandspreis != null) fd.set('einstandspreis', String(input.einstandspreis))
  if (input.notizen) fd.set('notizen', String(input.notizen))
  if (input.abschliessen) fd.set('abschliessen', 'true')

  try {
    const result = await createFuellung(fd)
    // Teilerfolg (KAN-35): Füllung angelegt, Folgeschritt fehlgeschlagen – dem User zeigen
    if (result?.hinweis) {
      return { erfolg: true, fuellung_id: result.id ?? null, nacharbeit_noetig: true, hinweis: result.hinweis }
    }
    return { erfolg: true, fuellung_id: (result as R | undefined)?.id ?? null }
  } catch (err) {
    return { erfolg: false, fehler: (err as Error).message ?? String(err) }
  }
}
