-- KAN-40 Etappe E1 (Entwurf 02.10.2026, Entscheidung Jörgen 02.10.2026): Bewegungsjournal kellerbuch_buchungen per Trigger
--
-- Ziel: eine unveränderliche Zeile je Mengenwirkung (Liter offen bzw. Stück Flaschen) mit den Merkmalen zum Buchungszeitpunkt
-- (Erzeugnis, Qualitätsstufe, Zusatzbezeichnung, Farbe, Herkunft, Land, Rebsorte, Jahrgang) – Grundlage für BSM,
-- Weinbuch und Prüfungen ohne Rekonstruktion aus den Bewegungstabellen. Die Mengenlogik spiegelt
-- src/lib/behoerden/bewegungsbuch.ts (ladeBewegungenBetrieb) und bsm.ts (BSM_ZUORDNUNG).
--
--  1. tenant_einstellungen.journal_ab (date, NULL = Journal aus): Trigger schreiben nur, wenn gesetzt und das Buchungsdatum
--     ≥ journal_ab ist. Gesetzt wird es nur über journal_eroeffnen (EROEFF-Zeilen des Ist-Bestands, rekonstruiert = true).
--  2. Tabelle kellerbuch_buchungen: append-only. RLS: authenticated nur SELECT (eigene Betriebe) samt RESTRICTIVE
--     mitgliedschaft_aktiv, abo_schreibsperre_*, zwei_faktor_aal, ki_aktiver_betrieb. Schreiben ausschließlich über die
--     SECURITY-DEFINER-Trigger/RPCs (transaktionslokales Kennzeichen s112.journal_schreiben). Trigger a_journal_schutz
--     sperrt UPDATE/DELETE/TRUNCATE für jede Rolle; Ausnahmen wie s112_meldung_abgabe_schutz (KAN-37 B): DELETE als
--     Wartung im Demo-Betrieb Musterhof bzw. mit s112.loeschen_erlaubt = Betrieb (s112_mandant_loeschen, pilot-abraeumen.sql).
--     Charge, Füllung, Gebinde, Zukauf und Quelle sind bewusst OHNE Fremdschlüssel (historische Verweise wie im
--     bestandsprotokoll: eine Charge bleibt nach „Endgültig löschen“ im Journal sichtbar, samt Namen als Momentaufnahme);
--     geschrieben wird nur aus Zeilen desselben Betriebs, ein Fremdverweis ist nicht möglich. storno_von_id als Verbund-FK
--     (tenant_id, storno_von_id).
--  3. Beleg-Nummernkreis je Betrieb lückenlos (max + 1 unter pg_advisory_xact_lock je Betrieb); zusammengehörige Zeilen
--     (Umzug-Batch, Verschnitt, Verkauf, Umstufungspaar, Füllung offen/Flasche, Gegenbuchungen eines Vorgangs) teilen
--     eine Nummer.
--  4. Trigger (AFTER INSERT/UPDATE) auf keller_umzuege, pressung_behaelter, pressungen, zukauf_posten,
--     verschneidung_quellen, verschneidungen, fuellungen, fuellung_bewegungen, verkauf_positionen, verkaufsposten,
--     weinausbau. Jede Quellzeile hat einen „Stand“ (wirksam, Datum, Zeilen); ändert er sich, werden die aktiven
--     Journalzeilen der Quelle gegengebucht (gleiche Buchungsart, umgekehrtes Vorzeichen, storno_von_id, Merkmale
--     der Originalzeile) und – falls weiter wirksam – neu gebucht. Storno = Gegenbuchung am Storno-Tag.
--     Zukauf Trauben (kg) bucht beim Zukauf nichts: die Liter entstehen erst beim Pressen und werden dort anteilig
--     (kg der Traubenzeilen mit zukauf_posten_id) als ZK_TRAUB statt ERNTE gebucht – sonst stünden die Trauben doppelt
--     (kg beim Zukauf, Liter bei der Pressung) im Journal.
--     Flaschenverkäufe bucht verkauf_positionen (typ flasche, VK_FL_*), nicht fuellung_bewegungen „verkauf“: die
--     Flaschenzeile entsteht vor dem Beleg (KAN-149 D1), Kundenland und Rechnung gibt es erst mit der Position.
--  5. Merkmalsänderung (Qualitätsstufe, Zusatzbezeichnung, Erzeugnis) an Charge bzw. Füllung → Umstufungspaar
--     AB_ABW (alte Merkmale) / ZU_ABW (neue) über den Journal-Saldo, eine Belegnummer.
--  6. Direkte Mengenänderung ohne Bewegung → Korrektur INV_PLUS/INV_MIN über journal_abgleichen (Abgleich Ist ↔
--     Journal-Saldo, nur für Posten, deren letzte Änderung älter als p_mindestalter ist). Ein transaktionslokales
--     Kennzeichen reicht NICHT: die App ändert die Charge und legt die Bewegung in getrennten Requests (= Transaktionen)
--     an, meist die Charge zuerst (umziehen, abfüllen, verkaufen) – ein Sofort-Abgleich buchte dann jede Bewegung doppelt.
--  7. journal_konsistenz (nur Abweichungen), journal_eroeffnen, journal_abgleichen: SECURITY DEFINER,
--     pruefe_tenant_zugriff, REVOKE; schreibende mit s112_pruefe_abo_schreibsperre.
--  8. s112_mandant_loeschen: unverändert – die Journalzeilen gehen über die Kaskade von tenants mit, der Schutz-Trigger
--     lässt sie dank s112.loeschen_erlaubt durch.
-- Kein session_replication_role, kein DISABLE TRIGGER (KAN-124).

-- 1. Journalbeginn je Betrieb ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_einstellungen ADD COLUMN journal_ab date;
COMMENT ON COLUMN public.tenant_einstellungen.journal_ab IS
  'KAN-40: Beginn des Bewegungsjournals (kellerbuch_buchungen); NULL = Journal aus. Setzen nur über journal_eroeffnen.';
GRANT SELECT (journal_ab) ON public.tenant_einstellungen TO authenticated, anon;

-- 2. Tabelle ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.kellerbuch_buchungen (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  beleg_nr            integer NOT NULL CHECK (beleg_nr > 0),
  pos                 smallint NOT NULL CHECK (pos > 0),
  datum               date NOT NULL,
  buchungsart_code    text NOT NULL REFERENCES public.kat_buchungsart(code),
  bestand             text NOT NULL CHECK (bestand IN ('offen', 'flasche')),
  weinausbau_id       uuid,
  fuellung_id         uuid,
  behaelter_id        uuid,
  zukauf_posten_id    uuid,
  gegen_weinausbau_id uuid,
  menge_liter         numeric(14,3) NOT NULL DEFAULT 0,
  menge_stk           integer NOT NULL DEFAULT 0,
  menge_kg            numeric(14,2),
  partner_name        text,
  partner_land        text,
  quelle_tabelle      text NOT NULL CHECK (quelle_tabelle ~ '^[a-z_0-9]{2,60}$'),
  quelle_id           uuid,
  gruppe_id           uuid,
  storno_von_id       uuid,
  rekonstruiert       boolean NOT NULL DEFAULT false,
  -- Merkmale zum Buchungszeitpunkt (Momentaufnahme)
  charge_name         text,
  fuellung_name       text,
  flaschengroesse_ml  integer,
  erzeugnis           text,
  qualitaetsstufe     text,
  zusatzbezeichnung   text,
  weinart             text,
  herkunft_code       text,
  land_iso            text,
  rebsorte            text,
  jahrgang            integer,
  hinweis             text,
  erstellt_von        uuid,
  erstellt_am         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kellerbuch_buchungen_bezug_chk CHECK (
    (bestand = 'offen' AND weinausbau_id IS NOT NULL AND menge_stk = 0) OR (bestand = 'flasche' AND fuellung_id IS NOT NULL)),
  CONSTRAINT kellerbuch_buchungen_beleg_pos_key UNIQUE (tenant_id, beleg_nr, pos),
  CONSTRAINT kellerbuch_buchungen_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT kellerbuch_buchungen_storno_fk FOREIGN KEY (tenant_id, storno_von_id)
    REFERENCES public.kellerbuch_buchungen (tenant_id, id)
);
CREATE INDEX kellerbuch_buchungen_datum_idx   ON public.kellerbuch_buchungen (tenant_id, datum, beleg_nr);
CREATE INDEX kellerbuch_buchungen_charge_idx  ON public.kellerbuch_buchungen (tenant_id, weinausbau_id) WHERE weinausbau_id IS NOT NULL;
CREATE INDEX kellerbuch_buchungen_fuell_idx   ON public.kellerbuch_buchungen (tenant_id, fuellung_id) WHERE fuellung_id IS NOT NULL;
CREATE INDEX kellerbuch_buchungen_quelle_idx  ON public.kellerbuch_buchungen (tenant_id, quelle_tabelle, quelle_id);
CREATE INDEX kellerbuch_buchungen_gruppe_idx  ON public.kellerbuch_buchungen (tenant_id, quelle_tabelle, gruppe_id) WHERE gruppe_id IS NOT NULL;
CREATE INDEX kellerbuch_buchungen_storno_idx  ON public.kellerbuch_buchungen (tenant_id, storno_von_id) WHERE storno_von_id IS NOT NULL;
COMMENT ON TABLE public.kellerbuch_buchungen IS
  'KAN-40 E1: Bewegungsjournal – eine Zeile je Mengenwirkung mit Merkmalen zum Buchungszeitpunkt; unveränderlich, nur per Trigger/RPC';

