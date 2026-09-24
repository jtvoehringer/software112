-- Migration 065: Qualitätsstufen-Check erweitern (DAC, Sekt, Reserve etc.)
-- Der ursprüngliche CHECK (Migration 017) kannte nur die alten österr. Weinstufen.
-- Fehlende Werte: dac, reserve, erste_lage, grosses_gewachs, sekt, perlwein, sonstiges

ALTER TABLE weinausbau
  DROP CONSTRAINT IF EXISTS weinausbau_qualitaetsstufe_check;

ALTER TABLE weinausbau
  ADD CONSTRAINT weinausbau_qualitaetsstufe_check
  CHECK (qualitaetsstufe IN (
    'wein', 'landwein', 'qualitaetswein',
    'kabinett', 'spaetlese', 'auslese', 'beerenauslese', 'ausbruch',
    'trockenbeerenauslese', 'eiswein', 'strohwein',
    'dac', 'reserve', 'erste_lage', 'grosses_gewachs',
    'sekt', 'perlwein', 'sonstiges'
  ));
