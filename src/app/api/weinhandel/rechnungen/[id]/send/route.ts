// POST /api/weinhandel/rechnungen/[id]/send (KAN-379, 27.10.2026)
// Stornobeleg (rechnungen.art = 'storno') als PDF „Stornorechnung zu Rechnung … vom …“ per E-Mail an den Kunden – über
// dieselbe Anbindung wie die Rechnung (belegPerMailSenden). Rechnungen selbst versendet weiter
// /api/weinhandel/verkauf/[id]/send (über einen Lieferschein der Rechnung). Versandvermerk am Stornobeleg, CRM-Aktivität.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { momentaufnahmeAnwenden } from '@/lib/stammdaten/momentaufnahme'
import { kontaktAnzeigename } from '@/lib/crm/titel'
import { STORNO_FELDER } from '@/lib/verkauf/rechnungen'
import { stornobelegPdfInhalt } from '@/lib/verkauf/stornobelegPdf'
import { renderVerkaufRechnungPdf } from '@/lib/pdf/verkaufRechnungPdf'
import { belegPerMailSenden } from '@/lib/email/belegVersand'
import { ereignisMelden } from '@/lib/system/ereignis'
import { wienTag } from '@/lib/datum/wien'
import { dbFehlerText } from '@/lib/fehler'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'verkauf')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  if (!membership?.tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })
  const konflikt = await seitenBetriebKonflikt(membership.tenantId, 'error')
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'warenwirtschaft')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  const tenantId = membership.tenantId

  let body: { to?: string; message?: string } = {}
  try { body = await req.json() } catch { /* kein Body mitgeschickt – ok */ }

  const [{ data: roh, error: rohErr }, { data: einstRaw, error: einstErr }] = await Promise.all([
    // storno-sichtbar: der Stornobeleg selbst (art = 'storno') samt Verweis auf die stornierte Rechnung
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('rechnungen') as any)
      .select(`id, rechnungsnummer, datum, notizen, partner_daten, kontakt_id, firma_id, ${STORNO_FELDER},
        kontakt:kontakte!kontakt_id(titel, vorname, nachname, titel_nachgestellt, email, strasse, plz, ort),
        firma:firmen!firma_id(name, email, strasse, plz, ort),
        zh_kontakt:kontakte!zh_kontakt_id(titel, vorname, nachname, titel_nachgestellt)`)
      .eq('id', id).eq('tenant_id', tenantId).maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any)
      .select(`anzeigename, logo_url, betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort,
               betrieb_telefon, betrieb_email, betrieb_website, betrieb_uid, rechnung_fusstext`)
      .eq('tenant_id', tenantId).maybeSingle(),
  ])
  { const ladeFehler = [rohErr, einstErr].find(Boolean)
    if (ladeFehler) return NextResponse.json({ error: `Daten konnten nicht geladen werden: ${dbFehlerText(ladeFehler)}` }, { status: 500 }) }
  if (!roh) return NextResponse.json({ error: 'Stornobeleg nicht gefunden' }, { status: 404 })
  if ((roh as R).art !== 'storno') {
    return NextResponse.json({ error: 'Hier werden nur Stornobelege versendet – Rechnungen über den Lieferschein senden.' }, { status: 400 })
  }
  const beleg = momentaufnahmeAnwenden(roh as R, ['kontakt', 'firma', 'zh_kontakt'])   // KAN-150 F1c
  const inhalt = stornobelegPdfInhalt(beleg)
  const einst = (einstRaw ?? {}) as R

  const kundeInfo = (beleg.kontakt ?? beleg.firma ?? null) as R | null
  const kundeName = beleg.kontakt ? kontaktAnzeigename(beleg.kontakt) : beleg.firma ? String(beleg.firma.name) : 'Kunde'
  const recipient = body.to?.trim() || (kundeInfo?.email as string | null) || ''
  if (!recipient) {
    return NextResponse.json({ error: 'Keine Empfänger-E-Mail-Adresse vorhanden. Bitte beim Kunden hinterlegen oder manuell eingeben.' }, { status: 400 })
  }
  const bName = einst.betrieb_name ?? einst.anzeigename ?? 'Weingut'

  let pdf: Buffer
  try {
    pdf = await renderVerkaufRechnungPdf({
      betrieb: {
        name: bName,
        strasse: einst.betrieb_strasse ?? null,
        plzOrt: [einst.betrieb_plz, einst.betrieb_ort].filter(Boolean).join(' ') || null,
        telefon: einst.betrieb_telefon ?? null,
        email: einst.betrieb_email ?? null,
        website: einst.betrieb_website ?? null,
        uid: einst.betrieb_uid ?? null,
        logoUrl: einst.logo_url ?? null,
      },
      rechnung: { nummer: inhalt.nummer, datumIso: inhalt.datumIso, faelligkeitIso: inhalt.datumIso, lieferzeitraum: null },
      kunde: {
        name: kundeName,
        zHande: beleg.zh_kontakt ? kontaktAnzeigename(beleg.zh_kontakt) : null,
        strasse: kundeInfo?.strasse ?? null,
        plzOrt: kundeInfo ? [kundeInfo.plz, kundeInfo.ort].filter(Boolean).join(' ') || null : null,
      },
      positionen: inhalt.positionen,
      gesamt: inhalt.gesamt,
      gesamtNetto: inhalt.gesamtNetto,
      ustGruppen: inhalt.ustGruppen,
      skonto: null,
      bank: { iban: null, bic: null, zahlungszielTage: 0, faelligkeitIso: inhalt.datumIso },
      fusstext: einst.rechnung_fusstext ?? null,
      storno: inhalt.storno,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler bei der PDF-Erzeugung'
    return NextResponse.json({ error: `PDF-Erzeugung fehlgeschlagen: ${msg}` }, { status: 500 })
  }

  const subject = `Stornorechnung ${inhalt.nummer} zu Rechnung ${inhalt.storno.zuNummer} von ${bName}`
  const mailText = [
    kundeName ? `Sehr geehrte Damen und Herren, ${kundeName},` : 'Sehr geehrte Damen und Herren,',
    '',
    body.message?.trim() || `anbei erhalten Sie die Stornorechnung ${inhalt.nummer} zu unserer Rechnung ${inhalt.storno.zuNummer}.`,
    '',
    'Freundliche Grüße',
    bName,
  ].join('\n')

  const admin = createSupabaseAdminClient()
  const versand = await belegPerMailSenden({
    admin, tenantId, userId: authUser.id, an: recipient, betreff: subject, text: mailText,
    dateiname: `Stornorechnung-${inhalt.nummer || id}.pdf`, pdf, absenderName: bName,
  })
  if (!versand.ok) return NextResponse.json({ error: versand.fehler }, { status: versand.status })

  const sentAt = new Date().toISOString()
  // Versandvermerk am Stornobeleg (Benutzer schreiben rechnungen nicht direkt – Admin-Client nach der Prüfung oben)
  { type Aktualisieren = { update(v: Record<string, unknown>): { eq(k: string, v: string): { eq(k: string, v: string): PromiseLike<{ error: { message: string } | null }> } } }
    const { error: e } = await (admin.from('rechnungen' as never) as unknown as Aktualisieren)
      .update({ rechnung_versendet_am: sentAt, rechnung_versendet_an: recipient })
      .eq('id', id).eq('tenant_id', tenantId)
    if (e) void ereignisMelden({ art: 'db', quelle: 'send/stornobeleg', meldung: e.message }) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: aktFehler } = await (admin.from('aktivitaeten') as any).insert({
    tenant_id: tenantId,
    kontakt_id: beleg.kontakt_id ?? null,
    firma_id: beleg.firma_id ?? null,
    art: 'email',
    betreff: subject,
    beschreibung: `Stornorechnung ${inhalt.nummer} per E-Mail an ${recipient} versendet`,
    datum: wienTag(sentAt),
    erledigt: true,
    ganztags: true,
  })
  if (aktFehler) void ereignisMelden({ art: 'db', quelle: 'send/stornobeleg/aktivitaeten', meldung: aktFehler.message })

  return NextResponse.json({ ok: true, sentAt, sentTo: recipient, via: versand.via })
}
