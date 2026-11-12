import { createSupabaseServerClient } from '@/lib/supabase/server'
import { momentaufnahmeAnwenden } from '@/lib/stammdaten/momentaufnahme'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { escHtml as e, escHtmlMehrzeilig, sichererDateiname, DOKUMENT_CSP } from '@/lib/utils/html'
import { druckCsp, druckleiste, DRUCKLEISTE_CSS } from '@/lib/utils/druckknopf'
import { landAnzeige } from '@/lib/katalog/laender'   // KAN-187: ISO-Code → Ländername (Altdaten mit Namen unverändert)
import { kontaktAnzeigename } from '@/lib/crm/titel'
import { modulKonflikt } from '@/lib/auth/modul'
import { kgText, sendungsGewicht } from '@/lib/export/gewicht'   // KAN-414: Netto-/Bruttogewicht aus Füllung und Verpackung
import { eurText, gesamtWert, positionsWert } from '@/lib/export/exportWerte'   // Sweep 77: kaufmännisch, Gesamt = Σ Zeilen
import { ladeExportauftrag } from '@/lib/behoerden/exportauftrag'   // KAN-433: abgeleitete Angaben je Position (KAN-432)
import { MUSTERSENDUNG_VERMERK, farbeGroesse, kartonAufschluesselung, kartonNummern, kartonText, kartonsGesamt, warenbeschreibung, zahlDe } from '@/lib/export/dokumente'
import { fehlerText } from '@/lib/fehler'
import { lieferfall } from '@/lib/export/grunddaten'
import { PROFORMA_VERMERK, befreiung, rechnungsSumme, ursprungserklaerung } from '@/lib/export/rechnungTexte'   // KAN-434
export const dynamic = 'force-dynamic'
// KAN-141 (01.10.2026): Dokument-CSP plus genau ein per Hash freigegebenes Skript für den Drucken-Knopf
const DRUCK_CSP = druckCsp(DOKUMENT_CSP)
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function fmt(d: string | null) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' })
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
    th{background:#F7F8FA;border:1px solid #ccc;padding:2mm 3mm;font-size:9pt;text-align:left}
    td{border:1px solid #ddd;padding:2mm 3mm;font-size:10pt}
    .total{font-weight:bold;background:#F7F8FA}
    .stamp{border:2px solid #ccc;padding:3mm;min-height:20mm;margin-top:4mm;font-size:8pt;color:#999}
    .sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8mm;margin-top:8mm}
    .sign-box{border-top:1px solid #333;padding-top:2mm;font-size:8pt;text-align:center}
    .wb{font-size:8.5pt;color:#555;margin-top:.5mm}
    .hinweis-leiste{border:1px solid #E0B252;background:#FFF7E0;color:#6B4E00;padding:3mm 4mm;margin-bottom:6mm;border-radius:3px;font-size:9pt}
    .hinweis-leiste ul{margin:1mm 0 0 5mm}
    .steuer{border:1px solid #333;padding:2mm 4mm;margin-top:4mm;font-size:9.5pt;font-weight:bold}
    .ursprung{border:1px solid #ccc;padding:3mm 4mm;margin-top:4mm;font-size:9pt;line-height:1.5;border-radius:3px}
    .muster{border:2px solid #333;padding:2mm 4mm;margin-bottom:4mm;font-size:10pt;font-weight:bold;text-align:center}
    @media print{body{padding:0}@page{margin:15mm}.hinweis-leiste{display:none}}
    ${DRUCKLEISTE_CSS}
  </style>`
}

function header(betrieb: R) {
  return `<div style="border-bottom:2px solid #333;padding-bottom:4mm;margin-bottom:6mm">
    <div style="font-size:13pt;font-weight:bold">${e(betrieb.betrieb_name ?? 'Weingut')}</div>
    <div style="font-size:9pt;color:#555">${e([betrieb.betrieb_strasse, betrieb.betrieb_plz, betrieb.betrieb_ort].filter(Boolean).join(' · '))}</div>
  </div>`
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; art: string }> }
) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const ohneModul = await modulKonflikt('modul_export')   // KAN-6: Paket-Modul auch in der Route
  if (ohneModul) return ohneModul
  const { id: auftragId, art } = await params
  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

  const [{ data: auftrag, error: auftragErr }, { data: positionen, error: posErr }, { data: betriebData, error: betriebErr }] = await Promise.all([
    // storno-sichtbar: der Druck zeigt auch stornierte Aufträge, mit Vermerk (KAN-150 F2)
    (supabase.from('exportauftraege') as any)
      .select('*, kontakte(titel,vorname,nachname,titel_nachgestellt,email), firmen(name,email)')
      .eq('id', auftragId).eq('tenant_id', tenantId).single(),
    (supabase.from('exportauftrag_positionen') as any)
      .select('*, fuellungen(bezeichnung,flaschengroesse_ml,leergewicht_g)').eq('exportauftrag_id', auftragId).order('sort_order').order('id'),
    (admin.from('tenant_einstellungen') as any)
      .select('betrieb_name,betrieb_strasse,betrieb_plz,betrieb_ort,betrieb_uid,betrieb_eori,betrieb_rex_nummer,betrieb_ea_bewilligung,rechnung_iban,rechnung_bic')   // Sweep 20.9.2026: betrieb_land/rechnung_bank_iban gab es nicht – Abfrage brach
      .eq('tenant_id', tenantId).maybeSingle(),
  ])

  // KAN-253: sonst entstünde ein Dokument ohne Positionen bzw. ohne Betriebsdaten (nur „keine Zeile“ heißt 404)
  const ladeFehler = (auftragErr && auftragErr.code !== 'PGRST116' ? auftragErr : null) ?? posErr ?? betriebErr
  if (ladeFehler) return NextResponse.json({ fehler: 'Exportauftrag konnte nicht geladen werden: ' + ladeFehler.message }, { status: 500 })
  if (!auftrag) return NextResponse.json({ fehler: 'Nicht gefunden' }, { status: 404 })

  const a   = auftrag as R
  const pos = (positionen ?? []) as R[]
  const b   = (betriebData ?? {}) as R
  momentaufnahmeAnwenden(a, { kontakte: 'kontakt', firmen: 'firma' })   // KAN-150 F1c: Empfänger wie beim Anlegen des Auftrags
  const importeur = a.firmen?.name ?? (a.kontakte ? kontaktAnzeigename(a.kontakte) : '') ?? '–'
  const gesamtEUR = gesamtWert(pos)
  // KAN-414: Gewichte je Position und Sendung; fehlt eine Angabe, bleibt das Feld leer (kein Schätzwert)
  const gew = sendungsGewicht(pos.map(p => ({ menge: p.menge, einheit: p.einheit, flaschen_je_karton: p.flaschen_je_karton, fuellung: p.fuellungen ?? null })), a.verpackung_kg)
  const kg = (n: number | null | undefined) => kgText(n) || '–'
  const kgMit = (n: number | null | undefined) => (n == null ? '–' : kgText(n) + ' kg')   // mit Einheit
  const mitVerpackung = gew.verpackungKg > 0 ? ' (inkl. Verpackung)' : ''
  const verpackungText = gew.verpackungKg > 0 ? ' (inkl. Verpackung ' + kgText(gew.verpackungKg) + ' kg)' : ''
  const verpackungTextEn = gew.verpackungKg > 0 ? ' (Brutto inkl. Verpackung / gross incl. packaging ' + kgText(gew.verpackungKg) + ' kg)' : ''

  // KAN-433: abgeleitete Angaben je Position (Liter, Kartons, Alkohol, Prüfnummer, Farbe …) aus derselben Ladefunktion
  // wie Detailseite und CSV – gleiche Reihenfolge (sort_order, id). Fehlende Werte bleiben leer („–“), nie geschätzt.
  let erg: Awaited<ReturnType<typeof ladeExportauftrag>>
  try {
    erg = await ladeExportauftrag(supabase, tenantId, { id: auftragId })
  } catch (err) {
    return NextResponse.json({ fehler: 'Exportauftrag konnte nicht geladen werden: ' + fehlerText(err) }, { status: 500 })
  }
  const dz = erg && erg.zeilen.length === pos.length ? erg.zeilen : []
  /** zweite Zeile unter der Bezeichnung: Jahrgang · Farbe · Flaschengröße · alc. % vol · Prüfnr. · Flaschen/Kartons · Liter */
  const wb = (i: number) => { const text = dz[i] ? warenbeschreibung(dz[i]) : ''; return text ? `<div class="wb">${e(text)}</div>` : '' }
  const fehlt = [...(erg?.grunddaten.hinweise.map(h => h.text) ?? []), ...(gew.hinweis ? [gew.hinweis] : [])]
  // nur am Bildschirm (nicht im Druck); ohne Link – das Dokument läuft in einer eigenen Sandbox (KAN-138)
  const hinweisLeiste = fehlt.length === 0 ? '' : `<div class="hinweis-leiste"><strong>Für dieses Dokument fehlt noch:</strong>
    <ul>${fehlt.slice(0, 8).map(text => `<li>${e(text)}</li>`).join('')}${fehlt.length > 8 ? `<li>… und ${e(fehlt.length - 8)} weitere</li>` : ''}</ul>
    <div style="margin-top:1mm">Eintragen über die Liste „Für die Dokumente fehlt noch …“ am Exportauftrag. Fehlende Angaben stehen im Dokument als „–“.</div></div>`
  const leiste = druckleiste() + hinweisLeiste
  const muster = a.mustersendung ? `<div class="muster">${e(MUSTERSENDUNG_VERMERK)}</div>` : ''

  // KAN-138: jede Interpolation aus DB-/Benutzerdaten läuft über e() (escHtml) bzw.
  // escHtmlMehrzeilig – nur css() und header(b) liefern bewusst fertiges HTML.
  let html = ''

  switch (art) {
    // ── V1/V2 Simplified Accompanying Document ────────────────────────────────
    case 'v1v2':
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>V1/V2 – ${e(a.referenz)}</title>${css()}</head><body>${druckleiste()}
        ${header(b)}
        <h1>SIMPLIFIED ACCOMPANYING DOCUMENT (SAD)</h1>
        <p class="subtitle">V-Dokument für Weinbewegungen – Reg. (EG) Nr. 436/2009</p>
        <div class="grid2">
          <div class="box">
            <div class="label">Versender / Konsignant</div>
            <div class="value">${e(b.betrieb_name ?? '–')}</div>
            <div style="font-size:9pt;margin-top:1mm">${e(b.betrieb_strasse ?? '')}, ${e(b.betrieb_plz ?? '')} ${e(b.betrieb_ort ?? '')}</div>
            ${b.betrieb_uid ? `<div style="font-size:9pt">UID: ${e(b.betrieb_uid)}</div>` : ''}
          </div>
          <div class="box">
            <div class="label">Empfänger / Konsignatar</div>
            <div class="value">${e(importeur)}</div>
            <div style="font-size:9pt;margin-top:1mm">${e(a.destination_stadt ?? '')}, ${e(landAnzeige(a.destination_land))}</div>
            ${a.eori_kunde ? `<div style="font-size:9pt">EORI: ${e(a.eori_kunde)}</div>` : ''}
          </div>
        </div>
        <div class="grid3">
          <div class="box"><div class="label">Referenznummer</div><div class="value">${e(a.referenz ?? '–')}</div></div>
          <div class="box"><div class="label">Begleitdokument-Nr.</div><div class="value">&nbsp;</div></div>
          <div class="box"><div class="label">Datum</div><div class="value">${e(fmt(a.datum))}</div></div>
          <div class="box"><div class="label">Incoterms</div><div class="value">${e(a.incoterms ?? '–')}</div></div>
          <div class="box"><div class="label">Transportart</div><div class="value">${e(a.transport_art ?? '–')}</div></div>
          <div class="box"><div class="label">Ursprungsland</div><div class="value">${e(a.ursprungsland ?? 'AT')}</div></div>
        </div>
        <h2>Warenbeschreibung</h2>
        <table><thead><tr><th>Pos.</th><th>Bezeichnung</th><th>Menge</th><th>Einheit</th><th>TARIC</th><th>Wert EUR</th></tr></thead>
        <tbody>${pos.map((p,i) => `<tr>
          <td>${i+1}</td><td>${e(p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–')}</td>
          <td style="text-align:right">${e(p.menge)}</td><td>${e(p.einheit)}</td>
          <td style="font-family:monospace">${e(p.taric_code)}</td>
          <td style="text-align:right">${e(eurText(positionsWert(p)))}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="5" style="text-align:right">Gesamtwert EUR</td><td style="text-align:right">${e(eurText(gesamtEUR))}</td></tr>
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
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>EUR.1 – ${e(a.referenz)}</title>${css()}</head><body>${leiste}
        ${header(b)}
        <h1>WARENVERKEHRSBESCHEINIGUNG EUR.1</h1>
        <p class="subtitle">Movement Certificate – Used in preferential trade</p>
        <div class="grid2">
          <div class="box">
            <div class="label">1. Exporteur</div>
            <div class="value">${e(b.betrieb_name ?? '–')}</div>
            <div style="font-size:9pt">${e(b.betrieb_strasse ?? '')}, ${e(b.betrieb_plz ?? '')} ${e(b.betrieb_ort ?? '')}, Österreich</div>
          </div>
          <div class="box" style="border:2px solid #333;text-align:center">
            <div style="font-size:8pt;color:#666">2. Bescheinigung Nr.</div>
            <div style="font-size:18pt;font-weight:bold;color:#ccc;margin:3mm 0">EUR.1</div>
            <div style="font-size:8pt;color:#666">${e(a.referenz ?? '')}</div>
          </div>
          <div class="box">
            <div class="label">3. Empfänger</div>
            <div class="value">${e(importeur)}</div>
            <div style="font-size:9pt">${e(a.destination_stadt ?? '')}, ${e(landAnzeige(a.destination_land))}</div>
          </div>
          <div class="box">
            <div class="label">4. Land / Ländergruppe Ursprung</div>
            <div class="value">ÖSTERREICH (AT)</div>
          </div>
        </div>
        <div class="box">
          <div class="label">5. Bestimmungsland / -ländergruppe</div>
          <div class="value">${e(landAnzeige(a.destination_land) || '–')}</div>
        </div>
        <div class="box">
          <div class="label">6. Beförderungsangaben (Angabe freigestellt)</div>
          <div class="value">${e(a.transport_art ?? '–')} · ${e(a.incoterms ?? '')} · Lieferdatum: ${e(fmt(a.lieferdatum))}</div>
        </div>
        <h2>7. Warenbeschreibung / 8. Rohmasse (kg) / 9. Wert</h2>
        <table><thead><tr><th>Bezeichnung</th><th>Menge</th><th>Einheit</th><th>TARIC</th><th>Rohmasse kg</th><th>Wert EUR</th></tr></thead>
        <tbody>${pos.map((p, i) => `<tr>
          <td>${e(p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–')}${wb(i)}</td>
          <td style="text-align:right">${e(p.menge)}</td><td>${e(p.einheit)}</td>
          <td style="font-family:monospace">${e(p.taric_code)}</td>
          <td style="text-align:right">${e(kg(gew.positionen[i]?.bruttoKg))}</td>
          <td style="text-align:right">${e(eurText(positionsWert(p)))}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="4" style="text-align:right">Rohmasse gesamt kg${e(mitVerpackung)} / Gesamtwert EUR</td><td style="text-align:right">${e(kg(gew.bruttoKg))}</td><td style="text-align:right">${e(eurText(gesamtEUR))}</td></tr>
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
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CMR – ${e(a.referenz)}</title>${css()}</head><body>${leiste}
        ${header(b)}
        <h1>INTERNATIONALER FRACHTBRIEF / CMR</h1>
        <p class="subtitle">Convention relative au contrat de transport international de marchandises par route</p>
        <div class="grid2">
          <div class="box">
            <div class="label">1. Absender (Name, Adresse, Land)</div>
            <div class="value">${e(b.betrieb_name ?? '–')}</div>
            <div style="font-size:9pt">${e(b.betrieb_strasse ?? '')}, ${e(b.betrieb_plz ?? '')} ${e(b.betrieb_ort ?? '')}</div>
            <div style="font-size:9pt">ÖSTERREICH</div>
          </div>
          <div class="box">
            <div class="label">2. Empfänger (Name, Adresse, Land)</div>
            <div class="value">${e(importeur)}</div>
            <div style="font-size:9pt">${e(a.destination_stadt ?? '')}</div>
            <div style="font-size:9pt">${e(landAnzeige(a.destination_land))}</div>
          </div>
          <div class="box">
            <div class="label">3. Auslieferungsort (Ort, Land)</div>
            <div class="value">${e([a.destination_stadt, landAnzeige(a.destination_land)].filter(Boolean).join(', '))}</div>
          </div>
          <div class="box">
            <div class="label">4. Übernahmeort und -datum</div>
            <div class="value">${e(b.betrieb_ort ?? '–')}, ${e(fmt(a.datum))}</div>
          </div>
        </div>
        <div class="box">
          <div class="label">5. Beigefügte Dokumente</div>
          <div class="value">Lieferschein ${e(a.referenz ?? '')} · EUR.1 · Handelsrechnung</div>
        </div>
        <h2>6. Warenbeschreibung</h2>
        <table><thead><tr><th>Bezeichnung der Güter</th><th>Anzahl Pakete</th><th>Menge</th><th>Einheit</th><th>Bruttomasse</th></tr></thead>
        <tbody>${pos.map((p, i) => `<tr>
          <td>${e(p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–')}${wb(i)}</td>
          <td style="text-align:right">${e(dz[i]?.kartons ?? '–')}</td>
          <td style="text-align:right">${e(p.menge)}</td>
          <td>${e(p.einheit)}</td>
          <td style="text-align:right">${e(kgMit(gew.positionen[i]?.bruttoKg))}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="4" style="text-align:right">Bruttomasse gesamt${e(verpackungText)}</td><td style="text-align:right">${e(kgMit(gew.bruttoKg))}</td></tr>
        </tbody></table>
        <div class="grid3" style="margin-top:4mm">
          <div class="box"><div class="label">7. Frachtzahlung</div><div class="value">${e(a.incoterms ?? '–')}</div></div>
          <div class="box"><div class="label">8. TARIC / Zolltarif</div><div class="value">${e(pos[0]?.taric_code ?? '2204')}</div></div>
          <div class="box"><div class="label">9. Warenwert EUR</div><div class="value">${e(eurText(gesamtEUR))}</div></div>
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
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Certificate of Origin – ${e(a.referenz)}</title>${css()}</head><body>${leiste}
        ${header(b)}
        <h1>CERTIFICATE OF ORIGIN</h1>
        <p class="subtitle">Handelsursprungszeugnis / Certificat d'origine</p>
        <div class="grid2">
          <div class="box">
            <div class="label">Exporter / Exporteur</div>
            <div class="value">${e(b.betrieb_name ?? '–')}</div>
            <div style="font-size:9pt">${e(b.betrieb_strasse ?? '')}, ${e(b.betrieb_plz ?? '')} ${e(b.betrieb_ort ?? '')}</div>
            <div style="font-size:9pt">AUSTRIA</div>
          </div>
          <div class="box">
            <div class="label">Importer / Importeur</div>
            <div class="value">${e(importeur)}</div>
            <div style="font-size:9pt">${e(a.destination_stadt ?? '')}, ${e(landAnzeige(a.destination_land))}</div>
          </div>
          <div class="box">
            <div class="label">Country of Origin / Ursprungsland</div>
            <div class="value" style="font-size:14pt">AUSTRIA / ÖSTERREICH</div>
          </div>
          <div class="box">
            <div class="label">Country of Destination / Bestimmungsland</div>
            <div class="value">${e(landAnzeige(a.destination_land) || '–')}</div>
          </div>
        </div>
        <h2>Description of Goods / Warenbeschreibung</h2>
        <table><thead><tr><th>Description</th><th>Quantity</th><th>Unit</th><th>HS Code</th><th>Value EUR</th></tr></thead>
        <tbody>${pos.map((p, i) => `<tr>
          <td>${e(p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–')} (Austrian Wine)${wb(i)}</td>
          <td style="text-align:right">${e(p.menge)}</td><td>${e(p.einheit)}</td>
          <td style="font-family:monospace">${e(p.taric_code ?? '2204')}</td>
          <td style="text-align:right">${e(eurText(positionsWert(p)))}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="4" style="text-align:right">Total Value EUR</td><td style="text-align:right">${e(eurText(gesamtEUR))}</td></tr>
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
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lieferschein – ${e(a.referenz)}</title>${css()}</head><body>${leiste}
        ${header(b)}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6mm">
          <h1 style="text-align:left;margin:0">LIEFERSCHEIN<br/><span style="font-size:10pt;font-weight:normal;color:#666">DELIVERY NOTE</span></h1>
          <div style="text-align:right">
            <div style="font-size:9pt;color:#666">Nr. / No.</div>
            <div style="font-size:14pt;font-weight:bold">${e(a.referenz ?? '–')}</div>
            <div style="font-size:9pt;color:#666">Datum: ${e(fmt(a.datum))}</div>
          </div>
        </div>
        <div class="grid2">
          <div class="box">
            <div class="label">Lieferant / Supplier</div>
            <div class="value">${e(b.betrieb_name ?? '–')}</div>
            <div style="font-size:9pt">${e(b.betrieb_strasse ?? '')}, ${e(b.betrieb_plz ?? '')} ${e(b.betrieb_ort ?? '')}, Österreich</div>
          </div>
          <div class="box">
            <div class="label">Empfänger / Recipient</div>
            <div class="value">${e(importeur)}</div>
            <div style="font-size:9pt">${e(a.destination_stadt ?? '')}, ${e(landAnzeige(a.destination_land))}</div>
          </div>
        </div>
        <div class="grid3">
          <div class="box"><div class="label">Lieferdatum / Delivery Date</div><div class="value">${e(fmt(a.lieferdatum))}</div></div>
          <div class="box"><div class="label">Incoterms</div><div class="value">${e(a.incoterms ?? '–')}</div></div>
          <div class="box"><div class="label">Transport / Carrier</div><div class="value">${e(a.transport_art ?? '–')}</div></div>
        </div>
        <table style="margin-top:4mm"><thead>
          <tr><th>Pos.</th><th>Bezeichnung / Description</th><th>Menge / Qty</th><th>Einheit / Unit</th><th>Netto / Net kg</th><th>Brutto / Gross kg</th><th>Artikel-Nr.</th></tr>
        </thead><tbody>
        ${pos.map((p,i) => `<tr>
          <td style="text-align:center">${i+1}</td>
          <td>${e(p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–')}${wb(i) || (p.fuellungen?.flaschengroesse_ml ? ` (${e(p.fuellungen.flaschengroesse_ml)}ml)` : '')}</td>
          <td style="text-align:right;font-weight:bold">${e(p.menge)}</td>
          <td>${e(p.einheit)}</td>
          <td style="text-align:right">${e(kg(gew.positionen[i]?.nettoKg))}</td>
          <td style="text-align:right">${e(kg(gew.positionen[i]?.bruttoKg))}</td>
          <td style="font-family:monospace;font-size:9pt">${e(p.fullung_id ? p.fullung_id.slice(0,8).toUpperCase() : '–')}</td>
        </tr>`).join('')}
        <tr class="total"><td colspan="4" style="text-align:right">Gesamt / Total${e(verpackungTextEn)}</td><td style="text-align:right">${e(kg(gew.nettoKg))}</td><td style="text-align:right">${e(kg(gew.bruttoKg))}</td><td></td></tr>
        </tbody></table>
        ${auftrag.notizen ? `<div class="box" style="margin-top:4mm"><div class="label">Bemerkungen / Remarks</div><div style="font-size:10pt">${escHtmlMehrzeilig(a.notizen)}</div></div>` : ''}
        <div class="sign" style="margin-top:12mm">
          <div class="sign-box">Ausgestellt von / Issued by</div>
          <div class="sign-box">Versender / Shipper</div>
          <div class="sign-box">Empfangen / Received by</div>
        </div>
      </body></html>`
      break

    // ── Exportrechnung ────────────────────────────────────────────────────────
    // ── Handelsrechnung und Proforma (KAN-434; Muster: ÖWM-Leitfaden Kap. 1, Zollrecherche KAN-417 A.4/B.2/B.5) ──────────
    case 'rechnung':
    case 'proforma': {
      const proforma = art === 'proforma'
      const fall = lieferfall(a)
      const steuer = befreiung(fall)
      const summe = rechnungsSumme(gesamtEUR, a)
      const ursprung = ursprungserklaerung({ land: a.destination_land, warenwert: gesamtEUR, gewaehlt: a.ursprungserklaerung, betrieb: b })
      const summen = erg?.grunddaten.summen
      const kartons = kartonsGesamt(dz)
      const nebenzeile = (label: string, betrag: number | null) => betrag === null ? '' : `<tr>
          <td colspan="6" style="text-align:right">${e(label)}</td>
          <td style="text-align:right">${e(eurText(betrag))}</td>
        </tr>`
      const nebenzeilen = nebenzeile('Fracht / Freight', summe.fracht) + nebenzeile('Versicherung / Insurance', summe.versicherung)
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e(proforma ? 'Proforma-Rechnung' : 'Exportrechnung')} – ${e(a.referenz)}</title>${css()}</head><body>${leiste}
        ${header(b)}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6mm">
          <h1 style="text-align:left;margin:0">${e(proforma ? 'PROFORMA-RECHNUNG' : 'EXPORTRECHNUNG')}<br/><span style="font-size:10pt;font-weight:normal;color:#666">${e(proforma ? 'PROFORMA INVOICE' : 'COMMERCIAL INVOICE')}</span></h1>
          <div style="text-align:right">
            <div style="font-size:9pt;color:#666">${e(proforma ? 'Proforma-Nr. / Proforma No.' : 'Rechnungs-Nr. / Invoice No.')}</div>
            <div style="font-size:14pt;font-weight:bold">${e(a.referenz ?? '–')}</div>
            <div style="font-size:9pt;color:#666">Datum / Date: ${e(fmt(a.datum))}</div>
          </div>
        </div>
        ${proforma ? `<div class="muster">${e(PROFORMA_VERMERK)}</div>` : ''}
        <div class="grid2">
          <div class="box">
            <div class="label">Verkäufer / Seller</div>
            <div class="value">${e(b.betrieb_name ?? '–')}</div>
            <div style="font-size:9pt">${e(b.betrieb_strasse ?? '')}, ${e(b.betrieb_plz ?? '')} ${e(b.betrieb_ort ?? '')}, Österreich / Austria</div>
            <div style="font-size:9pt">UID / VAT No.: ${e(b.betrieb_uid ?? '–')}</div>
            ${fall.gebiet === 'drittland' ? `<div style="font-size:9pt">EORI: ${e(b.betrieb_eori ?? '–')}</div>` : ''}
          </div>
          <div class="box">
            <div class="label">Käufer / Buyer</div>
            <div class="value">${e(importeur)}</div>
            <div style="font-size:9pt">${e([a.destination_stadt, landAnzeige(a.destination_land)].filter(Boolean).join(', '))}</div>
            ${fall.gebiet === 'eu' || a.kunde_uid ? `<div style="font-size:9pt">UID / VAT No.: ${e(a.kunde_uid ?? '–')}</div>` : ''}
            ${a.eori_kunde ? `<div style="font-size:9pt">EORI: ${e(a.eori_kunde)}</div>` : ''}
          </div>
        </div>
        <div class="grid3">
          <div class="box"><div class="label">Lieferbedingung / Delivery Term</div><div class="value">${e(a.incoterms ?? '–')}</div></div>
          <div class="box"><div class="label">Versanddatum / Shipped on</div><div class="value">${e(fmt(a.versanddatum))}</div></div>
          <div class="box"><div class="label">Ursprungsland / Country of Origin</div><div class="value">Österreich / Austria</div></div>
        </div>
        <table style="margin-top:4mm"><thead>
          <tr><th>Pos.</th><th>Bezeichnung / Description</th><th>Menge / Qty</th><th>Einh.</th><th>KN-Code / CN</th><th>€/Einh.</th><th>Betrag EUR</th></tr>
        </thead><tbody>
        ${pos.map((p, i) => `<tr>
          <td style="text-align:center">${e(i + 1)}</td>
          <td>${e(p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–')}${wb(i) || (p.fuellungen?.flaschengroesse_ml ? ` (${e(p.fuellungen.flaschengroesse_ml)}ml)` : '')}</td>
          <td style="text-align:right">${e(p.menge)}</td>
          <td>${e(p.einheit)}</td>
          <td style="font-family:monospace;font-size:9pt">${e(p.taric_code)}</td>
          <td style="text-align:right">${e(eurText(parseFloat(p.preis_eur)))}</td>
          <td style="text-align:right;font-weight:bold">${e(eurText(positionsWert(p)))}</td>
        </tr>`).join('')}
        <tr>
          <td colspan="6" style="text-align:right">Warenwert / Value of goods</td>
          <td style="text-align:right">${e(eurText(summe.warenwert))}</td>
        </tr>
        ${nebenzeilen}
        <tr class="total">
          <td colspan="6" style="text-align:right">${e(proforma ? 'Gesamtbetrag / Total EUR' : 'Rechnungsbetrag / Invoice total EUR')}</td>
          <td style="text-align:right">${e(eurText(summe.betrag))}</td>
        </tr>
        </tbody></table>
        ${muster}
        ${steuer.text ? `<div class="steuer">${e(steuer.text)}</div>` : ''}
        <div class="box" style="margin-top:4mm;font-size:9pt;line-height:1.6">
          <div><strong>Zahlungsbedingungen / Payment Terms:</strong> ${e(a.zahlungsbedingungen ?? '–')} · Währung / Currency: EUR</div>
          <div><strong>Packstücke / Packages:</strong> ${e(kartons === null ? '–' : String(kartons))} · <strong>Nettogewicht / Net weight:</strong> ${e(kgMit(gew.nettoKg))} · <strong>Bruttogewicht / Gross weight:</strong> ${e(kgMit(gew.bruttoKg))}</div>
          <div><strong>Liter gesamt / Liters total:</strong> ${e(zahlDe(summen?.liter, 3))} l – ${e(zahlDe(summen?.literWeiss, 3))} l weiß / white · ${e(zahlDe(summen?.literRot, 3))} l rot / red</div>
          <div><strong>Versicherungswert / Insurance Value:</strong> EUR ${e(a.versicherungswert ? eurText(parseFloat(a.versicherungswert)) : eurText(summe.betrag))}</div>
        </div>
        ${ursprung.status === 'ok' ? `<div class="ursprung">
          <div class="label">Ursprungserklärung / Origin declaration</div>
          ${ursprung.zeilen.map(z => `<div>${e(z)}</div>`).join('')}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8mm">
            <div class="sign-box">Ort und Datum / Place and date</div>
            <div class="sign-box">${e(ursprung.unterschrift ?? '')}</div>
          </div>
        </div>` : ''}
        ${!proforma && b.rechnung_iban ? `<div class="box" style="margin-top:4mm;font-size:9pt"><strong>Bankverbindung / Bank Details:</strong> IBAN: ${e(b.rechnung_iban)}${b.rechnung_bic ? ` · BIC: ${e(b.rechnung_bic)}` : ''}</div>` : ''}
        <div class="sign" style="margin-top:12mm">
          <div class="sign-box">Ort, Datum / Place, Date</div>
          <div class="sign-box">Aussteller / Issuer</div>
          <div class="sign-box">Stempel / Stamp</div>
        </div>
      </body></html>`
      break
    }

    // ── Packliste (KAN-433, Muster: ÖWM-Leitfaden „Begleitdokumente für den Weinexport“) ────────────────────────────────
    case 'packliste': {
      const nummern = kartonNummern(dz)
      const kartons = kartonsGesamt(dz)
      const summen = erg?.grunddaten.summen
      const aufschluesselung = kartonAufschluesselung(dz)
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Packliste – ${e(a.referenz)}</title>${css()}</head><body>${leiste}
        ${header(b)}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6mm">
          <h1 style="text-align:left;margin:0">PACKLISTE<br/><span style="font-size:10pt;font-weight:normal;color:#666">PACKING LIST</span></h1>
          <div style="text-align:right">
            <div style="font-size:9pt;color:#666">Rechnung / Invoice No.</div>
            <div style="font-size:14pt;font-weight:bold">${e(a.referenz ?? '–')}</div>
            <div style="font-size:9pt;color:#666">Datum / Date: ${e(fmt(a.datum))}</div>
          </div>
        </div>
        ${muster}
        <div class="grid2">
          <div class="box">
            <div class="label">Absender / Shipper</div>
            <div class="value">${e(b.betrieb_name ?? '–')}</div>
            <div style="font-size:9pt">${e(b.betrieb_strasse ?? '')}, ${e(b.betrieb_plz ?? '')} ${e(b.betrieb_ort ?? '')}, Österreich / Austria</div>
          </div>
          <div class="box">
            <div class="label">Empfänger / Consignee</div>
            <div class="value">${e(importeur)}</div>
            <div style="font-size:9pt">${e([a.destination_stadt, landAnzeige(a.destination_land)].filter(Boolean).join(', '))}</div>
          </div>
        </div>
        <div class="grid3">
          <div class="box"><div class="label">Versanddatum / Shipped on</div><div class="value">${e(fmt(a.versanddatum))}</div></div>
          <div class="box"><div class="label">Lieferbedingung / Delivery Term</div><div class="value">${e(a.incoterms ?? '–')}</div></div>
          <div class="box"><div class="label">Transport</div><div class="value">${e(a.transport_art ?? '–')}</div></div>
        </div>
        <table style="margin-top:4mm"><thead>
          <tr><th>Karton-Nr. / Box No.</th><th>Pos.</th><th>Wein / Wine</th><th>Jahrgang / Vintage</th><th>Farbe / Größe<br/>Colour / Size</th><th>Alk. % vol</th><th>Flaschen / Bottles</th><th>Liter</th><th>Brutto kg / Gross</th></tr>
        </thead><tbody>
        ${pos.map((p, i) => `<tr>
          <td style="text-align:center;font-family:monospace">${e(kartonText(nummern[i] ?? null))}</td>
          <td style="text-align:center">${e(String(i + 1).padStart(3, '0'))}</td>
          <td>${e(p.beschreibung ?? p.fuellungen?.bezeichnung ?? '–')}${dz[i]?.pruefnummer ? `<div class="wb">Prüfnr. ${e(dz[i].pruefnummer)}</div>` : ''}</td>
          <td style="text-align:center">${e(dz[i]?.jahrgang ?? '–')}</td>
          <td>${e(dz[i] ? farbeGroesse(dz[i]) : '–')}</td>
          <td style="text-align:right">${e(zahlDe(dz[i]?.alkohol, 1))}</td>
          <td style="text-align:right">${e(zahlDe(dz[i]?.flaschen))}</td>
          <td style="text-align:right">${e(zahlDe(dz[i]?.liter, 3))}</td>
          <td style="text-align:right">${e(kg(gew.positionen[i]?.bruttoKg))}</td>
        </tr>`).join('')}
        <tr class="total">
          <td colspan="6" style="text-align:right">Gesamt / Total${e(verpackungTextEn)}</td>
          <td style="text-align:right">${e(zahlDe(summen?.flaschen))}</td>
          <td style="text-align:right">${e(zahlDe(summen?.liter, 3))}</td>
          <td style="text-align:right">${e(kg(gew.bruttoKg))}</td>
        </tr>
        </tbody></table>
        <div class="box" style="margin-top:4mm;font-size:10pt;line-height:1.6">
          <div><strong>Kartons gesamt / Total boxes:</strong> ${e(kartons === null ? '–' : String(kartons))}${aufschluesselung ? ` – ${e(aufschluesselung)}` : ''}</div>
          <div><strong>Liter gesamt / Liters total:</strong> ${e(zahlDe(summen?.literWeiss, 3))} l weiß / white (inkl. Süßwein / incl. sweet wines) · ${e(zahlDe(summen?.literRot, 3))} l rot / red${summen && summen.literOhneFarbe > 0 ? ` · ${e(zahlDe(summen.literOhneFarbe, 3))} l ohne Farbangabe` : ''}</div>
          <div><strong>Ursprungsland / Country of Origin:</strong> Österreich / Austria</div>
        </div>
        ${auftrag.notizen ? `<div class="box" style="margin-top:4mm"><div class="label">Bemerkungen / Remarks</div><div style="font-size:10pt">${escHtmlMehrzeilig(a.notizen)}</div></div>` : ''}
        <div class="sign" style="margin-top:12mm">
          <div class="sign-box">Ausgestellt von / Issued by</div>
          <div class="sign-box">Ort, Datum / Place, Date</div>
          <div class="sign-box">Unterschrift / Signature</div>
        </div>
      </body></html>`
      break
    }

    default:
      return NextResponse.json({ fehler: `Unbekannter Dokumenttyp: ${art}` }, { status: 400 })
  }

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="${sichererDateiname(`${art}-${a.referenz ?? auftragId}`)}.html"`,
      // KAN-138: eigene Sandbox-Origin – eingeschleustes HTML kann nichts ausführen. KAN-141: einziges Skript ist der
      // Drucken-Knopf (per Hash freigegeben, kein Inline-Handler, weiterhin ohne allow-same-origin)
      'Content-Security-Policy': DRUCK_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
