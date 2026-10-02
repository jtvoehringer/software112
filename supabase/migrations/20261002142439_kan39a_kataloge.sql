-- KAN-39 Etappe 1 (02.10.2026): Kataloge der BKI-Schnittstelle und Meldefarbe
-- Entscheidungen Jörgen 02.10.2026: vorläufige eigene Kürzel für Erzeugnis, Buchungsart und Farbe (BKI kennt keine – KAN-38
-- Frage 19/20 offen); nach der BKI-Antwort werden nur die Kürzel umbenannt, die Struktur bleibt. Etappe 1 = Kataloge + Farbe;
-- Spalten erzeugnis/zusatzbezeichnung/land_iso an Charge/Füllung/Zukauf folgen in Etappe 2, die Länderbereinigung in Etappe 3.
-- Grundlage: Confluence „BKI-Schnittstelle – Feldzuordnung 2: Kataloge“ (SchnittstelleDatenMitDefinitionTypen (003).xlsx),
-- BKI-Kürzelliste für Weinformulare (Stand 01.10.2024), BKI-Sitzung 24.09.2026 (R8a, R9, R12, R15, R17, R8b/R10).
--
--  1. kat_qualitaetsstufe – BKI-Kürzel (17 inkl. SOE und dem vorläufigen AUB), Rang der Qualitätsachse (wie qualitaetsrang.ts:
--     INW < WEI < RSW < LDW < QUW = DAC < KAB < SPL < ALW < BAL = EIW = STW < AUB < TBA) und BSM-Spalte (R9; Kabinett und
--     Industriewein vorläufig, KAN-38 Frage 12).
--  2. kat_erzeugnis – 15 Erzeugnisse der Schnittstelle + PetNat (R8b) + Traubensaft (bsm_relevant = false, R10).
--  3. kat_buchungsart – 17 BSM-Buchungsarten (bsm = true) + interne BSM-neutrale Vorgänge (bsm_code = Zuordnung, NULL = neutral).
--  4. kat_farbe (W/R, R17: Rosé zählt zu rot) und kat_land (ISO 3166-1 alpha-2, 249 Länder, eu-Kennzeichen).
--  5. katalog_mapping – interner Wert → Katalogcode (Qualitätsstufe, Erzeugnis aus Sekt/Perlwein, Farbe aus weinart/rebsorten.farbe).
--  6. fuellungen.weinart – Farbe der Füllung, beim Anlegen/Ändern aus der Charge übernommen (Füllungen ohne Charge: manuell).
--  Alle Kataloge sind global: lesbar für angemeldete Benutzer, geschrieben nur per Migration.

