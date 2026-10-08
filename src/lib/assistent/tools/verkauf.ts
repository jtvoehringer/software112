// Tool "verkauf_anlegen" für den Prozess-Assistenten (Bot) – Phase 2.
//
// Deckt zunächst bewusst nur die zwei häufigsten Positions-Typen ab (Abstimmung
// mit dem User): Flaschen aus dem Füllungen-Bestand und Fass/Tank-Mengen aus
// einer Weinausbau-Charge. Trauben-Verkauf (BKI-Meldedaten) und freie
// "Sonstiges"-Artikel sind bewusst ausgeklammert – dafür weiterhin das
// bestehende Formular unter Verkauf > Neu nutzen.
//
// Ruft am Ende dieselbe Server Action (createVerkauf) mit denselben Parametern
// auf, die auch das Formular übergibt – siehe massnahme.ts für dasselbe Muster.
//
// Sicherheits-Hinweis: Der Bot speichert NIE ohne explizite User-Bestätigung
// (bestaetigt_vom_user), analog zu massnahme_dokumentieren.
import { createVerkauf } from '@/app/(dashboard)/weinhandel/verkauf/actions'
import { FLASCHEN_LABEL } from '@/lib/assistent/kontext'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const VERKAUF_FELD_MATRIX_TEXT = `
FELD-MATRIX für "Verkauf anlegen" (aktuell NUR Flaschen- und Fass/Tank-Positionen –
Trauben-Verkauf und freie "Sonstiges"-Artikel werden vom Bot noch nicht unterstützt;
in diesem Fall freundlich auf das bestehende Formular unter Verkauf > Neu verweisen):

Kopfdaten: datum (pflicht), kontakt_id ODER firma_id (pflicht – genau einen Kunden
auswählen, IMMER die exakte ID aus dem Stammdaten-Kontext verwenden, nie den Namen roh),
notizen (optional).

Je Position:
- typ "flasche": fuellung_id (pflicht, ID aus FÜLLUNGEN / FLASCHEN-BESTAND im
  Stammdaten-Kontext), menge in Stück (pflicht). preis_brutto ist optional – wird sonst
  automatisch aus dem hinterlegten Verkaufspreis der Füllung übernommen.
- typ "tank": weinausbau_id (pflicht, ID aus WEINAUSBAU-CHARGEN im Stammdaten-Kontext),
  menge in Liter (pflicht), preis_brutto (PFLICHT – für Fass/Tank-Verkäufe gibt es
  keinen hinterlegten Standardpreis, also IMMER erfragen).

rabatt_pct/sonderrabatt_pct/ust_satz sind optional (ust_satz wird sonst automatisch mit
dem Standard-USt-Satz des Betriebs befüllt). Mehrere Positionen in einem Verkauf sind
möglich – frage nach jeder Position, ob noch eine weitere hinzukommt.
`.trim()

