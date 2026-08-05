// Chat-API-Route des Prozess-Assistenten (Bot).
//
// Phase 1 Pilot: "Maßnahme dokumentieren" ist der erste echte Prozess mit
// Tool-Nutzung. Ablauf pro Anfrage: Verlauf laden -> Claude mit Tool-
// Definition aufrufen -> falls Claude das Tool aufruft, den Handler
// ausführen (der intern die bestehende Server Action createBehandlung
// aufruft, RLS greift wie im Formular) -> Ergebnis zurück an Claude ->
// finale Textantwort. Vor jedem tatsächlichen Speichern verlangt der
// Handler eine explizite User-Bestätigung (siehe massnahme.ts) – kein
// automatisches Anlegen ohne Rückfrage, siehe Konzeptdokument Abschnitt 6.
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { ladeAssistentKontext, formatiereKontextFuerPrompt } from '@/lib/assistent/kontext'
import { MASSNAHME_TOOL, MASSNAHME_FELD_MATRIX_TEXT, fuehreMassnahmeDokumentierenAus } from '@/lib/assistent/tools/massnahme'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Claude Sonnet – für den Piloten per Env-Var überschreibbar, falls sich die
// Modell-ID zwischenzeitlich ändert (analog zu ANTHROPIC_API_KEY in Vercel
// Environment Variables eintragen). Default ist die zum Zeitpunkt der
// Implementierung aktuelle Sonnet-4.5-Modell-ID.
const MODEL = process.env.ASSISTENT_MODEL || 'claude-sonnet-4-5-20250929'

const MAX_NACHRICHT_LAENGE = 2000
const MAX_VERLAUF_NACHRICHTEN = 40 // Sicherheitsgrenze gegen unbegrenzt wachsende Prompts
const MAX_TOOL_RUNDEN = 4          // Sicherheitsgrenze gegen Endlosschleifen bei Tool-Use

