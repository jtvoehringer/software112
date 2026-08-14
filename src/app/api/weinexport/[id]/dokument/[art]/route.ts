import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function fmt(d: string | null) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function css() {
  return `<style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11pt;color:#222;padding:20mm 15mm}
    h1{font-size:16pt;font-weight:bold;text-align:center;margin-bottom:4mm}
    h2{font-size:12pt;font-weight:bold;margin:5mm 0 2mm}
    .subtitle{text-align:center;font-size:10pt;color:#666;margin-bottom:8mm}
    .box{border:1px solid #ccc;padding:4mm 5mm;margin-bottom:4mm;border-radius:3px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
    .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4mm}
    .label{font-size:8pt;color:#666;margin-bottom:1mm}
    .value{font-size:10pt;font-weight:500}
    table{width:100%;border-collapse:collapse;margin:3mm 0}
    th{background:#f5f5f5;border:1px solid #ccc;padding:2mm 3mm;font-size:9pt;text-align:left}
    td{border:1px solid #ddd;padding:2mm 3mm;font-size:10pt}
    .total{font-weight:bold;background:#f9f9f9}
    .stamp{border:2px solid #ccc;padding:3mm;min-height:20mm;margin-top:4mm;font-size:8pt;color:#999}
    .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8mm;margin-top:8mm}
    .sign-box{border-top:1px solid #333;padding-top:2mm;font-size:8pt;text-align:center}
    @media print{body{padding:0}@page{margin:15mm}}
  </style>`
}

