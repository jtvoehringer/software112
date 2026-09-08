-- SVS-Beiträge (Bäuerliche Sozialversicherung), Rückmeldung 8.9.2026:
-- Die SVS bemisst die Beiträge im Pauschalsystem nach dem Einheitswert der
-- bewirtschafteten Flächen (Versicherungswert lt. Staffel, BSVG § 23). Der
-- Betrieb kann alternativ die Beitragsgrundlagenoption wählen (Einkünfte lt.
-- Einkommensteuerbescheid). software:112 führt den Einheitswert je Grundstück,
-- rechnet Versicherungswert und Beiträge und stellt beide Varianten gegenüber.
-- Die Sätze sind Stammdaten je Jahr (svs_parameter) und vom Plattform-Admin
-- pflegbar - die Berechnung ist eine Orientierung, verbindlich ist der
-- Beitragsbescheid der SVS.

-- 1) Einheitswert und SVS-Zurechnung je Grundstück
ALTER TABLE grundstuecke
  ADD COLUMN IF NOT EXISTS einheitswert numeric(12,2),
  ADD COLUMN IF NOT EXISTS einheitswert_bescheid date,
  ADD COLUMN IF NOT EXISTS einheitswert_quelle text,
  ADD COLUMN IF NOT EXISTS svs_zurechnung text NOT NULL DEFAULT 'eigen'
    CHECK (svs_zurechnung IN ('eigen', 'pacht_fremd', 'pacht_angehoerige', 'verpachtet', 'keine'));
COMMENT ON COLUMN grundstuecke.einheitswert IS 'Einheitswert lt. Einheitswertbescheid / SVS (EUR), anteilig für dieses Grundstück';
COMMENT ON COLUMN grundstuecke.svs_zurechnung IS 'eigen = voll; pacht_fremd = 2/3 (Zupachtung von Fremden); pacht_angehoerige = voll (Zupachtung von nahen Angehörigen); verpachtet = Abzug; keine = nicht berücksichtigen';

-- Vorbelegung aus dem eAMA-Rechtsverhältnis (Pacht -> Zupachtung von Fremden)
UPDATE grundstuecke SET svs_zurechnung = 'pacht_fremd'
WHERE svs_zurechnung = 'eigen' AND lower(coalesce(rechtsverhaeltnis, '')) IN ('pacht', 'nutzung');

-- 2) Betriebsweite Wahl: Pauschalsystem oder Beitragsgrundlagenoption
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS svs_option text NOT NULL DEFAULT 'pauschal' CHECK (svs_option IN ('pauschal', 'option')),
  ADD COLUMN IF NOT EXISTS svs_option_seit date,
  ADD COLUMN IF NOT EXISTS svs_einkuenfte_manuell numeric(12,2),
  ADD COLUMN IF NOT EXISTS svs_kv_angehoerige boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN tenant_einstellungen.svs_option IS 'pauschal = Beitragsgrundlage vom Einheitswert; option = Beitragsgrundlagenoption (Einkünfte lt. ESt-Bescheid), Antrag bis 30.4. des Folgejahres';
COMMENT ON COLUMN tenant_einstellungen.svs_einkuenfte_manuell IS 'Einkünfte aus L&F lt. Einkommensteuerbescheid (Jahresbetrag) - überschreibt den Vorschlag aus der E&A-Rechnung';

-- 3) SVS-Parameter je Jahr (plattformweit)
CREATE TABLE IF NOT EXISTS svs_parameter (
  jahr            smallint PRIMARY KEY,
  -- Staffel Versicherungswert: [{ "bis": 5000, "prozent": 26.63301 }, ...], letzte Stufe bis null
  staffel         jsonb NOT NULL,
  satz_pv         numeric(5,2) NOT NULL,   -- Pensionsversicherung %
  satz_kv         numeric(5,2) NOT NULL,   -- Krankenversicherung %
  satz_uv         numeric(5,2) NOT NULL,   -- Unfallversicherung %
  satz_bh         numeric(5,2) NOT NULL,   -- Betriebshilfe %
  satz_kv_zusatz  numeric(5,2) NOT NULL,   -- Zusatzbeitrag KV Angehörige %
  min_bg_kv_pv    numeric(10,2) NOT NULL,  -- Mindestbeitragsgrundlage KV/PV (monatlich)
  min_bg_uv       numeric(10,2) NOT NULL,  -- Mindestbeitragsgrundlage UV (monatlich)
  hoechst_bg      numeric(10,2) NOT NULL,  -- Höchstbeitragsgrundlage (monatlich)
  hinweis         text,
  aktualisiert_am timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE svs_parameter ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svsp_select ON svs_parameter;
CREATE POLICY svsp_select ON svs_parameter FOR SELECT USING (auth.uid() IS NOT NULL);
-- Pflege nur über Service-Role (Admin-Client) durch den Plattform-Admin

-- Vorbelegung 2026 lt. SVS-Beitragstabelle gültig ab 1.1.2026
INSERT INTO svs_parameter (jahr, staffel, satz_pv, satz_kv, satz_uv, satz_bh, satz_kv_zusatz, min_bg_kv_pv, min_bg_uv, hoechst_bg, hinweis)
VALUES (2026,
  '[{"bis":5000,"prozent":26.63301},{"bis":8700,"prozent":29.59227},{"bis":10900,"prozent":24.04369},{"bis":14500,"prozent":16.64569},{"bis":21800,"prozent":13.50148},{"bis":29000,"prozent":9.98743},{"bis":36300,"prozent":7.39809},{"bis":43600,"prozent":5.54858},{"bis":null,"prozent":4.25390}]',
  17.00, 6.80, 1.90, 0.40, 3.40, 551.10, 1091.21, 8085.00,
  'SVS-Beitragstabelle ab 1.1.2026 (Staffel = Einkommensfaktoren nach Einheitswertgrenzen, Sätze PV/KV/UV/Betriebshilfe). Vor Verwendung mit der SVS abgleichen.')
ON CONFLICT (jahr) DO NOTHING;
