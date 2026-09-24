-- software:112 – Demo-Mandant „Weingut Musterhof (Demo)" – Reset-Funktion (v2: Altbestände vor Kellerbuch-Ablauf → Chargennummern chronologisch)
create or replace function public.demo_musterhof_zuruecksetzen()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_t   constant uuid := '33333333-3333-4333-8333-333333333333';
  d     constant date := current_date;
  y     constant integer := extract(year from current_date)::int;
  y1    constant integer := extract(year from current_date)::int - 1;
  y2    constant integer := extract(year from current_date)::int - 2;
  v_ernte_y boolean := current_date >= make_date(extract(year from current_date)::int, 9, 1);
  k_giro  uuid := demo_musterhof_id(30, 1);
  k_kassa uuid := demo_musterhof_id(30, 2);
  jg_y2 uuid := demo_musterhof_id(8, 1);
  jg_y1 uuid := demo_musterhof_id(8, 2);
  jg_y  uuid := demo_musterhof_id(8, 3);
  r record; v_id uuid; v_id2 uuid; v_ha numeric; v_i integer; v_dt date; v_m integer; v_jahr integer;
  v_c6 uuid; v_c5 uuid; v_c8 uuid; v_c10 uuid; v_q integer; v_uva record; v_gesamt_kg numeric;
  v_letzter_monat date;