-- 1.–5. Kataloge ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.kat_qualitaetsstufe (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  bezeichnung text NOT NULL,
  rang        smallint,
  bsm_spalte  text CHECK (bsm_spalte IN ('wein', 'rebsortenwein', 'landwein', 'qualitaetswein', 'praedikatswein', 'perl_schaumwein', 'sonstige')),
  vorlaeufig  boolean NOT NULL DEFAULT false,
  reihenfolge smallint NOT NULL
);
CREATE TABLE public.kat_erzeugnis (
  code         text PRIMARY KEY CHECK (code ~ '^[A-Z_]{2,8}$'),
  bezeichnung  text NOT NULL,
  bsm_relevant boolean NOT NULL,
  vorlaeufig   boolean NOT NULL DEFAULT true,
  reihenfolge  smallint NOT NULL
);
CREATE TABLE public.kat_buchungsart (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z_]{2,8}$'),
  bezeichnung text NOT NULL,
  richtung    text NOT NULL CHECK (richtung IN ('zu', 'ab', 'neutral')),
  einheit     text NOT NULL CHECK (einheit IN ('l', 'kg', 'stk')),
  bsm         boolean NOT NULL,
  bsm_code    text REFERENCES public.kat_buchungsart(code),
  vorlaeufig  boolean NOT NULL DEFAULT true,
  reihenfolge smallint NOT NULL,
  CONSTRAINT kat_buchungsart_bsm_chk CHECK (NOT (bsm AND bsm_code IS NOT NULL))
);
CREATE TABLE public.kat_farbe (
  code        text PRIMARY KEY CHECK (code IN ('W', 'R')),
  bezeichnung text NOT NULL,
  vorlaeufig  boolean NOT NULL DEFAULT true
);
CREATE TABLE public.kat_land (
  iso2    text PRIMARY KEY CHECK (iso2 ~ '^[A-Z]{2}$'),
  name_de text NOT NULL,
  eu      boolean NOT NULL DEFAULT false
);
CREATE TABLE public.katalog_mapping (
  katalog text NOT NULL CHECK (katalog IN ('qualitaetsstufe', 'erzeugnis', 'farbe')),
  intern  text NOT NULL,
  code    text NOT NULL,
  PRIMARY KEY (katalog, intern)
);
COMMENT ON TABLE public.kat_qualitaetsstufe IS 'KAN-39: BKI-Qualitätsstufen (Kürzelliste 01.10.2024) mit Rang und BSM-Spalte';
COMMENT ON TABLE public.kat_erzeugnis IS 'KAN-39: Erzeugnisse der BKI-Schnittstelle (Kürzel vorläufig, KAN-38 Frage 19)';
COMMENT ON TABLE public.kat_buchungsart IS 'KAN-39: 17 BSM-Buchungsarten + interne Vorgänge (bsm_code: Zuordnung, NULL = BSM-neutral; Kürzel vorläufig)';
COMMENT ON TABLE public.kat_farbe IS 'KAN-39: Meldefarbe weiß/rot (R17: Rosé zählt zu rot; Kürzel vorläufig, KAN-38 Frage 20)';
COMMENT ON TABLE public.kat_land IS 'KAN-39: Länder nach ISO 3166-1 alpha-2 mit EU-Kennzeichen';
COMMENT ON TABLE public.katalog_mapping IS 'KAN-39: interner Wert → Katalogcode';

INSERT INTO public.kat_qualitaetsstufe (code, bezeichnung, rang, bsm_spalte, vorlaeufig, reihenfolge) VALUES
  ('INW', 'Industriewein', 0, NULL, true, 1),
  ('WEI', 'Wein (ohne Rebsorte und Jahrgang)', 1, 'wein', false, 2),
  ('RSW', 'Rebsortenwein (Wein mit Rebsorte bzw. Jahrgang)', 2, 'rebsortenwein', false, 3),
  ('LDW', 'Landwein', 3, 'landwein', false, 4),
  ('QUW', 'Qualitätswein', 4, 'qualitaetswein', false, 5),
  ('DAC', 'Districtus Austriae Controllatus (DAC)', 4, 'qualitaetswein', false, 6),
  ('KAB', 'Kabinett', 5, 'qualitaetswein', true, 7),
  ('SPL', 'Spätlese', 6, 'praedikatswein', false, 8),
  ('ALW', 'Auslese', 7, 'praedikatswein', false, 9),
  ('BAL', 'Beerenauslese', 8, 'praedikatswein', false, 10),
  ('EIW', 'Eiswein', 8, 'praedikatswein', false, 11),
  ('STW', 'Strohwein / Schilfwein', 8, 'praedikatswein', false, 12),
  ('AUB', 'Ausbruch', 9, 'praedikatswein', true, 13),
  ('TBA', 'Trockenbeerenauslese', 10, 'praedikatswein', false, 14),
  ('TGT', 'Teilweise gegorener Traubenmost', NULL, 'wein', true, 15),
  ('STU', 'Sturm', NULL, 'wein', false, 16),
  ('SOE', 'Sonstige Erzeugnisse', NULL, 'sonstige', false, 17);
