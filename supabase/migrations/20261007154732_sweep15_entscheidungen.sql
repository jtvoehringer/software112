-- Sweep 15 (07.10.2026): Entscheidungen Jörgen vom 07.10.2026 (Kommentare an den Tickets).
--  A. KAN-223: Betriebsmittel-Einkauf mit E/A-Ausgabe auch für Doppik-Betriebe (Belege & BMD-Übergabe) – Bedingung nur
--     noch „Modul E&A aktiv“ statt „E&A und Buchhaltungsart ea“. Ohne Modul bleibt die Sperre (dazu s112_pruefe_paketmodul).
--  B. KAN-205: Lese in die Kellerbuch-Periodensperre („ganz gesperrt“): Lese-Zeilen (ernte_parzellen samt Mostgewicht),
--     Traubenzeilen der Pressung (pressung_weingaerten) und Traubenverkauf. Storno bleibt (storniert_am zählt nicht).
--     s112_kellerbuch_periodensperre bekommt die Datumsquelle 'eigen:<spalte>[:<elterntabelle>:<fk>]' (ernte_parzellen hat
--     kein tenant_id – Betrieb über weinjahrgaenge).
--  C. KAN-130: demo_musterhof_umzug mischt das Mostgewicht litergewichtet wie die App (Kellerkette: Umzug, Verschnitt,
--     Zusammenführen); Lese/Pressung bleiben kg-gewichtet.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Tests 22, 24, 63, dann Produktion.

