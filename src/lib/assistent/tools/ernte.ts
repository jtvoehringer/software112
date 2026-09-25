// Tool "ernte_erfassen" für den Prozess-Assistenten (Bot) – Phase 3.
//
// Deckt die Mehrfacherfassung von Lesedaten ab (Abstimmung mit dem User):
// sowohl ganze Rieden (Menge wird proportional nach Fläche auf die einzelnen
// Grundstücke aufgeteilt, wie im bestehenden Formular) als auch einzelne
// Grundstücke mit individuellen Werten (Menge/KMW/Notizen je Grundstück).
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-73: erlaubte Qualitätsstufen der Lese (= CHECK ernte_parzellen) für Schema und Feld-Matrix
const LESE_WERTE = LESE_QUALITAETEN.map(o => o.value)
const LESE_WERTE_TEXT = LESE_QUALITAETEN.map(o => `${o.value} (${o.label})`).join(', ')

export const ERNTE_FELD_MATRIX_TEXT = `
FELD-MATRIX für "Ernte erfassen":

Gemeinsame Felder: jahrgang (pflicht, Erntejahr als Zahl z.B. 2026 – existiert dafür noch kein
Weinjahrgang-Datensatz, wird er automatisch mit angelegt), ernte_datum (pflicht, YYYY-MM-DD),
lesemethode (optional: handlese/maschinenlese/selektionslese), klosterneuburger (optional,
gemeinsamer °KMW-Wert), qualitaetsstufe (optional – gilt nur für Positionen ohne °KMW, sonst
wird die Stufe automatisch aus den °KMW abgeleitet; ohne Angabe und ohne KMW: qualitaetswein;
nur diese Lese-Stufen sind möglich: ${LESE_WERTE_TEXT} – DAC, Reserve, Erste Lage, Großes
Gewächs, Sekt, Perlwein, Sonstiges, Strohwein und Ausbruch gibt es bei der Lese nicht), notizen
(optional).

Mindestens EINE der beiden folgenden Positions-Arten ist erforderlich (auch kombiniert möglich):
- "rieden": Array von weingarten_ids (ganze Rieden aus dem Stammdaten-Kontext) + optional EINE
  gemeinsame menge_kg_gesamt für alle hier gelisteten Rieden zusammen (wird automatisch
  proportional nach Grundstücksfläche aufgeteilt – für Rieden mit unterschiedlichen,
  einzeln bekannten Erntemengen lieber getrennte Tool-Aufrufe machen oder stattdessen
  "grundstuecke" mit Einzelwerten verwenden).
- "grundstuecke": Array einzelner Positionen {grundstueck_id (pflicht, ID aus dem
  Stammdaten-Kontext), menge_kg (pflicht – die tatsächlich gewogene Menge dieses
  Grundstücks), kmw (optional, überschreibt den gemeinsamen klosterneuburger-Wert für
  dieses Grundstück), notizen (optional, überschreibt die gemeinsamen notizen für dieses
  Grundstück)}.
`.trim()

export const ERNTE_TOOL = {
  name: 'ernte_erfassen',
  description:
    'Erfasst Lesedaten (Ernte) für eine oder mehrere ganze Rieden und/oder einzelne ' +
    'Grundstücke eines Erntejahrs. Legt bei Bedarf automatisch den passenden Weinjahrgang an. ' +
    'WICHTIG: Rufe dieses Tool ausschließlich MIT bestaetigt_vom_user=true auf, und das auch ' +
    'nur, nachdem du dem User in einer normalen Textnachricht eine Zusammenfassung aller ' +
    'Positionen gezeigt und er ausdrücklich zugestimmt hat (z.B. "ja", "passt", "ok"). Rufe es ' +
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
      lesemethode: { type: 'string', enum: ['handlese', 'maschinenlese', 'selektionslese'] },
      klosterneuburger: { type: 'number', description: 'Gemeinsamer °KMW-Wert (optional)' },
      qualitaetsstufe: {
        type: 'string',
        enum: LESE_WERTE,
        description: `Nur für Positionen ohne °KMW (sonst aus den °KMW abgeleitet). Nur Lese-Stufen: ${LESE_WERTE_TEXT}`,
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
            kmw: { type: 'number' },
            notizen: { type: 'string' },
          },
          required: ['grundstueck_id', 'menge_kg'],
        },
      },
    },
    required: ['bestaetigt_vom_user', 'jahrgang', 'ernte_datum'],
  },
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
        'Rieden/Grundstücke mit Mengen) in einer normalen Textnachricht zusammen und frage den ' +
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

  // ── Grundstücke → jeweils zugehörigen weingarten_id nachladen (für GSTEntry-Payload) ──
  const grundstueckJson: R[] = []
  for (const g of grundstueckeIn) {
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
      kmw: g.kmw != null ? Number(g.kmw) : null,
      notizen: g.notizen ? String(g.notizen) : null,
    })
  }

  const fd = new FormData()
  weingartenIds.forEach(id => fd.append('weingarten_ids', id))
  fd.append('grundstueck_json', JSON.stringify(grundstueckJson))
  fd.set('ernte_datum', String(input.ernte_datum))
  if (input.lesemethode) fd.set('lesemethode', String(input.lesemethode))
  if (input.klosterneuburger != null) fd.set('klosterneuburger', String(input.klosterneuburger))
  if (input.qualitaetsstufe) fd.set('qualitaetsstufe', String(input.qualitaetsstufe))
  if (input.notizen) fd.set('notizen', String(input.notizen))
  if (riedenIn.menge_kg_gesamt != null) fd.set('menge_kg', String(riedenIn.menge_kg_gesamt))

  try {
    await createMultipleErnteParzellen(jahrgangId, fd)
    return {
      erfolg: true,
      jahrgang_id: jahrgangId,
      anzahl_rieden: weingartenIds.length,
      anzahl_grundstuecke: grundstueckJson.length,
    }
  } catch (err) {
    return { erfolg: false, fehler: (err as Error).message ?? String(err) }
  }
}
