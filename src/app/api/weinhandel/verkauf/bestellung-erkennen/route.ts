// ── „Bestellung erkennen“ (KAN-411 Teil 2, 11.11.2026) ───────────────────────────────────────────────────────────────
// Die KI liest den Text einer Bestell-Mail und schlägt Positionen für „Neuer Verkauf“ vor (Füllung, Flaschen).
// Gespeichert wird hier nichts – der Benutzer prüft den Vorschlag im Formular und speichert selbst (createVerkauf).
// Zählt gegen das KI-Kontingent des Betriebs (Entscheidung Jörgen 11.11.2026) – gezählt wird erst nach allen Prüfungen,
// direkt vor dem Aufruf. Regeln, Prompt und das Lesen der Antwort: src/lib/verkauf/bestellungKi.ts.

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { alle } from '@/lib/supabase/alle'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { sperrAntwortKoerper } from '@/lib/abo/regeln'
import { dbFehlerText } from '@/lib/fehler'
import {
  bestellSystemPrompt, bestellUserPrompt, fuellungText, leseKiAntwort, mailFuerPrompt,
  BEGRIFFE_MAX, FUELLUNGEN_MAX, type GelernterBegriff, type KiFuellung,
} from '@/lib/verkauf/bestellungKi'

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODELL = 'claude-haiku-4-5-20251001'   // wie /api/nachrichten/lead-vorschlag

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!membership || !tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })
    const konflikt = await seitenBetriebKonflikt(tenantId)   // KAN-30: Anfrage aus einem veralteten Tab?
    if (konflikt) return konflikt
    const gesperrt = await schreibSperreKonflikt(membership, 'ki')   // KAN-5: Nur-Lesen-Modus – KI gesperrt (Kosten)
    if (gesperrt) return gesperrt
    if (!canWrite(membership, 'warenwirtschaft')) return NextResponse.json({ fehler: 'Keine Berechtigung – dafür ist die Freigabe Warenwirtschaft nötig.' }, { status: 403 })

    let body: R
    try { body = await req.json() as R } catch { return NextResponse.json({ fehler: 'Ungültige Anfrage.' }, { status: 400 }) }
    const text = mailFuerPrompt(typeof body.text === 'string' ? body.text : '')
    const betreff = typeof body.betreff === 'string' ? body.betreff : ''
    const kunde = typeof body.kunde === 'string' ? body.kunde : ''
    const kontaktId = kunde.startsWith('kontakt:') && UUID.test(kunde.slice(8)) ? kunde.slice(8) : null
    const firmaId = kunde.startsWith('firma:') && UUID.test(kunde.slice(6)) ? kunde.slice(6) : null
    if (text.length < 5) return NextResponse.json({ fehler: 'Die E-Mail enthält keinen Text, aus dem sich eine Bestellung erkennen ließe.' }, { status: 400 })

    const { data: einst, error: einstErr } = await (supabase.from('tenant_einstellungen') as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .select('ki_abfragen_aktiv').eq('tenant_id', tenantId).maybeSingle()
    if (einstErr) return NextResponse.json({ fehler: dbFehlerText(einstErr, 'Betriebseinstellungen konnten nicht geladen werden') }, { status: 500 })
    if (!(einst as R | null)?.ki_abfragen_aktiv) return NextResponse.json({ fehler: 'Das KI-Modul ist für diesen Betrieb nicht aktiv.' }, { status: 403 })
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ fehler: 'Die KI ist derzeit nicht eingerichtet (Schlüssel fehlt).' }, { status: 500 })

    // Füllungen mit Bestand (wie die Auswahl im Formular) und gelernte Begriffe – die des Kunden zuerst
    const [{ data: fRaw, error: fErr }, { data: bRaw, error: bErr }] = await Promise.all([
      alle((supabase.from('fuellungen') as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen')
        .eq('tenant_id', tenantId).eq('aktiv', true).gt('bestand_flaschen', 0).order('name').order('id')),
      // alle-ausnahme: nur die zuletzt verwendeten Begriffe als Hinweis für die KI – bewusst begrenzt, absteigend sortiert
      (supabase.from('verkauf_ki_begriffe') as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .select('begriff, fuellung_id, kontakt_id, firma_id, zuletzt_am, fuellung:fuellungen!verkauf_ki_begriffe_fuellung_id_fkey(name, jahrgang, rebsorte, flaschengroesse_ml)')
        .eq('tenant_id', tenantId).order('zuletzt_am', { ascending: false }).order('id', { ascending: false }).limit(300),
    ])
    { const ladeFehler = [fErr, bErr].find(Boolean)
      if (ladeFehler) return NextResponse.json({ fehler: dbFehlerText(ladeFehler, 'Daten konnten nicht geladen werden') }, { status: 500 }) }
    const fuellungen = ((fRaw ?? []) as R[]).map(f => ({
      id: String(f.id), name: String(f.name ?? ''), jahrgang: f.jahrgang == null ? null : Number(f.jahrgang), rebsorte: (f.rebsorte ?? null) as string | null,
      flaschengroesse_ml: f.flaschengroesse_ml == null ? null : Number(f.flaschengroesse_ml), bestand_flaschen: Number(f.bestand_flaschen ?? 0),
    })) as KiFuellung[]
    if (!fuellungen.length) return NextResponse.json({ fehler: 'Es gibt keine Füllung mit Bestand – ohne Sortiment lässt sich keine Bestellung zuordnen.' }, { status: 400 })
    const imPrompt = fuellungen.slice(0, FUELLUNGEN_MAX)
    const eigen = (b: R) => (kontaktId != null && b.kontakt_id === kontaktId) || (firmaId != null && b.firma_id === firmaId)
    const gesehen = new Set<string>()
    const begriffe: GelernterBegriff[] = []
    for (const b of [...((bRaw ?? []) as R[]).filter(eigen), ...((bRaw ?? []) as R[]).filter(x => !eigen(x))]) {
      const schluessel = String(b.begriff)
      if (gesehen.has(schluessel) || !b.fuellung) continue
      gesehen.add(schluessel)
      begriffe.push({ begriff: schluessel, fuellung_id: String(b.fuellung_id), fuellung: fuellungText(b.fuellung as KiFuellung), eigenerKunde: eigen(b) })
      if (begriffe.length >= BEGRIFFE_MAX) break
    }

    // KAN-22/KAN-5: Zähler nur per Service-Role, Fehler der Zählung nicht überspringen (fail-closed)
    const { data: limitCheck, error: limitFehler } = await (createSupabaseAdminClient().rpc as any)('check_und_increment_ki_abfrage', { p_tenant_id: tenantId }) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (limitFehler) {
      if ((limitFehler as R).hint === 'abo_gesperrt') {
        return NextResponse.json(sperrAntwortKoerper('ki'), { status: 403, headers: { 'Cache-Control': 'no-store', 'X-S112-Nur-Lesen': '1' } })
      }
      console.error('bestellung-erkennen: KI-Kontingent nicht prüfbar:', (limitFehler as R).message)
      return NextResponse.json({ fehler: 'Das KI-Kontingent konnte nicht geprüft werden – bitte später erneut versuchen.' }, { status: 503 })
    }
    const check = limitCheck as R | null
    if (check && check.erlaubt === false) {
      return NextResponse.json({ fehler: `Abfrage-Limit erreicht (${check.verbraucht}/${check.limit} im Paket ${check.paket}).`, limit_erreicht: true }, { status: 429 })
    }

    let roh = ''
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 })
      const msg = await client.messages.create({
        model: MODELL, max_tokens: 1500, system: bestellSystemPrompt(),
        messages: [{ role: 'user', content: bestellUserPrompt({ betreff, text, fuellungen: imPrompt, begriffe }) }],
      })
      roh = ((msg.content[0] as R)?.text ?? '') as string
    } catch (e) {
      console.error('bestellung-erkennen: KI-Aufruf fehlgeschlagen:', e)
      return NextResponse.json({ fehler: 'Die KI hat nicht geantwortet – bitte erneut versuchen oder die Positionen von Hand eintragen.' }, { status: 502 })
    }
    const vorschlag = leseKiAntwort(roh, new Set(imPrompt.map(f => f.id)))
    if (!vorschlag) return NextResponse.json({ fehler: 'Die Antwort der KI war nicht lesbar – bitte erneut versuchen oder die Positionen von Hand eintragen.' }, { status: 502 })
    return NextResponse.json({ ...vorschlag, modell: MODELL, gekuerzt: fuellungen.length > imPrompt.length }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('bestellung-erkennen:', err)
    return NextResponse.json({ fehler: 'Die Bestellung konnte nicht erkannt werden.' }, { status: 500 })
  }
}