-- A. KAN-223 ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_betriebsmittel_einkauf(p_tenant_id uuid, p_betriebsmittel_id uuid, p_datum date, p_menge numeric, p_einheit text, p_betrag_netto numeric, p_ust_satz numeric, p_lieferant_firma_id uuid, p_ea_kategorie_id uuid, p_notizen text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mittel record;
  v_kat    record;
  v_grund  text;
  v_ea     uuid;
  v_id     uuid;
  v_einh   constant jsonb := '{"kg": "kg", "g": "g", "l": "l", "ml": "ml", "stk": "Stk", "m": "m"}';
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');   -- KAN-195
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'rieden');
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
  -- KAN-223 (Entscheidung Jörgen 07.10.2026): auch Doppik-Betriebe (Belege & BMD-Übergabe) buchen die Ausgabe
  IF NOT EXISTS (SELECT 1 FROM public.tenant_einstellungen te
                  WHERE te.tenant_id = p_tenant_id AND te.modul_ea) THEN
    RAISE EXCEPTION 'Einkäufe mit Ausgabe gibt es nur mit aktivem Modul E&A bzw. Belege – bitte Anfangsbestand bzw. Inventurkorrektur verwenden.'
      USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.name, b.aktiv INTO v_mittel FROM public.betriebsmittel b
   WHERE b.id = p_betriebsmittel_id AND b.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Betriebsmittel nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_mittel.aktiv THEN
    RAISE EXCEPTION 'Das Betriebsmittel „%“ ist deaktiviert.', v_mittel.name USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL OR p_menge IS NULL OR p_menge <= 0 OR p_betrag_netto IS NULL OR p_betrag_netto < 0 THEN
    RAISE EXCEPTION 'Bitte Datum, Menge (> 0) und Netto-Betrag angeben.' USING ERRCODE = '22023';
  END IF;
  IF p_einheit IS NULL OR NOT (v_einh ? p_einheit) THEN
    RAISE EXCEPTION 'Unbekannte Einheit „%“.', coalesce(p_einheit, '–') USING ERRCODE = '22023';
  END IF;
  IF p_ust_satz IS NULL OR p_ust_satz NOT IN (0, 10, 13, 20) THEN
    RAISE EXCEPTION 'Bitte einen USt-Satz (0, 10, 13 oder 20 %%) wählen.' USING ERRCODE = '22023';
  END IF;
  IF p_lieferant_firma_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.firmen f WHERE f.id = p_lieferant_firma_id AND f.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Lieferant nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  SELECT k.id, k.typ, k.abzugsfaehig_pct INTO v_kat FROM public.ea_kategorien k
   WHERE k.id = p_ea_kategorie_id AND (k.tenant_id IS NULL OR k.tenant_id = p_tenant_id) AND k.aktiv;
  IF NOT FOUND OR v_kat.typ <> 'ausgabe' THEN
    RAISE EXCEPTION 'Bitte eine Ausgaben-Kategorie der E&A-Rechnung wählen.' USING ERRCODE = '22023';
  END IF;
  v_grund := public.s112_ea_zeitraum_sperrgrund(p_tenant_id, p_datum);
  IF v_grund IS NOT NULL THEN
    RAISE EXCEPTION '%', v_grund USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.ea_transaktionen (tenant_id, typ, datum, beschreibung, kategorie_id, betrag_netto, ust_satz, firma_id,
                                       abzugsfaehig_pct, import_quelle, notizen)
  VALUES (p_tenant_id, 'ausgabe', p_datum,
          format('Einkauf %s (%s %s)', v_mittel.name, trim(to_char(p_menge, 'FM999999990.###')), v_einh ->> p_einheit),
          p_ea_kategorie_id, round(p_betrag_netto, 2), p_ust_satz, p_lieferant_firma_id,
          coalesce(v_kat.abzugsfaehig_pct, 100), 'betriebsmittel', NULLIF(btrim(p_notizen), ''))
  RETURNING id INTO v_ea;

  INSERT INTO public.betriebsmittel_lager_bewegungen (tenant_id, betriebsmittel_id, datum, typ, menge, einheit, betrag_netto,
                                                      ust_satz, lieferant_firma_id, ea_transaktion_id, notizen)
  VALUES (p_tenant_id, p_betriebsmittel_id, p_datum, 'einkauf', p_menge, p_einheit, round(p_betrag_netto, 2), p_ust_satz,
          p_lieferant_firma_id, v_ea, NULLIF(btrim(p_notizen), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- B. KAN-205: Funktion ──────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_kellerbuch_periodensperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quelle  text[] := string_to_array(coalesce(TG_ARGV[0], 'datum'), ':');
  v_spalten text[] := string_to_array(coalesce(TG_ARGV[1], ''), ',');
  v_alt     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_neu     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_z       jsonb := coalesce(v_neu, v_alt);
  v_tenant  uuid;
  v_bis     date;
  v_d_alt   date;
  v_d_neu   date;
  v_k       text;
  v_geaendert boolean := false;
  v_kopf    record;
BEGIN
  -- Mandant und Datum (Kindtabellen über den Kopf)
  IF v_quelle[1] = 'kopf' THEN
    EXECUTE format('SELECT tenant_id, datum::date AS datum FROM public.%I WHERE id = $1', v_quelle[2])
      INTO v_kopf USING (v_z ->> v_quelle[3])::uuid;
    v_tenant := v_kopf.tenant_id;
    v_d_neu := v_kopf.datum;
    v_d_alt := v_kopf.datum;
    IF TG_OP = 'UPDATE' AND (v_alt ->> v_quelle[3]) IS DISTINCT FROM (v_neu ->> v_quelle[3]) THEN
      EXECUTE format('SELECT datum::date FROM public.%I WHERE id = $1', v_quelle[2]) INTO v_d_alt USING (v_alt ->> v_quelle[3])::uuid;
    END IF;
  ELSIF v_quelle[1] = 'eigen' THEN
    -- KAN-205: eigene Datumsspalte ('eigen:<spalte>'), Mandant über eine Elterntabelle ('eigen:<spalte>:<tabelle>:<fk>')
    v_d_alt := (v_alt ->> v_quelle[2])::date;
    v_d_neu := (v_neu ->> v_quelle[2])::date;
    IF array_length(v_quelle, 1) >= 4 THEN
      EXECUTE format('SELECT tenant_id FROM public.%I WHERE id = $1', v_quelle[3]) INTO v_tenant USING (v_z ->> v_quelle[4])::uuid;
    ELSE
      v_tenant := (v_z ->> 'tenant_id')::uuid;
    END IF;
  ELSE
    v_tenant := (v_z ->> 'tenant_id')::uuid;
    v_d_alt := (v_alt ->> 'datum')::date;
    v_d_neu := (v_neu ->> 'datum')::date;
  END IF;
  IF v_tenant IS NULL OR coalesce(public.s112_wartung_frei(v_tenant), false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(v_tenant);
  IF v_bis IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Verkäufe: nur Tank-/Flaschenpositionen bzw. Köpfe mit solchen Positionen
  IF TG_TABLE_NAME = 'verkauf_positionen'
     AND coalesce(v_alt ->> 'typ', '') NOT IN ('tank', 'flasche') AND coalesce(v_neu ->> 'typ', '') NOT IN ('tank', 'flasche') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'verkaufsposten' AND NOT EXISTS (
       SELECT 1 FROM public.verkauf_positionen p WHERE p.verkaufsposten_id = (v_z ->> 'id')::uuid AND p.typ IN ('tank', 'flasche')) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_d_neu IS NOT NULL AND v_d_neu <= v_bis THEN
      RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – eine Bewegung vom % ist nicht mehr möglich. Bitte ein Datum nach dem Abschluss wählen.',
        to_char(v_bis, 'DD.MM.YYYY'), to_char(v_d_neu, 'DD.MM.YYYY') USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF v_d_alt IS NOT NULL AND v_d_alt <= v_bis THEN
      RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – die Bewegung vom % lässt sich nicht löschen, nur stornieren.',
        to_char(v_bis, 'DD.MM.YYYY'), to_char(v_d_alt, 'DD.MM.YYYY') USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  FOREACH v_k IN ARRAY v_spalten LOOP
    IF (v_alt -> v_k) IS DISTINCT FROM (v_neu -> v_k) THEN
      v_geaendert := true;
    END IF;
  END LOOP;
  IF v_geaendert AND ((v_d_alt IS NOT NULL AND v_d_alt <= v_bis) OR (v_d_neu IS NOT NULL AND v_d_neu <= v_bis)) THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – Bewegungen in diesem Zeitraum lassen sich nicht ändern (Datum %). Berichtigungen bitte stornieren und neu buchen.',
      to_char(v_bis, 'DD.MM.YYYY'), to_char(CASE WHEN v_d_alt <= v_bis THEN v_d_alt ELSE v_d_neu END, 'DD.MM.YYYY') USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- B. KAN-205: Trigger ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.ernte_parzellen FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('eigen:ernte_datum:weinjahrgaenge:jahrgang_id',
    'ernte_datum,menge_kg,menge_hl,weingarten_id,grundstueck_id,rebsorte_id,qualitaetsstufe,herkunft_code,lese_id,jahrgang_id,klosterneuburger,oechsle,mostgewicht_einheit');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.pressung_weingaerten FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('kopf:pressungen:pressung_id',
    'trauben_kg,weingarten_id,grundstueck_id,rebsorte,ernte_datum,kmw,oechsle,mostgewicht_einheit,zukauf_posten_id,pressung_id');
CREATE TRIGGER a_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.traubenverkauf FOR EACH ROW
  EXECUTE FUNCTION public.s112_kellerbuch_periodensperre('datum',
    'datum,menge_kg,weingarten_id,grundstueck_id,jahrgang_id,lese_id,kmw_grad,oechsle,mostgewicht_einheit,qualitaetsstufe,herkunft_code,zukauf_posten_id');

-- C. KAN-130 ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.demo_musterhof_umzug(p_von uuid[], p_brutto numeric[], p_nach_beh uuid, p_netto numeric, p_datum date, p_neu_id uuid, p_name text, p_typ text, p_notiz text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  c_t uuid := '33333333-3333-4333-8333-333333333333';
  v_batch uuid := gen_random_uuid();
  v_tx text; v_i integer; v_von record; v_rest numeric; v_schwund numeric;
  v_ziel uuid; v_erste record; v_qual text;
  -- KAN-130 (Entscheidung Jörgen 07.10.2026): Mostgewicht der Quellen litergewichtet (v_masse = Summe der Liter)
  v_masse numeric := 0; v_zucker numeric := 0; v_mit integer := 0; v_gleich boolean := true;
  v_e_kmw numeric; v_e_oe numeric; v_e_einh text; v_f numeric; v_kmw numeric;
  v_merge boolean := false; v_a_menge numeric; v_a_kmw numeric; v_a_oe numeric; v_a_einh text;
  v_z_masse numeric; v_z_zucker numeric;
begin
  if p_datum > current_date then return null; end if;
  v_tx := demo_musterhof_txnr('umzug', extract(year from p_datum)::int);
  v_schwund := greatest(0, (select sum(x) from unnest(p_brutto) x) - p_netto);

  for v_i in 1 .. array_length(p_von, 1) loop
    select * into v_von from weinausbau where id = p_von[v_i] and tenant_id = c_t;
    if v_von.id is null then raise exception 'Demo: Quell-Charge % fehlt', p_von[v_i]; end if;
    if p_brutto[v_i] > coalesce(v_von.menge_liter, 0) + 0.01 then
      raise exception 'Demo: Umzug % l übersteigt Bestand % l (%)', p_brutto[v_i], v_von.menge_liter, v_von.name;
    end if;
    if v_i = 1 then v_erste := v_von; end if;
    if v_von.kmw is not null then
      v_f := p_brutto[v_i];
      v_masse := v_masse + v_f; v_zucker := v_zucker + v_f * v_von.kmw; v_mit := v_mit + 1;
      if v_mit = 1 then
        v_e_kmw := v_von.kmw; v_e_oe := v_von.oechsle; v_e_einh := v_von.mostgewicht_einheit;
      elsif v_e_kmw is distinct from v_von.kmw or v_e_oe is distinct from v_von.oechsle
         or v_e_einh is distinct from v_von.mostgewicht_einheit then
        v_gleich := false;
      end if;
    end if;
    v_qual := case when v_i = 1 then v_von.qualitaetsstufe else v_qual end;
    v_rest := greatest(0, coalesce(v_von.menge_liter, 0) - p_brutto[v_i]);
    if v_rest <= 0.01 then
      update weinausbau set menge_liter = 0, aktiv = false, status = 'abgeschlossen' where id = v_von.id and tenant_id = c_t;
    else
      update weinausbau set menge_liter = v_rest where id = v_von.id and tenant_id = c_t;
    end if;
    insert into keller_umzuege (tenant_id, datum, von_behaelter_id, von_weinausbau_id, brutto_liter, menge_liter, schwund_liter,
      umzug_typ, qualitaet_vorher, qualitaet_nachher, herkunft_code_vorher, herkunft_code_nachher, verschnitt, notizen,
      umzug_batch_id, zeilen_typ, transaktions_nr, erstellt_am)
    values (c_t, p_datum, v_von.behaelter_id, v_von.id, p_brutto[v_i], p_brutto[v_i], case when v_i = 1 then v_schwund else 0 end,
      p_typ, v_von.qualitaetsstufe, v_von.qualitaetsstufe, v_von.herkunft_code, v_von.herkunft_code, false,
      case when v_i = 1 then p_notiz end, v_batch, 'quelle', case when v_i = 1 then v_tx end, p_datum::timestamptz);
  end loop;

  select id into v_ziel from weinausbau
  where tenant_id = c_t and behaelter_id = p_nach_beh and aktiv = true and status <> 'abgeschlossen'
    and rebsorte is not distinct from v_erste.rebsorte
  order by menge_liter desc limit 1;

  if v_ziel is not null then
    -- KAN-130 Etappe 3: Zusammenführung – gewichteter Mittelwert aus Ziel und Zugang (Zugang im Verhältnis der
    -- Quellen), °KMW auf 2 Stellen abgerundet; Charge bleibt unverändert, wenn sich °KMW nicht ändert
    v_merge := true;
    select menge_liter, kmw, oechsle, mostgewicht_einheit into v_a_menge, v_a_kmw, v_a_oe, v_a_einh
      from weinausbau where id = v_ziel and tenant_id = c_t;
    v_z_masse := 0; v_z_zucker := 0;
    if v_a_kmw is not null then
      v_f := coalesce(v_a_menge, 0);
      v_z_masse := v_f; v_z_zucker := v_f * v_a_kmw;
    end if;
    if v_mit > 0 then
      v_f := coalesce(p_netto / nullif((select sum(x) from unnest(p_brutto) x), 0), 0);
      v_z_masse := v_z_masse + v_masse * v_f; v_z_zucker := v_z_zucker + v_zucker * v_f;
    end if;
    v_kmw := case when v_z_masse > 0 then floor(v_z_zucker / v_z_masse * 100 + 0.000000001) / 100 else v_a_kmw end;
    if v_kmw is distinct from v_a_kmw then
      update weinausbau set menge_liter = coalesce(menge_liter, 0) + p_netto, kmw = v_kmw, oechsle = null, mostgewicht_einheit = 'kmw'
       where id = v_ziel and tenant_id = c_t;
    else
      update weinausbau set menge_liter = coalesce(menge_liter, 0) + p_netto where id = v_ziel and tenant_id = c_t;
    end if;
  else
    v_ziel := coalesce(p_neu_id, gen_random_uuid());
    insert into weinausbau (id, tenant_id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, anfangsbestand_liter,
      qualitaetsstufe, status, notizen, aktiv, kmw, oechsle, mostgewicht_einheit, weinart, herkunft_code, created_at, updated_at)
    values (v_ziel, c_t, coalesce(p_name, v_erste.name), v_erste.jahrgang, v_erste.rebsorte, v_erste.weingarten_id, p_nach_beh, p_netto, null,
      v_erste.qualitaetsstufe, v_erste.status,
      case when array_length(p_von, 1) > 1 then 'Zusammengeführt aus ' || array_length(p_von, 1) || ' Chargen' else 'Umzug aus „' || v_erste.name || '"' end,
      true,
      -- KAN-130 Etappe 3: alle Quellen mit demselben Mostgewicht → Messwert samt Einheit, sonst Mittelwert in °KMW
      case when v_mit = 0 then null when v_gleich then v_e_kmw else floor(v_zucker / v_masse * 100 + 0.000000001) / 100 end,
      case when v_mit > 0 and v_gleich then v_e_oe end,
      case when v_mit > 0 and v_gleich then coalesce(v_e_einh, 'kmw') else 'kmw' end,
      v_erste.weinart, v_erste.herkunft_code, p_datum::timestamptz, p_datum::timestamptz);
    insert into weinausbau_weingaerten (tenant_id, weinausbau_id, weingarten_id)
    select distinct c_t, v_ziel, ww.weingarten_id from weinausbau_weingaerten ww where ww.weinausbau_id = any(p_von)
    on conflict (weinausbau_id, weingarten_id) do nothing;
  end if;

  insert into keller_umzuege (tenant_id, datum, nach_behaelter_id, nach_weinausbau_id, menge_liter, schwund_liter, brutto_liter,
    umzug_typ, notizen, umzug_batch_id, zeilen_typ, erstellt_am,
    kmw_vorher, oechsle_vorher, mostgewicht_einheit_vorher, kmw_nachher, oechsle_nachher, mostgewicht_einheit_nachher)
  select c_t, p_datum, p_nach_beh, v_ziel, p_netto, 0, null, p_typ, null, v_batch, 'ziel', p_datum::timestamptz,
    -- KAN-130 Etappe 3: Momentaufnahme nur bei einer Zusammenführung, wie umziehen()
    case when v_merge then v_a_kmw end, case when v_merge then v_a_oe end, case when v_merge then v_a_einh end,
    case when v_merge then w.kmw end, case when v_merge then w.oechsle end, case when v_merge then w.mostgewicht_einheit end
  from weinausbau w where w.id = v_ziel;
  return v_ziel;
end $function$;
