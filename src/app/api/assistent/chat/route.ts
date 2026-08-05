// Chat-API-Route des Prozess-Assistenten (Bot).
//
// Phase 0 (Fundament): nimmt Nachrichten entgegen, verwaltet die Unterhaltung
// in assistent_unterhaltungen/assistent_nachrichten, lädt den Stammdaten-
// Kontext und lässt Claude konversationell antworten. Ab Phase 1 kommen
// Tool-Definitionen + Tool-Handler dazu, die bestehende Server Actions
// aufrufen (z.B. createBehandlung) – siehe Konzeptdokument Abschnitt 8/9.
// In Phase 0 kann der Assistent noch NICHTS in der Datenbank anlegen, er
// sagt das dem User im System-Prompt auch explizit.
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { ladeAssistentKontext, formatiereKontextFuerPrompt } from '@/lib/assistent/kontext'
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

function systemPrompt(kontext: string): string {
  return `Du bist der Prozess-Assistent von software:112, einem österreichischen Weinbau-ERP.
Du hilfst dem Winzer bzw. seinem Team, wiederkehrende Erfassungsprozesse (z.B. Maßnahme dokumentieren,
Verkauf anlegen, Ernte erfassen) per Konversation statt über lange Formulare zu erledigen.

WICHTIG – aktueller Ausbaustand: Du kannst in dieser Version noch KEINE Daten in der Datenbank anlegen
oder ändern. Wenn der User dich bittet, etwas einzutragen (z.B. eine Spritzung, einen Verkauf, eine
Ernte), erkläre freundlich, dass diese Funktion gerade in Entwicklung ist und bald verfügbar sein wird –
frage aber trotzdem gerne interessiert nach, was er eintragen möchte, damit du (sobald die Funktion da
ist) direkt helfen kannst. Erfinde niemals, dass du etwas gespeichert hast.

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

    // ── Bisherigen Verlauf laden (für Claude-Messages) ──────────────────────
    const { data: verlaufRaw } = await (supabase.from('assistent_nachrichten') as any)
      .select('rolle, inhalt')
      .eq('unterhaltung_id', unterhaltungId)
      .in('rolle', ['user', 'assistant'])
      .order('erstellt_am', { ascending: true })
      .limit(MAX_VERLAUF_NACHRICHTEN)

    const messages = ((verlaufRaw ?? []) as R[])
      .filter(m => m.inhalt)
      .map(m => ({ role: m.rolle as 'user' | 'assistant', content: m.inhalt as string }))

    // ── Stammdaten-Kontext laden ─────────────────────────────────────────────
    const kontext = await ladeAssistentKontext(supabase, membership.tenantId)
    const kontextText = formatiereKontextFuerPrompt(kontext)

    // ── Claude aufrufen ───────────────────────────────────────────────────────
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: systemPrompt(kontextText),
      messages,
    })

    const antwortText = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim() || 'Entschuldigung, ich konnte darauf keine Antwort formulieren.'

    // ── Antwort speichern ─────────────────────────────────────────────────────
    await (supabase.from('assistent_nachrichten') as any).insert({
      unterhaltung_id: unterhaltungId, rolle: 'assistant', inhalt: antwortText,
    })

    return NextResponse.json({ unterhaltungId, antwort: antwortText })
  } catch (err) {
    console.error('assistent/chat error:', err)
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
