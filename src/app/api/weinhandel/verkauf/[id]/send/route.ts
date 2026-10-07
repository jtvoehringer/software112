// POST /api/weinhandel/verkauf/[id]/send
// Erzeugt die Rechnung als PDF (react-pdf) und verschickt sie per E-Mail an
// den Kunden. Nutzt bewusst KEINEN neuen externen E-Mail-Dienst, sondern die
// bereits bestehende, pro Mandant konfigurierte Anbindung – genau wie
// /api/email/unified: zuerst die per-User verbundene Microsoft-365-Mailbox
// (user_email_connections), sonst die SMTP-Zugangsdaten des Betriebs
// (tenant_einstellungen). Aktualisiert verkaufsposten.rechnung_versendet_am /
// rechnung_versendet_an bei Erfolg und legt eine CRM-Aktivität an.

import { momentaufnahmeAnwenden } from '@/lib/stammdaten/momentaufnahme'
import { lieferadresseZeilen } from '@/lib/crm/lieferadressen'
import { landAnzeige } from '@/lib/katalog/laender'
import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { decryptPass } from '@/lib/email/crypto'
import { getValidUserAccessToken } from '@/lib/m365/graph'
import { renderVerkaufRechnungPdf } from '@/lib/pdf/verkaufRechnungPdf'
import { ereignisMelden } from '@/lib/system/ereignis'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { kontaktAnzeigename } from '@/lib/crm/titel'
import { losText } from '@/lib/handel/losnummer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 401 })
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership.role, 'warenwirtschaft')) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })
  const tenantId = membership.tenantId

  let body: { to?: string; message?: string } = {}
  try { body = await req.json() } catch { /* kein Body mitgeschickt – ok */ }

  // ── Rechnung + Betriebsdaten laden (RLS-scoped, zusätzlich explizit auf den
  // aktiven Mandanten gefiltert - siehe check-tenant-isolation.js) ───────────
  const [{ data: postenRaw }, { data: einstRaw }] = await Promise.all([
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer, storniert, skonto_pct, skonto_tage, skonto_aktiv,
        kontakt_id, firma_id, partner_daten, lieferadresse,
        kontakt:kontakte!kontakt_id(titel, vorname, nachname, titel_nachgestellt, email, strasse, plz, ort, zahlungsziel_tage),
        firma:firmen(name, email, strasse, plz, ort, zahlungsziel_tage),
        zh_kontakt:kontakte!zh_kontakt_id(titel, vorname, nachname, titel_nachgestellt),
        positionen:verkauf_positionen(
          typ, name, menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz,
          fuellung:fuellungen(jahrgang, flaschengroesse_ml, pruefnummer, chargennummer, datum)
        )
      `)
      .eq('id', id).eq('tenant_id', tenantId).eq('aktiv', true).maybeSingle(),
    (supabase.from('tenant_einstellungen') as any)
      .select(`anzeigename, logo_url, betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort,
               betrieb_telefon, betrieb_email, betrieb_website, betrieb_uid,
               rechnung_iban, rechnung_bic, rechnung_zahlungsziel, rechnung_fusstext`)
      .eq('tenant_id', tenantId).maybeSingle(),
  ])

  if (!postenRaw) return NextResponse.json({ error: 'Verkauf nicht gefunden' }, { status: 404 })
  const posten = momentaufnahmeAnwenden(postenRaw as R, ['kontakt', 'firma', 'zh_kontakt'])   // KAN-150 F1c
  if (posten.storniert) return NextResponse.json({ error: 'Stornierte Verkäufe können nicht versendet werden' }, { status: 400 })

  const positionen = (posten.positionen ?? []) as R[]
  const einst = (einstRaw ?? {}) as R

  function kundenName(p: R): string {
    if (p.kontakt) return kontaktAnzeigename(p.kontakt)   // Hotfix 05.10.2026: mit Titeln
    if (p.firma) return p.firma.name as string
    return 'Kunde'
  }
  const kundeInfo = posten.kontakt ?? posten.firma
  const kundeEmail: string | null = kundeInfo?.email ?? null
  const recipient = body.to?.trim() || kundeEmail || ''
  if (!recipient) {
    return NextResponse.json({ error: 'Keine Empfänger-E-Mail-Adresse vorhanden. Bitte beim Kunden hinterlegen oder manuell eingeben.' }, { status: 400 })
  }

  // ── Rechnungspositionen + Summen (identisch zur Bildschirm-/Druckansicht) ──
  const gesamt = positionen.reduce((s: number, p: R) => {
    if (p.preis_brutto == null) return s
    const brutto = Number(p.preis_brutto) * Number(p.menge)
    const rabatt = Number(p.rabatt_pct ?? 0) / 100
    const sonder = Number(p.sonderrabatt_pct ?? 0) / 100
    return s + brutto * (1 - rabatt) * (1 - sonder)
  }, 0)

  const ustGruppen = positionen.reduce((acc: Record<string, number>, pos: R) => {
    if (pos.preis_brutto == null) return acc
    const satz = Number(pos.ust_satz ?? 13)
    const brutto = Number(pos.preis_brutto) * Number(pos.menge)
    const rabatt = Number(pos.rabatt_pct ?? 0) / 100
    const sonder = Number(pos.sonderrabatt_pct ?? 0) / 100
    const effektiv = brutto * (1 - rabatt) * (1 - sonder)
    const netto = effektiv / (1 + satz / 100)
    const key = String(satz)
    acc[key] = (acc[key] ?? 0) + netto
    return acc
  }, {})
  const gesamtNetto = Object.values(ustGruppen).reduce((s: number, n) => s + (n as number), 0)

  // Zahlungsziel kommt seit 6.8.2026 vom Kunden (Kontakt/Firma), nicht mehr vom
  // Betrieb (tenant_einstellungen.rechnung_zahlungsziel ist nur noch träge
  // Altdaten). 0 ist ein gültiger, bewusster Wert ("bei Erhalt") - deshalb hier
  // bewusst `??` statt `||`, damit eine hinterlegte 0 nicht überschrieben wird.
  const zahlZiel = posten.kontakt?.zahlungsziel_tage ?? posten.firma?.zahlungsziel_tage ?? 14
  const faelligkeitsDatum = new Date(posten.datum)
  faelligkeitsDatum.setDate(faelligkeitsDatum.getDate() + zahlZiel)

  const skontoAktiv = !!posten.skonto_aktiv && (posten.skonto_pct ?? 0) > 0
  const skonto = skontoAktiv ? {
    pct: posten.skonto_pct,
    datumIso: new Date(new Date(posten.datum).setDate(new Date(posten.datum).getDate() + (posten.skonto_tage ?? 0))).toISOString(),
    betrag: (gesamt * (posten.skonto_pct ?? 0)) / 100,
  } : null

  const pdfPositionen = positionen.map((pos: R) => {
    const brutto = pos.preis_brutto != null ? Number(pos.preis_brutto) * Number(pos.menge) : null
    const rabattTotal = Number(pos.rabatt_pct ?? 0) + Number(pos.sonderrabatt_pct ?? 0)
    const summe = brutto != null
      ? brutto * (1 - Number(pos.rabatt_pct ?? 0) / 100) * (1 - Number(pos.sonderrabatt_pct ?? 0) / 100)
      : null
    const sub: string[] = []
    if (pos.fuellung?.jahrgang) sub.push(String(pos.fuellung.jahrgang))
    if (pos.fuellung?.flaschengroesse_ml) sub.push(FLASCHEN_LABEL[pos.fuellung.flaschengroesse_ml] ?? `${pos.fuellung.flaschengroesse_ml} ml`)
    if (pos.typ === 'tank') sub.push('Tankverkauf')
    // KAN-92: Prüfnummer, Los und Abfülldatum je Flaschenposition (wie Lieferschein und Rechnung)
    const los = losText(pos.fuellung)
    if (los) sub.push(los)
    return {
      name: pos.name as string,
      sub: sub.length > 0 ? sub.join(' · ') : null,
      menge: Number(pos.menge),
      einheit: pos.einheit as string,
      preisBrutto: pos.preis_brutto != null ? Number(pos.preis_brutto) : null,
      rabattPct: rabattTotal,
      summe,
    }
  })

  const bName = einst.betrieb_name ?? einst.anzeigename ?? 'Weingut'

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderVerkaufRechnungPdf({
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
      rechnung: {
        nummer: posten.rechnungsnummer ?? null,
        datumIso: posten.datum,
        faelligkeitIso: faelligkeitsDatum.toISOString(),
      },
      kunde: {
        name: kundenName(posten),
        zHande: posten.zh_kontakt ? kontaktAnzeigename(posten.zh_kontakt) : null,
        strasse: kundeInfo?.strasse ?? null,
        plzOrt: kundeInfo ? [kundeInfo.plz, kundeInfo.ort].filter(Boolean).join(' ') || null : null,
      },
      lieferadresse: lieferadresseZeilen(posten.lieferadresse ?? null, iso => landAnzeige(iso)),   // KAN-176
      positionen: pdfPositionen,
      gesamt,
      gesamtNetto,
      ustGruppen,
      skonto,
      bank: {
        iban: einst.rechnung_iban ?? null,
        bic: einst.rechnung_bic ?? null,
        zahlungszielTage: zahlZiel,
        faelligkeitIso: faelligkeitsDatum.toISOString(),
      },
      fusstext: einst.rechnung_fusstext ?? null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler bei der PDF-Erzeugung'
    return NextResponse.json({ error: `PDF-Erzeugung fehlgeschlagen: ${msg}` }, { status: 500 })
  }

  const filename = `Rechnung-${posten.rechnungsnummer || id}.pdf`
  const subject = `Rechnung ${posten.rechnungsnummer || ''} von ${bName}`.trim()
  const greetingName = kundenName(posten)
  const mailText = [
    greetingName ? `Sehr geehrte Damen und Herren, ${greetingName},` : 'Sehr geehrte Damen und Herren,',
    '',
    body.message?.trim() || `anbei erhalten Sie die Rechnung ${posten.rechnungsnummer || ''}.`,
    '',
    'Freundliche Grüße',
    bName,
  ].join('\n')

  const admin = createSupabaseAdminClient()

  // ── Per-User M365-Mailbox hat höchste Priorität (wie /api/email/unified) ──
  const { data: userCfgRaw } = await (admin.from('user_email_connections') as any)
    .select('id, m365_aktiv, m365_access_token_enc, m365_refresh_token_enc, m365_token_expires_at')
    .eq('tenant_id', tenantId).eq('user_id', authUser.id).maybeSingle()
  const userCfg = userCfgRaw as R | null

  let sentVia: 'm365' | 'smtp' | null = null

  try {
    if (userCfg?.m365_aktiv && userCfg?.m365_access_token_enc) {
      const { data: tcfgRaw } = await (admin.from('tenant_einstellungen') as any)
        .select('m365_tenant_id, m365_client_id, m365_client_secret_enc')
        .eq('tenant_id', tenantId).maybeSingle()
      const token = await getValidUserAccessToken(userCfg, tcfgRaw as R, admin, tenantId, authUser.id)

      const draftRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          body: { contentType: 'Text', content: mailText },
          toRecipients: [{ emailAddress: { address: recipient } }],
          attachments: [{
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: filename,
            contentBytes: pdfBuffer.toString('base64'),
          }],
        }),
      })
      if (!draftRes.ok) throw new Error(`Graph-Entwurf fehlgeschlagen: ${draftRes.status} ${await draftRes.text()}`)
      const draft = await draftRes.json() as R
      if (draft.id) {
        const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        })
        if (!sendRes.ok) throw new Error(`Graph-Versand fehlgeschlagen: ${sendRes.status} ${await sendRes.text()}`)
      }
      sentVia = 'm365'
    } else {
      const { data: tenantCfgRaw } = await (admin.from('tenant_einstellungen') as any)
        .select('email_modul_aktiv, email_smtp_host, email_smtp_port, email_smtp_user, email_smtp_pass_enc, email_smtp_from_name')
        .eq('tenant_id', tenantId).maybeSingle()
      const c = tenantCfgRaw as R | null
      if (!c?.email_modul_aktiv || !c.email_smtp_host || !c.email_smtp_user || !c.email_smtp_pass_enc) {
        return NextResponse.json({
          error: 'Kein E-Mail-Versand konfiguriert. Bitte in den Admin-Einstellungen eine Microsoft-365-Mailbox verbinden oder SMTP-Zugangsdaten hinterlegen.',
        }, { status: 400 })
      }
      const pass = decryptPass(c.email_smtp_pass_enc)
      const transporter = nodemailer.createTransport({
        host: c.email_smtp_host,
        port: Number(c.email_smtp_port) || 587,
        secure: Number(c.email_smtp_port) === 465,
        auth: { user: c.email_smtp_user, pass },
      })
      await transporter.sendMail({
        from: `"${c.email_smtp_from_name ?? bName}" <${c.email_smtp_user}>`,
        to: recipient,
        subject,
        text: mailText,
        attachments: [{ filename, content: pdfBuffer }],
      })
      sentVia = 'smtp'
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unbekannter Fehler beim Versand'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const sentAt = new Date().toISOString()
  { const { error: e } = await (supabase.from('verkaufsposten') as any)
    .update({ rechnung_versendet_am: sentAt, rechnung_versendet_an: recipient })
    .eq('id', id).eq('tenant_id', tenantId)
    if (e) void ereignisMelden({ art: 'db', quelle: 'send/verkaufsposten', meldung: e.message }) }

  await (admin.from('aktivitaeten') as any).insert({
    tenant_id: tenantId,
    kontakt_id: posten.kontakt_id ?? null,
    firma_id: posten.firma_id ?? null,
    art: 'email',
    betreff: subject,
    beschreibung: `Rechnung ${posten.rechnungsnummer ?? ''} per E-Mail an ${recipient} versendet`.trim(),
    datum: sentAt.split('T')[0],
    erledigt: true,
    ganztags: true,
  })

  return NextResponse.json({ ok: true, sentAt, sentTo: recipient, via: sentVia })
}
