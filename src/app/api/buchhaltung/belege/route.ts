// POST /api/buchhaltung/belege – Beleg (Foto/PDF) hochladen + KI-Erkennung
//
// Ablauf: Datei validieren -> in Supabase Storage ablegen -> an Claude
// (Vision, native PDF-Unterstützung) zur Datenextraktion senden -> Ergebnis
// in ea_belege speichern (Status "erkannt"). Schlägt die Erkennung fehl
// (Netzwerk, Rate-Limit, kein ANTHROPIC_API_KEY, unlesbares Bild), wird der
// Beleg trotzdem gespeichert (Status "fehler") - der Upload selbst darf nie
// an einer KI-Störung scheitern, sonst geht der Beleg verloren.

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Gleiches Modell/Env-Var-Muster wie der Prozess-Assistent (assistent/chat/route.ts).
const MODEL = process.env.ASSISTENT_MODEL || 'claude-sonnet-4-5-20250929'

const MAX_BYTES = 15 * 1024 * 1024
const ERLAUBTE_TYPEN: Record<string, true> = {
  'application/pdf': true,
  'image/jpeg':       true,
  'image/png':        true,
  'image/webp':       true,
}
const GUELTIGE_UST_SAETZE = [0, 10, 13, 20]

const BELEG_TOOL = {
  name: 'beleg_erfassen',
  description: 'Trägt die aus dem Beleg (Foto/PDF eines Kassenbons, einer Rechnung o.ä.) erkannten Buchungsdaten ein.',
  input_schema: {
    type: 'object' as const,
    properties: {
      typ: {
        type: 'string', enum: ['einnahme', 'ausgabe'],
        description: 'einnahme, wenn der Betrieb selbst der Rechnungssteller ist (Ausgangsrechnung); sonst (Kassenbon, Eingangsrechnung, Tankbeleg, Materialrechnung o.ä.) ausgabe. Im Zweifel ausgabe.',
      },
      datum: { type: 'string', description: 'Belegdatum im Format YYYY-MM-DD. Falls nicht lesbar: null.' },
      beschreibung: {
        type: 'string',
        description: 'Kurze Bezeichnung, z.B. "Diesel Tankstelle Müller" oder "Traktor-Service Fa. XY" - Händler-/Firmenname + Art der Leistung, max. ca. 80 Zeichen.',
      },
      betrag_brutto: { type: 'number', description: 'Gesamtbetrag inkl. USt, wie auf dem Beleg aufgedruckt.' },
      ust_satz: {
        type: 'number', enum: GUELTIGE_UST_SAETZE,
        description: 'USt-Satz in Prozent. Bei mehreren Sätzen auf einem Beleg: den betragsmäßig größten Anteil wählen und im Feld hinweis darauf hinweisen.',
      },
      kategorie_id: { type: 'string', description: 'Die ID der am besten passenden Kategorie aus der mitgelieferten Liste, oder null falls keine passt.' },
      konfidenz: { type: 'string', enum: ['hoch', 'mittel', 'niedrig'], description: 'Wie sicher die Erkennung insgesamt ist.' },
      hinweis: { type: 'string', description: 'Optionaler Hinweis an den Nutzer, z.B. bei Unsicherheiten, unlesbaren Stellen oder mehreren USt-Sätzen. Sonst weglassen.' },
      lieferant_name: {
        type: 'string',
        description: 'Name des Lieferanten/Rechnungsstellers, NUR wenn klar erkennbar (z.B. Firmenname im Rechnungskopf einer Eingangsrechnung, "Weinbau Bedarf Müller GmbH"). Bei anonymen Kassenbons, Tankrechnungen ohne erkennbaren Geschäftspartner oder Ausgangsrechnungen (typ=einnahme) weglassen bzw. leer lassen - nicht erzwingen.',
      },
    },
    required: ['typ', 'beschreibung', 'betrag_brutto', 'ust_satz', 'konfidenz'],
  },
}

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 403 })
  const konflikt = await seitenBetriebKonflikt(tenantId, 'error')   // KAN-30: Beleg aus einem veralteten Tab?
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership.role, 'ea')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle()
  if (!(einst as R | null)?.modul_ea) return NextResponse.json({ error: 'E&A-Modul für diesen Betrieb nicht aktiv' }, { status: 403 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Keine Datei' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Datei zu groß (max. 15 MB)' }, { status: 413 })
  const mimeType = file.type
  if (!ERLAUBTE_TYPEN[mimeType]) {
    return NextResponse.json({ error: 'Nicht unterstütztes Dateiformat – bitte PDF, JPEG, PNG oder WebP.' }, { status: 415 })
  }

  const storagePfad = `${tenantId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadErr } = await supabase.storage
    .from('ea-belege')
    .upload(storagePfad, file, { contentType: mimeType, upsert: false })
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  // ── KI-Erkennung – darf den Upload nie zum Scheitern bringen ──────────────
  let erkannteDaten: R | null = null
  let fehlerDetails: string | null = null

  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY nicht gesetzt')

    const { data: kategorienRaw } = await (supabase.from('ea_kategorien') as any)
      .select('id, name, typ')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .eq('aktiv', true)
      .order('sortierung')
    const kategorien = (kategorienRaw ?? []) as R[]

    const bytes = Buffer.from(await file.arrayBuffer())
    const base64 = bytes.toString('base64')

    const contentBlock: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam = mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: base64 } }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        'Du liest österreichische Geschäftsbelege (Kassenbons, Eingangs-/Ausgangsrechnungen, ' +
        'Tankbelege) für einen Weinbaubetrieb aus und extrahierst die Buchungsdaten für dessen ' +
        'Einnahmen-Ausgaben-Rechnung (§ 4 Abs. 3 EStG). Verfügbare Buchungskategorien (id, name, typ):\n' +
        JSON.stringify(kategorien) +
        '\nAntworte ausschließlich über das Tool beleg_erfassen.',
      tools: [BELEG_TOOL],
      tool_choice: { type: 'tool', name: 'beleg_erfassen' },
      messages: [{
        role: 'user',
        content: [
          contentBlock,
          { type: 'text', text: 'Bitte lies diesen Beleg aus und trage die Daten über das Tool ein.' },
        ],
      }],
    })

    const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (!toolUse) throw new Error('Keine strukturierte Antwort von Claude erhalten')
    const input = toolUse.input as R

    const betragBrutto = Number(input.betrag_brutto)
    const ustSatz = GUELTIGE_UST_SAETZE.includes(Number(input.ust_satz)) ? Number(input.ust_satz) : 20
    const betragBruttoGueltig = isFinite(betragBrutto) ? betragBrutto : null
    const betragNetto = betragBruttoGueltig != null
      ? Math.round((betragBruttoGueltig / (1 + ustSatz / 100)) * 100) / 100
      : null

    // Kategorie-Vorschlag validieren – muss wirklich existieren, sonst lieber leer lassen
    const kategorieOk = kategorien.some(k => k.id === input.kategorie_id)

    const lieferantName = typeof input.lieferant_name === 'string' && input.lieferant_name.trim()
      ? input.lieferant_name.trim().slice(0, 120)
      : null

    erkannteDaten = {
      typ:            input.typ === 'einnahme' ? 'einnahme' : 'ausgabe',
      datum:          typeof input.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.datum) ? input.datum : null,
      beschreibung:   typeof input.beschreibung === 'string' ? input.beschreibung.slice(0, 200) : '',
      betrag_brutto:  betragBruttoGueltig,
      betrag_netto:   betragNetto,
      ust_satz:       ustSatz,
      kategorie_id:   kategorieOk ? input.kategorie_id : null,
      konfidenz:      ['hoch', 'mittel', 'niedrig'].includes(input.konfidenz) ? input.konfidenz : 'niedrig',
      hinweis:        typeof input.hinweis === 'string' && input.hinweis.trim() ? input.hinweis.trim() : null,
      lieferant_name: lieferantName,
      firma_id_vorschlag: null as string | null,
    }

    // Lieferanten-Abgleich: nur bei Ausgaben mit erkanntem Namen versuchen -
    // Tankrechnungen/Kassenbons ohne Geschäftspartner (lieferantName === null)
    // brauchen bewusst keine Firmenzuordnung (siehe Beleg-Buchen-Formular).
    if (erkannteDaten.typ === 'ausgabe' && lieferantName) {
      const { data: lieferantenRaw } = await (supabase.from('firmen') as any)
        .select('id, name')
        .eq('tenant_id', tenantId).eq('ist_lieferant', true)
      const lieferanten = (lieferantenRaw ?? []) as R[]
      const normalisiert = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
      const gesucht = normalisiert(lieferantName)
      const treffer = lieferanten.find(f => normalisiert(f.name) === gesucht)
        ?? lieferanten.find(f => normalisiert(f.name).includes(gesucht) || gesucht.includes(normalisiert(f.name)))
      erkannteDaten.firma_id_vorschlag = treffer?.id ?? null
    }
  } catch (e) {
    fehlerDetails = e instanceof Error ? e.message : 'Unbekannter Fehler bei der Beleg-Erkennung'
  }

  const { data: beleg, error: dbErr } = await (supabase.from('ea_belege') as any)
    .insert({
      tenant_id:       tenantId,
      dateiname:       file.name,
      dateityp:        mimeType,
      groesse_bytes:   file.size,
      storage_pfad:    storagePfad,
      status:          erkannteDaten ? 'erkannt' : 'fehler',
      erkannte_daten:  erkannteDaten,
      fehler_details:  fehlerDetails,
      hochgeladen_von: user.id,
    })
    .select('id, dateiname, dateityp, status, erkannte_daten, fehler_details, hochgeladen_am')
    .single()

  if (dbErr) {
    // Storage-Datei rückgängig machen, wenn der DB-Insert scheitert
    await supabase.storage.from('ea-belege').remove([storagePfad])
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }

  return NextResponse.json(beleg, { status: 201 })
}
