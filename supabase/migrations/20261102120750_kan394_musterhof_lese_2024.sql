-- KAN-394 Nachtrag 3, Rest (02.11.2026, Freigabe Jörgen: „ja, Entwurf für 2024 vorlegen“): demo_musterhof_y2_kette() legt die
-- drei Vorjahres-Pressungen (Lese 2024/1: Hauptlese GV, Selektive Handlese Riesling, Frühlese Sektgrundwein) mit Traubenzeilen
-- je GST an, aber keine Lesedaten – damit galten 5 GST als überzogen (1021/4, 513, 512/1, 977/1, 977/2).
--
-- Neu: direkt nach den Traubenzeilen je Zeile eine Lesezeile mit derselben Ried, demselben GST, denselben kg, Lesedatum und °KMW
-- (Rebsorte aus dem Katalog, Qualitätswein, Handlese, Weinland). Feste IDs (demo_musterhof_id(38, 241 …)), ON CONFLICT DO NOTHING –
-- ein zweiter Aufruf ändert nichts. Die Zeilen entstehen vor demo_musterhof_kellerbuch() (Kellerbuch-Abschluss bis 31.07. Vorjahr).
-- Dazu: demo_musterhof_lesen() räumt auch die GST-Anteile des Eisweins weg (zweiter Aufruf von y2_kette wieder möglich).

DO $m$
DECLARE
  c_alt constant text := 'make_date(y2,9,5),  16.1);';
  c_neu constant text := $neu$make_date(y2,9,5),  16.1);

  -- KAN-394: Lesedaten zu den Vorjahres-Pressungen (je Traubenzeile dieselbe Ried, dasselbe GST und dieselben kg)
  insert into ernte_parzellen (id, jahrgang_id, lese_id, weingarten_id, grundstueck_id, rebsorte_id, ernte_datum, menge_kg, menge_hl,
    klosterneuburger, mostgewicht_einheit, qualitaetsstufe, lesemethode, herkunft_code, weinbezeichnung, created_at)
  select demo_musterhof_id(38, 240 + (row_number() over (order by p.datum, pw.ernte_datum, pw.grundstueck_id))::int),
         p.jahrgang_id, p.lese_id, pw.weingarten_id, pw.grundstueck_id,
         (select rs.id from rebsorten rs where rs.name_de = pw.rebsorte limit 1),
         pw.ernte_datum, pw.trauben_kg, round(pw.trauben_kg / 130, 2), pw.kmw, 'kmw', 'qualitaetswein', 'handlese', 'wlnoe',
         p.weinbezeichnung, pw.ernte_datum::timestamptz
    from pressung_weingaerten pw join pressungen p on p.id = pw.pressung_id
   where p.tenant_id = c_t and p.id in (demo_musterhof_id(9,40), demo_musterhof_id(9,41), demo_musterhof_id(9,42))
     and pw.storniert_am is null
  on conflict (id) do nothing;$neu$;
  v_def text := pg_get_functiondef('public.demo_musterhof_y2_kette()'::regprocedure);
  v_treffer int;
BEGIN
  v_treffer := (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt);
  IF v_treffer <> 1 THEN
    RAISE EXCEPTION 'KAN-394: erwartet genau eine Stelle „%“ in demo_musterhof_y2_kette, gefunden %', c_alt, v_treffer;
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$m$;

-- demo_musterhof_lesen() räumt vor dem Neuanlegen nur den Eiswein-Eintrag mit fester ID weg; seit demo_musterhof_lese_je_gst()
-- (Migration 20261102114052) gibt es an der Ried Sandgrube GV einen zweiten GST-Anteil – der blieb liegen, und ein zweiter Aufruf
-- von demo_musterhof_y2_kette() scheiterte an ernte_parzellen_lese_fkey. Jetzt: alle Lesezeilen der Vorjahres-Lesen ab Nr. 2.
DO $m$
DECLARE
  c_alt constant text := 'delete from ernte_parzellen where id = demo_musterhof_id(38, 30) and jahrgang_id = jg_y1;';
  c_neu constant text := 'delete from ernte_parzellen where jahrgang_id = jg_y1 and (id = demo_musterhof_id(38, 30)'
                      || ' or lese_id in (select id from lesen where tenant_id = c_t and jahrgang_id = jg_y1 and lfd_nr > 1));'
                      || '  -- KAN-394: auch die GST-Anteile';
  v_def text := pg_get_functiondef('public.demo_musterhof_lesen()'::regprocedure);
  v_treffer int;
BEGIN
  v_treffer := (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt);
  IF v_treffer <> 1 THEN
    RAISE EXCEPTION 'KAN-394: erwartet genau eine Stelle „%“ in demo_musterhof_lesen, gefunden %', c_alt, v_treffer;
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$m$;

-- Selbstprüfung: Lesedaten-Einfügung steht vor dem Aufruf von demo_musterhof_kellerbuch(), Aufräumen erfasst die GST-Anteile
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.demo_musterhof_y2_kette()'::regprocedure);
BEGIN
  IF position('KAN-394: auch die GST-Anteile' in pg_get_functiondef('public.demo_musterhof_lesen()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'KAN-394: Aufräumen der GST-Anteile fehlt in demo_musterhof_lesen';
  END IF;
  IF position('demo_musterhof_id(38, 240 +' in v_def) = 0
     OR position('demo_musterhof_id(38, 240 +' in v_def) > position('perform demo_musterhof_kellerbuch();' in v_def) THEN
    RAISE EXCEPTION 'KAN-394: Lesedaten 2024 fehlen in demo_musterhof_y2_kette oder stehen nach demo_musterhof_kellerbuch()';
  END IF;
END
$$;
