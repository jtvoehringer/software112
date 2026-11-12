-- KAN-418 Teil 3 (12.11.2026): Auftragsbestätigung – Versandvermerk am Auftrag.
--
-- Die Auftragsbestätigung (PDF, Nummer = Auftragsnummer AB-JJJJ-NNNN) erzeugt die App; nach dem Mailversand wird am
-- Auftrag vermerkt, wann und an wen sie ging. Direkt änderbar bleiben am Auftrag nur Frist und Notiz (Trigger
-- a_auftrag_schutz) – der Vermerk läuft über die RPC.

ALTER TABLE public.auftraege
  ADD COLUMN ab_versendet_am timestamptz,
  ADD COLUMN ab_versendet_an text CONSTRAINT auftraege_ab_versendet_an_chk CHECK (ab_versendet_an IS NULL OR char_length(ab_versendet_an) <= 320);

CREATE FUNCTION public.s112_auftrag_ab_vermerken(p_tenant_id uuid, p_auftrag_id uuid, p_an text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a   record;
  v_an  text := btrim(coalesce(p_an, ''));
  v_am  timestamptz := now();
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF v_an = '' OR char_length(v_an) > 320 OR position('@' IN v_an) < 2 THEN
    RAISE EXCEPTION 'Bitte eine gültige Empfänger-Adresse angeben.' USING ERRCODE = '23514';
  END IF;
  SELECT id, nummer, storniert_am INTO v_a FROM public.auftraege WHERE id = p_auftrag_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auftrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Der Auftrag % ist storniert – eine Auftragsbestätigung gibt es dazu nicht.', v_a.nummer USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('s112.auftrag_frei', 'ja', true);
  UPDATE public.auftraege SET ab_versendet_am = v_am, ab_versendet_an = v_an, aktualisiert_am = now()
   WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.auftrag_frei', '', true);
  RETURN v_am;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_auftrag_ab_vermerken(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_auftrag_ab_vermerken(uuid, uuid, text) TO authenticated, service_role;
