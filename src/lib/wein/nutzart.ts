// Nutzarten der Grundstücke (CHECK-Constraint grundstuecke.nutzart, Migrationen 170/176/177).
// Ohne React, damit Behördenmeldungen und node:test sie laden können; grundstueckStatus.tsx exportiert sie weiter.
export const NUTZART_OPTIONS = [
  { value: 'A',   label: 'Grünbrache',                                          badge: 'bg-s112-warn-bg text-s112-warn-fg' },
  { value: 'G',   label: 'Grünlandbrache',                                      badge: 'bg-s112-warn-bg text-s112-warn-fg' },
  { value: 'WI',  label: 'Wein',                                                badge: 'bg-s112-ok-bg text-s112-ok-fg' },
  { value: 'GL1', label: 'GLÖZ Rain / Böschung / Trockensteinmauer',            badge: 'bg-[#F2F3F5] text-s112-text-1' },
  { value: 'GL2', label: 'GLÖZ Hecke / Ufergehölz',                             badge: 'bg-[#F2F3F5] text-s112-text-1' },
  { value: 'GL3', label: 'GLÖZ Feldgehölz / Baum- / Gebüschgruppe',             badge: 'bg-[#F2F3F5] text-s112-text-1' },
  // LSE = Landschaftselement. Einzige Nutzart mit zusätzlicher Stückzahl-
  // Erfassung (grundstuecke.lse_stueckzahl) - siehe GrundstueckePanel.tsx.
  { value: 'LSE', label: 'LSE Bäume / Büsche',                                  badge: 'bg-s112-ok-bg text-s112-ok-fg' },
]