function systemPrompt(kontext: string): string {
  // Claude kennt das tatsächliche "heute" nicht von selbst (Trainingsdaten-Stichtag)
  // – deshalb muss das aktuelle Serverdatum explizit mitgegeben werden, sonst rät
  // das Modell bei "heute"/"morgen"/"gestern" ein falsches (z.T. deutlich älteres) Datum.
  const heute = new Date()
  const heuteIso = heute.toISOString().slice(0, 10)
  const heuteLesbar = heute.toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return `Du bist bot:112, der Prozess-Assistent von software:112, einem österreichischen Weinbau-ERP.
Wenn du dich vorstellst oder auf deinen Namen angesprochen wirst, nenne dich "bot:112".

DEINE ROLLE: Du bist kein reines Frage-Antwort-Tool, sondern nimmst den User aktiv an die Hand und
führst ihn Schritt für Schritt durch genau den Prozess, den er erledigen möchte – wie ein Kollege, der
gezielt nachfragt statt ein langes Formular hinzuwerfen. Stelle daher pro Nachricht immer nur EINE (oder
wenige, eng zusammengehörige) Rückfrage(n), statt alle offenen Felder auf einmal abzufragen. Wenn der
User unsicher ist oder fragt, was du überhaupt kannst, liste ihm kurz die aktuell verfügbaren Themen auf
(siehe "AKTUELL KANNST DU" unten) und frage, womit er starten möchte.

WICHTIG – aktuelles Datum: Heute ist ${heuteLesbar} (${heuteIso}). Wenn der User "heute", "gestern",
"morgen" oder Wochentage ("letzten Montag") nennt, rechne IMMER von diesem tatsächlichen Datum aus –
nicht von einem Datum aus deinen Trainingsdaten. Gib Datumsfelder im Tool-Aufruf immer im Format
YYYY-MM-DD an.

AKTUELL KANNST DU: Maßnahmen dokumentieren (Spritzung, Düngung, Bodenbearbeitung, Schnitt,
Laubarbeit, Sonstiges) über das Tool "massnahme_dokumentieren". Alle anderen Prozesse (Verkauf
anlegen, Ernte erfassen, Kellerbuch) sind noch in Entwicklung – erkläre das freundlich, wenn danach
gefragt wird, erfinde aber niemals, dass du etwas gespeichert hast.

${MASSNAHME_FELD_MATRIX_TEXT}

GANZ WICHTIG – Bestätigungspflicht: Bevor du massnahme_dokumentieren mit bestaetigt_vom_user=true
aufrufst, MUSST du dem User in einer normalen Textnachricht eine klare Zusammenfassung der geplanten
Eintragung zeigen (Art, Datum, Grundstück/Ried, Mittel, Menge, ...) und explizit fragen, ob das so
passt. Rufe das Tool NIEMALS ohne diese vorherige Bestätigung auf – auch nicht, wenn der Fall
eindeutig wirkt. Wenn der User Änderungswünsche äußert, passe die Zusammenfassung an und frage erneut.

Bei Grundstücks-/Ried-Namen: nutze IMMER die exakte ID aus dem Stammdaten-Kontext unten (nie den
Namen roh als ID verwenden). Bei Mehrdeutigkeit (mehrere Treffer) oder wenn du nichts Passendes
findest, frage beim User nach statt zu raten.

Antworte auf Deutsch, kurz und freundlich, wie ein hilfsbereiter Kollege im Betrieb.

Aktueller Stammdaten-Kontext dieses Betriebs (frisch aus der Datenbank geladen):
${kontext}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as R | null
    const nachrichtRaw = body?.nachricht
    const unterhaltungIdIn = body?.unterhaltungId as string | undefined

    if (!nachrichtRaw || !String(nachrichtRaw).trim()) {
      return NextResponse.json({ fehler: 'Keine Nachricht angegeben' }, { status: 400 })
    }
    const nachricht = String(nachrichtRaw).slice(0, MAX_NACHRICHT_LAENGE)

    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })

    const membership = await getCurrentMembership()
    if (!membership) return NextResponse.json({ fehler: 'Kein Betrieb gefunden' }, { status: 401 })
    if (!canWrite(membership.role)) {
      return NextResponse.json({ fehler: 'Keine Berechtigung für den Assistenten' }, { status: 403 })
    }

    const admin = createSupabaseAdminClient()
    const { data: cfg } = await (admin.from('tenant_einstellungen') as any)
      .select('assistent_aktiv')
      .eq('tenant_id', membership.tenantId)
      .maybeSingle()
    if (!(cfg as R | null)?.assistent_aktiv) {
      return NextResponse.json({ fehler: 'Der Assistent ist für diesen Betrieb noch nicht freigeschaltet.' }, { status: 403 })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ fehler: 'ANTHROPIC_API_KEY nicht gesetzt – bitte in Vercel Environment Variables eintragen.' }, { status: 500 })
    }

    // ── Unterhaltung laden oder neu anlegen ─────────────────────────────────
    let unterhaltungId = unterhaltungIdIn
    if (unterhaltungId) {
      const { data: bestehend } = await (supabase.from('assistent_unterhaltungen') as any)
        .select('id').eq('id', unterhaltungId).eq('user_id', user.id).eq('status', 'aktiv').maybeSingle()
      if (!bestehend) unterhaltungId = undefined // ungültig/fremd/abgeschlossen -> neu anlegen
    }
    if (!unterhaltungId) {
      const { data: neu, error: neuErr } = await (supabase.from('assistent_unterhaltungen') as any)
        .insert({ tenant_id: membership.tenantId, user_id: user.id })
        .select('id').single()
      if (neuErr) throw new Error(neuErr.message)
      unterhaltungId = (neu as R).id
    }

    // ── Nutzer-Nachricht speichern ───────────────────────────────────────────
    await (supabase.from('assistent_nachrichten') as any).insert({
      unterhaltung_id: unterhaltungId, rolle: 'user', inhalt: nachricht,
    })

    // ── Bisherigen (reinen Text-)Verlauf laden ──────────────────────────────
    // Bewusst nur die reinen User/Assistant-Textnachrichten (tool_name IS
    // NULL) für den an Claude gesendeten Verlauf – Tool-Use/Tool-Result-
    // Blöcke werden separat als Audit-Trail gespeichert (siehe unten) und
    // NICHT roh wiederholt, um die strikten Pairing-Anforderungen der
    // Anthropic-API nicht über mehrere Requests hinweg replizieren zu müssen.
    // Die finale Klartext-Antwort nach einem Tool-Aufruf landet ohnehin als
    // normale Assistant-Nachricht im Verlauf, der Kontext bleibt erhalten.
    const { data: verlaufRaw } = await (supabase.from('assistent_nachrichten') as any)
      .select('rolle, inhalt')
      .eq('unterhaltung_id', unterhaltungId)
      .in('rolle', ['user', 'assistant'])
      .is('tool_name', null)
      .order('erstellt_am', { ascending: true })
      .limit(MAX_VERLAUF_NACHRICHTEN)

    const verlaufMessages = ((verlaufRaw ?? []) as R[])
      .filter(m => m.inhalt)
      .map(m => ({ role: m.rolle as 'user' | 'assistant', content: m.inhalt as string }))

    // ── Stammdaten-Kontext laden ─────────────────────────────────────────────
    const kontext = await ladeAssistentKontext(supabase, membership.tenantId)
    const kontextText = formatiereKontextFuerPrompt(kontext)

    // ── Claude aufrufen – Tool-Use-Loop ─────────────────────────────────────
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workingMessages: any[] = [...verlaufMessages, { role: 'user', content: nachricht }]

    let finalText = ''
    for (let runde = 0; runde < MAX_TOOL_RUNDEN; runde++) {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 1000,
        system: systemPrompt(kontextText),
        tools: [MASSNAHME_TOOL],
        messages: workingMessages,
      })

      const toolUseBlocks = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const textBlocks = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text).join('\n').trim()

      if (toolUseBlocks.length === 0) {
        finalText = textBlocks || 'Entschuldigung, ich konnte darauf keine Antwort formulieren.'
        break
      }

      // Nur den ersten Tool-Aufruf dieser Runde ausführen (Phase 1 hat genau ein Tool)
      const toolUse = toolUseBlocks[0]

      // Audit: Assistant-Nachricht mit Tool-Aufruf protokollieren (nicht Teil des Replay-Verlaufs)
      await (supabase.from('assistent_nachrichten') as any).insert({
        unterhaltung_id: unterhaltungId, rolle: 'assistant',
        inhalt: textBlocks || null, tool_name: toolUse.name, tool_input: toolUse.input,
      })

      const ergebnis = await fuehreMassnahmeDokumentierenAus(toolUse.input as R, supabase)

      // Audit: Tool-Ergebnis protokollieren
      await (supabase.from('assistent_nachrichten') as any).insert({
        unterhaltung_id: unterhaltungId, rolle: 'tool',
        tool_name: toolUse.name, tool_result: ergebnis,
      })

      // Erfolgreich angelegte Datensätze im Aktions-Protokoll festhalten
      if (ergebnis?.erfolg && ergebnis?.behandlung_id) {
        await (supabase.from('assistent_aktionen') as any).insert({
          unterhaltung_id: unterhaltungId,
          prozess: 'massnahme_dokumentieren',
          ziel_tabelle: 'behandlungen',
          ziel_id: ergebnis.behandlung_id,
          erstellt_von: user.id,
        })
      }

      workingMessages.push({ role: 'assistant', content: msg.content })
      workingMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(ergebnis) }],
      })
      // Schleife läuft weiter -> Claude formuliert die finale Antwort (oder ruft in
      // seltenen Fällen noch einmal ein Tool auf, z.B. nach Korrektur durch den User).
    }

    if (!finalText) {
      finalText = 'Die Anfrage war komplexer als erwartet – bitte formuliere sie nochmal etwas genauer.'
    }

    // ── Finale Antwort speichern (Teil des Replay-Verlaufs) ──────────────────
    await (supabase.from('assistent_nachrichten') as any).insert({
      unterhaltung_id: unterhaltungId, rolle: 'assistant', inhalt: finalText,
    })

    return NextResponse.json({ unterhaltungId, antwort: finalText })
  } catch (err) {
    console.error('assistent/chat error:', err)
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