export const VERKAUF_TOOL = {
  name: 'verkauf_anlegen',
  description:
    'Legt einen Verkauf mit einer oder mehreren Positionen an (aktuell nur Flaschen aus dem ' +
    'Füllungen-Bestand und Fass/Tank-Mengen aus einer Weinausbau-Charge). WICHTIG: Rufe dieses ' +
    'Tool ausschließlich MIT bestaetigt_vom_user=true auf, und das auch nur, nachdem du dem User ' +
    'in einer normalen Textnachricht eine Zusammenfassung von Kunde und allen Positionen gezeigt ' +
    'und er ausdrücklich zugestimmt hat (z.B. "ja", "passt", "ok"). Rufe es NIEMALS vorher auf ' +
    '(auch nicht testweise) – nutze bestaetigt_vom_user=false nur, falls du aus Versehen ohne ' +
    'Bestätigung aufrufst, was du aber vermeiden sollst.',
  input_schema: {
    type: 'object' as const,
    properties: {
      bestaetigt_vom_user: {
        type: 'boolean',
        description: 'true NUR wenn der User die Zusammenfassung in seiner letzten Nachricht ausdrücklich bestätigt hat.',
      },
      datum: { type: 'string', description: 'Datum des Verkaufs, Format YYYY-MM-DD' },
      kontakt_id: { type: 'string', description: 'ID des Kunden (Privatperson) aus dem Stammdaten-Kontext' },
      firma_id: { type: 'string', description: 'ID des Kunden (Firma) aus dem Stammdaten-Kontext' },
      notizen: { type: 'string' },
      positionen: {
        type: 'array',
        description: 'Mindestens eine Position.',
        items: {
          type: 'object',
          properties: {
            typ: { type: 'string', enum: ['flasche', 'tank'] },
            fuellung_id: { type: 'string', description: 'Nur bei typ=flasche, ID aus dem Stammdaten-Kontext' },
            weinausbau_id: { type: 'string', description: 'Nur bei typ=tank, ID aus dem Stammdaten-Kontext' },
            menge: { type: 'number', description: 'Stück bei Flaschen, Liter bei Tank' },
            preis_brutto: { type: 'number', description: 'Bei typ=tank IMMER erfragen und angeben, bei typ=flasche optional (sonst Katalogpreis der Füllung)' },
            rabatt_pct: { type: 'number' },
            sonderrabatt_pct: { type: 'number' },
            ust_satz: { type: 'number' },
          },
          required: ['typ', 'menge'],
        },
      },
    },
    required: ['bestaetigt_vom_user', 'datum', 'positionen'],
  },
}

