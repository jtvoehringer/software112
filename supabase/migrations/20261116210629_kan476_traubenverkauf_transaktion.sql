-- KAN-476: Traubenverkauf – Fehlermeldung, obwohl gespeichert (Befund BKI-Sitzung 16.11.2026, Musterhof)
--
-- Befund: „Speichern fehlgeschlagen (verkaufsposten) … rechnungen_nummer_eindeutig“, der Traubenverkauf stand trotzdem da.
--   1. demo_musterhof_zuruecksetzen() löscht die Verkäufe (und über z_rechnung_aufraeumen deren 1:1-Rechnungen), aber keine
--      eigenständigen Rechnungen (Sammelrechnung, Stornobeleg, Gutschrift). Der Rechnungszähler wird am Ende nur aus den
--      Verkäufen abgeleitet – die nächste Nummer gab es dann schon (RE-0029). Im Musterhof scheiterte jeder neue Verkauf.
--   2. Die App legte den Traubenverkauf an und erst danach Verkauf und Rechnung (zwei Aufrufe, keine Transaktion): Scheitert
--      der zweite Schritt, bleibt ein Traubenverkauf ohne Verkauf stehen (und die Liefernummer ist verbraucht).
--
-- Lösung:
--   1. Reset: Rechnungen des Musterhofs mit abräumen, Storno- und Gutschriftzähler zurücksetzen, Rechnungszähler aus dem
--      höchsten Wert von Verkäufen UND Rechnungen. Die Funktion wird aus ihrer aktuellen Definition neu erzeugt
--      (pg_get_functiondef, wie 20261114111232) – Rechte, Eigentümer und search_path bleiben. Produktion und Staging hatten
--      am 16.11.2026 identische Stände (md5 85815cee1a2f3f521293dbf78d719c54).
--   2. s112_traubenverkauf_anlegen: Liefernummer, Verkauf, Position und Traubenverkauf in EINER Transaktion – alles oder
--      nichts. SECURITY INVOKER: es gelten unverändert die Policies und Trigger der drei Tabellen (Schreibmodule,
--      Lesebereiche, Abo-Schreibsperre, Periodensperre, Fremdverweise).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- ── 1. Musterhof-Reset ──────────────────────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_oid oid := 'public.demo_musterhof_zuruecksetzen()'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  c_a1 constant text := E'  delete from verkaufsposten where tenant_id = c_t;\n';   -- storno-ausnahme: Textbaustein für den Demo-Reset des Musterhofs, kein Löschen in dieser Migration
  c_a2 constant text := E'  delete from verkaufsposten where tenant_id = c_t;\n'   -- storno-ausnahme: Textbaustein für den Demo-Reset des Musterhofs, kein Löschen in dieser Migration
    || E'  -- KAN-476: Sammelrechnungen, Stornobelege und Gutschriften hängen an keinem Verkauf und blieben bisher stehen\n'
    || E'  delete from rechnungen where tenant_id = c_t;  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus\n';
  c_b1 constant text := 'set rechnung_zaehler = 1, account_zaehler = 1,';
  c_b2 constant text := 'set rechnung_zaehler = 1, storno_zaehler = 1, gutschrift_zaehler = 1, account_zaehler = 1,';
  c_c1 constant text := 'set rechnung_zaehler = coalesce((select max(substring(rechnungsnummer from 4)::int) from verkaufsposten where tenant_id = c_t), 0) + 1,';
  c_c2 constant text := 'set rechnung_zaehler = greatest('
    || E'coalesce((select max(substring(rechnungsnummer from 4)::int) from verkaufsposten where tenant_id = c_t), 0),\n'
    || E'            -- KAN-476: auch Rechnungen ohne Verkauf zählen (die nächste Nummer darf es noch nicht geben)\n'
    || E'            coalesce((select max(substring(rechnungsnummer from 4)::int) from rechnungen where tenant_id = c_t and rechnungsnummer ~ ''^RE-[0-9]+$''), 0)) + 1,';
BEGIN
  IF position(c_a1 in v_def) = 0 OR position(c_b1 in v_def) = 0 OR position(c_c1 in v_def) = 0 THEN
    RAISE EXCEPTION 'KAN-476: demo_musterhof_zuruecksetzen hat nicht den erwarteten Stand – Migration anpassen';
  END IF;
  IF position('delete from rechnungen' in v_def) > 0 THEN   -- storno-ausnahme: Textbaustein für den Demo-Reset des Musterhofs, kein Löschen in dieser Migration
    RAISE EXCEPTION 'KAN-476: demo_musterhof_zuruecksetzen räumt die Rechnungen schon ab';
  END IF;
  v_def := replace(replace(replace(v_def, c_a1, c_a2), c_b1, c_b2), c_c1, c_c2);
  EXECUTE v_def;
END $mig$;

