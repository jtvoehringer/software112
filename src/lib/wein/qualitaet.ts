// Österreichische Weingesetz-Qualitätsstufen (aufsteigend nach Rang)
// Enthält alle Werte die in den Formularen vorkommen können

export const QUALITAET_OPTS = [
  { value: 'wein',                 label: 'Wein (ohne Herkunft)',           rang: 0 },
  { value: 'landwein',             label: 'Landwein',                       rang: 1 },
  { value: 'qualitaetswein',       label: 'Qualitätswein',                  rang: 2 },
  { value: 'kabinett',             label: 'Kabinett',                       rang: 3 },
  { value: 'spaetlese',            label: 'Spätlese',                       rang: 4 },
  { value: 'auslese',              label: 'Auslese',                        rang: 5 },
  { value: 'beerenauslese',        label: 'Beerenauslese (BA)',             rang: 6 },
  { value: 'ausbruch',             label: 'Ausbruch',                       rang: 7 },
  { value: 'trockenbeerenauslese', label: 'Trockenbeerenauslese (TBA)',     rang: 8 },
  { value: 'eiswein',              label: 'Eiswein',                        rang: 9 },
  { value: 'strohwein',            label: 'Strohwein / Schilfwein',         rang: 9 },
  // Ergänzende Bezeichnungen (in Füllungsformular wählbar)
  { value: 'dac',                  label: 'DAC',                            rang: 3 },
  { value: 'reserve',              label: 'Reservé / Reserve',              rang: 4 },
  { value: 'erste_lage',           label: 'Erste Lage (ÖTW)',               rang: 5 },
  { value: 'grosses_gewachs',      label: 'Großes Gewächs',                 rang: 6 },
  { value: 'sekt',                 label: 'Sekt b.A.',                      rang: 2 },
  { value: 'perlwein',             label: 'Perlwein',                       rang: 1 },
  { value: 'sonstiges',            label: 'Sonstiges',                      rang: 0 },
] as const

export type Qualitaetsstufe = typeof QUALITAET_OPTS[number]['value']

export function qualitaetLabel(value: string | null | undefined): string {
  if (!value) return '–'
  return QUALITAET_OPTS.find(o => o.value === value)?.label ?? value
}

/** Gibt die niedrigere der beiden Qualitätsstufen zurück (Verschnitt-Regel) */
export function minQualitaet(a: string | null, b: string | null): string | null {
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  const ra = QUALITAET_OPTS.find(o => o.value === a)?.rang ?? 99
  const rb = QUALITAET_OPTS.find(o => o.value === b)?.rang ?? 99
  return ra <= rb ? a : b
}
