-- verkaufsposten.aktualisiert_am (Trigger aus legacy_nachtrag_025_050_052): ein im UPDATE
-- ausdrücklich gesetzter Zeitstempel bleibt erhalten, sonst Zeitpunkt der Änderung.
-- Anlass: demo_musterhof_verkauf legt Demo-Verkäufe rückdatiert an; das anschließende
-- Zahlungs-Sync und das bezahlt_am-Update hätten aktualisiert_am sonst beim Demo-Reset
-- auf den Reset-Zeitpunkt gesetzt. Eigene Funktion, damit update_aktualisiert_am()
-- (kellerplaene, kellerplan_positionen) unverändert bleibt.

CREATE OR REPLACE FUNCTION public.verkaufsposten_aktualisiert_am()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.aktualisiert_am IS NOT DISTINCT FROM OLD.aktualisiert_am THEN
    NEW.aktualisiert_am := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verkaufsposten_aktualisiert_am() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS verkaufsposten_updated_at ON public.verkaufsposten;
CREATE TRIGGER verkaufsposten_updated_at
  BEFORE UPDATE ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.verkaufsposten_aktualisiert_am();

-- demo_musterhof_verkauf: unverändert bis auf den letzten Block (Zeitstempel zurücksetzen)
CREATE OR REPLACE FUNCTION public.demo_musterhof_verkauf(p_id uuid, p_nr integer, p_datum date, p_kontakt uuid, p_firma uuid, p_pos jsonb, p_zahlung jsonb, p_storno boolean, p_notiz text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  c_t uuid := '33333333-3333-4333-8333-333333333333';
  v_re text := 'RE-' || lpad(p_nr::text, 4, '0');
  v_tx text; v_p jsonb; v_f record; v_w record; v_s record; v_n integer := 0;
  v_name text; v_menge numeric; v_preis numeric; v_ust numeric; v_rab numeric; v_typ text; v_fid uuid; v_wid uuid; v_einheit text;
  v_summe numeric; v_zdatum date; v_konto uuid; v_kat uuid; v_grp record;
begin
  if p_datum > current_date then return; end if;
  v_tx := demo_musterhof_txnr('verkauf', extract(year from p_datum)::int);
  insert into verkaufsposten (id, tenant_id, datum, rechnungsnummer, transaktions_nr, kontakt_id, firma_id, notizen, storniert, storniert_am,
    erstellt_am, aktualisiert_am, updated_at)
  values (p_id, c_t, p_datum, v_re, v_tx, p_kontakt, p_firma, p_notiz, p_storno,
    case when p_storno then (p_datum + 2)::timestamptz end, p_datum::timestamptz, p_datum::timestamptz, p_datum::timestamptz);

  for v_p in select * from jsonb_array_elements(p_pos) loop
    v_typ := v_p->>'t'; v_fid := null; v_wid := null; v_einheit := 'Stk';
    v_menge := (v_p->>'m')::numeric; v_rab := coalesce((v_p->>'r')::numeric, 0);
    if v_typ = 'f' then
      select * into v_f from fuellungen where id = demo_musterhof_id(19, (v_p->>'f')::int) and tenant_id = c_t;
      if v_f.id is null or v_f.datum > p_datum then continue; end if;
      if not p_storno and v_f.bestand_flaschen < v_menge then continue; end if;
      v_typ := 'flasche'; v_fid := v_f.id;
      v_name := v_f.name || ' ' || coalesce(v_f.jahrgang::text, '') || ' (' || v_f.flaschengroesse_ml || ' ml)';
      v_preis := coalesce((v_p->>'p')::numeric, v_f.vk_preis_brutto); v_ust := coalesce((v_p->>'u')::numeric, 13);
    elsif v_typ = 'w' then
      select * into v_w from weinausbau where id = (v_p->>'w')::uuid and tenant_id = c_t;
      if v_w.id is null or v_w.created_at::date > p_datum then continue; end if;
      if not p_storno and coalesce(v_w.menge_liter, 0) < v_menge then continue; end if;
      v_typ := 'tank'; v_wid := v_w.id; v_einheit := 'l';
      v_name := 'Tankwein ' || v_w.name || ' ' || coalesce(v_w.jahrgang::text, '');
      v_preis := (v_p->>'p')::numeric; v_ust := coalesce((v_p->>'u')::numeric, 13);
    else
      select * into v_s from sonstige_artikel where id = demo_musterhof_id(20, (v_p->>'s')::int) and tenant_id = c_t;
      if v_s.id is null then continue; end if;
      v_typ := 'sonstiges'; v_name := v_s.name; v_einheit := v_s.einheit;
      v_preis := coalesce((v_p->>'p')::numeric, v_s.default_preis); v_ust := coalesce((v_p->>'u')::numeric, 20);
    end if;

    insert into verkauf_positionen (tenant_id, verkaufsposten_id, typ, fuellung_id, weinausbau_id, name, menge, einheit, preis_brutto, ust_satz, rabatt_pct, sonderrabatt_pct, erstellt_am)
    values (c_t, p_id, v_typ, v_fid, v_wid, v_name, v_menge, v_einheit, v_preis, v_ust, v_rab, 0, p_datum::timestamptz);
    v_n := v_n + 1;

    if not p_storno then
      if v_fid is not null then
        update fuellungen set bestand_flaschen = greatest(0, bestand_flaschen - round(v_menge)::int), aktualisiert_am = p_datum::timestamptz
        where id = v_fid and tenant_id = c_t;
      elsif v_wid is not null then
        update weinausbau set menge_liter = greatest(0, coalesce(menge_liter, 0) - v_menge) where id = v_wid and tenant_id = c_t;
      end if;
    end if;
  end loop;

  if v_n = 0 then
    delete from verkaufsposten where id = p_id and tenant_id = c_t;
    return;
  end if;

  select coalesce(sum(round(menge * coalesce(preis_brutto, 0) * (1 - coalesce(rabatt_pct, 0) / 100), 2)), 0) into v_summe
  from verkauf_positionen where verkaufsposten_id = p_id and tenant_id = c_t;

  insert into aktivitaeten (tenant_id, kontakt_id, firma_id, art, betreff, beschreibung, datum, erledigt, erstellt_am)
  values (c_t, p_kontakt, p_firma, 'verkauf',
    'Verkauf ' || v_re || case when p_storno then ' · STORNIERT' else ' · ' || replace(to_char(v_summe, 'FM9999990.00'), '.', ',') || ' €' end,
    'Verkaufsposten: ' || p_id, p_datum, true, p_datum::timestamptz);

  if p_kontakt is not null then update kontakte set is_lead = false where id = p_kontakt and tenant_id = c_t and is_lead = true; end if;
  if p_firma   is not null then update firmen   set is_lead = false where id = p_firma   and tenant_id = c_t and is_lead = true; end if;

  if p_zahlung is not null and not p_storno then
    v_zdatum := least(current_date, p_datum + coalesce((p_zahlung->>'tage')::int, 0));
    v_konto := (p_zahlung->>'konto')::uuid;
    insert into zahlungen (tenant_id, verkaufsposten_id, betrag, art, datum, konto_id, abgeglichen, erstellt_am)
    values (c_t, p_id, v_summe, (p_zahlung->>'art')::zahlungsart, v_zdatum, v_konto, true, v_zdatum::timestamptz);
    update verkaufsposten set bezahlt_am = v_zdatum::timestamptz where id = p_id and tenant_id = c_t;
    for v_grp in
      select ust_satz, sum(menge * coalesce(preis_brutto, 0) * (1 - coalesce(rabatt_pct, 0) / 100)) as brutto
      from verkauf_positionen where verkaufsposten_id = p_id and tenant_id = c_t and preis_brutto is not null group by ust_satz
    loop
      if round(v_grp.brutto / (1 + v_grp.ust_satz / 100), 2) <= 0 then continue; end if;
      v_kat := case when v_grp.ust_satz = 0 then demo_musterhof_kat('Weinverkauf Export') else demo_musterhof_kat('Weinverkauf Ab Hof (13 %)') end;
      insert into ea_transaktionen (tenant_id, typ, datum, beschreibung, kategorie_id, betrag_netto, ust_satz, import_quelle, verkaufsposten_id,
        konto_id, firma_id, abgeglichen, notizen, erstellt_am, aktualisiert_am)
      values (c_t, 'einnahme', v_zdatum, 'Zahlungseingang RE ' || v_re, v_kat, round(v_grp.brutto / (1 + v_grp.ust_satz / 100), 2), v_grp.ust_satz,
        'verkauf', p_id, v_konto, p_firma, true, 'Automatisch erzeugt aus Zahlungseingang (Verkauf)', v_zdatum::timestamptz, v_zdatum::timestamptz);
    end loop;
  end if;
  -- Rückdatierten Änderungszeitpunkt wiederherstellen: Zahlungs-Sync und bezahlt_am-Update
  -- oben lösen den Trigger verkaufsposten_updated_at aus (24.09.2026)
  update verkaufsposten set aktualisiert_am = p_datum::timestamptz
  where id = p_id and tenant_id = c_t and aktualisiert_am is distinct from p_datum::timestamptz;
end $function$;
