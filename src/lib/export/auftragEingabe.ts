// ── Eingaben eines Exportauftrags prüfen (Sweep 98, 10.10.2026) ─────────────────────────────────────────────
//
// exportauftraege und exportauftrag_positionen haben varchar-Spalten mit fester Länge (EORI 30, Stadt 100, Incoterms 10,
// Transportart 20, Einheit 10, TARIC 20). Die Route /api/weinexport schrieb die Werte aus dem Body ungeprüft – eine
// zu lange EORI-Nummer oder Stadt endete mit dem rohen Datenbankfehler „value too long for type character varying(30)“.
// Formular und Route nutzen dieselben Listen und Grenzen. Ohne '@/'-Importe, damit node:test die Datei laden kann.

export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const
export const TRANSPORTARTEN = ['LKW', 'Bahn', 'Schiff', 'Flugzeug', 'Kurier'] as const
export const EXPORT_EINHEITEN = ['Fl', 'Kiste', 'HL'] as const

/** Längengrenzen der Datenbank (varchar(n)) */
export const EXPORT_MAX = { eori: 30, stadt: 100, taric: 20 } as const

type Body = Record<string, unknown>

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** null = in Ordnung, sonst die Meldung für den Benutzer */
/** KAN-414: Verpackung der Sendung in kg – leer oder eine Zahl von 0 bis 100.000 (JSON-Zahl bzw. Text mit Dezimalpunkt;
 *  Eingaben mit Komma wandelt das Formular mit zahlAus um); null = in Ordnung */
export function verpackungFehler(wert: unknown): string | null {
  if (wert === null || wert === undefined || wert === '') return null
  const n = typeof wert === 'number' ? wert : Number(String(wert))
  if (!Number.isFinite(n) || n < 0 || n > 100000) return 'Die Verpackung (kg) muss eine Zahl von 0 bis 100.000 sein (oder leer bleiben).'
  return null
}

/** Verpackung als Zahl für die Datenbank (null = leer); vorher mit verpackungFehler prüfen */
export function verpackungWert(wert: unknown): number | null {
  if (wert === null || wert === undefined || wert === '') return null
  const n = typeof wert === 'number' ? wert : Number(String(wert))
  return Number.isFinite(n) ? n : null
}

export function exportauftragFehler(body: Body): string | null {
  const incoterms = text(body.incoterms)
  if (incoterms && !(INCOTERMS as readonly string[]).includes(incoterms)) return `Unbekannte Incoterms „${incoterms}“ – bitte aus der Liste wählen.`
  const transport = text(body.transport_art)
  if (transport && !(TRANSPORTARTEN as readonly string[]).includes(transport)) return `Unbekannte Transportart „${transport}“ – bitte aus der Liste wählen.`
  if (text(body.eori_kunde).length > EXPORT_MAX.eori) return `Die EORI-Nummer darf höchstens ${EXPORT_MAX.eori} Zeichen haben.`
  if (text(body.destination_stadt).length > EXPORT_MAX.stadt) return `Die Destination Stadt darf höchstens ${EXPORT_MAX.stadt} Zeichen haben.`
  const vf = verpackungFehler(body.verpackung_kg)
  if (vf) return vf
  const positionen = Array.isArray(body.positionen) ? (body.positionen as Body[]) : []
  for (const [i, p] of positionen.entries()) {
    const einheit = text(p?.einheit)
    if (einheit && !(EXPORT_EINHEITEN as readonly string[]).includes(einheit)) return `Position ${i + 1}: unbekannte Einheit „${einheit}“.`
    if (text(p?.taric_code).length > EXPORT_MAX.taric) return `Position ${i + 1}: der TARIC-Code darf höchstens ${EXPORT_MAX.taric} Zeichen haben.`
  }
  // KAN-429 (UAT 12.11.2026, EX-0005 mit 0 Flaschen): jede Position braucht eine Menge über 0 und eine Füllung bzw.
  // Bezeichnung – dieselbe Regel prüft die Datenbank beim Bearbeiten (s112_exportauftrag_aendern)
  if (positionen.length > EXPORT_POSITIONEN_MAX) return `Höchstens ${EXPORT_POSITIONEN_MAX} Positionen je Exportauftrag.`
  for (const [i, p] of positionen.entries()) {
    const menge = exportMenge(p?.menge)
    if (menge === null || !(menge > 0)) return `Position ${i + 1}: Bitte eine Menge über 0 angeben.`
    if (!text(p?.fullung_id) && !text(p?.beschreibung)) return `Position ${i + 1}: Bitte eine Füllung wählen oder eine Bezeichnung angeben.`
  }
  return null
}

export const EXPORT_POSITIONEN_MAX = 200

/** Menge bzw. Preis einer Position als Zahl: JSON-Zahl oder Text mit Dezimalpunkt, wie ihn die Zahlenfelder des Formulars
 *  (type="number") und die Datenbank („600.00“) liefern – bewusst ohne Deutung von Komma oder Tausenderpunkt; null = ungültig */
export function exportMenge(wert: unknown): number | null {
  if (typeof wert === 'number') return Number.isFinite(wert) ? wert : null
  const t = text(wert)
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** KAN-429: Status, in denen sich ein Exportauftrag bearbeiten lässt – ab „Versendet“ sperren App und Datenbank */
export const EXPORT_BEARBEITBAR_STATUS: readonly string[] = ['entwurf', 'bestaetigt']

export function exportBearbeitbar(a: { status?: string | null; storniert_am?: string | null }): boolean {
  return !a.storniert_am && EXPORT_BEARBEITBAR_STATUS.includes(a.status ?? 'entwurf')
}

/** Kopfdaten für s112_exportauftrag_aendern aus dem geprüften Body (Land schon als ISO-Code) */
export function exportKopf(body: Body, destinationLand: string | null): Record<string, unknown> {
  const zahl = (v: unknown) => (v === null || v === undefined || v === '' ? null : exportMenge(v))
  return {
    kontakt_id: text(body.kontakt_id) || null,
    firma_id: text(body.firma_id) || null,
    datum: text(body.datum) || null,
    lieferdatum: text(body.lieferdatum) || null,
    incoterms: text(body.incoterms) || null,
    transport_art: text(body.transport_art) || null,
    destination_land: destinationLand,
    destination_stadt: text(body.destination_stadt) || null,
    eori_kunde: text(body.eori_kunde) || null,
    versicherungswert: zahl(body.versicherungswert),
    verpackung_kg: verpackungWert(body.verpackung_kg),
    notizen: text(body.notizen) || null,
  }
}

/** Positionen für s112_exportauftrag_aendern (Mengen und Preise als Zahlen) */
export function exportPositionen(body: Body): Record<string, unknown>[] {
  const positionen = Array.isArray(body.positionen) ? (body.positionen as Body[]) : []
  return positionen.map(p => ({
    fullung_id: text(p?.fullung_id) || null,
    beschreibung: text(p?.beschreibung) || null,
    menge: exportMenge(p?.menge),
    einheit: text(p?.einheit) || 'Fl',
    preis_eur: exportMenge(p?.preis_eur) ?? 0,
    taric_code: text(p?.taric_code) || '2204.21',
  }))
}
