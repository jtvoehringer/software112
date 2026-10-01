-- KAN-165 D (01.10.2026): Demo-Musterhof mit Rieden aus mehreren Weinbaugebieten. Das Kremstal bleibt der Kern
-- (DAC-Wein, bestehende Kette unverändert); dazu je eine Ried in Wien (Nussberg, Wiener Gemischter Satz), im
-- Burgenland (Eisenstadt, Leithaberg DAC, Blaufränkisch), in der Steiermark (Graßnitzberg, Südsteiermark DAC
-- Riedenwein, Sauvignon Blanc) und im Bergland (St. Paul im Lavanttal, Kärnten, Weißburgunder) – mit Gemeinde,
-- Katastralgemeinde (lib/wein/katastralgemeinden.ts), Herkunft-Code (lib/herkunft.ts) und Sorte.
-- Eigene Funktion, aufgerufen von demo_musterhof_zuruecksetzen() nach den Kremstal-Grundstücken: der Reset bleibt
-- bei zwei Schritten (zuruecksetzen + y2_kette), die Funktion ist idempotent (feste IDs, ON CONFLICT DO NOTHING).
-- Lese, Keller und Verkauf der Demo bleiben beim Kremstal (Kette, AMA-Meldung und Kennzahlen unverändert).

CREATE OR REPLACE FUNCTION public.demo_musterhof_gebiete()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
declare
  c_t constant uuid := '33333333-3333-4333-8333-333333333333';
  r record;
