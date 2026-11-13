// POST /api/weinhandel/angebote/[id]/send – Angebot als PDF per E-Mail an den Kunden (KAN-418 Teil 4).
// Wie der Rechnungsversand: kein eigener Mail-Dienst, sondern die Anbindung des Betriebs (belegPerMailSenden – zuerst
// die Microsoft-365-Mailbox des Benutzers, sonst SMTP des Betriebs). Nach dem Versand: Vermerk am Angebot über die RPC
// s112_auftrag_ab_vermerken (dieselbe wie bei der Auftragsbestätigung – Angebot und Auftrag liegen in einer Tabelle) und eine CRM-Aktivität.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { belegPerMailSenden } from '@/lib/email/belegVersand'
import { ereignisMelden } from '@/lib/system/ereignis'
import { wienTag } from '@/lib/datum/wien'
import { dbFehlerText, fehlerText } from '@/lib/fehler'
import { ladeAngebot } from '@/lib/auftrag/angebotLaden'
import { abEmpfaengerFehler, abNachrichtFehler } from '@/lib/auftrag/bestaetigung'
import { angebotBetreff, angebotDateiname, angebotMailText } from '@/lib/auftrag/angebot'
import { renderAngebotPdf } from '@/lib/pdf/angebotPdf'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'verkauf')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  if (!membership?.tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })
  const fremderBetrieb = await seitenBetriebKonflikt(membership.tenantId, 'error')   // KAN-30: Seite aus einem anderen Betrieb?
  if (fremderBetrieb) return fremderBetrieb
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'warenwirtschaft')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  const tenantId = membership.tenantId

  let body: { to?: unknown; message?: unknown } = {}
  try { body = await req.json() } catch { /* kein Body mitgeschickt – Empfänger kommt dann vom Kunden */ }
  const nachrichtFehler = abNachrichtFehler(body.message)
  if (nachrichtFehler) return NextResponse.json({ error: nachrichtFehler }, { status: 400 })

  const geladen = await ladeAngebot(supabase, tenantId, id)
  if (!geladen.ok) return NextResponse.json({ error: geladen.fehler }, { status: geladen.status })
  const d = geladen.daten

  const empfaenger = (typeof body.to === 'string' && body.to.trim()) || d.kundeEmail || ''
  if (!empfaenger) {
    return NextResponse.json({ error: 'Keine Empfänger-E-Mail-Adresse vorhanden. Bitte beim Kunden hinterlegen oder eingeben.' }, { status: 400 })
  }
  const empfaengerFehler = abEmpfaengerFehler(empfaenger)
  if (empfaengerFehler) return NextResponse.json({ error: empfaengerFehler }, { status: 400 })

  let pdf: Buffer
  try {
    pdf = await renderAngebotPdf(d.pdf)
  } catch (err) {
    return NextResponse.json({ error: `PDF-Erzeugung fehlgeschlagen: ${fehlerText(err, 'unbekannter Fehler')}` }, { status: 500 })
  }

  const betreff = angebotBetreff(d.nummer, d.betriebName)
  const admin = createSupabaseAdminClient()
  const versand = await belegPerMailSenden({
    admin, tenantId, userId: user.id, an: empfaenger, betreff,
    text: angebotMailText({ kundenName: d.kundenName || null, nummer: d.nummer, gueltigBis: d.gueltigBis, nachricht: typeof body.message === 'string' ? body.message : null, betrieb: d.betriebName }),
    dateiname: angebotDateiname(d.nummer), pdf, absenderName: d.betriebName,
  })
  if (!versand.ok) return NextResponse.json({ error: versand.fehler }, { status: versand.status })

  // Die Mail ist verschickt – ein Fehler beim Vermerk bzw. bei der CRM-Aktivität wird protokolliert, nicht als
  // Versandfehler gemeldet (sonst sendet ein zweiter Klick das Angebot doppelt)
  let gesendetAm = new Date().toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vermerkAm, error: vermerkErr } = await (supabase.rpc as any)('s112_auftrag_ab_vermerken', { p_tenant_id: tenantId, p_auftrag_id: id, p_an: empfaenger })
  if (vermerkErr) void ereignisMelden({ art: 'db', quelle: 'angebot/send/vermerk', meldung: dbFehlerText(vermerkErr) })
  else if (typeof vermerkAm === 'string') gesendetAm = vermerkAm

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: aktFehler } = await (admin.from('aktivitaeten') as any).insert({
    tenant_id: tenantId,
    kontakt_id: d.kontaktId,
    firma_id: d.firmaId,
    art: 'email',
    betreff,
    beschreibung: `Angebot ${d.nummer} per E-Mail an ${empfaenger} versendet`,
    datum: wienTag(gesendetAm),
    erledigt: true,
    ganztags: true,
  })
  if (aktFehler) void ereignisMelden({ art: 'db', quelle: 'angebot/send/aktivitaeten', meldung: aktFehler.message })

  return NextResponse.json({ ok: true, sentAt: gesendetAm, sentTo: empfaenger, via: versand.via, vermerkt: !vermerkErr })
}
