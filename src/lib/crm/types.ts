// ── Segment-Definitionen ──────────────────────────────────────────────────────

export const SEGMENTE = [
  { value: 'privat',      label: 'Privat',       farbe: 'bg-s112-blue-100 text-s112-blue-700'   },
  { value: 'gastronomie', label: 'Gastronomie',        farbe: 'bg-s112-warn-bg text-s112-warn-fg' },
  { value: 'handel',      label: 'Handel',             farbe: 'bg-[#F2F3F5] text-s112-text-1' },
  { value: 'export',      label: 'Export',             farbe: 'bg-s112-ok-bg text-s112-ok-fg'  },
  { value: 'grosshandel', label: 'Großhandel',         farbe: 'bg-[#F2F3F5] text-s112-text'   },
  { value: 'produzent',   label: 'Produzent',           farbe: 'bg-s112-err-bg text-s112-err-fg'    },
  { value: 'weinhauer',   label: 'Weinhauer',           farbe: 'bg-s112-ok-bg text-s112-ok-fg'     },
  // Migration 185 (1.9.2026) – ergänzt auf Kundenwunsch um die Kundengruppen
  // aus dem DKB-Altsystem-Import (Kontakte_Firmen_DKB.csv), damit diese beim
  // Import nicht mehr pauschal auf einen Standardwert fallen.
  { value: 'firmenkunde', label: 'Firmenkunde',        farbe: 'bg-s112-blue-100 text-s112-blue-700' },
  { value: 'vinothek',    label: 'Vinothek',            farbe: 'bg-s112-warn-bg text-s112-warn-fg'   },
  { value: 'abhof',       label: 'Ab Hof',              farbe: 'bg-s112-ok-bg text-s112-ok-fg' },
  { value: 'restaurant',  label: 'Restaurant',          farbe: 'bg-[#F2F3F5] text-s112-text-1'     },
  { value: 'tourismus',   label: 'Tourismus',           farbe: 'bg-[#F2F3F5] text-s112-text-1'     },
  // Migration 186 (1.9.2026) – auf Kundenwunsch ergänzt.
  { value: 'medien',      label: 'Medien',               farbe: 'bg-[#F2F3F5] text-s112-text-1' },
  { value: 'importeur',   label: 'Importeur',            farbe: 'bg-[#F2F3F5] text-s112-text-1'     },
  { value: 'sonstige',    label: 'Sonstige',             farbe: 'bg-[#F2F3F5] text-s112-text'   },
] as const

export type Kundensegment = (typeof SEGMENTE)[number]['value']

export function segmentLabel(value: string | null | undefined): string {
  return SEGMENTE.find(s => s.value === value)?.label ?? value ?? '–'
}

export function segmentFarbe(value: string | null | undefined): string {
  return SEGMENTE.find(s => s.value === value)?.farbe ?? 'bg-[#F2F3F5] text-s112-text-2'
}

// ── Länder / Vorwahlen ────────────────────────────────────────────────────────
// Migration 190 (1.9.2026) – zentralisiert (vorher identisch dupliziert in
// FirmenClient.tsx und KontakteClient.tsx) und um weitere Länder ergänzt,
// nachdem ein dänischer Kunde weder im Ländercode-Dropdown noch in der
// Vorwahlen-Liste vorhanden war (Vorwahl ist dadurch fälschlich auf +43
// zurückgefallen). Rückmeldung 1.9.2026: für exportorientierte Kunden werden
// nach und nach weitere Länder ergänzt (zunächst Fernost-Exportmärkte:
// Thailand, Singapur, Südkorea, Japan, Malaysia). Falls weitere Länder
// fehlen, hier ergänzen statt erneut pro Komponente zu duplizieren.

export const LAENDER = [
  'AT', 'DE', 'CH', 'IT', 'FR', 'HU', 'SK', 'CZ', 'SI', 'LI',
  'NL', 'BE', 'LU', 'DK', 'SE', 'NO', 'FI', 'PL', 'ES', 'PT',
  'IE', 'GB', 'US', 'CA',
  // Exportmärkte Fernost (1.9.2026)
  'JP', 'KR', 'SG', 'MY', 'TH', 'CN',
  // weitere Exportmärkte (1.9.2026)
  'MC', 'AE', 'AL', 'BG', 'RO', 'UA',
  // Dynamics-Lead-Import Gebeshuber (3.9.2026): alle dort vorkommenden Länder,
  // damit importierte Werte im Formular sichtbar bleiben (ein Wert außerhalb
  // dieser Liste würde im Auswahlfeld leer angezeigt und beim Speichern verloren gehen).
  'LK', 'PH', 'RU', 'HK', 'MO', 'TW', 'IN', 'ID', 'VN', 'AU', 'NZ', 'ZA', 'BR', 'MX', 'AR', 'CL', 'PE',
  'TR', 'IL', 'GR', 'HR', 'RS', 'BA', 'MK', 'LT', 'LV', 'EE', 'MT', 'CY', 'IS', 'BY', 'MD', 'GE', 'AM', 'AZ',
  'BH', 'QA', 'SA', 'KW', 'OM', 'EG', 'MA', 'TN', 'MU', 'MV', 'SC', 'KH', 'LA', 'MM', 'BN', 'PK', 'BD', 'NP',
]