INSERT INTO public.kat_erzeugnis (code, bezeichnung, bsm_relevant, reihenfolge) VALUES
  ('MOST', 'Most', true, 1),
  ('STURM', 'Sturm', true, 2),
  ('WEIN', 'Wein ohne Herkunft, ohne Rebsorte', true, 3),
  ('WEINSORT', 'Wein ohne Herkunft, mit Rebsorte bzw. Jahrgang', true, 4),
  ('WEINGGA', 'Wein mit geschützter geografischer Angabe (g.g.A.)', true, 5),
  ('WEINGU', 'Wein mit geschützter Ursprungsbezeichnung (g.U.)', true, 6),
  ('PERLWEIN', 'Perlwein', true, 7),
  ('SCHAUMW', 'Schaumwein', true, 8),
  ('SEKTGU', 'Sekt mit g.U.', true, 9),
  ('EUWEIN', 'EU-Wein', true, 10),
  ('DRITTLD', 'Wein aus Drittland', true, 11),
  ('LIKOERW', 'Likörwein', true, 12),
  ('AROMAW', 'Aromatisierter Wein', true, 13),
  ('WEINHALT', 'Weinhaltiges Getränk (z. B. Spritzer)', true, 14),
  ('ENTALK', 'Entalkoholisierter bzw. teilweise entalkoholisierter Wein', true, 15),
  ('PETNAT', 'PetNat (Pétillant Naturel)', true, 16),
  ('TRAUBSFT', 'Traubensaft (kein Wein-Erzeugnis, nicht bestandsmeldepflichtig)', false, 17);
INSERT INTO public.kat_buchungsart (code, bezeichnung, richtung, einheit, bsm, bsm_code, reihenfolge) VALUES
  ('ERNTE', 'eigene Ernte', 'zu', 'l', true, NULL, 1),
  ('ZK_FASS', 'Zukauf Fasswein ≥ 60 l', 'zu', 'l', true, NULL, 2),
  ('ZK_TRAUB', 'Zukauf Trauben', 'zu', 'kg', true, NULL, 3),
  ('ZK_MAISC', 'Zukauf Maische', 'zu', 'kg', true, NULL, 4),
  ('ZK_MOST', 'Zukauf Most', 'zu', 'l', true, NULL, 5),
  ('ZK_FLA', 'Zukauf Flaschen < 60 l', 'zu', 'l', true, NULL, 6),
  ('ZU_ABW', 'Zugang Abwertung', 'zu', 'l', true, NULL, 7),
  ('ZU_BEH', 'Zugang durch Behandlung', 'zu', 'l', true, NULL, 8),
  ('AB_ABW', 'Abgang Abwertung', 'ab', 'l', true, NULL, 9),
  ('VK_FA_AT', 'Fassverkauf in Österreich', 'ab', 'l', true, NULL, 10),
  ('VK_FA_AU', 'Fassverkauf ins Ausland', 'ab', 'l', true, NULL, 11),
  ('VK_FL_AT', 'Flaschenverkauf in Österreich', 'ab', 'l', true, NULL, 12),
  ('VK_FL_AU', 'Flaschenverkauf ins Ausland', 'ab', 'l', true, NULL, 13),
  ('AB_VERAR', 'Abgang durch Verarbeitung', 'ab', 'l', true, NULL, 14),
  ('SCHWUND', 'Eigenverbrauch / Schwund', 'ab', 'l', true, NULL, 15),
  ('VS_ZU', 'Verschnitt Zugang', 'zu', 'l', true, NULL, 16),
  ('VS_AB', 'Verschnitt Abgang', 'ab', 'l', true, NULL, 17),
  ('EROEFF', 'Eröffnungsbestand', 'zu', 'l', false, NULL, 18),
  ('UMZUG', 'Umzug', 'neutral', 'l', false, NULL, 19),
  ('FILTRAT', 'Filtration', 'neutral', 'l', false, NULL, 20),
  ('FUELLUNG', 'Füllung (offen → Flasche)', 'neutral', 'l', false, NULL, 21),
  ('STORNO', 'Storno (Gegenbuchung zur ursprünglichen Buchungsart)', 'neutral', 'l', false, NULL, 22),
  ('INV_PLUS', 'Inventurdifferenz Mehrmenge', 'zu', 'l', false, NULL, 23),
  ('INV_MIN', 'Inventurdifferenz Mindermenge', 'ab', 'l', false, 'SCHWUND', 24),
  ('TRAUBVK', 'Traubenverkauf', 'ab', 'kg', false, NULL, 25);
