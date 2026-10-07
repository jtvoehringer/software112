-- KAN-223 (07.10.2026, inkl. KAN-28): Demo-Musterhof um die neueren Kellerbuch-/Warenwirtschaftsvorgänge ergänzen.
--
-- Befund: DB-Test 00 (demo_tabellen_mit_zeilen) rot mit 56 von 94 T-Tabellen – der Demo-Aufbau befüllte Journal,
-- Abschluss, Verarbeitung, Zugangskorrektur, Etikettierung, Abstufung, Prüfnummernantrag-Workflow, Zukauf,
-- Traubenverkauf, Betriebsmittel und Exportaufträge nicht.
--
-- Neu: demo_musterhof_kellerbuch() – aufgerufen am Ende von demo_musterhof_y2_kette() (Schritt 2 des Resets, der
-- nächtliche Ablauf bleibt unverändert). Geschrieben wird über die RPCs der App (Freeze-, Storno-, Journal- und
-- Periodenregeln greifen wie im Betrieb), Daten relativ zum Wiener Datum:
--   1. Weinexport frei (modul_export/modul_weinexport), Abnehmer Winzergenossenschaft mit BKI-Betriebsnummer
--   2. Betriebsmittel (Stammdaten, Anfangsbestand, Einkäufe per s112_betriebsmittel_einkauf → E/A-Ausgabe)
--   3. Traubenverkauf: Vorjahr Gebling GV an die Genossenschaft (Gutschrift), heuer – nach der Lese – mit Rechnung,
--      Liefernummer und Lese (BKI-Datenblatt und Transportbescheinigung des Verkaufs vorführbar)
--   4. Exportaufträge zu den Verkäufen an die Weinkellerei Helvetia (CH) + ein bestätigter Auftrag
--   5. Prüfnummernanträge: Chardonnay bis „Zugeteilt“, Zweigelt Klassik „In Prüfung“ (Antragsformular, Ereignisse)
--   6. Journal eröffnen (Stichtag heute − 14), danach Zukauf, Zugangskorrektur, Verarbeitung, Abstufung,
--      Etikettierungen (alle im Journal)
--   7. Kellerbuch bis 31.07. des Vorjahres abgeschlossen (Weinwirtschaftsjahr)
-- demo_musterhof_zuruecksetzen() räumt Journal, Abschlüsse und Betriebsmittel vorher ab (journal_ab = NULL).
-- Zweiter Aufruf von y2_kette ohne Reset: Journal schon eröffnet → demo_musterhof_kellerbuch() tut nichts.

-- ── 1. Neue Funktion ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.demo_musterhof_kellerbuch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  c_t   constant uuid := '33333333-3333-4333-8333-333333333333';
  h     constant date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- Wiener Datum, nie current_date
  y     constant integer := extract(year from (now() AT TIME ZONE 'Europe/Vienna'))::int;
  y1    constant integer := y - 1;
  s     constant date := h - 14;                                          -- Stichtag der Journal-Eröffnung
  jg_y1 constant uuid := demo_musterhof_id(8, 2);
  jg_y  constant uuid := demo_musterhof_id(8, 3);
  f_wg  constant uuid := demo_musterhof_id(22, 7);   -- Winzergenossenschaft Kremstal eGen
  f_ch  constant uuid := demo_musterhof_id(22, 6);   -- Weinkellerei Helvetia AG (Zürich)
  f_gl  constant uuid := demo_musterhof_id(22, 9);   -- Glashütte Donau GmbH
  f_et  constant uuid := demo_musterhof_id(22, 10);  -- Etiketten Steiner GmbH
  wg_gb constant uuid := demo_musterhof_id(2, 5);    -- Gebling Grüner Veltliner (Trauben an die Genossenschaft)
  k_hilf  constant uuid := (select id from ea_kategorien where tenant_id is null and name = 'Hilfsstoffe (Kellerei)');
  k_flas  constant uuid := (select id from ea_kategorien where tenant_id is null and name = 'Flaschen & Verpackung');
  r record; v_e record; v_cfg record;
  v_id uuid; v_vp uuid; v_lese uuid; v_d date; v_ea date; v_nr integer := 0;
  v_ln text; v_re text; v_strasse text; v_hausnr text; v_jj text := lpad((y % 100)::text, 2, '0');
  v_pna jsonb;
