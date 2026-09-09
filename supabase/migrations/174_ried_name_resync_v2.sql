-- Zweiter, retroaktiver Ried-Name-Resync (Rückmeldung 24.8.2026).
--
-- Migration 173 hat den damaligen Drift zwischen weingarten.ried und dem
-- eigentlichen (aktuellen) Namen korrigiert. Rieden, die ZWISCHEN dem Lauf von
-- Migration 173 und dem Deploy der Umbenennen-Kaskade in actions.ts (Commit
-- 79411b7) umbenannt wurden, sind seither erneut auseinandergelaufen, weil in
-- diesem Zeitfenster noch der alte Code ohne Kaskade lief (betroffen u.a.
-- "spielbrett tettenhauer-haimtal" statt "spielbrett (tettenhauer)",
-- "aussätze modler II" statt "aussatzen / modler"). Ab jetzt (Code live)
-- sollten neue Umbenennungen automatisch kaskadieren - dieser Lauf holt nur
-- den bestehenden Rückstand nach.

-- 1) Weingarten MIT Lage-Verknüpfung: ried aus lagen.name nachziehen
UPDATE weingarten
SET ried = lagen.name
FROM lagen
WHERE weingarten.lage_id = lagen.id
  AND weingarten.ried IS DISTINCT FROM lagen.name;

-- 2) Weingarten OHNE Lage-Verknüpfung, aber MIT bestehender Ried-Zuordnung:
--    ried aus dem eigenen name-Feld nachziehen (updateWeingarten() schreibt in
--    diesem Fall direkt auf ried). Bewusst NUR wenn ried bereits gesetzt ist -
--    Weingärten ganz ohne Ried-Zuordnung (ried IS NULL, z.B. Sandbox-Mandanten
--    ohne Rieden-Nutzung) bleiben unangetastet, sonst bekäme jeder plötzlich
--    eine eigene Ried-Gruppe nach seinem Namen.
UPDATE weingarten
SET ried = name
WHERE lage_id IS NULL
  AND ried IS NOT NULL
  AND ried IS DISTINCT FROM name;