INSERT INTO public.kat_farbe (code, bezeichnung) VALUES
  ('W', 'weiß'),
  ('R', 'rot');
INSERT INTO public.kat_land (iso2, name_de, eu) VALUES
  ('AD', 'Andorra', false),
  ('AE', 'Vereinigte Arabische Emirate', false),
  ('AF', 'Afghanistan', false),
  ('AG', 'Antigua und Barbuda', false),
  ('AI', 'Anguilla', false),
  ('AL', 'Albanien', false),
  ('AM', 'Armenien', false),
  ('AO', 'Angola', false),
  ('AQ', 'Antarktis', false),
  ('AR', 'Argentinien', false),
  ('AS', 'Amerikanisch-Samoa', false),
  ('AT', 'Österreich', true),
  ('AU', 'Australien', false),
  ('AW', 'Aruba', false),
  ('AX', 'Ålandinseln', false),
  ('AZ', 'Aserbaidschan', false),
  ('BA', 'Bosnien und Herzegowina', false),
  ('BB', 'Barbados', false),
  ('BD', 'Bangladesch', false),
  ('BE', 'Belgien', true),
  ('BF', 'Burkina Faso', false),
  ('BG', 'Bulgarien', true),
  ('BH', 'Bahrain', false),
  ('BI', 'Burundi', false),
  ('BJ', 'Benin', false),
  ('BL', 'St. Barthélemy', false),
  ('BM', 'Bermuda', false),
  ('BN', 'Brunei Darussalam', false),
  ('BO', 'Bolivien', false),
  ('BQ', 'Karibische Niederlande', false),
  ('BR', 'Brasilien', false),
  ('BS', 'Bahamas', false),
  ('BT', 'Bhutan', false),
  ('BV', 'Bouvetinsel', false),
  ('BW', 'Botsuana', false),
  ('BY', 'Belarus', false),
  ('BZ', 'Belize', false),
  ('CA', 'Kanada', false),
  ('CC', 'Kokosinseln', false),
  ('CD', 'Kongo-Kinshasa', false),
  ('CF', 'Zentralafrikanische Republik', false),
  ('CG', 'Kongo-Brazzaville', false),
  ('CH', 'Schweiz', false),
  ('CI', 'Côte d’Ivoire', false),
  ('CK', 'Cookinseln', false),
  ('CL', 'Chile', false),
  ('CM', 'Kamerun', false),
  ('CN', 'China', false),
  ('CO', 'Kolumbien', false),
  ('CR', 'Costa Rica', false),
  ('CU', 'Kuba', false),
  ('CV', 'Cabo Verde', false),
  ('CW', 'Curaçao', false),
  ('CX', 'Weihnachtsinsel', false),
  ('CY', 'Zypern', true),
  ('CZ', 'Tschechien', true),
  ('DE', 'Deutschland', true),
  ('DJ', 'Dschibuti', false),
  ('DK', 'Dänemark', true),
  ('DM', 'Dominica', false),
  ('DO', 'Dominikanische Republik', false),
  ('DZ', 'Algerien', false),
  ('EC', 'Ecuador', false),
  ('EE', 'Estland', true),
  ('EG', 'Ägypten', false),
  ('EH', 'Westsahara', false),
  ('ER', 'Eritrea', false),
  ('ES', 'Spanien', true),
  ('ET', 'Äthiopien', false),
  ('FI', 'Finnland', true),
  ('FJ', 'Fidschi', false),
  ('FK', 'Falklandinseln', false),
  ('FM', 'Mikronesien', false),
  ('FO', 'Färöer', false),
  ('FR', 'Frankreich', true),
  ('GA', 'Gabun', false),
  ('GB', 'Vereinigtes Königreich', false),
  ('GD', 'Grenada', false),
  ('GE', 'Georgien', false),
  ('GF', 'Französisch-Guayana', false),
  ('GG', 'Guernsey', false),
  ('GH', 'Ghana', false),
  ('GI', 'Gibraltar', false),
  ('GL', 'Grönland', false),
  ('GM', 'Gambia', false),
  ('GN', 'Guinea', false),
  ('GP', 'Guadeloupe', false),
  ('GQ', 'Äquatorialguinea', false),
  ('GR', 'Griechenland', true),
  ('GS', 'Südgeorgien und die Südlichen Sandwichinseln', false),
  ('GT', 'Guatemala', false),
  ('GU', 'Guam', false),
  ('GW', 'Guinea-Bissau', false),
  ('GY', 'Guyana', false),
  ('HK', 'Sonderverwaltungsregion Hongkong', false),
  ('HM', 'Heard und McDonaldinseln', false),
  ('HN', 'Honduras', false),
  ('HR', 'Kroatien', true),
  ('HT', 'Haiti', false),
  ('HU', 'Ungarn', true),
  ('ID', 'Indonesien', false),
  ('IE', 'Irland', true),
  ('IL', 'Israel', false),
  ('IM', 'Isle of Man', false),
  ('IN', 'Indien', false),
  ('IO', 'Britisches Territorium im Indischen Ozean', false),
  ('IQ', 'Irak', false),
  ('IR', 'Iran', false),
  ('IS', 'Island', false),
  ('IT', 'Italien', true),
  ('JE', 'Jersey', false),
  ('JM', 'Jamaika', false),
  ('JO', 'Jordanien', false),
  ('JP', 'Japan', false),
  ('KE', 'Kenia', false),
  ('KG', 'Kirgisistan', false),
  ('KH', 'Kambodscha', false),
  ('KI', 'Kiribati', false),
  ('KM', 'Komoren', false),
  ('KN', 'St. Kitts und Nevis', false),
  ('KP', 'Nordkorea', false),
  ('KR', 'Südkorea', false),
  ('KW', 'Kuwait', false),
  ('KY', 'Kaimaninseln', false),
  ('KZ', 'Kasachstan', false),
  ('LA', 'Laos', false),
  ('LB', 'Libanon', false),
  ('LC', 'St. Lucia', false),
  ('LI', 'Liechtenstein', false),
  ('LK', 'Sri Lanka', false),
  ('LR', 'Liberia', false),
  ('LS', 'Lesotho', false),
  ('LT', 'Litauen', true),
  ('LU', 'Luxemburg', true),
  ('LV', 'Lettland', true),
  ('LY', 'Libyen', false),
  ('MA', 'Marokko', false),
  ('MC', 'Monaco', false),
  ('MD', 'Republik Moldau', false),
  ('ME', 'Montenegro', false),
  ('MF', 'St. Martin', false),
  ('MG', 'Madagaskar', false),
  ('MH', 'Marshallinseln', false),
  ('MK', 'Nordmazedonien', false),
  ('ML', 'Mali', false),
  ('MM', 'Myanmar', false),
  ('MN', 'Mongolei', false),
  ('MO', 'Sonderverwaltungsregion Macau', false),
  ('MP', 'Nördliche Marianen', false),
  ('MQ', 'Martinique', false),
  ('MR', 'Mauretanien', false),
  ('MS', 'Montserrat', false),
  ('MT', 'Malta', true),
  ('MU', 'Mauritius', false),
  ('MV', 'Malediven', false),
  ('MW', 'Malawi', false),
  ('MX', 'Mexiko', false),
  ('MY', 'Malaysia', false),
  ('MZ', 'Mosambik', false),
  ('NA', 'Namibia', false),
  ('NC', 'Neukaledonien', false),
  ('NE', 'Niger', false),
  ('NF', 'Norfolkinsel', false),
  ('NG', 'Nigeria', false),
  ('NI', 'Nicaragua', false),
  ('NL', 'Niederlande', true),
  ('NO', 'Norwegen', false),
  ('NP', 'Nepal', false),
  ('NR', 'Nauru', false),
  ('NU', 'Niue', false),
  ('NZ', 'Neuseeland', false),
  ('OM', 'Oman', false),
  ('PA', 'Panama', false),
  ('PE', 'Peru', false),
  ('PF', 'Französisch-Polynesien', false),
  ('PG', 'Papua-Neuguinea', false),
  ('PH', 'Philippinen', false),
  ('PK', 'Pakistan', false),
  ('PL', 'Polen', true),
  ('PM', 'St. Pierre und Miquelon', false),
  ('PN', 'Pitcairninseln', false),
  ('PR', 'Puerto Rico', false),
  ('PS', 'Palästinensische Autonomiegebiete', false),
  ('PT', 'Portugal', true),
  ('PW', 'Palau', false),
  ('PY', 'Paraguay', false),
  ('QA', 'Katar', false),
  ('RE', 'Réunion', false),
  ('RO', 'Rumänien', true),
  ('RS', 'Serbien', false),
  ('RU', 'Russland', false),
  ('RW', 'Ruanda', false),
  ('SA', 'Saudi-Arabien', false),
  ('SB', 'Salomonen', false),
  ('SC', 'Seychellen', false),
  ('SD', 'Sudan', false),
  ('SE', 'Schweden', true),
  ('SG', 'Singapur', false),
  ('SH', 'St. Helena', false),
  ('SI', 'Slowenien', true),
  ('SJ', 'Spitzbergen und Jan Mayen', false),
  ('SK', 'Slowakei', true),
  ('SL', 'Sierra Leone', false),
  ('SM', 'San Marino', false),
  ('SN', 'Senegal', false),
  ('SO', 'Somalia', false),
  ('SR', 'Suriname', false),
  ('SS', 'Südsudan', false),
  ('ST', 'São Tomé und Príncipe', false),
  ('SV', 'El Salvador', false),
  ('SX', 'Sint Maarten', false),
  ('SY', 'Syrien', false),
  ('SZ', 'Eswatini', false),
  ('TC', 'Turks- und Caicosinseln', false),
  ('TD', 'Tschad', false),
  ('TF', 'Französische Süd- und Antarktisgebiete', false),
  ('TG', 'Togo', false),
  ('TH', 'Thailand', false),
  ('TJ', 'Tadschikistan', false),
  ('TK', 'Tokelau', false),
  ('TL', 'Timor-Leste', false),
  ('TM', 'Turkmenistan', false),
  ('TN', 'Tunesien', false),
  ('TO', 'Tonga', false),
  ('TR', 'Türkei', false),
  ('TT', 'Trinidad und Tobago', false),
  ('TV', 'Tuvalu', false),
  ('TW', 'Taiwan', false),
  ('TZ', 'Tansania', false),
  ('UA', 'Ukraine', false),
  ('UG', 'Uganda', false),
  ('UM', 'Amerikanische Überseeinseln', false),
  ('US', 'Vereinigte Staaten', false),
  ('UY', 'Uruguay', false),
  ('UZ', 'Usbekistan', false),
  ('VA', 'Vatikanstadt', false),
  ('VC', 'St. Vincent und die Grenadinen', false),
  ('VE', 'Venezuela', false),
  ('VG', 'Britische Jungferninseln', false),
  ('VI', 'Amerikanische Jungferninseln', false),
  ('VN', 'Vietnam', false),
  ('VU', 'Vanuatu', false),
  ('WF', 'Wallis und Futuna', false),
  ('WS', 'Samoa', false),
  ('YE', 'Jemen', false),
  ('YT', 'Mayotte', false),
  ('ZA', 'Südafrika', false),
  ('ZM', 'Sambia', false),
  ('ZW', 'Simbabwe', false);
