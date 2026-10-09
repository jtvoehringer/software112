// KAN-220 (07.10.2026): Bilder je Füllung (Flasche, Etikett) für das Produktdatenblatt.
// POST (multipart: art, datei) ersetzt das Bild dieser Art, DELETE ?art=… entfernt es. Benutzer-Client → Storage-Policies
// (Schreibrecht Kellerbuch oder Warenwirtschaft, eigener Betrieb); dazu Seiten-Betrieb (KAN-30) und Abo-Sperre (KAN-5).
// Über eine Route statt einer Server Action, weil diese nur 1 MB annimmt.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite, type Membership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { BILD_BUCKET, bildArtAusName, bildFehler, bildPfad, istBildArt, type BildArt } from '@/lib/handel/datenblatt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fehler = (status: number, text: string) => NextResponse.json({ fehler: text }, { status })

/** Gemeinsame Prüfungen; liefert Antwort (Fehler) oder Kontext */
async function kontext(id: string): Promise<NextResponse | { m: Membership; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }> {
  const m = await getCurrentMembership()
  if (!m?.tenantId) return fehler(401, 'Kein Betrieb')
  const konflikt = await seitenBetriebKonflikt(m.tenantId)
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(m)
  if (gesperrt) return gesperrt
  if (!(canWrite(m, 'kellerbuch') || canWrite(m, 'warenwirtschaft'))) {
    return fehler(403, 'Keine Berechtigung – dafür ist das Modul Kellerbuch oder Warenwirtschaft nötig.')
  }
  if (!UUID_RE.test(id)) return fehler(400, 'Ungültige Füllung')
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: f, error: fErr } = await (supabase.from('fuellungen') as any).select('id').eq('id', id).eq('tenant_id', m.tenantId).maybeSingle()
  if (fErr) return fehler(500, `Füllung konnte nicht geladen werden: ${fErr.message}`)
  if (!f) return fehler(404, 'Füllung nicht gefunden')
  return { m, supabase }
}

/** Vorhandene Dateien dieser Art (beliebige Endung) im Ordner der Füllung */
async function vorhandene(supabase: R, tenantId: string, id: string, art: BildArt): Promise<string[]> {
  const ordner = `${tenantId}/${id}`
  const { data } = await supabase.storage.from(BILD_BUCKET).list(ordner, { limit: 10 })
  return ((data ?? []) as R[]).filter(o => bildArtAusName(String(o.name ?? '')) === art).map(o => `${ordner}/${o.name}`)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params
  const k = await kontext(id)
  if (k instanceof NextResponse) return k
  const fd = await req.formData()
  const art = fd.get('art')
  if (!istBildArt(art)) return fehler(400, 'Unbekannte Bildart')
  const datei = fd.get('datei')
  const f = datei instanceof File ? datei : null
  const pf = bildFehler(f)
  if (pf || !f) return fehler(400, pf ?? 'Bitte eine Bilddatei wählen.')

  const alt = await vorhandene(k.supabase, k.m.tenantId, id, art)
  if (alt.length > 0) {
    const { error } = await k.supabase.storage.from(BILD_BUCKET).remove(alt)
    if (error) return fehler(500, 'Das bisherige Bild konnte nicht ersetzt werden.')
  }
  const { error } = await k.supabase.storage.from(BILD_BUCKET)
    .upload(bildPfad(k.m.tenantId, id, art, f.type), f, { contentType: f.type, upsert: false })
  if (error) return fehler(500, 'Das Bild konnte nicht gespeichert werden.')
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params
  const k = await kontext(id)
  if (k instanceof NextResponse) return k
  const art = req.nextUrl.searchParams.get('art')
  if (!istBildArt(art)) return fehler(400, 'Unbekannte Bildart')
  const alt = await vorhandene(k.supabase, k.m.tenantId, id, art)
  if (alt.length > 0) {
    const { error } = await k.supabase.storage.from(BILD_BUCKET).remove(alt)
    if (error) return fehler(500, 'Das Bild konnte nicht entfernt werden.')
  }
  return NextResponse.json({ ok: true })
}
