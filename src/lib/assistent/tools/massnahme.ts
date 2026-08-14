// Tool "massnahme_dokumentieren" für den Prozess-Assistenten (Bot) – Phase 1
// Pilot. Bildet exakt die Felder der bestehenden FELD_MATRIX aus
// NeueBehandlungForm.tsx ab und ruft am Ende dieselbe Server Action
// (createBehandlung) mit denselben Parametern auf, die auch das Formular
// übergibt – siehe Konzeptdokument Abschnitt 8.
//
// Sicherheits-Hinweis: Der Bot speichert NIE ohne explizite User-Bestätigung
// (bestaetigt_vom_user). Das ist zusätzlich zur Anweisung im System-Prompt
// hier auch im Tool-Handler selbst hart durchgesetzt (siehe Konzeptdokument
// Abschnitt 6 "Sicherheit & Vertrauen").
import { createBehandlung } from '@/app/(dashboard)/behandlungen/actions'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const MASSNAHME_FELD_MATRIX_TEXT = `
FELD-MATRIX je Maßnahmenart (nur diese Felder abfragen – "pflicht" IMMER erfragen,
"bedingt" nur wenn zutreffend, "optional" nur wenn der User es von sich aus erwähnt):

- spritzung:        psm_id (pflicht), menge_gesamt (pflicht), aufwandmenge (pflicht),
                     bbch_stadium (pflicht), schaderreger (pflicht),
                     konzentration/wasseraufwand_l_ha/witterung/temperatur_c (optional)
- duengung:          duengemittel_id (optional), menge_gesamt (pflicht),
                     aufwandmenge/witterung (optional), einarbeitung (bedingt: nachfragen
                     ob eingearbeitet wurde, falls ja auch einarbeitung_zeitpunkt)
- bodenbearbeitung:  bearbeitungstiefe_cm (pflicht), bearbeitungsgeraet (pflicht),
                     witterung (optional)
- schnitt:           schnittart (pflicht)
- laubarbeit:        laubarbeit_art (pflicht, einer von: entblaettern, ausgeizen,
                     gipfeln, heften, sonstige), bbch_stadium (optional)
- sonstiges:         schaderreger (optional, hier als freie Beschreibung nutzbar)

Immer benötigt (unabhängig von der Art): datum, mindestens ein Grundstück oder eine
ganze Ried/Weingarten (weingarten_ids bzw. grundstueck_ids – IMMER die exakte ID aus
dem Stammdaten-Kontext verwenden, nie den Namen roh übergeben; bei Mehrdeutigkeit
nachfragen).
`.trim()

