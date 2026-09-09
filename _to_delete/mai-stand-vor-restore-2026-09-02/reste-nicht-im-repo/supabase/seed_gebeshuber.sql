-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: Weingut Johannes Gebeshuber, Gumpoldskirchen (Thermenregion)
-- Betriebsnummer: 4489781
-- 40 Weingärten | 123 Grundstücke | 28.1613 ha
-- Stand: Spritzplan 2025 v2.5
-- ─────────────────────────────────────────────────────────────────────────────

-- SCHRITT 1: Tenant-ID ermitteln und unten eintragen:
--   SELECT id FROM tenants LIMIT 1;

DO $$
DECLARE
  v_tenant_id uuid := 'fa22dc07-eca5-43df-af96-f7b9b09f0471'::uuid;
  v_wg_id     uuid;
BEGIN

-- Tenant-Stammdaten
UPDATE tenants SET
  name = 'Weingut Johannes Gebeshuber',
  slug = 'weingut-gebeshuber'
WHERE id = v_tenant_id;

-- ─── WEINGÄRTEN & GRUNDSTÜCKE ────────────────────────────────────────────────

-- aussätze/modler II (fs 56) — 0.1712 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'aussätze/modler II', 'fs 56', 0.1712, 'Zierfandler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2355/1', '16110', 'Zierfandler', 2013, 0.0778, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2355/2', '16110', 'Zierfandler', 2013, 0.0019, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2355/1', '16110', 'Gelber Muskateller', 2013, 0.0844, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2355/2', '16110', 'Gelber Muskateller', 2013, 0.0071, true);

-- haide II (fs 60) — 0.2412 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'haide II', 'fs 60', 0.2412, 'Roter Veltliner', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1514', '16110', 'Roter Veltliner', 1990, 0.2378, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1519/1', '16110', 'Roter Veltliner', 1990, 0.0028, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2780/25', '16110', 'Roter Veltliner', 1990, 0.0006, true);

-- taglsteiner I (fs 52) — 0.3131 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'taglsteiner I', 'fs 52', 0.3131, 'Cabernet Sauvignon', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1994/2', '4023', 'Cabernet Sauvignon', 1990, 0.0049, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1996', '4023', 'Cabernet Sauvignon', 1990, 0.1026, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1997', '4023', 'Cabernet Sauvignon', 1990, 0.1852, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1998', '4023', 'Cabernet Sauvignon', 1990, 0.0118, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1999', '4023', 'Cabernet Sauvignon', 1990, 0.0051, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2018', '4023', 'Cabernet Sauvignon', 1990, 0.0035, true);

-- taglsteiner II (fs 53) — 0.2193 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'taglsteiner II', 'fs 53', 0.2193, 'Cabernet Sauvignon', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1981/2', '4023', 'Cabernet Sauvignon', 2013, 0.1898, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1984/1', '4023', 'Cabernet Sauvignon', 2013, 0.0295, true);

-- braun (fs 61) — 0.1797 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'braun', 'fs 61', 0.1797, 'Rotgipfler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '924', '16110', 'Rotgipfler', 2013, 0.1797, true);

-- eichkogel (fs 12) — 0.4369 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'eichkogel', 'fs 12', 0.4369, 'Zierfandler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1920/2', '16110', 'Zierfandler', 2007, 0.0141, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1921', '16110', 'Zierfandler', 2007, 0.2074, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1922/1', '16110', 'Zierfandler', 2007, 0.0411, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2233', '16110', 'Zierfandler', 2007, 0.0165, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1894/1', '16110', 'Rotgipfler', 2007, 0.0058, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1921', '16110', 'Rotgipfler', 2007, 0.0079, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1922/1', '16110', 'Rotgipfler', 2007, 0.0946, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1922/4', '16110', 'Rotgipfler', 2007, 0.0495, true);

-- doctnerin I (fs 64) — 0.3896 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'doctnerin I', 'fs 64', 0.3896, 'Chardonnay', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1453', '16110', 'Chardonnay', 1999, 0.3896, true);

-- doctnerin II (fs 65) — 0.3024 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'doctnerin II', 'fs 65', 0.3024, 'Grüner Veltliner', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1478/2', '16110', 'Grüner Veltliner', 2013, 0.02, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1479/1', '16110', 'Grüner Veltliner', 2013, 0.2824, true);

-- füllenkeller I (fs 54) — 0.0566 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'füllenkeller I', 'fs 54', 0.0566, 'Brache', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '334/2', '4023', 'Brache', NULL, 0.0566, false);

