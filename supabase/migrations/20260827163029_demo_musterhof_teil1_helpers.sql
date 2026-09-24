-- software:112 – Demo-Mandant „Weingut Musterhof (Demo)" – Teil 1: Mandant + Hilfsfunktionen
insert into public.tenants (id, name, slug, plan, active, bio_status)
values ('33333333-3333-4333-8333-333333333333', 'Weingut Musterhof (Demo)', 'demo-musterhof', 'pro', true, 'konventionell')
on conflict (id) do update
  set name = excluded.name, slug = excluded.slug, plan = excluded.plan, active = true, bio_status = excluded.bio_status;

insert into public.tenant_einstellungen (
  tenant_id, anzeigename, betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_email,
  betrieb_website, betrieb_uid, betrieb_betriebsnummer, rechnung_iban, rechnung_bic, rechnung_zahlungsziel,
  rechnung_fusstext, ust_satz_standard, modul_ea, modul_export, modul_weinexport, ea_uva_zeitraum,
  ea_betriebsbeginn, fristen_vorwarnung_tage, gaerung_messintervall_tage
) values (
  '33333333-3333-4333-8333-333333333333', 'Weingut Musterhof', 'Weingut Musterhof', 'Kellergasse 12', '3500', 'Krems an der Donau',
  '+43 2732 12345', 'office@musterhof.example', 'https://www.musterhof.example', 'ATU12345678', '1234567',
  'AT61 3200 0000 1234 5678', 'RLNWATWWKRE', 14,
  'Vielen Dank für Ihren Einkauf! Zahlbar innerhalb von 14 Tagen ohne Abzug.', 13, true, false, false, 'quartalsweise',
  make_date(extract(year from current_date)::int - 1, 1, 1), 30, 3
)
on conflict (tenant_id) do update set
  anzeigename = excluded.anzeigename, betrieb_name = excluded.betrieb_name, betrieb_strasse = excluded.betrieb_strasse,
  betrieb_plz = excluded.betrieb_plz, betrieb_ort = excluded.betrieb_ort, betrieb_telefon = excluded.betrieb_telefon,
  betrieb_email = excluded.betrieb_email, betrieb_website = excluded.betrieb_website, betrieb_uid = excluded.betrieb_uid,
  betrieb_betriebsnummer = excluded.betrieb_betriebsnummer, rechnung_iban = excluded.rechnung_iban, rechnung_bic = excluded.rechnung_bic,
  rechnung_zahlungsziel = excluded.rechnung_zahlungsziel, rechnung_fusstext = excluded.rechnung_fusstext,
  ust_satz_standard = excluded.ust_satz_standard, modul_ea = excluded.modul_ea, modul_export = excluded.modul_export,
  modul_weinexport = excluded.modul_weinexport, ea_uva_zeitraum = excluded.ea_uva_zeitraum,
  ea_betriebsbeginn = excluded.ea_betriebsbeginn, fristen_vorwarnung_tage = excluded.fristen_vorwarnung_tage,
  gaerung_messintervall_tage = excluded.gaerung_messintervall_tage;

insert into public.module_flags (tenant_id, module, aktiv)
select '33333333-3333-4333-8333-333333333333', m, true
from unnest(array['weingarten','kellerbuch','dac','pflanzenschutz','analysen','ernte','weinhandel','rechnungen','emcs','reports']) as m
on conflict (tenant_id, module) do update set aktiv = true;

create or replace function public.demo_musterhof_id(p_typ integer, p_nr integer)
returns uuid language sql immutable set search_path = public as $$
  select ('33333333-3333-4333-8333-' || lpad(to_hex(p_typ), 4, '0') || lpad(to_hex(p_nr), 8, '0'))::uuid
$$;

create or replace function public.demo_musterhof_txnr(p_typ text, p_jahr integer)
returns text language plpgsql set search_path = public as $$
declare
  c_t uuid := '33333333-3333-4333-8333-333333333333';
  v_prefix text; v_z integer; v_st integer;