INSERT INTO public.katalog_mapping (katalog, intern, code) VALUES
  ('qualitaetsstufe', 'wein', 'WEI'),
  ('qualitaetsstufe', 'landwein', 'LDW'),
  ('qualitaetsstufe', 'qualitaetswein', 'QUW'),
  ('qualitaetsstufe', 'dac', 'DAC'),
  ('qualitaetsstufe', 'kabinett', 'KAB'),
  ('qualitaetsstufe', 'spaetlese', 'SPL'),
  ('qualitaetsstufe', 'auslese', 'ALW'),
  ('qualitaetsstufe', 'beerenauslese', 'BAL'),
  ('qualitaetsstufe', 'eiswein', 'EIW'),
  ('qualitaetsstufe', 'strohwein', 'STW'),
  ('qualitaetsstufe', 'ausbruch', 'AUB'),
  ('qualitaetsstufe', 'trockenbeerenauslese', 'TBA'),
  ('qualitaetsstufe', 'tba', 'TBA'),
  ('qualitaetsstufe', 'reserve', 'QUW'),
  ('qualitaetsstufe', 'erste_lage', 'QUW'),
  ('qualitaetsstufe', 'grosses_gewachs', 'QUW'),
  ('qualitaetsstufe', 'sekt', 'QUW'),
  ('qualitaetsstufe', 'sonstiges', 'SOE'),
  ('erzeugnis', 'sekt', 'SEKTGU'),
  ('erzeugnis', 'perlwein', 'PERLWEIN'),
  ('farbe', 'weiss', 'W'),
  ('farbe', 'rot', 'R'),
  ('farbe', 'rose', 'R'),
  ('farbe', 'grau', 'W');

