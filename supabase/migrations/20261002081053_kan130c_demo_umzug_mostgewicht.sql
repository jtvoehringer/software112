-- KAN-130 Etappe 3 (02.10.2026, Entscheidung 4 Jörgen 01.10.2026): demo_musterhof_umzug rechnet das Mostgewicht wie
-- die App (umziehen(), lib/kellerbuch/mostgewichtKette.ts): Zusammenführung = mengengewichteter Mittelwert in °KMW
-- (Liter über die Dichte 1 + °Oe/1000 in kg, auf 2 Stellen abgerundet), statt den Wert des Ziels zu behalten; neue
-- Charge aus einer bzw. gleichen Quellen = Messwert samt Einheit (vorher nur kmw – eine °Oe-Messung wurde zu kmw),
-- sonst Mittelwert. Die Zielzeile einer Zusammenführung bekommt die Momentaufnahme kmw/oechsle/mostgewicht_einheit
-- _vorher/_nachher (Storno). Quellen ohne Mostgewicht zählen nicht. Sonst unverändert.

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
  -- KAN-130 Etappe 3: Mostgewicht der Quellen (Masse = Liter × (1 + °Oe/1000), °Oe nach der Formel ungerundet)
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
      v_f := p_brutto[v_i] * (1 + v_von.kmw * (4.54 + 0.022 * v_von.kmw) / 1000);
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
      v_f := coalesce(v_a_menge, 0) * (1 + v_a_kmw * (4.54 + 0.022 * v_a_kmw) / 1000);
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
REVOKE EXECUTE ON FUNCTION public.demo_musterhof_umzug(uuid[], numeric[], uuid, numeric, date, uuid, text, text, text) FROM PUBLIC, anon, authenticated;