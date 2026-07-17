-- Migration 132: Herkunft-Code (BKI) durch die gesamte Produktionskette mitführen
-- Lese (ernte_parzellen) -> Pressung/Kellerbuch (weinausbau) -> Umzüge/Verschneidung -> Füllung
-- Spiegelt das bestehende qualitaetsstufe-Muster (vgl. Migration 017/065).
-- v1-Scope: WLNÖ (Weinland Niederösterreich) + Thermenregion DAC (3 Stufen).
-- Werte müssen exakt src/lib/herkunft.ts (HERKUNFT_ORDER) entsprechen.

-- 1. Grundstücke: bestehendes Freitextfeld auf den neuen Stufen-Code umstellen.
--    Bestehende Freitext-Werte (z.B. 'DAC', 'WLTH', 'WLWV') lassen sich nicht eindeutig
--    einer konkreten DAC-Stufe zuordnen -> auf die breiteste Stufe (WLNÖ) zurückgesetzt.
--    Die genaue Stufe je GST muss einmalig im neuen Dropdown nachgetragen werden.
UPDATE grundstuecke
SET    trauben_herkunft_code = 'wlnoe'
WHERE  trauben_herkunft_code IS NOT NULL;

ALTER TABLE grundstuecke
  DROP CONSTRAINT IF EXISTS grundstuecke_trauben_herkunft_code_check;

ALTER TABLE grundstuecke
  ADD CONSTRAINT grundstuecke_trauben_herkunft_code_check
  CHECK (trauben_herkunft_code IN (
    'wein', 'wlnoe',
    'thermenregion_gebietswein', 'thermenregion_ortswein', 'thermenregion_riedenwein',
    'sonstiges'
  ));

COMMENT ON COLUMN grundstuecke.trauben_herkunft_code IS
  'Herkunft-Code (BKI) gem. src/lib/herkunft.ts: wein | wlnoe | thermenregion_gebietswein | thermenregion_ortswein | thermenregion_riedenwein | sonstiges';

-- 2. Lese: Herkunft-Code je Ernte-Parzelle (analog qualitaetsstufe)
ALTER TABLE ernte_parzellen
  ADD COLUMN IF NOT EXISTS herkunft_code text
    CHECK (herkunft_code IN (
      'wein', 'wlnoe',
      'thermenregion_gebietswein', 'thermenregion_ortswein', 'thermenregion_riedenwein',
      'sonstiges'
    ));

COMMENT ON COLUMN ernte_parzellen.herkunft_code IS
  'Herkunft-Code (BKI), aus Grundstück übernommen inkl. automatischer Sortenspiegel-Abstufung (src/lib/herkunft.ts)';

-- 3. Kellerbuch-Charge: Herkunft-Code (analog qualitaetsstufe)
ALTER TABLE weinausbau
  ADD COLUMN IF NOT EXISTS herkunft_code text
    CHECK (herkunft_code IN (
      'wein', 'wlnoe',
      'thermenregion_gebietswein', 'thermenregion_ortswein', 'thermenregion_riedenwein',
      'sonstiges'
    ));

COMMENT ON COLUMN weinausbau.herkunft_code IS
  'Herkunft-Code (BKI) der Charge; wird bei Verschneidung nur abgestuft, nie aufgestuft (vgl. qualitaetsstufe)';

-- 4. Umzüge: Herkunft vorher/nachher zu Audit-Zwecken (analog qualitaet_vorher/qualitaet_nachher)
ALTER TABLE keller_umzuege
  ADD COLUMN IF NOT EXISTS herkunft_code_vorher text,
  ADD COLUMN IF NOT EXISTS herkunft_code_nachher text;

COMMENT ON COLUMN keller_umzuege.herkunft_code_vorher  IS 'Herkunft-Code der Quell-Charge vor dem Umzug (Audit)';
COMMENT ON COLUMN keller_umzuege.herkunft_code_nachher IS 'Herkunft-Code nach dem Umzug (Audit, i.d.R. unverändert)';

-- 5. Verschneidung: Herkunft-Code der Zielcharge vor dem Verschnitt sichern (für Stornierung),
--    analog ziel_qualitaet_vorher.
ALTER TABLE verschneidungen
  ADD COLUMN IF NOT EXISTS ziel_herkunft_code_vorher text;

COMMENT ON COLUMN verschneidungen.ziel_herkunft_code_vorher IS
  'Herkunft-Code der Ziel-Charge vor der Verschneidung (für Stornierung/Wiederherstellung)';

-- 6. Füllung: manuell änderbares Herkunft-Feld, downgrade-only-Prüfung analog 'qualitaet'
ALTER TABLE fuellungen
  ADD COLUMN IF NOT EXISTS herkunft_code text
    CHECK (herkunft_code IN (
      'wein', 'wlnoe',
      'thermenregion_gebietswein', 'thermenregion_ortswein', 'thermenregion_riedenwein',
      'sonstiges'
    ));

COMMENT ON COLUMN fuellungen.herkunft_code IS
  'Herkunft-Code (BKI) der Füllung; manuell nur abstufbar gegenüber der verknüpften Kellerbuch-Charge, nie aufstufbar';
