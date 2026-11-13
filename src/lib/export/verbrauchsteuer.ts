// ── Weinexport: Verbrauchsteuer-Angaben an Exportauftrag und Betrieb (KAN-435 D2, 13.11.2026 – Epic KAN-431) ───────────
//
// Wein hat in Österreich den Verbrauchsteuersatz null, grenzüberschreitend gelten trotzdem die Verfahren der
// Verbrauchsteuer (EMCS). Bisher gab es am Auftrag nur ARC-Nummer und EMCS-Status. Neu: Verfahren, MVV-Code, Nummer des
// Weinbegleitdokuments, Verbrauchsteuernummer des Empfängers; im Betrieb die eigene Verbrauchsteuernummer.
//
// Entscheidungen Jörgen 13.11.2026: ein Feld für die Verbrauchsteuernummer des Betriebs (4A); das Verfahren ist
// freiwillig – fehlt es bei einem EU-Auftrag, steht das in der Hinweisliste, es blockiert nichts (5A).
// Welches Dokument in welchem Fall gilt, leitet die Software daraus noch NICHT ab (wartet auf Auskünfte von Zollamt und
// Bundeskellereiinspektion, KAN-417 D.4). Dieselben Grenzen wie die CHECKs der Datenbank.
// Isomorph und ohne '@/'-Importe (node:test).

export const VST_VERFAHREN = {
  aussetzung: 'Unter Steueraussetzung (e-VD in EMCS)',
  freier_verkehr: 'Steuerrechtlich freier Verkehr',
} as const
export type VstVerfahren = keyof typeof VST_VERFAHREN

export function istVstVerfahren(v: unknown): v is VstVerfahren {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(VST_VERFAHREN, v)
}

/** Anzeige des Verfahrens; unbekannt bzw. leer → '' */
export function vstVerfahrenLabel(v: unknown): string {
  return istVstVerfahren(v) ? VST_VERFAHREN[v] : ''
}

export const MVV_CODE_MAX = 40
export const BEGLEITDOKUMENT_NR_MAX = 40
export const VERBRAUCHSTEUERNR_MAX = 20

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Verbrauchsteuernummer ohne Leerzeichen, in Großbuchstaben ('' = leer) */
export function vstNummerBereinigt(v: unknown): string {
  return text(v).replace(/\s+/g, '').toUpperCase()
}

/** Verbrauchsteuernummer (ATV/SEED): nur Buchstaben und Ziffern; null = in Ordnung (auch leer) */
export function vstNummerFehler(v: unknown, wessen: string): string | null {
  if (v !== null && v !== undefined && typeof v !== 'string') return `Die Verbrauchsteuernummer ${wessen} ist ungültig.`
  const n = vstNummerBereinigt(v)
  if (n === '') return null
  if (n.length > VERBRAUCHSTEUERNR_MAX) return `Die Verbrauchsteuernummer ${wessen} darf höchstens ${VERBRAUCHSTEUERNR_MAX} Zeichen lang sein.`
  if (!/^[A-Z0-9]+$/.test(n)) return `Die Verbrauchsteuernummer ${wessen} darf nur Buchstaben und Ziffern enthalten.`
  return null
}

export type VerbrauchsteuerEingabe = {
  verbrauchsteuer_verfahren?: unknown
  mvv_code?: unknown
  begleitdokument_nr?: unknown
  empfaenger_verbrauchsteuernr?: unknown
}

/** Eingabeprüfung der Angaben am Auftrag – nur die übergebenen Felder; null = in Ordnung */
export function verbrauchsteuerFehler(e: VerbrauchsteuerEingabe): string | null {
  if ('verbrauchsteuer_verfahren' in e) {
    const v = e.verbrauchsteuer_verfahren
    if (!(v === null || v === '' || istVstVerfahren(v))) return 'Bitte ein gültiges Verbrauchsteuerverfahren wählen.'
  }
  for (const [feld, name, max] of [
    ['mvv_code', 'Der MVV-Code', MVV_CODE_MAX],
    ['begleitdokument_nr', 'Die Nummer des Begleitdokuments', BEGLEITDOKUMENT_NR_MAX],
  ] as const) {
    if (!(feld in e)) continue
    const v = e[feld]
    if (v !== null && v !== undefined && typeof v !== 'string') return `${name} ist ungültig.`
    if (text(v).length > max) return `${name} darf höchstens ${max} Zeichen lang sein.`
    if (/[\u0000-\u001F]/.test(text(v))) return `${name} enthält unzulässige Zeichen.`
  }
  if ('empfaenger_verbrauchsteuernr' in e) return vstNummerFehler(e.empfaenger_verbrauchsteuernr, 'des Empfängers')
  return null
}

/** Werte für die Datenbank: leer → null, Nummern bereinigt – nur die übergebenen Felder */
export function verbrauchsteuerWerte(e: VerbrauchsteuerEingabe): Record<string, string | null> {
  const aus: Record<string, string | null> = {}
  if ('verbrauchsteuer_verfahren' in e) aus.verbrauchsteuer_verfahren = istVstVerfahren(e.verbrauchsteuer_verfahren) ? e.verbrauchsteuer_verfahren : null
  if ('mvv_code' in e) aus.mvv_code = text(e.mvv_code) || null
  if ('begleitdokument_nr' in e) aus.begleitdokument_nr = text(e.begleitdokument_nr) || null
  if ('empfaenger_verbrauchsteuernr' in e) aus.empfaenger_verbrauchsteuernr = vstNummerBereinigt(e.empfaenger_verbrauchsteuernr) || null
  return aus
}

export const VST_VERFAHREN_HINWEIS = 'Verbrauchsteuerverfahren nicht festgelegt (unter Steueraussetzung oder freier Verkehr) – im Kasten „Verbrauchsteuer und Begleitdokument“ wählen.'

/** Hinweis für die Liste am Exportauftrag: EU-Auftrag ohne Verfahren (blockiert nichts); sonst null */
export function vstVerfahrenHinweis(a: { verbrauchsteuer_verfahren?: unknown; storniert_am?: unknown }, gebiet: string | null): string | null {
  if (gebiet !== 'eu' || a.storniert_am) return null
  return istVstVerfahren(a.verbrauchsteuer_verfahren) ? null : VST_VERFAHREN_HINWEIS
}