begin
  v_prefix := case p_typ when 'umzug' then 'KU' when 'eroeffnung' then 'EB' when 'verkauf' then 'VK' when 'kosteneintrag' then 'KE' else 'TX' end;
  insert into transaktionszaehler (tenant_id, typ, prefix, zaehler, jahr, stellen)
  values (c_t, p_typ, v_prefix, 1, p_jahr, 4)
  on conflict (tenant_id, typ, jahr) do update set zaehler = transaktionszaehler.zaehler + 1
  returning prefix, zaehler, stellen into v_prefix, v_z, v_st;
  return v_prefix || '-' || p_jahr || '-' || lpad(v_z::text, v_st, '0');
end $$;

create or replace function public.demo_musterhof_kat(p_name text)
returns uuid language sql stable set search_path = public as $$
  select id from ea_kategorien
  where name = p_name and (tenant_id = '33333333-3333-4333-8333-333333333333' or tenant_id is null)
  order by tenant_id nulls last limit 1
$$;

create or replace function public.demo_musterhof_fuellen(
  p_fid uuid, p_wa uuid, p_datum date, p_name text, p_jahrgang integer, p_rebsorte text, p_qualitaet text,
  p_herkunft text, p_bezeichnung text, p_ml integer, p_anzahl integer, p_preis numeric, p_abschliessen boolean,
  p_pruefnummer text, p_dac uuid, p_einstand numeric, p_zoll text, p_notiz text)
returns void language plpgsql set search_path = public as $$
declare
  c_t uuid := '33333333-3333-4333-8333-333333333333';
  v_liter numeric := p_anzahl * p_ml / 1000.0;
  v_akt numeric; v_beh uuid; v_rest numeric; v_z integer; v_chnr text;
begin
  if p_datum > current_date then return; end if;
  update tenant_einstellungen set charge_zaehler = charge_zaehler + 1 where tenant_id = c_t
    returning charge_zaehler - 1 into v_z;
  v_chnr := 'CH-' || extract(year from p_datum)::int || '-' || lpad(v_z::text, 3, '0');

  insert into fuellungen (id, tenant_id, weinausbau_id, name, jahrgang, rebsorte, qualitaet, herkunft_code, anbaugebiet, bezeichnung,
    datum, flaschengroesse_ml, anzahl_flaschen, bestand_flaschen, menge_liter_gefuellt, vk_preis_brutto, mwst_pct, pruefnummer,
    dac_antrag_id, chargennummer, einstandspreis, zolltarifnummer, notizen, erstellt_am, aktualisiert_am)
  values (p_fid, c_t, p_wa, p_name, p_jahrgang, p_rebsorte, p_qualitaet, p_herkunft, 'Kremstal', p_bezeichnung,
    p_datum, p_ml, p_anzahl, p_anzahl, v_liter, p_preis, 13, p_pruefnummer,
    p_dac, v_chnr, p_einstand, p_zoll, p_notiz, p_datum::timestamptz, p_datum::timestamptz);

  if p_wa is null then return; end if;

  insert into fuellung_chargen (tenant_id, fuellung_id, weinausbau_id, anteil_liter) values (c_t, p_fid, p_wa, v_liter);

  select menge_liter, behaelter_id into v_akt, v_beh from weinausbau where id = p_wa and tenant_id = c_t;
  v_rest := greatest(0, coalesce(v_akt, 0) - v_liter);
  if v_rest <= 0.01 or p_abschliessen then
    update weinausbau set menge_liter = 0, status = 'abgeschlossen', aktiv = false where id = p_wa and tenant_id = c_t;
    if v_rest > 0.01 and v_beh is not null then
      insert into keller_umzuege (tenant_id, von_weinausbau_id, nach_behaelter_id, menge_liter, brutto_liter, schwund_liter, datum, umzug_typ, notizen, erstellt_am)
      values (c_t, p_wa, v_beh, 0, v_rest, v_rest, p_datum, 'schwund', 'Schwund bei Abfüllung', p_datum::timestamptz);
    end if;
  else
    update weinausbau set menge_liter = v_rest, status = 'abfuellung', aktiv = true where id = p_wa and tenant_id = c_t;
  end if;
end $$;

create or replace function public.demo_musterhof_umzug(
  p_von uuid[], p_brutto numeric[], p_nach_beh uuid, p_netto numeric, p_datum date,
  p_neu_id uuid, p_name text, p_typ text, p_notiz text)
