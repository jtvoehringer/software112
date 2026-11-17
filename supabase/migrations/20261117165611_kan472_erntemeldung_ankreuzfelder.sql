-- KAN-472 Teil 2 (BKI-Sitzung 16.11.2026): Ankreuzfelder der Weinerntemeldung
--
-- Das Formular „Erntemeldung“ hat die Ankreuzfelder „beabsichtige Süßung“ und „beabsichtige Entsäuerung“. Bisher
-- druckte software:112 sie leer (zum Ankreuzen von Hand). Die Erntemeldung rechnet je Jahrgang aus den Lesedaten
-- (nicht aus ama_erntemeldungen) – die beiden Angaben stehen deshalb am Jahrgang.
--
-- Sie gehören zur Meldung, nicht zu den Lesedaten: Auch bei abgeschlossenem Jahrgang bleiben sie änderbar, wie die
-- übrigen Angaben zur AMA-Meldung (ama_gemeldet, ama_meldedatum, ama_meldungsnr). Die Schutzfunktion
-- s112_jahrgang_abschluss_schutz() wird dafür um die zwei Spalten erweitert, sonst unverändert.
--
-- Keine neue Tabelle, kein Fremdschlüssel, keine neue Policy: Es gelten die Rechte von weinjahrgaenge
-- (Schreiben: Rieden oder Kellerbuch; RLS je Betrieb; Abo-Schreibsperre; Zwei-Faktor).

ALTER TABLE public.weinjahrgaenge
  ADD COLUMN ernte_suessung     boolean NOT NULL DEFAULT false,
  ADD COLUMN ernte_entsaeuerung boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.weinjahrgaenge.ernte_suessung     IS 'Weinerntemeldung: Ankreuzfeld „beabsichtige Süßung“ (KAN-472)';
COMMENT ON COLUMN public.weinjahrgaenge.ernte_entsaeuerung IS 'Weinerntemeldung: Ankreuzfeld „beabsichtige Entsäuerung“ (KAN-472)';

CREATE OR REPLACE FUNCTION public.s112_jahrgang_abschluss_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  c_frei  constant text[] := ARRAY['ama_gemeldet', 'ama_meldedatum', 'ama_meldungsnr', 'ernte_suessung', 'ernte_entsaeuerung', 'updated_at'];
BEGIN
  IF v_rolle NOT IN ('authenticated', 'anon') OR NOT OLD.abgeschlossen THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - c_frei) IS DISTINCT FROM (to_jsonb(OLD) - c_frei) THEN
    RAISE EXCEPTION 'Der Jahrgang % ist abgeschlossen und bleibt unverändert.', OLD.jahrgang
      USING ERRCODE = '42501', HINT = 'jahrgang_abgeschlossen';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.s112_jahrgang_abschluss_schutz() FROM PUBLIC, anon, authenticated;
