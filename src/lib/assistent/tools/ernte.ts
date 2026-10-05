// Tool "ernte_erfassen" für den Prozess-Assistenten (Bot) – Phase 3.
//
// Deckt die Mehrfacherfassung von Lesedaten ab (Abstimmung mit dem User):
// sowohl ganze Rieden (Menge wird proportional nach Fläche auf die einzelnen
// Grundstücke aufgeteilt, wie im bestehenden Formular) als auch einzelne
// Grundstücke mit individuellen Werten (Menge/Mostgewicht/Notizen je Grundstück).
// Fehlt der Weinjahrgang für das angegebene Erntejahr noch, legt der Bot ihn
// im selben bestätigten Schritt automatisch an (Abstimmung mit dem User).
//
// Ruft am Ende dieselben Server Actions (createJahrgang, falls nötig, dann
// createMultipleErnteParzellen) mit denselben Parametern auf, die auch das
// bestehende Formular übergibt – siehe massnahme.ts/verkauf.ts für dasselbe
// Muster.
//
// Sicherheits-Hinweis: Der Bot speichert NIE ohne explizite User-Bestätigung
// (bestaetigt_vom_user), analog zu den anderen Prozessen.
import { createJahrgang, createMultipleErnteParzellen } from '@/app/(dashboard)/erntemeldung/actions'
import { getCurrentMembership } from '@/lib/auth/roles'
import { LESE_QUALITAETEN, qualitaetFehler } from '@/lib/wein/qualitaet'
import { messwertText, mostgewichtAusWert } from '@/lib/wein/mostgewichtFormular'
import { lesenZumDatum, leseTitel, leseZeitraumText } from '@/lib/wein/lesen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-73: erlaubte Qualitätsstufen der Lese (= CHECK ernte_parzellen) für Schema und Feld-Matrix
const LESE_WERTE = LESE_QUALITAETEN.map(o => o.value)
const LESE_WERTE_TEXT = LESE_QUALITAETEN.map(o => `${o.value} (${o.label})`).join(', ')

export const ERNTE_FELD_MATRIX_TEXT = `
FELD-MATRIX für "Ernte erfassen":

Gemeinsame Felder: jahrgang (pflicht, Erntejahr als Zahl z.B. 2026 – der JAHRGANG, nicht das Kalenderjahr:
eine Eiswein-Lese im Jänner 2027 gehört zum Jahrgang 2026; existiert dafür noch kein Weinjahrgang-Datensatz,
wird er automatisch mit angelegt), ernte_datum (pflicht, YYYY-MM-DD),
lese_nr (Nummer der Lese im Jahrgang, z. B. 2 für „2026/2 Eiswein“ – siehe WEINJAHRGÄNGE im Kontext; Pflicht,
sobald der Jahrgang mehrere Lesen hat und das Datum nicht in genau eine fällt. Eine neue Lese legt der Bot nicht
an – der User legt sie unter „Lese › Neue Lese“ an),
lesemethode (optional: handlese/maschinenlese/selektionslese), gemeinsames Mostgewicht (PFLICHT, außer jedes
Grundstück hat ein eigenes – ohne Mostgewicht wird nichts gespeichert, auch nicht bei Lesegut, das später als
Trauben verkauft wird; fehlt es, beim User nachfragen)
ENTWEDER klosterneuburger (in °KMW, höchstens 2 Nachkommastellen, 0–60) ODER oechsle (in °Oe,
höchstens 1 Nachkommastelle, 0–350) – genau in der Einheit, die der User nennt, nie selbst
umrechnen und nie beide angeben; gespeichert wird der Messwert mit seiner Einheit, der andere Wert
wird umgerechnet. Die Zusammenfassung zur Bestätigung nennt jedes Mostgewicht mit der Einheit, in
der der User es genannt hat (z. B. „17,4 °KMW“ bzw. „84 °Oe“) – so bestätigt er auch die Einheit.
qualitaetsstufe (optional – wird derzeit NICHT übernommen: die Stufe
wird immer aus den °KMW abgeleitet (bei °Oe aus dem umgerechneten °KMW), ohne Mostgewicht gilt
qualitaetswein; in einer Lese der Art Eiswein ist die Stufe automatisch Eiswein (unter 25 °KMW darauf
hinweisen); eine andere Stufe stellt der User nach dem Speichern beim Bearbeiten der Lese ein – darauf hinweisen.
Angegeben werden dürfen nur diese Lese-Stufen: ${LESE_WERTE_TEXT} – DAC, Reserve, Erste Lage,
Großes Gewächs, Sekt, Perlwein, Sonstiges, Strohwein und Ausbruch gibt es bei der Lese nicht),
notizen (optional).

Mindestens EINE der beiden folgenden Positions-Arten ist erforderlich (auch kombiniert möglich):
- "rieden": Array von weingarten_ids (ganze Rieden aus dem Stammdaten-Kontext) + EINE
  gemeinsame menge_kg_gesamt (PFLICHT, größer als 0) für alle hier gelisteten Rieden zusammen (wird automatisch
  proportional nach Grundstücksfläche aufgeteilt – für Rieden mit unterschiedlichen,
  einzeln bekannten Erntemengen lieber getrennte Tool-Aufrufe machen oder stattdessen
  "grundstuecke" mit Einzelwerten verwenden).
- "grundstuecke": Array einzelner Positionen {grundstueck_id (pflicht, ID aus dem
  Stammdaten-Kontext), menge_kg (pflicht – die tatsächlich gewogene Menge dieses
  Grundstücks), Mostgewicht (ENTWEDER kmw in °KMW ODER oechsle in °Oe – überschreibt das
  gemeinsame Mostgewicht für dieses Grundstück; Pflicht, wenn es kein gemeinsames gibt), notizen (optional, überschreibt die
  gemeinsamen notizen für dieses Grundstück)}.
`.trim()

