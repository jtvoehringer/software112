-- ════════════════════════════════════════════════════════════════════════════════════════════
-- KAN-124 · Verwaiste ernte_parzellen bereinigen (FK ernte_parzellen_jahrgang_id_fkey)
-- Löschen von Jörgen freigegeben (25.09.2026); eingespielt per apply_migration
-- (Name: kan124_ernte_parzellen_waisen_bereinigen).
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- BEFUND
--   10 Zeilen in ernte_parzellen verweisen auf den Jahrgang f0b1928f-a64a-4116-a01e-6da78ca90d41,
--   den es in weinjahrgaenge nicht mehr gibt – obwohl der FK ON DELETE CASCADE hat und validiert
--   ist. Ursache: ein Cleanup-Skript lief mit SET session_replication_role = 'replica' (schaltet
--   FK-Prüfungen, FK-Kaskaden und Protokoll-Trigger ab). Alle 10 Zeilen gehören zur Sandbox
--   (8 über weingarten_id, 2 ohne Weingarten/Grundstück; Lesedatum 8.7.–4.8.2026, Summe 3.855 kg).
--   Seit KAN-35 ist die replica-Zeile in den Cleanup-Skripten auskommentiert; ab KAN-124 lässt
--   scripts/check-replica.js den Build scheitern, wenn sie wieder aktiv wird.
--
-- WIRKUNG
--   · Löscht genau die verwaisten Zeilen dieses einen Jahrgangs (erwartet: 10). Weicht die Zahl ab
--     oder gibt es Waisen mit einem anderen Jahrgang, bricht der Block mit RAISE EXCEPTION ab und
--     es wird nichts geändert.
--   · Kein session_replication_role: der Trigger z_protokoll_loeschen schreibt jede gelöschte
--     Zeile vollständig nach bestandsprotokoll (aktion 'DELETE', alt = ganze Zeile als JSON).
--     tenant_id dort: Sandbox für die 8 Zeilen mit Weingarten, NULL für die 2 ohne Weingarten und
--     Grundstück (der Jahrgang ist weg und seine Löschung wurde damals nicht protokolliert).
--   · Auf ernte_parzellen verweist kein Fremdschlüssel – keine weiteren Kaskaden.
--   · Musterhof (Demo) hat 15 ernte_parzellen mit gültigem Jahrgang; die bleiben unberührt.
--
-- RÜCKWEG
--   Die Zeilen stehen in bestandsprotokoll.alt. Zurückholen geht nur zusammen mit einem Jahrgang
--   f0b1928f-… (FK); der gelöschte Jahrgang selbst ist nicht protokolliert und müsste neu angelegt
--   werden. Danach:
--     INSERT INTO public.ernte_parzellen
--     SELECT (jsonb_populate_record(NULL::public.ernte_parzellen, b.alt)).*
--       FROM public.bestandsprotokoll b
--      WHERE b.tabelle = 'ernte_parzellen' AND b.aktion = 'DELETE'
--        AND b.alt ->> 'jahrgang_id' = 'f0b1928f-a64a-4116-a01e-6da78ca90d41';
--
-- KONTROLLE DANACH
--   scripts/fk-waisen.sql → 0 Zeilen.
-- ════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_andere    integer;
  v_geloescht integer;
BEGIN
  -- Nur der bekannte Fall: tauchen Waisen mit einem anderen Jahrgang auf, erst neu bewerten
  SELECT count(*) INTO v_andere
    FROM public.ernte_parzellen ep
   WHERE ep.jahrgang_id <> 'f0b1928f-a64a-4116-a01e-6da78ca90d41'
     AND NOT EXISTS (SELECT 1 FROM public.weinjahrgaenge j WHERE j.id = ep.jahrgang_id);
  IF v_andere > 0 THEN
    RAISE EXCEPTION 'KAN-124: % weitere verwaiste ernte_parzellen mit anderem Jahrgang – abgebrochen, nichts geändert', v_andere;
  END IF;

  DELETE FROM public.ernte_parzellen ep
   WHERE ep.jahrgang_id = 'f0b1928f-a64a-4116-a01e-6da78ca90d41'
     AND NOT EXISTS (SELECT 1 FROM public.weinjahrgaenge j WHERE j.id = ep.jahrgang_id);
  GET DIAGNOSTICS v_geloescht = ROW_COUNT;

  IF v_geloescht <> 10 THEN
    RAISE EXCEPTION 'KAN-124: % verwaiste ernte_parzellen gefunden, erwartet 10 – abgebrochen, nichts geändert', v_geloescht;
  END IF;

  RAISE NOTICE 'KAN-124: % verwaiste ernte_parzellen gelöscht (protokolliert in bestandsprotokoll)', v_geloescht;
END $$;
