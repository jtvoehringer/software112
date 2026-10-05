-- Datenkorrektur (05.10.2026, Freigabe Jörgen): Kontakte aus der Dynamics-Migration (03.09.2026) ihrer Firma zuordnen.
-- Ursache: Der Datenimport lud zur Firmenzuordnung nur die ersten 1.000 Firmen (PostgREST-Grenze; Gebeshuber hat 4.652) –
-- 4.164 Kontakte blieben ohne Firma mit dem Vermerk „Firma lt. Import: … (nicht zugeordnet)“. Der Import ist korrigiert
-- (findFirmaId lädt seitenweise, Test import-firmenzuordnung).
-- Zugeordnet wird nur bei genau EINER Firma gleichen Namens (normalisiert wie der Import: trim, Kleinschreibung,
-- Mehrfach-Leerzeichen) – mehrdeutige (doppelte Firmen) und nicht vorhandene Firmen bleiben, wie sie sind.
-- Der Vermerk bleibt nachvollziehbar: „(nicht zugeordnet)“ → „(nachträglich zugeordnet am 05.10.2026)“.
-- Nur Betrieb „Weingut Johannes Gebeshuber“. Ein DO-Block = eine Transaktion; bei einer anderen Anzahl als erwartet
-- (Stand 05.10.2026: 4.133) bricht er ab und nichts ist geändert.

DO $$
DECLARE
  c_tenant   constant uuid := '097f67ed-381e-4bb3-952e-758aa9d3a501';
  c_erwartet constant integer := 4133;
  v_n        integer;
BEGIN
  PERFORM set_config('s112.aenderung_grund', 'Datenkorrektur: Firma aus Dynamics-Import nachträglich zugeordnet (Import lud nur 1.000 Firmen)', true);

  WITH firmen_norm AS MATERIALIZED (
    SELECT lower(regexp_replace(btrim(f.name), '\s+', ' ', 'g')) AS k, min(f.id::text)::uuid AS firma_id, count(*) AS n
      FROM public.firmen f
     WHERE f.tenant_id = c_tenant
     GROUP BY 1),
  kandidaten AS MATERIALIZED (
    SELECT k.id, lower(regexp_replace(btrim(substring(k.notizen FROM 'Firma lt\. Import: (.*?) \(nicht zugeordnet\)')), '\s+', ' ', 'g')) AS k
      FROM public.kontakte k
     WHERE k.tenant_id = c_tenant AND k.firma_id IS NULL AND k.notizen LIKE '%(nicht zugeordnet)%'),
  zuordnung AS (
    SELECT c.id, f.firma_id FROM kandidaten c JOIN firmen_norm f ON f.k = c.k AND f.n = 1)
  UPDATE public.kontakte k
     SET firma_id = z.firma_id,
         notizen = regexp_replace(k.notizen, '\(nicht zugeordnet\)', '(nachträglich zugeordnet am 05.10.2026)'),
         aktualisiert_am = now()
    FROM zuordnung z
   WHERE k.id = z.id AND k.tenant_id = c_tenant AND k.firma_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> c_erwartet THEN
    RAISE EXCEPTION 'Abbruch: % Kontakte würden zugeordnet, erwartet %. Nichts geändert.', v_n, c_erwartet;
  END IF;
  RAISE NOTICE '% Kontakte ihrer Firma zugeordnet.', v_n;
END $$;