returns uuid language plpgsql set search_path = public as $$
declare
  c_t uuid := '33333333-3333-4333-8333-333333333333';
  v_batch uuid := gen_random_uuid();
  v_tx text; v_i integer; v_von record; v_rest numeric; v_schwund numeric;
  v_ziel uuid; v_erste record; v_qual text;
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
    update weinausbau set menge_liter = coalesce(menge_liter, 0) + p_netto where id = v_ziel and tenant_id = c_t;
  else
    v_ziel := coalesce(p_neu_id, gen_random_uuid());
    insert into weinausbau (id, tenant_id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, anfangsbestand_liter,
      qualitaetsstufe, status, notizen, aktiv, kmw, weinart, herkunft_code, created_at, updated_at)
    values (v_ziel, c_t, coalesce(p_name, v_erste.name), v_erste.jahrgang, v_erste.rebsorte, v_erste.weingarten_id, p_nach_beh, p_netto, null,
      v_erste.qualitaetsstufe, v_erste.status,
      case when array_length(p_von, 1) > 1 then 'Zusammengeführt aus ' || array_length(p_von, 1) || ' Chargen' else 'Umzug aus „' || v_erste.name || '"' end,
      true, v_erste.kmw, v_erste.weinart, v_erste.herkunft_code, p_datum::timestamptz, p_datum::timestamptz);
    insert into weinausbau_weingaerten (tenant_id, weinausbau_id, weingarten_id)
    select distinct c_t, v_ziel, ww.weingarten_id from weinausbau_weingaerten ww where ww.weinausbau_id = any(p_von)
    on conflict (weinausbau_id, weingarten_id) do nothing;
  end if;

  insert into keller_umzuege (tenant_id, datum, nach_behaelter_id, nach_weinausbau_id, menge_liter, schwund_liter, brutto_liter,
    umzug_typ, notizen, umzug_batch_id, zeilen_typ, erstellt_am)
  values (c_t, p_datum, p_nach_beh, v_ziel, p_netto, 0, null, p_typ, null, v_batch, 'ziel', p_datum::timestamptz);
  return v_ziel;
end $$;

create or replace function public.demo_musterhof_verkauf(
  p_id uuid, p_nr integer, p_datum date, p_kontakt uuid, p_firma uuid, p_pos jsonb, p_zahlung jsonb, p_storno boolean, p_notiz text)
returns void language plpgsql set search_path = public as $$
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
end $$;

create or replace function public.demo_musterhof_kosten(
  p_id uuid, p_datum date, p_kst uuid, p_kart uuid, p_betrag numeric, p_beschr text, p_objekt text,
  p_wg uuid[], p_beh uuid[], p_behandlung uuid)
returns void language plpgsql set search_path = public as $$
declare
  c_t uuid := '33333333-3333-4333-8333-333333333333';
  v_ges numeric;
begin
  if p_datum > current_date then return; end if;
  insert into kosteneintraege (id, tenant_id, kostenstelle_id, kostenart_id, datum, betrag, beschreibung, periode, objekt_typ,
    weingarten_id, behaelter_id, ried_id, transaktions_nr, behandlung_id, erstellt_am)
  values (p_id, c_t, p_kst, p_kart, p_datum, p_betrag, p_beschr, to_char(p_datum, 'YYYY-MM'), p_objekt,
    null, null, null, demo_musterhof_txnr('kosteneintrag', extract(year from p_datum)::int), p_behandlung, p_datum::timestamptz);

  if p_objekt = 'weingarten' then
    select sum(coalesce(g.ha, w.flaeche_ha, 0)) into v_ges
    from weingarten w left join lateral (select sum(flaeche_ha) ha from grundstuecke g where g.weingarten_id = w.id and g.nutzart = 'WI') g on true
    where w.tenant_id = c_t and w.aktiv and (p_wg is null or w.id = any(p_wg));
    insert into kosteneintrag_weingaerten (kosteneintrag_id, weingarten_id, anteil_pct, betrag_anteil)
    select p_id, w.id, round(coalesce(g.ha, w.flaeche_ha, 0) / v_ges * 100, 2), round(p_betrag * coalesce(g.ha, w.flaeche_ha, 0) / v_ges, 2)
    from weingarten w left join lateral (select sum(flaeche_ha) ha from grundstuecke g where g.weingarten_id = w.id and g.nutzart = 'WI') g on true
    where w.tenant_id = c_t and w.aktiv and (p_wg is null or w.id = any(p_wg)) and coalesce(g.ha, w.flaeche_ha, 0) > 0;
  else
    select sum(coalesce(volumen_liter, 0)) into v_ges from behaelter where tenant_id = c_t and id = any(p_beh);
    insert into kosteneintrag_behaelter (kosteneintrag_id, behaelter_id, anteil_pct, betrag_anteil)
    select p_id, b.id, round(coalesce(b.volumen_liter, 0) / v_ges * 100, 2), round(p_betrag * coalesce(b.volumen_liter, 0) / v_ges, 2)
    from behaelter b where b.tenant_id = c_t and b.id = any(p_beh);
  end if;
