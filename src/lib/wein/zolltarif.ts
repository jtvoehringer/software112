// Zolltarifnummern (KN-Codes / Kombinierte Nomenklatur) für Wein aus Österreich
// Quelle: ÖWM – Begleitdokumente für den Weinexport, Punkt 5.3 (Stand 2016, jährlich prüfen!)
// https://www.oesterreichwein.at/fileadmin/user_upload/PDF/UNEINGESCHRAENKTE_NUTZUNG_begleitdokumente_pdf.pdf
//
// Format: 8-stellig ohne Trennzeichen (EU-Standard für EMCS / Zollanmeldungen)
// Anzeige: "2204 2179" (mit Leerzeichen nach 4. Stelle)

export type KNCode = { value: string; label: string; gruppe: string }

export const KN_CODES: KNCode[] = [
  // ── Schaumwein ──────────────────────────────────────────────────────────────
  { gruppe: 'Schaumwein',  value: '22041093', label: '2204 1093 – Schaumwein mit g.U.' },
  { gruppe: 'Schaumwein',  value: '22041094', label: '2204 1094 – Schaumwein mit g.g.A.' },
  { gruppe: 'Schaumwein',  value: '22041096', label: '2204 1096 – Schaumwein ohne g.U./g.g.A., andere Rebsorten' },
  { gruppe: 'Schaumwein',  value: '22041098', label: '2204 1098 – Anderer Schaumwein' },

  // ── Wein in Behältnissen ≤ 2 Liter ─────────────────────────────────────────
  { gruppe: 'Wein ≤ 2 L',  value: '22042106', label: '2204 2106 – Wein ≤ 2L mit g.U.' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042107', label: '2204 2107 – Wein ≤ 2L mit g.g.A.' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042108', label: '2204 2108 – Wein ≤ 2L ohne g.U./g.g.A., Rebsortenw.' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042109', label: '2204 2109 – Anderer Wein ≤ 2L' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042179', label: '2204 2179 – Weißwein ≤ 2L mit g.g.A., ≤ 15 % vol' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042180', label: '2204 2180 – Wein ≤ 2L mit g.g.A., ≤ 15 % vol' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042181', label: '2204 2181 – Weiße Rebsortenweine EU ≤ 2L, ≤ 15 % vol' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042182', label: '2204 2182 – Andere Rebsortenweine EU ≤ 2L, ≤ 15 % vol' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042183', label: '2204 2183 – Weißwein EU ≤ 2L, ≤ 15 % vol' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042184', label: '2204 2184 – Wein EU ≤ 2L, ≤ 15 % vol' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042190', label: '2204 2190 – Wein EU ≤ 2L, 15–22 % vol mit g.U./g.g.A.' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042191', label: '2204 2191 – Wein EU ≤ 2L, 15–22 % vol' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042192', label: '2204 2192 – Wein EU ≤ 2L, ≥ 22 % vol' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042193', label: '2204 2193 – Weißweine ≤ 2L mit g.U./g.g.A.' },
  { gruppe: 'Wein ≤ 2 L',  value: '22042197', label: '2204 2197 – Andere Weißweine ≤ 2L' },

  // ── Wein in Behältnissen > 2 Liter ─────────────────────────────────────────
  { gruppe: 'Wein > 2 L',  value: '22042979', label: '2204 2979 – Weißwein > 2L mit g.g.A., ≤ 15 % vol' },
  { gruppe: 'Wein > 2 L',  value: '22042980', label: '2204 2980 – Wein > 2L mit g.g.A., ≤ 15 % vol' },
  { gruppe: 'Wein > 2 L',  value: '22042981', label: '2204 2981 – Weiße Rebsortenweine EU > 2L, o. g.U./g.g.A.' },
  { gruppe: 'Wein > 2 L',  value: '22042990', label: '2204 2990 – Wein EU > 2L, 15–22 % vol mit g.U./g.g.A.' },
  { gruppe: 'Wein > 2 L',  value: '22042991', label: '2204 2991 – Wein EU > 2L, 15–22 % vol' },
  { gruppe: 'Wein > 2 L',  value: '22042992', label: '2204 2992 – Wein EU > 2L, ≥ 22 % vol' },
]

/** Formatiert einen 8-stelligen KN-Code zur Anzeige: "22042179" → "2204 2179" */
export function fmtKNCode(code: string | null | undefined): string {
  if (!code) return ''
  const c = code.replace(/\s/g, '')
  return c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c
}

/** Gibt das KN_CODES-Objekt für einen Code zurück */
export function findKNCode(code: string | null | undefined): KNCode | undefined {
  if (!code) return undefined
  const normalized = code.replace(/\s/g, '')
  return KN_CODES.find(k => k.value === normalized)
}
