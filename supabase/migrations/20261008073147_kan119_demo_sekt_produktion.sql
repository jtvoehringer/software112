-- KAN-119 (08.10.2026): Demo-Sekt im Musterhof über „Produktion“ (KAN-118) – Sektgrundwein Chardonnay (11,42) → Produktion
-- „Schaumwein/Sekt g.U.“ am 20.03. des Vorjahres (Tirage: Fülldosage, Reinzuchthefe) → neue Charge „Musterhof Brut Sekt (Tirage)“
-- (11,43, Erzeugnis SEKTGU) → Füllung „Musterhof Brut Sekt“ (19,1) samt Schwund bei der Abfüllung. Bisher hing die Füllung direkt
-- am Grundwein. Nur demo_musterhof_y2_kette (Schritt 2 des Demo-Resets); Produktion: 66,1, Eingänge 67,1–3.
-- Die Produktion liegt vor dem Journal-Stichtag der Demo (heute − 14) und schreibt daher keine Journalzeilen.

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
  v_ch integer; v_menge numeric;   -- KAN-119: Charge der Füllung (Sekt: neue Charge aus der Produktion)
begin
  PERFORM set_config('s112.protokoll_aus', c_t::text, true);  -- KAN-35: Demo-Reset nicht protokollieren (nur Demo-Mandant)
  y1 := y - 1; y2 := y - 2;

  -- Aufräumen (idempotent)
  delete from fuellung_chargen where tenant_id = c_t and weinausbau_id in (demo_musterhof_id(11,40), demo_musterhof_id(11,41), demo_musterhof_id(11,42), demo_musterhof_id(11,43));  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus
  delete from weinanalysen where tenant_id = c_t and weinausbau_id in (demo_musterhof_id(11,40), demo_musterhof_id(11,41), demo_musterhof_id(11,42));  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus
  delete from keller_umzuege where tenant_id = c_t and von_weinausbau_id in (demo_musterhof_id(11,40), demo_musterhof_id(11,41), demo_musterhof_id(11,42), demo_musterhof_id(11,43));  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus
  -- KAN-119: Sekt-Produktion (Löschsperre: Demo-Reset über s112.protokoll_aus)
  delete from produktion_eingaenge where tenant_id = c_t and produktion_id = demo_musterhof_id(66,1);  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus
  delete from produktionen where tenant_id = c_t and id = demo_musterhof_id(66,1);  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus
  delete from pressung_behaelter where id in (demo_musterhof_id(40,60), demo_musterhof_id(40,61), demo_musterhof_id(40,62));  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus
  delete from weinausbau where tenant_id = c_t and id in (demo_musterhof_id(11,40), demo_musterhof_id(11,41), demo_musterhof_id(11,42), demo_musterhof_id(11,43));  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus
  delete from pressung_weingaerten where pressung_id in (demo_musterhof_id(9,40), demo_musterhof_id(9,41), demo_musterhof_id(9,42));  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus
  delete from pressungen where tenant_id = c_t and id in (demo_musterhof_id(9,40), demo_musterhof_id(9,41), demo_musterhof_id(9,42));  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus

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

    -- KAN-119: Der Sekt entsteht über „Produktion“ – Grundwein → Tirage (Schaumwein/Sekt g.U.) → Füllung
    v_ch := r.nr;
    v_menge := coalesce(v_f.menge_liter_gefuellt, 0) + r.schwund;
    if r.nr = 42 then
      insert into weinausbau (id, tenant_id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, status, qualitaetsstufe,
        erzeugnis, ist_eroeffnungsbestand, weinart, herkunft_code, aktiv, created_at, updated_at)
      values (demo_musterhof_id(11,43), c_t, 'Musterhof Brut Sekt (Tirage)', y2, r.rebsorte, demo_musterhof_id(2, r.wg), demo_musterhof_id(10, r.beh),
        0, 'abgeschlossen', r.qual, 'SEKTGU', false, r.weinart, 'wlnoe', false, make_date(y1,3,20)::timestamptz, now());
      insert into produktionen (id, tenant_id, datum, art, erzeugnis, ziel_weinausbau_id, wein_liter, ziel_menge, gebucht, notizen,
        erstellt_von_name, erstellt_am)
      values (demo_musterhof_id(66,1), c_t, make_date(y1,3,20), 'schaumwein', 'SEKTGU', demo_musterhof_id(11,43), v_menge, v_menge, true,
        'Tirage für die traditionelle Flaschengärung (Lohnversektung) – degorgiert ' || y1, 'Demo', make_date(y1,3,20)::timestamptz);
      insert into produktion_eingaenge (id, tenant_id, produktion_id, art, weinausbau_id, bezeichnung, menge, einheit, volumen_liter) values
        (demo_musterhof_id(67,1), c_t, demo_musterhof_id(66,1), 'wein',   demo_musterhof_id(11,42), null,                       v_menge, 'l',  v_menge),
        (demo_musterhof_id(67,2), c_t, demo_musterhof_id(66,1), 'zucker', null,                     'Fülldosage (Saccharose)',  round(v_menge * 0.024, 3), 'kg', 0),
        (demo_musterhof_id(67,3), c_t, demo_musterhof_id(66,1), 'hefe',   null,                     'Reinzuchthefe',            0.24,    'kg', 0);
      v_ch := 43;
    end if;

    -- Füllung mit der Charge verknüpfen + Schwund bei der Abfüllung dokumentieren
    update fuellungen set weinausbau_id = demo_musterhof_id(11, v_ch) where id = v_f.id and tenant_id = c_t;
    insert into fuellung_chargen (tenant_id, fuellung_id, weinausbau_id, anteil_liter)
    values (c_t, v_f.id, demo_musterhof_id(11, v_ch), coalesce(v_f.menge_liter_gefuellt, 0));
    insert into keller_umzuege (tenant_id, von_weinausbau_id, nach_behaelter_id, menge_liter, brutto_liter, schwund_liter, datum, umzug_typ, notizen, erstellt_am)
    values (c_t, demo_musterhof_id(11, v_ch), demo_musterhof_id(10, r.beh), 0, r.schwund, r.schwund, v_f.datum, 'schwund', 'Schwund bei Abfüllung', v_f.datum::timestamptz);
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

  -- KAN-223: Journal, Abschluss, Kellerbuch-Vorgänge, PN-Workflow, Zukauf, Traubenverkauf, Betriebsmittel, Export
  perform demo_musterhof_kellerbuch();
end $function$;
REVOKE EXECUTE ON FUNCTION public.demo_musterhof_y2_kette() FROM PUBLIC, anon, authenticated;
