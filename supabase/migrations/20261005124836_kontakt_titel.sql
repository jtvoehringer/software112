-- Hotfix (05.10.2026): Titel für Kontakte – vorangestellter Titel (Auswahl der in Österreich gängigen Titel in der App,
-- lib/crm/titel.ts TITEL_OPTS) und frei eingebbarer nachgestellter Titel (BSc, MSc, MBA, PhD …). Beide optional.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

ALTER TABLE public.kontakte
  ADD COLUMN titel text CONSTRAINT kontakte_titel_laenge CHECK (titel IS NULL OR length(titel) BETWEEN 1 AND 30),
  ADD COLUMN titel_nachgestellt text CONSTRAINT kontakte_titel_nachgestellt_laenge CHECK (titel_nachgestellt IS NULL OR length(titel_nachgestellt) BETWEEN 1 AND 60);

COMMENT ON COLUMN public.kontakte.titel IS 'Vorangestellter Titel (Mag., Dr., Ing., DI, KR, ÖkR …) – Auswahl in der App';
COMMENT ON COLUMN public.kontakte.titel_nachgestellt IS 'Nachgestellter Titel, frei (BSc, MSc, MBA, PhD, LL.M. …)';
