-- KAN-87 (05.10.2026): Pflanzenschutz-Aufzeichnung – Anwender, Startuhrzeit, Art der Verwendung, „erfasst am/von“ und
-- Erfassungsfrist (DVO (EU) 2023/564, betriebliche Vorgabe 24 h).
--  1. behandlungen += uhrzeit_von, uhrzeit_bis (Wiener Zeit), anwender_name (Fremdanwender, Freitext – sonst
--     durchgefuehrt_von = Mitglied), art_verwendung, erfasst_von (DEFAULT auth.uid()).
--  2. Trigger b_erfassung: beim Anlegen durch einen Benutzer created_at = now() und erfasst_von = auth.uid() (kein
--     Rückdatieren über die API); danach sind beide unveränderlich (42501, HINT erfassung). Der Anwender
--     (durchgefuehrt_von) muss Mitglied des Betriebs sein. Service-Role/SQL-Editor (auth.uid() leer) passieren
--     (Demo-Reset, Wartung).
--  3. tenant_einstellungen.psm_erfassungsfrist_h (Standard 24, 1–720), lesbar per Spaltenrecht; geschrieben nur per
--     Service-Role (Einstellungen › Dashboard-Regeln, saveBrandingOwn) – Paketfelder-Regel.
--  4. Demo-Reset: Pflanzenschutz-Maßnahmen mit Startzeit, Art der Verwendung, Anwender (erster Betriebsleiter) und
--     erfasst am Abend des (letzten) Anwendungstags – keine roten Ampeln im Musterhof.
-- Die Frist, die Ampel und den Hinweis „Nacherfassung (+n h)“ rechnet die App (lib/behandlungen/erfassungsfrist.ts).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Spalten
ALTER TABLE public.behandlungen
  ADD COLUMN uhrzeit_von time,
  ADD COLUMN uhrzeit_bis time,
  ADD COLUMN anwender_name text,
  ADD COLUMN art_verwendung text,
  ADD COLUMN erfasst_von uuid DEFAULT auth.uid(),
  ADD CONSTRAINT behandlungen_uhrzeit_chk
    CHECK (uhrzeit_von IS NULL OR uhrzeit_bis IS NULL OR coalesce(datum_bis > datum, false) OR uhrzeit_bis >= uhrzeit_von),
  ADD CONSTRAINT behandlungen_anwender_chk
    CHECK ((durchgefuehrt_von IS NULL OR anwender_name IS NULL) AND (anwender_name IS NULL OR length(btrim(anwender_name)) BETWEEN 1 AND 120)),
  ADD CONSTRAINT behandlungen_art_verwendung_chk
    CHECK (art_verwendung IN ('freiland', 'gewaechshaus', 'vorratsschutz', 'saatgut', 'sonstige'));
COMMENT ON COLUMN public.behandlungen.uhrzeit_von IS 'KAN-87: Startuhrzeit der Anwendung (Wiener Zeit) – Pflicht bei bienengefährlichen Mitteln';
COMMENT ON COLUMN public.behandlungen.uhrzeit_bis IS 'KAN-87: Ende der Anwendung (Wiener Zeit, am Tag datum_bis bzw. datum) – Beginn der Erfassungsfrist';
COMMENT ON COLUMN public.behandlungen.anwender_name IS 'KAN-87: Fremdanwender (Freitext) – sonst durchgefuehrt_von (Mitglied des Betriebs)';
COMMENT ON COLUMN public.behandlungen.art_verwendung IS 'KAN-87: Art der Verwendung (DVO (EU) 2023/564) – freiland, gewaechshaus, vorratsschutz, saatgut, sonstige';
COMMENT ON COLUMN public.behandlungen.erfasst_von IS 'KAN-87: erfassender Benutzer (Trigger b_erfassung, unveränderlich); erfasst am = created_at';

-- 2. Erfassung stempeln, danach unveränderlich; Anwender = Mitglied
CREATE OR REPLACE FUNCTION public.s112_behandlung_erfassung()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      NEW.created_at := now();
      NEW.erfasst_von := v_uid;
    END IF;
  ELSIF v_uid IS NOT NULL
    AND (NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.erfasst_von IS DISTINCT FROM OLD.erfasst_von) THEN
    RAISE EXCEPTION 'Erfasst am/von einer Maßnahme ist nicht änderbar.'
      USING ERRCODE = '42501', HINT = 'erfassung';
  END IF;
  IF v_uid IS NOT NULL AND NEW.durchgefuehrt_von IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.durchgefuehrt_von IS DISTINCT FROM OLD.durchgefuehrt_von)
    AND NOT EXISTS (SELECT 1 FROM public.tenant_memberships m
                     WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.durchgefuehrt_von) THEN
    RAISE EXCEPTION 'Der Anwender ist kein Mitglied dieses Betriebs – Fremdanwender bitte als Namen erfassen.'
      USING ERRCODE = '42501', HINT = 'anwender';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_behandlung_erfassung() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b_erfassung BEFORE INSERT OR UPDATE ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_behandlung_erfassung();

-- 3. Erfassungsfrist je Betrieb
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN psm_erfassungsfrist_h integer NOT NULL DEFAULT 24
    CONSTRAINT tenant_einstellungen_psm_erfassungsfrist_chk CHECK (psm_erfassungsfrist_h BETWEEN 1 AND 720);
COMMENT ON COLUMN public.tenant_einstellungen.psm_erfassungsfrist_h IS
  'KAN-87: Frist (Stunden ab Anwendungsende) für die Pflanzenschutz-Aufzeichnung – Ampel grün bis zur Frist, gelb bis 72 h, rot darüber';
GRANT SELECT (psm_erfassungsfrist_h) ON public.tenant_einstellungen TO authenticated, anon;

-- 4. Demo-Reset
DO $$
DECLARE
  c_alt1 constant text := 'reinkupfer_kg_ha, notizen, created_at, updated_at)';
  c_neu1 constant text := 'reinkupfer_kg_ha, notizen, uhrzeit_von, uhrzeit_bis, art_verwendung, durchgefuehrt_von, created_at, updated_at)';
  c_alt2 constant text := 'v_dt::timestamptz, v_dt::timestamptz';
  c_neu2 constant text := $a$case when r.psm is not null then time '06:30' end, case when r.psm is not null then time '09:00' end,
        case when r.psm is not null then 'freiland' end,
        (select m.user_id from tenant_memberships m where m.tenant_id = c_t and m.role = 'tenant_admin' order by m.user_id limit 1),
        (coalesce(case when r.mm2 is not null then make_date(v_jahr, r.mm2, r.dd2) end, v_dt) + time '19:30') at time zone 'Europe/Vienna',
        v_dt::timestamptz$a$;
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt1, ''))) / length(c_alt1) <> 1
     OR (length(v_def) - length(replace(v_def, c_alt2, ''))) / length(c_alt2) <> 1 THEN
    RAISE EXCEPTION 'KAN-87: Stelle im Demo-Reset nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(replace(v_def, c_alt1, c_neu1), c_alt2, c_neu2);
END $$;
