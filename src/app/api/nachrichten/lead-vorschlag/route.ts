// ── E-Mail → Lead: Vorbelegung aus der E-Mail (15.9.2026) ─────────────────────
// Gegenstück zu /api/visitkarte: statt eines Kartenfotos liest die KI Signatur
// und Inhalt einer eingegangenen E-Mail und liefert Kontakt-/Firmendaten,
// einen Segment-Vorschlag und das Anliegen in zwei Sätzen. Dazu kommen die
// Auswahllisten für den Dialog (Rabattgruppen, ähnlich benannte Firmen).
// Gespeichert wird nichts - das macht createLeadAusEmail (crm/actions.ts).

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getCurrentMembership } from '@/lib/auth/roles'
import { SEGMENTE } from '@/lib/crm/types'
import { domainVon, FREEMAIL_DOMAINS, normEmail } from '@/lib/crm/absender'
import { LEER, mailText, type LeadVorbelegung } from '@/lib/crm/leadEmail'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const gesperrt = await schreibSperreKonflikt(membership, 'ki')   // KAN-5: Nur-Lesen-Modus – KI gesperrt (Kosten)
    if (gesperrt) return gesperrt

    const body = await req.json() as R
    const von = normEmail(body.von)
    const vonName = String(body.vonName ?? '').trim()
    const betreff = String(body.betreff ?? '').trim()
    const text = mailText(body.bodyText, body.bodyHtml)
    const domain = domainVon(von)
    const firmenDomain = domain && !FREEMAIL_DOMAINS.has(domain) ? domain : null

    // Auswahllisten für den Dialog
    const [{ data: rRaw }, { data: fRaw }] = await Promise.all([
      (supabase.from('rabattgruppen') as any).select('id, name, rabatt_pct').eq('tenant_id', tenantId).order('rabatt_pct'),
      alle((supabase.from('firmen') as any).select('id, name, ort, segment, is_lead').eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id')),   // Sweep 20.9.: .limit(2000) wurde bei 1.000 gekappt
    ])
    const rabattgruppen = ((rRaw ?? []) as R[]).map(r => ({ id: r.id as string, name: r.name as string, rabatt_pct: Number(r.rabatt_pct) }))
    const firmen = ((fRaw ?? []) as R[]).map(f => ({ id: f.id as string, name: f.name as string, ort: (f.ort ?? null) as string | null, segment: f.segment as string, is_lead: !!f.is_lead }))

    // Vorbelegung ohne KI (Fallback): Name aus dem Anzeigenamen, Firma aus der Domain
    const fallback: LeadVorbelegung = { ...LEER, email: von || null }
    if (vonName && !vonName.includes('@')) {
      const teile = vonName.replace(/["']/g, '').split(/[,;]/)
      const n = teile.length === 2 ? `${teile[1].trim()} ${teile[0].trim()}` : vonName   // „Huber, Anna“ → „Anna Huber“
      const w = n.trim().split(/\s+/)
      if (w.length >= 2) { fallback.vorname = w.slice(0, -1).join(' '); fallback.nachname = w[w.length - 1] }
      else fallback.nachname = w[0]
    }
    if (firmenDomain) fallback.website = firmenDomain

    let vorbelegung: LeadVorbelegung = fallback
    let kiModell: string | null = null
    if (process.env.ANTHROPIC_API_KEY && (text || vonName)) {
      const segmente = SEGMENTE.map(s => `${s.value} (${s.label})`).join(', ')
      const prompt = `Du bekommst eine eingegangene E-Mail an einen österreichischen Weinbaubetrieb. Extrahiere die Absenderdaten (vor allem aus der Signatur) und fasse das Anliegen zusammen.
Antworte NUR mit validem JSON ohne Kommentare oder Markdown-Blöcke:
{
  "anrede": "Herr|Frau|null",
  "vorname": "...", "nachname": "...",
  "firma": "Firmen-/Betriebsname oder null (Privatperson)",
  "position": "...",
  "email": "...", "telefon": "...", "mobil": "...",
  "strasse": "...", "plz": "...", "ort": "...", "land": "ISO-2, z. B. AT",
  "website": "...",
  "segment": "eines von: ${segmente}",
  "anliegen": "1-2 Sätze auf Deutsch: was will die Person (z. B. Preisliste, Verkostung, Bestellung, Kooperation)?"
}
Regeln: Fehlende Felder als null, nichts erfinden. Telefon/Mobil mit Landesvorwahl (+43 …). Wenn keine Firma erkennbar ist, segment = "privat"; Gasthaus/Hotel/Heuriger = "gastronomie", Restaurant = "restaurant", Vinothek/Weinhandlung = "vinothek", Händler/Supermarkt = "handel", Großhändler = "grosshandel", ausländischer Importeur = "importeur", Journalist/Verlag = "medien", Reisebüro/Tourismusverband = "tourismus", andere Firma = "firmenkunde". Die Absenderadresse ist ${von || 'unbekannt'}${vonName ? `, Anzeigename „${vonName}“` : ''}.

Betreff: ${betreff || '(kein Betreff)'}

E-Mail:
${text || '(kein Text)'}`
      try {
        const modell = 'claude-haiku-4-5-20251001'   // wie /api/visitkarte
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        const msg = await client.messages.create({ model: modell, max_tokens: 700, messages: [{ role: 'user', content: prompt }] })
        const raw = ((msg.content[0] as R)?.text ?? '') as string
        const cleaned = raw.replace(/```json?\s*/gi, '').replace(/```\s*/gi, '').trim()
        const match = cleaned.match(/\{[\s\S]*\}/)
        const j = JSON.parse(match?.[0] ?? cleaned) as R
        const str = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null') ? v.trim() : null
        vorbelegung = {
          anrede: str(j.anrede), vorname: str(j.vorname) ?? fallback.vorname, nachname: str(j.nachname) ?? fallback.nachname,
          firma: str(j.firma), position: str(j.position),
          email: normEmail(str(j.email)) || von || null,
          telefon: str(j.telefon), mobil: str(j.mobil), strasse: str(j.strasse), plz: str(j.plz), ort: str(j.ort),
          land: (str(j.land) ?? 'AT').toUpperCase().slice(0, 2),
          website: str(j.website) ?? fallback.website,
          segment: SEGMENTE.some(s => s.value === str(j.segment)) ? str(j.segment) : null,
          anliegen: str(j.anliegen),
        }
        kiModell = modell
      } catch (e) {
        console.error('[lead-vorschlag] KI-Analyse fehlgeschlagen:', e)
        vorbelegung = fallback
      }
    }
    if (!vorbelegung.segment) vorbelegung.segment = vorbelegung.firma ? 'firmenkunde' : 'privat'
    if (!vorbelegung.land) vorbelegung.land = 'AT'

    // Firmen-Kandidaten: gleicher Name (ähnlich) - Domain-Treffer wären schon als „bekannt“ erkannt
    const norm = (s: string) => s.toLowerCase().replace(/\b(gmbh|ag|og|kg|e\.?u\.?|ges\.?m\.?b\.?h\.?|weingut|weinbau|gasthaus|restaurant|hotel)\b/g, '').replace(/[^a-z0-9äöüß]+/g, ' ').trim()
    const firmaNorm = vorbelegung.firma ? norm(vorbelegung.firma) : ''
    const kandidaten = firmaNorm.length >= 3
      ? firmen.filter(f => { const n = norm(f.name); return n && (n.includes(firmaNorm) || firmaNorm.includes(n)) }).slice(0, 5)
      : []

    return NextResponse.json({ vorbelegung, kandidaten, firmen, rabattgruppen, kiModell, textLaenge: text.length })
  } catch (err) {
    return NextResponse.json({ fehler: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
