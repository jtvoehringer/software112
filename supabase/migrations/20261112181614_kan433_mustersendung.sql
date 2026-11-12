-- KAN-433 (12.11.2026): Weinexport Teil B – Kennzeichen „Mustersendung“ am Exportauftrag (Entscheidung Jörgen, Frage 4B).
-- Mit Haken tragen Packliste und Rechnung den Vermerk „Mustersendung – ohne Handelswert / Samples – no commercial value“.
-- Die Spalte steht nicht in der Freeze-Positivliste (KAN-429) – ab „Versendet“ ist sie gesperrt wie der Rest.
-- Die neuen Dokumentarten (Packliste, Health Certificate) brauchen keine Migration: dokument_art ist varchar(30) ohne Liste.

ALTER TABLE public.exportauftraege
  ADD COLUMN mustersendung boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.exportauftraege.mustersendung IS 'KAN-433: Mustersendung (z. B. für Messen) – Vermerk „ohne Handelswert“ auf Packliste und Rechnung';

-- s112_exportauftrag_aendern nimmt das Kennzeichen (genau eine Stelle, sonst Abbruch)
DO $kan433$
DECLARE
  v_def text;
  c_alt constant text := '    kunde_uid           = NULLIF(upper(regexp_replace(coalesce(p_kopf ->> ''kunde_uid'', ''''), ''\s'', '''', ''g'')), '''')
  WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;';
  c_neu constant text := '    kunde_uid           = NULLIF(upper(regexp_replace(coalesce(p_kopf ->> ''kunde_uid'', ''''), ''\s'', '''', ''g'')), ''''),
    -- KAN-433: Mustersendung (Vermerk auf Packliste und Rechnung)
    mustersendung       = coalesce(p_kopf ->> ''mustersendung'', '''') = ''true''
  WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_exportauftrag_aendern';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-433: s112_exportauftrag_aendern – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan433$;
