// Tool "umziehen" für den Prozess-Assistenten (Bot) – Phase 4c (Release 2:
// Kellerbuch/Bewegungsbuch).
//
// Deckt den häufigsten Fall ab: EINE Quell-Charge wird (ganz oder teilweise)
// in EIN Ziel-Gebinde umgezogen. Die Zusammenführung/Aufteilung mehrerer
// Quellen bzw. mehrerer Ziele in einem einzigen Umzug (Mehrfachauswahl im
// bestehenden Formular) unterstützt der Bot bewusst noch nicht – dafür
// weiterhin das bestehende Formular unter Kellerbuch > Umziehen nutzen.
//
// Ruft am Ende dieselbe Server Action (umziehen) mit denselben Parametern auf
// (jeweils als Ein-Element-Array), die auch das bestehende Formular übergibt.
//
// WICHTIG – Folgeeffekte (Konzeptdokument Abschnitt 3b): Liegt im Ziel-Gebinde
// Wein mit anderer Rebsorte, anderem Jahrgang, anderer Herkunft oder Qualität,
// bucht umziehen() den Umzug seit KAN-112 sofort als Verschnitt in die Charge
// dort (keine Zwischencharge, kein eigener Verschneiden-Schritt mehr) – samt
// möglicher Qualitäts-/Herkunfts-Abstufung und Sortenhinweisen. Der Handler gibt
// das als verschnitte (Liste, hier ein Eintrag) zurück, der System-Prompt weist den Bot an, dies dem User
// explizit mitzuteilen statt nur "erledigt" zu melden.
import { umziehen } from '@/app/(dashboard)/kellerbuch/umziehen/actions'
import { ladeBehaelterEinzeln } from '@/lib/keller/behaelter'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const UMZIEHEN_FELD_MATRIX_TEXT = `
FELD-MATRIX für "Umziehen" (aktuell NUR eine Quell-Charge in ein Ziel-Gebinde – Zusammenführen
mehrerer Chargen oder Aufteilen auf mehrere Ziele in einem Schritt wird vom Bot noch nicht
unterstützt, dafür freundlich auf das bestehende Formular unter Kellerbuch > Umziehen
verweisen):

datum (pflicht, YYYY-MM-DD), weinausbau_id (pflicht, ID der umzuziehenden Quell-Charge aus
WEINAUSBAU-CHARGEN im Stammdaten-Kontext), menge (pflicht, Liter – kann kleiner als der
gesamte Chargenbestand sein für einen Teilumzug), ziel_behaelter_id (pflicht, ID des
Ziel-Gebindes aus BEHÄLTER/GEBINDE im Stammdaten-Kontext), umzug_typ (optional:
normal/filtration, Standard normal), notizen (optional).

GANZ WICHTIG: Liegt im Ziel-Gebinde bereits eine Charge mit denselben Merkmalen (Rebsorte,
Jahrgang, Herkunft, Qualität), werden die Chargen zusammengeführt. Weicht der Wein dort in einem
dieser Merkmale ab, bucht das Tool den Umzug SOFORT als Verschnitt in die Charge im Ziel-Gebinde
(KAN-112) – das Ergebnis enthält dann verschnitte (je Eintrag Ziel-Charge, abweichende Merkmale, ggf.
Qualitäts-/Herkunfts-Abstufung und Hinweise zu Rebsorte/Jahrgang). Weise den User deshalb VOR der
Bestätigung darauf hin, wenn im Ziel-Gebinde anderer Wein liegt, und teile ihm nach dem Speichern
den Verschnitt samt Abstufungen explizit mit. Ein eigener Aufruf von "verschneiden" ist danach
NICHT nötig.

PRÜFNUMMER (KAN-83): Wird der Wein mit einer Charge zusammengeführt, die eine geltende staatliche
Prüfnummer hat, bucht das Tool nicht, sondern meldet bestaetigung_noetig mit einer Rückfrage
(„Die Prüfnummer … gilt für den Tankbestand … nicht mehr … Fortfahren?“). Gib diese Frage
wörtlich an den User weiter und rufe das Tool nur nach seiner ausdrücklichen Zustimmung erneut
mit pruefnummer_verlust_bestaetigt=true auf. Ist der DAC-Antrag eingereicht, lehnt der Server ab.

ROT/WEISS (KAN-193): Rot- und Weißwein dürfen verschnitten werden, wenn das Ergebnis auf „Wein (aus Österreich)“
abgestuft wird. Das Tool bucht dann zuerst nicht, sondern meldet bestaetigung_noetig mit der Rückfrage – wie bei der
Prüfnummer wörtlich weitergeben und nur nach ausdrücklicher Zustimmung erneut mit pruefnummer_verlust_bestaetigt=true
aufrufen (die Zustimmung gilt für die ganze Rückfrage). Nach dem Speichern die Abstufung explizit mitteilen.
`.trim()

