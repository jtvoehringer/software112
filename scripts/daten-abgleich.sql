-- Fachlicher Datenabgleich (09.10.2026) – Plausibilität der Bewegungs- und Stammdaten je Betrieb.
-- Nur lesend. Als postgres ausführen (SQL-Editor oder MCP execute_sql), sonst blendet RLS Zeilen aus.
-- Ergänzt scripts/fk-waisen.sql (technische Verweise) um fachliche Regeln; Anlass: Prüfung vor dem Echtbetrieb
-- Gebeshuber ab 01.01.2027 (BKI-Weingartenliste, Gebindeverzeichnis AP10/AP11, Kellerbuch).
--
-- Ergebnis: eine Zeile je Betrieb und Befund (Befunde ohne Treffer fehlen), sortiert nach Schwere.
--   fehler  = Bestand/Buchung widersprüchlich – klären, bevor Meldungen daraus entstehen
--   pflege  = Stammdaten unvollständig, Meldungen werden lückenhaft (Daten trägt der Betrieb nach)
--   hinweis = auffällig, aber oft gewollt (z. B. Ried-Fläche ≠ Summe der Grundstücke)
-- Korrekturen nie aus diesem Skript – Bewegungen stornieren statt löschen (KAN-145), Stammdaten in der App.
-- Optional auf einen Betrieb einschränken: in der CTE „betrieb“ die WHERE-Zeile aktivieren.
with betrieb as (
  select t.id, t.name from public.tenants t
  -- where t.id = '<tenant_id>'
),
befunde as (
  -- ── Kellerbuch und Flaschenlager ─────────────────────────────────────────────────────────────────────
  select w.tenant_id, 'fehler' as schwere, 'charge_negativ' as pruefung, 'Charge mit negativer Menge' as text,
         w.name || ' (' || w.menge_liter || ' l)' as beispiel
    from public.weinausbau w where w.storniert_am is null and w.menge_liter < 0
  union all
  select f.tenant_id, 'fehler', 'fuellung_negativ', 'Füllung mit negativem Flaschenbestand', f.name || ' (' || f.bestand_flaschen || ')'
    from public.fuellungen f where f.storniert_am is null and f.bestand_flaschen < 0
  union all
  -- Bestand = gefüllte Flaschen + Summe der Bewegungen (Anfangsbestand, Verkauf, Bruch, Inventur …)
  select f.tenant_id, 'fehler', 'fuellung_kette', 'Flaschenbestand ≠ Füllmenge + Bewegungen',
         f.name || ': ' || f.anzahl_flaschen || ' + ' || coalesce(b.summe, 0) || ' ≠ ' || f.bestand_flaschen
    from public.fuellungen f
    left join lateral (select sum(x.menge_stk) as summe from public.fuellung_bewegungen x where x.fuellung_id = f.id) b on true
   where f.storniert_am is null and f.anzahl_flaschen + coalesce(b.summe, 0) <> coalesce(f.bestand_flaschen, 0)
  union all
  -- Seit KAN-35 bucht jeder Flaschenverkauf über s112_fuellung_verkauf_buchen eine Bewegung
  select v.tenant_id, 'fehler', 'flaschenverkauf_ohne_bewegung', 'Flaschenverkauf ohne Lagerbewegung',
         coalesce(v.rechnungsnummer, v.id::text) || ' · ' || p.name
    from public.verkauf_positionen p
    join public.verkaufsposten v on v.id = p.verkaufsposten_id
   where p.fuellung_id is not null and not coalesce(v.storniert, false) and v.storniert_am is null
     and not exists (select 1 from public.fuellung_bewegungen b where b.verkaufsposten_id = v.id and b.fuellung_id = p.fuellung_id)
  union all
  select w.tenant_id, 'hinweis', 'charge_abgeschlossen_mit_rest', 'Abgeschlossene Charge mit Restmenge', w.name || ' (' || w.menge_liter || ' l)'
    from public.weinausbau w
   where w.storniert_am is null and (w.status = 'abgeschlossen' or not w.aktiv) and coalesce(w.menge_liter, 0) > 0.01
  union all
  select w.tenant_id, 'pflege', 'charge_ohne_jahrgang', 'Charge im Keller ohne Jahrgang', w.name || ' (' || w.menge_liter || ' l)'
    from public.weinausbau w
   where w.storniert_am is null and w.aktiv and coalesce(w.status, '') <> 'abgeschlossen' and coalesce(w.menge_liter, 0) > 0 and w.jahrgang is null
  union all
  select w.tenant_id, 'hinweis', 'gebinde_mehrere_chargen', 'Gebinde mit mehreren Chargen im Keller',
         b.name || ' (' || count(*) || ' Chargen)'
    from public.weinausbau w join public.behaelter b on b.id = w.behaelter_id
   where w.storniert_am is null and w.aktiv and coalesce(w.status, '') <> 'abgeschlossen' and coalesce(w.menge_liter, 0) > 0
   group by w.tenant_id, b.id, b.name having count(*) > 1
  union all
  select f.tenant_id, 'pflege', 'qualitaetswein_ohne_pruefnummer', 'Qualitätswein-/DAC-Füllung ohne Prüfnummer',
         f.name || coalesce(' ' || f.jahrgang, '')
    from public.fuellungen f
   where f.storniert_am is null and f.qualitaet in ('qualitaetswein', 'dac') and nullif(btrim(f.pruefnummer), '') is null and f.dac_antrag_id is null
  union all
  select b.tenant_id, 'pflege', 'gebinde_ohne_material', 'Gebinde ohne Material (BKI-Gebindeverzeichnis)', b.name
    from public.behaelter b where b.aktiv and nullif(btrim(b.material), '') is null
  union all
  -- ── Weingarten (BKI-Weingartenliste) ─────────────────────────────────────────────────────────────────
  select w.tenant_id, 'pflege', 'ried_ohne_herkunft', 'Ried ohne Herkunft (kein Grundstück mit Trauben-Herkunftscode)', w.name
    from public.weingarten w
   where w.aktiv and not exists (select 1 from public.grundstuecke g where g.weingarten_id = w.id and g.trauben_herkunft_code is not null)
  union all
  select g.tenant_id, 'pflege', 'kg_ungueltig', 'Grundstück mit ungültiger KG-Nummer', coalesce(g.katastralgemeinde, '∅') || ' / GST ' || coalesce(g.gst_nr, '∅')
    from public.grundstuecke g
   where coalesce(g.aktiv, true) and coalesce(ltrim(btrim(g.katastralgemeinde), '0'), '') !~ '^[1-9][0-9]{3,4}$'
  union all
  -- Führende Null: die BKI-Liste findet die KG trotzdem (ltrim), nur uneinheitlich
  select g.tenant_id, 'hinweis', 'kg_fuehrende_null', 'KG-Nummer mit führender Null', g.katastralgemeinde || ' / GST ' || coalesce(g.gst_nr, '∅')
    from public.grundstuecke g
   where coalesce(g.aktiv, true) and g.katastralgemeinde ~ '^0+[1-9][0-9]{3,4}$'
  union all
  select g.tenant_id, 'pflege', 'gst_nr_fehlt', 'Grundstück ohne gültige GST-Nummer', coalesce(g.katastralgemeinde, '∅') || ' / GST ' || coalesce(g.gst_nr, '∅')
    from public.grundstuecke g
   where coalesce(g.aktiv, true) and coalesce(btrim(g.gst_nr), '') in ('', '0')
  union all
  -- GLÖZ-/Landschaftselement-Zeilen (GL*, LSE) dürfen ohne Fläche sein
  select g.tenant_id, 'pflege', 'weingrundstueck_ohne_flaeche', 'Weingarten-Grundstück ohne Fläche', coalesce(g.katastralgemeinde, '∅') || ' / GST ' || coalesce(g.gst_nr, '∅')
    from public.grundstuecke g
   where coalesce(g.aktiv, true) and coalesce(g.flaeche_ha, 0) <= 0 and coalesce(g.nutzart, '') !~ '^(GL|LSE)'
  union all
  select w.tenant_id, 'hinweis', 'ried_flaeche_abweichung', 'Ried-Fläche ≠ Summe der Grundstücke',
         w.name || ': ' || w.flaeche_ha || ' ha / ' || s.summe || ' ha'
    from public.weingarten w
    join lateral (select sum(g.flaeche_ha) as summe from public.grundstuecke g
                   where g.weingarten_id = w.id and coalesce(g.aktiv, true) and coalesce(g.nutzart, '') !~ '^(GL|LSE)') s on true
   where w.aktiv and s.summe is not null and w.flaeche_ha is not null and abs(w.flaeche_ha - s.summe) > 0.005
  union all
  -- ── Verkauf und Zahlungen ────────────────────────────────────────────────────────────────────────────
  select v.tenant_id, 'fehler', 'rechnungsnummer_doppelt', 'Rechnungsnummer mehrfach vergeben', v.rechnungsnummer || ' (' || count(*) || '×)'
    from public.verkaufsposten v where nullif(btrim(v.rechnungsnummer), '') is not null
   group by v.tenant_id, v.rechnungsnummer having count(*) > 1
  union all
  select v.tenant_id, 'fehler', 'bezahlt_ohne_zahlung', 'Verkauf als bezahlt markiert, aber keine gültige Zahlung', coalesce(v.rechnungsnummer, v.id::text)
    from public.verkaufsposten v
   where v.bezahlt and not coalesce(v.storniert, false) and v.storniert_am is null
     and not exists (select 1 from public.zahlungen z where z.verkaufsposten_id = v.id and z.storniert_am is null)
  union all
  select z.tenant_id, 'fehler', 'zahlung_auf_storno', 'Gültige Zahlung auf storniertem Verkauf', coalesce(v.rechnungsnummer, v.id::text) || ' · ' || z.betrag || ' €'
    from public.zahlungen z join public.verkaufsposten v on v.id = z.verkaufsposten_id
   where z.storniert_am is null and (coalesce(v.storniert, false) or v.storniert_am is not null)
)
select b.name as betrieb, x.schwere, x.pruefung, x.text, count(*) as anzahl,
       string_agg(x.beispiel, ' | ' order by x.beispiel) filter (where x.rn <= 5) as beispiele
  from (select f.*, row_number() over (partition by f.tenant_id, f.pruefung order by f.beispiel) as rn from befunde f) x
  join betrieb b on b.id = x.tenant_id
 group by b.name, x.schwere, x.pruefung, x.text
 order by b.name, case x.schwere when 'fehler' then 1 when 'pflege' then 2 else 3 end, x.pruefung;
