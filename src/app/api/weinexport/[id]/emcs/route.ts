import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function fmt(d: string | null) { return d ? d.split('T')[0] : '' }

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()
  const tenantId = await getTenantId(supabase)
  if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

  const [{ data: a }, { data: pos }, { data: b }] = await Promise.all([
    (supabase.from('exportauftraege') as any)
      .select('*, kontakte(vorname,nachname), firmen(name)')
      .eq('id', id).single(),
    (supabase.from('exportauftrag_positionen') as any)
      .select('*, fuellungen(bezeichnung)').eq('exportauftrag_id', id).order('sort_order'),
    (admin.from('tenant_einstellungen') as any)
      .select('betrieb_name,betrieb_strasse,betrieb_plz,betrieb_ort,betrieb_uid')
      .eq('tenant_id', tenantId).maybeSingle(),
  ])

  if (!a) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })
  const auftrag = a as R; const betrieb = (b ?? {}) as R
  const positionen = (pos ?? []) as R[]
  const importeur = auftrag.firmen?.name ?? [auftrag.kontakte?.vorname, auftrag.kontakte?.nachname].filter(Boolean).join(' ') ?? ''

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- EMCS e-AD Dokument – Electronic Administrative Document -->
<!-- Generiert von software:112 | Bitte in EMCS AT importieren -->
<ieaad:IE801 xmlns:ieaad="urn:publicid:-:EC:DGTAXUD:EMCS:PHASE4:IE801:V3.13">
  <Header>
    <MessageSender>${betrieb.betrieb_uid ?? 'AT-UID-UNBEKANNT'}</MessageSender>
    <MessageRecipient>EMCS-AT</MessageRecipient>
    <DateOfPreparation>${fmt(auftrag.datum)}</DateOfPreparation>
    <MessageIdentifier>${auftrag.referenz ?? id.slice(0,8).toUpperCase()}</MessageIdentifier>
  </Header>
  <Body>
    <EAD>
      <LocalReferenceNumber>${auftrag.referenz ?? ''}</LocalReferenceNumber>
      <OriginTypeCode>1</OriginTypeCode>
      <DateOfDispatch>${fmt(auftrag.datum)}</DateOfDispatch>
      <InvoiceNumber>${auftrag.referenz ?? ''}</InvoiceNumber>
      <TransportArrangement>1</TransportArrangement>
      <ARCNumber>${(auftrag as R).emcs_arc_nummer ?? 'PENDING'}</ARCNumber>

      <ConsignorTrader>
        <TraderExciseNumber>${betrieb.betrieb_uid ?? ''}</TraderExciseNumber>
        <TraderName>${betrieb.betrieb_name ?? ''}</TraderName>
        <StreetName>${betrieb.betrieb_strasse ?? ''}</StreetName>
        <City>${betrieb.betrieb_ort ?? ''}</City>
        <Postcode>${betrieb.betrieb_plz ?? ''}</Postcode>
        <CountryCode>AT</CountryCode>
      </ConsignorTrader>

      <ConsigneeTrader>
        <TraderName>${importeur}</TraderName>
        <StreetName></StreetName>
        <City>${auftrag.destination_stadt ?? ''}</City>
        <CountryCode>${auftrag.destination_land?.slice(0,2).toUpperCase() ?? ''}</CountryCode>
        <EoriNumber>${auftrag.eori_kunde ?? ''}</EoriNumber>
      </ConsigneeTrader>

      <TransportDetails>
        <TransportModeCode>${auftrag.transport_art === 'Schiff' ? '1' : auftrag.transport_art === 'Bahn' ? '2' : auftrag.transport_art === 'LKW' ? '3' : auftrag.transport_art === 'Flugzeug' ? '4' : '3'}</TransportModeCode>
      </TransportDetails>

      <BodyEAD>
${positionen.map((p: R, i: number) => `        <BodyRecordUniqueReference>${i + 1}</BodyRecordUniqueReference>
        <ExciseProductCode>W200</ExciseProductCode>
        <CnCode>${p.taric_code?.replace('.','') ?? '22042100'}</CnCode>
        <Quantity>${p.menge ?? 0}</Quantity>
        <GrossWeight>${((parseFloat(p.menge)||0) * 1.25).toFixed(2)}</GrossWeight>
        <Description>${p.beschreibung ?? p.fuellungen?.bezeichnung ?? ''}</Description>`).join('\n')}
      </BodyEAD>
    </EAD>
  </Body>
</ieaad:IE801>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="emcs-ead-${auftrag.referenz ?? id.slice(0,8)}.xml"`,
    },
  })
}
