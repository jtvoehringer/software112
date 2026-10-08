// Tool "massnahme_dokumentieren" für den Prozess-Assistenten (Bot) – Phase 1
// Pilot. Bildet exakt die Felder der bestehenden FELD_MATRIX aus
// behandlungen/neu/feldMatrix.ts ab und ruft am Ende dieselbe Server Action
// (createBehandlung) mit denselben Parametern auf, die auch das Formular
// übergibt – siehe Konzeptdokument Abschnitt 8.
//
// Sicherheits-Hinweis: Der Bot speichert NIE ohne explizite User-Bestätigung
// (bestaetigt_vom_user). Das ist zusätzlich zur Anweisung im System-Prompt
// hier auch im Tool-Handler selbst hart durchgesetzt (siehe Konzeptdokument
// Abschnitt 6 "Sicherheit & Vertrauen").
//
// KAN-133 (26.09.2026): Bei einer Spritzung ist menge_gesamt die gesamte Spritzbrühe in Litern, NICHT die
// Mittelmenge (die kommt nur aus dem Aufwand); bei einer Düngung die Düngermenge in kg (bei Düngemitteln
// in Litern in l; ohne menge_einheit gilt die Einheit des Düngemittels). Vor dem Aufruf
// prüft das Tool die Mengen mit derselben Regel wie Formular und Server (pruefeMassnahmeMengen, hier mit
// Pflicht Spritzbrühe oder Wasseraufwand); createBehandlung prüft noch einmal mit der Fläche der
// gewählten Grundstücke und ergänzt die Spritzbrühe aus l/ha × Fläche.
//
// KAN-143 (26.09.2026): neue Art „laubschneiden“ (maschinelles Laubschneiden an Seiten und Gipfel, ohne
// laubarbeit_art). Arten und Bezeichnungen aus lib/behandlungen/arten.ts; eine unbekannte Art lehnt das
// Tool vor dem Speichern ab, laubarbeit_art geht nur bei einer Laubarbeit mit (dort Pflicht).
//
// KAN-154 (27.09.2026): Sonstiges optional mit Pflanzenschutzmittel (samt Aufwand), Bearbeitungstiefe optional,
// einarbeitung=false bleibt false.
//
// KAN-155 (28.09.2026): BBCH-Stadium und Schaderreger bei der Spritzung optional; bei kg_ha/l_ha ergibt sich der
// Wasseraufwand ohne Spritzbrühe und Wasseraufwand aus Aufwand und Konzentration (Aufwand ÷ Konzentration × 100).
//
// KAN-87 (05.10.2026): Anwender (Mitglied über den Namen, sonst Fremdanwender; ohne Angabe der angemeldete Benutzer),
// Start-/Enduhrzeit (Pflicht bei bienengefährlichen Mitteln – prüft createBehandlung) und Art der Verwendung; den
// Hinweis „Nacherfassung (+n h)“ liefert createBehandlung in hinweise.
import { createBehandlung } from '@/app/(dashboard)/behandlungen/actions'
import { BIENENSCHUTZ_FELD } from '@/lib/behandlungen/bienenschutz'
import { getCurrentMembership } from '@/lib/auth/roles'
import { dezimal } from '@/lib/format'
import { AUFWAND_EINHEITEN, pruefeMassnahmeMengen } from '@/lib/behandlungen/massnahmeMengen'
import {
  LAUBARBEIT_OPTIONEN, MASSNAHMEN_ARTEN, MASSNAHMEN_ART_LABEL, istMassnahmenArt, laubarbeitArtFehlt, laubarbeitArtFuer,
} from '@/lib/behandlungen/arten'
import { EINARBEITUNG_GESENDET } from '@/app/(dashboard)/behandlungen/neu/feldMatrix'
import { ART_VERWENDUNG, anwenderZuordnen } from '@/lib/behandlungen/erfassungsfrist'
import { ladeMandantMitglieder } from '@/lib/aufgaben/mitglieder'