end $$;

create or replace function public.demo_musterhof_ea(
  p_typ text, p_datum date, p_beschr text, p_kat text, p_netto numeric, p_ust numeric, p_konto uuid, p_firma uuid, p_dauer uuid)
returns void language plpgsql set search_path = public as $$
declare
  c_t uuid := '33333333-3333-4333-8333-333333333333';
  v_kat uuid := demo_musterhof_kat(p_kat);
  v_abz numeric := 100;
begin
  if p_datum > current_date then return; end if;
  if v_kat is not null then select abzugsfaehig_pct into v_abz from ea_kategorien where id = v_kat; end if;
  insert into ea_transaktionen (tenant_id, typ, datum, beschreibung, kategorie_id, betrag_netto, ust_satz, import_quelle, konto_id, firma_id,
    dauerauftrag_id, abzugsfaehig_pct, abgeglichen, erstellt_am, aktualisiert_am)
  values (c_t, p_typ, p_datum, p_beschr, v_kat, p_netto, p_ust, 'manuell', p_konto, p_firma, p_dauer, coalesce(v_abz, 100), true,
    p_datum::timestamptz, p_datum::timestamptz);
end $$;

revoke execute on function public.demo_musterhof_id(integer, integer) from public, anon, authenticated;
revoke execute on function public.demo_musterhof_txnr(text, integer) from public, anon, authenticated;
revoke execute on function public.demo_musterhof_kat(text) from public, anon, authenticated;
revoke execute on function public.demo_musterhof_fuellen(uuid, uuid, date, text, integer, text, text, text, text, integer, integer, numeric, boolean, text, uuid, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.demo_musterhof_umzug(uuid[], numeric[], uuid, numeric, date, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.demo_musterhof_verkauf(uuid, integer, date, uuid, uuid, jsonb, jsonb, boolean, text) from public, anon, authenticated;
revoke execute on function public.demo_musterhof_kosten(uuid, date, uuid, uuid, numeric, text, text, uuid[], uuid[], uuid) from public, anon, authenticated;
revoke execute on function public.demo_musterhof_ea(text, date, text, text, numeric, numeric, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.demo_musterhof_id(integer, integer) to service_role;
grant execute on function public.demo_musterhof_txnr(text, integer) to service_role;
grant execute on function public.demo_musterhof_kat(text) to service_role;
grant execute on function public.demo_musterhof_fuellen(uuid, uuid, date, text, integer, text, text, text, text, integer, integer, numeric, boolean, text, uuid, numeric, text, text) to service_role;
grant execute on function public.demo_musterhof_umzug(uuid[], numeric[], uuid, numeric, date, uuid, text, text, text) to service_role;
grant execute on function public.demo_musterhof_verkauf(uuid, integer, date, uuid, uuid, jsonb, jsonb, boolean, text) to service_role;
grant execute on function public.demo_musterhof_kosten(uuid, date, uuid, uuid, numeric, text, text, uuid[], uuid[], uuid) to service_role;
grant execute on function public.demo_musterhof_ea(text, date, text, text, numeric, numeric, uuid, uuid, uuid) to service_role;;