export async function fuehreVerkaufAnlegenAus(
  input: R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // Standard-USt-Satz des Betriebs (bereits mandanten-gescoped aus dem Stammdaten-Kontext
  // geladen, siehe kontext.ts) – wird als Fallback verwendet, wenn der User/das Modell
  // keinen ust_satz je Position angibt.
  ustStandard: number
): Promise<R> {
  if (input?.bestaetigt_vom_user !== true) {
    return {
      erfolg: false,
      hinweis: 'Noch nicht bestätigt. Fasse die geplante Eintragung (Kunde, alle Positionen) in ' +
        'einer normalen Textnachricht zusammen und frage den User ausdrücklich um Bestätigung, ' +
        'bevor du dieses Tool erneut mit bestaetigt_vom_user=true aufrufst. Es wurde NICHTS gespeichert.',
    }
  }

  if (!input.kontakt_id && !input.firma_id) {
    return {
      erfolg: false,
      hinweis: 'Kein Kunde angegeben. Beim User nachfragen, welcher Kunde gemeint ist, und die ' +
        'exakte ID (kontakt_id oder firma_id) aus dem Stammdaten-Kontext verwenden.',
    }
  }
  if (!input.datum) {
    return { erfolg: false, hinweis: 'Datum ist ein Pflichtfeld – bitte beim User nachfragen.' }
  }
  const positionenIn: R[] = Array.isArray(input.positionen) ? input.positionen : []
  if (positionenIn.length === 0) {
    return { erfolg: false, hinweis: 'Keine Position angegeben. Mindestens eine Position (Flasche oder Fass/Tank) ist erforderlich.' }
  }

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) {
    return { erfolg: false, fehler: 'Kein Betrieb gefunden – Verkauf konnte nicht gespeichert werden.' }
  }

  const posForServer: R[] = []
  for (const p of positionenIn) {
    if (!(Number(p.menge) > 0)) {
      return { erfolg: false, hinweis: 'Jede Position benötigt eine Menge größer 0 – bitte beim User nachfragen.' }
    }

    if (p.typ === 'flasche') {
      if (!p.fuellung_id) {
        return {
          erfolg: false,
          hinweis: 'Bei einer Flaschen-Position fehlt die fuellung_id. Beim User nachfragen, welche ' +
            'Füllung gemeint ist, und die exakte ID aus dem Stammdaten-Kontext verwenden.',
        }
      }
      const { data: f } = await (supabase.from('fuellungen') as any)
        .select('id, name, jahrgang, flaschengroesse_ml, vk_preis_brutto')
        .eq('id', p.fuellung_id).eq('tenant_id', tenantId).eq('aktiv', true).maybeSingle()
      if (!f) {
        return { erfolg: false, hinweis: `Füllung mit ID ${p.fuellung_id} nicht gefunden. Beim User nachfragen bzw. Stammdaten-Kontext erneut prüfen.` }
      }
      const ff = f as R
      const name = [ff.name, ff.jahrgang, ff.flaschengroesse_ml ? FLASCHEN_LABEL[ff.flaschengroesse_ml] : null]
        .filter(Boolean).join(' · ')
      posForServer.push({
        typ: 'flasche',
        fuellung_id: ff.id,
        weinausbau_id: null,
        zukauf_id: null,
        pressung_behaelter_id: null,
        name,
        menge: Number(p.menge),
        einheit: 'Stk',
        preis_brutto: p.preis_brutto != null ? Number(p.preis_brutto) : (ff.vk_preis_brutto ?? null),
        rabatt_pct: p.rabatt_pct != null ? Number(p.rabatt_pct) : 0,
        sonderrabatt_pct: p.sonderrabatt_pct != null ? Number(p.sonderrabatt_pct) : 0,
        ust_satz: p.ust_satz != null ? Number(p.ust_satz) : ustStandard,
      })
    } else if (p.typ === 'tank') {
      if (!p.weinausbau_id) {
        return {
          erfolg: false,
          hinweis: 'Bei einer Fass/Tank-Position fehlt die weinausbau_id. Beim User nachfragen, ' +
            'welche Charge gemeint ist, und die exakte ID aus dem Stammdaten-Kontext verwenden.',
        }
      }
      const { data: w } = await (supabase.from('weinausbau') as any)
        .select('id, name')
        .eq('id', p.weinausbau_id).eq('tenant_id', tenantId).eq('aktiv', true).maybeSingle()
      if (!w) {
        return { erfolg: false, hinweis: `Weinausbau-Charge mit ID ${p.weinausbau_id} nicht gefunden. Beim User nachfragen bzw. Stammdaten-Kontext erneut prüfen.` }
      }
      const ww = w as R
      if (p.preis_brutto == null) {
        return {
          erfolg: false,
          hinweis: 'Für Fass/Tank-Positionen gibt es keinen hinterlegten Preis – beim User nach dem ' +
            'Verkaufspreis (brutto) fragen, bevor du das Tool erneut aufrufst.',
        }
      }
      posForServer.push({
        typ: 'tank',
        fuellung_id: null,
        weinausbau_id: ww.id,
        zukauf_id: null,
        pressung_behaelter_id: null,
        name: ww.name,
        menge: Number(p.menge),
        einheit: 'L',
        preis_brutto: Number(p.preis_brutto),
        rabatt_pct: p.rabatt_pct != null ? Number(p.rabatt_pct) : 0,
        sonderrabatt_pct: p.sonderrabatt_pct != null ? Number(p.sonderrabatt_pct) : 0,
        ust_satz: p.ust_satz != null ? Number(p.ust_satz) : ustStandard,
      })
    } else {
      return {
        erfolg: false,
        hinweis: `Positions-Typ "${p.typ}" wird vom Bot noch nicht unterstützt (nur "flasche" und ` +
          '"tank"). Für Trauben-Verkauf oder Sonstiges-Artikel bitte freundlich auf das bestehende ' +
          'Formular unter Verkauf > Neu verweisen.',
      }
    }
  }

  const fd = new FormData()
  fd.set('datum', String(input.datum))
  fd.set('rechnungsnummer', '')
  fd.set('kontakt_id', input.kontakt_id ? String(input.kontakt_id) : '')
  fd.set('firma_id', input.firma_id ? String(input.firma_id) : '')
  fd.set('zh_kontakt_id', '')
  fd.set('notizen', input.notizen ? String(input.notizen) : '')
  fd.set('skonto_pct', '0')
  fd.set('skonto_tage', '0')
  fd.set('skonto_aktiv', 'false')
  fd.set('positionen_json', JSON.stringify(posForServer))

  try {
    const result = await createVerkauf(fd)
    return { erfolg: true, verkaufsposten_id: (result as R | undefined)?.id ?? null }
  } catch (err) {
    return { erfolg: false, fehler: (err as Error).message ?? String(err) }
  }
}