-- ── 2. Traubenverkauf samt Verkauf in einer Transaktion ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_traubenverkauf_anlegen(p_tenant_id uuid, p_daten jsonb, p_quelle text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_posten uuid := gen_random_uuid();
  v_id     uuid;
  v_ln     text;
  v_datum  date := nullif(p_daten ->> 'datum', '')::date;
  v_menge  numeric := nullif(p_daten ->> 'menge_kg', '')::numeric;
  v_preis  numeric := nullif(p_daten ->> 'preis_per_kg', '')::numeric;
  v_kontakt uuid := nullif(p_daten ->> 'kontakt_id', '')::uuid;
  v_firma   uuid := nullif(p_daten ->> 'firma_id', '')::uuid;
  v_quelle text := coalesce(nullif(btrim(p_quelle), ''), 'Trauben');
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  IF v_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte ein Datum für den Traubenverkauf angeben.' USING ERRCODE = '22023';
  END IF;
  IF v_menge IS NULL OR v_menge <= 0 THEN
    RAISE EXCEPTION 'Bitte eine Menge in kg größer als 0 angeben.' USING ERRCODE = '22023';
  END IF;

  -- Liefernummer in derselben Transaktion: scheitert ein Schritt, bleibt keine Lücke im Nummernkreis
  v_ln := public.get_next_liefernummer(p_tenant_id);

  -- Verkauf (Rechnungsnummer und Rechnung über die Trigger a_rechnungsnummer / b_rechnung_anlegen) und Position
  INSERT INTO public.verkaufsposten (id, tenant_id, datum, kontakt_id, firma_id, notizen)
  VALUES (v_posten, p_tenant_id, v_datum, v_kontakt, v_firma, 'Traubenverkauf – ' || v_quelle);

  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, rabatt_pct, sonderrabatt_pct)
  VALUES (p_tenant_id, v_posten, 'sonstiges', 'Weintrauben – ' || v_quelle, v_menge, 'kg', v_preis, 13, 0, 0);

  INSERT INTO public.traubenverkauf (tenant_id, jahrgang_id, lese_id, weingarten_id, zukauf_posten_id, grundstueck_id, kontakt_id, firma_id,
    datum, menge_kg, preis_per_kg, kmw_grad, oechsle, mostgewicht_einheit, qualitaetsstufe, gesundheit, herkunft_code, notizen,
    liefernummer, verkaufsposten_id)
  VALUES (p_tenant_id,
    nullif(p_daten ->> 'jahrgang_id', '')::uuid, nullif(p_daten ->> 'lese_id', '')::uuid,
    nullif(p_daten ->> 'weingarten_id', '')::uuid, nullif(p_daten ->> 'zukauf_posten_id', '')::uuid,
    nullif(p_daten ->> 'grundstueck_id', '')::uuid, v_kontakt, v_firma,
    v_datum, v_menge, v_preis,
    nullif(p_daten ->> 'kmw_grad', '')::numeric, nullif(p_daten ->> 'oechsle', '')::numeric,
    coalesce(nullif(p_daten ->> 'mostgewicht_einheit', ''), 'kmw'),
    nullif(p_daten ->> 'qualitaetsstufe', ''), coalesce(nullif(p_daten ->> 'gesundheit', ''), 'G'),
    nullif(p_daten ->> 'herkunft_code', ''), nullif(p_daten ->> 'notizen', ''),
    v_ln, v_posten)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'verkaufsposten_id', v_posten, 'liefernummer', v_ln);
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_traubenverkauf_anlegen(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_traubenverkauf_anlegen(uuid, jsonb, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.s112_traubenverkauf_anlegen(uuid, jsonb, text) IS
  'KAN-476: legt einen Traubenverkauf samt Liefernummer, Verkauf und Rechnungsposition in einer Transaktion an (SECURITY INVOKER – Policies und Trigger der Tabellen gelten).';

-- ── 3. Selbstprüfung ────────────────────────────────────────────────────────────────────────────────────────────────
DO $pruef$
DECLARE
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF position('delete from rechnungen where tenant_id = c_t;' in v_def) = 0   -- storno-ausnahme: Textbaustein für den Demo-Reset des Musterhofs, kein Löschen in dieser Migration
     OR position('storno_zaehler = 1, gutschrift_zaehler = 1' in v_def) = 0
     OR position('from rechnungen where tenant_id = c_t and rechnungsnummer ~' in v_def) = 0 THEN
    RAISE EXCEPTION 'KAN-476: Reset-Funktion nicht vollständig umgestellt';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.s112_traubenverkauf_anlegen(uuid, jsonb, text)'::regprocedure) THEN
    RAISE EXCEPTION 'KAN-476: s112_traubenverkauf_anlegen muss SECURITY INVOKER sein';
  END IF;
  IF has_function_privilege('anon', 'public.s112_traubenverkauf_anlegen(uuid, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-476: anon darf s112_traubenverkauf_anlegen nicht ausführen';
  END IF;
END $pruef$;
