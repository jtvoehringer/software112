-- KAN-129 Soll 10 (29.09.2026): Musterhof-Demo mit Lesen
--
-- Die Demo läuft seit lesen_je_jahrgang schon über die automatische Zuordnung (jeder Jahrgang bekommt Lese 1,
-- Einträge und Pressungen landen dort). Ergänzt wird – ohne die große Funktion demo_musterhof_zuruecksetzen()
-- anzufassen – als eigener Schritt am Ende von demo_musterhof_y2_kette() (Demo-Reset = beide Schritte):
--   1. Lese 1 des Vorvorjahres (2024) angleichen: Beginn = frühester Lesetag der Pressungen (Sekt-Frühlese
--      04.09. lag vor dem Erntebeginn 12.09.; Ticket-Befund „Musterhof 2024“)
--   2. Eiswein-Lese im Vorjahr (2025/2): Grüner Veltliner Ried Sandgrube, Lese am 12.01. des laufenden Jahres,
--      850 kg, 26,4 °KMW, Stufe Eiswein – zeigt Reiter, Eiswein-Stufe und den Stichtag 30.11. der Erntemeldung
--      (die bestätigte AMA-Meldung 2025 bleibt unverändert)
--   3. Checklisten-Punkt „Jahrgang im System anlegen“ → „Lese im System anlegen …“
-- Nur der Demo-Mandant; Protokoll aus wie im übrigen Reset. Staging zuerst.

CREATE OR REPLACE FUNCTION public.demo_musterhof_lesen() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
declare
  c_t   uuid := '33333333-3333-4333-8333-333333333333';
  y     integer := extract(year from current_date)::int;
  jg_y2 uuid := demo_musterhof_id(8, 1);
  jg_y1 uuid := demo_musterhof_id(8, 2);
  v_lese uuid;
begin
  PERFORM set_config('s112.protokoll_aus', c_t::text, true);  -- wie der übrige Demo-Reset (nur Demo-Mandant)

  -- Aufräumen (idempotent): Eiswein-Eintrag und weitere Lesen des Vorjahres
  delete from ernte_parzellen where id = demo_musterhof_id(38, 30) and jahrgang_id = jg_y1;
  delete from lesen where tenant_id = c_t and jahrgang_id = jg_y1 and lfd_nr > 1;

  if not exists (select 1 from weinjahrgaenge where id = jg_y1 and tenant_id = c_t) then return; end if;

  -- 1. Lese 2024/1: Beginn = frühester Lesetag (Pressungszeilen bzw. Lese-Einträge)
  update lesen l
     set beginn = sub.erster
    from (select min(d) as erster from (
            select pw.ernte_datum as d from pressung_weingaerten pw join pressungen p on p.id = pw.pressung_id
             where p.jahrgang_id = jg_y2 and p.tenant_id = c_t
            union all
            select ep.ernte_datum from ernte_parzellen ep where ep.jahrgang_id = jg_y2) q) sub
   where l.jahrgang_id = jg_y2 and l.tenant_id = c_t and l.lfd_nr = 1
     and sub.erster is not null and (l.beginn is null or sub.erster < l.beginn);

  -- 2. Eiswein 2025/2 (Lese im Jänner des laufenden Jahres gehört zum Vorjahrgang)
  insert into lesen (tenant_id, jahrgang_id, art, bezeichnung, beginn, ende, notizen)
  values (c_t, jg_y1, 'eiswein', 'Grüner Veltliner Eiswein', make_date(y, 1, 12), make_date(y, 1, 12),
          'Lese bei −8 °C in den frühen Morgenstunden, Trauben am Stock gefroren')
  returning id into v_lese;
  insert into ernte_parzellen (id, jahrgang_id, lese_id, weingarten_id, rebsorte_id, ernte_datum, menge_kg, menge_hl,
    klosterneuburger, mostgewicht_einheit, qualitaetsstufe, lesemethode, weinbezeichnung, herkunft_code, notizen, created_at)
  select demo_musterhof_id(38, 30), jg_y1, v_lese, w.id, wr.rebsorte_id, make_date(y, 1, 12), 850, round(850 / 130.0, 1),
    26.4, 'kmw', 'eiswein', 'handlese', 'Grüner Veltliner Eiswein', 'wlnoe',
    'Eiswein – nach dem Stichtag 30.11. gelesen, nicht in der Erntemeldung', make_date(y, 1, 12)::timestamptz
  from weingarten w left join weingarten_rebsorten wr on wr.weingarten_id = w.id
  where w.id = demo_musterhof_id(2, 4) and w.tenant_id = c_t
  limit 1;

  -- 3. Checkliste Lesevorbereitung
  update checklisten_punkte
     set text = 'Lese im System anlegen (Lese › Neue Lese, dann Lesedaten und Pressungen)'
   where tenant_id = c_t and checkliste_id = demo_musterhof_id(37, 1) and sortierung = 80;