export const MASSNAHME_TOOL = {
  name: 'massnahme_dokumentieren',
  description:
    'Trägt eine Maßnahme (Spritzung, Düngung, Bodenbearbeitung, Schnitt, Laubarbeit ' +
    'oder Sonstiges) im Maßnahmenprotokoll ein. WICHTIG: Rufe dieses Tool ausschließlich ' +
    'MIT bestaetigt_vom_user=true auf, und das auch nur, nachdem du dem User in einer ' +
    'normalen Textnachricht eine Zusammenfassung der geplanten Eintragung gezeigt und er ' +
    'ausdrücklich zugestimmt hat (z.B. "ja", "passt", "ok"). Rufe es NIEMALS vorher auf ' +
    '(auch nicht testweise) – nutze bestaetigt_vom_user=false nur, falls du aus Versehen ' +
    'ohne Bestätigung aufrufst, was du aber vermeiden sollst.',
  input_schema: {
    type: 'object' as const,
    properties: {
      bestaetigt_vom_user: {
        type: 'boolean',
        description: 'true NUR wenn der User die Zusammenfassung in seiner letzten Nachricht ausdrücklich bestätigt hat.',
      },
      art: {
        type: 'string',
        enum: ['spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'sonstiges'],
      },
      datum: { type: 'string', description: 'Datum der Maßnahme, Format YYYY-MM-DD' },
      datum_bis: { type: 'string', description: 'Optional: Enddatum bei mehrtägigen Maßnahmen, YYYY-MM-DD' },
      weingarten_ids: { type: 'array', items: { type: 'string' }, description: 'IDs ganzer Rieden/Weingärten aus dem Stammdaten-Kontext' },
      grundstueck_ids: { type: 'array', items: { type: 'string' }, description: 'IDs einzelner Grundstücke aus dem Stammdaten-Kontext' },
      psm_id: { type: 'string', description: 'ID des Pflanzenschutzmittels aus dem Stammdaten-Kontext (nur bei Spritzung/Sonstiges)' },
      duengemittel_id: { type: 'string', description: 'ID des Düngemittels aus dem Stammdaten-Kontext (nur bei Düngung)' },
      menge_gesamt: { type: 'number', description: 'Gesamtmenge des Mittels' },
      menge_einheit: { type: 'string', enum: ['kg', 'l', 'g', 'ml'] },
      aufwandmenge: { type: 'number', description: 'Aufwandmenge pro Flächen-/Wassereinheit' },
      aufwandmenge_einheit: { type: 'string', enum: ['kg_ha', 'l_ha', 'g_hl', 'ml_hl', 'kg', 'l'] },
      konzentration: { type: 'number' },
      wasseraufwand_l_ha: { type: 'number' },
      bbch_stadium: { type: 'string', description: 'BBCH-Code, z.B. "61"' },
      schaderreger: { type: 'string' },
      witterung: { type: 'string', enum: ['sonnig', 'bewoelkt', 'regnerisch', 'wind'] },
      temperatur_c: { type: 'number' },
      bearbeitungstiefe_cm: { type: 'number' },
      bearbeitungsgeraet: { type: 'string' },
      schnittart: { type: 'string', description: 'Freitext, z.B. "Guyot", "Kordon"' },
      laubarbeit_art: { type: 'string', enum: ['entblaettern', 'ausgeizen', 'gipfeln', 'heften', 'sonstige'] },
      einarbeitung: { type: 'boolean', description: 'Nur bei Düngung: wurde eingearbeitet' },
      einarbeitung_zeitpunkt: { type: 'string', description: 'YYYY-MM-DD, nur falls einarbeitung=true' },
      notizen: { type: 'string' },
    },
    required: ['bestaetigt_vom_user', 'art', 'datum'],
  },
}

export async function fuehreMassnahmeDokumentierenAus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<R> {
  if (input?.bestaetigt_vom_user !== true) {
    return {
      erfolg: false,
      hinweis: 'Noch nicht bestätigt. Fasse die geplante Eintragung in einer normalen Textnachricht ' +
        'zusammen und frage den User ausdrücklich um Bestätigung, bevor du dieses Tool erneut mit ' +
        'bestaetigt_vom_user=true aufrufst. Es wurde NICHTS gespeichert.',
    }
  }

  const weingartenIds: string[] = Array.isArray(input.weingarten_ids) ? input.weingarten_ids : []
  const grundstueckIds: string[] = Array.isArray(input.grundstueck_ids) ? input.grundstueck_ids : []
  if (weingartenIds.length === 0 && grundstueckIds.length === 0) {
    return {
      erfolg: false,
      hinweis: 'Kein Grundstück/keine Ried angegeben. Beim User nachfragen, welches Grundstück bzw. ' +
        'welche Ried gemeint ist, und die exakte ID aus dem Stammdaten-Kontext verwenden.',
    }
  }
  if (!input.art || !input.datum) {
    return { erfolg: false, hinweis: 'Art und Datum sind Pflichtfelder – bitte beim User nachfragen.' }
  }

  // Wartezeit automatisch aus dem gewählten Mittel ableiten (wie im Formular –
  // dort kommt sie über ein verstecktes Feld aus der PSM-/Düngemittel-Auswahl).
  // pflanzenschutzmittel/duengemittel haben eine NULLABLE tenant_id: NULL = globaler
  // Katalogeintrag (system_admin), sonst eigener Mandanten-Eintrag – daher .or() statt
  // eines einfachen .eq(), analog zu kontext.ts.
  let wartezeitTage: number | null = null
  if (input.psm_id || input.duengemittel_id) {
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId ?? null
    if (!tenantId) {
      return { erfolg: false, fehler: 'Kein Betrieb gefunden – Maßnahme konnte nicht gespeichert werden.' }
    }
    if (input.psm_id) {
      const { data } = await (supabase.from('pflanzenschutzmittel') as any)
        .select('wartezeit_tage').eq('id', input.psm_id)
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`).maybeSingle()
      wartezeitTage = (data as R | null)?.wartezeit_tage ?? null
    } else if (input.duengemittel_id) {
      const { data } = await (supabase.from('duengemittel') as any)
        .select('wartezeit_tage').eq('id', input.duengemittel_id)
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`).maybeSingle()
      wartezeitTage = (data as R | null)?.wartezeit_tage ?? null
    }
  }

  const fd = new FormData()
  weingartenIds.forEach(id => fd.append('weingarten_ids', id))
  grundstueckIds.forEach(id => fd.append('grundstueck_ids', id))
  fd.set('art', String(input.art))
  fd.set('datum', String(input.datum))
  if (input.datum_bis) fd.set('datum_bis', String(input.datum_bis))
  if (input.psm_id) fd.set('psm_id', String(input.psm_id))
  if (input.duengemittel_id) fd.set('duengemittel_id', String(input.duengemittel_id))
  if (wartezeitTage != null) fd.set('wartezeit_tage', String(wartezeitTage))
  if (input.aufwandmenge != null) fd.set('aufwandmenge', String(input.aufwandmenge))
  if (input.aufwandmenge_einheit) fd.set('aufwandmenge_einheit', String(input.aufwandmenge_einheit))
  if (input.menge_gesamt != null) fd.set('menge_gesamt', String(input.menge_gesamt))
  if (input.menge_einheit) fd.set('menge_einheit', String(input.menge_einheit))
  if (input.konzentration != null) fd.set('konzentration', String(input.konzentration))
  if (input.wasseraufwand_l_ha != null) fd.set('wasseraufwand_l_ha', String(input.wasseraufwand_l_ha))
  if (input.bbch_stadium) fd.set('bbch_stadium', String(input.bbch_stadium))
  if (input.schaderreger) fd.set('schaderreger', String(input.schaderreger))
  if (input.witterung) fd.set('witterung', String(input.witterung))
  if (input.temperatur_c != null) fd.set('temperatur_c', String(input.temperatur_c))
  if (input.bearbeitungstiefe_cm != null) fd.set('bearbeitungstiefe_cm', String(input.bearbeitungstiefe_cm))
  if (input.bearbeitungsgeraet) fd.set('bearbeitungsgeraet', String(input.bearbeitungsgeraet))
  if (input.schnittart) fd.set('schnittart', String(input.schnittart))
  if (input.laubarbeit_art) fd.set('laubarbeit_art', String(input.laubarbeit_art))
  if (input.einarbeitung) fd.set('einarbeitung', 'on')
  if (input.einarbeitung_zeitpunkt) fd.set('einarbeitung_zeitpunkt', String(input.einarbeitung_zeitpunkt))
  if (input.notizen) fd.set('notizen', String(input.notizen))

  try {
    const result = await createBehandlung(fd)
    return { erfolg: true, behandlung_id: (result as R | undefined)?.id ?? null }
  } catch (err) {
    return { erfolg: false, fehler: (err as Error).message ?? String(err) }
  }
}