function header(betrieb: R) {
  return `<div style="border-bottom:2px solid #333;padding-bottom:4mm;margin-bottom:6mm">
    <div style="font-size:13pt;font-weight:bold">${betrieb.betrieb_name ?? 'Weingut'}</div>
    <div style="font-size:9pt;color:#555">${[betrieb.betrieb_strasse, betrieb.betrieb_plz, betrieb.betrieb_ort].filter(Boolean).join(' · ')}</div>
  </div>`
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; art: string }> }
) {
  const { id: auftragId, art } = await params
  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const [{ data: auftrag }, { data: positionen }, { data: betriebData }] = await Promise.all([
    (supabase.from('exportauftraege') as any)
      .select('*, kontakte(vorname,nachname,email), firmen(name,email)')
      .eq('id', auftragId).eq('tenant_id', tenantId).single(),
    (supabase.from('exportauftrag_positionen') as any)
      .select('*, fuellungen(bezeichnung,flaschengroesse_ml)').eq('exportauftrag_id', auftragId).order('sort_order'),
    (admin.from('tenant_einstellungen') as any)
      .select('betrieb_name,betrieb_strasse,betrieb_plz,betrieb_ort,betrieb_land,betrieb_uid,rechnung_bank_iban')
      .eq('tenant_id', tenantId).maybeSingle(),
  ])

  if (!auftrag) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })

  const a   = auftrag as R
  const pos = (positionen ?? []) as R[]
  const b   = (betriebData ?? {}) as R
  const importeur = a.firmen?.name ?? [a.kontakte?.vorname, a.kontakte?.nachname].filter(Boolean).join(' ') ?? '–'
  const gesamtEUR = pos.reduce((s, p) => s + (parseFloat(p.menge)||0) * (parseFloat(p.preis_eur)||0), 0)

  let html = ''

  switch (art) {
    // ── V1/V2 Simplified Accompanying Document ────────────────────────────────
    case 'v1v2':
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>V1/V2 – ${a.referenz}</title>${css()}</head><body>
        ${header(b)}
        <h1>SIMPLIFIED ACCOMPANYING DOCUMENT (SAD)</h1>
        <p class="subtitle">V-Dokument für Weinbewegungen – Reg. (EG) Nr. 436/2009</p>
        <div class="grid2">
          <div class="box">
            <div class="label">Versender / Konsignant</div>
            <div class="value">${b.betrieb_name ?? '–'}</div>
            <div style="font-size:9pt;margin-top:1mm">${b.betrieb_strasse ?? ''}, ${b.betrieb_plz ?? ''} ${b.betrieb_ort ?? ''}</div>
            ${b.betrieb_uid ? `<div style="font-size:9pt">UID: ${b.betrieb_uid}</div>` : ''}
          </div>
          <div class="box">
            <div class="label">Empfänger / Konsignatar</div>
            <div class="value">${importeur}</div>
            <div style="font-size:9pt;margin-top:1mm">${a.destination_stadt ?? ''}, ${a.destination_land ?? ''}</div>
            ${a.eori_kunde ? `<div style="font-size:9pt">EORI: ${a.eori_kunde}</div>` : ''}
          </div>
        </div>
        <div class="grid3">
          <div class="box"><div class="label">Referenznummer</div><div class="value">${a.referenz ?? '–'}</div></div>
          <div class="box"><div class="label">Begleitdokument-Nr.</div><div class="value">&nbsp;</div></div>
          <div class="box"><div class="label">Datum</div><div class="value">${fmt(a.datum)}</div></div>
          <div class="box"><div class="label">Incoterms</div><div class="value">${a.incoterms ?? '–'}</div></div>
          <div class="box"><div class="label">Transportart</div><div class="value">${a.transport_art ?? '–'}</div></div>
          <div class="box"><div class="label">Ursprungsland</div><div class="value">${a.ursprungsland ?? 'AT'}</div></div>
        </div>
        <h2>Warenbeschreibung</h2>
        <table><thead><tr><th>Pos.</th><th>Bezeichnung</th><th>Menge</th><th>Einheit</th><th>TARIC</th><th>Wert EUR</th></tr></thead>
        <tbody>${pos.map((p,i) => `<tr>
          <td>${i+1}</td><td>${p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–'}</td>
          <td style="text-align:right">${p.menge}</td><td>${p.einheit}</td>
          <td style="font-family:monospace">${p.taric_code}</td>
          <td style="text-align:right">${((parseFloat(p.menge)||0)*(parseFloat(p.preis_eur)||0)).toFixed(2)}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="5" style="text-align:right">Gesamtwert EUR</td><td style="text-align:right">${gesamtEUR.toFixed(2)}</td></tr>
        </tbody></table>
        <div class="sign">
          <div class="sign-box">Ort, Datum</div>
          <div class="sign-box">Stempel Versender</div>
          <div class="sign-box">Unterschrift</div>
        </div>
      </body></html>`
      break

    // ── EUR.1 Ursprungszeugnis ────────────────────────────────────────────────
    case 'eur1':
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>EUR.1 – ${a.referenz}</title>${css()}</head><body>
        ${header(b)}
        <h1>WARENVERKEHRSBESCHEINIGUNG EUR.1</h1>
        <p class="subtitle">Movement Certificate – Used in preferential trade</p>
        <div class="grid2">
          <div class="box">
            <div class="label">1. Exporteur</div>
            <div class="value">${b.betrieb_name ?? '–'}</div>
            <div style="font-size:9pt">${b.betrieb_strasse ?? ''}, ${b.betrieb_plz ?? ''} ${b.betrieb_ort ?? ''}, Österreich</div>
          </div>
          <div class="box" style="border:2px solid #333;text-align:center">
            <div style="font-size:8pt;color:#666">2. Bescheinigung Nr.</div>
            <div style="font-size:18pt;font-weight:bold;color:#ccc;margin:3mm 0">EUR.1</div>
            <div style="font-size:8pt;color:#666">${a.referenz ?? ''}</div>
          </div>
          <div class="box">
            <div class="label">3. Empfänger</div>
            <div class="value">${importeur}</div>
            <div style="font-size:9pt">${a.destination_stadt ?? ''}, ${a.destination_land ?? ''}</div>
          </div>
          <div class="box">
            <div class="label">4. Land / Ländergruppe Ursprung</div>
            <div class="value">ÖSTERREICH (AT)</div>
          </div>
        </div>
        <div class="box">
          <div class="label">5. Bestimmungsland / -ländergruppe</div>
          <div class="value">${a.destination_land ?? '–'}</div>
        </div>
        <div class="box">
          <div class="label">6. Beförderungsangaben (Angabe freigestellt)</div>
          <div class="value">${a.transport_art ?? '–'} · ${a.incoterms ?? ''} · Lieferdatum: ${fmt(a.lieferdatum)}</div>
        </div>
        <h2>7. Warenbeschreibung / 8. Rohmasse (kg) / 9. Wert</h2>
        <table><thead><tr><th>Bezeichnung</th><th>Menge</th><th>Einheit</th><th>TARIC</th><th>Wert EUR</th></tr></thead>
        <tbody>${pos.map(p => `<tr>
          <td>${p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–'}</td>
          <td style="text-align:right">${p.menge}</td><td>${p.einheit}</td>
          <td style="font-family:monospace">${p.taric_code}</td>
          <td style="text-align:right">${((parseFloat(p.menge)||0)*(parseFloat(p.preis_eur)||0)).toFixed(2)}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="4" style="text-align:right">Gesamtwert EUR</td><td style="text-align:right">${gesamtEUR.toFixed(2)}</td></tr>
        </tbody></table>
        <div class="grid2" style="margin-top:6mm">
          <div class="stamp"><div style="font-weight:bold;margin-bottom:2mm">10. Sichtvermerk der Zollbehörde</div>Bescheinigung erteilt<br/><br/>Ort:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Datum:<br/>Stempel:</div>
          <div class="box">
            <div class="label">11. Erklärung des Exporteurs</div>
            <div style="font-size:9pt;margin-top:2mm">Der Unterzeichnete erklärt, dass die vorstehenden Angaben richtig sind und die Waren die für die Ausstellung dieser Bescheinigung erforderlichen Ursprungsbedingungen erfüllen.</div>
            <div style="margin-top:10mm;border-top:1px solid #333;padding-top:2mm;font-size:8pt;text-align:center">Ort, Datum · Unterschrift Exporteur</div>
          </div>
        </div>
      </body></html>`
      break

    // ── CMR Frachtbrief ──────────────────────────────────────────────────────
    case 'cmr':
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CMR – ${a.referenz}</title>${css()}</head><body>
        ${header(b)}
        <h1>INTERNATIONALER FRACHTBRIEF / CMR</h1>
        <p class="subtitle">Convention relative au contrat de transport international de marchandises par route</p>
        <div class="grid2">
          <div class="box">
            <div class="label">1. Absender (Name, Adresse, Land)</div>
            <div class="value">${b.betrieb_name ?? '–'}</div>
            <div style="font-size:9pt">${b.betrieb_strasse ?? ''}, ${b.betrieb_plz ?? ''} ${b.betrieb_ort ?? ''}</div>
            <div style="font-size:9pt">ÖSTERREICH</div>
          </div>
          <div class="box">
            <div class="label">2. Empfänger (Name, Adresse, Land)</div>
            <div class="value">${importeur}</div>
            <div style="font-size:9pt">${a.destination_stadt ?? ''}</div>
            <div style="font-size:9pt">${a.destination_land ?? ''}</div>
          </div>
          <div class="box">
            <div class="label">3. Auslieferungsort (Ort, Land)</div>
            <div class="value">${[a.destination_stadt, a.destination_land].filter(Boolean).join(', ')}</div>
          </div>
          <div class="box">
            <div class="label">4. Übernahmeort und -datum</div>
            <div class="value">${b.betrieb_ort ?? '–'}, ${fmt(a.datum)}</div>
          </div>
        </div>
        <div class="box">
          <div class="label">5. Beigefügte Dokumente</div>
          <div class="value">Lieferschein ${a.referenz ?? ''} · EUR.1 · Handelsrechnung</div>
        </div>
        <h2>6. Warenbeschreibung</h2>
        <table><thead><tr><th>Bezeichnung der Güter</th><th>Anzahl Pakete</th><th>Menge</th><th>Einheit</th><th>Bruttomasse</th></tr></thead>
        <tbody>${pos.map(p => `<tr>
          <td>${p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–'}</td>
          <td style="text-align:right">–</td>
          <td style="text-align:right">${p.menge}</td>
          <td>${p.einheit}</td>
          <td style="text-align:right">–</td>
        </tr>`).join('')}
        </tbody></table>
        <div class="grid3" style="margin-top:4mm">
          <div class="box"><div class="label">7. Frachtzahlung</div><div class="value">${a.incoterms ?? '–'}</div></div>
          <div class="box"><div class="label">8. TARIC / Zolltarif</div><div class="value">${pos[0]?.taric_code ?? '2204'}</div></div>
          <div class="box"><div class="label">9. Warenwert EUR</div><div class="value">${gesamtEUR.toFixed(2)}</div></div>
        </div>
        <div class="sign" style="margin-top:10mm">
          <div class="sign-box">Ort, Datum<br/>Absender<br/>Stempel / Unterschrift</div>
          <div class="sign-box">Ort, Datum<br/>Frachtführer<br/>Stempel / Unterschrift</div>
          <div class="sign-box">Ort, Datum<br/>Empfänger<br/>Stempel / Unterschrift</div>
        </div>
      </body></html>`
      break

    // ── Certificate of Origin ────────────────────────────────────────────────
    case 'certificate_of_origin':
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Certificate of Origin – ${a.referenz}</title>${css()}</head><body>
        ${header(b)}
        <h1>CERTIFICATE OF ORIGIN</h1>
        <p class="subtitle">Handelsursprungszeugnis / Certificat d'origine</p>
        <div class="grid2">
          <div class="box">
            <div class="label">Exporter / Exporteur</div>
            <div class="value">${b.betrieb_name ?? '–'}</div>
            <div style="font-size:9pt">${b.betrieb_strasse ?? ''}, ${b.betrieb_plz ?? ''} ${b.betrieb_ort ?? ''}</div>
            <div style="font-size:9pt">AUSTRIA</div>
          </div>
          <div class="box">
            <div class="label">Importer / Importeur</div>
            <div class="value">${importeur}</div>
            <div style="font-size:9pt">${a.destination_stadt ?? ''}, ${a.destination_land ?? ''}</div>
          </div>
          <div class="box">
            <div class="label">Country of Origin / Ursprungsland</div>
            <div class="value" style="font-size:14pt">AUSTRIA / ÖSTERREICH</div>
          </div>
          <div class="box">
            <div class="label">Country of Destination / Bestimmungsland</div>
            <div class="value">${a.destination_land ?? '–'}</div>
          </div>
        </div>
        <h2>Description of Goods / Warenbeschreibung</h2>
        <table><thead><tr><th>Description</th><th>Quantity</th><th>Unit</th><th>HS Code</th><th>Value EUR</th></tr></thead>
        <tbody>${pos.map(p => `<tr>
          <td>${p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–'} (Austrian Wine)</td>
          <td style="text-align:right">${p.menge}</td><td>${p.einheit}</td>
          <td style="font-family:monospace">${p.taric_code ?? '2204'}</td>
          <td style="text-align:right">${((parseFloat(p.menge)||0)*(parseFloat(p.preis_eur)||0)).toFixed(2)}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="4" style="text-align:right">Total Value EUR</td><td style="text-align:right">${gesamtEUR.toFixed(2)}</td></tr>
        </tbody></table>
        <div class="grid2" style="margin-top:8mm">
          <div class="stamp">
            <div style="font-weight:bold;margin-bottom:2mm">Certification by Chamber of Commerce / Wirtschaftskammer</div>
            <br/>Stamp / Stempel:<br/><br/><br/>Signature / Unterschrift:
          </div>
          <div class="box">
            <div class="label">Declaration by Exporter / Erklärung des Exporteurs</div>
            <div style="font-size:9pt;margin-top:2mm">The undersigned hereby declares that the above details and statements are correct and that the goods described originated in AUSTRIA.</div>
            <div style="margin-top:12mm;border-top:1px solid #333;padding-top:2mm;font-size:8pt;text-align:center">Place, Date / Ort, Datum · Signature / Unterschrift</div>
          </div>
        </div>
      </body></html>`
      break

    // ── Lieferschein ─────────────────────────────────────────────────────────
    case 'lieferschein':
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lieferschein – ${a.referenz}</title>${css()}</head><body>
        ${header(b)}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6mm">
          <h1 style="text-align:left;margin:0">LIEFERSCHEIN<br/><span style="font-size:10pt;font-weight:normal;color:#666">DELIVERY NOTE</span></h1>
          <div style="text-align:right">
            <div style="font-size:9pt;color:#666">Nr. / No.</div>
            <div style="font-size:14pt;font-weight:bold">${a.referenz ?? '–'}</div>
            <div style="font-size:9pt;color:#666">Datum: ${fmt(a.datum)}</div>
          </div>
        </div>
        <div class="grid2">
          <div class="box">
            <div class="label">Lieferant / Supplier</div>
            <div class="value">${b.betrieb_name ?? '–'}</div>
            <div style="font-size:9pt">${b.betrieb_strasse ?? ''}, ${b.betrieb_plz ?? ''} ${b.betrieb_ort ?? ''}, Österreich</div>
          </div>
          <div class="box">
            <div class="label">Empfänger / Recipient</div>
            <div class="value">${importeur}</div>
            <div style="font-size:9pt">${a.destination_stadt ?? ''}, ${a.destination_land ?? ''}</div>
          </div>
        </div>
        <div class="grid3">
          <div class="box"><div class="label">Lieferdatum / Delivery Date</div><div class="value">${fmt(a.lieferdatum)}</div></div>
          <div class="box"><div class="label">Incoterms</div><div class="value">${a.incoterms ?? '–'}</div></div>
          <div class="box"><div class="label">Transport / Carrier</div><div class="value">${a.transport_art ?? '–'}</div></div>
        </div>
        <table style="margin-top:4mm"><thead>
          <tr><th>Pos.</th><th>Bezeichnung / Description</th><th>Menge / Qty</th><th>Einheit / Unit</th><th>Artikel-Nr.</th></tr>
        </thead><tbody>
        ${pos.map((p,i) => `<tr>
          <td style="text-align:center">${i+1}</td>
          <td>${p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–'}${p.fuellungen?.flaschengroesse_ml ? ` (${p.fuellungen.flaschengroesse_ml}ml)` : ''}</td>
          <td style="text-align:right;font-weight:bold">${p.menge}</td>
          <td>${p.einheit}</td>
          <td style="font-family:monospace;font-size:9pt">${p.fullung_id ? p.fullung_id.slice(0,8).toUpperCase() : '–'}</td>
        </tr>`).join('')}
        </tbody></table>
        ${auftrag.notizen ? `<div class="box" style="margin-top:4mm"><div class="label">Bemerkungen / Remarks</div><div style="font-size:10pt">${a.notizen}</div></div>` : ''}
        <div class="sign" style="margin-top:12mm">
          <div class="sign-box">Ausgestellt von / Issued by</div>
          <div class="sign-box">Versender / Shipper</div>
          <div class="sign-box">Empfangen / Received by</div>
        </div>
      </body></html>`
      break

    // ── Exportrechnung ────────────────────────────────────────────────────────
    case 'rechnung':
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Exportrechnung – ${a.referenz}</title>${css()}</head><body>
        ${header(b)}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6mm">
          <h1 style="text-align:left;margin:0">EXPORTRECHNUNG<br/><span style="font-size:10pt;font-weight:normal;color:#666">COMMERCIAL INVOICE</span></h1>
          <div style="text-align:right">
            <div style="font-size:9pt;color:#666">Rechnungs-Nr. / Invoice No.</div>
            <div style="font-size:14pt;font-weight:bold">${a.referenz ?? '–'}</div>
            <div style="font-size:9pt;color:#666">Datum: ${fmt(a.datum)}</div>
          </div>
        </div>
        <div class="grid2">
          <div class="box">
            <div class="label">Verkäufer / Seller</div>
            <div class="value">${b.betrieb_name ?? '–'}</div>
            <div style="font-size:9pt">${b.betrieb_strasse ?? ''}, ${b.betrieb_plz ?? ''} ${b.betrieb_ort ?? ''}, Österreich</div>
            ${b.betrieb_uid ? `<div style="font-size:9pt">UID/VAT: ${b.betrieb_uid}</div>` : ''}
          </div>
          <div class="box">
            <div class="label">Käufer / Buyer</div>
            <div class="value">${importeur}</div>
            <div style="font-size:9pt">${a.destination_stadt ?? ''}, ${a.destination_land ?? ''}</div>
            ${a.eori_kunde ? `<div style="font-size:9pt">EORI: ${a.eori_kunde}</div>` : ''}
          </div>
        </div>
        <div class="grid3">
          <div class="box"><div class="label">Incoterms</div><div class="value">${a.incoterms ?? '–'}</div></div>
          <div class="box"><div class="label">Lieferdatum / Delivery</div><div class="value">${fmt(a.lieferdatum)}</div></div>
          <div class="box"><div class="label">Ursprungsland / Origin</div><div class="value">Austria</div></div>
        </div>
        <table style="margin-top:4mm"><thead>
          <tr><th>Pos.</th><th>Bezeichnung / Description</th><th>Menge</th><th>Einh.</th><th>TARIC</th><th>€/Einh.</th><th>Gesamtwert EUR</th></tr>
        </thead><tbody>
        ${pos.map((p,i) => `<tr>
          <td style="text-align:center">${i+1}</td>
          <td>${p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–'}${p.fuellungen?.flaschengroesse_ml ? ` (${p.fuellungen.flaschengroesse_ml}ml)` : ''}</td>
          <td style="text-align:right">${p.menge}</td>
          <td>${p.einheit}</td>
          <td style="font-family:monospace;font-size:9pt">${p.taric_code}</td>
          <td style="text-align:right">${parseFloat(p.preis_eur).toFixed(2)}</td>
          <td style="text-align:right;font-weight:bold">${((parseFloat(p.menge)||0)*(parseFloat(p.preis_eur)||0)).toFixed(2)}</td>
        </tr>`).join('')}
        <tr class="total">
          <td colspan="6" style="text-align:right">Gesamtwert / Total Value EUR</td>
          <td style="text-align:right">${gesamtEUR.toFixed(2)}</td>
        </tr>
        </tbody></table>
        <div class="box" style="margin-top:4mm;font-size:9pt">
          <strong>Zahlungsbedingungen / Payment Terms:</strong> ${a.incoterms ?? '–'} · 
          Währung / Currency: EUR · 
          Versicherungswert / Insurance Value: EUR ${a.versicherungswert ? parseFloat(a.versicherungswert).toFixed(2) : gesamtEUR.toFixed(2)}
        </div>
        ${b.rechnung_bank_iban ? `<div class="box" style="font-size:9pt"><strong>Bankverbindung / Bank Details:</strong> IBAN: ${b.rechnung_bank_iban}</div>` : ''}
        <div class="sign" style="margin-top:12mm">
          <div class="sign-box">Ort, Datum / Place, Date</div>
          <div class="sign-box">Aussteller / Issuer</div>
          <div class="sign-box">Stempel / Stamp</div>
        </div>
      </body></html>`
      break

    default:
      return NextResponse.json({ fehler: `Unbekannter Dokumenttyp: ${art}` }, { status: 400 })
  }

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="${art}-${a.referenz ?? auftragId}.html"`,
    },
  })
}