/** „Spritzung, Düngung, …, Laubschneiden oder Sonstiges“ – für die Tool-Beschreibung (die Rückfrage bei
 *  unbekannter Art nennt bewusst die Codes, die das Tool erwartet: MASSNAHMEN_ARTEN) */
const ARTEN_TEXT = MASSNAHMEN_ARTEN.map(a => MASSNAHMEN_ART_LABEL[a]).join(', ').replace(/, ([^,]*)$/, ' oder $1')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const MASSNAHME_FELD_MATRIX_TEXT = `
FELD-MATRIX je Maßnahmenart (nur diese Felder abfragen – "pflicht" IMMER erfragen,
"bedingt" nur wenn zutreffend, "optional" nur wenn der User es von sich aus erwähnt):

- spritzung:        psm_id (pflicht), aufwandmenge + aufwandmenge_einheit (pflicht),
                     Spritzbrühe (pflicht: menge_gesamt = gesamte Spritzbrühe in Litern ODER
                     wasseraufwand_l_ha = Spritzbrühe je ha – eines davon reicht; bei kg_ha/l_ha
                     genügt stattdessen konzentration in %),
                     bbch_stadium/schaderreger/konzentration/witterung/temperatur_c (optional)
- duengung:          duengemittel_id (optional), menge_gesamt = Düngermenge in kg bzw. in l bei
                     Düngemitteln in Litern (pflicht),
                     aufwandmenge/witterung (optional), einarbeitung (bedingt: nachfragen
                     ob eingearbeitet wurde, falls ja auch einarbeitung_zeitpunkt)
- bodenbearbeitung:  bearbeitungsgeraet (pflicht), bearbeitungstiefe_cm (optional – Mulchen
                     und Mähen haben keine Tiefe), witterung (optional)
- schnitt:           schnittart (pflicht)
- laubarbeit:        laubarbeit_art (pflicht, einer von: entblaettern, ausgeizen,
                     gipfeln, heften, sonstige), bbch_stadium (optional)
- laubschneiden:     bbch_stadium (optional); KEIN laubarbeit_art. Laubschneiden = maschinelles
                     Laubschneiden an Seiten und Gipfel (Laubschneider, Laubschnitt mit dem Traktor).
                     Gipfeln von Hand ist dagegen laubarbeit mit laubarbeit_art gipfeln – bei
                     "Gipfeln" ohne Hinweis auf Maschine oder Hand kurz nachfragen.
- sonstiges:         schaderreger (optional, hier als freie Beschreibung nutzbar),
                     psm_id (optional, z. B. Pheromon-Dispenser), aufwandmenge + aufwandmenge_einheit
                     (optional, nur mit psm_id; kg_ha, l_ha, kg oder l – nur damit bucht das Lager ab)

MENGEN – GANZ WICHTIG:
- Spritzung: menge_gesamt ist die gesamte SPRITZBRÜHE (Mittel + Wasser) in Litern, NICHT die
  Mittelmenge – nie die Menge des Pflanzenschutzmittels dort eintragen, nie kg oder g. Die
  Mittelmenge ergibt software:112 nur aus dem Aufwand: kg_ha/l_ha × Fläche, kg/l gesamt oder
  g_hl/ml_hl (= Konzentration im Tank, die tatsächliche Konzentration in der Brühe) × Spritzbrühe
  (l) ÷ 100. Nennt der User nur l/ha, übergib wasseraufwand_l_ha – die Spritzbrühe gesamt rechnet
  das System als l/ha × Fläche der gewählten Grundstücke. Beispiel: "0,6 kg Funguran je ha,
  400 l Wasser je ha" → aufwandmenge 0.6, aufwandmenge_einheit kg_ha, wasseraufwand_l_ha 400.
  Nennt der User Aufwand je ha und Konzentration in %, reicht das: aufwandmenge + konzentration ergeben
  den Wasseraufwand (Aufwand ÷ Konzentration × 100). Beispiel: "2 l/ha mit 0,5 %" → aufwandmenge 2,
  aufwandmenge_einheit l_ha, konzentration 0.5 (= 400 l/ha, bei 1,5 ha 600 l Spritzbrühe).
  Tankmischung (mehrere Mittel in einem Tank): je Mittel eine eigene Maßnahme mit derselben
  Spritzbrühe.
- Düngung: menge_gesamt ist die Düngermenge in der Einheit des Düngemittels: kg (menge_einheit kg),
  bei Düngemitteln, die in Litern geführt werden (im Stammdaten-Kontext mit "in Litern" markiert),
  in l (menge_einheit l) – dort werden kg/g abgelehnt, ohne Dichte keine Umrechnung. g_hl und ml_hl
  gibt es bei Düngungen nicht.
- In der Zusammenfassung vor dem Speichern bei einer Spritzung Mittel, Aufwand (z.B. 0,6 kg/ha) und
  Spritzbrühe (z.B. 800 l bzw. 400 l/ha) getrennt nennen – die Spritzbrühe nie als Mittelmenge.
- Liefert das Tool "hinweise" zurück (z.B. Spritzbrühe weicht von l/ha × Fläche ab), teile sie dem
  User in der Antwort mit.

PFLANZENSCHUTZ-AUFZEICHNUNG (KAN-87, bei Maßnahmen mit psm_id):
- uhrzeit_von (Startuhrzeit, HH:MM) ist Pflicht bei bienengefährlichen Mitteln (im Stammdaten-Kontext markiert),
  sonst optional; uhrzeit_bis (Ende) optional – ab dem Ende läuft die Erfassungsfrist (Standard 24 h).
- Bienenschutz (KAN-171): bienengefährliches Mittel mit BBCH 60–69 (Blüte) – den User ausdrücklich fragen, ob die
  Bienenschutz-Auflagen eingehalten wurden (keine blühenden Pflanzen bzw. blühender Unterwuchs, außerhalb des
  Bienenflugs); nur bei klarem Ja bienenschutz_bestaetigt: true, sonst nicht anlegen.
- anwender: wer gespritzt hat – ohne Angabe der angemeldete Benutzer; ein Mitglied über seinen Namen, sonst
  (Lohnunternehmer, Nachbar) der Name als Fremdanwender.
- art_verwendung: Standard freiland, sonst nur, wenn der User es erwähnt.
- Meldet das Tool in "hinweise" eine Nacherfassung (+n h), dem User mitteilen (gespeichert ist trotzdem).

Immer benötigt (unabhängig von der Art): datum, mindestens ein Grundstück oder eine
ganze Ried/Weingarten (weingarten_ids bzw. grundstueck_ids – IMMER die exakte ID aus
dem Stammdaten-Kontext verwenden, nie den Namen roh übergeben; bei Mehrdeutigkeit
nachfragen).
`.trim()

