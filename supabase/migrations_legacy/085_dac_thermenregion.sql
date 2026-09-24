-- Migration 085: Thermenregion DAC zur dac_region CHECK CONSTRAINT hinzufügen

ALTER TABLE dac_antrag
  DROP CONSTRAINT IF EXISTS dac_antrag_dac_region_check;

ALTER TABLE dac_antrag
  ADD CONSTRAINT dac_antrag_dac_region_check
  CHECK (dac_region IN (
    'weinviertel','kamptal','kremstal','wachau','wagram',
    'traisental','carnuntum','leithaberg','neusiedlersee',
    'mittelburgenland','eisenberg','rosalia','thermenregion',
    'wiener_gemischter_satz','sonstiges'
  ));
