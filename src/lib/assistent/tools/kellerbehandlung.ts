// Tool "kellerbehandlung_erfassen" für den Prozess-Assistenten (Bot) – Phase
// 4d (Release 2: Kellerbuch/Bewegungsbuch).
//
// Kellerbehandlungen liefen bisher ausschließlich über direkte Client-seitige
// Schreibzugriffe (siehe Kellerbehandlungen-Seite). Für den Bot wurde dafür
// eine neue Server Action (createKellerbehandlung) in kellerbuch/actions.ts
// ergänzt (Abstimmung mit dem Konzeptdokument, Abschnitt 3b) – dieser
// Tool-Handler ruft ausschließlich diese neue Action auf, exakt nach
// demselben Muster wie die übrigen Prozesse.
import { createKellerbehandlung } from '@/app/(dashboard)/kellerbuch/actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const KELLERBEHANDLUNG_FELD_MATRIX_TEXT = `
FELD-MATRIX für "Kellerbehandlung erfassen":

behaelter_id (pflicht, ID aus BEHÄLTER/GEBINDE im Stammdaten-Kontext), datum (pflicht,
YYYY-MM-DD), sowie GENAU EINES von: typ_id (ID eines bereits bestehenden Behandlungstyps aus
KELLERBEHANDLUNGS-TYPEN im Stammdaten-Kontext) ODER typ_name (Name eines NEUEN Behandlungstyps
– wird automatisch angelegt, falls kein bestehender Typ mit diesem Namen passt; optional dazu
typ_einheit, z.B. "kg"/"g"/"L"/"mL"/"mg"/"°C").

