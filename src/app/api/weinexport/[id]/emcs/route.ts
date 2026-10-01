import { createSupabaseServerClient } from '@/lib/supabase/server'
import { momentaufnahmeAnwenden } from '@/lib/stammdaten/momentaufnahme'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function fmt(d: string | null) { return d ? d.split('T')[0] : '' }

const XML_ENTITAETEN: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

/** Wert für einen XML-Elementinhalt: Sonderzeichen escapen und in XML 1.0 verbotene
 *  Steuerzeichen entfernen – ein Firmenname mit „&“ darf das e-AD nicht ungültig machen
 *  und Eingaben dürfen keine eigenen Elemente einschleusen. */
function x(wert: unknown): string {
  return String(wert ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"']/g, c => XML_ENTITAETEN[c])
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

  const [{ data: a }, { data: pos }, { data: b }] = await Promise.all([
    (supabase.from('exportauftraege') as any)
      .select('*, kontakte(vorname,nachname), firmen(name)')
      .eq('id', id).eq('tenant_id', tenantId)
      .is('storniert_am', null)   // KAN-150 F2: kein e-AD für einen stornierten Auftrag
      .single(),
    (supabase.from('exportauftrag_positionen') as any)
      .select('*, fuellungen(bezeichnung)').eq('exportauftrag_id', id).order('sort_order'),
    (admin.from('tenant_einstellungen') as any)
      .select('betrieb_name,betrieb_strasse,betrieb_plz,betrieb_ort,betrieb_uid')
      .eq('tenant_id', tenantId).maybeSingle(),
  ])

  if (!a) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })
  const auftrag = a as R; const betrieb = (b ?? {}) as R
  const positionen = (pos ?? []) as R[]
  momentaufnahmeAnwenden(auftrag, { kontakte: 'kontakt', firmen: 'firma' })   // KAN-150 F1c: Empfänger wie beim Anlegen des Auftrags
  const importeur = auftrag.firmen?.name ?? [auftrag.kontakte?.vorname, auftrag.kontakte?.nachname].filter(Boolean).join(' ') ?? ''

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- EMCS e-AD Dokument – Electronic Administrative Document -->
<!-- Generiert von software:112 | Bitte in EMCS AT importieren -->
<ieaad:IE801 xmlns:ieaad="urn:publicid:-:EC:DGTAXUD:EMCS:PHASE4:IE801:V3.13">
  <Header>
    <MessageSender>${x(betrieb.betrieb_uid ?? 'AT-UID-UNBEKANNT')}</MessageSender>
    <MessageRecipient>EMCS-AT</MessageRecipient>
    <DateOfPreparation>${x(fmt(auftrag.datum))}</DateOfPreparation>
    <MessageIdentifier>${x(auftrag.referenz ?? id.slice(0,8).toUpperCase())}</MessageIdentifier>
  </Header>
  <Body>
    <EAD>
      <LocalReferenceNumber>${x(auftrag.referenz)}</LocalReferenceNumber>
      <OriginTypeCode>1</OriginTypeCode>
      <DateOfDispatch>${x(fmt(auftrag.datum))}</DateOfDispatch>
      <InvoiceNumber>${x(auftrag.referenz)}</InvoiceNumber>
      <TransportArrangement>1</TransportArrangement>
      <ARCNumber>${x((auftrag as R).emcs_arc_nummer ?? 'PENDING')}</ARCNumber>

      <ConsignorTrader>
        <TraderExciseNumber>${x(betrieb.betrieb_uid)}</TraderExciseNumber>
        <TraderName>${x(betrieb.betrieb_name)}</TraderName>
        <StreetName>${x(betrieb.betrieb_strasse)}</StreetName>
        <City>${x(betrieb.betrieb_ort)}</City>
        <Postcode>${x(betrieb.betrieb_plz)}</Postcode>
        <CountryCode>AT</CountryCode>
      </ConsignorTrader>

      <ConsigneeTrader>
        <TraderName>${x(importeur)}</TraderName>
        <StreetName></StreetName>
        <City>${x(auftrag.destination_stadt)}</City>
        <CountryCode>${x(auftrag.destination_land?.slice(0,2).toUpperCase())}</CountryCode>
        <EoriNumber>${x(auftrag.eori_kunde)}</EoriNumber>
      </ConsigneeTrader>

      <TransportDetails>
        <TransportModeCode>${auftrag.transport_art === 'Schiff' ? '1' : auftrag.transport_art === 'Bahn' ? '2' : auftrag.transport_art === 'LKW' ? '3' : auftrag.transport_art === 'Flugzeug' ? '4' : '3'}</TransportModeCode>
      </TransportDetails>

      <BodyEAD>
${positionen.map((p: R, i: number) => `        <BodyRecordUniqueReference>${i + 1}</BodyRecordUniqueReference>
        <ExciseProductCode>W200</ExciseProductCode>
        <CnCode>${x(p.taric_code?.replace('.','') ?? '22042100')}</CnCode>
        <Quantity>${x(p.menge ?? 0)}</Quantity>
        <GrossWeight>${((parseFloat(p.menge)||0) * 1.25).toFixed(2)}</GrossWeight>
        <Description>${x(p.beschreibung ?? p.fuellungen?.bezeichnung)}</Description>`).join('\n')}
      </BodyEAD>
    </EAD>
  </Body>
</ieaad:IE801>`

  // Dateiname nur aus sicheren Zeichen – Anführungszeichen/Zeilenumbrüche in der Referenz
  // würden den Content-Disposition-Header zerlegen
  const dateiname = String(auftrag.referenz ?? id.slice(0,8)).replace(/[^A-Za-z0-9._-]/g, '_')
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="emcs-ead-${dateiname}.xml"`,
    },
  })
}