begin
  PERFORM set_config('s112.protokoll_aus', c_t::text, true);  -- KAN-35: Demo-Aufbau nicht protokollieren (nur Demo-Mandant)
  if not exists (select 1 from tenants where id = c_t and slug = 'demo-musterhof') then
    raise exception 'Demo-Mandant % mit slug demo-musterhof nicht gefunden – Abbruch.', c_t;
  end if;

  -- Paket-Modul Weinexport im Demo-Betrieb immer an (KAN-28)
  update tenant_einstellungen set modul_export = true, modul_weinexport = true where tenant_id = c_t;

  -- Nur auf einem frischen Reset (Journal noch nicht eröffnet) – sonst schon ergänzt
  if (select journal_ab from tenant_einstellungen where tenant_id = c_t) is not null then return; end if;
  if exists (select 1 from kellerbuch_buchungen where tenant_id = c_t) then return; end if;

  update tenant_einstellungen set export_zaehler = 0 where tenant_id = c_t;
  update firmen set betrieb_nr = '3512407' where id = f_wg and tenant_id = c_t;   -- BKI-Betriebsnummer (Empfänger-Block)

  -- erster Tag ab heute − 4, der nicht in einem abgeschlossenen E/A-Monat bzw. einer gesperrten UVA liegt
  v_ea := h - 4;
  while v_ea < h and public.s112_ea_zeitraum_sperrgrund(c_t, v_ea) is not null loop v_ea := v_ea + 1; end loop;

  -- ── 2. Betriebsmittel ──────────────────────────────────────────────────────────────────────────────────
  for r in select * from (values
    (1, 'weinbehandlung', 'Reinzuchthefe Lalvin EC-1118',        'kg',  42.00,  k_hilf, 2.5,   null::uuid, 'Für Sekt- und Restzucker-Gärungen'),
    (2, 'weinbehandlung', 'Kaliumpyrosulfit (Kaliumdisulfit)',   'kg',  9.80,   k_hilf, 10,    null,       'Schwefelung, 1 g ≈ 0,57 g SO₂'),
    (3, 'weinbehandlung', 'Bentonit Granulat',                   'kg',  4.20,   k_hilf, 15,    null,       'Eiweißstabilisierung'),
    (4, 'produktion',     'Weinflasche Schlegel 0,75 l Antikgrün','stk', 0.42,  k_flas, 1800,  f_gl,       null),
    (5, 'produktion',     'Schraubverschluss Stelvin 30 × 60',   'stk', 0.09,   k_flas, 2500,  null,       null),
    (6, 'produktion',     'Etikett Zweigelt Klassik (Vorder + Rücken)', 'stk', 0.13, k_flas, 400, f_et,  'Rolle à 1.000 Stk')
  ) as v(nr, gruppe, name, einheit, preis, kat, anfang, lieferant, notiz)
  loop
    insert into betriebsmittel (id, tenant_id, gruppe, name, einheit, preis_pro_einheit, ea_kategorie_id, notizen, aktiv)
    values (demo_musterhof_id(60, r.nr), c_t, r.gruppe, r.name, r.einheit, r.preis, r.kat, r.notiz, true);
    insert into betriebsmittel_lager_bewegungen (tenant_id, betriebsmittel_id, datum, typ, menge, einheit, notizen)
    values (c_t, demo_musterhof_id(60, r.nr), make_date(y, 1, 1), 'anfangsbestand', r.anfang, r.einheit, 'Inventur zum Jahresbeginn');
  end loop;
  if public.s112_ea_zeitraum_sperrgrund(c_t, v_ea) is null then
    perform s112_betriebsmittel_einkauf(c_t, demo_musterhof_id(60, 4), v_ea, 6000, 'stk', 2520.00, 20, f_gl, k_flas,
      'Lieferung für die Füllung Zweigelt Klassik');
    perform s112_betriebsmittel_einkauf(c_t, demo_musterhof_id(60, 6), v_ea, 3000, 'stk', 390.00, 20, f_et, k_flas, null);
    perform s112_betriebsmittel_einkauf(c_t, demo_musterhof_id(60, 3), least(v_ea + 1, h), 25, 'kg', 105.00, 20, null, k_hilf,
      'Sackware 25 kg');
  end if;

  -- ── 3. Traubenverkauf (BKI-Datenblatt; heuer mit Verkauf → Transportbescheinigung) ───────────────────
  select * into v_e from ernte_parzellen where id = demo_musterhof_id(38, 5) and storniert_am is null;   -- Gebling GV Vorjahr (Typ 0x26)
  if v_e.id is not null then
    -- Nummer aus der Vorjahresserie (Format wie get_next_liefernummer), ohne den laufenden Zähler zu verbrauchen
    select liefernummer_prefix || '-' || y1 || '-' || lpad('14', liefernummer_stellen, '0') into v_ln
      from tenant_einstellungen where tenant_id = c_t;
    insert into traubenverkauf (id, tenant_id, jahrgang_id, lese_id, weingarten_id, grundstueck_id, firma_id, datum, menge_kg, preis_per_kg,
      kmw_grad, mostgewicht_einheit, qualitaetsstufe, herkunft_code, gesundheit, liefernummer, notizen)
    values (demo_musterhof_id(65, 1), c_t, v_e.jahrgang_id, v_e.lese_id, wg_gb, v_e.grundstueck_id, f_wg, v_e.ernte_datum, v_e.menge_kg, 0.78,
      v_e.klosterneuburger, 'kmw', v_e.qualitaetsstufe, coalesce(v_e.herkunft_code, 'wlnoe'), 'G', v_ln,
      'Gesamte Ernte an die Winzergenossenschaft – Abrechnung per Gutschrift der Genossenschaft');
  end if;

  -- heuer: Lese Gebling GV nach dem letzten Verkauf (fortlaufende Rechnungsnummer), nur wenn die Hauptlese läuft
  select l.id into v_lese from lesen l where l.tenant_id = c_t and l.jahrgang_id = jg_y and l.art = 'hauptlese' order by l.lfd_nr limit 1;
  select greatest(make_date(y, 9, 22), coalesce(max(v.datum), make_date(y, 9, 22))) into v_d from verkaufsposten v where v.tenant_id = c_t;
  if v_lese is not null and v_d <= h and v_e.id is not null
     and v_d >= (select l.beginn from lesen l where l.id = v_lese) then
    insert into ernte_parzellen (id, jahrgang_id, lese_id, weingarten_id, rebsorte_id, ernte_datum, menge_kg, menge_hl, klosterneuburger,
      mostgewicht_einheit, qualitaetsstufe, herkunft_code, lesemethode, weinbezeichnung, notizen, created_at)
    values (demo_musterhof_id(63, 1), jg_y, v_lese, wg_gb, v_e.rebsorte_id, v_d, 9600, 74.0, 17.4,
      'kmw', 'qualitaetswein', 'wlnoe', 'maschinenlese', 'Traubenverkauf', 'Gesamte Ernte an Winzergenossenschaft Kremstal geliefert',
      v_d::timestamptz);
    v_vp := demo_musterhof_id(64, 1);
    v_re := get_next_rechnungsnummer(c_t);
    insert into verkaufsposten (id, tenant_id, datum, rechnungsnummer, transaktions_nr, firma_id, notizen, storniert,
      erstellt_am, aktualisiert_am, updated_at)
    values (v_vp, c_t, v_d, v_re, demo_musterhof_txnr('verkauf', y), f_wg, 'Traubenlieferung Gebling – Übernahmeschein der Genossenschaft liegt bei',
      false, v_d::timestamptz, v_d::timestamptz, v_d::timestamptz);
    v_ln := get_next_liefernummer(c_t);
    insert into traubenverkauf (id, tenant_id, jahrgang_id, lese_id, weingarten_id, firma_id, datum, menge_kg, preis_per_kg, kmw_grad,
      mostgewicht_einheit, qualitaetsstufe, herkunft_code, gesundheit, liefernummer, verkaufsposten_id)
    values (demo_musterhof_id(65, 2), c_t, jg_y, v_lese, wg_gb, f_wg, v_d, 9600, 0.85, 17.4,
      'kmw', 'qualitaetswein', 'wlnoe', 'G', v_ln, v_vp);
    insert into verkauf_positionen (tenant_id, verkaufsposten_id, typ, traubenverkauf_id, name, menge, einheit, preis_brutto, ust_satz,
      rabatt_pct, sonderrabatt_pct, erstellt_am)
    values (c_t, v_vp, 'trauben', demo_musterhof_id(65, 2), 'Trauben Grüner Veltliner – Ried Gebling', 9600, 'kg', 0.85, 13, 0, 0, v_d::timestamptz);
    insert into aktivitaeten (tenant_id, firma_id, art, betreff, beschreibung, datum, erledigt, erstellt_am)
    values (c_t, f_wg, 'verkauf', 'Verkauf ' || v_re || ' · 8160,00 €', 'Verkaufsposten: ' || v_vp, v_d, true, v_d::timestamptz);
    update firmen set is_lead = false where id = f_wg and tenant_id = c_t and is_lead;
  end if;

  -- ── 4. Exportaufträge (Weinkellerei Helvetia, Drittland CH) ─────────────────────────────────────────────
  for r in select v.id, v.datum, v.rechnungsnummer from verkaufsposten v
            where v.tenant_id = c_t and v.firma_id = f_ch and not v.storniert order by v.datum, v.id loop
    v_nr := v_nr + 1;
    v_id := demo_musterhof_id(61, v_nr);
    insert into exportauftraege (id, tenant_id, firma_id, referenz, datum, lieferdatum, incoterms, transport_art, destination_land,
      destination_stadt, eori_kunde, taric_code, ursprungsland, waehrung, versicherungswert, status, notizen, aktiv,
      emcs_arc_nummer, emcs_status, emcs_datum, created_at)
    values (v_id, c_t, f_ch, get_next_exportnummer(c_t), r.datum - 5, r.datum, 'DAP', 'LKW', 'CH', 'Zürich', 'CHE106222333', '2204.21',
      'AT', 'EUR',
      (select round(sum(p.menge * p.preis_brutto) * 1.1, 0) from verkauf_positionen p where p.verkaufsposten_id = r.id and p.typ = 'flasche'),
      case when r.datum + 21 <= h then 'abgeschlossen' else 'versendet' end,
      'Rechnung ' || r.rechnungsnummer || ' – Zollabfertigung über Spedition Donautrans, Grenzübergang St. Margrethen',
      true, to_char(r.datum, 'YY') || 'ATD0MH' || lpad((40000 + v_nr)::text, 12, '0') || '7', 'accepted', r.datum, (r.datum - 5)::timestamptz);
    insert into exportauftrag_positionen (exportauftrag_id, fullung_id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order)
    select v_id, p.fuellung_id, p.name, p.menge, 'Fl', p.preis_brutto, '2204.21', (row_number() over (order by p.erstellt_am, p.id))::int - 1
      from verkauf_positionen p where p.verkaufsposten_id = r.id and p.typ = 'flasche';
    insert into export_dokumente (exportauftrag_id, dokument_art, status, ausgestellt_am)
    select v_id, d.art, 'ausgestellt', r.datum - d.tage
      from (values ('v1v2', 1), ('eur1', 3), ('cmr', 0), ('lieferschein', 0), ('rechnung', 0)) as d(art, tage);
  end loop;
  -- bestätigter Auftrag für die nächste Lieferung (Dokumente noch offen)
  v_id := demo_musterhof_id(61, 50);
  insert into exportauftraege (id, tenant_id, firma_id, referenz, datum, lieferdatum, incoterms, transport_art, destination_land,
    destination_stadt, eori_kunde, taric_code, ursprungsland, waehrung, versicherungswert, status, notizen, aktiv, created_at)
  values (v_id, c_t, f_ch, get_next_exportnummer(c_t), h - 2, h + 12, 'DAP', 'LKW', 'CH', 'Zürich', 'CHE106222333', '2204.21', 'AT', 'EUR',
    9100, 'bestaetigt', 'Herbstbestellung – Abholung durch Spedition Donautrans', true, (h - 2)::timestamptz);
  insert into exportauftrag_positionen (exportauftrag_id, fullung_id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order)
  select v_id, f.id, f.name || ' ' || coalesce(f.jahrgang::text, '') || ' (' || f.flaschengroesse_ml || ' ml)', x.menge, 'Fl', x.preis, '2204.21', x.pos
    from (values (5, 600, 8.20, 0), (11, 120, 15.50, 1), (12, 300, 7.40, 2)) as x(fnr, menge, preis, pos)
    join fuellungen f on f.id = demo_musterhof_id(19, x.fnr) and f.tenant_id = c_t;
  insert into export_dokumente (exportauftrag_id, dokument_art, status)
  values (v_id, 'v1v2', 'ausstehend'), (v_id, 'eur1', 'beantragt'), (v_id, 'cmr', 'ausstehend'), (v_id, 'lieferschein', 'ausstehend'),
         (v_id, 'rechnung', 'ausstehend');

  -- ── 5. Prüfnummernanträge: Entwurf → Formular → Statuswechsel per RPC ──────────────────────────────────
  select betrieb_name, betrieb_betriebsnummer, betrieb_plz, betrieb_ort, betrieb_strasse, betrieb_telefon, betrieb_email
    into v_cfg from tenant_einstellungen where tenant_id = c_t;
  v_strasse := btrim(regexp_replace(coalesce(v_cfg.betrieb_strasse, ''), '\s*\d+\S*$', ''));
  v_hausnr := coalesce(substring(coalesce(v_cfg.betrieb_strasse, '') from '(\d+\S*)$'), '');
  for r in select * from (values
    (1, 32, 'Chardonnay',       'Weiß', 'Chardonnay Niederösterreich ' || y1,       12.9, '18,2', 13, 9,  4,  'N 11042/' || v_jj),
    (2, 33, 'Zweigelt',         'Rot',  'Zweigelt Klassik Niederösterreich ' || y1, 13.1, '17,6', 6,  2,  null, null)
  ) as v(nr, wa, rebsorte, farbe, bez, alk, kmw, d_ein, d_pruef, d_zug, pn)
  loop
    select * into v_e from weinausbau where id = demo_musterhof_id(11, r.wa) and tenant_id = c_t and aktiv;
    if v_e.id is null then continue; end if;
    v_id := demo_musterhof_id(62, r.nr);
    insert into dac_antrag (id, tenant_id, weinausbau_id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status,
      notizen, aktiv, created_at)
    values (v_id, c_t, v_e.id, r.bez, 'sonstiges', v_e.jahrgang, r.rebsorte, v_e.menge_liter, r.alk, 'entwurf',
      'Qualitätswein Niederösterreich – Probe beim Bundesamt für Weinbau eingereicht', true, (h - r.d_ein - 1)::timestamptz);
    v_pna := jsonb_build_object(
      'antragsnummer', '', 'untersuchungsnummer', '', 'eingangsdatum', '',
      'betriebsnummer', coalesce(v_cfg.betrieb_betriebsnummer, ''), 'name', coalesce(v_cfg.betrieb_name, ''), 'vorname', '',
      'plz', coalesce(v_cfg.betrieb_plz, ''), 'ort', coalesce(v_cfg.betrieb_ort, ''), 'strasse', v_strasse, 'hausnr', v_hausnr,
      'telefon', coalesce(v_cfg.betrieb_telefon, ''), 'telefax', '', 'email', coalesce(v_cfg.betrieb_email, ''),
      'bevo_name', '', 'bevo_vorname', '',
      'aufbew_plz', coalesce(v_cfg.betrieb_plz, ''), 'aufbew_ort', coalesce(v_cfg.betrieb_ort, ''), 'aufbew_strasse', v_strasse,
      'aufbew_hausnr', v_hausnr,
      'farbe', r.farbe, 'jahrgangsverschnitt', false, 'jahrgang', v_e.jahrgang::text, 'lesegradation', r.kmw, 'angereichert', false,
      'gesuesst', false, 'einreichmenge', replace(to_char(v_e.menge_liter, 'FM9999990'), '.', ','), 'rebsorte', r.rebsorte,
      'abgefuellt', '', 'teilmenge_pn', '',
      'bez_rebsorte', r.rebsorte, 'qualitaetsstufe', 'Qualitätswein', 'weinbaugebiet', 'Niederösterreich', 'bez_jahrgang', v_e.jahrgang::text,
      'reserve', false, 'grosse_reserve', false, 'premium', false, 'barrique', false, 'ried', '', 'gemeinde', '',
      'schilcher', false, 'schilcher_klassik', false, 'bio_wein', false, 'sonstiges', '',
      'naechste_qualitaet', false, 'versiegelungsverzicht', false, 'mostchargen', '[]'::jsonb);
    insert into pruefnummernantraege (tenant_id, dac_antrag_id, formular_daten, erstellt_am, aktualisiert_am)
    values (c_t, v_id, v_pna, (h - r.d_ein - 1)::timestamptz, (h - r.d_ein - 1)::timestamptz);
    perform s112_pruefnummernantrag_status_setzen(c_t, v_id, 'eingereicht', h - r.d_ein, null, null);
    perform s112_pruefnummernantrag_status_setzen(c_t, v_id, 'in_pruefung', h - r.d_pruef, null, 'Probe beim Bundesamt für Weinbau Krems eingelangt');
    if r.pn is not null then
      perform s112_pruefnummernantrag_status_setzen(c_t, v_id, 'genehmigt', h - r.d_zug, r.pn, null);
    end if;
  end loop;

  -- ── 6. Unetikettierte Lagerware (vor der Journal-Eröffnung; Füllung Zweigelt Klassik) ──────────────────
  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  update fuellungen set anzahl_unetikettiert = least(2400, anzahl_flaschen, bestand_flaschen),
                        bestand_unetikettiert = least(2400, anzahl_flaschen, bestand_flaschen)
   where id = demo_musterhof_id(19, 12) and tenant_id = c_t and storniert_am is null;
  PERFORM set_config('s112.freeze_frei', '', true);

  -- ── 7. Journal eröffnen, danach Bewegungen per RPC ──────────────────────────────────────────────────────
  perform journal_eroeffnen(c_t, s);

  -- Zukauf Fasswein ins leere Holzfass 1 (Journal ZK)
  if not exists (select 1 from weinausbau w where w.behaelter_id = demo_musterhof_id(10, 12) and w.tenant_id = c_t and w.aktiv) then
    perform s112_zukauf_buchen(c_t,
      jsonb_build_object('datum', h - 12, 'art', 'wein', 'lieferant_firma_id', f_wg, 'menge', 1000, 'einheit', 'l', 'weinart', 'weiss',
        'rebsorte', 'Grüner Veltliner', 'qualitaetsstufe', 'qualitaetswein', 'jahrgang', y1, 'herkunft', 'wlnoe', 'land_iso', 'AT',
        'alkohol_pct', 12.5, 'preis_gesamt', 2400.00, 'einstandspreis_pro_liter', 2.40, 'eingangsrechnungsnummer', 'WGK-' || y || '-0815',
        'tbs_nummer_lieferant', '214', 'tbs_jahr_lieferant', y,
        'notizen', 'Fasswein für die Literabfüllung (Grüner Veltliner 1 l)'),
      jsonb_build_object('name', 'Grüner Veltliner Zukauf', 'rebsorte', 'Grüner Veltliner', 'behaelter_id', demo_musterhof_id(10, 12),
        'jahrgang', y1, 'menge_liter', 1000, 'einstandspreis_pro_liter', 2.40, 'weinart', 'weiss', 'qualitaetsstufe', 'qualitaetswein',
        'herkunft_code', 'wlnoe', 'land_iso', 'AT'),
      null, null);
  end if;

  -- Zugangskorrektur (Betriebsleitung): Mehrmenge nach dem ersten Abstich
  perform s112_zugangskorrektur_buchen(c_t, demo_musterhof_id(11, 50), h - 10, 35, 'mehrmenge',
    'Nach dem ersten Abstich mehr Klarwein als geschätzt – Trubanteil beim Pressen zu hoch angesetzt');

  -- Verarbeitung: Teil des Hausweins an die Brennerei
  perform s112_verarbeitung_buchen(c_t, demo_musterhof_id(11, 12), h - 8, 120, 'brennerei',
    'An die Brennerei Kremstal zur Destillation (Weinbrand) übergeben');

  -- Abstufung: Barrique 1 erreicht Reserve-Niveau nicht
  perform s112_charge_abstufen(c_t, demo_musterhof_id(11, 25), h - 5, jsonb_build_object('zusatzbezeichnung', ''),
    'Verkostung: Barrique 1 erreicht das Reserve-Niveau nicht – wird ohne Zusatzbezeichnung vermarktet', null);

  -- Etikettierungen der Lagerware
  if (select bestand_unetikettiert from fuellungen where id = demo_musterhof_id(19, 12)) >= 1800 then
    perform s112_fuellung_etikettieren(c_t, demo_musterhof_id(19, 12), h - 3, 1200, 'Etikettiermaschine, Charge Etiketten 09/' || v_jj);
    perform s112_fuellung_etikettieren(c_t, demo_musterhof_id(19, 12), h - 1, 600, null);
  end if;

  -- ── 8. Kellerbuch-Abschluss des Weinwirtschaftsjahres (Vorjahr bis 31.07.) ─────────────────────────────
  perform kellerbuch_abschliessen(c_t, make_date(y1, 7, 31),
    'Weinwirtschaftsjahr ' || (y1 - 1) || '/' || y1 || ' abgeschlossen – Bestandsmeldung zum 31.07. übermittelt');