-- Mapping-Codes müssen im jeweiligen Katalog stehen
DO $pruef$
DECLARE v_fehlt text;
BEGIN
  SELECT string_agg(m.katalog || ':' || m.intern || '→' || m.code, ', ') INTO v_fehlt FROM public.katalog_mapping m
   WHERE (m.katalog = 'qualitaetsstufe' AND NOT EXISTS (SELECT 1 FROM public.kat_qualitaetsstufe k WHERE k.code = m.code))
      OR (m.katalog = 'erzeugnis' AND NOT EXISTS (SELECT 1 FROM public.kat_erzeugnis k WHERE k.code = m.code))
      OR (m.katalog = 'farbe' AND NOT EXISTS (SELECT 1 FROM public.kat_farbe k WHERE k.code = m.code));
  IF v_fehlt IS NOT NULL THEN
    RAISE EXCEPTION 'katalog_mapping verweist auf unbekannte Codes: %', v_fehlt;
  END IF;
END $pruef$;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kat_qualitaetsstufe', 'kat_erzeugnis', 'kat_buchungsart', 'kat_farbe', 'kat_land', 'katalog_mapping'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM PUBLIC, authenticated', t);
    EXECUTE format('CREATE POLICY katalog_lesen ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY zwei_faktor_aal ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()))', t);
  END LOOP;