-- füllenkeller II (fs 62) — 0.472 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'füllenkeller II', 'fs 62', 0.472, 'Brache', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1532', '16110', 'Brache', NULL, 0.4682, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1566/1', '16110', 'Brache', NULL, 0.002, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2780/1', '16110', 'Brache', NULL, 0.0018, false);

-- glaslautern hütte/glas (fs 13/14/15) — 1.0115 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'glaslautern hütte/glas', 'fs 13/14/15', 1.0115, 'St. Laurent', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/83', '4023', 'St. Laurent', NULL, 0.26, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/85', '4023', 'St. Laurent', NULL, 0.0166, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/124', '4023', 'St. Laurent', NULL, 0.025, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2130/1', '4023', 'St. Laurent', NULL, 0.2722, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2130/2', '4023', 'St. Laurent', NULL, 0.0857, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2132', '4023', 'St. Laurent', NULL, 0.196, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2133', '4023', 'Gerodet', NULL, 0.156, false);

-- glaslautern (köck) (fs 21/22) — 0.49 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'glaslautern (köck)', 'fs 21/22', 0.49, 'Rotgipfler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/92', '4023', 'Rotgipfler', NULL, 0.256, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/115', '4023', 'Rotgipfler', NULL, 0.234, true);

-- glaslautern oben/unten/glas (fs 13/14/15) — 1.2653 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'glaslautern oben/unten/glas', 'fs 13/14/15', 1.2653, 'Blauburgunder', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/43+97', '4023', 'Blauburgunder', NULL, 0.3618, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/95', '4023', 'Brache', NULL, 0.46, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/42', '4023', 'Rotgipfler', NULL, 0.0544, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/95', '4023', 'Blaufränkisch', NULL, 0.254, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2128/95', '4023', 'Gerodet', NULL, 0.1351, false);

-- hutweide (fs 58) — 0.2957 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'hutweide', 'fs 58', 0.2957, 'Welschriesling', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1613/1', '16110', 'Welschriesling', 1989, 0.2507, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1613/2', '16110', 'Welschriesling', 1989, 0.045, true);

-- haide (fs 3) — 0.33 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'haide', 'fs 3', 0.33, 'Grünbrache', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1555/2/3', '16110', 'Grünbrache', NULL, 0.33, false);

-- im brunnberg (fs 19) — 1.0 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'im brunnberg', 'fs 19', 1.0, 'Pinot Noir', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '231', '4016', 'Gerodet', NULL, 0.26, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '233', '4016', 'Gerodet', NULL, 0.12, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '234/1', '4016', 'Gerodet', NULL, 0.13, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '234/4', '4016', 'Gerodet', NULL, 0.15, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '234/5', '4016', 'Gerodet', NULL, 0.06, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '234/6', '4016', 'Gerodet', NULL, 0.07, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '235', '4016', 'Gerodet', NULL, 0.12, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '235-a', '4016', 'Pinot Noir', NULL, 0.09, true);

-- thallern II (fs 55) — 0.1646 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'thallern II', 'fs 55', 0.1646, 'Weißburgunder', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1519/2', '16110', 'Weißburgunder', 2013, 0.0018, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2738/2', '16110', 'Weißburgunder', 2013, 0.0299, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2741', '16110', 'Weißburgunder', 2013, 0.1327, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2742/1', '16110', 'Weißburgunder', 2013, 0.0002, true);

-- laim (fs 2) — 5.6047 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'laim', 'fs 2', 5.6047, 'Rotgipfler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1411/1', '16110', 'Rotgipfler', NULL, 0.8565, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1411/2', '16110', 'Zierfandler', NULL, 0.55, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1411/2-a', '16110', 'Neuburger', NULL, 0.5576, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1415', '16110', 'Chardonnay', NULL, 0.196, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1416', '16110', 'Chardonnay', NULL, 0.14, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1416-a', '16110', 'Rotgipfler', NULL, 0.0725, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1417', '16110', 'Chardonnay', NULL, 0.1379, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1417-a', '16110', 'Rotgipfler', NULL, 0.0725, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1418', '16110', 'Sylvaner', NULL, 0.0975, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1418-a', '16110', 'Zierfandler', NULL, 0.0894, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1418-b', '16110', 'Zierfandler', NULL, 0.025, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1419', '16110', 'Rotgipfler', NULL, 0.5362, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1419-a', '16110', 'Zierfandler', NULL, 0.514, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1411/1', '16110', 'Weißburgunder', NULL, 0.8565, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1419-b', '16110', 'Zierfandler', NULL, 0.9031, true);

-- mitterwies (fs 16) — 0.445 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'mitterwies', 'fs 16', 0.445, 'Riesling', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '601/2', '4033', 'Riesling', NULL, 0.445, true);