export const DIAL_CODES = [
  { code: '+43',  flag: '🇦🇹', iso: 'AT' },
  { code: '+49',  flag: '🇩🇪', iso: 'DE' },
  { code: '+41',  flag: '🇨🇭', iso: 'CH' },
  { code: '+423', flag: '🇱🇮', iso: 'LI' },
  { code: '+39',  flag: '🇮🇹', iso: 'IT' },
  { code: '+386', flag: '🇸🇮', iso: 'SI' },
  { code: '+421', flag: '🇸🇰', iso: 'SK' },
  { code: '+420', flag: '🇨🇿', iso: 'CZ' },
  { code: '+36',  flag: '🇭🇺', iso: 'HU' },
  { code: '+33',  flag: '🇫🇷', iso: 'FR' },
  { code: '+31',  flag: '🇳🇱', iso: 'NL' },
  { code: '+32',  flag: '🇧🇪', iso: 'BE' },
  { code: '+352', flag: '🇱🇺', iso: 'LU' },
  { code: '+45',  flag: '🇩🇰', iso: 'DK' },
  { code: '+46',  flag: '🇸🇪', iso: 'SE' },
  { code: '+47',  flag: '🇳🇴', iso: 'NO' },
  { code: '+358', flag: '🇫🇮', iso: 'FI' },
  { code: '+48',  flag: '🇵🇱', iso: 'PL' },
  { code: '+34',  flag: '🇪🇸', iso: 'ES' },
  { code: '+351', flag: '🇵🇹', iso: 'PT' },
  { code: '+353', flag: '🇮🇪', iso: 'IE' },
  { code: '+44',  flag: '🇬🇧', iso: 'GB' },
  { code: '+1',   flag: '🇺🇸/🇨🇦', iso: 'US' },
  // Exportmärkte Fernost (1.9.2026)
  { code: '+81',  flag: '🇯🇵', iso: 'JP' },
  { code: '+82',  flag: '🇰🇷', iso: 'KR' },
  { code: '+65',  flag: '🇸🇬', iso: 'SG' },
  { code: '+60',  flag: '🇲🇾', iso: 'MY' },
  { code: '+66',  flag: '🇹🇭', iso: 'TH' },
  { code: '+86',  flag: '🇨🇳', iso: 'CN' },
  // weitere Exportmärkte (1.9.2026)
  { code: '+377', flag: '🇲🇨', iso: 'MC' },
  { code: '+971', flag: '🇦🇪', iso: 'AE' },
  { code: '+355', flag: '🇦🇱', iso: 'AL' },
  { code: '+359', flag: '🇧🇬', iso: 'BG' },
  { code: '+40',  flag: '🇷🇴', iso: 'RO' },
  { code: '+380', flag: '🇺🇦', iso: 'UA' },
  // Dynamics-Lead-Import Gebeshuber (3.9.2026)
  { code: '+94',  flag: '🇱🇰', iso: 'LK' },
  { code: '+63',  flag: '🇵🇭', iso: 'PH' },
  { code: '+7',   flag: '🇷🇺', iso: 'RU' },
  { code: '+852', flag: '🇭🇰', iso: 'HK' },
  { code: '+853', flag: '🇲🇴', iso: 'MO' },
  { code: '+886', flag: '🇹🇼', iso: 'TW' },
  { code: '+91',  flag: '🇮🇳', iso: 'IN' },
  { code: '+62',  flag: '🇮🇩', iso: 'ID' },
  { code: '+84',  flag: '🇻🇳', iso: 'VN' },
  { code: '+61',  flag: '🇦🇺', iso: 'AU' },
  { code: '+64',  flag: '🇳🇿', iso: 'NZ' },
  { code: '+27',  flag: '🇿🇦', iso: 'ZA' },
  { code: '+55',  flag: '🇧🇷', iso: 'BR' },
  { code: '+52',  flag: '🇲🇽', iso: 'MX' },
  { code: '+54',  flag: '🇦🇷', iso: 'AR' },
  { code: '+56',  flag: '🇨🇱', iso: 'CL' },
  { code: '+51',  flag: '🇵🇪', iso: 'PE' },
  { code: '+90',  flag: '🇹🇷', iso: 'TR' },
  { code: '+972', flag: '🇮🇱', iso: 'IL' },
  { code: '+30',  flag: '🇬🇷', iso: 'GR' },
  { code: '+385', flag: '🇭🇷', iso: 'HR' },
  { code: '+381', flag: '🇷🇸', iso: 'RS' },
  { code: '+387', flag: '🇧🇦', iso: 'BA' },
  { code: '+389', flag: '🇲🇰', iso: 'MK' },
  { code: '+370', flag: '🇱🇹', iso: 'LT' },
  { code: '+371', flag: '🇱🇻', iso: 'LV' },
  { code: '+372', flag: '🇪🇪', iso: 'EE' },
  { code: '+356', flag: '🇲🇹', iso: 'MT' },
  { code: '+357', flag: '🇨🇾', iso: 'CY' },
  { code: '+354', flag: '🇮🇸', iso: 'IS' },
  { code: '+375', flag: '🇧🇾', iso: 'BY' },
  { code: '+373', flag: '🇲🇩', iso: 'MD' },
  { code: '+995', flag: '🇬🇪', iso: 'GE' },
  { code: '+374', flag: '🇦🇲', iso: 'AM' },
  { code: '+994', flag: '🇦🇿', iso: 'AZ' },
  { code: '+973', flag: '🇧🇭', iso: 'BH' },
  { code: '+974', flag: '🇶🇦', iso: 'QA' },
  { code: '+966', flag: '🇸🇦', iso: 'SA' },
  { code: '+965', flag: '🇰🇼', iso: 'KW' },
  { code: '+968', flag: '🇴🇲', iso: 'OM' },
  { code: '+20',  flag: '🇪🇬', iso: 'EG' },
  { code: '+212', flag: '🇲🇦', iso: 'MA' },
  { code: '+216', flag: '🇹🇳', iso: 'TN' },
  { code: '+230', flag: '🇲🇺', iso: 'MU' },
  { code: '+960', flag: '🇲🇻', iso: 'MV' },
  { code: '+248', flag: '🇸🇨', iso: 'SC' },
  { code: '+855', flag: '🇰🇭', iso: 'KH' },
  { code: '+856', flag: '🇱🇦', iso: 'LA' },
  { code: '+95',  flag: '🇲🇲', iso: 'MM' },
  { code: '+673', flag: '🇧🇳', iso: 'BN' },
  { code: '+92',  flag: '🇵🇰', iso: 'PK' },
  { code: '+880', flag: '🇧🇩', iso: 'BD' },
  { code: '+977', flag: '🇳🇵', iso: 'NP' },
]

