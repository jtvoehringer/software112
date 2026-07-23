// ── Segment-Definitionen ──────────────────────────────────────────────────────

export const SEGMENTE = [
  { value: 'privat',      label: 'Privat',       icon: '👤', farbe: 'bg-blue-100 text-blue-800'   },
  { value: 'gastronomie', label: 'Gastronomie',        icon: '🍽️', farbe: 'bg-orange-100 text-orange-800' },
  { value: 'handel',      label: 'Handel',             icon: '🏪', farbe: 'bg-purple-100 text-purple-800' },
  { value: 'export',      label: 'Export',             icon: '✈️', farbe: 'bg-green-100 text-green-800'  },
  { value: 'grosshandel', label: 'Großhandel',         icon: '🏭', farbe: 'bg-gray-100 text-gray-800'   },
  { value: 'produzent',   label: 'Produzent',           icon: '🍇', farbe: 'bg-rose-100 text-rose-800'    },
  { value: 'weinhauer',   label: 'Weinhauer',           icon: '🏡', farbe: 'bg-lime-100 text-lime-800'     },
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

// ── Pipeline-Kategorien ───────────────────────────────────────────────────────

export const PIPELINE_KATEGORIEN = [
  { value: 'sortiment',     label: 'Sortiment gesamt' },
  { value: 'weisswein',     label: 'Weißwein'         },
  { value: 'rotwein',       label: 'Rotwein'          },
  { value: 'rose',          label: 'Rosé'             },
  { value: 'sekt',          label: 'Sekt / Perlwein'  },
  { value: 'fasswein',      label: 'Fasswein'         },
  { value: 'veranstaltung', label: 'Veranstaltung'    },
  { value: 'export',        label: 'Export'           },
  { value: 'sonstiges',     label: 'Sonstiges'        },
] as const

// ── Aktivitäts-Arten ──────────────────────────────────────────────────────────

export const AKTIVITAET_ARTEN = [
  { value: 'notiz', label: 'Notiz', icon: '📝', nurAnzeige: true },
  { value: 'email', label: 'E-Mail', icon: '✉️', nurAnzeige: true },
  { value: 'anruf',       label: 'Anruf',        icon: '📞' },
  { value: 'besprechung', label: 'Besprechung',  icon: '🤝' },
  { value: 'verkostung',  label: 'Verkostung',   icon: '🍷' },
  { value: 'messe',       label: 'Messe',        icon: '🏛️'  },
  { value: 'besuch',      label: 'Besuch',       icon: '🚗' },
  { value: 'angebot',     label: 'Angebot',      icon: '📄' },
  { value: 'verkauf',     label: 'Verkauf',      icon: '🛒' },
  { value: 'sonstiges',   label: 'Sonstiges',    icon: '•'  },
  { value: 'urlaub',      label: 'Urlaub',       icon: '🏖'  },
  { value: 'abwesenheit', label: 'Abwesenheit',  icon: '🚫' },
] as const

// ── Basis-Typen für Komponenten ───────────────────────────────────────────────

export type KontaktRow = {
  id: string
  kundennummer: string | null
  vorname: string | null
  nachname: string
  segment: Kundensegment
  firma_id: string | null
  firma_name?: string | null
  email: string | null
  telefon: string | null
  mobil: string | null
  strasse: string | null
  plz: string | null
  ort: string | null
  land: string | null
  newsletter: boolean
  newsletter_bestaetigt: boolean
  stammkunde: boolean
  notizen: string | null
  rabattgruppe_id: string | null
  rabattgruppe_name?: string | null
  rabattgruppe_pct?: number | null
  sonderrabatt_pct?: number | null
  skonto_pct?: number | null
  skonto_tage?: number | null
  is_lead?: boolean
  telefon_vorwahl?: string | null
  mobil_vorwahl?: string | null
  aktiv: boolean
  erstellt_am: string
}

export type FirmaRow = {
  id: string
  kundennummer: string | null
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
  betrieb_nr?: string | null
  kreditlimit: number | null
  rabattgruppe_id: string | null
  rabattgruppe_name?: string | null
  rabattgruppe_pct?: number | null
  sonderrabatt_pct?: number | null
  skonto_pct?: number | null
  skonto_tage?: number | null
  is_lead?: boolean
  telefon_vorwahl?: string | null
  zahlungsziel_tage: number | null
  waehrung: string | null
  notizen: string | null
  aktiv: boolean
  kontakt_anzahl?: number
}

export type AktivitaetDokument = {
  id: string
  aktivitaet_id: string
  dateiname: string
  dateityp: string
  groesse_bytes: number | null
  storage_pfad: string
  erstellt_am: string
}

export type AktivitaetRow = {
  id: string
  art: string
  betreff: string | null
  beschreibung: string | null
  datum: string
  ganztags: boolean
  uhrzeit_von: string | null   // "HH:MM:SS" aus PostgreSQL time
  uhrzeit_bis: string | null
  erledigt: boolean
  kontakt_id: string | null
  kontakt_name?: string | null
  firma_id: string | null
  firma_name?: string | null
  email_id?: string | null
  email_conversation_id?: string | null
  ist_privat?: boolean | null
  erstellt_von?: string | null
  bis_datum?: string | null
  email_von?: string | null
  email_von_name?: string | null
  email_an?: string | null
  email_body?: string | null
  email_body_html?: string | null
  dokumente?: AktivitaetDokument[]
}

export type PipelineEintragRow = {
  id: string
  stufe: PipelineStufe
  titel: string
  kategorie: string | null
  wert_euro: number | null
  wahrscheinlichkeit: number | null
  erwartetes_datum: string | null
  ganztags: boolean
  uhrzeit_von: string | null   // "HH:MM:SS"
  uhrzeit_bis: string | null
  erledigt: boolean
  erledigt_am: string | null
  notizen: string | null
  kontakt_id: string | null
  kontakt_name?: string | null
  firma_id: string | null
  firma_name?: string | null
  aktualisiert_am: string
}

// ── Hilfsfunktionen ───────────────────────────────────
/** Formatiert eine PostgreSQL time-Spalte "HH:MM:SS" → "HH:MM" für die Anzeige */
export function fmtUhrzeit(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(0, 5)   // "09:30:00" → "09:30"
}