END $rls$;

-- 6. Farbe der Füllung ──────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuellungen
  ADD COLUMN weinart text NOT NULL DEFAULT 'unbekannt' CONSTRAINT fuellungen_weinart_check CHECK (weinart IN ('weiss', 'rot', 'rose', 'unbekannt'));

CREATE OR REPLACE FUNCTION public.s112_fuellung_weinart()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_art text;
BEGIN
  -- KAN-39: Farbe der Füllung = Weinart der Charge (sobald eine Charge zugeordnet ist); ohne Charge bleibt der erfasste Wert
  IF NEW.weinausbau_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.weinausbau_id IS DISTINCT FROM OLD.weinausbau_id OR NEW.weinart = 'unbekannt') THEN
    SELECT w.weinart INTO v_art FROM public.weinausbau w WHERE w.id = NEW.weinausbau_id AND w.tenant_id = NEW.tenant_id;
    IF v_art IS NOT NULL AND v_art <> 'unbekannt' THEN
      NEW.weinart := v_art;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fuellung_weinart() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_fuellung_weinart BEFORE INSERT OR UPDATE OF weinausbau_id, weinart ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fuellung_weinart();

-- Bestand nachtragen (nur die neue Spalte; Weinart der Charge)
UPDATE public.fuellungen f SET weinart = w.weinart
  FROM public.weinausbau w
 WHERE w.id = f.weinausbau_id AND w.tenant_id = f.tenant_id AND w.weinart <> 'unbekannt' AND f.weinart = 'unbekannt';
GRANT SELECT (weinart) ON public.fuellungen TO authenticated;