-- KAN-187 (02.10.2026): Länder von Firmen und Kontakten nur noch aus dem Länderkatalog (kat_land, ISO 3166-1 alpha-2)
-- Voraussetzung: die drei Fehlwerte bei Gebeshuber („co.kg“, „gkok“, „UK“) hat Jörgen am 02.10.2026 korrigiert
-- (DE, TH, GB); Kontrolle 0 ungültige Werte. Leer (NULL) bleibt erlaubt. Die App normalisiert Eingabe und Import
-- (src/lib/katalog/laender.ts, normalisiereLand).
ALTER TABLE public.firmen
  ADD CONSTRAINT firmen_land_fkey FOREIGN KEY (land) REFERENCES public.kat_land(iso2);
ALTER TABLE public.kontakte
  ADD CONSTRAINT kontakte_land_fkey FOREIGN KEY (land) REFERENCES public.kat_land(iso2);