begin
  if not exists (select 1 from tenants where id = c_t and slug = 'demo-musterhof') then
    raise exception 'Demo-Mandant % mit slug demo-musterhof nicht gefunden – Abbruch.', c_t;
  end if;

  insert into lagen (id, tenant_id, name, gemeinde, weinbaugebiet, notizen) values
    (demo_musterhof_id(1, 8),  c_t, 'Ried Nussberg',     'Wien-Döbling',                  'Wien',          'Muschelkalk und Kalksandstein, Südosthang über der Donau'),
    (demo_musterhof_id(1, 9),  c_t, 'Ried Kalkofen',     'Eisenstadt',                    'Leithaberg',    'Leithakalk und Schiefer, Südhang am Leithagebirge'),
    (demo_musterhof_id(1, 10), c_t, 'Ried Graßnitzberg', 'Ehrenhausen an der Weinstraße', 'Südsteiermark', 'Opok (Kalkmergel), steile Hänge'),
    (demo_musterhof_id(1, 11), c_t, 'Ried Granitztal',   'St. Paul im Lavanttal',         'Kärnten',       'Schiefer und Gneis, Lavanttal')
  on conflict (id) do nothing;

  for r in select * from (values
    (13, 'Nussberg Gemischter Satz',     8,  0.45, 'Gemischter Satz', 'GW', 'weiss', 1985, 48.2620, 16.3550, 'NB-GS', 'FS 11', 'Wien',          'wiener_gemischter_satz_dac'),
    (14, 'Kalkofen Blaufränkisch',       9,  0.60, 'Blaufränkisch',   'BF', 'rot',   2007, 47.8550, 16.5150, 'KO-BF', 'FS 12', 'Leithaberg',    'leithaberg_dac'),
    (15, 'Graßnitzberg Sauvignon Blanc', 10, 0.50, 'Sauvignon Blanc', 'SB', 'weiss', 2010, 46.7020, 15.5900, 'GZ-SB', 'FS 13', 'Südsteiermark', 'suedsteiermark_riedenwein'),
    (16, 'Granitztal Weißburgunder',     11, 0.35, 'Weißburgunder',   'WB', 'weiss', 2016, 46.7050, 14.8700, 'GT-WB', 'FS 14', 'Kärnten',       'kaernten')
  ) as v(nr, name, lage, ha, rebsorte, kz, weinart, pj, lat, lon, ib, fs, gebiet, herkunft)
  loop
    insert into weingarten (id, tenant_id, name, ried, flaeche_ha, rebsorte, pflanzjahr, bewirtschaftung, aktiv, gemeinde, weinbaugebiet, lage_id,
      weinart, trauben_verkauf, trauben_herkunft_code, nachhaltig_austria, bewirtschaftung_seit, ama_feldnummer, codes, interne_bezeichnung,
      zentrum_lat, zentrum_lon, geo_quelle, geo_stand)
    values (demo_musterhof_id(2, r.nr), c_t, r.name, (select name from lagen where id = demo_musterhof_id(1, r.lage)), r.ha, r.rebsorte, r.pj,
      'konventionell', true, (select gemeinde from lagen where id = demo_musterhof_id(1, r.lage)), r.gebiet, demo_musterhof_id(1, r.lage),
      r.weinart, false, r.herkunft, true, make_date(r.pj, 4, 1), r.fs, r.kz, r.ib, r.lat, r.lon, 'manuell', now())
    on conflict (id) do nothing;
    -- Gemischter Satz (GW) steht nicht in der Rebsorten-Tabelle – dann ohne Sortenzeile
    insert into weingarten_rebsorten (weingarten_id, rebsorte_id, anteil_pct, pflanzjahr, stock_anzahl, unterlage, reihenabstand_m, stockabstand_m)
    select demo_musterhof_id(2, r.nr), rs.id, 100, r.pj, round(r.ha * 10000 / (2.5 * 0.9))::int, 'SO 4', 2.5, 0.9
      from rebsorten rs
     where rs.kuerzel = r.kz
       and not exists (select 1 from weingarten_rebsorten x where x.weingarten_id = demo_musterhof_id(2, r.nr));
  end loop;

  for r in select * from (values
    (18, 13, '412/3',  'Nussdorf',           '01507', 0.45, 'eigentum', 'Muschelkalk',        '322'),
    (19, 14, '1877/2', 'Eisenstadt',         '30003', 0.60, 'pacht',    'Leithakalk/Schiefer', '1544'),
    (20, 15, '233/1',  'Graßnitzberg',       '66118', 0.50, 'eigentum', 'Opok',               '87'),
    (21, 16, '615',    'Granitztal-St. Paul', '77106', 0.35, 'pacht',   'Schiefer/Gneis',     '204')
  ) as v(nr, wg, gst, kg, kgnr, ha, rv, boden, ez)
  loop
    insert into grundstuecke (id, tenant_id, weingarten_id, gst_nr, katastralgemeinde, kg_bezeichnung, einlagezahl, rebsorte, rebsorte_id, pflanzjahr,
      flaeche_ha, flaeche_ha_kataster, spritzbar, status, nutzart, rechtsverhaeltnis, boden, unterlagsrebe, weinart, bewirtschaftung,
      bewirtschaftung_seit, trauben_herkunft_code, ama_feldnummer)
    select demo_musterhof_id(3, r.nr), c_t, w.id, r.gst, r.kgnr, r.kg, r.ez, w.rebsorte, wr.rebsorte_id, w.pflanzjahr,
      r.ha, round(r.ha * 1.03, 4), true, null, 'WI', r.rv, r.boden, 'SO 4', w.weinart, 'konventionell',
      w.bewirtschaftung_seit, w.trauben_herkunft_code, w.ama_feldnummer
    from weingarten w left join weingarten_rebsorten wr on wr.weingarten_id = w.id
    where w.id = demo_musterhof_id(2, r.wg)
    on conflict (id) do nothing;
  end loop;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.demo_musterhof_gebiete() FROM PUBLIC, anon, authenticated;

-- Reset: nach den Kremstal-Grundstücken die übrigen Gebiete anlegen (Patch der bestehenden Funktion, nur einmal)
DO $patch$
DECLARE
  v_def    text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
  c_anker  constant text := E'  -- ── Betriebsmittel: Pflanzenschutzmittel (Mandant)';
BEGIN
  IF position('perform demo_musterhof_gebiete();' in v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_anker, ''))) / length(c_anker) <> 1 THEN
    RAISE EXCEPTION 'KAN-165 D: Anker in demo_musterhof_zuruecksetzen() nicht genau einmal gefunden – Abbruch.';
  END IF;
  EXECUTE replace(v_def, c_anker,
    E'  -- KAN-165 D: Rieden in Wien, Burgenland, Steiermark und Kärnten (eigene Funktion, idempotent)\n  perform demo_musterhof_gebiete();\n\n' || c_anker);
END
$patch$;