export const ERNTE_TOOL = {
  name: 'ernte_erfassen',
  description:
    'Erfasst Lesedaten (Ernte) für eine oder mehrere ganze Rieden und/oder einzelne ' +
    'Grundstücke eines Erntejahrs. Legt bei Bedarf automatisch den passenden Weinjahrgang an. ' +
    'WICHTIG: Rufe dieses Tool ausschließlich MIT bestaetigt_vom_user=true auf, und das auch ' +
    'nur, nachdem du dem User in einer normalen Textnachricht eine Zusammenfassung aller ' +
    'Positionen gezeigt hast – Jahrgang, Datum, Rieden/Grundstücke mit Mengen und jedes ' +
    'Mostgewicht mit der Einheit, in der er es genannt hat (z. B. „Mostgewicht 17,4 °KMW“ ' +
    'bzw. „Mostgewicht 84 °Oe“) – und er ausdrücklich zugestimmt hat (z.B. "ja", "passt", "ok"). Rufe es ' +
    'NIEMALS vorher auf (auch nicht testweise) – nutze bestaetigt_vom_user=false nur, falls du ' +
    'aus Versehen ohne Bestätigung aufrufst, was du aber vermeiden sollst.',
  input_schema: {
    type: 'object' as const,
    properties: {
      bestaetigt_vom_user: {
        type: 'boolean',
        description: 'true NUR wenn der User die Zusammenfassung in seiner letzten Nachricht ausdrücklich bestätigt hat.',
      },
      jahrgang: { type: 'number', description: 'Erntejahr, z.B. 2026' },
      ernte_datum: { type: 'string', description: 'Datum der Lese, Format YYYY-MM-DD' },
      lese_nr: { type: 'number', description: 'Nummer der Lese im Jahrgang (z. B. 2 für 2026/2) – nötig, wenn der Jahrgang mehrere Lesen hat und das Datum nicht eindeutig zu einer passt' },
      lesemethode: { type: 'string', enum: ['handlese', 'maschinenlese', 'selektionslese'] },
      klosterneuburger: { type: 'number', description: 'Gemeinsames Mostgewicht in °KMW (optional; nicht zusammen mit oechsle)' },
      oechsle: { type: 'number', description: 'Gemeinsames Mostgewicht in °Oe (optional, höchstens 1 Nachkommastelle; nicht zusammen mit klosterneuburger)' },
      qualitaetsstufe: {
        type: 'string',
        enum: LESE_WERTE,
        description: `Wird derzeit nicht übernommen – die Stufe ergibt sich aus den °KMW (ohne KMW: qualitaetswein); eine andere Stufe stellt der User beim Bearbeiten der Lese ein. Nur Lese-Stufen: ${LESE_WERTE_TEXT}`,
      },
      notizen: { type: 'string' },
      rieden: {
        type: 'object',
        description: 'Ganze Rieden mit optional einer gemeinsamen Gesamtmenge.',
        properties: {
          weingarten_ids: { type: 'array', items: { type: 'string' }, description: 'IDs ganzer Rieden/Weingärten aus dem Stammdaten-Kontext' },
          menge_kg_gesamt: { type: 'number', description: 'Gemeinsame Gesamtmenge für alle oben gelisteten Rieden (wird proportional nach Fläche aufgeteilt)' },
        },
      },
      grundstuecke: {
        type: 'array',
        description: 'Einzelne Grundstücke mit individuellen Werten.',
        items: {
          type: 'object',
          properties: {
            grundstueck_id: { type: 'string', description: 'ID aus dem Stammdaten-Kontext' },
            menge_kg: { type: 'number' },
            kmw: { type: 'number', description: 'Mostgewicht in °KMW (nicht zusammen mit oechsle)' },
            oechsle: { type: 'number', description: 'Mostgewicht in °Oe (nicht zusammen mit kmw)' },
            notizen: { type: 'string' },
          },
          required: ['grundstueck_id', 'menge_kg'],
        },
      },
    },
    required: ['bestaetigt_vom_user', 'jahrgang', 'ernte_datum'],
  },
}

