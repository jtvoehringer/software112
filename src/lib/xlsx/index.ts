// ── XLSX-Schreiber ohne Abhängigkeiten (KAN-50, 10.10.2026) ─────────────────────────────────────────────────────
//
// Für die BKI-Schnittstelle (eine Datei, ein Arbeitsblatt je Spezifikationsblatt). Bewusst ohne SheetJS: das npm-Paket
// „xlsx“ ist seit 0.18.5 nicht mehr gepflegt und hat offene Sicherheitslücken (Prototype Pollution, ReDoS) – der
// Abhängigkeits-Check der CI ließe es nicht zu. Geschrieben wird nur, was wir brauchen: Text (inline), Zahl mit festen
// Nachkommastellen, Datum (echte Excel-Datumszelle, Format yyyy-mm-dd), Ja/Nein als Boolean, fette Kopfzeile, fixierte
// Kopfzeile, Autofilter, Spaltenbreiten. Das ZIP ist unkomprimiert („stored“) – gültiges OOXML, öffnet in Excel,
// LibreOffice und openpyxl; die Dateien sind klein genug.
// Isomorph und ohne Imports (node:test lädt die Datei direkt).

export type XlsxZelle =
  | null
  | { t: 's'; v: string }
  /** Zahl; stellen = feste Nachkommastellen im Zahlenformat (undefined = Standard) */
  | { t: 'n'; v: number; stellen?: number }
  | { t: 'b'; v: boolean }
  /** Kalendertag 'JJJJ-MM-TT' → Excel-Datum mit Format yyyy-mm-dd */
  | { t: 'd'; v: string }

export type XlsxBlatt = {
  /** Blattname (max. 31 Zeichen, ohne : \ / ? * [ ] – wird bereinigt) */
  name: string
  kopf: readonly string[]
  zeilen: readonly (readonly XlsxZelle[])[]
  /** Kopfzeile fixieren und Autofilter setzen (Standard: ja) */
  filter?: boolean
}

// ── Hilfen ──────────────────────────────────────────────────────────────────

const XML_UNGUELTIG = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g   // in XML 1.0 nicht erlaubt

function esc(s: string): string {
  return s.replace(XML_UNGUELTIG, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Spaltenbuchstaben: 0 → A, 25 → Z, 26 → AA */
export function spaltenName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Excel-Seriennummer eines Kalendertags (1900-System, Basis 30.12.1899); null bei ungültigem Datum */
export function excelDatum(tag: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tag)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(ms)
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86_400_000)
}

/** Blattname nach Excel-Regeln, eindeutig innerhalb der Mappe */
export function blattName(name: string, vergeben: Set<string>): string {
  const basis = (name.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Blatt').slice(0, 31)
  let n = basis, i = 2
  while (vergeben.has(n.toLowerCase())) { const z = ` (${i++})`; n = basis.slice(0, 31 - z.length) + z }
  vergeben.add(n.toLowerCase())
  return n
}

// ── Styles: 0 Standard, 1 Kopf (fett), 2 Datum, 3.. Zahl mit 0–6 Stellen ─────

const MAX_STELLEN = 6
const STIL_KOPF = 1, STIL_DATUM = 2
const stilZahl = (stellen: number) => 3 + Math.max(0, Math.min(MAX_STELLEN, Math.trunc(stellen)))

function stylesXml(): string {
  const fmts = ['<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>']
  for (let s = 0; s <= MAX_STELLEN; s++) fmts.push(`<numFmt numFmtId="${165 + s}" formatCode="${s === 0 ? '0' : '0.' + '0'.repeat(s)}"/>`)
  const xfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
  ]
  for (let s = 0; s <= MAX_STELLEN; s++) xfs.push(`<xf numFmtId="${165 + s}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`)
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<numFmts count="${fmts.length}">${fmts.join('')}</numFmts>`
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>'
}

function zelleXml(ref: string, z: XlsxZelle): { xml: string; breite: number } {
  if (z === null) return { xml: '', breite: 0 }
  switch (z.t) {
    case 's': return z.v === '' ? { xml: '', breite: 0 } : { xml: `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(z.v)}</t></is></c>`, breite: z.v.length }
    case 'n': {
      if (!Number.isFinite(z.v)) return { xml: '', breite: 0 }
      const stil = z.stellen === undefined ? 0 : stilZahl(z.stellen)
      return { xml: `<c r="${ref}"${stil ? ` s="${stil}"` : ''}><v>${z.v}</v></c>`, breite: String(z.v).length + 2 }
    }
    case 'b': return { xml: `<c r="${ref}" t="b"><v>${z.v ? 1 : 0}</v></c>`, breite: 5 }
    case 'd': {
      const n = excelDatum(z.v)
      return n === null ? { xml: '', breite: 0 } : { xml: `<c r="${ref}" s="${STIL_DATUM}"><v>${n}</v></c>`, breite: 10 }
    }
  }
}

function blattXml(b: XlsxBlatt): string {
  const breiten = b.kopf.map(k => Math.max(8, k.length))
  const zeilen: string[] = []
  zeilen.push(`<row r="1">${b.kopf.map((k, i) => `<c r="${spaltenName(i)}1" s="${STIL_KOPF}" t="inlineStr"><is><t xml:space="preserve">${esc(k)}</t></is></c>`).join('')}</row>`)
  b.zeilen.forEach((z, zi) => {
    const r = zi + 2
    let xml = ''
    z.forEach((zelle, si) => {
      const e = zelleXml(`${spaltenName(si)}${r}`, zelle)
      xml += e.xml
      if (si < breiten.length) breiten[si] = Math.max(breiten[si], e.breite)
    })
    zeilen.push(`<row r="${r}">${xml}</row>`)
  })
  const letzte = spaltenName(Math.max(0, b.kopf.length - 1))
  const filter = b.filter !== false && b.kopf.length > 0
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + (filter ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '')
    + (breiten.length ? `<cols>${breiten.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, w + 2)}" customWidth="1"/>`).join('')}</cols>` : '')
    + `<sheetData>${zeilen.join('')}</sheetData>`
    + (filter ? `<autoFilter ref="A1:${letzte}${b.zeilen.length + 1}"/>` : '')
    + '</worksheet>'
}