// ── Pipeline-Stufen ───────────────────────────────────────────────────────────

export const PIPELINE_STUFEN = [
  { value: 'interessent',  label: 'Interessent',   farbe: 'bg-[#F2F3F5] text-s112-text-1'    },
  { value: 'kontaktiert',  label: 'Kontaktiert',   farbe: 'bg-s112-blue-100 text-s112-blue-700'    },
  { value: 'verkostung',   label: 'Verkostung',    farbe: 'bg-[#F2F3F5] text-s112-text-1' },
  { value: 'angebot',      label: 'Angebot',       farbe: 'bg-s112-warn-bg text-s112-warn-fg' },
  { value: 'verhandlung',  label: 'Verhandlung',   farbe: 'bg-s112-warn-bg text-s112-warn-fg' },
  { value: 'abschluss',    label: 'Abschluss',     farbe: 'bg-s112-ok-bg text-s112-ok-fg'  },
  { value: 'stammkunde',   label: 'Stammkunde',    farbe: 'bg-[#F2F3F5] text-s112-text-1'    },
  { value: 'verloren',     label: 'Verloren',      farbe: 'bg-s112-err-bg text-s112-err-fg'      },
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
  { value: 'notiz', label: 'Notiz', nurAnzeige: true },
  { value: 'email', label: 'E-Mail', nurAnzeige: true },
  { value: 'anruf',       label: 'Anruf' },
  { value: 'aufgabe',     label: 'Aufgabe' },
  { value: 'besprechung', label: 'Besprechung' },
  { value: 'verkostung',  label: 'Verkostung' },
  { value: 'messe',       label: 'Messe' },
  { value: 'besuch',      label: 'Besuch' },
  { value: 'angebot',     label: 'Angebot' },
  { value: 'verkauf',     label: 'Verkauf' },
  { value: 'sonstiges',   label: 'Sonstiges' },
  { value: 'urlaub',      label: 'Urlaub' },
  { value: 'abwesenheit', label: 'Abwesenheit' },
] as const

