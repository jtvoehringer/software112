// Tool "korrektur_merken" für den Prozess-Assistenten (Bot) – Phase 5
// (Lernmechanismus & Ausbau, Konzeptdokument Abschnitt 7 "lernt pro Mandant
// mit").
//
// Kein neuer Prozess im eigentlichen Sinn (kein eigener THEMEN-Eintrag im
// Widget) – wird vom Bot selbst proaktiv im laufenden Gespräch aufgerufen,
// wenn er eine Begriffs-Zuordnung falsch verstanden hat, der User ihn
// korrigiert hat, und der User auf explizite Nachfrage ("soll ich mir das
// merken?") zustimmt. Die gespeicherten Einträge werden bei jeder Anfrage
// über kontext.ts als "GELERNTE ZUORDNUNGEN" in den System-Prompt geladen,
// damit derselbe Begriff beim nächsten Mal sofort richtig aufgelöst wird.
//
// Schreibt direkt in assistent_korrekturen (angelegt in Migration 148,
// Phase 0) – dafür existiert bewusst keine eigene Server Action, da diese
// Tabelle ausschließlich vom Bot selbst befüllt wird (keine bestehende
// UI/Formular-Schreiblogik, die wiederverwendet werden könnte).

import { getCurrentMembership } from '@/lib/auth/roles'
import { NICHT_GESPEICHERT, dbFehlerText } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const KATEGORIEN = [
  'weingarten', 'grundstueck', 'psm', 'duengemittel', 'kontakt', 'firma',
  'fuellung', 'weinausbau', 'behaelter', 'behandlungstyp', 'sonstiges',
] as const

export const KORREKTUR_FELD_MATRIX_TEXT = `
FELD-MATRIX für "korrektur_merken" (Korrekturgedächtnis):

begriff (pflicht, der vom User verwendete Ausdruck/Name genau so, wie er ihn geschrieben hat, z.B.
"Riesling-Parzelle am Berg"), interpretation (pflicht, die jetzt korrekt aufgelöste Zuordnung als
Klartext INKLUSIVE der exakten ID aus dem Stammdaten-Kontext, z.B. "a1b2c3-... (Grundstück GST-12,
Ried Berg)"), kategorie (optional, eine von: ${KATEGORIEN.join(', ')}).
`.trim()

export const KORREKTUR_TOOL = {
  name: 'korrektur_merken',
  description:
    'Speichert eine vom User bestätigte Begriffs-Zuordnung fürs Korrekturgedächtnis dieses ' +
    'Betriebs, damit derselbe Begriff beim nächsten Mal automatisch richtig zugeordnet wird. ' +
    'WICHTIG: Rufe dieses Tool NUR auf, nachdem du im laufenden Gespräch bemerkt hast, dass du ' +
    'einen Begriff falsch zugeordnet hattest, der User dich korrigiert hat, UND du ihn danach ' +
    'in einer normalen Textnachricht explizit gefragt hast "Soll ich mir das für nächstes Mal ' +
    'merken?" und er ausdrücklich zugestimmt hat (bestaetigt_vom_user=true). Rufe es NIEMALS ' +
    'automatisch oder ohne diese Rückfrage auf.',
  input_schema: {
    type: 'object' as const,
    properties: {
      bestaetigt_vom_user: {
        type: 'boolean',
        description: 'true NUR wenn der User die Rückfrage "soll ich mir das merken?" ausdrücklich mit ja beantwortet hat.',
      },
      begriff: { type: 'string', description: 'Der vom User verwendete Begriff/Name, genau wie geschrieben' },
      interpretation: { type: 'string', description: 'Die korrekt aufgelöste Zuordnung als Klartext inkl. der exakten ID aus dem Stammdaten-Kontext' },
      kategorie: { type: 'string', enum: [...KATEGORIEN] },
    },
    required: ['bestaetigt_vom_user', 'begriff', 'interpretation'],
  },
}

export async function fuehreKorrekturMerkenAus(
  input: R,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string
): Promise<R> {
  if (input?.bestaetigt_vom_user !== true) {
    return {
      erfolg: false,
      hinweis: 'Noch nicht bestätigt. Frage den User ausdrücklich "Soll ich mir das für nächstes ' +
        'Mal merken?", bevor du dieses Tool erneut mit bestaetigt_vom_user=true aufrufst. Es ' +
        'wurde NICHTS gespeichert.',
    }
  }

  const begriff = String(input.begriff ?? '').trim()
  const interpretation = String(input.interpretation ?? '').trim()
  if (!begriff || !interpretation) {
    return { erfolg: false, hinweis: 'Begriff und Interpretation sind Pflichtfelder – bitte beim User nachfragen.' }
  }

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) {
    return { erfolg: false, fehler: 'Kein Betrieb gefunden – Korrektur konnte nicht gespeichert werden.' }
  }

  const kategorie = input.kategorie ? String(input.kategorie) : null

  // Bereits vorhandenen Eintrag für denselben Begriff (case-insensitiv) aktualisieren statt
  // Duplikate anzuhäufen – analog zum "auflösen oder anlegen"-Muster bei Jahrgang/Behandlungstyp.
  const { data: bestehend, error: bestehendErr } = await (supabase.from('assistent_korrekturen') as any)
    .select('id').eq('tenant_id', tenantId).ilike('begriff', begriff).maybeSingle()
  if (bestehendErr) return { erfolg: false, fehler: `Datenbankfehler: ${bestehendErr.message}` }

  if ((bestehend as R | null)?.id) {
    const { data: geaendert, error: updateErr } = await (supabase.from('assistent_korrekturen') as any)
      .update({ interpretation, kategorie, erstellt_von: userId })
      .eq('id', (bestehend as R).id).eq('tenant_id', tenantId).select('id')
    if (updateErr) return { erfolg: false, fehler: dbFehlerText(updateErr) }
    if (!(geaendert as unknown[] | null)?.length) return { erfolg: false, fehler: NICHT_GESPEICHERT }   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
    return { erfolg: true, korrektur_id: (bestehend as R).id, aktualisiert: true }
  }

  const { data: neu, error: insertErr } = await (supabase.from('assistent_korrekturen') as any)
    .insert({ tenant_id: tenantId, begriff, interpretation, kategorie, erstellt_von: userId })
    .select('id').single()
  if (insertErr) return { erfolg: false, fehler: dbFehlerText(insertErr) }
  return { erfolg: true, korrektur_id: (neu as R).id, aktualisiert: false }
}