export const UMZIEHEN_TOOL = {
  name: 'umziehen',
  description:
    'Zieht eine Quell-Charge (ganz oder teilweise) in ein Ziel-Gebinde um. WICHTIG: Rufe ' +
    'dieses Tool ausschließlich MIT bestaetigt_vom_user=true auf, und das auch nur, nachdem ' +
    'du dem User in einer normalen Textnachricht eine Zusammenfassung (Quelle, Menge, Ziel) ' +
    'gezeigt und er ausdrücklich zugestimmt hat (z.B. "ja", "passt", "ok"). Rufe es NIEMALS ' +
    'vorher auf (auch nicht testweise).',
  input_schema: {
    type: 'object' as const,
    properties: {
      bestaetigt_vom_user: {
        type: 'boolean',
        description: 'true NUR wenn der User die Zusammenfassung in seiner letzten Nachricht ausdrücklich bestätigt hat.',
      },
      pruefnummer_verlust_bestaetigt: {
        type: 'boolean',
        description: 'KAN-83/KAN-193: true NUR wenn das Tool zuvor bestaetigung_noetig gemeldet, du die Rückfrage (Prüfnummer und/oder Rot/Weiß-Verschnitt mit Abstufung auf Wein aus Österreich) wörtlich weitergegeben und der User ihr in seiner letzten Nachricht ausdrücklich zugestimmt hat.',
      },
      datum: { type: 'string', description: 'Datum des Umzugs, Format YYYY-MM-DD' },
      weinausbau_id: { type: 'string', description: 'ID der Quell-Charge aus dem Stammdaten-Kontext' },
      menge: { type: 'number', description: 'Umzuziehende Menge in Liter' },
      ziel_behaelter_id: { type: 'string', description: 'ID des Ziel-Gebindes aus dem Stammdaten-Kontext' },
      umzug_typ: { type: 'string', enum: ['normal', 'filtration'] },
      notizen: { type: 'string' },
    },
    required: ['bestaetigt_vom_user', 'datum', 'weinausbau_id', 'menge', 'ziel_behaelter_id'],
  },
}