export const MASSNAHME_TOOL = {
  name: 'massnahme_dokumentieren',
  description:
    `Trägt eine Maßnahme (${ARTEN_TEXT}) im Maßnahmenprotokoll ein. WICHTIG: Rufe dieses Tool ausschließlich ` +
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
        enum: [...MASSNAHMEN_ARTEN],
        description: 'laubschneiden = maschinelles Laubschneiden an Seiten und Gipfel (ohne laubarbeit_art); ' +
          'Gipfeln von Hand = laubarbeit mit laubarbeit_art gipfeln.',
      },
      datum: { type: 'string', description: 'Datum der Maßnahme, Format YYYY-MM-DD' },
      datum_bis: { type: 'string', description: 'Optional: Enddatum bei mehrtägigen Maßnahmen, YYYY-MM-DD' },
      weingarten_ids: { type: 'array', items: { type: 'string' }, description: 'IDs ganzer Rieden/Weingärten aus dem Stammdaten-Kontext' },
      grundstueck_ids: { type: 'array', items: { type: 'string' }, description: 'IDs einzelner Grundstücke aus dem Stammdaten-Kontext' },
      psm_id: { type: 'string', description: 'ID des Pflanzenschutzmittels aus dem Stammdaten-Kontext (nur bei Spritzung/Sonstiges)' },
      duengemittel_id: { type: 'string', description: 'ID des Düngemittels aus dem Stammdaten-Kontext (nur bei Düngung)' },
      menge_gesamt: {
        type: 'number',
        description: 'Spritzung: menge_gesamt = gesamte Spritzbrühe in Litern (Mittel + Wasser), NICHT die Mittelmenge. ' +
          'Düngung: Düngermenge in kg bzw. in l bei Düngemitteln in Litern. Bei Spritzung alternativ nur wasseraufwand_l_ha angeben.',
      },
      menge_einheit: {
        type: 'string', enum: ['l', 'ml', 'kg', 'g'],
        description: 'Einheit von menge_gesamt – Spritzung: l (ml wird in l umgerechnet, kg/g werden abgelehnt); ' +
          'Düngung: kg (g wird in kg umgerechnet), bei Düngemitteln in Litern nur l (ml wird in l umgerechnet); ohne Angabe gilt die Einheit des Düngemittels.',
      },
      aufwandmenge: {
        type: 'number',
        description: 'Aufwand des Mittels (bei Spritzung Pflicht) – daraus ergibt sich die Mittelmenge.',
      },
      aufwandmenge_einheit: {
        type: 'string', enum: [...AUFWAND_EINHEITEN],
        description: 'kg_ha/l_ha = je Hektar, kg/l = gesamt für alle gewählten Flächen, g_hl/ml_hl = Konzentration im Tank ' +
          '(tatsächliche Konzentration in der Spritzbrühe, nur bei Spritzung).',
      },
      konzentration: {
        type: 'number',
        description: 'Optional, Konzentration in % – fließt nicht in die Mittelmenge ein. Bei kg_ha/l_ha ohne menge_gesamt und ' +
          'wasseraufwand_l_ha ergibt sich daraus der Wasseraufwand (Aufwand ÷ Konzentration × 100). Nennt der User nur %, ' +
          'nach dem Aufwand je ha oder der Konzentration im Tank (g/hl bzw. ml/hl) fragen.',
      },
      wasseraufwand_l_ha: {
        type: 'number',
        description: 'Nur Spritzung: Spritzbrühe je Hektar in l/ha. Reicht statt menge_gesamt – die Spritzbrühe gesamt wird dann ' +
          'als l/ha × Fläche der gewählten Grundstücke berechnet.',
      },
      bbch_stadium: { type: 'string', description: 'BBCH-Code, z.B. "61"' },
      schaderreger: { type: 'string' },
      witterung: { type: 'string', enum: ['sonnig', 'bewoelkt', 'regnerisch', 'wind'] },
      temperatur_c: { type: 'number' },
      bearbeitungstiefe_cm: { type: 'number' },
      bearbeitungsgeraet: { type: 'string' },
      schnittart: { type: 'string', description: 'Freitext, z.B. "Guyot", "Kordon"' },
      laubarbeit_art: {
        type: 'string', enum: LAUBARBEIT_OPTIONEN.map(o => o.value),
        description: 'Nur bei art laubarbeit (bei laubschneiden und allen anderen Arten weglassen).',
      },
      einarbeitung: { type: 'boolean', description: 'Nur bei Düngung: wurde eingearbeitet' },
      einarbeitung_zeitpunkt: { type: 'string', description: 'YYYY-MM-DD, nur falls einarbeitung=true' },
      notizen: { type: 'string' },
      uhrzeit_von: { type: 'string', description: 'Startuhrzeit der Anwendung, HH:MM (Wiener Zeit) – Pflicht bei bienengefährlichen Mitteln' },
      uhrzeit_bis: { type: 'string', description: 'Optional: Ende der Anwendung, HH:MM (am Tag datum_bis bzw. datum)' },
      bienenschutz_bestaetigt: { type: 'boolean', description: 'KAN-171: nur bei bienengefährlichem Mittel in der Blüte (BBCH 60–69) und nur nach ausdrücklichem Ja des Users, dass die Bienenschutz-Auflagen eingehalten wurden' },
      anwender: { type: 'string', description: 'Optional: Name des Anwenders – Mitglied des Betriebs oder Fremdanwender; ohne Angabe der angemeldete Benutzer' },
      art_verwendung: { type: 'string', enum: [...ART_VERWENDUNG], description: 'Nur mit psm_id: Art der Verwendung, Standard freiland' },
    },
    required: ['bestaetigt_vom_user', 'art', 'datum'],
  },
}