-- 3. Unveränderlichkeit ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_journal_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_frei  text := NULLIF(current_setting('s112.loeschen_erlaubt', true), '');
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Das Bewegungsjournal wird nie geleert (KAN-40).' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_rolle IN ('authenticated', 'anon') AND coalesce(current_setting('s112.journal_schreiben', true), '') <> 'an' THEN
      RAISE EXCEPTION 'Das Bewegungsjournal schreibt nur die Datenbank (KAN-40).' USING ERRCODE = '42501';
    END IF;
    NEW.erstellt_am  := now();
    NEW.erstellt_von := coalesce(NEW.erstellt_von, auth.uid());
    RETURN NEW;
  END IF;
  -- Wartung (nie API-Rollen): Demo-Betrieb Musterhof bzw. Mandanten-Löschung/Pilotabschluss mit Kennzeichen
  IF TG_OP = 'DELETE' AND v_rolle NOT IN ('authenticated', 'anon')
     AND (OLD.tenant_id = '33333333-3333-4333-8333-333333333333'::uuid OR v_frei = '*' OR v_frei = OLD.tenant_id::text) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Das Bewegungsjournal ist unveränderlich (KAN-40) – Korrekturen entstehen als Gegen- bzw. Korrekturbuchung.'
    USING ERRCODE = '42501';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_schutz() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_journal_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.kellerbuch_buchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_schutz();
CREATE TRIGGER a_journal_schutz_truncate BEFORE TRUNCATE ON public.kellerbuch_buchungen
  FOR EACH STATEMENT EXECUTE FUNCTION public.s112_journal_schutz();

ALTER TABLE public.kellerbuch_buchungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.kellerbuch_buchungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kellerbuch_buchungen FROM anon;
-- Schreiben: keine Policy für INSERT/UPDATE/DELETE – nur Trigger/RPC (SECURITY DEFINER); der Schutz-Trigger sperrt zusätzlich

CREATE POLICY journal_select ON public.kellerbuch_buchungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.kellerbuch_buchungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.kellerbuch_buchungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.kellerbuch_buchungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.kellerbuch_buchungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.kellerbuch_buchungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY ki_aktiver_betrieb ON public.kellerbuch_buchungen AS RESTRICTIVE FOR SELECT TO authenticated
  USING (((SELECT NULLIF(current_setting('app.active_tenant_id', true), '')) IS NULL) OR (tenant_id IS NULL)
         OR (tenant_id = (SELECT NULLIF(current_setting('app.active_tenant_id', true), '')::uuid)));

-- 4. Hilfsfunktionen (intern, INVOKER, kein EXECUTE für API-Rollen – laufen in den SECURITY-DEFINER-Triggern/RPCs) ──