end $function$;

REVOKE EXECUTE ON FUNCTION public.demo_musterhof_kellerbuch() FROM PUBLIC, anon, authenticated;

-- ── 2. y2_kette ruft die Ergänzung am Ende auf ──────────────────────────────────────────────────────────
DO $$
DECLARE
  c_alt constant text := '  perform demo_musterhof_lesen();';
  c_neu constant text := E'  perform demo_musterhof_lesen();\n\n  -- KAN-223: Journal, Abschluss, Kellerbuch-Vorgänge, PN-Workflow, Zukauf, Traubenverkauf, Betriebsmittel, Export\n  perform demo_musterhof_kellerbuch();';
  v_def text := pg_get_functiondef('public.demo_musterhof_y2_kette()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-223: Stelle in demo_musterhof_y2_kette nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END $$;

-- ── 3. Reset räumt Journal, Abschlüsse und Betriebsmittel zuerst ab ─────────────────────────────────────
DO $$
DECLARE
  c_alt constant text := '  delete from bestandsprotokoll where tenant_id = c_t;';
  c_neu constant text := E'  -- KAN-223: Journal schließen und leeren (sonst schriebe der Neuaufbau ins Journal), Abschlüsse, Betriebsmittel\n'
    || E'  update tenant_einstellungen set journal_ab = null where tenant_id = c_t;\n'
    || E'  delete from kellerbuch_buchungen where tenant_id = c_t;\n'
    || E'  delete from kellerbuch_abschluesse where tenant_id = c_t;\n'
    || E'  delete from betriebsmittel_lager_bewegungen where tenant_id = c_t;  -- storno-ausnahme: Demo-Reset des Musterhofs, Wartung über s112.protokoll_aus\n'
    || E'  delete from betriebsmittel where tenant_id = c_t;\n'
    || '  delete from bestandsprotokoll where tenant_id = c_t;';
  v_def text := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-223: Stelle in demo_musterhof_zuruecksetzen nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END $$;

-- ── 4. Kontrolle: demo_musterhof_info() mit den neuen Bereichen ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.demo_musterhof_info()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  select jsonb_build_object(
    'tenant_id',        '33333333-3333-4333-8333-333333333333',
    'lagen',            (select count(*) from lagen           where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'weingarten',       (select count(*) from weingarten      where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'grundstuecke',     (select count(*) from grundstuecke    where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'flaeche_ha',       (select coalesce(sum(flaeche_ha),0) from grundstuecke where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'behaelter',        (select count(*) from behaelter       where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'chargen',          (select count(*) from weinausbau      where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'chargen_aktiv',    (select count(*) from weinausbau      where tenant_id = '33333333-3333-4333-8333-333333333333' and aktiv),
    'liter_im_keller',  (select coalesce(sum(menge_liter),0) from weinausbau where tenant_id = '33333333-3333-4333-8333-333333333333' and aktiv),
    'behandlungen',     (select count(*) from behandlungen    where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'fuellungen',       (select count(*) from fuellungen      where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'flaschen_bestand', (select coalesce(sum(bestand_flaschen),0) from fuellungen where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'kontakte',         (select count(*) from kontakte        where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'firmen',           (select count(*) from firmen          where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'verkaufsposten',   (select count(*) from verkaufsposten  where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'offene_posten',    (select count(*) from verkaufsposten  where tenant_id = '33333333-3333-4333-8333-333333333333' and not bezahlt and not storniert),
    'ea_transaktionen', (select count(*) from ea_transaktionen where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'kosteneintraege',  (select count(*) from kosteneintraege where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'fristen',          (select count(*) from fristen         where tenant_id = '33333333-3333-4333-8333-333333333333'),
    -- KAN-223: Schritt 2 (y2_kette) gelaufen? journal_ab gesetzt, Buchungen und Abschluss vorhanden
    'journal_ab',       (select journal_ab from tenant_einstellungen where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'journal_buchungen',(select count(*) from kellerbuch_buchungen where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'kellerbuch_abgeschlossen_bis', (select max(abgeschlossen_bis) from kellerbuch_abschluesse where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'pruefnummernantraege', (select count(*) from dac_antrag where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'traubenverkauf',   (select count(*) from traubenverkauf  where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'exportauftraege',  (select count(*) from exportauftraege where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'betriebsmittel',   (select count(*) from betriebsmittel  where tenant_id = '33333333-3333-4333-8333-333333333333'),
    'letzter_reset',    (select min(created_at) from weingarten where tenant_id = '33333333-3333-4333-8333-333333333333')
  )
$function$;

REVOKE EXECUTE ON FUNCTION public.demo_musterhof_info() FROM PUBLIC, anon, authenticated;
