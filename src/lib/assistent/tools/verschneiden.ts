// Tool "verschneiden" für den Prozess-Assistenten (Bot) – Phase 4b (Release 2:
// Kellerbuch/Bewegungsbuch).
//
// Verschneidet eine oder mehrere Quell-Chargen in eine Ziel-Charge. Ruft am
// Ende dieselbe Server Action (createVerschneidung) mit denselben Parametern
// auf, die auch das bestehende Formular übergibt.
//
// WICHTIG – Folgeeffekte (Konzeptdokument Abschnitt 3b): Verschneiden kann
// automatisch eine Qualitäts- und/oder Herkunft-Abstufung der Ziel-Charge
// auslösen. Der Handler gibt das Ergebnis von createVerschneidung 1:1 zurück
// (qualitaetAbgestuft/herkunftAbgestuft), der System-Prompt weist den Bot an,
// diese Folgeeffekte dem User nach dem Speichern explizit mitzuteilen – nicht
// nur "erledigt" zu melden.
import { createVerschneidung } from '@/app/(dashboard)/kellerbuch/actions'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const VERSCHNEIDEN_FELD_MATRIX_TEXT = `
FELD-MATRIX für "Verschneiden":

datum (pflicht, YYYY-MM-DD), ziel_weinausbau_id (pflicht, ID der Ziel-Charge aus
WEINAUSBAU-CHARGEN im Stammdaten-Kontext, in die verschnitten wird), quellen (pflicht,
Array von mindestens einer Position {weinausbau_id (ID der Quell-Charge), menge_liter}),
notizen (optional).

Rotwein und Weißwein dürfen laut Weingesetz nicht miteinander verschnitten werden – das prüft
die Server Action automatisch und lehnt den Verschnitt in dem Fall ab.

GANZ WICHTIG: Verschneiden kann automatisch eine Qualitäts- und/oder Herkunft-Abstufung der
Ziel-Charge auslösen (die resultierende Charge übernimmt immer die niedrigste beteiligte
Qualitätsstufe bzw. die weiteste Herkunftsstufe). Das Tool-Ergebnis enthält dazu
qualitaet_abgestuft/herkunft_abgestuft, falls das passiert ist – diese Information MUSST du dem
User nach dem Speichern explizit mitteilen (nicht nur "erledigt, danke"), da es sich um eine
für den Betrieb rechtlich relevante automatische Änderung handelt.

PRÜFNUMMER (KAN-83): Hat die Ziel-Charge eine geltende staatliche Prüfnummer, bucht das Tool
nicht, sondern meldet bestaetigung_noetig mit einer Rückfrage („Die Prüfnummer … gilt für den
Tankbestand … nicht mehr … Fortfahren?“). Gib diese Frage wörtlich an den User weiter und rufe
das Tool nur nach seiner ausdrücklichen Zustimmung erneut mit pruefnummer_verlust_bestaetigt=true
auf. Ist der DAC-Antrag eingereicht, lehnt der Server ab – dann muss der Antrag zuerst
zurückgezogen werden.

ROT/WEISS (KAN-193): Rot- und Weißwein dürfen verschnitten werden, wenn das Ergebnis auf „Wein (aus Österreich)“
abgestuft wird. Das Tool bucht dann zuerst nicht, sondern meldet bestaetigung_noetig mit der Rückfrage – wie bei der
Prüfnummer wörtlich weitergeben und nur nach ausdrücklicher Zustimmung erneut mit pruefnummer_verlust_bestaetigt=true
aufrufen (die Zustimmung gilt für die ganze Rückfrage). Nach dem Speichern die Abstufung explizit mitteilen.
`.trim()

export const VERSCHNEIDEN_TOOL = {
  name: 'verschneiden',
  description:
    'Verschneidet eine oder mehrere Quell-Chargen in eine Ziel-Charge (Weinausbau). WICHTIG: ' +
    'Rufe dieses Tool ausschließlich MIT bestaetigt_vom_user=true auf, und das auch nur, ' +
    'nachdem du dem User in einer normalen Textnachricht eine Zusammenfassung (Ziel-Charge, ' +
    'alle Quellen mit Menge) gezeigt und er ausdrücklich zugestimmt hat (z.B. "ja", "passt", ' +
    '"ok"). Rufe es NIEMALS vorher auf (auch nicht testweise).',
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
      datum: { type: 'string', description: 'Datum der Verschneidung, Format YYYY-MM-DD' },
      ziel_weinausbau_id: { type: 'string', description: 'ID der Ziel-Charge aus dem Stammdaten-Kontext' },
      quellen: {
        type: 'array',
        description: 'Mindestens eine Quell-Charge.',
        items: {
          type: 'object',
          properties: {
            weinausbau_id: { type: 'string', description: 'ID der Quell-Charge aus dem Stammdaten-Kontext' },
            menge_liter: { type: 'number' },
          },
          required: ['weinausbau_id', 'menge_liter'],
        },
      },
      notizen: { type: 'string' },
    },
    required: ['bestaetigt_vom_user', 'datum', 'ziel_weinausbau_id', 'quellen'],
  },
}

