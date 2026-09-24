-- Migration 173: weingarten.ried mit lagen.name resynchronisieren
--
-- Rückmeldung 24.8.2026: Umbenennen einer Ried über das "Riedname"-Feld
-- (Formular /weingarten/[id]) aktualisierte bisher nur weingarten.name, nicht
-- das separate Textfeld weingarten.ried, nach dem die Rieden-Übersicht
-- gruppiert (WeingartenBaum.tsx) - die Übersicht zeigte nach dem Umbenennen
-- weiterhin den alten Namen. Der zugehörige Code-Fix (weingarten/actions.ts,
-- lagen/actions.ts) sorgt jetzt dafür, dass künftige Umbenennungen (egal ob
-- über das Ried-Formular oder über /lagen) "ried" korrekt mitziehen.
--
-- Diese Migration behebt den bereits entstandenen Bestandsschaden: für alle
-- Weingarten-Datensätze, die einer Lage zugeordnet sind (lage_id gesetzt),
-- aber deren "ried"-Text nicht mehr mit dem aktuellen lagen.name übereinstimmt
-- (z.B. weil zwischenzeitlich über das Formular umbenannt wurde, ohne dass
-- der alte Code "ried" mitgezogen hat), wird "ried" auf den aktuellen
-- lagen.name resynchronisiert.

UPDATE weingarten
SET ried = lagen.name
FROM lagen
WHERE weingarten.lage_id = lagen.id
  AND weingarten.ried IS DISTINCT FROM lagen.name;