begin
  if not exists (select 1 from tenants where id = c_t and slug = 'demo-musterhof') then
    raise exception 'Demo-Mandant % mit slug demo-musterhof nicht gefunden – Abbruch.', c_t;
  end if;

  -- ── Löschen (nur Demo-Mandant; Kind-Tabellen ohne tenant_id über Eltern) ──
  delete from sumup_transaktionen where tenant_id = c_t;
  delete from sumup_checkouts where tenant_id = c_t;
  delete from sumup_terminals where tenant_id = c_t;
  delete from ea_dauerauftrag_log where tenant_id = c_t;
  delete from ea_belege where tenant_id = c_t;
  delete from konto_umbuchungen where tenant_id = c_t;
  delete from ea_transaktionen where tenant_id = c_t;
  delete from ea_uva where tenant_id = c_t;
  delete from ea_monatsabschluss where tenant_id = c_t;
  delete from ea_dauerauftraege where tenant_id = c_t;
  delete from konten where tenant_id = c_t;
  delete from ea_kategorien where tenant_id = c_t;
  delete from kosteneintrag_weingaerten where kosteneintrag_id in (select id from kosteneintraege where tenant_id = c_t);
  delete from kosteneintrag_behaelter where kosteneintrag_id in (select id from kosteneintraege where tenant_id = c_t);
  delete from kosteneintraege where tenant_id = c_t;
  delete from kostenarten where tenant_id = c_t;
  delete from kostenstellen where tenant_id = c_t;
  delete from exportauftraege where tenant_id = c_t;
  delete from transportbescheinigungen where tenant_id = c_t;
  delete from zahlungen where tenant_id = c_t;
  delete from verkauf_positionen where tenant_id = c_t;
  delete from traubenverkauf where tenant_id = c_t;
  delete from verkaufsposten where tenant_id = c_t;
  delete from bestellungen where tenant_id = c_t;
  delete from aktivitaet_dokumente where tenant_id = c_t;
  delete from aktivitaeten where tenant_id = c_t;
  delete from pipeline_eintraege where tenant_id = c_t;
  delete from kontakt_firmen where kontakt_id in (select id from kontakte where tenant_id = c_t) or firma_id in (select id from firmen where tenant_id = c_t);
  delete from kontakte where tenant_id = c_t;
  delete from firmen where tenant_id = c_t;
  delete from rabattgruppen where tenant_id = c_t;
  delete from fuellung_chargen where tenant_id = c_t;
  delete from fuellungen where tenant_id = c_t;
  delete from sonstige_artikel where tenant_id = c_t;
  delete from pruefnummernantraege where tenant_id = c_t;
  delete from dac_antrag where tenant_id = c_t;
  delete from keller_behandlungen where tenant_id = c_t;
  delete from keller_behandlungstypen where tenant_id = c_t;
  delete from weinanalysen where tenant_id = c_t;
  delete from verschneidung_quellen where verschneidung_id in (select id from verschneidungen where tenant_id = c_t);
  delete from verschneidungen where tenant_id = c_t;
  delete from keller_umzuege where tenant_id = c_t;
  delete from kellerplan_positionen where tenant_id = c_t;
  delete from kellerplaene where tenant_id = c_t;
  delete from pressung_behaelter where pressung_id in (select id from pressungen where tenant_id = c_t);
  delete from pressung_weingaerten where pressung_id in (select id from pressungen where tenant_id = c_t);
  delete from pressungen where tenant_id = c_t;
  delete from zukauf_posten where tenant_id = c_t;
  delete from ama_meldepositionen where meldung_id in (select id from ama_erntemeldungen where tenant_id = c_t);
  delete from ama_erntemeldungen where tenant_id = c_t;
  delete from ernte_parzellen where jahrgang_id in (select id from weinjahrgaenge where tenant_id = c_t);
  delete from weinjahrgaenge where tenant_id = c_t;
  delete from weinausbau_weingaerten where tenant_id = c_t;
  delete from weinausbau where tenant_id = c_t;
  delete from behaelter where tenant_id = c_t;
  delete from behandlung_grundstuecke where behandlung_id in (select id from behandlungen where tenant_id = c_t);
  delete from behandlungen where tenant_id = c_t;
  delete from psm_lager_bewegungen where tenant_id = c_t;
  delete from duengemittel_lager_bewegungen where tenant_id = c_t;
  delete from pflanzenschutzmittel where tenant_id = c_t;
  delete from duengemittel where tenant_id = c_t;
  delete from saetze_massnahmen where tenant_id = c_t;
  delete from weingarten_rebsorten where weingarten_id in (select id from weingarten where tenant_id = c_t);
  delete from grundstuecke where tenant_id = c_t;
  delete from weingarten where tenant_id = c_t;
  delete from lagen where tenant_id = c_t;
  delete from weinbaugebiete_custom where tenant_id = c_t;
  delete from checklisten_punkte where tenant_id = c_t;
  delete from checklisten where tenant_id = c_t;
  delete from fristen where tenant_id = c_t;
  delete from zeiterfassung where tenant_id = c_t;
  delete from assistent_korrekturen where tenant_id = c_t;
  delete from assistent_unterhaltungen where tenant_id = c_t;
  delete from transaktionszaehler where tenant_id = c_t;

  update tenant_einstellungen
     set rechnung_zaehler = 1, kunden_zaehler = 1, charge_zaehler = 1, liefernummer_zaehler = 0,
         ea_betriebsbeginn = make_date(y1, 1, 1)
   where tenant_id = c_t;

  insert into weinbaugebiete_custom (tenant_id, name, aktiv) values (c_t, 'Kremstal DAC', true);

  -- ── Lagen / Rieden ────────────────────────────────────────────────────────
  insert into lagen (id, tenant_id, name, gemeinde, weinbaugebiet, notizen) values
    (demo_musterhof_id(1,1), c_t, 'Ried Pfaffenberg',  'Krems-Stein',           'Kremstal', 'Urgestein (Gföhler Gneis), Südhang, Terrassen'),
    (demo_musterhof_id(1,2), c_t, 'Ried Steiner Hund', 'Krems-Stein',           'Kremstal', 'Urgestein, steile Terrassen'),
    (demo_musterhof_id(1,3), c_t, 'Ried Kremsleithen', 'Krems an der Donau',    'Kremstal', 'Löss über Urgestein'),
    (demo_musterhof_id(1,4), c_t, 'Ried Sandgrube',    'Krems an der Donau',    'Kremstal', 'Tiefgründiger Löss'),
    (demo_musterhof_id(1,5), c_t, 'Ried Gebling',      'Krems an der Donau',    'Kremstal', 'Löss, Südost-Exposition'),
    (demo_musterhof_id(1,6), c_t, 'Ried Wachtberg',    'Krems an der Donau',    'Kremstal', 'Löss und Konglomerat'),
    (demo_musterhof_id(1,7), c_t, 'Ried Frechau',      'Rohrendorf bei Krems',  'Kremstal', 'Löss, warme Lage – Rotweinsorten');

  for r in select * from (values
    (1,  'Pfaffenberg Riesling',          'Ried Pfaffenberg',  1.20, 'Riesling',         'RR', 'weiss', 2004, 1, 48.4035, 15.5720, 'PF-RR', 'FS 1',  false, make_date(2004,4,1)),
    (2,  'Steiner Hund Riesling',         'Ried Steiner Hund', 0.90, 'Riesling',         'RR', 'weiss', 1998, 2, 48.4010, 15.5650, 'SH-RR', 'FS 2',  false, make_date(2010,1,1)),
    (3,  'Kremsleithen Grüner Veltliner', 'Ried Kremsleithen', 1.80, 'Grüner Veltliner', 'GV', 'weiss', 2008, 3, 48.4150, 15.5950, 'KL-GV', 'FS 3',  false, make_date(2008,4,1)),
    (4,  'Sandgrube Grüner Veltliner',    'Ried Sandgrube',    2.40, 'Grüner Veltliner', 'GV', 'weiss', 2011, 4, 48.4210, 15.6050, 'SG-GV', 'FS 4',  false, make_date(2011,4,1)),
    (5,  'Gebling Grüner Veltliner',      'Ried Gebling',      1.50, 'Grüner Veltliner', 'GV', 'weiss', 2001, 5, 48.4180, 15.6220, 'GB-GV', 'FS 5',  true,  make_date(2001,4,1)),
    (6,  'Wachtberg Weißburgunder',       'Ried Wachtberg',    0.80, 'Weißburgunder',    'WB', 'weiss', 2013, 6, 48.4120, 15.6150, 'WB-WB', 'FS 6',  false, make_date(2013,4,1)),
    (7,  'Wachtberg Chardonnay',          'Ried Wachtberg',    0.60, 'Chardonnay',       'CH', 'weiss', 2015, 6, 48.4130, 15.6165, 'WB-CH', 'FS 6',  false, make_date(2015,4,1)),
    (8,  'Frechau Zweigelt',              'Ried Frechau',      1.70, 'Zweigelt',         'ZW', 'rot',   2006, 7, 48.4230, 15.6600, 'FR-ZW', 'FS 7',  false, make_date(2012,1,1)),
    (9,  'Frechau St. Laurent',           'Ried Frechau',      0.70, 'St. Laurent',      'SL', 'rot',   2009, 7, 48.4245, 15.6630, 'FR-SL', 'FS 8',  false, make_date(2009,4,1)),
    (10, 'Sandgrube Muskateller',         'Ried Sandgrube',    0.55, 'Muskateller',      'MU', 'weiss', 2017, 4, 48.4225, 15.6080, 'SG-MU', 'FS 9',  false, make_date(2017,4,1)),
    (11, 'Gebling Zweigelt',              'Ried Gebling',      1.10, 'Zweigelt',         'ZW', 'rot',   2012, 5, 48.4195, 15.6250, 'GB-ZW', 'FS 10', false, make_date(2012,4,1)),
    (12, 'Pfaffenberg Grüner Veltliner',  'Ried Pfaffenberg',  0.85, 'Grüner Veltliner', 'GV', 'weiss', 2003, 1, 48.4040, 15.5760, 'PF-GV', 'FS 1',  false, make_date(2003,4,1))
  ) as v(nr, name, ried, ha, rebsorte, kz, weinart, pj, lage, lat, lon, ib, fs, tv, bs)
  loop
    insert into weingarten (id, tenant_id, name, ried, flaeche_ha, rebsorte, pflanzjahr, bewirtschaftung, aktiv, gemeinde, weinbaugebiet, lage_id,
      weinart, trauben_verkauf, trauben_herkunft_code, nachhaltig_austria, bewirtschaftung_seit, ama_feldnummer, codes, interne_bezeichnung,
      zentrum_lat, zentrum_lon, geo_quelle, geo_stand, notizen)
    values (demo_musterhof_id(2, r.nr), c_t, r.name, r.ried, r.ha, r.rebsorte, r.pj, 'konventionell', true,
      (select gemeinde from lagen where id = demo_musterhof_id(1, r.lage)), 'Kremstal', demo_musterhof_id(1, r.lage),
      r.weinart, r.tv, 'wlnoe', true, r.bs, r.fs, r.kz, r.ib, r.lat, r.lon, 'manuell', now(),
      case when r.tv then 'Trauben werden zur Gänze an die Winzergenossenschaft geliefert' end);
    insert into weingarten_rebsorten (weingarten_id, rebsorte_id, anteil_pct, pflanzjahr, stock_anzahl, unterlage, reihenabstand_m, stockabstand_m)
    select demo_musterhof_id(2, r.nr), rs.id, 100, r.pj, round(r.ha * 10000 / (2.8 * 0.9))::int, 'Kober 5BB', 2.8, 0.9
    from rebsorten rs where rs.kuerzel = r.kz;
  end loop;

  for r in select * from (values
    (1,  1,  '512/1',  'Stein',      '12127', 0.75, 'eigentum', 'WI', 'Gföhler Gneis, flachgründig', '184'),
    (2,  1,  '512/2',  'Stein',      '12127', 0.45, 'eigentum', 'WI', 'Gföhler Gneis, flachgründig', '184'),
    (3,  2,  '488/3',  'Stein',      '12127', 0.90, 'pacht',    'WI', 'Urgestein, Terrassen',        '221'),
    (4,  3,  '1021/4', 'Krems',      '12119', 1.10, 'eigentum', 'WI', 'Löss über Urgestein',         '905'),
    (5,  3,  '1021/5', 'Krems',      '12119', 0.70, 'eigentum', 'WI', 'Löss über Urgestein',         '905'),
    (6,  4,  '1305/1', 'Krems',      '12119', 1.50, 'pacht',    'WI', 'Tiefgründiger Löss',          '1312'),
    (7,  4,  '1305/2', 'Krems',      '12119', 0.90, 'pacht',    'WI', 'Tiefgründiger Löss',          '1312'),
    (8,  4,  '1306',   'Krems',      '12119', 0.25, 'pacht',    'A',  'Löss – Grünbrache seit Rodung', '1312'),
    (9,  5,  '1188/2', 'Krems',      '12119', 1.50, 'eigentum', 'WI', 'Löss',                        '877'),
    (10, 6,  '977/1',  'Krems',      '12119', 0.80, 'eigentum', 'WI', 'Löss/Konglomerat',            '640'),
    (11, 7,  '977/2',  'Krems',      '12119', 0.60, 'eigentum', 'WI', 'Löss/Konglomerat',            '640'),
    (12, 8,  '2213/1', 'Rohrendorf', '12125', 1.00, 'pacht',    'WI', 'Löss, warm',                  '412'),
    (13, 8,  '2213/2', 'Rohrendorf', '12125', 0.70, 'pacht',    'WI', 'Löss, warm',                  '412'),
    (14, 9,  '2214',   'Rohrendorf', '12125', 0.70, 'eigentum', 'WI', 'Löss',                        '413'),
    (15, 10, '1307/3', 'Krems',      '12119', 0.55, 'eigentum', 'WI', 'Löss, sandig',                '1315'),
    (16, 11, '1189/1', 'Krems',      '12119', 1.10, 'eigentum', 'WI', 'Löss',                        '878'),
    (17, 12, '513',    'Stein',      '12127', 0.85, 'eigentum', 'WI', 'Gföhler Gneis',               '185')
  ) as v(nr, wg, gst, kg, kgnr, ha, rv, na, boden, ez)
  loop
    insert into grundstuecke (id, tenant_id, weingarten_id, gst_nr, katastralgemeinde, kg_bezeichnung, einlagezahl, rebsorte, rebsorte_id, pflanzjahr,
      flaeche_ha, flaeche_ha_kataster, spritzbar, status, nutzart, rechtsverhaeltnis, boden, unterlagsrebe, weinart, bewirtschaftung,
      bewirtschaftung_seit, trauben_herkunft_code, ama_feldnummer)
    select demo_musterhof_id(3, r.nr), c_t, w.id, r.gst, r.kgnr, r.kg, r.ez,
      case when r.na = 'WI' then w.rebsorte end, case when r.na = 'WI' then wr.rebsorte_id end, case when r.na = 'WI' then w.pflanzjahr end,
      r.ha, round(r.ha * 1.03, 4), r.na = 'WI', null, r.na, r.rv, r.boden, case when r.na = 'WI' then 'Kober 5BB' end,
      case when r.na = 'WI' then w.weinart end, 'konventionell', w.bewirtschaftung_seit, case when r.na = 'WI' then 'wlnoe' end, w.ama_feldnummer
    from weingarten w left join weingarten_rebsorten wr on wr.weingarten_id = w.id
    where w.id = demo_musterhof_id(2, r.wg);
  end loop;

  -- ── Betriebsmittel: Pflanzenschutzmittel (Mandant) ────────────────────────
  for r in select * from (values
    (1, 'Folpan 80 WDG',      'Folpan 80 WDG',      'Folpet',                     80.0, '2648-0',  'fungizid',   array['Peronospora','Botrytis'],     35, 1.6,   6, false, false, true,  0,    18.50, 'kg'),
    (2, 'Cuprozin progress',  'Cuprozin progress',  'Kupferhydroxid',             53.7, '3212-0',  'fungizid',   array['Peronospora'],                21, 2.0,   8, true,  false, true,  35,   22.00, 'kg'),
    (3, 'Bordeaux Manica 20', 'Bordeaux Manica 20 WG','Kupfersulfat (Bordeauxbrühe)',20.0,'3410-0', 'fungizid',   array['Peronospora'],                21, 3.0,   8, true,  false, true,  20,   9.80,  'kg'),
    (4, 'Topas',              'Topas',              'Penconazol',                 10.0, '2751-0',  'fungizid',   array['Oidium'],                     28, 0.25,  3, false, false, false, 0,    65.00, 'l'),
    (5, 'Netzschwefel Stulln','Netzschwefel Stulln','Schwefel',                   80.0, '2073-0',  'fungizid',   array['Oidium','Milben'],             0, 3.6,  10, true,  false, false, 0,    3.20,  'kg'),
    (6, 'Steward',            'Steward',            'Indoxacarb',                 30.0, '2809-0',  'insektizid', array['Traubenwickler'],             21, 0.125, 2, false, false, true,  0,    180.00,'kg'),
    (7, 'Mildicut',           'Mildicut',           'Cyazofamid',                 2.5,  '3055-0',  'fungizid',   array['Peronospora'],                21, 4.0,   4, false, false, true,  0,    48.00, 'l'),
    (8, 'Luna Experience',    'Luna Experience',    'Fluopyram + Tebuconazol',    40.0, '3221-0',  'fungizid',   array['Oidium','Botrytis'],          14, 0.5,   2, false, false, true,  0,    140.00,'l')
  ) as v(nr, name, hn, ws, geh, zul, kat, wb, wz, maxa, maxn, oeko, bienen, gew, cu, preis, einheit)
  loop
    insert into pflanzenschutzmittel (id, tenant_id, name, handelsname, wirkstoff, wirkstoffgehalt_pct, zulassungsnr, zulassungsgueltig, kategorie,
      wirkungsbereich, wartezeit_tage, max_aufwand_kg_ha, max_anwendungen, oeko_zugelassen, bienengefaehrlich, gewaesserschutz, cu_gehalt_pct, preis_pro_einheit, aktiv, notizen)
    values (demo_musterhof_id(4, r.nr), c_t, r.name, r.hn, r.ws, r.geh, r.zul, make_date(y + 2, 12, 31), r.kat, r.wb, r.wz, r.maxa, r.maxn,
      r.oeko, r.bienen, r.gew, r.cu, r.preis, true, 'Demo-Stammdaten (fiktive Zulassungsnummer) · Einheit ' || r.einheit);
    insert into psm_lager_bewegungen (tenant_id, psm_id, datum, typ, menge, einheit, notizen) values
      (c_t, demo_musterhof_id(4, r.nr), make_date(y1, 1, 1), 'anfangsbestand',
        case r.nr when 1 then 10 when 2 then 5 when 3 then 10 when 4 then 2 when 5 then 40 when 6 then 0.5 when 7 then 15 else 3 end, r.einheit, 'Inventur Jahresbeginn'),
      (c_t, demo_musterhof_id(4, r.nr), make_date(y1, 3, 10), 'einkauf',
        case r.nr when 1 then 40 when 2 then 40 when 3 then 40 when 4 then 10 when 5 then 200 when 6 then 1 when 7 then 100 else 10 end, r.einheit, 'Frühjahrsbestellung Lagerhaus');
    if make_date(y, 3, 12) <= d then
      insert into psm_lager_bewegungen (tenant_id, psm_id, datum, typ, menge, einheit, notizen) values
        (c_t, demo_musterhof_id(4, r.nr), make_date(y, 3, 12), 'einkauf',
          case r.nr when 1 then 40 when 2 then 40 when 3 then 40 when 4 then 10 when 5 then 200 when 6 then 1 when 7 then 100 else 10 end, r.einheit, 'Frühjahrsbestellung Lagerhaus');
    end if;
  end loop;
  if make_date(y, 6, 20) <= d then
    insert into psm_lager_bewegungen (tenant_id, psm_id, datum, typ, menge, einheit, notizen)
    values (c_t, demo_musterhof_id(4, 2), make_date(y, 6, 20), 'einkauf', 10, 'kg', 'Nachbestellung Kupfer');
  end if;

  insert into duengemittel (id, tenant_id, name, handelsname, typ, naehrstoff_n_pct, naehrstoff_p_pct, naehrstoff_k_pct, wartezeit_tage, oeko_zugelassen, einarbeitung_erforderlich, preis_pro_einheit, einheit, aktiv) values
    (demo_musterhof_id(5,1), c_t, 'Biosol',     'Biosol Pellets 6-1-1', 'organisch',   6, 1, 1,  0, true,  true,  0.85, 'kg', true),
    (demo_musterhof_id(5,2), c_t, 'Patentkali', 'Patentkali 30+10',     'mineralisch', 0, 0, 30, 0, true,  false, 0.95, 'kg', true);
  insert into duengemittel_lager_bewegungen (tenant_id, duengemittel_id, datum, typ, menge, einheit, notizen) values
    (c_t, demo_musterhof_id(5,1), make_date(y1,1,1), 'anfangsbestand', 500, 'kg', 'Inventur'),
    (c_t, demo_musterhof_id(5,1), make_date(y1,3,5), 'einkauf', 3500, 'kg', 'Lagerhaus'),
    (c_t, demo_musterhof_id(5,2), make_date(y1,1,1), 'anfangsbestand', 200, 'kg', 'Inventur'),
    (c_t, demo_musterhof_id(5,2), make_date(y1,3,5), 'einkauf', 800, 'kg', 'Lagerhaus');
  if make_date(y, 3, 8) <= d then
    insert into duengemittel_lager_bewegungen (tenant_id, duengemittel_id, datum, typ, menge, einheit, notizen) values
      (c_t, demo_musterhof_id(5,1), make_date(y,3,8), 'einkauf', 3500, 'kg', 'Lagerhaus'),
      (c_t, demo_musterhof_id(5,2), make_date(y,3,8), 'einkauf', 800, 'kg', 'Lagerhaus');
  end if;

  insert into saetze_massnahmen (id, tenant_id, art, bezeichnung, satz_pro_ha, gueltig_ab, aktiv, notizen) values
    (demo_musterhof_id(7,1), c_t, 'spritzung',        'Spritzung (Traktor + Gebläsespritze, inkl. Fahrer)', 95,  make_date(y1,1,1), true, 'ohne Mittelkosten'),
    (demo_musterhof_id(7,2), c_t, 'schnitt',          'Rebschnitt inkl. Biegen und Binden',                 650, make_date(y1,1,1), true, 'Fremdarbeitskräfte'),
    (demo_musterhof_id(7,3), c_t, 'laubarbeit',       'Laubarbeit (Ausbrechen, Heften, Entblättern)',       420, make_date(y1,1,1), true, null),
    (demo_musterhof_id(7,4), c_t, 'bodenbearbeitung', 'Bodenbearbeitung / Mulchen',                         85,  make_date(y1,1,1), true, null),
    (demo_musterhof_id(7,5), c_t, 'duengung',         'Düngung ausbringen (ohne Düngerkosten)',             60,  make_date(y1,1,1), true, null);

  -- ── Maßnahmen: Saisonvorlage für Vorjahr (komplett) und laufendes Jahr (bis heute) ──
  v_i := 0;
  foreach v_jahr in array array[y1, y] loop
    for r in select * from (values
      (1,  2, 12, 3,  6, 'schnitt',          null, null, null, null, null, '00', null,               'bewoelkt',   4,  'schwach',  null,                        'Bogrebe / Kordon',  null),
      (2,  3, 18, null,null,'bodenbearbeitung',null,null, null, null, null, '05', null,               'sonnig',     11, 'windstill',null,                        'Grubber',           '12'),
      (3,  3, 25, null,null,'duengung',       null, 1,    500,  'kg_ha',null, '07', null,               'bewoelkt',   9,  'schwach',  array[3,4,5,12],             'organisch',         null),
      (4,  4,  8, null,null,'duengung',       null, 2,    200,  'kg_ha',null, '09', null,               'sonnig',     14, 'schwach',  array[1,2,8],                'mineralisch',       null),
      (5,  5,  6, null,null,'spritzung',      5,    null, 3.6,  'kg_ha',200,  '13', 'Oidium',           'sonnig',     18, 'windstill',null,                        null,                null),
      (6,  5, 19, null,null,'spritzung',      1,    null, 1.0,  'kg_ha',300,  '53', 'Peronospora',      'bewoelkt',   17, 'schwach',  null,                        null,                null),
      (7,  5, 19, null,null,'spritzung',      5,    null, 3.6,  'kg_ha',300,  '53', 'Oidium',           'bewoelkt',   17, 'schwach',  null,                        null,                null),
      (8,  5, 30, 6,  6, 'laubarbeit',       null, null, null, null, null, '55', null,               'sonnig',     22, 'windstill',null,                        'Ausbrechen',        null),
      (9,  6,  3, null,null,'spritzung',      7,    null, 3.0,  'l_ha', 400,  '57', 'Peronospora',      'bewoelkt',   19, 'schwach',  null,                        null,                null),
      (10, 6,  3, null,null,'spritzung',      4,    null, 0.2,  'l_ha', 400,  '57', 'Oidium',           'bewoelkt',   19, 'schwach',  null,                        null,                null),
      (11, 6, 14, null,null,'spritzung',      1,    null, 1.2,  'kg_ha',400,  '65', 'Peronospora',      'sonnig',     24, 'windstill',null,                        null,                null),
      (12, 6, 14, null,null,'spritzung',      5,    null, 3.6,  'kg_ha',400,  '65', 'Oidium',           'sonnig',     24, 'windstill',null,                        null,                null),
      (13, 6, 20, 6, 27, 'laubarbeit',       null, null, null, null, null, '68', null,               'sonnig',     25, 'schwach',  null,                        'Heften / Einstricken', null),
      (14, 6, 26, null,null,'spritzung',      8,    null, 0.4,  'l_ha', 500,  '71', 'Oidium, Botrytis', 'sonnig',     26, 'windstill',null,                        null,                null),
      (15, 6, 26, null,null,'spritzung',      7,    null, 3.5,  'l_ha', 500,  '71', 'Peronospora',      'sonnig',     26, 'windstill',null,                        null,                null),
      (16, 7,  2, null,null,'spritzung',      6,    null, 0.125,'kg_ha',500,  '73', 'Traubenwickler (2. Gen.)','bewoelkt',21,'schwach', array[1,2,3,12],            null,                null),
      (17, 7,  8, null,null,'bodenbearbeitung',null,null, null, null, null, '75', null,               'sonnig',     27, 'windstill',null,                        'Mulcher',           null),
      (18, 7, 10, null,null,'spritzung',      2,    null, 1.5,  'kg_ha',600,  '75', 'Peronospora',      'sonnig',     28, 'windstill',null,                        null,                null),
      (19, 7, 10, null,null,'spritzung',      4,    null, 0.25, 'l_ha', 600,  '75', 'Oidium',           'sonnig',     28, 'windstill',null,                        null,                null),
      (20, 7, 18, 7, 24, 'laubarbeit',       null, null, null, null, null, '77', null,               'sonnig',     29, 'schwach',  array[1,2,3,4,5,12],         'Entblättern Traubenzone', null),
      (21, 7, 24, null,null,'spritzung',      3,    null, 2.5,  'kg_ha',600,  '79', 'Peronospora',      'bewoelkt',   23, 'maessig',  null,                        null,                null),
      (22, 7, 24, null,null,'spritzung',      5,    null, 2.4,  'kg_ha',600,  '79', 'Oidium',           'bewoelkt',   23, 'maessig',  null,                        null,                null),
      (23, 8, 12, null,null,'spritzung',      2,    null, 1.2,  'kg_ha',600,  '81', 'Peronospora',      'sonnig',     27, 'windstill',null,                        null,                null),
      (24, 8, 20, 8, 21, 'laubarbeit',       null, null, null, null, null, '83', null,               'sonnig',     26, 'schwach',  array[8,9,11],               'Ausdünnen / Grünlese', null),
      (25, 8, 22, null,null,'bodenbearbeitung',null,null, null, null, null, '83', null,               'bewoelkt',   22, 'schwach',  null,                        'Mulcher',           null),
      (26, 9,  1, 9,  3, 'sonstiges',        null, null, null, null, null, '85', null,               'sonnig',     24, 'windstill',null,                        'Vogelschutznetze aufziehen', null)
    ) as v(nr, mm, dd, mm2, dd2, art, psm, dg, aufwand, einheit, wasser, bbch, schaderreger, witterung, temp, wind, wgs, detail, tiefe)
    loop
      v_dt := make_date(v_jahr, r.mm, r.dd);
      if v_dt > d then continue; end if;
      v_i := v_i + 1;
      v_id := demo_musterhof_id(6, v_i);
      select coalesce(sum(g.flaeche_ha), 0) into v_ha
      from grundstuecke g join weingarten w on w.id = g.weingarten_id
      where g.tenant_id = c_t and g.nutzart = 'WI' and (r.wgs is null or w.id = any(select demo_musterhof_id(2, x) from unnest(r.wgs) x));

      insert into behandlungen (id, tenant_id, weingarten_id, psm_id, duengemittel_id, datum, datum_bis, art, witterung, temperatur_c, windstaerke,
        aufwandmenge, aufwandmenge_einheit, wasseraufwand_l_ha, behandelte_flaeche_ha, bbch_stadium, schaderreger, menge_gesamt, menge_einheit,
        konzentration, ernte_fruehesteins, wartezeit_eingehalten, bearbeitungstiefe_cm, bearbeitungsgeraet, schnittart, laubarbeit_art,
        einarbeitung, einarbeitung_zeitpunkt, reinkupfer_kg_ha, notizen, created_at, updated_at)
      select v_id, c_t,
        demo_musterhof_id(2, coalesce(r.wgs[1], 1)),
        case when r.psm is not null then demo_musterhof_id(4, r.psm) end,
        case when r.dg is not null then demo_musterhof_id(5, r.dg) end,
        v_dt, case when r.mm2 is not null then make_date(v_jahr, r.mm2, r.dd2) end, r.art, r.witterung, r.temp, r.wind,
        r.aufwand, r.einheit, r.wasser, v_ha, r.bbch, r.schaderreger,
        case when r.aufwand is not null then round(r.aufwand * v_ha, 3) end,
        case when r.aufwand is not null then (case r.einheit when 'kg_ha' then 'kg' else 'l' end) end,
        case when r.aufwand is not null and r.wasser is not null then round(r.aufwand / r.wasser * 100, 3) end,
        case when r.art = 'spritzung' then v_dt + p.wartezeit_tage end,
        case when r.art = 'spritzung' then true end,
        case when r.tiefe is not null then r.tiefe::numeric end,
        case when r.art = 'bodenbearbeitung' then r.detail end,
        case when r.art = 'schnitt' then r.detail end,
        case when r.art = 'laubarbeit' then r.detail end,
        case when r.art = 'duengung' then r.dg = 1 end,
        case when r.art = 'duengung' and r.dg = 1 then v_dt + 3 end,
        case when r.psm is not null and p.cu_gehalt_pct > 0 and r.einheit = 'kg_ha' then round(r.aufwand * p.cu_gehalt_pct / 100, 3) end,
        case when r.art = 'sonstiges' then r.detail when r.art = 'duengung' then 'Düngerart: ' || r.detail end,
        v_dt::timestamptz, v_dt::timestamptz
      from (select 1) x left join pflanzenschutzmittel p on p.id = demo_musterhof_id(4, r.psm);

      insert into behandlung_grundstuecke (behandlung_id, grundstueck_id, flaeche_ha)
      select v_id, g.id, g.flaeche_ha
      from grundstuecke g join weingarten w on w.id = g.weingarten_id
      where g.tenant_id = c_t and g.nutzart = 'WI' and (r.wgs is null or w.id = any(select demo_musterhof_id(2, x) from unnest(r.wgs) x));
    end loop;
  end loop;

  -- ── Behälter ─────────────────────────────────────────────────────────────
  for r in select * from (values
    (1,  'Stahltank 01',        'stahltank',      12000, 'Tankhalle'),
    (2,  'Stahltank 02',        'stahltank',      12000, 'Tankhalle'),
    (3,  'Stahltank 03',        'stahltank',      8000,  'Tankhalle'),
    (4,  'Stahltank 04',        'stahltank',      6000,  'Tankhalle'),
    (5,  'Stahltank 05',        'stahltank',      5000,  'Tankhalle'),
    (6,  'Stahltank 06',        'stahltank',      3000,  'Tankhalle'),
    (7,  'Stahltank 07',        'stahltank',      2000,  'Tankhalle'),
    (8,  'Stahltank 08',        'stahltank',      1500,  'Tankhalle'),
    (9,  'Immervolltank 09',    'immervolltank',  1000,  'Tankhalle'),
    (10, 'Immervolltank 10',    'immervolltank',  1000,  'Tankhalle'),
    (11, 'Stahltank 11',        'stahltank',      3000,  'Tankhalle'),
    (12, 'Holzfass 1 (1.200 l)','holzfass',       1200,  'Gewölbekeller'),
    (13, 'Holzfass 2 (600 l)',  'holzfass',       600,   'Gewölbekeller'),
    (14, 'Holzfass 3 (600 l)',  'holzfass',       600,   'Gewölbekeller'),
    (15, 'Barrique 1',          'barrique',       225,   'Gewölbekeller'),
    (16, 'Barrique 2',          'barrique',       225,   'Gewölbekeller'),
    (17, 'Barrique 3',          'barrique',       225,   'Gewölbekeller'),
    (18, 'Barrique 4',          'barrique',       225,   'Gewölbekeller'),
    (19, 'Betonei',             'betonei',        800,   'Gewölbekeller')
  ) as v(nr, name, typ, vol, ort)
  loop
    insert into behaelter (id, tenant_id, name, typ, volumen_liter, standort, aktiv, created_at)
    values (demo_musterhof_id(10, r.nr), c_t, r.name, r.typ, r.vol, r.ort, true, make_date(y1, 1, 1)::timestamptz);
  end loop;

  insert into kellerplaene (id, tenant_id, name, breite_m, laenge_m, aktiv, notizen)
  values (demo_musterhof_id(17,1), c_t, 'Hauptkeller Musterhof', 24, 12, true, 'Tankhalle (oben) und Gewölbekeller (unten)');
  for v_i in 1..19 loop
    insert into kellerplan_positionen (tenant_id, kellerplan_id, behaelter_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct)
    values (c_t, demo_musterhof_id(17,1), demo_musterhof_id(10, v_i),
      case when v_i <= 11 then 2 + ((v_i - 1) % 6) * 16 else 2 + ((v_i - 12) % 8) * 12 end,
      case when v_i <= 6 then 4 when v_i <= 11 then 26 else 60 end,
      case when v_i <= 11 then 13 else 9 end,
      case when v_i <= 11 then 18 else 14 end);
  end loop;

  -- ── Jahrgänge ─────────────────────────────────────────────────────────────
  insert into weinjahrgaenge (id, tenant_id, jahrgang, qualitaet_gesamt, witterungscharakter, ernte_beginn, ernte_ende, gesamtertrag_kg, gesamtertrag_hl,
    ama_gemeldet, ama_meldedatum, ama_meldungsnr, abgeschlossen, notizen, created_at) values
    (jg_y2, c_t, y2, 'sehr_gut', 'Trockenes Frühjahr, warmer Sommer, ideale Lese bei stabilem Wetter', make_date(y2,9,12), make_date(y2,10,8),
      88400, round(88400/130.0, 1), true, make_date(y2,11,26), 'EM-' || y2 || '-104388', true, 'Eröffnungsbestände (Reserve-Weine) im Kellerbuch erfasst', make_date(y2,9,1)::timestamptz),
    (jg_y1, c_t, y1, 'gut', 'Warmer, trockener Sommer; kühle Nächte ab Mitte September – gute Aromatik, moderate Erträge', make_date(y1,9,8), make_date(y1,10,2),
      84950, round(84950/130.0, 1), true, make_date(y1,11,28), 'EM-' || y1 || '-104711', true, 'Gebling GV zur Gänze als Trauben verkauft; Sandgrube GV teilweise', make_date(y1,9,1)::timestamptz),
    (jg_y,  c_t, y, null, case when v_ernte_y then 'Heißer Juli, Regen Mitte August – Lesebeginn Anfang September' end,
      case when v_ernte_y then make_date(y,9,2) end, null, null, null, false, null, null, false, 'Lesevorbereitung läuft – Checkliste im Dashboard', make_date(y,8,1)::timestamptz);

  for r in select * from (values
    (1,  1,  7200,  18.2, make_date(y1,9,28), 'handlese',      'Riesling Ried Pfaffenberg – Reserve',        null),
    (2,  2,  4250,  18.6, make_date(y1,10,2), 'handlese',      'Riesling Ried Steiner Hund',                 null),
    (3,  3,  11500, 17.4, make_date(y1,9,22), 'maschinenlese', 'Grüner Veltliner Kremstal DAC',              null),
    (4,  4,  17500, 16.8, make_date(y1,9,16), 'maschinenlese', 'Grüner Veltliner Sandgrube',                 '9.000 kg gepresst, 8.500 kg an Winzergenossenschaft geliefert'),
    (5,  5,  10200, 17.2, make_date(y1,9,18), 'maschinenlese', 'Traubenverkauf',                             'Gesamte Ernte an Winzergenossenschaft Kremstal geliefert'),
    (6,  6,  4200,  17.6, make_date(y1,9,14), 'handlese',      'Weißburgunder',                              null),
    (7,  7,  2570,  18.0, make_date(y1,9,12), 'handlese',      'Chardonnay',                                 null),
    (8,  8,  10200, 18.4, make_date(y1,9,30), 'handlese',      'Zweigelt Klassik / Reserve',                 null),
    (9,  9,  2100,  18.1, make_date(y1,9,24), 'selektionslese','St. Laurent Reserve',                        'Hagelschaden im Juli – geringe Menge'),
    (10, 10, 2750,  16.5, make_date(y1,9,8),  'handlese',      'Muskateller',                                null),
    (11, 11, 5200,  16.0, make_date(y1,9,10), 'maschinenlese', 'Zweigelt Rosé / Hauswein',                   'Grünlese im August'),
    (12, 12, 4900,  18.3, make_date(y1,9,23), 'handlese',      'Grüner Veltliner Kremstal DAC',              null)
  ) as v(nr, wg, kg, kmw, dt, lm, bez, notiz)
  loop
    insert into ernte_parzellen (id, jahrgang_id, weingarten_id, rebsorte_id, ernte_datum, menge_kg, menge_hl, oechsle, klosterneuburger, qualitaetsstufe,
      lesemethode, weinbezeichnung, herkunft_code, notizen, created_at)
    select demo_musterhof_id(38, r.nr), jg_y1, w.id, wr.rebsorte_id, r.dt, r.kg, round(r.kg / 130.0, 1), round(r.kmw * 4.8), r.kmw,
      'qualitaetswein', r.lm, r.bez, 'wlnoe', r.notiz, r.dt::timestamptz
    from weingarten w left join weingarten_rebsorten wr on wr.weingarten_id = w.id where w.id = demo_musterhof_id(2, r.wg);
  end loop;

  insert into ama_erntemeldungen (id, tenant_id, jahrgang_id, betriebsnummer, weinbaugebiet, status, eingereicht_am, bestaetigt_am, ama_referenznr,
    gesamtmenge_kg, gesamtmenge_hl, notizen)
  values (demo_musterhof_id(39,1), c_t, jg_y1, '1234567', 'Kremstal', 'bestaetigt', make_date(y1,11,25)::timestamptz, make_date(y1,11,28)::timestamptz,
    'EM-' || y1 || '-104711', 84950, round(84950/130.0, 1), 'Über eAMA eingereicht und bestätigt');
  insert into ama_meldepositionen (meldung_id, rebsorte_id, rebsorte_name, weingarten_name, flaeche_ha, menge_kg, menge_hl, qualitaetsstufe, oechsle)
  select demo_musterhof_id(39,1), ep.rebsorte_id, w.rebsorte, string_agg(w.ried, ', ' order by w.ried), sum(w.flaeche_ha), sum(ep.menge_kg), round(sum(ep.menge_kg)/130.0, 1),
    'qualitaetswein', round(avg(ep.klosterneuburger) * 4.8)
  from ernte_parzellen ep join weingarten w on w.id = ep.weingarten_id
  where ep.jahrgang_id = jg_y1 group by ep.rebsorte_id, w.rebsorte;

  -- ── Eröffnungsbestände (Jahrgang y2) ──
  insert into weinausbau (id, tenant_id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, anfangsbestand_liter, status, qualitaetsstufe,
    kmw, ist_eroeffnungsbestand, einstandspreis_pro_liter, transaktions_nr, weinart, herkunft_code, referenz_altsystem, notizen, aktiv, created_at) values
    (demo_musterhof_id(11,1), c_t, 'Zweigelt Reserve', y2, 'Zweigelt', demo_musterhof_id(2,8), demo_musterhof_id(10,12), 1100, 1100, 'ausbau', 'reserve',
      19.1, true, 2.80, demo_musterhof_txnr('eroeffnung', y), 'rot', 'wlnoe', 'Kellerbuch alt Nr. 17', 'Eröffnungsbestand bei Systemstart – 14 Monate Holzfass', true, make_date(y,1,1)::timestamptz),
    (demo_musterhof_id(11,2), c_t, 'St. Laurent Reserve', y2, 'St. Laurent', demo_musterhof_id(2,9), demo_musterhof_id(10,13), 580, 580, 'ausbau', 'reserve',
      18.8, true, 3.10, demo_musterhof_txnr('eroeffnung', y), 'rot', 'wlnoe', 'Kellerbuch alt Nr. 18', 'Eröffnungsbestand bei Systemstart – Füllung im Herbst geplant', true, make_date(y,1,1)::timestamptz);
  insert into weinausbau_weingaerten (tenant_id, weinausbau_id, weingarten_id) values
    (c_t, demo_musterhof_id(11,1), demo_musterhof_id(2,8)), (c_t, demo_musterhof_id(11,2), demo_musterhof_id(2,9));

  -- ── Pressungen Vorjahr → Chargen ──
  for r in select * from (values
    (1,  make_date(y1,9,8),  'Muskateller',                    16.5, 1900),
    (2,  make_date(y1,9,10), 'Zweigelt Rosé',                  16.0, 1350),
    (3,  make_date(y1,9,13), 'Zweigelt Hauswein',              16.0, 2200),
    (4,  make_date(y1,9,12), 'Chardonnay',                     18.0, 1800),
    (5,  make_date(y1,9,14), 'Weißburgunder',                  17.6, 2900),
    (6,  make_date(y1,9,16), 'Grüner Veltliner Sandgrube',     16.8, 6300),
    (7,  make_date(y1,9,24), 'Grüner Veltliner Kremstal DAC',  17.6, 11400),
    (8,  make_date(y1,9,28), 'Riesling Ried Pfaffenberg',      18.2, 5000),
    (9,  make_date(y1,10,2), 'Riesling Ried Steiner Hund',     18.6, 2950),
    (10, make_date(y1,10,4), 'St. Laurent',                    18.1, 1450),
    (11, make_date(y1,10,6), 'Zweigelt',                       18.4, 7150)
  ) as v(nr, dt, bez, kmw, liter)
  loop
    insert into pressungen (id, tenant_id, jahrgang_id, datum, most_liter_gesamt, weinbezeichnung, kmw_grad, notizen, erstellt_am)
    values (demo_musterhof_id(9, r.nr), c_t, jg_y1, r.dt, r.liter, r.bez, r.kmw,
      case r.nr when 3 then 'Nach 3 Tagen Maischestandzeit abgepresst' when 10 then 'Maischegärung 10 Tage' when 11 then 'Maischegärung 6 Tage, offener Bottich' end,
      r.dt::timestamptz);
  end loop;
  insert into pressung_weingaerten (pressung_id, weingarten_id, grundstueck_id, trauben_kg, rebsorte, ernte_datum, kmw) values
    (demo_musterhof_id(9,1),  demo_musterhof_id(2,10), demo_musterhof_id(3,15), 2750,  'Muskateller',      make_date(y1,9,8),  16.5),
    (demo_musterhof_id(9,2),  demo_musterhof_id(2,11), demo_musterhof_id(3,16), 2000,  'Zweigelt',         make_date(y1,9,10), 16.0),
    (demo_musterhof_id(9,3),  demo_musterhof_id(2,11), demo_musterhof_id(3,16), 3200,  'Zweigelt',         make_date(y1,9,10), 16.0),
    (demo_musterhof_id(9,4),  demo_musterhof_id(2,7),  demo_musterhof_id(3,11), 2570,  'Chardonnay',       make_date(y1,9,12), 18.0),
    (demo_musterhof_id(9,5),  demo_musterhof_id(2,6),  demo_musterhof_id(3,10), 4200,  'Weißburgunder',    make_date(y1,9,14), 17.6),
    (demo_musterhof_id(9,6),  demo_musterhof_id(2,4),  demo_musterhof_id(3,6),  9000,  'Grüner Veltliner', make_date(y1,9,16), 16.8),
    (demo_musterhof_id(9,7),  demo_musterhof_id(2,3),  demo_musterhof_id(3,4),  11500, 'Grüner Veltliner', make_date(y1,9,22), 17.4),
    (demo_musterhof_id(9,7),  demo_musterhof_id(2,12), demo_musterhof_id(3,17), 4900,  'Grüner Veltliner', make_date(y1,9,23), 18.3),
    (demo_musterhof_id(9,8),  demo_musterhof_id(2,1),  demo_musterhof_id(3,1),  7200,  'Riesling',         make_date(y1,9,28), 18.2),
    (demo_musterhof_id(9,9),  demo_musterhof_id(2,2),  demo_musterhof_id(3,3),  4250,  'Riesling',         make_date(y1,10,2), 18.6),
    (demo_musterhof_id(9,10), demo_musterhof_id(2,9),  demo_musterhof_id(3,14), 2100,  'St. Laurent',      make_date(y1,9,24), 18.1),
    (demo_musterhof_id(9,11), demo_musterhof_id(2,8),  demo_musterhof_id(3,12), 10200, 'Zweigelt',         make_date(y1,9,30), 18.4);

  for r in select * from (values
    (10, 1,  'Muskateller',                   'Muskateller',      10, 7,  1900, 'qualitaetswein', 'wlnoe', 'weiss', 16.5),
    (11, 2,  'Zweigelt Rosé',                 'Zweigelt',         11, 8,  1350, 'qualitaetswein', 'wlnoe', 'rose',  16.0),
    (12, 3,  'Zweigelt Hauswein',             'Zweigelt',         11, 11, 2200, 'landwein',       'wein',  'rot',   16.0),
    (13, 4,  'Chardonnay',                    'Chardonnay',       7,  9,  1000, 'qualitaetswein', 'wlnoe', 'weiss', 18.0),
    (14, 4,  'Chardonnay',                    'Chardonnay',       7,  19, 800,  'qualitaetswein', 'wlnoe', 'weiss', 18.0),
    (15, 5,  'Weißburgunder',                 'Weißburgunder',    6,  6,  2900, 'qualitaetswein', 'wlnoe', 'weiss', 17.6),
    (16, 6,  'Grüner Veltliner Sandgrube',    'Grüner Veltliner', 4,  3,  6300, 'qualitaetswein', 'wlnoe', 'weiss', 16.8),
    (17, 7,  'Grüner Veltliner Kremstal DAC', 'Grüner Veltliner', 3,  2,  11400,'dac',            'wlnoe', 'weiss', 17.6),
    (18, 8,  'Riesling Ried Pfaffenberg',     'Riesling',         1,  4,  5000, 'reserve',        'wlnoe', 'weiss', 18.2),
    (19, 9,  'Riesling Ried Steiner Hund',    'Riesling',         2,  5,  2950, 'dac',            'wlnoe', 'weiss', 18.6),
    (20, 10, 'St. Laurent',                   'St. Laurent',      9,  10, 1000, 'qualitaetswein', 'wlnoe', 'rot',   18.1),
    (21, 10, 'St. Laurent Reserve',           'St. Laurent',      9,  17, 225,  'reserve',        'wlnoe', 'rot',   18.1),
    (22, 10, 'St. Laurent Reserve',           'St. Laurent',      9,  18, 225,  'reserve',        'wlnoe', 'rot',   18.1),
    (23, 11, 'Zweigelt Klassik',              'Zweigelt',         8,  2,  6100, 'qualitaetswein', 'wlnoe', 'rot',   18.4),
    (24, 11, 'Zweigelt Reserve',              'Zweigelt',         8,  14, 600,  'reserve',        'wlnoe', 'rot',   18.4),
    (25, 11, 'Zweigelt Reserve',              'Zweigelt',         8,  15, 225,  'reserve',        'wlnoe', 'rot',   18.4),
    (26, 11, 'Zweigelt Reserve',              'Zweigelt',         8,  16, 225,  'reserve',        'wlnoe', 'rot',   18.4)
  ) as v(nr, pr, name, rebsorte, wg, beh, liter, qual, herk, weinart, kmw)
  loop
    insert into weinausbau (id, tenant_id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, anfangsbestand_liter, status, qualitaetsstufe,
      kmw, ist_eroeffnungsbestand, weinart, herkunft_code, aktiv, created_at, updated_at)
    values (demo_musterhof_id(11, r.nr), c_t, r.name, y1, r.rebsorte, demo_musterhof_id(2, r.wg), demo_musterhof_id(10, r.beh), r.liter, null, 'ausbau', r.qual,
      r.kmw, false, r.weinart, r.herk, true, (select dt from (select datum dt from pressungen where id = demo_musterhof_id(9, r.pr)) q)::timestamptz, now());
    insert into pressung_behaelter (id, pressung_id, behaelter_id, weinausbau_id, menge_liter)
    values (demo_musterhof_id(40, r.nr), demo_musterhof_id(9, r.pr), demo_musterhof_id(10, r.beh), demo_musterhof_id(11, r.nr), r.liter);
  end loop;

  insert into keller_behandlungstypen (id, tenant_id, name, einheit_standard, sort_order) values
    (demo_musterhof_id(15,1), c_t, 'Hefegabe',            'g',  10),
    (demo_musterhof_id(15,2), c_t, 'Schwefelung',         'g',  20),
    (demo_musterhof_id(15,3), c_t, 'Schönung (Bentonit)', 'kg', 30),
    (demo_musterhof_id(15,4), c_t, 'Filtration',          'l',  40),
    (demo_musterhof_id(15,5), c_t, 'Gärtemperatur',       '°C', 50);

  -- ── Warenlager: Altbestände (vor Systemstart gefüllt, ohne Kellerbuch-Charge) ──
  perform demo_musterhof_fuellen(demo_musterhof_id(19,2), null, make_date(y1,2,20), 'Grüner Veltliner Kremstal DAC', y2, 'Grüner Veltliner', 'dac', 'wlnoe',
    'Kremstal DAC', 750, 12000, 8.50, false, 'N ' || (10118 + y1 % 100) || '/' || (y1 % 100), null, 3.30, '22042193', 'Altbestand aus Vorsystem – Restmenge bei Systemstart 1.400 Fl.');
  perform demo_musterhof_fuellen(demo_musterhof_id(19,3), null, make_date(y1,7,10), 'Riesling Ried Pfaffenberg Reserve', y2, 'Riesling', 'reserve', 'wlnoe',
    'Kremstal DAC', 750, 5800, 19.50, false, 'N ' || (10577 + y1 % 100) || '/' || (y1 % 100), null, 5.10, '22042193', 'Altbestand aus Vorsystem – Restmenge bei Systemstart 700 Fl.');
  perform demo_musterhof_fuellen(demo_musterhof_id(19,1), null, make_date(y1,11,15), 'Musterhof Brut Sekt', y2, 'Chardonnay', 'sekt', 'wlnoe',
    'Kremstal', 750, 1600, 19.90, false, null, null, 7.90, '22041011', 'Traditionelle Flaschengärung (Lohnversektung), Grundwein Chardonnay/Weißburgunder ' || y2 || ' – degorgiert ' || y1);
  update fuellungen set bestand_flaschen = 1400 where id = demo_musterhof_id(19,2) and tenant_id = c_t;
  update fuellungen set bestand_flaschen = 700  where id = demo_musterhof_id(19,3) and tenant_id = c_t;

  -- ── Kellerbuch-Ablauf (chronologisch; jedes Ereignis nur, wenn Datum <= heute) ──
  v_c6 := demo_musterhof_umzug(array[demo_musterhof_id(11,17)], array[11400::numeric], demo_musterhof_id(10,1), 11350, make_date(y1,10,1),
            demo_musterhof_id(11,30), 'Grüner Veltliner Kremstal DAC', 'normal', 'Abstich vom Grobtrub nach Sedimentation');
  v_c6 := coalesce(v_c6, demo_musterhof_id(11,17));

  insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
  select c_t, wa.behaelter_id, demo_musterhof_id(15,1), 'Hefegabe', p.datum + 1, round(wa.anfangsbestand_liter_calc / 100 * 20), 'g', wa.anfangsbestand_liter_calc, wa.id,
    'Reinzuchthefe 20 g/hl, rehydriert', (p.datum + 1)::timestamptz
  from (select w.id, w.behaelter_id, pb.menge_liter as anfangsbestand_liter_calc, pb.pressung_id from weinausbau w join pressung_behaelter pb on pb.weinausbau_id = w.id where w.tenant_id = c_t) wa
  join pressungen p on p.id = wa.pressung_id;
  insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
  select c_t, w.behaelter_id, demo_musterhof_id(15,2), 'Schwefelung', make_date(y1,11,10), round(w.menge_liter * 0.04), 'g', w.menge_liter, w.id, 'Erste Schwefelung 40 mg/l nach Gärende', make_date(y1,11,10)::timestamptz
  from weinausbau w where w.tenant_id = c_t and w.id in (v_c6, demo_musterhof_id(11,16), demo_musterhof_id(11,18), demo_musterhof_id(11,19), demo_musterhof_id(11,15), demo_musterhof_id(11,10), demo_musterhof_id(11,11));
  insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
  select c_t, w.behaelter_id, demo_musterhof_id(15,2), 'Schwefelung', make_date(y1,12,5), round(w.menge_liter * 0.035), 'g', w.menge_liter, w.id, 'Schwefelung 35 mg/l nach abgeschlossenem BSA', make_date(y1,12,5)::timestamptz
  from weinausbau w where w.tenant_id = c_t and w.jahrgang = y1 and w.weinart = 'rot' and w.id <> demo_musterhof_id(11,12);

  insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, weinsaeure_gl, apfelsaeure_gl, milchsaeure_gl, dichte, extrakt_gl, bewertung, created_at)
  select c_t, w.id, make_date(y1,12,10), 'Weinlabor Krems', 'WL-' || y1 || '-' || (1800 + row_number() over (order by w.name)), a.alk, a.rz, a.gs, 0.32, a.ph, 28, 88, 2.4, 1.6, 0.2, 0.9915, 21.5, 'trocken, sauber – gärt durch', make_date(y1,12,10)::timestamptz
  from weinausbau w join (values
    (demo_musterhof_id(11,30), 12.6, 1.8, 6.1, 3.28), (demo_musterhof_id(11,16), 12.1, 2.4, 5.6, 3.35), (demo_musterhof_id(11,18), 12.9, 4.1, 7.2, 3.05),
    (demo_musterhof_id(11,19), 12.8, 5.5, 7.4, 3.02), (demo_musterhof_id(11,15), 12.7, 1.5, 5.9, 3.30), (demo_musterhof_id(11,10), 11.9, 3.2, 6.3, 3.22),
    (demo_musterhof_id(11,11), 11.8, 2.9, 5.8, 3.31), (demo_musterhof_id(11,12), 12.0, 1.2, 5.0, 3.45)
  ) a(id, alk, rz, gs, ph) on a.id = w.id where w.tenant_id = c_t;

  if make_date(y,1,15) <= d then
    insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
    select c_t, behaelter_id, demo_musterhof_id(15,3), 'Schönung (Bentonit)', make_date(y,1,15), round(menge_liter / 100 * 0.08, 1), 'kg', menge_liter, id, 'Eiweißstabilisierung 80 g/hl', make_date(y,1,15)::timestamptz
    from weinausbau where id = v_c6;
    insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, milchsaeure_gl, apfelsaeure_gl, dichte, extrakt_gl, bewertung, created_at)
    select c_t, w.id, make_date(y,1,12), 'Weinlabor Krems', 'WL-' || y || '-' || (110 + row_number() over (order by w.name)), a.alk, 1.1, a.gs, 0.45, 3.55, 26, 72, 1.9, 0.1, 0.9938, 27.8, 'BSA abgeschlossen, Tannin fein', make_date(y,1,12)::timestamptz
    from weinausbau w join (values (demo_musterhof_id(11,23), 13.1, 5.1), (demo_musterhof_id(11,24), 13.4, 5.3), (demo_musterhof_id(11,20), 12.9, 5.4), (demo_musterhof_id(11,1), 13.6, 5.2)) a(id, alk, gs) on a.id = w.id;
  end if;

  insert into dac_antrag (id, tenant_id, weinausbau_id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status, pruefnummer, eingereicht_am, bescheid_am, notizen, aktiv, created_at)
  values (demo_musterhof_id(18,1), c_t, v_c6, 'Grüner Veltliner Kremstal DAC ' || y1, 'kremstal', y1, 'Grüner Veltliner', 11350, 12.6,
    case when make_date(y,2,14) <= d then 'genehmigt' when make_date(y,1,28) <= d then 'eingereicht' else 'entwurf' end,
    case when make_date(y,2,14) <= d then 'N ' || (10230 + y % 100) || '/' || (y % 100) end,
    case when make_date(y,1,28) <= d then make_date(y,1,28) end, case when make_date(y,2,14) <= d then make_date(y,2,14) end,
    'Staatliche Prüfnummer – Kremstal DAC Gebietswein', true, make_date(y,1,28)::timestamptz);
  if make_date(y,2,18) <= d then
    insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
    select c_t, behaelter_id, demo_musterhof_id(15,4), 'Filtration', make_date(y,2,18), 9000, 'l', menge_liter, id, 'Schichtenfilter steril, Füllvorbereitung', make_date(y,2,18)::timestamptz from weinausbau where id = v_c6;
    insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, dichte, extrakt_gl, bewertung, created_at)
    values (c_t, v_c6, make_date(y,2,5), 'Weinlabor Krems', 'WL-' || y || '-0231', 12.6, 1.7, 6.0, 0.34, 3.29, 34, 102, 0.9912, 21.8, 'Füllreif – Prüfnummernprobe', make_date(y,2,5)::timestamptz);
  end if;
  perform demo_musterhof_fuellen(demo_musterhof_id(19,5), v_c6, make_date(y,2,20), 'Grüner Veltliner Kremstal DAC', y1, 'Grüner Veltliner', 'dac', 'wlnoe',
    'Kremstal DAC', 750, 12000, 8.90, false, 'N ' || (10230 + y % 100) || '/' || (y % 100), demo_musterhof_id(18,1), 3.40, '22042193', 'Hauptfüllung Frühjahr');

  if make_date(y,3,10) <= d then
    insert into verschneidungen (id, tenant_id, datum, ziel_weinausbau_id, notizen, ziel_qualitaet_vorher, ziel_herkunft_code_vorher, created_at)
    values (demo_musterhof_id(13,1), c_t, make_date(y,3,10), demo_musterhof_id(11,23), 'Cuvée Zweigelt Klassik: 1.000 l St. Laurent zur Abrundung (Zweigelt-Anteil 86 %)', 'qualitaetswein', 'wlnoe', make_date(y,3,10)::timestamptz);
    insert into verschneidung_quellen (verschneidung_id, quell_weinausbau_id, menge_liter, anteil_pct) values (demo_musterhof_id(13,1), demo_musterhof_id(11,20), 1000, 100);
    update weinausbau set menge_liter = menge_liter + 1000 where id = demo_musterhof_id(11,23) and tenant_id = c_t;
    update weinausbau set menge_liter = 0, aktiv = false, status = 'abgeschlossen' where id = demo_musterhof_id(11,20) and tenant_id = c_t;
    insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at) values
      (c_t, demo_musterhof_id(10,7), demo_musterhof_id(15,4), 'Filtration', make_date(y,3,13), 1900, 'l', 1900, demo_musterhof_id(11,10), 'Füllvorbereitung', make_date(y,3,13)::timestamptz),
      (c_t, demo_musterhof_id(10,8), demo_musterhof_id(15,4), 'Filtration', make_date(y,3,18), 1350, 'l', 1350, demo_musterhof_id(11,11), 'Füllvorbereitung', make_date(y,3,18)::timestamptz);
    insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, dichte, bewertung, created_at) values
      (c_t, demo_musterhof_id(11,10), make_date(y,3,5), 'Betriebslabor', 'BL-' || y || '-07', 11.9, 3.4, 6.2, 0.30, 3.24, 36, 98, 0.9920, 'aromatisch, füllreif', make_date(y,3,5)::timestamptz),
      (c_t, demo_musterhof_id(11,11), make_date(y,3,12), 'Betriebslabor', 'BL-' || y || '-09', 11.8, 3.0, 5.7, 0.28, 3.30, 35, 96, 0.9918, 'fruchtig, füllreif', make_date(y,3,12)::timestamptz);
  end if;
  perform demo_musterhof_fuellen(demo_musterhof_id(19,7), demo_musterhof_id(11,10), make_date(y,3,15), 'Muskateller', y1, 'Muskateller', 'qualitaetswein', 'wlnoe',
    'Kremstal', 750, 2450, 9.50, true, 'N ' || (10412 + y % 100) || '/' || (y % 100), null, 3.60, '22042193', null);
  perform demo_musterhof_fuellen(demo_musterhof_id(19,8), demo_musterhof_id(11,11), make_date(y,3,20), 'Zweigelt Rosé', y1, 'Zweigelt', 'qualitaetswein', 'wlnoe',
    'Kremstal', 750, 1760, 7.90, true, 'N ' || (10430 + y % 100) || '/' || (y % 100), null, 3.10, '22042193', null);

  if make_date(y,4,8) <= d then
    insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at) values
      (c_t, demo_musterhof_id(10,12), demo_musterhof_id(15,4), 'Filtration', make_date(y,4,8), 1100, 'l', 1100, demo_musterhof_id(11,1), 'Grobfiltration vor Füllung', make_date(y,4,8)::timestamptz);
  end if;
  perform demo_musterhof_fuellen(demo_musterhof_id(19,4), demo_musterhof_id(11,1), make_date(y,4,10), 'Zweigelt Reserve', y2, 'Zweigelt', 'reserve', 'wlnoe',
    'Kremstal', 750, 1400, 22.50, true, 'N ' || (10488 + y % 100) || '/' || (y % 100), null, 6.80, '22042194', '14 Monate Holzfass');
  if make_date(y,4,15) <= d then
    insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, dichte, bewertung, created_at) values
      (c_t, demo_musterhof_id(11,15), make_date(y,4,15), 'Weinlabor Krems', 'WL-' || y || '-0512', 12.7, 1.6, 5.8, 0.31, 3.31, 33, 99, 0.9914, 'füllreif', make_date(y,4,15)::timestamptz);
    insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at) values
      (c_t, demo_musterhof_id(10,6), demo_musterhof_id(15,4), 'Filtration', make_date(y,4,20), 2900, 'l', 2900, demo_musterhof_id(11,15), 'Füllvorbereitung', make_date(y,4,20)::timestamptz);
  end if;
  perform demo_musterhof_fuellen(demo_musterhof_id(19,9), demo_musterhof_id(11,15), make_date(y,4,22), 'Weißburgunder', y1, 'Weißburgunder', 'qualitaetswein', 'wlnoe',
    'Kremstal', 750, 3750, 9.90, true, 'N ' || (10520 + y % 100) || '/' || (y % 100), null, 3.50, '22042193', null);

  v_c5 := demo_musterhof_umzug(array[demo_musterhof_id(11,19)], array[2950::numeric], demo_musterhof_id(10,6), 2930, make_date(y,5,2),
            demo_musterhof_id(11,31), 'Riesling Ried Steiner Hund', 'normal', 'Abstich von der Feinhefe nach 7 Monaten Hefelager');
  v_c5 := coalesce(v_c5, demo_musterhof_id(11,19));
  if make_date(y,5,10) <= d then
    insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, dichte, extrakt_gl, bewertung, created_at) values
      (c_t, v_c5, make_date(y,5,10), 'Weinlabor Krems', 'WL-' || y || '-0640', 12.8, 5.2, 7.1, 0.33, 3.04, 30, 94, 0.9931, 24.1, 'Mineralisch, straff – Hefelager fortsetzen', make_date(y,5,10)::timestamptz),
      (c_t, demo_musterhof_id(11,16), make_date(y,4,28), 'Weinlabor Krems', 'WL-' || y || '-0590', 12.1, 2.3, 5.5, 0.30, 3.36, 34, 100, 0.9913, 20.9, 'füllreif', make_date(y,4,28)::timestamptz);
    insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
    select c_t, behaelter_id, demo_musterhof_id(15,4), 'Filtration', make_date(y,5,10), 3000, 'l', menge_liter, id, 'Füllvorbereitung', make_date(y,5,10)::timestamptz from weinausbau where id = demo_musterhof_id(11,16);
  end if;
  perform demo_musterhof_fuellen(demo_musterhof_id(19,10), demo_musterhof_id(11,16), make_date(y,5,12), 'Grüner Veltliner Sandgrube', y1, 'Grüner Veltliner', 'qualitaetswein', 'wlnoe',
    'Kremstal', 750, 4000, 7.50, false, 'N ' || (10601 + y % 100) || '/' || (y % 100), null, 2.90, '22042193', 'Ortswein Krems');
  if make_date(y,5,20) <= d then
    insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, dichte, extrakt_gl, bewertung, created_at) values
      (c_t, demo_musterhof_id(11,23), make_date(y,5,20), 'Weinlabor Krems', 'WL-' || y || '-0702', 13.0, 1.3, 5.1, 0.48, 3.56, 30, 78, 0.9936, 27.5, 'füllreif', make_date(y,5,20)::timestamptz);
    insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
    select c_t, behaelter_id, demo_musterhof_id(15,4), 'Filtration', make_date(y,5,26), 5250, 'l', menge_liter, id, 'Füllvorbereitung', make_date(y,5,26)::timestamptz from weinausbau where id = demo_musterhof_id(11,23);
  end if;
  perform demo_musterhof_fuellen(demo_musterhof_id(19,12), demo_musterhof_id(11,23), make_date(y,5,28), 'Zweigelt Klassik', y1, 'Zweigelt', 'qualitaetswein', 'wlnoe',
    'Kremstal', 750, 7000, 8.50, false, 'N ' || (10655 + y % 100) || '/' || (y % 100), null, 3.30, '22042194', null);

  if make_date(y,6,1) <= d then
    insert into keller_umzuege (tenant_id, von_weinausbau_id, nach_behaelter_id, menge_liter, brutto_liter, schwund_liter, datum, umzug_typ, notizen, erstellt_am) values
      (c_t, demo_musterhof_id(11,25), demo_musterhof_id(10,15), 0, 3, 3, make_date(y,6,1), 'schwund', 'Manueller Schwund (Verdunstung Barrique, nachgefüllt aus Reserve)', make_date(y,6,1)::timestamptz),
      (c_t, demo_musterhof_id(11,24), demo_musterhof_id(10,14), 0, 6, 6, make_date(y,6,1), 'schwund', 'Manueller Schwund (Verdunstung Holzfass)', make_date(y,6,1)::timestamptz);
    update weinausbau set menge_liter = menge_liter - 3 where id = demo_musterhof_id(11,25) and tenant_id = c_t;
    update weinausbau set menge_liter = menge_liter - 6 where id = demo_musterhof_id(11,24) and tenant_id = c_t;
    insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
    select c_t, w.behaelter_id, demo_musterhof_id(15,2), 'Schwefelung', make_date(y,6,1), round(w.menge_liter * 0.02), 'g', w.menge_liter, w.id, 'Nachschwefelung 20 mg/l beim Auffüllen', make_date(y,6,1)::timestamptz
    from weinausbau w where w.tenant_id = c_t and w.id in (demo_musterhof_id(11,24), demo_musterhof_id(11,25), demo_musterhof_id(11,26), demo_musterhof_id(11,21), demo_musterhof_id(11,22), demo_musterhof_id(11,2));
  end if;
  perform demo_musterhof_fuellen(demo_musterhof_id(19,6), v_c6, make_date(y,6,5), 'Grüner Veltliner Kremstal DAC 1 l', y1, 'Grüner Veltliner', 'dac', 'wlnoe',
    'Kremstal DAC', 1000, 2000, 10.90, false, 'N ' || (10230 + y % 100) || '/' || (y % 100), demo_musterhof_id(18,1), 3.40, '22042193', 'Literflasche Gastronomie');
  insert into dac_antrag (id, tenant_id, weinausbau_id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status, pruefnummer, eingereicht_am, bescheid_am, notizen, aktiv, created_at)
  values (demo_musterhof_id(18,2), c_t, demo_musterhof_id(11,18), 'Riesling Ried Pfaffenberg Kremstal DAC Reserve ' || y1, 'kremstal', y1, 'Riesling', 5000, 12.9,
    case when make_date(y,6,8) <= d then 'genehmigt' when make_date(y,5,20) <= d then 'eingereicht' else 'entwurf' end,
    case when make_date(y,6,8) <= d then 'N ' || (10690 + y % 100) || '/' || (y % 100) end,
    case when make_date(y,5,20) <= d then make_date(y,5,20) end, case when make_date(y,6,8) <= d then make_date(y,6,8) end,
    'Riedenwein Reserve', true, make_date(y,5,20)::timestamptz);
  if make_date(y,6,10) <= d then
    insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, dichte, extrakt_gl, bewertung, created_at) values
      (c_t, demo_musterhof_id(11,18), make_date(y,6,10), 'Weinlabor Krems', 'WL-' || y || '-0788', 13.0, 3.9, 7.0, 0.35, 3.06, 33, 105, 0.9925, 25.2, 'Prüfnummernprobe Reserve – dicht, mineralisch', make_date(y,6,10)::timestamptz);
    insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
    select c_t, behaelter_id, demo_musterhof_id(15,4), 'Filtration', make_date(y,6,18), 4500, 'l', menge_liter, id, 'Füllvorbereitung', make_date(y,6,18)::timestamptz from weinausbau where id = demo_musterhof_id(11,18);
  end if;
  perform demo_musterhof_fuellen(demo_musterhof_id(19,11), demo_musterhof_id(11,18), make_date(y,6,20), 'Riesling Ried Pfaffenberg Reserve', y1, 'Riesling', 'reserve', 'wlnoe',
    'Kremstal DAC', 750, 6000, 16.90, false, 'N ' || (10690 + y % 100) || '/' || (y % 100), demo_musterhof_id(18,2), 5.20, '22042193', 'Riedenwein');

  v_c8 := demo_musterhof_umzug(array[demo_musterhof_id(11,13), demo_musterhof_id(11,14)], array[1000::numeric, 800::numeric], demo_musterhof_id(10,7), 1780, make_date(y,7,15),
            demo_musterhof_id(11,32), 'Chardonnay', 'normal', 'Zusammenführung Betonei + Immervolltank vor Füllung im Herbst');
  v_c8 := coalesce(v_c8, demo_musterhof_id(11,13));
  if make_date(y,8,1) <= d then
    insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, dichte, extrakt_gl, bewertung, created_at) values
      (c_t, v_c8, make_date(y,8,1), 'Weinlabor Krems', 'WL-' || y || '-0910', 13.2, 1.4, 5.7, 0.36, 3.38, 31, 92, 0.9910, 23.0, 'cremig, Hefelager bis September', make_date(y,8,1)::timestamptz);
  end if;

  v_c10 := demo_musterhof_umzug(array[demo_musterhof_id(11,23)], array[1850::numeric], demo_musterhof_id(10,5), 1840, make_date(y,8,5),
            demo_musterhof_id(11,33), 'Zweigelt Klassik', 'normal', 'Restmenge in kleineres Gebinde (Stahltank 05) – Nachfüllung im Herbst');
  v_c10 := coalesce(v_c10, demo_musterhof_id(11,23));
  if make_date(y,6,15) <= d then
    insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, dichte, extrakt_gl, bewertung, created_at) values
      (c_t, demo_musterhof_id(11,24), make_date(y,6,15), 'Weinlabor Krems', 'WL-' || y || '-0801', 13.5, 1.0, 5.2, 0.52, 3.58, 27, 74, 0.9940, 28.3, 'Reserve – Ausbau bis Frühjahr', make_date(y,6,15)::timestamptz),
      (c_t, demo_musterhof_id(11,25), make_date(y,6,15), 'Weinlabor Krems', 'WL-' || y || '-0802', 13.6, 1.1, 5.3, 0.55, 3.57, 25, 76, 0.9941, 28.6, 'Barrique – schöne Röstaromen', make_date(y,6,15)::timestamptz),
      (c_t, demo_musterhof_id(11,2),  make_date(y,7,20), 'Weinlabor Krems', 'WL-' || y || '-0866', 13.4, 0.9, 5.4, 0.50, 3.52, 29, 80, 0.9938, 27.9, 'füllreif – Herbstfüllung planen', make_date(y,7,20)::timestamptz);
  end if;
  insert into dac_antrag (id, tenant_id, weinausbau_id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status, pruefnummer, eingereicht_am, bescheid_am, notizen, aktiv, created_at)
  values (demo_musterhof_id(18,3), c_t, v_c5, 'Riesling Ried Steiner Hund Kremstal DAC ' || y1, 'kremstal', y1, 'Riesling', 2930, 12.8,
    'eingereicht', null, d - 12, null, 'Eingereicht – Bescheid ausständig, Füllung nach Erhalt der Prüfnummer', true, (d - 12)::timestamptz);

  -- ── Laufendes Jahr: erste Pressungen ab 1. September ──
  if v_ernte_y then
    for r in select * from (values
      (1, make_date(y,9,2),  'Muskateller',   10, 15, 2100, 16.2, 8,  1450, 'weiss', 40),
      (2, make_date(y,9,6),  'Zweigelt Rosé', 11, 16, 1300, 15.8, 9,  900,  'rose',  41),
      (3, make_date(y,9,12), 'Weißburgunder', 6,  10, 4000, 17.4, 2,  2750, 'weiss', 42)
    ) as v(nr, dt, bez, wg, gst, kg, kmw, beh, liter, weinart, wa)
    loop
      if r.dt > d then continue; end if;
      insert into ernte_parzellen (id, jahrgang_id, weingarten_id, rebsorte_id, ernte_datum, menge_kg, menge_hl, klosterneuburger, oechsle, qualitaetsstufe, lesemethode, weinbezeichnung, herkunft_code, created_at)
      select demo_musterhof_id(38, 20 + r.nr), jg_y, w.id, wr.rebsorte_id, r.dt, r.kg, round(r.kg/130.0, 1), r.kmw, round(r.kmw*4.8), 'qualitaetswein', 'handlese', r.bez, 'wlnoe', r.dt::timestamptz
      from weingarten w left join weingarten_rebsorten wr on wr.weingarten_id = w.id where w.id = demo_musterhof_id(2, r.wg);
      insert into pressungen (id, tenant_id, jahrgang_id, datum, most_liter_gesamt, weinbezeichnung, kmw_grad, erstellt_am)
      values (demo_musterhof_id(9, 20 + r.nr), c_t, jg_y, r.dt, r.liter, r.bez, r.kmw, r.dt::timestamptz);
      insert into pressung_weingaerten (pressung_id, weingarten_id, grundstueck_id, trauben_kg, rebsorte, ernte_datum, kmw)
      select demo_musterhof_id(9, 20 + r.nr), demo_musterhof_id(2, r.wg), demo_musterhof_id(3, r.gst), r.kg, w.rebsorte, r.dt, r.kmw from weingarten w where w.id = demo_musterhof_id(2, r.wg);
      insert into weinausbau (id, tenant_id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, status, qualitaetsstufe, kmw, weinart, herkunft_code, aktiv, created_at)
      select demo_musterhof_id(11, r.wa), c_t, r.bez, y, w.rebsorte, w.id, demo_musterhof_id(10, r.beh), r.liter, 'gaerung', 'qualitaetswein', r.kmw, r.weinart, 'wlnoe', true, r.dt::timestamptz
      from weingarten w where w.id = demo_musterhof_id(2, r.wg);
      insert into pressung_behaelter (id, pressung_id, behaelter_id, weinausbau_id, menge_liter)
      values (demo_musterhof_id(40, 20 + r.nr), demo_musterhof_id(9, 20 + r.nr), demo_musterhof_id(10, r.beh), demo_musterhof_id(11, r.wa), r.liter);
      insert into keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, volumen_liter_ist, weinausbau_id, notizen, created_at)
      values (c_t, demo_musterhof_id(10, r.beh), demo_musterhof_id(15,1), 'Hefegabe', r.dt + 1, round(r.liter / 100 * 20), 'g', r.liter, demo_musterhof_id(11, r.wa), 'Reinzuchthefe 20 g/hl', (r.dt + 1)::timestamptz);
      for v_i in 1..8 loop
        v_dt := r.dt + 1 + v_i * 2;
        if v_dt > d - (case when r.nr = 1 then 4 else 1 end) then exit; end if;
        insert into weinanalysen (tenant_id, weinausbau_id, analyse_datum, labor, probe_nr, dichte, restzucker_gl, alkohol_vol, bewertung, created_at)
        values (c_t, demo_musterhof_id(11, r.wa), v_dt, 'Betriebslabor', 'GK-' || r.nr || '-' || v_i, round(1.078 - v_i * 0.011, 4), round(greatest(2, 170 - v_i * 22)), round(least(12.5, v_i * 1.6), 1), 'Gärkontrolle', v_dt::timestamptz);
      end loop;
    end loop;
  end if;

  insert into sonstige_artikel (id, tenant_id, name, einheit, default_preis, aktiv) values
    (demo_musterhof_id(20,1), c_t, '6er-Karton (Versand)',              'Stk',    1.50,  true),
    (demo_musterhof_id(20,2), c_t, 'Geschenkverpackung 1 Flasche',      'Stk',    3.50,  true),
    (demo_musterhof_id(20,3), c_t, 'Weinverkostung mit Kellerführung',  'Person', 15.00, true),
    (demo_musterhof_id(20,4), c_t, 'Traubensaft 1 l',                   'Stk',    4.50,  true);

  insert into rabattgruppen (id, tenant_id, name, rabatt_pct, notizen) values
    (demo_musterhof_id(21,1), c_t, 'Gastronomie', 15, 'Standardrabatt Gastronomie ab 24 Flaschen'),
    (demo_musterhof_id(21,2), c_t, 'Handel',      20, 'Wiederverkäufer / Vinotheken');

  -- ── CRM: Firmen ──
  for r in select * from (values
    (1,  'Gasthaus Zur Donaubrücke',           'gastronomie', 'Donaulände 4',        '3500', 'Krems an der Donau',  'AT', 'office@donaubruecke.example',  1,    false, true,  false, 30, null,  null,  '+43 2732 55123'),
    (2,  'Restaurant Weinberg',                'gastronomie', 'Steiner Landstraße 88','3500','Krems-Stein',         'AT', 'kueche@weinberg.example',      1,    false, true,  false, 30, null,  null,  '+43 2732 44987'),
    (3,  'Vinothek am Steiner Tor',            'handel',      'Obere Landstraße 2',  '3500', 'Krems an der Donau',  'AT', 'info@vinothek-steinertor.example', 2, false, true,  false, 30, null,  null,  '+43 2732 70011'),
    (4,  'Kremser Getränkegroßhandel GmbH',    'grosshandel', 'Industriestraße 15',  '3500', 'Krems an der Donau',  'AT', 'einkauf@kgh.example',          null, false, true,  false, 30, null,  null,  '+43 2732 81000'),
    (5,  'Vinum Nord GmbH',                    'export',      'Speicherstadt 12',    '20457','Hamburg',             'DE', 'import@vinumnord.example',     null, false, true,  false, 30, 'DAP', 'Deutschland', '+49 40 123456'),
    (6,  'Weinkellerei Helvetia AG',           'export',      'Bahnhofstrasse 77',   '8001', 'Zürich',              'CH', 'einkauf@helvetia-wein.example', null, false, true, false, 30, 'EXW', 'Schweiz', '+41 44 5550101'),
    (7,  'Winzergenossenschaft Kremstal eGen', 'produzent',   'Sandgrube 1',         '3500', 'Krems an der Donau',  'AT', 'traubenuebernahme@wg-kremstal.example', null, false, true, false, 30, null, null, '+43 2732 90000'),
    (8,  'Hotel Donauhof',                     'gastronomie', 'Hauptstraße 21',      '3601', 'Dürnstein',           'AT', 'fb@donauhof.example',          1,    true,  true,  false, 30, null,  null,  '+43 2711 30030'),
    (9,  'Glashütte Donau GmbH',               'handel',      'Glasweg 3',           '3380', 'Pöchlarn',            'AT', 'verkauf@glashuette-donau.example', null, false, false, true, 30, null, null,  '+43 2757 60600'),
    (10, 'Etiketten Steiner GmbH',             'handel',      'Druckereistraße 9',   '3100', 'St. Pölten',          'AT', 'office@etiketten-steiner.example', null, false, false, true, 30, null, null, '+43 2742 33221')
  ) as v(nr, name, seg, str, plz, ort, land, email, rg, lead, kunde, lief, zz, inco, impv, tel)
  loop
    insert into firmen (id, tenant_id, name, segment, strasse, plz, ort, land, telefon, email, uid_nummer, zahlungsziel_tage, waehrung, incoterms, importeur_von,
      aktiv, kundennummer, rabattgruppe_id, is_lead, ist_kunde, ist_lieferant, skonto_pct, skonto_tage, erstellt_am, notizen)
    values (demo_musterhof_id(22, r.nr), c_t, r.name, r.seg::kundensegment, r.str, r.plz, r.ort, r.land, r.tel, r.email,
      case r.land when 'AT' then 'ATU' || (60000000 + r.nr * 1111) when 'DE' then 'DE' || (200000000 + r.nr) else 'CHE-' || (100 + r.nr) || '.222.333' end,
      r.zz, 'EUR', r.inco, r.impv, true, 'K-' || lpad(r.nr::text, 4, '0'),
      case when r.rg is not null then demo_musterhof_id(21, r.rg) end, r.lead, r.kunde, r.lief, case when r.nr in (5,6) then 2 else 0 end, 10,
      (d - 300 + r.nr * 7)::timestamptz, case r.nr when 7 then 'Traubenabnehmer (Gebling GV, Teil Sandgrube)' when 9 then 'Lieferant Flaschen' when 10 then 'Lieferant Etiketten' end);
  end loop;

  for r in select * from (values
    (11, 'Franz',     'Huber',        'privat',      null, null,               false, 'Weinzierl 14',        '3500', 'Krems an der Donau', 'franz.huber@example.at',      true,  true,  false, make_date(1968,5,14)),
    (12, 'Elisabeth', 'Maier',        'privat',      null, null,               false, 'Rennweg 22/4',        '1030', 'Wien',               'elisabeth.maier@example.at',  true,  true,  false, make_date(1975,11,2)),
    (13, 'Georg',     'Berger',       'privat',      null, null,               false, 'Landstraße 9',        '4020', 'Linz',               'g.berger@example.at',         false, false, false, make_date(1981,3,23)),
    (14, 'Martina',   'Novak',        'privat',      null, null,               false, 'Kremser Gasse 5',     '3100', 'St. Pölten',         'martina.novak@example.at',    true,  true,  false, make_date(1979,8,30)),
    (15, 'Peter',     'Wagner',       'privat',      null, null,               false, 'Hauptplatz 3',        '3500', 'Krems an der Donau', 'peter.wagner@example.at',     false, false, false, make_date(1990,1,17)),
    (16, 'Sabine',    'Leitner',      'privat',      null, null,               false, 'Am Kanal 11',         '1220', 'Wien',               'sabine.leitner@example.at',   true,  false, false, make_date(1986,6,9)),
    (17, 'Karl',      'Steiner',      'privat',      null, null,               false, 'Bergstraße 40',       '3512', 'Mautern',            'karl.steiner@example.at',     false, false, false, make_date(1959,12,1)),
    (18, 'Anna',      'Fischer',      'privat',      null, null,               false, 'Schulgasse 7',        '3542', 'Gföhl',              'anna.fischer@example.at',     true,  false, false, make_date(1993,4,12)),
    (19, 'Johann',    'Kaltenbrunner','gastronomie', 1,    'Inhaber / Wirt',   true,  null, null, null,                                    'j.kaltenbrunner@donaubruecke.example', false, false, false, null),
    (20, 'Sabine',    'Rieder',       'handel',      3,    'Geschäftsführung', true,  null, null, null,                                    's.rieder@vinothek-steinertor.example', true, false, false, null),
    (21, 'Jens',      'Petersen',     'export',      5,    'Einkauf Österreich', true, null, null, null,                                  'j.petersen@vinumnord.example', false, false, false, null),
    (22, 'Marco',     'Brunner',      'export',      6,    'Leiter Einkauf',   true,  null, null, null,                                    'm.brunner@helvetia-wein.example', false, false, false, null),
    (23, 'Thomas',    'Eder',         'grosshandel', 4,    'Einkauf Fasswein', true,  null, null, null,                                    't.eder@kgh.example',           false, false, false, null),
    (24, 'Julia',     'Pichler',      'privat',      null, null,               false, 'Lerchenfelder Str. 3','3500', 'Krems an der Donau', 'julia.pichler@example.at',    false, false, true,  make_date(1996,9,5)),
    (25, 'Andreas',   'Kern',         'privat',      null, null,               false, 'Wiener Straße 120',   '3500', 'Krems an der Donau', 'andreas.kern@example.at',     false, false, true,  make_date(1984,2,27))
  ) as v(nr, vn, nn, seg, firma, pos, haupt, str, plz, ort, email, nl, stamm, lead, geb)
  loop
    insert into kontakte (id, tenant_id, vorname, nachname, segment, firma_id, email, telefon, mobil, strasse, plz, ort, land, geburtsdatum, newsletter, newsletter_bestaetigt,
      sprache, stammkunde, aktiv, kundennummer, is_lead, skonto_pct, skonto_tage, zahlungsziel_tage, erstellt_am, notizen)
    values (demo_musterhof_id(23, r.nr), c_t, r.vn, r.nn, r.seg::kundensegment, case when r.firma is not null then demo_musterhof_id(22, r.firma) end, r.email,
      case when r.firma is null then '2732 ' || (40000 + r.nr * 37) end, '664 ' || (1000000 + r.nr * 4711), r.str, r.plz, r.ort, 'AT', r.geb, r.nl, r.nl,
      'de', r.stamm, true, 'K-' || lpad(r.nr::text, 4, '0'), r.lead, 0, 10, 14, (d - 280 + r.nr * 9)::timestamptz,
      case r.nr when 24 then 'Lead von der Weinmesse – plant Hochzeit im Herbst' when 25 then 'Interessiert an Firmengeschenken' end);
    if r.firma is not null then
      insert into kontakt_firmen (kontakt_id, firma_id, position, hauptkontakt) values (demo_musterhof_id(23, r.nr), demo_musterhof_id(22, r.firma), r.pos, r.haupt);
    end if;
  end loop;

  insert into konten (id, tenant_id, name, iban, typ, eroeffnungsdatum, eroeffnungssaldo, aktiv, sortierung) values
    (k_giro,  c_t, 'Raiffeisenbank Krems – Betriebskonto', 'AT61 3200 0000 1234 5678', 'giro',  make_date(y1,1,1), 18500, true, 1),
    (k_kassa, c_t, 'Handkassa Ab-Hof-Verkauf',              null,                       'kassa', make_date(y1,1,1), 350,   true, 2);
  insert into ea_kategorien (id, tenant_id, typ, name, konto_nr, ust_satz_std, aktiv, sortierung, abzugsfaehig_pct) values
    (demo_musterhof_id(29,1), c_t, 'einnahme', 'Weinverkauf Ab Hof (13 %)',        4001, 13, true, 11,  100),
    (demo_musterhof_id(29,2), c_t, 'ausgabe',  'Lohn Erntehelfer / Aushilfen',     6100, 0,  true, 161, 100),
    (demo_musterhof_id(29,3), c_t, 'ausgabe',  'Laboranalysen & Prüfnummern',      7850, 20, true, 135, 100);

  -- ── Verkäufe der letzten 8 Monate ──
  for r in select * from (values
    (1,  238, null, 1,  '[{"t":"f","f":2,"m":60,"r":20},{"t":"f","f":3,"m":24,"r":20}]',                                        '{"art":"bank","tage":12}', false),
    (2,  232, 11,   null,'[{"t":"f","f":1,"m":12},{"t":"f","f":2,"m":6}]',                                                       '{"art":"bar","tage":0}',   false),
    (3,  225, null, 1,  '[{"t":"f","f":2,"m":48,"r":15},{"t":"f","f":1,"m":12,"r":15}]',                                        '{"art":"bank","tage":20}', false),
    (4,  214, null, 5,  '[{"t":"f","f":2,"m":300,"p":8.00,"u":0},{"t":"f","f":3,"m":120,"p":18.50,"u":0}]',                     '{"art":"bank","tage":30}', false),
    (5,  205, 12,   null,'[{"t":"f","f":1,"m":6},{"t":"f","f":3,"m":6},{"t":"s","s":2,"m":1}]',                                  '{"art":"karte","tage":0}', false),
    (6,  198, null, 4,  '[{"t":"w","w":"WA12","m":1000,"p":1.60}]',                                                             '{"art":"bank","tage":25}', false),
    (7,  190, null, 4,  '[{"t":"w","w":"WA16","m":2000,"p":2.20}]',                                                             '{"art":"bank","tage":28}', false),
    (8,  182, 13,   null,'[{"t":"f","f":5,"m":12},{"t":"f","f":1,"m":6}]',                                                       '{"art":"bar","tage":0}',   false),
    (9,  176, null, 2,  '[{"t":"f","f":5,"m":36,"r":15},{"t":"f","f":2,"m":12,"r":15},{"t":"s","s":1,"m":6}]',                  '{"art":"bank","tage":18}', false),
    (10, 168, null, 3,  '[{"t":"f","f":5,"m":48,"r":20},{"t":"f","f":2,"m":24,"r":20},{"t":"f","f":3,"m":12,"r":20}]',          '{"art":"bank","tage":14}', false),
    (11, 160, 14,   null,'[{"t":"f","f":7,"m":6},{"t":"f","f":8,"m":6},{"t":"s","s":2,"m":2}]',                                  '{"art":"karte","tage":0}', false),
    (12, 152, null, 6,  '[{"t":"f","f":5,"m":240,"p":8.20,"u":0},{"t":"f","f":3,"m":60,"p":18.50,"u":0},{"t":"f","f":7,"m":60,"p":8.50,"u":0}]', '{"art":"bank","tage":35}', false),
    (13, 145, null, 1,  '[{"t":"f","f":5,"m":60,"r":15},{"t":"f","f":8,"m":24,"r":15},{"t":"f","f":7,"m":12,"r":15}]',          '{"art":"bank","tage":22}', false),
    (14, 138, 15,   null,'[{"t":"f","f":5,"m":24},{"t":"f","f":4,"m":12},{"t":"s","s":1,"m":4}]',                                '{"art":"bank","tage":10}', false),
    (15, 130, null, 5,  '[{"t":"f","f":5,"m":600,"p":7.90,"u":0},{"t":"f","f":8,"m":120,"p":6.90,"u":0},{"t":"f","f":7,"m":120,"p":8.20,"u":0}]', '{"art":"bank","tage":30}', false),
    (16, 121, 16,   null,'[{"t":"f","f":1,"m":6},{"t":"f","f":4,"m":6},{"t":"f","f":9,"m":6}]',                                  '{"art":"bar","tage":0}',   false),
    (17, 112, null, 2,  '[{"t":"f","f":9,"m":24,"r":15},{"t":"f","f":5,"m":36,"r":15},{"t":"f","f":4,"m":12,"r":15}]',          '{"art":"bank","tage":20}', false),
    (18, 104, null, 3,  '[{"t":"f","f":10,"m":48,"r":20},{"t":"f","f":9,"m":24,"r":20},{"t":"f","f":8,"m":24,"r":20}]',         '{"art":"bank","tage":15}', false),
    (19, 96,  17,   null,'[{"t":"f","f":10,"m":12},{"t":"f","f":7,"m":6},{"t":"s","s":3,"m":4}]',                                '{"art":"karte","tage":0}', false),
    (20, 88,  null, 4,  '[{"t":"w","w":"WA12","m":800,"p":1.60}]',                                                              '{"art":"bank","tage":20}', false),
    (21, 74,  null, 1,  '[{"t":"f","f":12,"m":48,"r":15},{"t":"f","f":5,"m":24,"r":15},{"t":"f","f":6,"m":12,"r":15}]',         '{"art":"bank","tage":20}', false),
    (22, 61,  null, 6,  '[{"t":"f","f":11,"m":120,"p":15.50,"u":0},{"t":"f","f":5,"m":300,"p":8.20,"u":0}]',                    null, false),
    (23, 47,  18,   null,'[{"t":"f","f":11,"m":12},{"t":"f","f":4,"m":6},{"t":"s","s":2,"m":2}]',                                null, false),
    (24, 28,  null, 2,  '[{"t":"f","f":5,"m":36,"r":15},{"t":"f","f":11,"m":24,"r":15},{"t":"f","f":12,"m":12,"r":15}]',        null, false),
    (25, 20,  11,   null,'[{"t":"f","f":5,"m":6},{"t":"f","f":8,"m":6}]',                                                        null, true),
    (26, 12,  null, 3,  '[{"t":"f","f":5,"m":60,"r":20},{"t":"f","f":12,"m":36,"r":20},{"t":"f","f":11,"m":24,"r":20}]',        null, false),
    (27, 6,   14,   null,'[{"t":"f","f":5,"m":12},{"t":"f","f":8,"m":12},{"t":"s","s":1,"m":2}]',                                null, false)
  ) as v(nr, tage, kontakt, firma, pos, zahlung, storno)
  loop
    perform demo_musterhof_verkauf(demo_musterhof_id(26, r.nr), r.nr, d - r.tage,
      case when r.kontakt is not null then demo_musterhof_id(23, r.kontakt) end,
      case when r.firma is not null then demo_musterhof_id(22, r.firma) end,
      replace(replace(r.pos, '"WA12"', '"' || demo_musterhof_id(11,12) || '"'), '"WA16"', '"' || demo_musterhof_id(11,16) || '"')::jsonb,
      case when r.zahlung is not null then (r.zahlung::jsonb || jsonb_build_object('konto', case when r.zahlung like '%bar%' then k_kassa else k_giro end)) end,
      r.storno,
      case r.nr when 25 then 'Storniert – Kunde hat Bestellung zurückgezogen' when 22 then 'Export CH – Lieferung mit Zollpapieren' when 6 then 'Fasswein lose, Abholung mit Tankwagen' end);
  end loop;

  -- ── CRM: Aktivitäten (±40 Tage) und Pipeline ──
  for r in select * from (values
    (1,  -38, 'verkostung',  null, 3, 'Verkostung Jahrgang ' || y1 || ' in der Vinothek',        'Sortiment vorgestellt, Riesling Reserve kommt sehr gut an', true,  null, true,  null, null, null),
    (2,  -35, 'anruf',       null, 5, 'Nachfrage Jahreskontingent GV Kremstal DAC',                'Vinum Nord möchte 1.200 Fl. für Herbst reservieren',        true,  null, true,  null, null, null),
    (3,  -30, 'besuch',      null, 1, 'Lieferung und Gespräch Hausmarke Zweigelt',                 'Zweigelt Klassik als Hauswein ab Herbst fix',               true,  null, true,  null, null, null),
    (4,  -28, 'email',       13,   null, 'Angebot Riesling Reserve gesendet',                       null,                                                        true,  null, true,  null, null, null),
    (5,  -25, 'notiz',       null, 6, 'Zollpapiere Lieferung Schweiz erledigt',                    'EUR.1 und Lieferschein an Spedition übermittelt',           true,  null, true,  null, null, null),
    (6,  -21, 'besprechung', null, null, 'Lesevorbereitung – Teambesprechung',                     'Erntehelfer, Lesekisten, Presse-Service abgestimmt',        true,  null, false, '09:00', '10:30', null),
    (7,  -18, 'anruf',       18,   null, 'Zahlungserinnerung RE-0023',                              'Kundin zahlt nächste Woche per Überweisung',                true,  null, true,  null, null, null),
    (8,  -14, 'verkostung',  25,   null, 'Kellerverkostung Firmengeschenke',                        'Interesse an 40 Geschenkpaketen zu Weihnachten',            true,  null, true,  null, null, null),
    (9,  -9,  'messe',       null, null, 'Weinfest Krems – Ausschankstand',                         'Guter Zulauf, 60 Flaschen verkauft, 12 Newsletter-Anmeldungen', true, null, true, null, null, -8),
    (10, -7,  'aufgabe',     null, 6, 'Mahnung RE-0022 an Helvetia senden',                        'Rechnung 61 Tage offen',                                    false, -2,   true,  null, null, null),
    (11, -5,  'anruf',       null, 2, 'Herbstkarte abstimmen',                                     'Riesling Steiner Hund nach Prüfnummer, Chardonnay im Oktober', true, null, true, null, null, null),
    (12, -3,  'email',       null, 8, 'Sortimentsvorschlag Hotel Donauhof',                        'Preisliste Gastronomie + Verkostungsmuster angeboten',      true,  null, true,  null, null, null),
    (13, -1,  'aufgabe',     null, null, 'Preisliste Herbst aktualisieren',                        null,                                                        false, 3,    true,  null, null, null),
    (14, 2,   'besuch',      null, 4, 'Tankwein-Angebot Hauswein ' || y,                           'Besichtigung Kellerei, Mengen für Herbst',                  false, null, false, '14:00', '15:00', null),
    (15, 4,   'verkostung',  24,   null, 'Sektverkostung für Hochzeit',                             null,                                                        false, null, false, '17:00', '18:30', null),
    (16, 7,   'aufgabe',     null, 10, 'Etiketten Jahrgang ' || y || ' bestellen',                  'Entwürfe freigeben, Auflage 40.000',                        false, 7,    true,  null, null, null),
    (17, 12,  'besprechung', null, null, 'Steuerberatung – Quartalsbesprechung',                    'UVA Q3, Betriebsausgaben Lese',                             false, null, false, '10:00', '11:00', null),
    (18, 18,  'besuch',      null, 5, 'Besuch Importeur Hamburg',                                   'Jahresplanung, Messebeteiligung',                           false, null, true,  null, null, 19),
    (19, 25,  'messe',       null, null, 'Messe VinoNÖ St. Pölten',                                 'Stand 4/12',                                                false, null, true,  null, null, 26),
    (20, 33,  'angebot',     null, 8, 'Angebot Hotelkarte Donauhof',                                null,                                                        false, null, true,  null, null, null),
    (21, 40,  'aufgabe',     null, null, 'Inventur Flaschenlager vorbereiten',                     'Zähllisten je Füllung drucken',                             false, 40,   true,  null, null, null)
  ) as v(nr, tage, art, kontakt, firma, betreff, beschr, erledigt, faellig, ganztags, von, bis, bis_tage)
  loop
    insert into aktivitaeten (id, tenant_id, kontakt_id, firma_id, art, betreff, beschreibung, datum, erledigt, faellig_am, ganztags, uhrzeit_von, uhrzeit_bis, bis_datum, erstellt_am)
    values (demo_musterhof_id(24, r.nr), c_t,
      case when r.kontakt is not null then demo_musterhof_id(23, r.kontakt) end,
      case when r.firma is not null then demo_musterhof_id(22, r.firma) end,
      r.art, r.betreff, r.beschr, d + r.tage, r.erledigt, case when r.faellig is not null then d + r.faellig end, r.ganztags,
      r.von::time, r.bis::time, case when r.bis_tage is not null then d + r.bis_tage end, least(d, d + r.tage - 3)::timestamptz);
  end loop;

  for r in select * from (values
    (1, null, 8,  'interessent',  'Sortiment für Hotelkarte',                    2400, 20,  45,  'sortiment',     false, null, 'Erstkontakt über Weinfest Krems'),
    (2, 24,   null,'kontaktiert', 'Hochzeit – Sekt & Weißwein',                  1200, 30,  30,  'veranstaltung', false, null, '80 Personen, Termin Oktober'),
    (3, 25,   null,'verkostung',  'Firmengeschenke Weihnachten',                 900,  40,  60,  'sonstiges',     false, null, '40 Geschenkpakete à 2 Flaschen'),
    (4, null, 5,  'angebot',      'Jahreskontingent GV Kremstal DAC ' || y1,     9600, 60,  20,  'export',        false, null, 'Angebot über 1.200 Fl. gesendet'),
    (5, null, 2,  'verhandlung',  'Riesling Reserve für Herbstkarte',            1800, 70,  10,  'weisswein',     false, null, 'Preis je Fl. offen (Gastro-Rabatt)'),
    (6, null, 1,  'abschluss',    'Zweigelt Klassik als Hausmarke',              2000, 100, -15, 'rotwein',       true,  -15,  'Fix – Lieferung monatlich'),
    (7, null, 3,  'stammkunde',   'Weihnachtsaktion Kremstal-Paket',             3000, 90,  70,  'sortiment',     false, null, 'Vinothek bestellt jährlich'),
    (8, null, null,'verloren',    'Weinbar Linz – Fasswein-Anfrage',             1500, 0,   -30, 'fasswein',      true,  -20,  'Preislich nicht einig')
  ) as v(nr, kontakt, firma, stufe, titel, wert, wk, tage, kat, erledigt, erl_tage, notiz)
  loop
    insert into pipeline_eintraege (id, tenant_id, kontakt_id, firma_id, stufe, titel, wert_euro, wahrscheinlichkeit, erwartetes_datum, notizen, kategorie, erledigt, erledigt_am, erstellt_am)
    values (demo_musterhof_id(25, r.nr), c_t,
      case when r.kontakt is not null then demo_musterhof_id(23, r.kontakt) end,
      case when r.firma is not null then demo_musterhof_id(22, r.firma) end,
      r.stufe::pipeline_stufe, r.titel, r.wert, r.wk, d + r.tage, r.notiz, r.kat, r.erledigt,
      case when r.erl_tage is not null then (d + r.erl_tage)::timestamptz end, (d - 60)::timestamptz);
  end loop;

  -- ── E&A ──
  insert into ea_dauerauftraege (id, tenant_id, typ, beschreibung, kategorie_id, betrag_netto, ust_satz, intervall, tag_im_monat, naechste_faelligkeit, aktiv, konto_id, notizen) values
    (demo_musterhof_id(32,1), c_t, 'ausgabe', 'Pacht Rieden Sandgrube / Frechau / Steiner Hund', demo_musterhof_kat('Miete & Pacht'), 420, 0, 'monatlich', 5,
      case when extract(day from d) >= 5 then (date_trunc('month', d) + interval '1 month' + interval '4 days')::date else (date_trunc('month', d) + interval '4 days')::date end, true, k_giro, 'Pachtvertrag bis ' || (y + 4)),
    (demo_musterhof_id(32,2), c_t, 'ausgabe', 'Betriebsversicherung (Hagel, Haftpflicht, Gebäude)', demo_musterhof_kat('Versicherungen'), 680, 0, 'vierteljaehrlich', 15,
      (select min(x)::date from generate_series(make_date(y1,1,15), make_date(y+1,12,15), interval '3 months') x where x > d), true, k_giro, null),
    (demo_musterhof_id(32,3), c_t, 'ausgabe', 'Strom Keller & Kühlung (Teilzahlung)', demo_musterhof_kat('Energie (Strom, Gas)'), 310, 20, 'monatlich', 20,
      case when extract(day from d) >= 20 then (date_trunc('month', d) + interval '1 month' + interval '19 days')::date else (date_trunc('month', d) + interval '19 days')::date end, true, k_giro, null);
  for v_dt in select x::date from generate_series(make_date(y1,1,5), d, interval '1 month') x loop
    perform demo_musterhof_ea('ausgabe', v_dt, 'Pacht Rieden (Dauerauftrag)', 'Miete & Pacht', 420, 0, k_giro, null, demo_musterhof_id(32,1));
  end loop;
  for v_dt in select x::date from generate_series(make_date(y1,1,20), d, interval '1 month') x loop
    perform demo_musterhof_ea('ausgabe', v_dt, 'Strom Keller & Kühlung (Dauerauftrag)', 'Energie (Strom, Gas)', 310, 20, k_giro, null, demo_musterhof_id(32,3));
  end loop;
  for v_dt in select x::date from generate_series(make_date(y1,1,15), d, interval '3 months') x loop
    perform demo_musterhof_ea('ausgabe', v_dt, 'Betriebsversicherung Quartal (Dauerauftrag)', 'Versicherungen', 680, 0, k_giro, null, demo_musterhof_id(32,2));
  end loop;
  perform demo_musterhof_ea('einnahme', make_date(y1,11,30), 'Traubenabrechnung Winzergenossenschaft Kremstal – Lese ' || y1 || ' (18.700 kg)', 'Traubenverkauf', 9724, 13, k_giro, demo_musterhof_id(22,7), null);
  for r in select * from (values
    (236, 'Flaschen Bordeaux 0,75 l – 12 Paletten',           'Flaschen & Verpackung',           4800, 20, 'g', 9),
    (229, 'Etikettendruck Jahrgang ' || y1,                     'Flaschen & Verpackung',           1650, 20, 'g', 10),
    (222, 'Naturkorken, 20.000 Stk.',                           'Flaschen & Verpackung',           2900, 20, 'g', null),
    (200, 'Kellerhilfsstoffe (Bentonit, Hefe, Schwefel)',       'Hilfsstoffe (Kellerei)',          620,  20, 'g', null),
    (188, 'Traktorservice inkl. Ölwechsel',                     'Reparatur & Instandhaltung',      1340, 20, 'g', null),
    (175, 'Pflanzenschutzmittel Frühjahrsbestellung',           'Pflanzenschutzmittel',            3850, 20, 'g', null),
    (168, 'Düngemittel Biosol / Patentkali',                    'Dünger & Bodenverbesserung',      1980, 20, 'g', null),
    (160, 'Messe VieVinum – Standgebühr',                       'Marketing & Messen',              2400, 20, 'g', null),
    (150, 'Büromaterial & Software-Abo',                        'Büro & Verwaltung',               240,  20, 'k', null),
    (140, 'Geschäftsessen Importeur Vinum Nord',                'Bewirtung / Repräsentation (Geschäftsessen)', 180, 10, 'k', 5),
    (128, 'Diesel Betrieb',                                     'Fahrzeug & Transport',            410,  20, 'k', null),
    (118, 'Reparatur Traubenpresse (Membran)',                  'Reparatur & Instandhaltung',      890,  20, 'g', null),
    (105, '6er-Kartonagen, 3.000 Stk.',                         'Flaschen & Verpackung',           780,  20, 'g', null),
    (95,  'Aushilfe Laubarbeit (Stundenlohn)',                  'Lohn Erntehelfer / Aushilfen',    1200, 0,  'g', null),
    (70,  'Kupferpräparat Nachbestellung',                      'Pflanzenschutzmittel',            640,  20, 'g', null),
    (60,  'Laboranalysen Weinlabor Krems (Prüfnummernproben)',  'Laboranalysen & Prüfnummern',     320,  20, 'g', null),
    (50,  'Werbung Social Media',                               'Marketing & Messen',              150,  20, 'g', null),
    (38,  'Aushilfe Grünlese',                                  'Lohn Erntehelfer / Aushilfen',    800,  0,  'k', null),
    (25,  'Lesekisten & Kleinmaterial',                         'Sonstige Betriebsausgaben',       260,  20, 'g', null),
    (15,  'Hefen & Enzyme für die Lese',                        'Hilfsstoffe (Kellerei)',          540,  20, 'g', null),
    (8,   'Diesel Betrieb',                                     'Fahrzeug & Transport',            380,  20, 'k', null)
  ) as v(tage, beschr, kat, netto, ust, konto, firma)
  loop
    perform demo_musterhof_ea('ausgabe', d - r.tage, r.beschr, r.kat, r.netto, r.ust, case when r.konto = 'g' then k_giro else k_kassa end,
      case when r.firma is not null then demo_musterhof_id(22, r.firma) end, null);
  end loop;
  perform demo_musterhof_ea('einnahme', d - 120, 'Verkostungsgebühren Busgruppe (22 Personen)', 'Sonstige Betriebseinnahmen', 330, 20, k_kassa, null, null);

  v_letzter_monat := (date_trunc('month', d) - interval '2 months')::date;
  for v_dt in select x::date from generate_series(make_date(y1,1,1), v_letzter_monat, interval '1 month') x loop
    perform sperre_ea_monat(c_t, extract(year from v_dt)::smallint, extract(month from v_dt)::smallint);
  end loop;
  for v_dt in select x::date from generate_series(make_date(y1,1,1), d, interval '3 months') x loop
    v_q := extract(quarter from v_dt)::int;
    if (v_dt + interval '2 months')::date > v_letzter_monat then exit; end if;
    select * into v_uva from berechne_ea_uva(c_t, extract(year from v_dt)::smallint, 'Q' || v_q);
    insert into ea_uva (tenant_id, jahr, zeitraum, bmgl_ust_0, bmgl_ust_10, bmgl_ust_13, bmgl_ust_20, ust_10, ust_13, ust_20, vst_10, vst_13, vst_20, gesperrt, notizen)
    values (c_t, extract(year from v_dt)::smallint, 'Q' || v_q, coalesce(v_uva.bmgl_0,0), coalesce(v_uva.bmgl_10,0), coalesce(v_uva.bmgl_13,0), coalesce(v_uva.bmgl_20,0),
      coalesce(v_uva.ust_10,0), coalesce(v_uva.ust_13,0), coalesce(v_uva.ust_20,0), coalesce(v_uva.vst_10,0), coalesce(v_uva.vst_13,0), coalesce(v_uva.vst_20,0), false, 'Demo – über FinanzOnline übermittelt');
    perform sperre_ea_uva(c_t, extract(year from v_dt)::smallint, 'Q' || v_q);
    update ea_uva set gesperrt_am = ((v_dt + interval '3 months') + interval '40 days')::timestamptz
    where tenant_id = c_t and jahr = extract(year from v_dt)::smallint and zeitraum = 'Q' || v_q;
  end loop;

  -- ── Kostenrechnung ──
  insert into kostenstellen (id, tenant_id, name, kuerzel, beschreibung, aktiv) values
    (demo_musterhof_id(33,1), c_t, 'Weingarten',  'WG', 'Außenwirtschaft: Rieden, Pflanzenschutz, Laubarbeit', true),
    (demo_musterhof_id(33,2), c_t, 'Keller',      'KE', 'Innenwirtschaft: Ausbau, Füllung, Gebinde', true),
    (demo_musterhof_id(33,3), c_t, 'Vertrieb',    'VT', 'Verkauf, Messen, Marketing', true),
    (demo_musterhof_id(33,4), c_t, 'Verwaltung',  'VW', 'Büro, Steuerberatung, Versicherung', true);
  insert into kostenarten (id, tenant_id, name, kuerzel, kategorie, aktiv) values
    (demo_musterhof_id(34,1), c_t, 'Pflanzenschutz & Dünger', 'PSM', 'betriebsmittel', true),
    (demo_musterhof_id(34,2), c_t, 'Verpackung & Flaschen',   'VPK', 'betriebsmittel', true),
    (demo_musterhof_id(34,3), c_t, 'Fremdarbeit & Lohn',      'LOH', 'personal',       true),
    (demo_musterhof_id(34,4), c_t, 'Energie',                 'ENE', 'energie',        true),
    (demo_musterhof_id(34,5), c_t, 'Pacht',                   'PAC', 'pacht',          true),
    (demo_musterhof_id(34,6), c_t, 'Abschreibung Gebinde',    'AFA', 'abschreibung',   true);
  perform demo_musterhof_kosten(demo_musterhof_id(35,1),  make_date(y,1,31), demo_musterhof_id(33,1), demo_musterhof_id(34,5), 1260,  'Pacht Jänner–März (Sandgrube, Frechau, Steiner Hund)', 'weingarten', array[demo_musterhof_id(2,4), demo_musterhof_id(2,8), demo_musterhof_id(2,2)], null, null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,2),  make_date(y,2,28), demo_musterhof_id(33,2), demo_musterhof_id(34,6), 900,   'AfA Barriques (4 Stk., 3 Jahre)', 'keller', null, array[demo_musterhof_id(10,15), demo_musterhof_id(10,16), demo_musterhof_id(10,17), demo_musterhof_id(10,18)], null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,3),  make_date(y,2,25), demo_musterhof_id(33,2), demo_musterhof_id(34,2), 7440,  'Füllung GV Kremstal DAC – Flaschen, Korken, Etiketten (12.000 Fl.)', 'keller', null, array[demo_musterhof_id(10,1)], null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,4),  make_date(y,3,8),  demo_musterhof_id(33,1), demo_musterhof_id(34,3), 9165,  'Rebschnitt inkl. Biegen (Fremdarbeitskräfte, 14,1 ha × 650 €)', 'weingarten', null, null, (select id from behandlungen where tenant_id = c_t and art = 'schnitt' and datum >= make_date(y,1,1) limit 1));
  perform demo_musterhof_kosten(demo_musterhof_id(35,5),  make_date(y,3,15), demo_musterhof_id(33,2), demo_musterhof_id(34,4), 930,   'Energie Keller Q1', 'keller', null, array[demo_musterhof_id(10,1), demo_musterhof_id(10,2), demo_musterhof_id(10,3), demo_musterhof_id(10,4)], null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,6),  make_date(y,4,5),  demo_musterhof_id(33,1), demo_musterhof_id(34,1), 2784,  'Düngung Biosol (3.275 kg)', 'weingarten', array[demo_musterhof_id(2,3), demo_musterhof_id(2,4), demo_musterhof_id(2,5), demo_musterhof_id(2,12)], null, (select id from behandlungen where tenant_id = c_t and art = 'duengung' and datum >= make_date(y,1,1) order by datum limit 1));
  perform demo_musterhof_kosten(demo_musterhof_id(35,7),  make_date(y,4,30), demo_musterhof_id(33,1), demo_musterhof_id(34,3), 1198,  'Bodenbearbeitung Frühjahr (Maschinenring)', 'weingarten', null, null, null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,8),  make_date(y,5,25), demo_musterhof_id(33,1), demo_musterhof_id(34,1), 1100,  'Pflanzenschutz Mai (Mittelkosten)', 'weingarten', null, null, (select id from behandlungen where tenant_id = c_t and art = 'spritzung' and datum between make_date(y,5,1) and make_date(y,5,31) order by datum limit 1));
  perform demo_musterhof_kosten(demo_musterhof_id(35,9),  make_date(y,5,30), demo_musterhof_id(33,2), demo_musterhof_id(34,2), 4340,  'Füllung Zweigelt Klassik – Verpackung (7.000 Fl.)', 'keller', null, array[demo_musterhof_id(10,2)], null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,10), make_date(y,6,15), demo_musterhof_id(33,1), demo_musterhof_id(34,3), 5922,  'Laubarbeit Saisonkräfte (14,1 ha × 420 €)', 'weingarten', null, null, null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,11), make_date(y,6,25), demo_musterhof_id(33,2), demo_musterhof_id(34,2), 5700,  'Füllung Riesling Reserve – Verpackung (6.000 Fl., Premiumausstattung)', 'keller', null, array[demo_musterhof_id(10,4)], null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,12), make_date(y,6,30), demo_musterhof_id(33,1), demo_musterhof_id(34,1), 2300,  'Pflanzenschutz Juni (Mittelkosten)', 'weingarten', null, null, null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,13), make_date(y,6,30), demo_musterhof_id(33,2), demo_musterhof_id(34,4), 780,   'Energie Keller Q2', 'keller', null, array[demo_musterhof_id(10,1), demo_musterhof_id(10,2), demo_musterhof_id(10,3), demo_musterhof_id(10,4), demo_musterhof_id(10,5), demo_musterhof_id(10,6)], null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,14), make_date(y,7,31), demo_musterhof_id(33,1), demo_musterhof_id(34,1), 1800,  'Pflanzenschutz Juli (Mittelkosten inkl. Kupfer)', 'weingarten', null, null, null);
  perform demo_musterhof_kosten(demo_musterhof_id(35,15), make_date(y,8,10), demo_musterhof_id(33,2), demo_musterhof_id(34,3), 320,   'Laboranalysen Reserve-Weine', 'keller', null, array[demo_musterhof_id(10,6), demo_musterhof_id(10,7), demo_musterhof_id(10,13), demo_musterhof_id(10,14)], null);

  -- ── Fristen und Lese-Checkliste ──
  for r in select * from (values
    (1, 'Mehrfachantrag (AMA) – Flächenmeldung',        'Flächenangaben Weingarten über eAMA · Frist bitte prüfen',                        'meldung',   make_date(y,4,15),   'jaehrlich', '/weingarten',            make_date(y,4,15) <= d,  make_date(y,4,11)),
    (2, 'Bestandsmeldung Wein (Stichtag 31.07.)',        'Weinbestand aus dem Kellerbuch (Bestandsreport) · Meldung bis 15.08.',              'weinrecht', make_date(y,8,15),   'jaehrlich', '/reports/keller',        make_date(y,8,15) <= d,  make_date(y,8,12)),
    (3, 'Spritzgeräte-Überprüfung (PSM-Geräte-Pickerl)', 'Gebläsespritze zur wiederkehrenden Überprüfung bringen',                            'betrieb',   d + 9,               'einmalig',  '/behandlungen',          false, null),
    (4, 'Weinbaukataster: Flächenänderung melden',       'Rodung Sandgrube GST 1306 (0,25 ha Grünbrache) im Weinbaukataster nachtragen',     'meldung',   d + 21,              'einmalig',  '/weingarten',            false, null),
    (5, 'Inventur Flaschenlager',                        'Bestände je Füllung zählen und im Warenlager korrigieren',                          'betrieb',   d + 45,              'einmalig',  '/weinhandel',            false, null),
    (6, 'UVA Q3 über FinanzOnline übermitteln',          'Aus E/A-Rechnung · CSV-Export · Steuerberatung informieren',                        'steuer',    make_date(y,11,15),  'jaehrlich', '/buchhaltung/uva',       false, null),
    (7, 'PSM-Aufzeichnungen Saison abschließen',         'Behandlungsprotokoll prüfen und exportieren (Aufbewahrung 3 Jahre)',                 'weinrecht', make_date(y,11,30),  'jaehrlich', '/behandlungen/berichte', false, null),
    (8, 'Erntemeldung ' || y || ' (eAMA, 15.12.)',        'Erntemeldung und Bestandsmeldung über eAMA · Entwurf entsteht aus den Pressungen', 'weinrecht', make_date(y,12,15),  'jaehrlich', '/erntemeldung',          false, null),
    (9, 'Jahresabschluss E/A-Rechnung',                  'Belege vollständig, Monatsabschlüsse gesperrt, Export an Steuerberatung',           'steuer',    make_date(y+1,3,31), 'jaehrlich', '/buchhaltung',           false, null)
  ) as v(nr, bez, beschr, kat, faellig, wdh, href, erledigt, erl_am)
  loop
    insert into fristen (id, tenant_id, bezeichnung, beschreibung, kategorie, faellig_am, wiederholung, href, status, erledigt_am, erstellt_am)
    values (demo_musterhof_id(36, r.nr), c_t, r.bez, r.beschr, r.kat, r.faellig, r.wdh, r.href,
      case when r.erledigt then 'erledigt' else 'offen' end, case when r.erledigt then r.erl_am::timestamptz end, make_date(y,1,2)::timestamptz);
  end loop;

  insert into checklisten (id, tenant_id, typ, name, jahr, erstellt_am)
  values (demo_musterhof_id(37,1), c_t, 'lese', 'Lesevorbereitung ' || y, y, (d - 30)::timestamptz);
  for r in select * from (values
    (10, 'Lesetermine mit Erntehelfern abstimmen',                  'Betrieb',    'Anfang Sept.', make_date(y,8,25), true,  -20),
    (20, 'Wartefristen Pflanzenschutz je Ried prüfen',              'Weingarten', 'vor Lese',     make_date(y,8,28), true,  -6),
    (30, 'Reife-Messungen je Ried (KMW-Verlauf)',                   'Weingarten', 'wöchentlich',  make_date(y,9,1),  true,  -2),
    (40, 'Presse warten, Dichtungen und Schläuche prüfen',          'Keller',     'vor Lese',     make_date(y,8,30), false, null),
    (50, 'Gebinde reinigen (Tanks, Bottiche, Fässer)',              'Keller',     'vor Lese',     make_date(y,9,1),  false, null),
    (60, 'Lesekisten, Transportbehälter und Anhänger bereitstellen','Betrieb',    'vor Lese',     make_date(y,9,1),  false, null),
    (70, 'Hefen, Enzyme und Schwefel bevorraten',                   'Keller',     'vor Lese',     make_date(y,8,29), true,  -12),
    (80, 'Jahrgang im System anlegen (Lese → Pressungen)',          'Betrieb',    'Lesebeginn',   make_date(y,9,2),  true,  -25)
  ) as v(sort, txt, zust, hinweis, faellig, erledigt, erl_tage)
  loop
    insert into checklisten_punkte (tenant_id, checkliste_id, text, zustaendig, faellig_am, faellig_hinweis, sortierung, erledigt, erledigt_am, erstellt_am)
    values (c_t, demo_musterhof_id(37,1), r.txt, r.zust, r.faellig, r.hinweis, r.sort, r.erledigt and (d + r.erl_tage) <= d,
      case when r.erledigt then (d + r.erl_tage)::timestamptz end, (d - 30)::timestamptz);
  end loop;

  update tenant_einstellungen
     set rechnung_zaehler = coalesce((select max(substring(rechnungsnummer from 4)::int) from verkaufsposten where tenant_id = c_t), 0) + 1,
         kunden_zaehler   = 26
   where tenant_id = c_t;
end $$;

revoke execute on function public.demo_musterhof_zuruecksetzen() from public, anon, authenticated;
grant  execute on function public.demo_musterhof_zuruecksetzen() to service_role;;
