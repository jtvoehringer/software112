-- KAN-110 (Entwurf 04.10.2026, Entscheidung Jörgen 04.10.2026): amtliche Ried an der Lage.
--
-- Die 85-%-Regel nach § 21 Abs. 1 WeinG (Ried, Gemeinde) braucht die Identität der Ried je Herkunft. Lagennamen sind
-- teils Feldnamen („GLASLAUTERN I /GLAS“, „GLASLAUTERN II / GLAS“) – mehrere Lagen können dieselbe amtliche Ried
-- tragen. Vorbelegt mit dem Lagennamen, im Formular der Lage korrigierbar; leer = nicht gepflegt (die Regel prüft
-- die Ried dann nicht und weist darauf hin). Die Gemeinde kommt aus der KG-Nr. des Grundstücks (keine neue Spalte).
-- Kein session_replication_role, kein DISABLE TRIGGER (KAN-124).

ALTER TABLE public.lagen ADD COLUMN amtliche_ried text;
COMMENT ON COLUMN public.lagen.amtliche_ried IS
  'KAN-110: amtliche Riedbezeichnung (§ 21 WeinG) – mehrere Lagen können dieselbe Ried tragen; NULL = nicht gepflegt';

UPDATE public.lagen SET amtliche_ried = NULLIF(btrim(name), '') WHERE amtliche_ried IS NULL;