menge (optional, Menge des behandelten Mittels), einheit (optional – ohne Angabe wird die
Standard-Einheit des Typs übernommen), volumen_liter_ist (optional – ohne Angabe wird
automatisch der aktuelle Gesamtinhalt des Behälters verwendet), weinausbau_id (optional, ID
einer konkreten Charge aus WEINAUSBAU-CHARGEN, falls die Behandlung einer bestimmten Charge
zugeordnet werden soll), notizen (optional).
`.trim()

export const KELLERBEHANDLUNG_TOOL = {
  name: 'kellerbehandlung_erfassen',
  description:
    'Erfasst eine Kellerbehandlung (z.B. Schwefelung, Filtration, Schönung) für einen ' +
    'Behälter. WICHTIG: Rufe dieses Tool ausschließlich MIT bestaetigt_vom_user=true auf, und ' +
    'das auch nur, nachdem du dem User in einer normalen Textnachricht eine Zusammenfassung ' +
    'gezeigt und er ausdrücklich zugestimmt hat (z.B. "ja", "passt", "ok"). Rufe es NIEMALS ' +
    'vorher auf (auch nicht testweise).',
  input_schema: {
    type: 'object' as const,
    properties: {
      bestaetigt_vom_user: {
        type: 'boolean',
        description: 'true NUR wenn der User die Zusammenfassung in seiner letzten Nachricht ausdrücklich bestätigt hat.',
      },
      behaelter_id: { type: 'string', description: 'ID des Behälters aus dem Stammdaten-Kontext' },
      datum: { type: 'string', description: 'Datum der Behandlung, Format YYYY-MM-DD' },
      typ_id: { type: 'string', description: 'ID eines bestehenden Behandlungstyps aus dem Stammdaten-Kontext' },
      typ_name: { type: 'string', description: 'Name eines neuen Behandlungstyps, falls kein passender bestehender Typ existiert' },
      typ_einheit: { type: 'string', description: 'Standard-Einheit für einen neuen Behandlungstyp (nur zusammen mit typ_name)' },
      menge: { type: 'number' },
      einheit: { type: 'string', enum: ['kg', 'g', 'L', 'mL', 'mg', '°C', '-'] },
      volumen_liter_ist: { type: 'number' },
      weinausbau_id: { type: 'string', description: 'Optional: ID einer konkreten Charge aus dem Stammdaten-Kontext' },
      notizen: { type: 'string' },
    },
    required: ['bestaetigt_vom_user', 'behaelter_id', 'datum'],
  },
}

export async function fuehreKellerbehandlungErfassenAus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<R> {
  if (input?.bestaetigt_vom_user !== true) {
    return {
      erfolg: false,
      hinweis: 'Noch nicht bestätigt. Fasse die geplante Behandlung (Behälter, Typ, Datum, ' +
        'Menge) in einer normalen Textnachricht zusammen und frage den User ausdrücklich um ' +
        'Bestätigung, bevor du dieses Tool erneut mit bestaetigt_vom_user=true aufrufst. Es ' +
        'wurde NICHTS gespeichert.',
    }
  }

  if (!input.behaelter_id || !input.datum) {
    return { erfolg: false, hinweis: 'Behälter und Datum sind Pflichtfelder – bitte beim User nachfragen.' }
  }
  if (!input.typ_id && !input.typ_name) {
    return {
      erfolg: false,
      hinweis: 'Kein Behandlungstyp angegeben. Beim User nachfragen, um welche Art Behandlung ' +
        'es sich handelt (entweder einen bestehenden Typ aus dem Stammdaten-Kontext wählen ' +
        'oder einen neuen Typnamen nennen).',
    }
  }

  const { data: behaelter } = await (supabase.from('behaelter') as any)
    .select('id').eq('id', input.behaelter_id).eq('aktiv', true).maybeSingle()
  if (!behaelter) {
    return { erfolg: false, hinweis: `Behälter mit ID ${input.behaelter_id} nicht gefunden. Beim User nachfragen bzw. Stammdaten-Kontext erneut prüfen.` }
  }

  // ── Behandlungstyp auflösen oder anlegen ────────────────────────────────────
  let typId: string | null = input.typ_id ? String(input.typ_id) : null
  if (typId) {
    const { data: typExists } = await (supabase.from('keller_behandlungstypen') as any)
      .select('id').eq('id', typId).maybeSingle()
    if (!typExists) {
      return { erfolg: false, hinweis: `Behandlungstyp mit ID ${typId} nicht gefunden. Beim User nachfragen bzw. Stammdaten-Kontext erneut prüfen.` }
    }
  } else if (input.typ_name) {
    const typName = String(input.typ_name).trim()
    const { data: bestehenderTyp } = await (supabase.from('keller_behandlungstypen') as any)
      .select('id').ilike('name', typName).maybeSingle()
    if ((bestehenderTyp as R | null)?.id) {
      typId = (bestehenderTyp as R).id
    } else {
      // tenant_memberships ist RLS-gescoped auf den eingeloggten User – wie in getTenantId()
      // an anderer Stelle im Projekt üblich, daher hier ohne explizite user_id-Filterung.
      const { data: membership } = await (supabase.from('tenant_memberships') as any)
        .select('tenant_id').limit(1).maybeSingle()
      const tenantId = (membership as R | null)?.tenant_id
      if (!tenantId) {
        return { erfolg: false, fehler: 'Kein Betrieb gefunden – neuer Behandlungstyp konnte nicht angelegt werden.' }
      }
      const { data: neuerTyp, error: typErr } = await (supabase.from('keller_behandlungstypen') as any)
        .insert({ tenant_id: tenantId, name: typName, einheit_standard: input.typ_einheit ? String(input.typ_einheit) : null })
        .select('id').single()
      if (typErr) {
        return { erfolg: false, fehler: (typErr as R).message }
      }
      typId = (neuerTyp as R).id
    }
  }
  if (!typId) {
    return { erfolg: false, fehler: 'Behandlungstyp konnte nicht aufgelöst werden.' }
  }

  const fd = new FormData()
  fd.set('behaelter_id', String(input.behaelter_id))
  fd.set('datum', String(input.datum))
  fd.set('typ_id', typId)
  if (input.menge != null) fd.set('menge', String(input.menge))
  if (input.einheit) fd.set('einheit', String(input.einheit))
  if (input.volumen_liter_ist != null) fd.set('volumen_liter_ist', String(input.volumen_liter_ist))
  if (input.weinausbau_id) fd.set('weinausbau_id', String(input.weinausbau_id))
  if (input.notizen) fd.set('notizen', String(input.notizen))

  try {
    const result = await createKellerbehandlung(fd)
    return { erfolg: true, behandlung_id: (result as R | undefined)?.id ?? null }
  } catch (err) {
    return { erfolg: false, fehler: (err as Error).message ?? String(err) }
  }
}