-- goldknöpferl aussäze/modler (fs 6) — 0.3328 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'goldknöpferl aussäze/modler', 'fs 6', 0.3328, 'Zierfandler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2359', '16110', 'Zierfandler', NULL, 0.1665, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2361', '16110', 'Zierfandler', NULL, 0.1663, true);

-- schwaben/modler (fs 7) — 0.1747 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'schwaben/modler', 'fs 7', 0.1747, 'Zierfandler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2358', '16110', 'Zierfandler', NULL, 0.0849, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2360', '16110', 'Zierfandler', NULL, 0.0898, true);

-- hirsching (fs 11) — 0.1726 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'hirsching', 'fs 11', 0.1726, 'Muskateller', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1389', '16110', 'Muskateller', NULL, 0.1726, true);

-- obere badenwege (fs 57) — 0.154 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'obere badenwege', 'fs 57', 0.154, 'Grüner Veltliner', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2032', '16110', 'Grüner Veltliner', 1999, 0.1382, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2033/2', '16110', 'Grüner Veltliner', 1999, 0.0158, true);

-- oberer badener weg II (fs 63) — 0.157 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'oberer badener weg II', 'fs 63', 0.157, 'Brache', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2007', '16110', 'Brache', NULL, 0.0152, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2008/1', '16110', 'Brache', NULL, 0.1418, false);

-- riede mandlerin/wagner (fs 59) — 0.1424 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'riede mandlerin/wagner', 'fs 59', 0.1424, 'Welschriesling', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '766', '16110', 'Welschriesling', 1989, 0.1424, true);

-- schwaben (fs 44) — 0.3175 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'schwaben', 'fs 44', 0.3175, 'Rotgipfler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2292', '16110', 'Rotgipfler', NULL, 0.1703, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2293', '16110', 'Rotgipfler', NULL, 0.1472, true);

-- schwaben/viereck I/II (fs 8) — 0.44 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'schwaben/viereck I/II', 'fs 8', 0.44, 'Blauburgunder', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2020, 2022/1, 2022/2', '16110', 'Blauburgunder', NULL, 0.44, true);

-- schwaben/vierck II (fs 9) — 0.228 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'schwaben/vierck II', 'fs 9', 0.228, 'Blauburgunder', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2019/2', '16110', 'Blauburgunder', NULL, 0.228, true);

-- schwaben/viereck III (fs 10) — 0.24 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'schwaben/viereck III', 'fs 10', 0.24, 'Blauburgunder', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2014', '16110', 'Blauburgunder', NULL, 0.24, true);

-- schwaben (winternitz) (fs 47) — 0.2929 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'schwaben (winternitz)', 'fs 47', 0.2929, 'Rotgipfler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2303', '16110', 'Rotgipfler', NULL, 0.2929, true);

-- sonnberg (fs 66) — 0.2844 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'sonnberg', 'fs 66', 0.2844, 'Rotgipfler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1157/6', '16110', 'Rotgipfler', 2013, 0.0012, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1366/2', '16110', 'Rotgipfler', 2013, 0.2832, true);

-- spielbrett II (fs 43) — 0.4972 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'spielbrett II', 'fs 43', 0.4972, 'Blauburger', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2475/5, 2476/1, 2476/2, 2477/1', '4023', 'Blauburger', NULL, 0.2831, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2475/5, 2476/1, 2476/2,2477/1', '4023', 'Blauer Portugieser', NULL, 0.16, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2475/5', '4023', 'Zweigelt', NULL, 0.0541, true);

-- tettenhauer (fs 5) — 0.22 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'tettenhauer', 'fs 5', 0.22, 'Traminer', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2274/1', '16110', 'Traminer', NULL, 0.22, true);

-- spielbrett tettenhauer-haimtal (fs 4) — 0.33 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'spielbrett tettenhauer-haimtal', 'fs 4', 0.33, 'Sauvignon Blanc / Muskateller', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2268', '16110', 'Sauvignon Blanc / Muskateller', NULL, 0.33, true);

-- thallern I () — 9.4493 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'thallern I', NULL, 9.4493, 'Fs 23: Pinot Noir', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'gendl 2692/2', '16110', 'Fs 23: Pinot Noir', NULL, 0.53, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'thallern I 1293, 1294', '16110', 'Fs 24: Pinot Noir', NULL, 0.29, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'student 2777/1, 2777/4', '16110', 'Fs 25: Rotgipfler', NULL, 3.66, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'wiegen 905', '16110', 'Fs 26: Zierfandler', NULL, 1.16, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'satzing 2199/1, 2199/3', '16110', 'Fs 27: Sankt Laurent', NULL, 1.76, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'gendl I 1291, 1292', '16110', 'Fs 48: Pinot Noir', NULL, 0.2457, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'gendl II 2693', '16110', 'Fs 49: Chardonnay', NULL, 0.6744, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'gendl II 2688, 2654', '16110', 'Fs 49: Pinot Noir', NULL, 0.5277, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'hausberg I 1296/1', '16110', 'Fs 50: Pinot Noir', NULL, 0.411, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, 'hausberg II 1300', '16110', 'Fs 51: Gelber Muskateller', NULL, 0.1905, true);