-- Journalbeginn des Betriebs (NULL = aus)
CREATE OR REPLACE FUNCTION public.s112_journal_ab(p_tenant_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT e.journal_ab FROM public.tenant_einstellungen e WHERE e.tenant_id = p_tenant_id
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_ab(uuid) FROM PUBLIC, anon, authenticated;

-- Merkmale (Momentaufnahme) aus einer weinausbau- bzw. fuellungen-Zeile
CREATE OR REPLACE FUNCTION public.s112_journal_merkmale(p_bestand text, p_zeile jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN p_bestand = 'offen' THEN jsonb_build_object(
           'charge_name', p_zeile ->> 'name', 'behaelter_id', p_zeile ->> 'behaelter_id',
           'erzeugnis', p_zeile ->> 'erzeugnis', 'qualitaetsstufe', p_zeile ->> 'qualitaetsstufe',
           'zusatzbezeichnung', p_zeile ->> 'zusatzbezeichnung', 'weinart', p_zeile ->> 'weinart',
           'herkunft_code', p_zeile ->> 'herkunft_code', 'land_iso', p_zeile ->> 'land_iso',
           'rebsorte', p_zeile ->> 'rebsorte', 'jahrgang', p_zeile ->> 'jahrgang')
         ELSE jsonb_build_object(
           'fuellung_name', p_zeile ->> 'name', 'flaschengroesse_ml', p_zeile ->> 'flaschengroesse_ml',
           'erzeugnis', p_zeile ->> 'erzeugnis', 'qualitaetsstufe', p_zeile ->> 'qualitaet',
           'zusatzbezeichnung', p_zeile ->> 'zusatzbezeichnung', 'weinart', p_zeile ->> 'weinart',
           'herkunft_code', p_zeile ->> 'herkunft_code', 'land_iso', p_zeile ->> 'land_iso',
           'rebsorte', p_zeile ->> 'rebsorte', 'jahrgang', p_zeile ->> 'jahrgang') END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_merkmale(text, jsonb) FROM PUBLIC, anon, authenticated;

-- Käufer/Verkäufer: Momentaufnahme (partner_daten, KAN-150 F1c) vor den Stammdaten
CREATE OR REPLACE FUNCTION public.s112_journal_partner(p_daten jsonb, p_firma_teil text, p_kontakt_teil text, p_firma_id uuid, p_kontakt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_f jsonb;
  v_k jsonb;
BEGIN
  IF p_daten IS NOT NULL AND jsonb_typeof(p_daten) = 'object' AND p_daten <> '{}'::jsonb THEN
    v_f := CASE WHEN jsonb_typeof(p_daten -> p_firma_teil) = 'object' THEN p_daten -> p_firma_teil END;
    v_k := CASE WHEN jsonb_typeof(p_daten -> p_kontakt_teil) = 'object' THEN p_daten -> p_kontakt_teil END;
  ELSE
    SELECT jsonb_build_object('name', f.name, 'land', f.land) INTO v_f FROM public.firmen f WHERE f.id = p_firma_id;
    SELECT jsonb_build_object('vorname', k.vorname, 'nachname', k.nachname, 'land', k.land) INTO v_k FROM public.kontakte k WHERE k.id = p_kontakt_id;
  END IF;
  RETURN jsonb_build_object(
    'name', coalesce(NULLIF(btrim(v_f ->> 'name'), ''), NULLIF(btrim(concat_ws(' ', v_k ->> 'vorname', v_k ->> 'nachname')), '')),
    'land', upper(coalesce(NULLIF(btrim(v_f ->> 'land'), ''), NULLIF(btrim(v_k ->> 'land'), ''))));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_partner(jsonb, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Belegnummer: lückenlos je Betrieb; gleicher Schlüssel in derselben Transaktion = gleiche Nummer
CREATE OR REPLACE FUNCTION public.s112_journal_beleg(p_tenant_id uuid, p_schluessel text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_guc text;
  v_nr  integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_journal:' || p_tenant_id::text, 0));
  IF p_schluessel IS NOT NULL THEN
    v_guc := 's112.jb_' || md5(p_tenant_id::text || '|' || p_schluessel);
    v_nr := NULLIF(current_setting(v_guc, true), '')::integer;
    IF v_nr IS NOT NULL THEN
      RETURN v_nr;
    END IF;
  END IF;
  SELECT coalesce(max(k.beleg_nr), 0) + 1 INTO v_nr FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant_id;
  IF v_guc IS NOT NULL THEN
    PERFORM set_config(v_guc, v_nr::text, true);
  END IF;
  RETURN v_nr;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_beleg(uuid, text) FROM PUBLIC, anon, authenticated;

-- Eine Journalzeile aus einem Entwurf {code, bestand, weinausbau_id, fuellung_id, liter, stk, kg, gegen_weinausbau_id,
-- zukauf_posten_id, partner_name, partner_land, hinweis, merkmale?}; Merkmale ohne Vorgabe aus der Charge bzw. Füllung
CREATE OR REPLACE FUNCTION public.s112_journal_schreiben(p_tenant_id uuid, p_beleg integer, p_datum date, p_z jsonb,
  p_quelle_tabelle text, p_quelle_id uuid, p_gruppe uuid, p_rekonstruiert boolean, p_hinweis text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bestand text := coalesce(p_z ->> 'bestand', 'offen');
  v_m       jsonb := p_z -> 'merkmale';
  v_zeile   jsonb;
  v_pos     integer;
  v_id      uuid;
BEGIN
  IF v_m IS NULL OR jsonb_typeof(v_m) <> 'object' THEN
    IF v_bestand = 'offen' THEN
      SELECT to_jsonb(w) INTO v_zeile FROM public.weinausbau w WHERE w.id = (p_z ->> 'weinausbau_id')::uuid AND w.tenant_id = p_tenant_id;
    ELSE
      SELECT to_jsonb(f) INTO v_zeile FROM public.fuellungen f WHERE f.id = (p_z ->> 'fuellung_id')::uuid AND f.tenant_id = p_tenant_id;
    END IF;
    v_m := public.s112_journal_merkmale(v_bestand, coalesce(v_zeile, '{}'::jsonb));
  END IF;
  SELECT coalesce(max(k.pos), 0) + 1 INTO v_pos FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant_id AND k.beleg_nr = p_beleg;

  PERFORM set_config('s112.journal_schreiben', 'an', true);
  INSERT INTO public.kellerbuch_buchungen (tenant_id, beleg_nr, pos, datum, buchungsart_code, bestand, weinausbau_id, fuellung_id,
    behaelter_id, zukauf_posten_id, gegen_weinausbau_id, menge_liter, menge_stk, menge_kg, partner_name, partner_land,
    quelle_tabelle, quelle_id, gruppe_id, rekonstruiert, charge_name, fuellung_name, flaschengroesse_ml, erzeugnis,
    qualitaetsstufe, zusatzbezeichnung, weinart, herkunft_code, land_iso, rebsorte, jahrgang, hinweis)
  VALUES (p_tenant_id, p_beleg, v_pos, p_datum, p_z ->> 'code', v_bestand, (p_z ->> 'weinausbau_id')::uuid, (p_z ->> 'fuellung_id')::uuid,
    (v_m ->> 'behaelter_id')::uuid, (p_z ->> 'zukauf_posten_id')::uuid, (p_z ->> 'gegen_weinausbau_id')::uuid,
    round(coalesce((p_z ->> 'liter')::numeric, 0), 3), coalesce((p_z ->> 'stk')::integer, 0), round((p_z ->> 'kg')::numeric, 2),
    NULLIF(p_z ->> 'partner_name', ''), NULLIF(p_z ->> 'partner_land', ''),
    p_quelle_tabelle, p_quelle_id, p_gruppe, coalesce(p_rekonstruiert, false),
    v_m ->> 'charge_name', v_m ->> 'fuellung_name', (v_m ->> 'flaschengroesse_ml')::integer, v_m ->> 'erzeugnis',
    v_m ->> 'qualitaetsstufe', v_m ->> 'zusatzbezeichnung', v_m ->> 'weinart', v_m ->> 'herkunft_code', v_m ->> 'land_iso',
    v_m ->> 'rebsorte', (v_m ->> 'jahrgang')::integer,
    NULLIF(concat_ws(' · ', NULLIF(p_z ->> 'hinweis', ''), NULLIF(p_hinweis, '')), ''))
  RETURNING id INTO v_id;
  PERFORM set_config('s112.journal_schreiben', '', true);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_schreiben(uuid, integer, date, jsonb, text, uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- Aktive (nicht gegengebuchte) Zeilen einer Quelle gegenbuchen: gleiche Buchungsart, umgekehrtes Vorzeichen, Merkmale
-- der Originalzeile, storno_von_id
CREATE OR REPLACE FUNCTION public.s112_journal_gegenbuchen(p_tenant_id uuid, p_beleg integer, p_datum date,
  p_quelle_tabelle text, p_quelle_id uuid, p_hinweis text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  v_n   integer := 0;
  v_pos integer;
BEGIN
  SELECT coalesce(max(k.pos), 0) INTO v_pos FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant_id AND k.beleg_nr = p_beleg;
  PERFORM set_config('s112.journal_schreiben', 'an', true);
  FOR r IN
    SELECT k.* FROM public.kellerbuch_buchungen k
     WHERE k.tenant_id = p_tenant_id AND k.quelle_tabelle = p_quelle_tabelle AND k.quelle_id = p_quelle_id
       AND k.storno_von_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.kellerbuch_buchungen s WHERE s.tenant_id = k.tenant_id AND s.storno_von_id = k.id)
     ORDER BY k.beleg_nr, k.pos
  LOOP
    v_pos := v_pos + 1;
    INSERT INTO public.kellerbuch_buchungen (tenant_id, beleg_nr, pos, datum, buchungsart_code, bestand, weinausbau_id, fuellung_id,
      behaelter_id, zukauf_posten_id, gegen_weinausbau_id, menge_liter, menge_stk, menge_kg, partner_name, partner_land,
      quelle_tabelle, quelle_id, gruppe_id, storno_von_id, rekonstruiert, charge_name, fuellung_name, flaschengroesse_ml, erzeugnis,
      qualitaetsstufe, zusatzbezeichnung, weinart, herkunft_code, land_iso, rebsorte, jahrgang, hinweis)
    VALUES (r.tenant_id, p_beleg, v_pos, p_datum, r.buchungsart_code, r.bestand, r.weinausbau_id, r.fuellung_id,
      r.behaelter_id, r.zukauf_posten_id, r.gegen_weinausbau_id, -r.menge_liter, -r.menge_stk, -r.menge_kg, r.partner_name, r.partner_land,
      r.quelle_tabelle, r.quelle_id, r.gruppe_id, r.id, false, r.charge_name, r.fuellung_name, r.flaschengroesse_ml, r.erzeugnis,
      r.qualitaetsstufe, r.zusatzbezeichnung, r.weinart, r.herkunft_code, r.land_iso, r.rebsorte, r.jahrgang,
      concat_ws(' · ', p_hinweis, format('zu Beleg %s/%s vom %s', r.beleg_nr, r.pos, to_char(r.datum, 'DD.MM.YYYY'))));
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('s112.journal_schreiben', '', true);
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_gegenbuchen(uuid, integer, date, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- Kern: Stand einer Quellzeile vorher/nachher ({wirksam, datum, zeilen[]}) → Gegenbuchung und/oder Buchung.
--   * keine Änderung des Stands → nichts;
--   * aktive Journalzeilen der Quelle → gegenbuchen (am Storno- bzw. Änderungstag);
--   * keine aktiven Zeilen, aber vorher wirksam und vor Journalbeginn datiert (im Eröffnungsbestand enthalten) und jetzt
--     nicht mehr bzw. ins Journal verschoben → berechnete alte Zeilen gegenbuchen;
--   * nachher wirksam und ab Journalbeginn datiert (bzw. nach einer Gegenbuchung) → buchen.
CREATE OR REPLACE FUNCTION public.s112_journal_vorgang(p_tenant_id uuid, p_tabelle text, p_id uuid, p_gruppe uuid,
  p_alt jsonb, p_neu jsonb, p_tag date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ab    date := public.s112_journal_ab(p_tenant_id);
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_alt_w boolean := coalesce((p_alt ->> 'wirksam')::boolean, false) AND jsonb_array_length(coalesce(p_alt -> 'zeilen', '[]'::jsonb)) > 0;
  v_neu_w boolean := coalesce((p_neu ->> 'wirksam')::boolean, false) AND jsonb_array_length(coalesce(p_neu -> 'zeilen', '[]'::jsonb)) > 0;
  v_alt_d date := (p_alt ->> 'datum')::date;
  v_neu_d date := (p_neu ->> 'datum')::date;
  v_tag   date;
  v_rev   boolean := false;
  v_beleg integer;
  v_z     jsonb;
  v_g     text := coalesce(p_gruppe, p_id)::text;
BEGIN
  IF v_ab IS NULL OR p_tenant_id IS NULL OR p_id IS NULL THEN
    RETURN;
  END IF;
  IF p_alt IS NOT NULL AND p_alt = p_neu THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_journal:' || p_tenant_id::text, 0));
  v_tag := greatest(coalesce(p_tag, v_heute), v_ab);

  -- 1. Gegenbuchung
  IF EXISTS (SELECT 1 FROM public.kellerbuch_buchungen k
              WHERE k.tenant_id = p_tenant_id AND k.quelle_tabelle = p_tabelle AND k.quelle_id = p_id AND k.storno_von_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.kellerbuch_buchungen s WHERE s.tenant_id = k.tenant_id AND s.storno_von_id = k.id)) THEN
    v_beleg := public.s112_journal_beleg(p_tenant_id, concat_ws('|', 'S', p_tabelle, v_g, v_tag));
    PERFORM public.s112_journal_gegenbuchen(p_tenant_id, v_beleg, v_tag, p_tabelle, p_id,
      CASE WHEN v_neu_w THEN 'Gegenbuchung (Buchung geändert)' ELSE 'Gegenbuchung (Storno)' END);
    v_rev := true;
  ELSIF v_alt_w AND v_alt_d < v_ab AND NOT (v_neu_w AND v_neu_d < v_ab) THEN
    v_beleg := public.s112_journal_beleg(p_tenant_id, concat_ws('|', 'S', p_tabelle, v_g, v_tag));
    FOR v_z IN SELECT x FROM jsonb_array_elements(p_alt -> 'zeilen') AS x LOOP
      PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, v_tag,
        v_z || jsonb_build_object('liter', -coalesce((v_z ->> 'liter')::numeric, 0), 'stk', -coalesce((v_z ->> 'stk')::integer, 0),
                                  'kg', -(v_z ->> 'kg')::numeric),
        p_tabelle, p_id, p_gruppe, false,
        format('Gegenbuchung zu einer Buchung vom %s (vor Journalbeginn, im Eröffnungsbestand)', to_char(v_alt_d, 'DD.MM.YYYY')));
    END LOOP;
    v_rev := true;
  END IF;

  -- 2. Buchung
  IF v_neu_w AND (v_neu_d >= v_ab OR v_rev) THEN
    IF v_rev THEN
      v_beleg := public.s112_journal_beleg(p_tenant_id, concat_ws('|', 'U', p_tabelle, v_g, v_tag));
    ELSE
      -- Erstbuchung: Belegnummer der Gruppe (z. B. Umzug-Batch in getrennten Requests), sonst neu
      v_beleg := NULL;
      IF p_gruppe IS NOT NULL THEN
        SELECT k.beleg_nr INTO v_beleg FROM public.kellerbuch_buchungen k
         WHERE k.tenant_id = p_tenant_id AND k.quelle_tabelle = p_tabelle AND k.gruppe_id = p_gruppe AND k.storno_von_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.kellerbuch_buchungen s WHERE s.tenant_id = k.tenant_id AND s.storno_von_id = k.id)
         ORDER BY k.beleg_nr DESC LIMIT 1;
      END IF;
      IF v_beleg IS NULL THEN
        v_beleg := public.s112_journal_beleg(p_tenant_id, concat_ws('|', 'B', p_tabelle, v_g));
      END IF;
    END IF;
    FOR v_z IN SELECT x FROM jsonb_array_elements(p_neu -> 'zeilen') AS x LOOP
      PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, greatest(v_neu_d, v_ab), v_z, p_tabelle, p_id, p_gruppe, false,
        CASE WHEN v_neu_d < v_ab THEN format('datiert %s (vor Journalbeginn)', to_char(v_neu_d, 'DD.MM.YYYY')) END);
    END LOOP;
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_vorgang(uuid, text, uuid, uuid, jsonb, jsonb, date) FROM PUBLIC, anon, authenticated;

-- Umstufungspaar über den Journal-Saldo eines Postens (ohne die aktiven Zeilen einer Quelle, die im selben Statement neu
-- gebucht wird – sonst würde deren Menge doppelt umgestuft)
CREATE OR REPLACE FUNCTION public.s112_journal_umstufung(p_tenant_id uuid, p_bestand text, p_id uuid, p_alt jsonb, p_neu jsonb,
  p_ohne_quelle text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ab    date := public.s112_journal_ab(p_tenant_id);
  v_l     numeric;
  v_stk   integer;
  v_beleg integer;
  v_tag   date;
  v_tab   text := CASE WHEN p_bestand = 'offen' THEN 'weinausbau_merkmale' ELSE 'fuellungen_merkmale' END;
  v_bez   text;
BEGIN
  IF v_ab IS NULL OR p_id IS NULL THEN
    RETURN;
  END IF;
  IF (p_alt ->> 'erzeugnis', p_alt ->> 'qualitaetsstufe', p_alt ->> 'zusatzbezeichnung')
     IS NOT DISTINCT FROM (p_neu ->> 'erzeugnis', p_neu ->> 'qualitaetsstufe', p_neu ->> 'zusatzbezeichnung') THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_journal:' || p_tenant_id::text, 0));
  SELECT coalesce(sum(k.menge_liter), 0), coalesce(sum(k.menge_stk), 0) INTO v_l, v_stk
    FROM public.kellerbuch_buchungen k
   WHERE k.tenant_id = p_tenant_id AND k.bestand = p_bestand
     AND (CASE WHEN p_bestand = 'offen' THEN k.weinausbau_id ELSE k.fuellung_id END) = p_id
     AND NOT (p_ohne_quelle IS NOT NULL AND k.quelle_tabelle = p_ohne_quelle AND k.quelle_id = p_id AND k.storno_von_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.kellerbuch_buchungen s WHERE s.tenant_id = k.tenant_id AND s.storno_von_id = k.id));
  IF (p_bestand = 'offen' AND abs(v_l) < 0.0005) OR (p_bestand = 'flasche' AND v_stk = 0) THEN
    RETURN;
  END IF;
  v_tag := greatest((now() AT TIME ZONE 'Europe/Vienna')::date, v_ab);
  v_beleg := public.s112_journal_beleg(p_tenant_id, NULL);
  v_bez := format('Umstufung: %s → %s',
    concat_ws(' / ', coalesce(p_alt ->> 'qualitaetsstufe', '–'), p_alt ->> 'zusatzbezeichnung', p_alt ->> 'erzeugnis'),
    concat_ws(' / ', coalesce(p_neu ->> 'qualitaetsstufe', '–'), p_neu ->> 'zusatzbezeichnung', p_neu ->> 'erzeugnis'));
  PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, v_tag,
    jsonb_build_object('code', 'AB_ABW', 'bestand', p_bestand,
      CASE WHEN p_bestand = 'offen' THEN 'weinausbau_id' ELSE 'fuellung_id' END, p_id, 'liter', -v_l, 'stk', -v_stk, 'merkmale', p_alt),
    v_tab, p_id, p_id, false, v_bez);
  PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, v_tag,
    jsonb_build_object('code', 'ZU_ABW', 'bestand', p_bestand,
      CASE WHEN p_bestand = 'offen' THEN 'weinausbau_id' ELSE 'fuellung_id' END, p_id, 'liter', v_l, 'stk', v_stk, 'merkmale', p_neu),
    v_tab, p_id, p_id, false, v_bez);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_umstufung(uuid, text, uuid, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;

-- 5. Zeilen je Quelle (rein, aus der Zeile als jsonb) ─────────────────────────────────────────────────────────

-- Umzug/Filtration/Schwund (wie bewegungsbuch.ts): quelle = Abgang brutto (davon Schwund), ziel = Zugang netto;
-- Einzelzeile: Abgang brutto || netto, Zugang netto (bzw. netto − Schwund ohne brutto); umzug_typ schwund → SCHWUND
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_umzug(u jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_typ     text := coalesce(u ->> 'umzug_typ', 'normal');
  v_code    text := CASE WHEN coalesce(u ->> 'umzug_typ', '') = 'filtration' THEN 'FILTRAT' ELSE 'UMZUG' END;
  v_menge   numeric := coalesce((u ->> 'menge_liter')::numeric, 0);
  v_brutto  numeric := (u ->> 'brutto_liter')::numeric;
  v_schwund numeric := greatest(coalesce((u ->> 'schwund_liter')::numeric, 0), 0);
  v_von     uuid := (u ->> 'von_weinausbau_id')::uuid;
  v_nach    uuid := (u ->> 'nach_weinausbau_id')::uuid;
  v_ab      numeric;
  v_zu      numeric;
  v_hinweis text := CASE WHEN coalesce(u ->> 'umzug_typ', '') = 'filtration' THEN 'Schwund beim Filtrieren' ELSE 'Schwund beim Umziehen' END;
  z         jsonb := '[]'::jsonb;
BEGIN
  IF u ->> 'zeilen_typ' = 'quelle' THEN
    IF v_von IS NULL OR v_menge <= 0 THEN
      RETURN z;
    END IF;
    IF v_typ = 'schwund' THEN
      v_schwund := v_menge;
    END IF;
    v_schwund := least(v_schwund, v_menge);
    IF v_menge - v_schwund > 0 THEN
      z := z || jsonb_build_object('code', v_code, 'bestand', 'offen', 'weinausbau_id', v_von, 'liter', -(v_menge - v_schwund));
    END IF;
    IF v_schwund > 0 THEN
      z := z || jsonb_build_object('code', 'SCHWUND', 'bestand', 'offen', 'weinausbau_id', v_von, 'liter', -v_schwund, 'hinweis', v_hinweis);
    END IF;
    RETURN z;
  ELSIF u ->> 'zeilen_typ' = 'ziel' THEN
    IF v_nach IS NULL OR v_menge <= 0 THEN
      RETURN z;
    END IF;
    RETURN z || jsonb_build_object('code', v_code, 'bestand', 'offen', 'weinausbau_id', v_nach, 'liter', v_menge);
  END IF;

  -- Einzelzeile (zeilen_typ transfer/NULL)
  v_ab := CASE WHEN coalesce(v_brutto, 0) <> 0 THEN v_brutto ELSE v_menge END;
  v_zu := CASE WHEN v_brutto IS NOT NULL THEN v_menge ELSE greatest(0, v_menge - v_schwund) END;
  IF v_typ = 'schwund' THEN
    IF v_von IS NOT NULL AND v_ab > 0 THEN
      z := z || jsonb_build_object('code', 'SCHWUND', 'bestand', 'offen', 'weinausbau_id', v_von, 'liter', -v_ab, 'hinweis', 'Schwundbuchung');
    END IF;
    RETURN z;
  END IF;
  IF v_von IS NOT NULL THEN
    IF v_zu > 0 THEN
      z := z || jsonb_build_object('code', v_code, 'bestand', 'offen', 'weinausbau_id', v_von, 'liter', -v_zu, 'gegen_weinausbau_id', v_nach);
    END IF;
    IF v_ab - v_zu > 0.0005 THEN
      z := z || jsonb_build_object('code', 'SCHWUND', 'bestand', 'offen', 'weinausbau_id', v_von, 'liter', -(v_ab - v_zu), 'hinweis', v_hinweis);
    END IF;
  END IF;
  IF v_nach IS NOT NULL AND v_zu > 0 THEN
    z := z || jsonb_build_object('code', v_code, 'bestand', 'offen', 'weinausbau_id', v_nach, 'liter', v_zu, 'gegen_weinausbau_id', v_von);
  END IF;
  RETURN z;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_umzug(jsonb) FROM PUBLIC, anon, authenticated;

-- Pressung: ERNTE, anteilig ZK_TRAUB nach den kg der Traubenzeilen mit zukauf_posten_id
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_pressung(pb jsonb, p_kg_gesamt numeric, p_kg_zukauf numeric, p_zukauf_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wa uuid := (pb ->> 'weinausbau_id')::uuid;
  v_l  numeric := coalesce((pb ->> 'menge_liter')::numeric, 0);
  v_zk numeric := 0;
  z    jsonb := '[]'::jsonb;
BEGIN
  IF v_wa IS NULL OR v_l <= 0 THEN
    RETURN z;
  END IF;
  IF coalesce(p_kg_gesamt, 0) > 0 AND coalesce(p_kg_zukauf, 0) > 0 THEN
    v_zk := least(v_l, round(v_l * p_kg_zukauf / p_kg_gesamt, 2));
  END IF;
  IF v_l - v_zk > 0 THEN
    z := z || jsonb_build_object('code', 'ERNTE', 'bestand', 'offen', 'weinausbau_id', v_wa, 'liter', v_l - v_zk);
  END IF;
  IF v_zk > 0 THEN
    z := z || jsonb_build_object('code', 'ZK_TRAUB', 'bestand', 'offen', 'weinausbau_id', v_wa, 'liter', v_zk, 'zukauf_posten_id', p_zukauf_id,
      'hinweis', format('Anteil zugekaufter Trauben %s %% (%s von %s kg)', round(100 * p_kg_zukauf / p_kg_gesamt, 1), p_kg_zukauf, p_kg_gesamt));
  END IF;
  RETURN z;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_pressung(jsonb, numeric, numeric, uuid) FROM PUBLIC, anon, authenticated;

-- Zukauf Wein/Most in eine Charge (Trauben: siehe Kopf – Buchung erst bei der Pressung)
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_zukauf(zp jsonb, p_partner jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN zp ->> 'art' IN ('wein', 'most') AND zp ->> 'ziel_weinausbau_id' IS NOT NULL AND coalesce((zp ->> 'menge')::numeric, 0) > 0
    THEN jsonb_build_array(jsonb_build_object('code', CASE WHEN zp ->> 'art' = 'most' THEN 'ZK_MOST' ELSE 'ZK_FASS' END, 'bestand', 'offen',
           'weinausbau_id', zp ->> 'ziel_weinausbau_id', 'liter', (zp ->> 'menge')::numeric, 'zukauf_posten_id', zp ->> 'id',
           'partner_name', p_partner ->> 'name', 'partner_land', p_partner ->> 'land'))
    ELSE '[]'::jsonb END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_zukauf(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Verschnitt: je Quelle VS_AB aus der Quell-Charge und VS_ZU in die Ziel-Charge
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_verschnitt(q jsonb, p_ziel uuid)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN coalesce((q ->> 'menge_liter')::numeric, 0) > 0 AND q ->> 'quell_weinausbau_id' IS NOT NULL AND p_ziel IS NOT NULL
    THEN jsonb_build_array(
      jsonb_build_object('code', 'VS_AB', 'bestand', 'offen', 'weinausbau_id', q ->> 'quell_weinausbau_id', 'liter', -(q ->> 'menge_liter')::numeric,
                         'gegen_weinausbau_id', p_ziel),
      jsonb_build_object('code', 'VS_ZU', 'bestand', 'offen', 'weinausbau_id', p_ziel, 'liter', (q ->> 'menge_liter')::numeric,
                         'gegen_weinausbau_id', q ->> 'quell_weinausbau_id'))
    ELSE '[]'::jsonb END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_verschnitt(jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- Füllung: Abgang offen (Flascheninhalt FUELLUNG, Rest Füllverlust SCHWUND), Zugang Flasche FUELLUNG;
-- ohne Charge: Eröffnungsbestand (import_quelle 'eroeffnungsbestand') EROEFF, sonst Flaschenzukauf ZK_FLA
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_fuellung(f jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wa   uuid := (f ->> 'weinausbau_id')::uuid;
  v_ml   integer := coalesce(NULLIF((f ->> 'flaschengroesse_ml')::integer, 0), 750);
  v_stk  integer := greatest(coalesce((f ->> 'anzahl_flaschen')::integer, 0), 0);
  v_fl   numeric := round(greatest(coalesce((f ->> 'anzahl_flaschen')::integer, 0), 0) * v_ml / 1000.0, 3);
  v_tank numeric;
  z      jsonb := '[]'::jsonb;
BEGIN
  IF v_wa IS NOT NULL THEN
    v_tank := coalesce((f ->> 'menge_liter_gefuellt')::numeric, v_fl);
    IF least(v_fl, v_tank) > 0 THEN
      z := z || jsonb_build_object('code', 'FUELLUNG', 'bestand', 'offen', 'weinausbau_id', v_wa, 'fuellung_id', f ->> 'id', 'liter', -least(v_fl, v_tank));
    END IF;
    IF v_tank - v_fl > 0.0005 THEN
      z := z || jsonb_build_object('code', 'SCHWUND', 'bestand', 'offen', 'weinausbau_id', v_wa, 'fuellung_id', f ->> 'id', 'liter', -(v_tank - v_fl),
                                   'hinweis', 'Füllverlust (Tankabgang − Flascheninhalt)');
    END IF;
    IF v_stk > 0 THEN
      z := z || jsonb_build_object('code', 'FUELLUNG', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'gegen_weinausbau_id', v_wa);
    END IF;
    RETURN z;
  END IF;
  IF v_stk > 0 THEN
    IF f ->> 'import_quelle' = 'eroeffnungsbestand' THEN
      z := z || jsonb_build_object('code', 'EROEFF', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'hinweis', 'Eröffnungsbestand Flaschen');
    ELSE
      z := z || jsonb_build_object('code', 'ZK_FLA', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'hinweis', 'Füllung ohne Charge – als Flaschenzukauf gebucht');
    END IF;
  END IF;
  RETURN z;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_fuellung(jsonb) FROM PUBLIC, anon, authenticated;

-- Flaschen-Bestandsbuchung (fuellung_bewegungen; Verkauf/Verkaufsstorno bucht die Verkaufsposition)
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_flaschenbuchung(fb jsonb, p_ml integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stk  integer := coalesce((fb ->> 'menge_stk')::integer, 0);
  v_art  text := fb ->> 'art';
  v_code text;
BEGIN
  IF v_stk = 0 OR v_art IN ('verkauf', 'verkauf_storno') THEN
    RETURN '[]'::jsonb;
  END IF;
  v_code := CASE
    WHEN v_art IN ('bruch', 'eigenverbrauch', 'schwund') THEN 'SCHWUND'
    WHEN v_art = 'anfangsbestand' THEN 'EROEFF'
    WHEN v_stk > 0 THEN 'INV_PLUS'
    ELSE 'INV_MIN' END;
  RETURN jsonb_build_array(jsonb_build_object('code', v_code, 'bestand', 'flasche', 'fuellung_id', fb ->> 'fuellung_id', 'stk', v_stk,
    'liter', round(v_stk * coalesce(NULLIF(p_ml, 0), 750) / 1000.0, 3),
    'hinweis', concat_ws(': ', initcap(v_art), NULLIF(fb ->> 'grund', ''))));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_flaschenbuchung(jsonb, integer) FROM PUBLIC, anon, authenticated;

-- Verkaufsposition: Tank VK_FA_AT/AU (Liter), Flasche VK_FL_AT/AU (Stück × Flaschengröße); Ausland = Land des Käufers ≠ AT
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_verkauf(p jsonb, p_partner jsonb, p_ml integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_au  boolean := coalesce(p_partner ->> 'land', 'AT') <> 'AT';
  v_m   numeric := coalesce((p ->> 'menge')::numeric, 0);
  v_stk integer;
BEGIN
  IF v_m <= 0 THEN
    RETURN '[]'::jsonb;
  END IF;
  IF p ->> 'typ' = 'tank' AND p ->> 'weinausbau_id' IS NOT NULL THEN
    RETURN jsonb_build_array(jsonb_build_object('code', CASE WHEN v_au THEN 'VK_FA_AU' ELSE 'VK_FA_AT' END, 'bestand', 'offen',
      'weinausbau_id', p ->> 'weinausbau_id', 'liter', -v_m, 'partner_name', p_partner ->> 'name', 'partner_land', p_partner ->> 'land'));
  END IF;
  IF p ->> 'typ' = 'flasche' AND p ->> 'fuellung_id' IS NOT NULL THEN
    v_stk := round(v_m)::integer;
    RETURN jsonb_build_array(jsonb_build_object('code', CASE WHEN v_au THEN 'VK_FL_AU' ELSE 'VK_FL_AT' END, 'bestand', 'flasche',
      'fuellung_id', p ->> 'fuellung_id', 'stk', -v_stk, 'liter', -round(v_stk * coalesce(NULLIF(p_ml, 0), 750) / 1000.0, 3),
      'partner_name', p_partner ->> 'name', 'partner_land', p_partner ->> 'land'));
  END IF;
  RETURN '[]'::jsonb;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_zeilen_verkauf(jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated;

-- 6. Trigger ──────────────────────────────────────────────────────────────────────────────────────────────────

-- keller_umzuege
CREATE OR REPLACE FUNCTION public.s112_journal_trg_umzug()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt jsonb;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_alt := jsonb_build_object('wirksam', OLD.storniert_am IS NULL, 'datum', OLD.datum, 'zeilen', public.s112_journal_zeilen_umzug(to_jsonb(OLD)));
  END IF;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'keller_umzuege', NEW.id, coalesce(NEW.umzug_batch_id, NEW.id), v_alt,
    jsonb_build_object('wirksam', NEW.storniert_am IS NULL, 'datum', NEW.datum, 'zeilen', public.s112_journal_zeilen_umzug(to_jsonb(NEW))),
    (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_umzug() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ,
  von_weinausbau_id, nach_weinausbau_id, umzug_batch_id, storniert_am ON public.keller_umzuege
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_umzug();

-- pressung_behaelter (Kopf: pressungen)
CREATE OR REPLACE FUNCTION public.s112_journal_pressung_stand(pb jsonb, p_datum date, p_kopf_storniert boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kg  numeric;
  v_kgz numeric;
  v_zk  uuid;
BEGIN
  SELECT sum(w.trauben_kg) FILTER (WHERE w.storniert_am IS NULL),
         sum(w.trauben_kg) FILTER (WHERE w.storniert_am IS NULL AND w.zukauf_posten_id IS NOT NULL),
         CASE WHEN count(DISTINCT w.zukauf_posten_id) FILTER (WHERE w.storniert_am IS NULL) = 1
              THEN (array_agg(w.zukauf_posten_id) FILTER (WHERE w.storniert_am IS NULL AND w.zukauf_posten_id IS NOT NULL))[1] END
    INTO v_kg, v_kgz, v_zk
    FROM public.pressung_weingaerten w WHERE w.pressung_id = (pb ->> 'pressung_id')::uuid;
  RETURN jsonb_build_object('wirksam', pb ->> 'storniert_am' IS NULL AND NOT p_kopf_storniert, 'datum', p_datum,
    'zeilen', public.s112_journal_zeilen_pressung(pb, v_kg, v_kgz, v_zk));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_pressung_stand(jsonb, date, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_journal_trg_pressung_behaelter()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p record;
  v_alt jsonb;
BEGIN
  SELECT p.tenant_id, p.datum, p.storniert_am INTO v_p FROM public.pressungen p WHERE p.id = NEW.pressung_id;
  IF NOT FOUND OR public.s112_journal_ab(v_p.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_alt := public.s112_journal_pressung_stand(to_jsonb(OLD), v_p.datum, v_p.storniert_am IS NOT NULL);
  END IF;
  PERFORM public.s112_journal_vorgang(v_p.tenant_id, 'pressung_behaelter', NEW.id, NEW.pressung_id, v_alt,
    public.s112_journal_pressung_stand(to_jsonb(NEW), v_p.datum, v_p.storniert_am IS NOT NULL),
    (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_pressung_behaelter() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF menge_liter, weinausbau_id, pressung_id, storniert_am ON public.pressung_behaelter
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_pressung_behaelter();

CREATE OR REPLACE FUNCTION public.s112_journal_trg_pressung()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT pb.* FROM public.pressung_behaelter pb WHERE pb.pressung_id = NEW.id ORDER BY pb.id LOOP
    PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'pressung_behaelter', r.id, NEW.id,
      public.s112_journal_pressung_stand(to_jsonb(r), OLD.datum, OLD.storniert_am IS NOT NULL),
      public.s112_journal_pressung_stand(to_jsonb(r), NEW.datum, NEW.storniert_am IS NOT NULL),
      (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_pressung() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER UPDATE OF datum, storniert_am ON public.pressungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_pressung();

-- zukauf_posten
CREATE OR REPLACE FUNCTION public.s112_journal_trg_zukauf()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt jsonb;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_alt := jsonb_build_object('wirksam', OLD.aktiv AND OLD.storniert_am IS NULL, 'datum', OLD.datum,
      'zeilen', public.s112_journal_zeilen_zukauf(to_jsonb(OLD),
        public.s112_journal_partner(OLD.partner_daten, 'lieferant_firma', 'lieferant_kontakt', OLD.lieferant_firma_id, OLD.lieferant_kontakt_id)));
  END IF;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'zukauf_posten', NEW.id, NEW.id, v_alt,
    jsonb_build_object('wirksam', NEW.aktiv AND NEW.storniert_am IS NULL, 'datum', NEW.datum,
      'zeilen', public.s112_journal_zeilen_zukauf(to_jsonb(NEW),
        public.s112_journal_partner(NEW.partner_daten, 'lieferant_firma', 'lieferant_kontakt', NEW.lieferant_firma_id, NEW.lieferant_kontakt_id))),
    (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_zukauf() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF datum, art, menge, einheit, ziel_weinausbau_id, aktiv, storniert_am ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_zukauf();

-- verschneidung_quellen (Kopf: verschneidungen)
CREATE OR REPLACE FUNCTION public.s112_journal_trg_verschnitt_quelle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_v record;
  v_alt jsonb;
BEGIN
  SELECT v.tenant_id, v.datum, v.ziel_weinausbau_id, v.storniert_am INTO v_v FROM public.verschneidungen v WHERE v.id = NEW.verschneidung_id;
  IF NOT FOUND OR public.s112_journal_ab(v_v.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_alt := jsonb_build_object('wirksam', v_v.storniert_am IS NULL, 'datum', v_v.datum,
      'zeilen', public.s112_journal_zeilen_verschnitt(to_jsonb(OLD), v_v.ziel_weinausbau_id));
  END IF;
  PERFORM public.s112_journal_vorgang(v_v.tenant_id, 'verschneidung_quellen', NEW.id, NEW.verschneidung_id, v_alt,
    jsonb_build_object('wirksam', v_v.storniert_am IS NULL, 'datum', v_v.datum,
      'zeilen', public.s112_journal_zeilen_verschnitt(to_jsonb(NEW), v_v.ziel_weinausbau_id)), NULL);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_verschnitt_quelle() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF menge_liter, quell_weinausbau_id, verschneidung_id ON public.verschneidung_quellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_verschnitt_quelle();

CREATE OR REPLACE FUNCTION public.s112_journal_trg_verschnitt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT q.* FROM public.verschneidung_quellen q WHERE q.verschneidung_id = NEW.id ORDER BY q.id LOOP
    PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'verschneidung_quellen', r.id, NEW.id,
      jsonb_build_object('wirksam', OLD.storniert_am IS NULL, 'datum', OLD.datum,
        'zeilen', public.s112_journal_zeilen_verschnitt(to_jsonb(r), OLD.ziel_weinausbau_id)),
      jsonb_build_object('wirksam', NEW.storniert_am IS NULL, 'datum', NEW.datum,
        'zeilen', public.s112_journal_zeilen_verschnitt(to_jsonb(r), NEW.ziel_weinausbau_id)),
      (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_verschnitt() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER UPDATE OF datum, ziel_weinausbau_id, storniert_am ON public.verschneidungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_verschnitt();

-- fuellungen: Füllung/Eröffnung/Flaschenzukauf und Umstufung
CREATE OR REPLACE FUNCTION public.s112_journal_trg_fuellung()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt jsonb;
  v_neu jsonb;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  v_neu := jsonb_build_object('wirksam', NEW.storniert_am IS NULL, 'datum', NEW.datum, 'zeilen', public.s112_journal_zeilen_fuellung(to_jsonb(NEW)));
  IF TG_OP = 'UPDATE' THEN
    v_alt := jsonb_build_object('wirksam', OLD.storniert_am IS NULL, 'datum', OLD.datum, 'zeilen', public.s112_journal_zeilen_fuellung(to_jsonb(OLD)));
    -- Umstufung zuerst (ohne die Zeilen dieser Füllung, wenn sie gleich neu gebucht wird)
    IF NEW.storniert_am IS NULL THEN
      PERFORM public.s112_journal_umstufung(NEW.tenant_id, 'flasche', NEW.id,
        public.s112_journal_merkmale('flasche', to_jsonb(OLD)), public.s112_journal_merkmale('flasche', to_jsonb(NEW)),
        CASE WHEN v_alt IS DISTINCT FROM v_neu THEN 'fuellungen' END);
    END IF;
  END IF;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'fuellungen', NEW.id, NEW.id, v_alt, v_neu,
    (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_fuellung() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF weinausbau_id, datum, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml,
  import_quelle, storniert_am, qualitaet, zusatzbezeichnung, erzeugnis ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_fuellung();

-- fuellung_bewegungen (Inventur, Korrektur, Bruch, Eigenverbrauch, Schwund, Anfangsbestand)
CREATE OR REPLACE FUNCTION public.s112_journal_trg_flaschenbuchung()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ml integer;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT f.flaschengroesse_ml INTO v_ml FROM public.fuellungen f WHERE f.id = NEW.fuellung_id AND f.tenant_id = NEW.tenant_id;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'fuellung_bewegungen', NEW.id, NEW.id, NULL,
    jsonb_build_object('wirksam', true, 'datum', NEW.datum, 'zeilen', public.s112_journal_zeilen_flaschenbuchung(to_jsonb(NEW), v_ml)), NULL);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_flaschenbuchung() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT ON public.fuellung_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_flaschenbuchung();

-- verkauf_positionen (Kopf: verkaufsposten)
CREATE OR REPLACE FUNCTION public.s112_journal_verkauf_stand(p jsonb, vp jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ml integer;
BEGIN
  IF p ->> 'typ' = 'flasche' AND p ->> 'fuellung_id' IS NOT NULL THEN
    SELECT f.flaschengroesse_ml INTO v_ml FROM public.fuellungen f WHERE f.id = (p ->> 'fuellung_id')::uuid;
  END IF;
  RETURN jsonb_build_object('wirksam', NOT coalesce((vp ->> 'storniert')::boolean, false), 'datum', vp ->> 'datum',
    'zeilen', public.s112_journal_zeilen_verkauf(p,
      public.s112_journal_partner(vp -> 'partner_daten', 'firma', 'kontakt', (vp ->> 'firma_id')::uuid, (vp ->> 'kontakt_id')::uuid), v_ml));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_verkauf_stand(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_journal_trg_verkauf_position()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vp  jsonb;
  v_alt jsonb;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT to_jsonb(v) INTO v_vp FROM public.verkaufsposten v WHERE v.id = NEW.verkaufsposten_id AND v.tenant_id = NEW.tenant_id;
  IF v_vp IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_alt := public.s112_journal_verkauf_stand(to_jsonb(OLD), v_vp);
  END IF;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'verkauf_positionen', NEW.id, NEW.verkaufsposten_id, v_alt,
    public.s112_journal_verkauf_stand(to_jsonb(NEW), v_vp), NULL);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_verkauf_position() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF typ, menge, einheit, weinausbau_id, fuellung_id, verkaufsposten_id ON public.verkauf_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_verkauf_position();

CREATE OR REPLACE FUNCTION public.s112_journal_trg_verkaufsposten()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  v_tag date;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.storniert AND NOT coalesce(OLD.storniert, false) THEN
    v_tag := (coalesce(NEW.storniert_am, now()) AT TIME ZONE 'Europe/Vienna')::date;
  END IF;
  FOR r IN SELECT p.* FROM public.verkauf_positionen p WHERE p.verkaufsposten_id = NEW.id AND p.tenant_id = NEW.tenant_id ORDER BY p.id LOOP
    PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'verkauf_positionen', r.id, NEW.id,
      public.s112_journal_verkauf_stand(to_jsonb(r), to_jsonb(OLD)), public.s112_journal_verkauf_stand(to_jsonb(r), to_jsonb(NEW)), v_tag);
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_verkaufsposten() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER UPDATE OF storniert, storniert_am, datum ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_verkaufsposten();

-- weinausbau: Eröffnungsbestand Tank (EROEFF) und Umstufung
CREATE OR REPLACE FUNCTION public.s112_journal_trg_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_l_alt numeric;
  v_l_neu numeric;
  v_alt   jsonb;
  v_neu   jsonb;
  v_tag   date := (NEW.created_at AT TIME ZONE 'Europe/Vienna')::date;
BEGIN
  IF public.s112_journal_ab(NEW.tenant_id) IS NULL THEN
    RETURN NULL;
  END IF;
  -- Menge des Eröffnungsbestands: anfangsbestand_liter, sonst die Menge beim Anlegen (spätere Mengenänderungen sind Bewegungen)
  IF TG_OP = 'INSERT' THEN
    v_l_neu := coalesce(NEW.anfangsbestand_liter, NEW.menge_liter, 0);
  ELSE
    v_l_alt := coalesce(OLD.anfangsbestand_liter, OLD.menge_liter, 0);
    v_l_neu := CASE WHEN NEW.anfangsbestand_liter IS DISTINCT FROM OLD.anfangsbestand_liter
                      OR NEW.ist_eroeffnungsbestand IS DISTINCT FROM OLD.ist_eroeffnungsbestand
                    THEN coalesce(NEW.anfangsbestand_liter, NEW.menge_liter, 0) ELSE v_l_alt END;
    v_alt := jsonb_build_object('wirksam', OLD.storniert_am IS NULL, 'datum', (OLD.created_at AT TIME ZONE 'Europe/Vienna')::date,
      'zeilen', CASE WHEN coalesce(OLD.ist_eroeffnungsbestand, false) AND v_l_alt > 0
                     THEN jsonb_build_array(jsonb_build_object('code', 'EROEFF', 'bestand', 'offen', 'weinausbau_id', OLD.id, 'liter', v_l_alt,
                                                               'hinweis', 'Eröffnungsbestand (Altsystem)'))
                     ELSE '[]'::jsonb END);
  END IF;
  v_neu := jsonb_build_object('wirksam', NEW.storniert_am IS NULL, 'datum', v_tag,
    'zeilen', CASE WHEN coalesce(NEW.ist_eroeffnungsbestand, false) AND v_l_neu > 0
                   THEN jsonb_build_array(jsonb_build_object('code', 'EROEFF', 'bestand', 'offen', 'weinausbau_id', NEW.id, 'liter', v_l_neu,
                                                             'hinweis', 'Eröffnungsbestand (Altsystem)'))
                   ELSE '[]'::jsonb END);
  IF TG_OP = 'UPDATE' AND NEW.storniert_am IS NULL THEN
    PERFORM public.s112_journal_umstufung(NEW.tenant_id, 'offen', NEW.id,
      public.s112_journal_merkmale('offen', to_jsonb(OLD)), public.s112_journal_merkmale('offen', to_jsonb(NEW)),
      CASE WHEN v_alt IS DISTINCT FROM v_neu THEN 'weinausbau' END);
  END IF;
  PERFORM public.s112_journal_vorgang(NEW.tenant_id, 'weinausbau', NEW.id, NEW.id, v_alt, v_neu,
    (NEW.storniert_am AT TIME ZONE 'Europe/Vienna')::date);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_trg_charge() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER y_journal AFTER INSERT OR UPDATE OF ist_eroeffnungsbestand, anfangsbestand_liter, storniert_am,
  qualitaetsstufe, zusatzbezeichnung, erzeugnis ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_journal_trg_charge();

-- 7. Abweichungen, Konsistenz, Abgleich, Eröffnung ────────────────────────────────────────────────────────────

-- Ist ↔ Journal-Saldo je Charge (Liter offen) und Füllung (Stück); Ist wie die Bestandsmeldung: Charge nur aktiv, nicht
-- abgeschlossen, nicht storniert; Füllung nur aktiv und nicht storniert. Auch Posten, die es nur noch im Journal gibt.
CREATE OR REPLACE FUNCTION public.s112_journal_abweichungen(p_tenant_id uuid)
 RETURNS TABLE (art text, id uuid, bezeichnung text, ist numeric, journal numeric, differenz numeric, einheit text,
                letzte_aenderung timestamptz, stamm_geaendert timestamptz)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH j AS (
    SELECT k.bestand, CASE WHEN k.bestand = 'offen' THEN k.weinausbau_id ELSE k.fuellung_id END AS pid,
           sum(k.menge_liter) AS liter, sum(k.menge_stk) AS stk, max(k.erstellt_am) AS zuletzt,
           (array_agg(coalesce(k.charge_name, k.fuellung_name) ORDER BY k.erstellt_am DESC))[1] AS name
      FROM public.kellerbuch_buchungen k
     WHERE k.tenant_id = p_tenant_id
     GROUP BY 1, 2
  ), c AS (
    SELECT w.id, w.name, w.updated_at,
           CASE WHEN w.aktiv AND coalesce(w.status, '') <> 'abgeschlossen' AND w.storniert_am IS NULL THEN coalesce(w.menge_liter, 0) ELSE 0 END AS ist
      FROM public.weinausbau w WHERE w.tenant_id = p_tenant_id
  ), f AS (
    SELECT x.id, x.name, x.aktualisiert_am,
           CASE WHEN x.aktiv AND x.storniert_am IS NULL THEN coalesce(x.bestand_flaschen, 0) ELSE 0 END AS ist
      FROM public.fuellungen x WHERE x.tenant_id = p_tenant_id
  )
  SELECT 'charge', coalesce(c.id, j.pid), coalesce(c.name, j.name), coalesce(c.ist, 0), coalesce(j.liter, 0),
         coalesce(c.ist, 0) - coalesce(j.liter, 0), 'l', greatest(c.updated_at, j.zuletzt), c.updated_at
    FROM c FULL JOIN (SELECT * FROM j WHERE j.bestand = 'offen') j ON j.pid = c.id
   WHERE abs(coalesce(c.ist, 0) - coalesce(j.liter, 0)) >= 0.005
  UNION ALL
  SELECT 'fuellung', coalesce(f.id, j.pid), coalesce(f.name, j.name), coalesce(f.ist, 0), coalesce(j.stk, 0),
         coalesce(f.ist, 0) - coalesce(j.stk, 0), 'Stk', greatest(f.aktualisiert_am, j.zuletzt), f.aktualisiert_am
    FROM f FULL JOIN (SELECT * FROM j WHERE j.bestand = 'flasche') j ON j.pid = f.id
   WHERE coalesce(f.ist, 0) <> coalesce(j.stk, 0)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_abweichungen(uuid) FROM PUBLIC, anon, authenticated;

-- Prüffunktion: nur Abweichungen (leer = konsistent bzw. Journal aus)
CREATE OR REPLACE FUNCTION public.journal_konsistenz(p_tenant_id uuid)
 RETURNS TABLE (art text, id uuid, bezeichnung text, ist numeric, journal numeric, differenz numeric, einheit text,
                letzte_aenderung timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);
  IF public.s112_journal_ab(p_tenant_id) IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT a.art, a.id, a.bezeichnung, a.ist, a.journal, a.differenz, a.einheit, a.letzte_aenderung
      FROM public.s112_journal_abweichungen(p_tenant_id) a
     ORDER BY a.art, a.bezeichnung, a.id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.journal_konsistenz(uuid) FROM PUBLIC, anon;

-- Abgleich: Korrekturbuchung INV_PLUS/INV_MIN je Abweichung, deren letzte Änderung (Stammzeile bzw. Journal) älter als
-- p_mindestalter ist (Bewegungen der App kommen in getrennten Requests – vorher nicht korrigieren). Datum = Tag der
-- letzten Änderung der Charge/Füllung (Wien), frühestens Journalbeginn.
CREATE OR REPLACE FUNCTION public.journal_abgleichen(p_tenant_id uuid, p_mindestalter interval DEFAULT '00:15:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ab    date;
  r       record;
  v_n     integer := 0;
  v_beleg integer;
  v_ml    integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'kellerbuch', 'warenwirtschaft');   -- Bestände: Kellerbuch oder Warenwirtschaft
  v_ab := public.s112_journal_ab(p_tenant_id);
  IF v_ab IS NULL THEN
    RETURN 0;
  END IF;
  IF p_mindestalter IS NULL OR p_mindestalter < interval '0' THEN
    RAISE EXCEPTION 'Mindestalter ungültig.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_journal:' || p_tenant_id::text, 0));
  FOR r IN SELECT * FROM public.s112_journal_abweichungen(p_tenant_id) a
            WHERE a.letzte_aenderung IS NULL OR a.letzte_aenderung <= now() - p_mindestalter
            ORDER BY a.art, a.bezeichnung, a.id LOOP
    v_beleg := public.s112_journal_beleg(p_tenant_id, NULL);
    IF r.art = 'charge' THEN
      PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg,
        greatest(coalesce((r.stamm_geaendert AT TIME ZONE 'Europe/Vienna')::date, (now() AT TIME ZONE 'Europe/Vienna')::date), v_ab),
        jsonb_build_object('code', CASE WHEN r.differenz > 0 THEN 'INV_PLUS' ELSE 'INV_MIN' END, 'bestand', 'offen', 'weinausbau_id', r.id,
                           'liter', r.differenz),
        'weinausbau_bestand', r.id, r.id, false, 'Bestandskorrektur ohne Bewegung (Abgleich Ist ↔ Journal)');
    ELSE
      SELECT f.flaschengroesse_ml INTO v_ml FROM public.fuellungen f WHERE f.id = r.id AND f.tenant_id = p_tenant_id;
      PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg,
        greatest(coalesce((r.stamm_geaendert AT TIME ZONE 'Europe/Vienna')::date, (now() AT TIME ZONE 'Europe/Vienna')::date), v_ab),
        jsonb_build_object('code', CASE WHEN r.differenz > 0 THEN 'INV_PLUS' ELSE 'INV_MIN' END, 'bestand', 'flasche', 'fuellung_id', r.id,
                           'stk', r.differenz::integer, 'liter', round(r.differenz * coalesce(NULLIF(v_ml, 0), 750) / 1000.0, 3)),
        'fuellungen_bestand', r.id, r.id, false, 'Bestandskorrektur ohne Bewegung (Abgleich Ist ↔ Journal)');
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.journal_abgleichen(uuid, interval) FROM PUBLIC, anon;

-- Eröffnung: journal_ab setzen und den Ist-Bestand je Charge/Füllung als EROEFF (rekonstruiert) buchen – einmalig
CREATE OR REPLACE FUNCTION public.journal_eroeffnen(p_tenant_id uuid, p_stichtag date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ab    date;
  v_beleg integer;
  r       record;
  v_nc    integer := 0;
  v_nf    integer := 0;
  v_l     numeric := 0;
  v_stk   bigint := 0;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF p_stichtag IS NULL OR p_stichtag > (now() AT TIME ZONE 'Europe/Vienna')::date THEN
    RAISE EXCEPTION 'Bitte einen Stichtag bis heute angeben – eröffnet wird mit dem aktuellen Ist-Bestand.' USING ERRCODE = '22023';
  END IF;
  SELECT e.journal_ab INTO v_ab FROM public.tenant_einstellungen e WHERE e.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Betrieb nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_journal:' || p_tenant_id::text, 0));
  IF v_ab IS NOT NULL OR EXISTS (SELECT 1 FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Das Bewegungsjournal ist bereits eröffnet (ab %).', coalesce(to_char(v_ab, 'DD.MM.YYYY'), '–') USING ERRCODE = '55000';
  END IF;

  UPDATE public.tenant_einstellungen SET journal_ab = p_stichtag WHERE tenant_id = p_tenant_id;
  v_beleg := public.s112_journal_beleg(p_tenant_id, NULL);
  FOR r IN SELECT w.id, w.menge_liter FROM public.weinausbau w
            WHERE w.tenant_id = p_tenant_id AND w.aktiv AND coalesce(w.status, '') <> 'abgeschlossen' AND w.storniert_am IS NULL
              AND coalesce(w.menge_liter, 0) > 0
            ORDER BY w.name, w.id LOOP
    PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, p_stichtag,
      jsonb_build_object('code', 'EROEFF', 'bestand', 'offen', 'weinausbau_id', r.id, 'liter', r.menge_liter),
      'journal_eroeffnen', r.id, NULL, true, 'Eröffnung des Journals: Ist-Bestand der Charge');
    v_nc := v_nc + 1;
    v_l := v_l + r.menge_liter;
  END LOOP;
  FOR r IN SELECT f.id, f.bestand_flaschen, f.flaschengroesse_ml FROM public.fuellungen f
            WHERE f.tenant_id = p_tenant_id AND f.aktiv AND f.storniert_am IS NULL AND coalesce(f.bestand_flaschen, 0) > 0
            ORDER BY f.name, f.id LOOP
    PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, p_stichtag,
      jsonb_build_object('code', 'EROEFF', 'bestand', 'flasche', 'fuellung_id', r.id, 'stk', r.bestand_flaschen,
                         'liter', round(r.bestand_flaschen * coalesce(NULLIF(r.flaschengroesse_ml, 0), 750) / 1000.0, 3)),
      'journal_eroeffnen', r.id, NULL, true, 'Eröffnung des Journals: Ist-Bestand der Füllung');
    v_nf := v_nf + 1;
    v_stk := v_stk + r.bestand_flaschen;
  END LOOP;
  RETURN jsonb_build_object('journal_ab', p_stichtag, 'beleg_nr', v_beleg, 'chargen', v_nc, 'liter', v_l, 'fuellungen', v_nf, 'flaschen', v_stk);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.journal_eroeffnen(uuid, date) FROM PUBLIC, anon;