import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json({ fehler: 'ANTHROPIC_API_KEY nicht gesetzt' }, { status: 500 })

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })

  const { imageBase64, mediaType } = await req.json() as R

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType ?? 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: `Lies diese Visitenkarte und extrahiere die Kontaktdaten. Antworte NUR mit validem JSON ohne Kommentare oder Markdown-Blöcke:
{
  "vorname": "...",
  "nachname": "...",
  "firma": "...",
  "position": "...",
  "email": "...",
  "telefon": "...",
  "mobil": "...",
  "strasse": "...",
  "plz": "...",
  "ort": "...",
  "land": "AT"
}
Fehlende Felder als null. Telefon/Mobil mit Vorwahl.`,
          },
        ],
      }],
    })
    const rawText = (msg.content[0] as R).text as string
    // Markdown-Codeblock entfernen falls vorhanden
    const cleaned = rawText.replace(/```json?\s*/gi, '').replace(/```\s*/gi, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    const kontakt = JSON.parse(match?.[0] ?? cleaned)
    return NextResponse.json({ kontakt })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ fehler: `Analyse fehlgeschlagen: ${msg}` }, { status: 500 })
  }
}