-- tieftal peter (fs 46) — 0.14 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'tieftal peter', 'fs 46', 0.14, 'Neuburger', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '2438/1', '4023', 'Neuburger', NULL, 0.14, true);

-- unterer badener weg (fs 67) — 0.1746 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'unterer badener weg', 'fs 67', 0.1746, 'Welschriesling', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '861', '16110', 'Welschriesling', 2013, 0.0089, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '862/1', '16110', 'Welschriesling', 2013, 0.1657, true);

-- katzbühel () — 0.2537 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'katzbühel', NULL, 0.2537, 'Grünbrache', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '534', '4033', 'Grünbrache', NULL, 0.0003, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '537/1', '4033', 'Grünbrache', NULL, 0.1243, false);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '537/5', '4033', 'Grünbrache', NULL, 0.1291, false);

-- in peter widderkreuz () — 0.3325 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'in peter widderkreuz', NULL, 0.3325, 'Rotgipfler', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '552/1', '4033', 'Rotgipfler', 1978, 0.0201, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '552/2', '4033', 'Rotgipfler', 1978, 0.17, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '600/1', '4033', 'Rotgipfler', 1979, 0.0003, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '552/1', '4033', 'Grauburgunder', 1991, 0.0052, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '552/2', '4033', 'Grauburgunder', 1991, 0.1361, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '600/1', '4033', 'Grauburgunder', 1991, 0.0008, true);

-- untere hausbergen (fs 1) — 0.4389 ha
INSERT INTO weingarten (tenant_id, name, fs_nr, flaeche_ha, rebsorte, weinbaugebiet, aktiv)
VALUES (v_tenant_id, 'untere hausbergen', 'fs 1', 0.4389, 'Riesling', 'Thermenregion', true)
RETURNING id INTO v_wg_id;
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1259', '16110', 'Riesling', NULL, 0.2035, true);
INSERT INTO grundstuecke (tenant_id, weingarten_id, gst_nr, katastralgemeinde, rebsorte, pflanzjahr, flaeche_ha, spritzbar)
VALUES (v_tenant_id, v_wg_id, '1260', '16110', 'Frühroter Veltliner', NULL, 0.2354, true);


-- ─── PFLANZENSCHUTZMITTEL (Bio-Betrieb) ─────────────────────────────────────

INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Netzschwefel', NULL, 'Schwefel', 0, 'fungizid', true, 0, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Myco-Sin Vin', 'Myco-Sin Vin', 'Tonerdesilikate / Schachtelhalm', 0, 'fungizid', true, 0, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Prev B2', 'Prev B2', 'Bacillus subtilis', 0, 'fungizid', true, 0, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Wecit', 'Wecit', 'Gesteinsmehle / Zitronensäure', 0, 'fungizid', true, 0, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Cuprozin Progress', 'Cuprozin progress', 'Kupferhydroxid', 18.9, 'fungizid', true, 3, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Cuproxat flüssig', 'Cuproxat', 'Kupfersulfat-Tribasisch', 19.0, 'fungizid', true, 3, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Kaliwasserglas', NULL, 'Kaliumsilikat', 0, 'fungizid', true, 0, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Vitisan', 'Vitisan', 'Kaliumhydrogencarbonat', 0, 'fungizid', true, 0, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Myco-Sin', 'Myco-Sin', 'Ackerschachtelhalmextrakt', 0, 'fungizid', true, 0, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Hornmist (BD 500)', 'Hornmist', 'Hornmist-Präparat', 0, 'naehrstoff', true, 0, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Hornkiesel (BD 501)', 'Hornkiesel', 'Hornkiesel-Präparat', 0, 'naehrstoff', true, 0, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Funguran OH', 'Funguran', 'Kupferhydroxid', 50.0, 'fungizid', true, 3, true);
INSERT INTO pflanzenschutzmittel
  (tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, kategorie, oeko_zugelassen, wartezeit_tage, aktiv)
VALUES (v_tenant_id, 'Zitronensäure', NULL, 'Zitronensäure', 0, 'sonstiges', true, 0, true);

RAISE NOTICE 'Seed abgeschlossen: Weingut Johannes Gebeshuber';
END $$;