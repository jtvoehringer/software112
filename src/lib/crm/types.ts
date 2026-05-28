// ── Segment-Definitionen ──────────────────────────────────────────────────────

export const SEGMENTE = [
  { value: 'privat',      label: 'Privatkunde',       icon: '👤', farbe: 'bg-blue-100 text-blue-800'   },
  { value: 'gastronomie', label: 'Gastronomie',        icon: '🍽️', farbe: 'bg-orange-100 text-orange-800' },
  { value: 'handel',      label: 'Handel',             icon: '🏪', farbe: 'bg-purple-100 text-purple-800' },
  { value: 'export',      label: 'Export',             icon: '✈️', farbe: 'bg-green-100 text-green-800'  },
  { value: 'grosshandel', label: 'Großhandel',         icon: '🏭', farbe: 'bg-gray-100 text-gray-800'   },
] as const

export type Kundensegment = (typeof SEGMENTE)[number]['value']

export function segmentLabel(value: string | null | undefined): string {
  return SEGMENTE.find(s => s.value === value)?.label ?? value ?? '–'
}

export function segmentFarbe(value: string | null | undefined): string {
  return SEGMENTE.find(s => s.value === value)?.farbe ?? 'bg-gray-100 text-gray-600'
}

// ── Pipeline-Stufen ───────────────────────────────────────────────────────────

export const PIPELINE_STUFEN = [
  { value: 'interessent',  label: 'Interessent',   farbe: 'bg-gray-100 text-gray-700'    },
  { value: 'kontaktiert',  label: 'Kontaktiert',   farbe: 'bg-blue-100 text-blue-700'    },
  { value: 'verkostung',   label: 'Verkostung',    farbe: 'bg-purple-100 text-purple-700' },
  { value: 'angebot',      label: 'Angebot',       farbe: 'bg-yellow-100 text-yellow-800' },
  { value: 'verhandlung',  label: 'Verhandlung',   farbe: 'bg-orange-100 text-orange-700' },
  { value: 'abschluss',    label: 'Abschluss',     farbe: 'bg-green-100 text-green-700'  },
  { value: 'stammkunde',   label: 'Stammkunde',    farbe: 'bg-teal-100 text-teal-700'    },
  { value: 'verloren',     label: 'Verloren',      farbe: 'bg-red-100 text-red-700'      },
] as const

export type PipelineStufe = (typeof PIPELINE_STUFEN)[number]['value']

// ── Aktivitäts-Arten ──────────────────────────────────────────────────────────

export const AKTIVITAET_ARTEN = [
  { value: 'notiz',       label: 'Notiz',        icon: '📝' },
  { value: 'anruf',       label: 'Anruf',        icon: '📞' },
  { value: 'email',       label: 'E-Mail',       icon: '✉️'  },
  { value: 'verkostung',  label: 'Verkostung',   icon: '🍷' },
  { value: 'messe',       label: 'Messe',        icon: '🏛️'  },
  { value: 'besuch',      label: 'Besuch',       icon: '🚗' },
  { value: 'angebot',     label: 'Angebot',      icon: '📄' },
  { value: 'sonstiges',   label: 'Sonstiges',    icon: '•'  },
] as const

// ── Basis-Typen für Komponenten ───────────────────────────────────────────────

export type KontaktRow = {
  id: string
  vorname: string | null
  nachname: string
  segment: Kundensegment
  firma_id: string | null
  firma_name?: string | null
  email: string | null
  telefon: string | null
  mobil: string | null
  ort: string | null
  land: string | null
  newsletter: boolean
  newsletter_bestaetigt: boolean
  stammkunde: boolean
  aktiv: boolean
  erstellt_am: string
}

export type FirmaRow = {
  id: string
  name: string
  segment: Kundensegment
  strasse: string | null
  plz: string | null
  ort: string | null
  land: string | null
  email: string | null
  telefon: string | null
  website: string | null
  uid_nummer: string | null
  kreditlimit: number | null
  zahlungsziel_tage: number | null
  waehrung: string | null
  notizen: string | null
  aktiv: boolean
  kontakt_anzahl?: number
}

export type AktivitaetRow = {
  id: string
  art: string
  betreff: string | null
  beschreibung: string | null
  datum: string
  erledigt: boolean
  kontakt_id: string | null
  kontakt_name?: string | null
  firma_id: string | null
  firma_name?: string | null
}

export type PipelineEintragRow = {
  id: string
  stufe: PipelineStufe
  titel: string
  wert_euro: number | null
  wahrscheinlichkeit: number | null
  erwartetes_datum: string | null
  kontakt_id: string | null
  kontakt_name?: string | null
  firma_id: string | null
  firma_name?: string | null
  aktualisiert_am: string
}