// ── ZIP (stored) ────────────────────────────────────────────────────────────

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()

export function crc32(daten: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < daten.length; i++) c = CRC_TABELLE[(c ^ daten[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/** Unkomprimiertes ZIP (Methode 0) aus [Pfad, Inhalt]; feste Zeit 01.01.2026 00:00, damit gleiche Daten gleiche Bytes ergeben */
export function zipStored(dateien: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const enc = new TextEncoder()
  const ZEIT = 0, DATUM = ((2026 - 1980) << 9) | (1 << 5) | 1
  const teile: Uint8Array[] = []
  const zentral: Uint8Array[] = []
  let offset = 0
  for (const [pfad, inhalt] of dateien) {
    const name = enc.encode(pfad)
    const crc = crc32(inhalt)
    const lokal = new Uint8Array(30 + name.length)
    const dv = new DataView(lokal.buffer)
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true)
    dv.setUint16(10, ZEIT, true); dv.setUint16(12, DATUM, true); dv.setUint32(14, crc, true)
    dv.setUint32(18, inhalt.length, true); dv.setUint32(22, inhalt.length, true); dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true)
    lokal.set(name, 30)
    const z = new Uint8Array(46 + name.length)
    const zv = new DataView(z.buffer)
    zv.setUint32(0, 0x02014b50, true); zv.setUint16(4, 20, true); zv.setUint16(6, 20, true); zv.setUint16(8, 0x0800, true); zv.setUint16(10, 0, true)
    zv.setUint16(12, ZEIT, true); zv.setUint16(14, DATUM, true); zv.setUint32(16, crc, true)
    zv.setUint32(20, inhalt.length, true); zv.setUint32(24, inhalt.length, true); zv.setUint16(28, name.length, true)
    zv.setUint32(42, offset, true)
    z.set(name, 46)
    teile.push(lokal, inhalt)
    zentral.push(z)
    offset += lokal.length + inhalt.length
  }
  const zLaenge = zentral.reduce((s, z) => s + z.length, 0)
  const ende = new Uint8Array(22)
  const ev = new DataView(ende.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, dateien.length, true); ev.setUint16(10, dateien.length, true)
  ev.setUint32(12, zLaenge, true); ev.setUint32(16, offset, true)
  const alle = [...teile, ...zentral, ende]
  const out = new Uint8Array(alle.reduce((s, a) => s + a.length, 0))
  let p = 0
  for (const a of alle) { out.set(a, p); p += a.length }
  return out
}

// ── Mappe ───────────────────────────────────────────────────────────────────

/** Arbeitsmappe aus Blättern → XLSX-Bytes */
export function xlsxMappe(blaetter: readonly XlsxBlatt[]): Uint8Array {
  if (blaetter.length === 0) throw new Error('XLSX: mindestens ein Blatt nötig')
  const enc = new TextEncoder()
  const vergeben = new Set<string>()
  const namen = blaetter.map(b => blattName(b.name, vergeben))
  const kopf = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const dateien: [string, Uint8Array][] = [
    ['[Content_Types].xml', enc.encode(kopf
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + namen.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>')],
    ['_rels/.rels', enc.encode(kopf
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>')],
    ['xl/workbook.xml', enc.encode(kopf
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets>${namen.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
      + (blaetter.some(b => b.filter !== false && b.kopf.length) ? `<definedNames>${blaetter.map((b, i) => b.filter !== false && b.kopf.length
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(namen[i].replace(/'/g, "''"))}'!$A$1:$${spaltenName(b.kopf.length - 1)}$${b.zeilen.length + 1}</definedName>` : '').join('')}</definedNames>` : '')
      + '</workbook>')],
    ['xl/_rels/workbook.xml.rels', enc.encode(kopf
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + namen.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${namen.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>')],
    ['xl/styles.xml', enc.encode(stylesXml())],
    ...blaetter.map((b, i) => [`xl/worksheets/sheet${i + 1}.xml`, enc.encode(blattXml(b))] as [string, Uint8Array]),
  ]
  return zipStored(dateien)
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
