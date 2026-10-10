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
export function exportauftragFehler(body: Body): string | null {
  const incoterms = text(body.incoterms)
  if (incoterms && !(INCOTERMS as readonly string[]).includes(incoterms)) return `Unbekannte Incoterms „${incoterms}“ – bitte aus der Liste wählen.`
  const transport = text(body.transport_art)
  if (transport && !(TRANSPORTARTEN as readonly string[]).includes(transport)) return `Unbekannte Transportart „${transport}“ – bitte aus der Liste wählen.`
  if (text(body.eori_kunde).length > EXPORT_MAX.eori) return `Die EORI-Nummer darf höchstens ${EXPORT_MAX.eori} Zeichen haben.`
  if (text(body.destination_stadt).length > EXPORT_MAX.stadt) return `Die Destination Stadt darf höchstens ${EXPORT_MAX.stadt} Zeichen haben.`
  const positionen = Array.isArray(body.positionen) ? (body.positionen as Body[]) : []
  for (const [i, p] of positionen.entries()) {
    const einheit = text(p?.einheit)
    if (einheit && !(EXPORT_EINHEITEN as readonly string[]).includes(einheit)) return `Position ${i + 1}: unbekannte Einheit „${einheit}“.`
    if (text(p?.taric_code).length > EXPORT_MAX.taric) return `Position ${i + 1}: der TARIC-Code darf höchstens ${EXPORT_MAX.taric} Zeichen haben.`
  }
  return null
}
