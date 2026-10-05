-- KAN-89 (05.10.2026): Rebsorten-Stammtabelle an die BKI-Kürzelliste (Stand 01.10.2024, src/lib/wein/bki_kuerzel.ts).
--  1. Neue Spalte kuerzel_amtlich (true = Kürzel steht in der BKI-Liste). Nicht amtliche Sorten behalten keinen
--     Fantasie-Code (kuerzel NULL), Dubletten bzw. erfundene Sorten werden deaktiviert (keine davon ist referenziert).
--  2. Kürzel und Farben laut Liste: GB→GR (Grauburgunder, weiß), PB→BB, MB→ME, SY→SH, RO→RL, GS→GW, VE→RV „Roter Veltliner“
--     (weiß), Schilcher→„Blauer Wildbacher“ BW (Schilcher als Synonym), Traminer weiß.
--  3. Farben nur weiss/rot (CHECK); UNIQUE(kuerzel) bestand schon.
-- Die Liste unten (Abschnitt 2) prüft DB-Test 41 gegen die Tabelle und der Unit-Test kan89 gegen REBSORTE_KUERZEL.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Kennzeichen (kuerzel darf NULL sein – nur bei nicht amtlichen Sorten, CHECK unten)
ALTER TABLE public.rebsorten ALTER COLUMN kuerzel DROP NOT NULL;
ALTER TABLE public.rebsorten ADD COLUMN kuerzel_amtlich boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.rebsorten.kuerzel_amtlich IS
  'KAN-89: true = Kürzel aus der BKI-Kürzelliste (Stand 01.10.2024); false = Sorte ohne amtliches Kürzel (kuerzel NULL)';

-- Nicht amtlich bzw. Dubletten (zuerst, damit die Kürzel BW und CH frei bzw. eindeutig sind)
UPDATE public.rebsorten SET kuerzel = NULL, kuerzel_amtlich = false, aktiv = false
 WHERE kuerzel = 'BW' AND name_de = 'Blauweißer Muskateller';   -- keine amtliche Sorte (BW = Blauer Wildbacher)
UPDATE public.rebsorten SET kuerzel = NULL, kuerzel_amtlich = false, aktiv = false
 WHERE kuerzel = 'MO' AND name_de = 'Morillon';                  -- Synonym von Chardonnay (CH); MO = Muskat Ottonel
UPDATE public.rebsorten SET kuerzel = NULL, kuerzel_amtlich = false
 WHERE kuerzel IN ('MA', 'PR') AND name_de IN ('Marselan', 'Primitivo');   -- ohne Kürzel in der BKI-Liste

-- 2. Amtliche Kürzel und Farben
UPDATE public.rebsorten r SET kuerzel = v.kuerzel, name_de = v.name_de, name_synonym = v.synonym, farbe = v.farbe
  FROM (VALUES
    ('GB', 'GR', 'Grauburgunder',     'Pinot Gris, Ruländer, Grauer Burgunder', 'weiss'),
    ('TR', 'TR', 'Traminer',          'Gewürztraminer, Roter Traminer',         'weiss'),
    ('PB', 'BB', 'Blauburgunder',     'Pinot Noir, Blauer Burgunder',           'rot'),
    ('MB', 'ME', 'Merlot',            NULL,                                      'rot'),
    ('SY', 'SH', 'Syrah',             'Shiraz',                                  'rot'),
    ('SF', 'BW', 'Blauer Wildbacher', 'Schilcher',                               'rot'),
    ('RO', 'RL', 'Roesler',           NULL,                                      'rot'),
    ('VE', 'RV', 'Roter Veltliner',   'Veltliner rot',                           'weiss'),
    ('GS', 'GW', 'Gemischter Satz',   'Wiener Gemischter Satz',                  'weiss')
  ) AS v (alt, kuerzel, name_de, synonym, farbe)
 WHERE r.kuerzel = v.alt;

-- 3. Nur weiß und rot
ALTER TABLE public.rebsorten DROP CONSTRAINT rebsorten_farbe_check;
ALTER TABLE public.rebsorten ADD CONSTRAINT rebsorten_farbe_check CHECK (farbe IN ('weiss', 'rot'));
ALTER TABLE public.rebsorten ADD CONSTRAINT rebsorten_kuerzel_amtlich_chk
  CHECK ((kuerzel_amtlich AND kuerzel IS NOT NULL) OR (NOT kuerzel_amtlich AND kuerzel IS NULL));