export async function fuehreVerschneidenAus(
  input: R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<R> {
  if (input?.bestaetigt_vom_user !== true) {
    return {
      erfolg: false,
      hinweis: 'Noch nicht bestätigt. Fasse die geplante Verschneidung (Ziel-Charge, alle ' +
        'Quellen mit Menge) in einer normalen Textnachricht zusammen und frage den User ' +
        'ausdrücklich um Bestätigung, bevor du dieses Tool erneut mit bestaetigt_vom_user=true ' +
        'aufrufst. Es wurde NICHTS gespeichert.',
    }
  }

  if (!input.datum || !input.ziel_weinausbau_id) {
    return { erfolg: false, hinweis: 'Datum und Ziel-Charge sind Pflichtfelder – bitte beim User nachfragen.' }
  }
  const quellenIn: R[] = Array.isArray(input.quellen) ? input.quellen : []
  if (quellenIn.length === 0) {
    return { erfolg: false, hinweis: 'Keine Quell-Charge angegeben. Mindestens eine Quelle mit Menge ist erforderlich.' }
  }
  for (const q of quellenIn) {
    if (!q.weinausbau_id || !(Number(q.menge_liter) > 0)) {
      return { erfolg: false, hinweis: 'Bei einer Quell-Position fehlt die weinausbau_id oder eine Menge > 0 L – bitte beim User nachfragen.' }
    }
  }

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) {
    return { erfolg: false, fehler: 'Kein Betrieb gefunden – Verschneidung konnte nicht gespeichert werden.' }
  }

  const { data: ziel, error: zielErr } = await (supabase.from('weinausbau') as any)
    .select('id').eq('id', input.ziel_weinausbau_id).eq('tenant_id', tenantId).eq('aktiv', true).maybeSingle()
  if (zielErr) return { erfolg: false, fehler: `Datenbankfehler: ${zielErr.message}` }
  if (!ziel) {
    return { erfolg: false, hinweis: `Ziel-Charge mit ID ${input.ziel_weinausbau_id} nicht gefunden. Beim User nachfragen bzw. Stammdaten-Kontext erneut prüfen.` }
  }

  const fd = new FormData()
  fd.set('datum', String(input.datum))
  fd.set('ziel_weinausbau_id', String(input.ziel_weinausbau_id))
  if (input.notizen) fd.set('notizen', String(input.notizen))
  fd.set('quellen_json', JSON.stringify(quellenIn.map(q => ({
    weinausbau_id: String(q.weinausbau_id), menge_liter: Number(q.menge_liter),
  }))))

  // KAN-83: zweite Stufe – der User hat die Rückfrage zur Prüfnummer bestätigt
  if (input.pruefnummer_verlust_bestaetigt === true) fd.set('pn_bestaetigt', '1')
  // KAN-193: dieselbe Zustimmung deckt die Rückfrage Rot/Weiß (Abstufung auf Wein aus Österreich) – sie steht in derselben Frage
  if (input.pruefnummer_verlust_bestaetigt === true) fd.set('rotweiss_bestaetigt', '1')

  try {
    const result = await createVerschneidung(fd)
    if ((result as R | undefined)?.bestaetigung) {
      return {
        erfolg: false,
        bestaetigung_noetig: true,
        hinweis: `Rückfrage an den User (wörtlich weitergeben): „${(result as R).bestaetigung}“ Nur wenn er ausdrücklich ` +
          'zustimmt, dieses Tool erneut mit pruefnummer_verlust_bestaetigt=true aufrufen. Es wurde NICHTS gespeichert.',
      }
    }
    return {
      erfolg: true,
      ziel_weinausbau_id: input.ziel_weinausbau_id,
      qualitaet_abgestuft: (result as R | undefined)?.qualitaetAbgestuft ?? null,
      herkunft_abgestuft: (result as R | undefined)?.herkunftAbgestuft ?? null,
      rot_weiss_abgestuft_auf_wein_oesterreich: (result as R | undefined)?.rotWeiss === true,   // KAN-193
    }
  } catch (err) {
    return { erfolg: false, fehler: (err as Error).message ?? String(err) }
  }
}
