// Typen/Konstanten der Dashboard-Sichten OHNE Server-Imports – werden auch in
// Client-Komponenten (Kanban, Fristen, Checkliste) verwendet.

export const STATUS_LABEL: Record<string, string> = {
  ernte: 'Lese / Übernahme', gaerung: 'Gärung', ausbau: 'Ausbau', abfuellung: 'Abfüllung', abgeschlossen: 'Abgeschlossen',
}

export type Charge = {
  id: string; name: string; jahrgang: number | null; rebsorte: string | null; weinart: string | null
  status: string; menge_liter: number; behaelter: string | null; behaelter_id: string | null
  /** Anzeigetext der Qualität samt Zusatzbezeichnung/Erzeugnis (KAN-186), null = keine Stufe */
  qualitaetsstufe: string | null; notizen: string | null
  letzteAnalyse: { datum: string; alkohol_vol: number | null; restzucker_gl: number | null; freie_so2_mgl: number | null; gesamtsaeure_gl: number | null; kmw?: number | null; oechsle?: number | null; mostgewicht_einheit?: string | null } | null
  letzteMassnahme: { datum: string; typ: string | null; menge: number | null; einheit: string | null } | null
  messungFaellig: boolean
  tageSeitMessung: number | null
}

export type FristStatus = 'ueberfaellig' | 'faellig' | 'offen' | 'erledigt' | 'laufend'

/** Ampel der Fristen – Sicht „Meldungen & Fristen“ (FristenClient) und Widget „Nächste Meldefristen“ (KAN-389) */
export const FRIST_STATUS: Record<FristStatus, { label: string; tone: 'ok' | 'warn' | 'err' | 'info' | 'gray' }> = {
  ueberfaellig: { label: 'Überfällig', tone: 'err' },
  faellig:      { label: 'Fällig',     tone: 'warn' },
  offen:        { label: 'Offen',      tone: 'gray' },
  laufend:      { label: 'Laufend',    tone: 'info' },
  erledigt:     { label: 'Erledigt',   tone: 'ok' },
}
export type Frist = {
  key: string
  id?: string                 // nur betriebseigene (Tabelle fristen)
  bezeichnung: string
  hinweis: string
  kategorie: string
  faelligAm: string | null
  status: FristStatus
  statusText: string
  href?: string
  quelle: 'betrieb' | 'system'
}