/**
 * Mostgewicht-Parameter des Tools (KAN-128): °KMW ODER °Oe (Zahl, auch „17,4“ als Text). Prüft wie
 * das Formular (mostgewichtAusWert: Stellen, Bereich) und liefert Messwert + Einheit für die Action –
 * oder einen Hinweis an den Bot.
 */
type MostgewichtParameter = { wert: string | null; einheit: 'kmw' | 'oechsle' | null }
function mostgewichtParameter(
  kmw: unknown,
  oechsle: unknown,
  bezeichnung: string,
): MostgewichtParameter | { hinweis: string } {
  const hatKmw = kmw !== null && kmw !== undefined && kmw !== ''
  const hatOe = oechsle !== null && oechsle !== undefined && oechsle !== ''
  if (hatKmw && hatOe) {
    return { hinweis: `${bezeichnung}: bitte nur EINEN Messwert angeben – °KMW oder °Oe, so wie gemessen. Beim User nachfragen, in welcher Einheit gemessen wurde. Es wurde NICHTS gespeichert.` }
  }
  if (!hatKmw && !hatOe) return { wert: null, einheit: null }
  const einheit = hatKmw ? 'kmw' : 'oechsle'
  const roh = hatKmw ? kmw : oechsle
  const pruefung = mostgewichtAusWert(roh, einheit, bezeichnung)
  if (!pruefung.ok) return { hinweis: `${pruefung.fehler} Bitte beim User nachfragen. Es wurde NICHTS gespeichert.` }
  return pruefung.wert ? { wert: messwertText(pruefung.wert), einheit } : { wert: null, einheit: null }
}