export async function fuehreMassnahmeDokumentierenAus(
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
  if (!istMassnahmenArt(input.art)) {
    return {
      erfolg: false,
      hinweis: `Unbekannte Maßnahmenart „${String(input.art)}“ – erlaubt: ${MASSNAHMEN_ARTEN.join(', ')}. ` +
        'Bitte beim User nachfragen, welche Art gemeint ist. Es wurde NICHTS gespeichert.',
    }
  }
  // Laubarbeit ohne Unterart lehnt auch createBehandlung ab – hier mit Rückfrage statt Fehler
  if (laubarbeitArtFehlt(input.art, input.laubarbeit_art ? String(input.laubarbeit_art) : null)) {
    return {
      erfolg: false,
      hinweis: `Bei einer Laubarbeit ist laubarbeit_art Pflicht (${LAUBARBEIT_OPTIONEN.map(o => o.value).join(', ')}). ` +
        'Bitte beim User nachfragen. Es wurde NICHTS gespeichert.',
    }
  }

  // Wartezeit automatisch aus dem gewählten Mittel ableiten (wie im Formular –
  // dort kommt sie über ein verstecktes Feld aus der PSM-/Düngemittel-Auswahl).
  // pflanzenschutzmittel/duengemittel haben eine NULLABLE tenant_id: NULL = globaler
  // Katalogeintrag (system_admin), sonst eigener Mandanten-Eintrag – daher .or() statt
  // eines einfachen .eq(), analog zu kontext.ts.
  let wartezeitTage: number | null = null
  let duengemittelEinheit: string | null = null
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
        .select('wartezeit_tage, einheit').eq('id', input.duengemittel_id)
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`).maybeSingle()
      wartezeitTage = (data as R | null)?.wartezeit_tage ?? null
      duengemittelEinheit = (data as R | null)?.einheit ?? null
    }
  }

  // Mengen vorab mit der gemeinsamen Regel prüfen (KAN-133) – ohne Fläche, die kennt erst
  // createBehandlung (Σ der gewählten WI-GST); anders als der Server mit Pflicht Spritzbrühe oder
  // Wasseraufwand, wie im Formular.
  const vorab = pruefeMassnahmeMengen({
    art: String(input.art),
    psmId: input.psm_id ? String(input.psm_id) : null,
    duengemittelId: input.duengemittel_id ? String(input.duengemittel_id) : null,
    duengemittelEinheit,
    aufwand: zahl(input.aufwandmenge),
    aufwandEinheit: input.aufwandmenge_einheit ? String(input.aufwandmenge_einheit) : null,
    mengeGesamt: zahl(input.menge_gesamt),
    mengeEinheit: input.menge_einheit ? String(input.menge_einheit) : null,
    wasserLHa: zahl(input.wasseraufwand_l_ha), konzentrationPct: zahl(input.konzentration),
    flaecheHa: null,
  }, { bruehePflicht: true })
  if (!vorab.ok) {
    return {
      erfolg: false,
      hinweis: `${vorab.fehler} Bitte beim User nachfragen bzw. die Angaben korrigieren und die Zusammenfassung ` +
        'erneut bestätigen lassen. Es wurde NICHTS gespeichert.',
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
  if (input.aufwandmenge != null) fd.set('aufwandmenge', formZahl(input.aufwandmenge))
  if (input.aufwandmenge_einheit) fd.set('aufwandmenge_einheit', String(input.aufwandmenge_einheit))
  if (input.menge_gesamt != null) fd.set('menge_gesamt', formZahl(input.menge_gesamt))
  if (input.menge_einheit) fd.set('menge_einheit', String(input.menge_einheit))
  if (input.konzentration != null) fd.set('konzentration', formZahl(input.konzentration))
  if (input.wasseraufwand_l_ha != null) fd.set('wasseraufwand_l_ha', formZahl(input.wasseraufwand_l_ha))
  if (input.bbch_stadium) fd.set('bbch_stadium', String(input.bbch_stadium))
  if (input.bienenschutz_bestaetigt === true) fd.set(BIENENSCHUTZ_FELD, '1')   // KAN-171
  if (input.schaderreger) fd.set('schaderreger', String(input.schaderreger))
  if (input.witterung) fd.set('witterung', String(input.witterung))
  if (input.temperatur_c != null) fd.set('temperatur_c', String(input.temperatur_c))
  if (input.bearbeitungstiefe_cm != null) fd.set('bearbeitungstiefe_cm', String(input.bearbeitungstiefe_cm))
  if (input.bearbeitungsgeraet) fd.set('bearbeitungsgeraet', String(input.bearbeitungsgeraet))
  if (input.schnittart) fd.set('schnittart', String(input.schnittart))
  // laubarbeit_art nur bei einer Laubarbeit (bei Laubschneiden null, KAN-143)
  const laubarbeitArt = laubarbeitArtFuer(input.art, input.laubarbeit_art ? String(input.laubarbeit_art) : null)
  if (laubarbeitArt) fd.set('laubarbeit_art', laubarbeitArt)
  // KAN-154: ausdrücklich „nicht eingearbeitet“ bleibt false (einarbeitung_gesendet), ohne Angabe null
  if (typeof input.einarbeitung === 'boolean') fd.set(EINARBEITUNG_GESENDET, '1')
  if (input.einarbeitung) fd.set('einarbeitung', 'on')
  if (input.einarbeitung_zeitpunkt) fd.set('einarbeitung_zeitpunkt', String(input.einarbeitung_zeitpunkt))
  if (input.notizen) fd.set('notizen', String(input.notizen))
  // KAN-87: Uhrzeit, Art der Verwendung, Anwender
  if (input.uhrzeit_von) fd.set('uhrzeit_von', String(input.uhrzeit_von))
  if (input.uhrzeit_bis) fd.set('uhrzeit_bis', String(input.uhrzeit_bis))
  if (input.art_verwendung) fd.set('art_verwendung', String(input.art_verwendung))
  if (input.anwender) {
    const membership = await getCurrentMembership()
    const a = anwenderZuordnen(input.anwender, membership ? await ladeMandantMitglieder(membership.tenantId) : [])
    fd.set('anwender', a.anwender)
    if (a.anwenderName) fd.set('anwender_name', a.anwenderName)
  }

  try {
    const result = await createBehandlung(fd)
    const hinweise = result?.hinweise ?? []
    return { erfolg: true, behandlung_id: result?.id ?? null, ...(hinweise.length > 0 ? { hinweise } : {}) }
  } catch (err) {
    return { erfolg: false, fehler: (err as Error).message ?? String(err) }
  }
}

/**
 * Zahl aus dem Tool-Aufruf als Formulartext mit Dezimalkomma: createBehandlung liest mit dezimal(), und
 * dort wäre „1.125“ ein Tausenderpunkt (1.125 kg/ha → 1125 kg/ha).
 */
function formZahl(v: unknown): string {
  return typeof v === 'number' ? String(v).replace('.', ',') : String(v)
}

/** Zahl aus dem Tool-Aufruf, gelesen wie in createBehandlung; leer = null, ungültig = NaN (meldet die Prüfung) */
function zahl(v: unknown): number | null {
  if (v == null || v === '') return null
  const t = dezimal(formZahl(v))
  return t ? Number(t) : null
}