// ── Basis-Typen für Komponenten ───────────────────────────────────────────────

export type KontaktRow = {
  id: string
  accountnummer: string | null
  vorname: string | null
  nachname: string
  segment: Kundensegment
  firma_id: string | null
  firma_name?: string | null
  email: string | null
  email_weitere?: string[]  // Migration 211: weitere Adressen (Standard bleibt email)
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
  // Zahlungsziel in Tagen - Pflichtfeld, 0 bedeutet "bei Erhalt" (siehe
  // verkaufRechnungPdf.tsx). Ersetzt das frühere, betriebsweite
  // tenant_einstellungen.rechnung_zahlungsziel (6.8.2026).
  zahlungsziel_tage: number
  aktiv: boolean
  erstellt_am: string
}

export type FirmaRow = {
  id: string
  accountnummer: string | null
  name: string
  segment: Kundensegment
  strasse: string | null
  plz: string | null
  ort: string | null
  land: string | null
  email: string | null
  email_weitere?: string[]  // Migration 211: weitere Adressen (Standard bleibt email)
  telefon: string | null
  website: string | null
  uid_nummer: string | null
  betrieb_nr?: string | null
  // Migration 191 (1.9.2026) - Debitorenkonto-Nummer aus der externen
  // Buchhaltung (BMD NTCS) bzw. "Das Kellerbuch" - unabhängig von der
  // intern vergebenen accountnummer, siehe Migrationskommentar.
  debitor_nr?: string | null
  kreditlimit: number | null
  rabattgruppe_id: string | null
  rabattgruppe_name?: string | null
  rabattgruppe_pct?: number | null
  sonderrabatt_pct?: number | null
  skonto_pct?: number | null
  skonto_tage?: number | null
  is_lead?: boolean
  telefon_vorwahl?: string | null
  // Migration 190 (1.9.2026) - Firmen konnten bisher (anders als Kontakte)
  // keine eigene Mobilnummer erfassen.
  mobil?: string | null
  mobil_vorwahl?: string | null
  // Zahlungsziel in Tagen - Pflichtfeld seit 6.8.2026 (war zuvor optional,
  // Betrieb hatte ein zentrales Zahlungsziel; jetzt pro Kunde). 0 = "bei
  // Erhalt" (siehe verkaufRechnungPdf.tsx).
  zahlungsziel_tage: number
  waehrung: string | null
  notizen: string | null
  aktiv: boolean
  kontakt_anzahl?: number
  // Migration 167 - Kunde/Lieferant-Kennzeichnung (Firma kann beides, eines
  // oder keines von beidem sein). Default ist_kunde=true, ist_lieferant=false.
  ist_kunde?: boolean
  ist_lieferant?: boolean
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

// ── Verkäufe (Firma/Kontakt-Detailseite) ──────────────────────────────────────
// Echte Verkaufsdaten (nicht der CRM-Aktivitäten-Spiegel, der bei Fehlern
// leer/veraltet bleiben kann) – direkt aus verkaufsposten/verkauf_positionen.

export type VerkaufPositionRow = {
  menge: number
  einheit: string
  preis_brutto: number | null
  rabatt_pct: number | null
  sonderrabatt_pct: number | null
}

export type VerkaufRow = {
  id: string
  datum: string
  rechnungsnummer: string | null
  transaktions_nr: string | null
  storniert: boolean
  bezahlt: boolean
  positionen: VerkaufPositionRow[]
}

export function verkaufSumme(v: VerkaufRow): number {
  return v.positionen.reduce((s, pos) => {
    if (pos.preis_brutto == null) return s
    const brutto = Number(pos.preis_brutto) * Number(pos.menge)
    const rabatt = Number(pos.rabatt_pct ?? 0) / 100
    const sonder = Number(pos.sonderrabatt_pct ?? 0) / 100
    return s + brutto * (1 - rabatt) * (1 - sonder)
  }, 0)
}

// ── Hilfsfunktionen ───────────────────────────────────
/** Formatiert eine PostgreSQL time-Spalte "HH:MM:SS" → "HH:MM" für die Anzeige */
export function fmtUhrzeit(t: string | null | undefined): string {
  if (!t) return ''
  return t.slice(0, 5)   // "09:30:00" → "09:30"
}