export async function fuehreUmziehenAus(
  input: R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<R> {
  if (input?.bestaetigt_vom_user !== true) {
    return {
      erfolg: false,
      hinweis: 'Noch nicht bestätigt. Fasse den geplanten Umzug (Quelle, Menge, Ziel-Gebinde) in ' +
        'einer normalen Textnachricht zusammen und frage den User ausdrücklich um Bestätigung, ' +
        'bevor du dieses Tool erneut mit bestaetigt_vom_user=true aufrufst. Es wurde NICHTS ' +
        'gespeichert.',
    }
  }

  if (!input.datum || !input.weinausbau_id || !input.ziel_behaelter_id || !(Number(input.menge) > 0)) {
    return { erfolg: false, hinweis: 'Datum, Quell-Charge, Ziel-Gebinde und eine Menge > 0 L sind Pflichtfelder – bitte beim User nachfragen.' }
  }

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) {
    return { erfolg: false, fehler: 'Kein Betrieb gefunden – Umzug konnte nicht gespeichert werden.' }
  }

  const [{ data: quelle, error: quelleErr }, zielRow] = await Promise.all([
    (supabase.from('weinausbau') as any).select('id, menge_liter').eq('id', input.weinausbau_id).eq('tenant_id', tenantId).eq('aktiv', true).maybeSingle(),
    // eigene + freigegebene Gebinde (Kellergemeinschaft, Migration 203)
    ladeBehaelterEinzeln(supabase, tenantId, input.ziel_behaelter_id),
  ])
  if (quelleErr) return { erfolg: false, fehler: `Datenbankfehler: ${quelleErr.message}` }
  const ziel = zielRow && zielRow.aktiv ? zielRow : null
  if (ziel?.gesperrt) {
    return { erfolg: false, hinweis: `Ziel-Gebinde „${ziel.name}“ ist durch ${ziel.fremd_betrieb ?? 'einen anderen Betrieb'} belegt – dorthin kann nicht umgezogen werden. Anderes Gebinde vorschlagen.` }
  }
  if (!quelle) {
    return { erfolg: false, hinweis: `Quell-Charge mit ID ${input.weinausbau_id} nicht gefunden. Beim User nachfragen bzw. Stammdaten-Kontext erneut prüfen.` }
  }
  if (!ziel) {
    return { erfolg: false, hinweis: `Ziel-Gebinde mit ID ${input.ziel_behaelter_id} nicht gefunden. Beim User nachfragen bzw. Stammdaten-Kontext erneut prüfen.` }
  }

  const fd = new FormData()
  fd.set('datum', String(input.datum))
  fd.set('umzug_typ', input.umzug_typ === 'filtration' ? 'filtration' : 'normal')
  if (input.notizen) fd.set('notizen', String(input.notizen))
  fd.set('quellen_json', JSON.stringify([{ weinausbau_id: String(input.weinausbau_id), menge: Number(input.menge) }]))
  fd.set('ziele_json', JSON.stringify([{ behaelter_id: String(input.ziel_behaelter_id), menge: Number(input.menge) }]))

  // KAN-83: zweite Stufe – der User hat die Rückfrage zur Prüfnummer bestätigt
  if (input.pruefnummer_verlust_bestaetigt === true) fd.set('pn_bestaetigt', '1')
  // KAN-193: dieselbe Zustimmung deckt die Rückfrage Rot/Weiß (Abstufung auf Wein aus Österreich) – sie steht in derselben Frage
  if (input.pruefnummer_verlust_bestaetigt === true) fd.set('rotweiss_bestaetigt', '1')

  try {
    const result = await umziehen(fd)
    if ((result as R | undefined)?.bestaetigung) {
      return {
        erfolg: false,
        bestaetigung_noetig: true,
        hinweis: `Rückfrage an den User (wörtlich weitergeben): „${(result as R).bestaetigung}“ Nur wenn er ausdrücklich ` +
          'zustimmt, dieses Tool erneut mit pruefnummer_verlust_bestaetigt=true aufrufen. Es wurde NICHTS gespeichert.',
      }
    }
    // KAN-112: als Verschnitt gebucht (früher nur Hinweis auf einen eigenen Verschneiden-Schritt); umziehen() liefert
    // einen Verschnitt je Ziel-Gebinde – der Assistent zieht weiterhin in genau ein Ziel um
    const liste = ((result as R | undefined)?.verschnitte ?? []) as R[]
    return {
      erfolg: true,
      verschnitte: liste.map(v => ({
        verschneidung_id: v.verschneidungId ?? null,
        ziel_weinausbau_id: v.zielChargeId ?? null,
        ziel_charge: v.zielName ?? null,
        abweichende_merkmale: v.unterschiede ?? [],
        qualitaet_abgestuft: v.qualitaetAbgestuft ?? null,
        herkunft_abgestuft: v.herkunftAbgestuft ?? null,
        sorten_hinweise: v.sortenHinweise ?? [],
        rot_weiss_abgestuft_auf_wein_oesterreich: v.rotWeiss === true,
      })),
      abstufung: (result as R | undefined)?.abstufung ?? null,
    }
  } catch (err) {
    return { erfolg: false, fehler: (err as Error).message ?? String(err) }
  }
}