export async function fuehreErnteErfassenAus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<R> {
  if (input?.bestaetigt_vom_user !== true) {
    return {
      erfolg: false,
      hinweis: 'Noch nicht bestätigt. Fasse die geplante Eintragung (Jahrgang, Datum, alle ' +
        'Rieden/Grundstücke mit Mengen, jedes Mostgewicht mit Einheit wie vom User genannt – ' +
        'z. B. „17,4 °KMW“ bzw. „84 °Oe“) in einer normalen Textnachricht zusammen und frage den ' +
        'User ausdrücklich um Bestätigung, bevor du dieses Tool erneut mit ' +
        'bestaetigt_vom_user=true aufrufst. Es wurde NICHTS gespeichert.',
    }
  }

  const jahrgangJahr = Number(input.jahrgang)
  if (!jahrgangJahr || !input.ernte_datum) {
    return { erfolg: false, hinweis: 'Jahrgang (Erntejahr) und Datum sind Pflichtfelder – bitte beim User nachfragen.' }
  }
  // KAN-73: vor dem Anlegen des Jahrgangs prüfen (createMultipleErnteParzellen prüft ebenfalls)
  const qualitaetUnzulaessig = qualitaetFehler('lese', input.qualitaetsstufe ? String(input.qualitaetsstufe) : null)
  if (qualitaetUnzulaessig) {
    return { erfolg: false, hinweis: `${qualitaetUnzulaessig} Bitte beim User nachfragen. Es wurde NICHTS gespeichert.` }
  }

  const riedenIn = (input.rieden ?? {}) as R
  const weingartenIds: string[] = Array.isArray(riedenIn.weingarten_ids) ? riedenIn.weingarten_ids : []
  const grundstueckeIn: R[] = Array.isArray(input.grundstuecke) ? input.grundstuecke : []

  if (weingartenIds.length === 0 && grundstueckeIn.length === 0) {
    return {
      erfolg: false,
      hinweis: 'Weder ganze Rieden noch einzelne Grundstücke angegeben. Beim User nachfragen, ' +
        'welche Ried(en) bzw. welche(s) Grundstück(e) gemeint sind, und die exakte ID aus dem ' +
        'Stammdaten-Kontext verwenden.',
    }
  }
  for (const g of grundstueckeIn) {
    if (!g.grundstueck_id || !(Number(g.menge_kg) > 0)) {
      return {
        erfolg: false,
        hinweis: 'Bei einer Grundstücks-Position fehlt die grundstueck_id oder eine Menge > 0 kg ' +
          '– bitte beim User nachfragen.',
      }
    }
  }

  // KAN-128: Mostgewicht in °KMW ODER °Oe – vor dem Anlegen des Jahrgangs prüfen (Einheit, Stellen,
  // Bereich wie das Formular); die Action rechnet beide Werte selbst
  const gemeinsam = mostgewichtParameter(input.klosterneuburger, input.oechsle, 'Gemeinsames Mostgewicht')
  if ('hinweis' in gemeinsam) return { erfolg: false, hinweis: gemeinsam.hinweis }
  const jeGrundstueck: MostgewichtParameter[] = []
  for (const g of grundstueckeIn) {
    const mg = mostgewichtParameter(g.kmw, g.oechsle, `Grundstück ${g.grundstueck_id}`)
    if ('hinweis' in mg) return { erfolg: false, hinweis: mg.hinweis }
    jeGrundstueck.push(mg)
  }

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) {
    return { erfolg: false, fehler: 'Kein Betrieb gefunden – Ernte konnte nicht gespeichert werden.' }
  }

  // ── Jahrgang auflösen oder anlegen ──────────────────────────────────────────
  const { data: bestehenderJahrgang } = await (supabase.from('weinjahrgaenge') as any)
    .select('id').eq('tenant_id', tenantId).eq('jahrgang', jahrgangJahr).maybeSingle()

  let jahrgangId: string | null = (bestehenderJahrgang as R | null)?.id ?? null
  if (!jahrgangId) {
    const jgFd = new FormData()
    jgFd.set('jahrgang', String(jahrgangJahr))
    const jgResult = await createJahrgang(jgFd)
    if (jgResult?.error) {
      return { erfolg: false, fehler: jgResult.error }
    }
    const { data: neuerJahrgang } = await (supabase.from('weinjahrgaenge') as any)
      .select('id').eq('tenant_id', tenantId).eq('jahrgang', jahrgangJahr).maybeSingle()
    jahrgangId = (neuerJahrgang as R | null)?.id ?? null
    if (!jahrgangId) {
      return { erfolg: false, fehler: `Jahrgang ${jahrgangJahr} konnte nicht angelegt/gefunden werden.` }
    }
  }

  // ── KAN-129: Lese im Jahrgang – eine Lese → diese; mehrere → lese_nr oder eindeutig über das Datum,
  //    sonst Rückfrage ohne Speichern (neue Lesen legt der User selbst an) ─────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lesenRaw, error: lesenFehler } = await (supabase.from('lesen') as any)
    .select('id, lfd_nr, art, bezeichnung, beginn, ende').eq('jahrgang_id', jahrgangId).eq('tenant_id', tenantId).order('lfd_nr')
  if (lesenFehler) return { erfolg: false, fehler: `Lesen konnten nicht geladen werden: ${lesenFehler.message}` }
  const lesen = (lesenRaw ?? []) as { id: string; lfd_nr: number; art: string; bezeichnung: string | null; beginn: string | null; ende: string | null }[]
  const leseListe = () => lesen.map(l => `${leseTitel(jahrgangJahr, l)}${leseZeitraumText(l.beginn, l.ende) ? ` (${leseZeitraumText(l.beginn, l.ende)})` : ''}`).join(', ')
  let lese = lesen.length === 1 ? lesen[0] : null
  if (input.lese_nr != null && input.lese_nr !== '') {
    lese = lesen.find(l => l.lfd_nr === Number(input.lese_nr)) ?? null
    if (!lese) return { erfolg: false, hinweis: `Lese ${jahrgangJahr}/${input.lese_nr} gibt es nicht. Vorhanden: ${leseListe() || 'keine'}. Beim User nachfragen; eine neue Lese legt er unter „Lese › Neue Lese“ an.` }
  } else if (!lese) {
    const passend = lesenZumDatum(lesen, String(input.ernte_datum))
    if (passend.length !== 1) {
      return { erfolg: false, hinweis: `Der Jahrgang ${jahrgangJahr} hat mehrere Lesen (${leseListe()}) und das Lesedatum passt nicht eindeutig zu einer. Beim User nachfragen, zu welcher Lese die Einträge gehören, und lese_nr angeben – nichts gespeichert.` }
    }
    lese = passend[0]
  }

  // ── Grundstücke → jeweils zugehörigen weingarten_id nachladen (für GSTEntry-Payload) ──
  const grundstueckJson: R[] = []
  for (const [i, g] of grundstueckeIn.entries()) {
    const { data: gst } = await (supabase.from('grundstuecke') as any)
      .select('id, weingarten_id').eq('id', g.grundstueck_id).eq('tenant_id', tenantId).eq('nutzart', 'WI').maybeSingle()
    if (!gst) {
      return { erfolg: false, hinweis: `Grundstück mit ID ${g.grundstueck_id} nicht gefunden. Beim User nachfragen bzw. Stammdaten-Kontext erneut prüfen.` }
    }
    grundstueckJson.push({
      gst_id: g.grundstueck_id,
      weingarten_id: (gst as R).weingarten_id,
      flaeche_ha: null, // nicht benötigt, da menge_kg pro Grundstück immer explizit angegeben wird
      menge_kg: Number(g.menge_kg),
      // Messwert und gemessene Einheit (KAN-128) – createMultipleErnteParzellen rechnet beide Werte
      mostgewicht_wert: jeGrundstueck[i].wert,
      mostgewicht_einheit: jeGrundstueck[i].einheit,
      notizen: g.notizen ? String(g.notizen) : null,
    })
  }

  const fd = new FormData()
  weingartenIds.forEach(id => fd.append('weingarten_ids', id))
  fd.append('grundstueck_json', JSON.stringify(grundstueckJson))
  fd.set('ernte_datum', String(input.ernte_datum))
  if (input.lesemethode) fd.set('lesemethode', String(input.lesemethode))
  if (gemeinsam.wert !== null && gemeinsam.einheit) {
    fd.set('mostgewicht_wert', gemeinsam.wert)
    fd.set('mostgewicht_einheit', gemeinsam.einheit)
  }
  if (input.qualitaetsstufe) fd.set('qualitaetsstufe', String(input.qualitaetsstufe))
  if (input.notizen) fd.set('notizen', String(input.notizen))
  if (riedenIn.menge_kg_gesamt != null) fd.set('menge_kg', String(riedenIn.menge_kg_gesamt))
  if (lese) fd.set('lese_id', lese.id)

  try {
    await createMultipleErnteParzellen(jahrgangId, fd)
    return {
      erfolg: true,
      jahrgang_id: jahrgangId,
      // KAN-129 (N6): Ziel der Assistent-Aktion ist die Lese, nicht der Jahrgang als „ernte_parzellen“-ID
      lese_id: lese?.id ?? null,
      lese: lese ? leseTitel(jahrgangJahr, lese) : null,
      anzahl_rieden: weingartenIds.length,
      anzahl_grundstuecke: grundstueckJson.length,
    }
  } catch (err) {
    return { erfolg: false, fehler: (err as Error).message ?? String(err) }
  }
}