end $f$;
REVOKE EXECUTE ON FUNCTION public.demo_musterhof_lesen() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.demo_musterhof_y2_kette()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_t uuid := '33333333-3333-4333-8333-333333333333';
  y  integer := extract(year from current_date)::int;
  y1 integer; y2 integer;
  jg_y2 uuid := demo_musterhof_id(8, 1);
  r record; v_f record;
begin
  PERFORM set_config('s112.protokoll_aus', c_t::text, true);  -- KAN-35: Demo-Reset nicht protokollieren (nur Demo-Mandant)
  y1 := y - 1; y2 := y - 2;

  -- Aufräumen (idempotent)
  delete from fuellung_chargen where tenant_id = c_t and weinausbau_id in (demo_musterhof_id(11,40), demo_musterhof_id(11,41), demo_musterhof_id(11,42));
  delete from weinanalysen where tenant_id = c_t and weinausbau_id in (demo_musterhof_id(11,40), demo_musterhof_id(11,41), demo_musterhof_id(11,42));
  delete from keller_umzuege where tenant_id = c_t and von_weinausbau_id in (demo_musterhof_id(11,40), demo_musterhof_id(11,41), demo_musterhof_id(11,42));
  delete from pressung_behaelter where id in (demo_musterhof_id(40,60), demo_musterhof_id(40,61), demo_musterhof_id(40,62));
  delete from weinausbau where tenant_id = c_t and id in (demo_musterhof_id(11,40), demo_musterhof_id(11,41), demo_musterhof_id(11,42));
  delete from pressung_weingaerten where pressung_id in (demo_musterhof_id(9,40), demo_musterhof_id(9,41), demo_musterhof_id(9,42));
  delete from pressungen where tenant_id = c_t and id in (demo_musterhof_id(9,40), demo_musterhof_id(9,41), demo_musterhof_id(9,42));

  -- Nur auf einem frischen Demo-Stand ergänzen
  if not exists (select 1 from fuellungen where id = demo_musterhof_id(19,2) and tenant_id = c_t) then return; end if;

  insert into pressungen (id, tenant_id, jahrgang_id, datum, most_liter_gesamt, weinbezeichnung, kmw_grad, notizen, erstellt_am) values
    (demo_musterhof_id(9,40), c_t, jg_y2, make_date(y2,9,25), 12900, 'Grüner Veltliner Kremstal DAC', 17.8, 'Hauptlese Spiegel + Loibenberg', make_date(y2,9,25)::timestamptz),
    (demo_musterhof_id(9,41), c_t, jg_y2, make_date(y2,9,30), 4600,  'Riesling Ried Pfaffenberg',    18.5, 'Selektive Handlese', make_date(y2,9,30)::timestamptz),
    (demo_musterhof_id(9,42), c_t, jg_y2, make_date(y2,9,5),  1300,  'Sektgrundwein Chardonnay/Weißburgunder', 15.8, 'Frühlese für Sektgrundwein – hohe Säure gewollt', make_date(y2,9,5)::timestamptz);
  insert into pressung_weingaerten (pressung_id, weingarten_id, grundstueck_id, trauben_kg, rebsorte, ernte_datum, kmw) values
    (demo_musterhof_id(9,40), demo_musterhof_id(2,3),  demo_musterhof_id(3,4),  13500, 'Grüner Veltliner', make_date(y2,9,24), 17.6),
    (demo_musterhof_id(9,40), demo_musterhof_id(2,12), demo_musterhof_id(3,17), 4700,  'Grüner Veltliner', make_date(y2,9,25), 18.2),
    (demo_musterhof_id(9,41), demo_musterhof_id(2,1),  demo_musterhof_id(3,1),  6600,  'Riesling',         make_date(y2,9,30), 18.5),
    (demo_musterhof_id(9,42), demo_musterhof_id(2,7),  demo_musterhof_id(3,11), 1300,  'Chardonnay',       make_date(y2,9,4),  15.6),
    (demo_musterhof_id(9,42), demo_musterhof_id(2,6),  demo_musterhof_id(3,10), 600,   'Weißburgunder',    make_date(y2,9,5),  16.1);

  -- Chargen (bereits leer/abgeschlossen: die Füllungen des Vorjahres stammen daraus)
  for r in select * from (values
    (40, 40, 19, 2, 'Grüner Veltliner Kremstal DAC',     'Grüner Veltliner', 3, 2, 50, 'dac',            'weiss'),
    (41, 41, 19, 3, 'Riesling Ried Pfaffenberg Reserve', 'Riesling',         1, 4, 40, 'reserve',        'weiss'),
    (42, 42, 19, 1, 'Sektgrundwein Chardonnay',          'Chardonnay',       7, 9, 30, 'qualitaetswein', 'weiss')
  ) as v(nr, pr, ftyp, fnr, name, rebsorte, wg, beh, schwund, qual, weinart)
  loop
    select * into v_f from fuellungen where id = demo_musterhof_id(r.ftyp, r.fnr) and tenant_id = c_t;
    if v_f.id is null then continue; end if;

    insert into weinausbau (id, tenant_id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, status, qualitaetsstufe,
      ist_eroeffnungsbestand, weinart, herkunft_code, aktiv, created_at, updated_at)
    values (demo_musterhof_id(11, r.nr), c_t, r.name, y2, r.rebsorte, demo_musterhof_id(2, r.wg), demo_musterhof_id(10, r.beh),
      0, 'abgeschlossen', r.qual, false, r.weinart, 'wlnoe', false, make_date(y2,9,25)::timestamptz, now());
    insert into pressung_behaelter (id, pressung_id, behaelter_id, weinausbau_id, menge_liter)
    values (demo_musterhof_id(40, 20 + r.nr), demo_musterhof_id(9, r.pr), demo_musterhof_id(10, r.beh), demo_musterhof_id(11, r.nr),
      coalesce(v_f.menge_liter_gefuellt, 0) + r.schwund);

    -- Füllung mit der Charge verknüpfen + Schwund bei der Abfüllung dokumentieren
    update fuellungen set weinausbau_id = demo_musterhof_id(11, r.nr) where id = v_f.id and tenant_id = c_t;
    insert into fuellung_chargen (tenant_id, fuellung_id, weinausbau_id, anteil_liter)
    values (c_t, v_f.id, demo_musterhof_id(11, r.nr), coalesce(v_f.menge_liter_gefuellt, 0));
    insert into keller_umzuege (tenant_id, von_weinausbau_id, nach_behaelter_id, menge_liter, brutto_liter, schwund_liter, datum, umzug_typ, notizen, erstellt_am)
    values (c_t, demo_musterhof_id(11, r.nr), demo_musterhof_id(10, r.beh), 0, r.schwund, r.schwund, v_f.datum, 'schwund', 'Schwund bei Abfüllung', v_f.datum::timestamptz);
  end loop;

  -- Analysen der y2-Chargen: nach Gärende (Dez y2) und Freigabe vor der Füllung
  insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, dichte, extrakt_gl, bewertung, created_at) values
    (c_t, demo_musterhof_id(11,40), make_date(y2,12,12), 'Weinlabor Krems', 'WL-' || y2 || '-1810', 12.4, 2.1, 5.9, 0.30, 3.31, 30, 90, 0.9916, 21.0, 'trocken, sauber – gärt durch', make_date(y2,12,12)::timestamptz),
    (c_t, demo_musterhof_id(11,41), make_date(y2,12,12), 'Weinlabor Krems', 'WL-' || y2 || '-1811', 12.8, 6.0, 7.1, 0.28, 3.04, 32, 96, 0.9930, 23.5, 'feine Frucht, Reserve-Potenzial', make_date(y2,12,12)::timestamptz),
    (c_t, demo_musterhof_id(11,42), make_date(y2,11,20), 'Weinlabor Krems', 'WL-' || y2 || '-1690', 11.2, 1.2, 7.8, 0.24, 3.02, 25, 70, 0.9912, 19.0, 'Grundwein für Versektung freigegeben', make_date(y2,11,20)::timestamptz),
    (c_t, demo_musterhof_id(11,40), make_date(y1,2,10),  'Weinlabor Krems', 'WL-' || y1 || '-0205', 12.5, 1.9, 5.8, 0.34, 3.32, 34, 102, 0.9915, 21.2, 'Füllfertig – DAC-Prüfnummer beantragt', make_date(y1,2,10)::timestamptz),
    (c_t, demo_musterhof_id(11,41), make_date(y1,6,28),  'Weinlabor Krems', 'WL-' || y1 || '-0688', 13.0, 5.8, 7.0, 0.36, 3.05, 35, 108, 0.9929, 23.8, 'Füllfertig nach Fassreife', make_date(y1,6,28)::timestamptz);

  -- KAN-129 Soll 10: Lesen der Demo (Lese 2024 angleichen, Eiswein 2025/2, Checkliste)
  perform demo_musterhof_lesen();
end $function$
;
REVOKE EXECUTE ON FUNCTION public.demo_musterhof_y2_kette() FROM PUBLIC, anon, authenticated;

-- Selbstprüfung
DO $pruefung$
BEGIN
  IF has_function_privilege('authenticated', 'public.demo_musterhof_lesen()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.demo_musterhof_lesen()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-129 Demo: demo_musterhof_lesen() für API-Rollen ausführbar';
  END IF;
  IF position('demo_musterhof_lesen()' in pg_get_functiondef('public.demo_musterhof_y2_kette()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'KAN-129 Demo: y2_kette ruft demo_musterhof_lesen() nicht auf';
  END IF;
END $pruefung$;
