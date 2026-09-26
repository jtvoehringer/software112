-- ─────────────────────────────────────────────────────────────────────────────
-- kan133_spritzbruehe_demo_kommentare (KAN-133 Teil 2, Soll 15 und 16, 26.09.2026)
--
-- Zweck: „Menge gesamt“ (behandlungen.menge_gesamt/menge_einheit) ist bei Spritzungen die
-- Spritzbrühe in l, bei Düngungen die Düngermenge. Teil 1 (Code, Soll 1–14 und 17) liest die
-- Mittelmenge einer Spritzung nur noch aus dem Aufwand; diese Migration zieht Datenbank und
-- Demo-Betrieb nach:
--   1  Spaltenkommentare menge_gesamt, menge_einheit, reinkupfer_kg_ha (Soll 15)
--   2  Demo-Reset demo_musterhof_zuruecksetzen(): Spritzungen mit Spritzbrühe = Wasseraufwand ×
--      Fläche in l, Düngung unverändert (Soll 16); dazu die offene Folgeaufgabe aus KAN-128:
--      tenant_einstellungen.mostgewicht_einheit beim Reset zurück auf 'kmw'
--   3  Bestand Musterhof: die 30 Spritzungen von Mittelmenge (kg bzw. l) auf Spritzbrühe (l)
--      umsetzen (Soll 16, Entscheidung 2)
--   4  Selbstprüfung
--   5  OPTIONAL: CHECK „Spritzung nur l“ (eigener Abschnitt am Ende, vor dem Einspielen entscheiden)
--
-- Entscheidungen (Jörgen, 26.09.2026, KAN-133 „Entscheidungen“ und KAN-132):
--   Grundsatz  Spritzung: menge_gesamt = Spritzbrühe (l, nie die Mittelmenge); Mittelmenge nur aus
--              dem Aufwand (kg_ha/l_ha × Fläche · kg/l gesamt · g_hl/ml_hl × Brühe ÷ 100 ÷ 1000).
--              Düngung: Düngermenge in kg, in l nur bei duengemittel.einheit = 'l'.
--   1  Flüssigdünger nur in l, wenn das Düngemittel in l geführt wird – daher im Kommentar ergänzt.
--   2  Musterhof-Spritzungen in kg per Migration auf Brühe umsetzen (keine Heuristik „kg = Mittel“
--      im Code). Umgesetzt wird nur das Seed-Muster (menge_gesamt = round(Aufwand × Σ GST-Fläche, 3)
--      in kg bzw. l passend zur Aufwand-Einheit) – keine anderen Betriebe, keine Zeilen, die der
--      neue Code schon als Brühe geschrieben hat.
--   8  reinkupfer_kg_ha füllt der Server (Teil 1, massnahmeMengen.ts). Die 6 Kupfer-Spritzungen im
--      Musterhof haben schon den Wert, den der Server rechnet (0,525 / 0,5 / 0,42 kg/ha) – die
--      Seed-Formel für reinkupfer_kg_ha (Aufwand × Cu % bei kg_ha) bleibt deshalb unverändert.
--   Brühe nie über Maßnahmen summieren: Tankmischungen sind mehrere Zeilen mit derselben Brühe
--   (10.07. Cuprozin progress + Topas → beide 8.460 l).
--
-- Datenstand 26.09.2026 (live per SELECT):
--   behandlungen: 52 Zeilen, alle Musterhof (Gebeshuber, Spaetrot, Sandbox: 0 Maßnahmen).
--   Musterhof: 30 Spritzungen – 20 in kg (Σ 582,108) und 10 in l (Σ 207,270) –, 4 Düngungen in kg
--   (Σ 8.070), 18 Maßnahmen ohne Menge. Alle 30 Spritzungen: Seed-IDs demo_musterhof_id(6, n),
--   Aufwand kg_ha/l_ha, Wasseraufwand 200–600 l/ha, Σ behandlung_grundstuecke.flaeche_ha 14,1 ha
--   (28 Zeilen) bzw. 4,75 ha (Steward, 2 Zeilen) = behandelte_flaeche_ha, menge_gesamt =
--   round(Aufwand × Σ GST-Fläche, 3). Neue Spritzbrühe Σ 185.230 l (117.550 aus den kg-Zeilen,
--   67.680 aus den l-Zeilen), je Maßnahme 2.375–8.460 l; Mittelmenge (Aufwand × Fläche) = bisheriges
--   menge_gesamt → Lager (Bordeaux Manica 20 19,5 kg, Cuprozin progress 18,86 kg, Folpan 80 WDG
--   27,96 kg, Luna Experience 11,72 l, Mildicut 31,7 l, Netzschwefel Stulln 67,76 kg, Steward
--   1,312 kg, Topas 9,31 l; Biosol 950 kg, Patentkali 280 kg) und Kupfer-Bilanz (2026: 20,3745 kg
--   Cu ÷ 14,1 ha WI = 1,445 kg/ha) bleiben mit dem Code aus Teil 1 unverändert.
--   Trigger auf behandlungen: nur behandlungen_updated_at (BEFORE UPDATE, ohne Spaltenliste); kein
--   Protokoll-Trigger (bestandsprotokoll) auf behandlungen oder behandlung_grundstuecke.
--   menge_einheit: text ohne Default, NULL erlaubt; CHECK behandlungen_menge_einheit_check (kg, l, g, ml).
--   demo_musterhof_zuruecksetzen(): 106.380 Zeichen (md5 f14ae74501752f9dd392c4e76a535fa9),
--   SECURITY DEFINER, search_path = public, Owner postgres, EXECUTE nur postgres und service_role;
--   läuft nächtlich um 03:00 über die Hohenstein Suite (zusammen mit demo_musterhof_y2_kette(), die
--   keine Maßnahmen schreibt und unverändert bleibt). Die Maßnahmen-Menge steht nur an einer Stelle
--   (Saisonvorlage, INSERT INTO behandlungen), das erste UPDATE tenant_einstellungen setzt nur Zähler
--   und ea_betriebsbeginn. tenant_einstellungen.mostgewicht_einheit: alle 4 Betriebe 'kmw'.
--   plpgsql_check der Reset-Funktion vorher: 0 error, 4 warning, 2 warning extra (unverändert erwartet).
--
-- Wahl: Die Reset-Funktion wird per DO-Block gepatcht (pg_get_functiondef lesen, zwei exakte
-- Textstellen ersetzen, jede muss genau einmal treffen, per EXECUTE neu anlegen) – wie Migration
-- 216/217 und kan35_datenintegritaet (M10). Gegen die volle Funktion (106.000 Zeichen) spricht:
-- die Migration bliebe lesbar und prüfbar (nur die zwei Stellen), zwischenzeitliche Änderungen an
-- anderen Stellen der Funktion (KAN-126/KAN-129 …) würden nicht still zurückgedreht, und ein
-- abweichender Text bricht ab, statt eine falsche Fassung einzuspielen. CREATE OR REPLACE behält
-- Owner, Rechte, SECURITY DEFINER und search_path (werden im Block verglichen, REVOKE/GRANT danach
-- wie in kan35_datenintegritaet noch einmal gesetzt).
--
-- Nebenwirkungen:
--   * Abschnitt 3 = 30 UPDATEs (nur Musterhof), ohne Trigger-Abschalten und ohne
--     session_replication_role (KAN-124). updated_at der 30 Zeilen springt auf den Migrationszeitpunkt
--     (behandlungen_updated_at; nur mit Trigger-Abschalten vermeidbar, der nächste Demo-Reset setzt es
--     wieder auf das Maßnahmendatum). 0 Protokollzeilen, behandlung_grundstuecke unverändert.
--   * Mit dem Code VOR Teil 1 würde die Brühe als Mittelmenge gelesen (Musterhof: Lager Cuprozin
--     progress −33.745 kg, Netzschwefel Stulln −41.860 kg, Kupfer-Kachel 540 kg/ha) – daher erst NACH
--     dem Deploy von Teil 1.
--   * Demo-Reset: bis zu dieser Migration schreibt er die Spritzungen weiter als Mittelmenge in kg/l
--     (Teil 1 zeigt sie als Altwert, Nr. 9 warnt), danach als Brühe in l. Setzt ein Demo-Konto
--     (tenant_admin) die Mostgewicht-Einheit auf °Oe, stellt der nächste Reset wieder 'kmw' ein.
--   * Quelle der Demo-Funktionen in der Hohenstein Suite (supabase/s112/demo_musterhof.sql) spätestens
--     zusammen mit dieser Migration um dieselben zwei Stellen nachziehen (Spritzbrühe in l,
--     mostgewicht_einheit = 'kmw'). Ohne Abschnitt 5 macht ein erneutes Einspielen der alten Quelle nur
--     Abschnitt 2 rückgängig. MIT Abschnitt 5 scheitert danach der ganze nächtliche Demo-Reset: die alte
--     Saisonvorlage schreibt Spritzungen in kg (kg_ha-Zeilen) → 23514 an
--     behandlungen_spritzung_bruehe_l_check; der Reset läuft als ein RPC-Aufruf und rollt komplett
--     zurück – der Demo-Betrieb wird nicht mehr zurückgesetzt, demo_musterhof_y2_kette() läuft nicht,
--     demo_musterhof_info()->>'letzter_reset' bleibt stehen. Prüfen: ein md5-Vergleich mit dem
--     Funktionstext nach dieser Migration (d1861413…) taugt nur, wenn die Suite-Funktion genau durch
--     diesen Text ersetzt wird (die Suite-Quelle weicht schon heute textlich von live ab, u. a.
--     Kommentare); sonst genügt die Prüfung, dass die Quelle bei Spritzungen keine Menge außer in l schreibt.
--   * Neuaufbau einer Datenbank: Abschnitt 2 patcht die Funktion so, wie sie die älteren Migrationen
--     angelegt haben; weicht deren Text an den zwei Stellen ab, bricht der Block mit Meldung ab.
--   * Sperren: COMMENT ON COLUMN → SHARE UPDATE EXCLUSIVE auf behandlungen; UPDATE → ROW EXCLUSIVE und
--     Zeilensperren auf 30 Musterhof-Zeilen; CREATE OR REPLACE FUNCTION → Zeile in pg_proc (ein
--     gleichzeitig laufender Reset rechnet mit der alten Fassung zu Ende); optional Abschnitt 5 →
--     ACCESS EXCLUSIVE auf behandlungen bis zum Ende der Transaktion (Prüfung von 52 Zeilen, Millisekunden).
--     lock_timeout wie KAN-73/KAN-128: hält eine lange Transaktion eine Sperre, bricht die Migration nach 5 s ab.
--
-- Reihenfolge und Übergang:
--   * Am Deploy-Tag NACH Teil 1 (Code, Soll 1–14 und 17): erst Teil 1 ausrollen und prüfen, dann diese
--     Migration. Vor Teil 1 NICHT einspielen (siehe Nebenwirkungen; der CHECK aus Abschnitt 5 lehnte
--     außerdem jede Spritzung ab, die die alte App mit Vorgabe kg speichert – ebenso den Demo-Reset aus
--     der alten Hohenstein-Suite-Quelle, siehe Nebenwirkungen).
--   * Gebeshuber-Nachträge: Teil 1 muss live sein, bevor die erste Maßnahme erfasst wird; diese
--     Migration fasst andere Betriebe nie an. Hat ein Betrieb trotzdem Spritzungen in kg/g (Altwerte
--     der alten App), bricht nur der optionale Abschnitt 5 ab (Vorprüfung mit Anzahl je Betrieb).
--   * Findet die Selbstprüfung Musterhof-Spritzungen in kg/g außerhalb des Seed-Musters (mit der alten
--     App angelegt): Demo-Reset ausführen (zuruecksetzen() und y2_kette(), noch alte Fassung) und die
--     Migration wiederholen.
--
-- Wiederholbar: Kommentare idempotent; Abschnitt 2 erkennt die bereits gepatchte Fassung (neue Stelle
-- genau einmal, alte nicht mehr → kein EXECUTE); Abschnitt 3 trifft beim zweiten Lauf 0 Zeilen (Seed-
-- Muster „Menge = Aufwand × Fläche“ gibt es dann nicht mehr); Abschnitt 5 mit DROP … IF EXISTS.
--
-- Neuer CHECK-Constraint (nur mit Abschnitt 5; Name für PRUEFREGEL_MELDUNG in src/lib/fehler.ts):
--   behandlungen_spritzung_bruehe_l_check
--
-- Danach: Security Advisor (Lint 0028/0029, search_path), plpgsql_check
-- (SELECT * FROM extensions.plpgsql_check_function_tb('public.demo_musterhof_zuruecksetzen()') –
-- wie vorher 0 error), `npx supabase migration list`, SELECT aus notizen.md („Nach dem Einspielen“),
-- Hohenstein-Suite-Quelle, Smoke-Test Lager/Kupfer-Bilanz/psm-aufzeichnung im Musterhof.
-- Rückbau (nur im Notfall): rueckbau.sql. Rollback-Test: rollback_test.sql.
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';


-- ─── 1. Spaltenkommentare (Soll 15) ─────────────────────────────────────────
-- Vorher: menge_gesamt „Gesamt eingesetzte Produktmenge …“ (Migration 015), menge_einheit ohne,
-- reinkupfer_kg_ha „… berechnet aus Gesamtmenge x Cu-Gehalt(%) des PSM / Fläche …“.
COMMENT ON COLUMN public.behandlungen.menge_gesamt IS
  'Spritzung: gesamte Spritzbrühe in l (nicht die Mittelmenge; Mittelmenge = Aufwand × Fläche). Düngung: Düngermenge in kg (in l nur bei Düngemittel mit Einheit l). Spritzbrühe nie über Maßnahmen summieren – eine Tankmischung sind mehrere Zeilen mit derselben Brühe (KAN-133).';
COMMENT ON COLUMN public.behandlungen.menge_einheit IS
  'Einheit zu menge_gesamt: Spritzung l (Spritzbrühe; ml rechnet der Server in l um), Düngung kg bzw. l bei Düngemittel in l (g in kg umgerechnet) – KAN-133.';
COMMENT ON COLUMN public.behandlungen.reinkupfer_kg_ha IS
  'Reinkupfer-Eintrag je Hektar in kg: aus Mittelmenge (Aufwand) × Cu-Gehalt ÷ Fläche, serverseitig berechnet (KAN-133; Mittel in l mit 1 kg/l wie die Kupfer-Bilanz). Nur bei Spritzungen mit kupferhaltigem Mittel gefüllt.';


-- ─── 2. Demo-Reset patchen (Soll 16 und KAN-128-Folgeaufgabe) ───────────────
-- (a) Saisonvorlage der Maßnahmen: menge_gesamt/menge_einheit einer Spritzung = Spritzbrühe
--     round(r.wasser × v_ha, 3) in l (v_ha = Σ WI-GST-Fläche wie behandlung_grundstuecke);
--     Düngung unverändert (Düngermenge = Aufwand × Fläche in kg). Die Vorlage hat bei jeder
--     Spritzung einen Wasseraufwand (200–600 l/ha); ohne Wasser bliebe die Menge leer.
-- (b) erstes UPDATE tenant_einstellungen: mostgewicht_einheit = 'kmw' (KAN-128, Kopf dort „OFFEN“).
-- demo_musterhof_y2_kette() schreibt weder Maßnahmen noch Einstellungen – bleibt unverändert.
DO $demo$
DECLARE
  c_fn        constant regprocedure := 'public.demo_musterhof_zuruecksetzen()'::regprocedure;
  c_menge_alt constant text :=
       E'        case when r.aufwand is not null then round(r.aufwand * v_ha, 3) end,\n'
    || E'        case when r.aufwand is not null then (case r.einheit when ''kg_ha'' then ''kg'' else ''l'' end) end,\n';
  c_menge_neu constant text :=
       E'        case when r.art = ''spritzung'' then round(r.wasser * v_ha, 3)  -- KAN-133: Spritzbrühe (l) = Wasseraufwand × Fläche, nie die Mittelmenge\n'
    || E'             when r.aufwand is not null then round(r.aufwand * v_ha, 3) end,  -- Düngung: Düngermenge\n'
    || E'        case when r.art = ''spritzung'' then (case when r.wasser is not null then ''l'' end)\n'
    || E'             when r.aufwand is not null then (case r.einheit when ''kg_ha'' then ''kg'' else ''l'' end) end,\n';
  c_einst_alt constant text :=
       E'         ea_betriebsbeginn = make_date(y1, 1, 1)\n'
    || E'   where tenant_id = c_t;\n';
  c_einst_neu constant text :=
       E'         ea_betriebsbeginn = make_date(y1, 1, 1),\n'
    || E'         mostgewicht_einheit = ''kmw''  -- KAN-128: bevorzugte Einheit beim Reset zurück auf den Standard\n'
    || E'   where tenant_id = c_t;\n';
  v_alt_texte text[] := ARRAY[c_menge_alt, c_einst_alt];
  v_neu_texte text[] := ARRAY[c_menge_neu, c_einst_neu];
  v_namen     text[] := ARRAY['Menge der Saisonvorlage (INSERT INTO behandlungen)', 'erstes UPDATE tenant_einstellungen'];
  v_def       text;
  v_neu       text;
  v_n_alt     integer;
  v_n_neu     integer;
  v_vorher    jsonb;
  v_nachher   jsonb;
BEGIN
  SELECT jsonb_build_object('secdef', p.prosecdef, 'config', p.proconfig, 'owner', p.proowner::regrole::text,
                            'acl', p.proacl::text, 'volatile', p.provolatile, 'parallel', p.proparallel,
                            'strict', p.proisstrict, 'result', pg_get_function_result(p.oid),
                            'args', pg_get_function_identity_arguments(p.oid), 'kommentar', obj_description(p.oid, 'pg_proc')),
         pg_get_functiondef(p.oid)
    INTO v_vorher, v_def
    FROM pg_proc p
   WHERE p.oid = c_fn;
  IF NOT (v_vorher ->> 'secdef')::boolean OR v_vorher ->> 'result' <> 'void' OR v_vorher ->> 'args' <> '' THEN
    RAISE EXCEPTION 'KAN-133: % hat eine unerwartete Signatur (%)', c_fn, v_vorher;
  END IF;
  IF v_def !~ E'\n  c_t [^\n]*uuid := ''33333333-3333-4333-8333-333333333333'';' THEN
    RAISE EXCEPTION 'KAN-133: % deklariert c_t nicht als Demo-Mandanten 33333333-… – Text prüfen', c_fn;
  END IF;

  v_neu := v_def;
  FOR i IN 1 .. cardinality(v_alt_texte) LOOP
    v_n_alt := (length(v_neu) - length(replace(v_neu, v_alt_texte[i], ''))) / length(v_alt_texte[i]);
    v_n_neu := (length(v_neu) - length(replace(v_neu, v_neu_texte[i], ''))) / length(v_neu_texte[i]);
    IF v_n_alt = 1 AND v_n_neu = 0 THEN
      v_neu := replace(v_neu, v_alt_texte[i], v_neu_texte[i]);
    ELSIF v_n_alt = 0 AND v_n_neu = 1 THEN
      NULL;  -- bereits umgestellt (zweiter Lauf)
    ELSE
      RAISE EXCEPTION 'KAN-133: % – „%“: alte Fassung % mal, neue % mal gefunden (erwartet genau eine von beiden, einmal) – Text prüfen',
        c_fn, v_namen[i], v_n_alt, v_n_neu;
    END IF;
  END LOOP;

  IF v_neu <> v_def THEN
    EXECUTE v_neu;
  END IF;

  -- CREATE OR REPLACE behält Owner, Rechte und Eigenschaften – hier nachgeprüft
  SELECT jsonb_build_object('secdef', p.prosecdef, 'config', p.proconfig, 'owner', p.proowner::regrole::text,
                            'acl', p.proacl::text, 'volatile', p.provolatile, 'parallel', p.proparallel,
                            'strict', p.proisstrict, 'result', pg_get_function_result(p.oid),
                            'args', pg_get_function_identity_arguments(p.oid), 'kommentar', obj_description(p.oid, 'pg_proc'))
    INTO v_nachher
    FROM pg_proc p
   WHERE p.oid = c_fn;
  IF v_nachher IS DISTINCT FROM v_vorher THEN
    RAISE EXCEPTION 'KAN-133: Eigenschaften von % geändert: vorher %, nachher %', c_fn, v_vorher, v_nachher;
  END IF;
END $demo$;

REVOKE EXECUTE ON FUNCTION public.demo_musterhof_zuruecksetzen() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.demo_musterhof_zuruecksetzen() TO service_role;


-- ─── 3. Bestand Musterhof: Spritzungen auf Spritzbrühe umsetzen (Soll 16) ────
-- Nur der Demo-Betrieb und nur das Seed-Muster: Menge = round(Aufwand × Σ GST-Fläche, 3) in der
-- Einheit der Aufwand-Einheit (kg_ha → kg, l_ha → l), mit Wasseraufwand und Fläche. Neu:
-- round(Wasseraufwand × Σ behandlung_grundstuecke.flaeche_ha, 3) in l – wie der Demo-Reset nach
-- Abschnitt 2. Erwartung beim ersten Lauf (SELECT 26.09.2026): 30 Zeilen, Σ 185.230 l; Tankmischung
-- 10.07.2025/2026 Cuprozin progress + Topas → je 8.460 l. Zweiter Lauf: 0 Zeilen.
WITH flaeche AS (
  SELECT bg.behandlung_id, sum(bg.flaeche_ha) AS ha
    FROM public.behandlung_grundstuecke bg
   WHERE bg.behandlung_id IN (SELECT b.id FROM public.behandlungen b
                               WHERE b.tenant_id = '33333333-3333-4333-8333-333333333333' AND b.art = 'spritzung')
   GROUP BY bg.behandlung_id
)
UPDATE public.behandlungen b
   SET menge_gesamt  = round(b.wasseraufwand_l_ha * f.ha, 3),
       menge_einheit = 'l'
  FROM flaeche f
 WHERE f.behandlung_id = b.id
   AND b.tenant_id = '33333333-3333-4333-8333-333333333333'
   AND b.art = 'spritzung'
   AND b.wasseraufwand_l_ha > 0
   AND f.ha > 0
   AND b.aufwandmenge_einheit IN ('kg_ha', 'l_ha')
   AND b.menge_einheit = CASE b.aufwandmenge_einheit WHEN 'kg_ha' THEN 'kg' ELSE 'l' END
   AND b.menge_gesamt = round(b.aufwandmenge * f.ha, 3);


-- ─── 4. Selbstprüfung ───────────────────────────────────────────────────────
-- Bricht ab, wenn im Musterhof noch eine Spritzung mit Menge außerhalb von l steht (Altwert, den
-- Abschnitt 3 nicht erkennt) oder der Demo-Reset nicht die neue Fassung hat.
DO $pruefung$
DECLARE
  v_altwerte bigint;
  v_def      text;
BEGIN
  SELECT count(*) INTO v_altwerte
    FROM public.behandlungen
   WHERE tenant_id = '33333333-3333-4333-8333-333333333333'
     AND art = 'spritzung' AND menge_gesamt IS NOT NULL AND menge_einheit IS DISTINCT FROM 'l';
  IF v_altwerte > 0 THEN
    RAISE EXCEPTION 'KAN-133: % Musterhof-Spritzungen mit Menge nicht in l nach der Umsetzung – Abbruch', v_altwerte
      USING HINT = 'Mit der alten App angelegt? Demo-Reset ausführen (demo_musterhof_zuruecksetzen(), demo_musterhof_y2_kette()) und die Migration wiederholen.';
  END IF;

  v_def := pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure);
  IF position('round(r.wasser * v_ha, 3)  -- KAN-133' IN v_def) = 0
     OR position(E'mostgewicht_einheit = ''kmw''  -- KAN-128' IN v_def) = 0
     OR position(E'        case when r.aufwand is not null then round(r.aufwand * v_ha, 3) end,\n' IN v_def) > 0 THEN
    RAISE EXCEPTION 'KAN-133: demo_musterhof_zuruecksetzen() hat nicht die neue Fassung – Abbruch';
  END IF;
END $pruefung$;


-- ═══ 5. OPTIONAL: CHECK „Spritzung nur l“ ════════════════════════════════════
-- Vor dem Einspielen entscheiden; ohne ihn diesen Abschnitt bis zum Dateiende streichen (die
-- Abschnitte 1–4 hängen nicht davon ab). Sichert in der Datenbank ab, was der Server (Teil 1,
-- pruefeMassnahmeMengen) schon prüft: eine Spritzung mit Menge hat die Einheit l. menge_einheit
-- hat keinen Default – eine Menge ohne Einheit lehnt der CHECK bei Spritzungen ebenfalls ab
-- (IS NOT DISTINCT FROM statt =, sonst ließe NULL die Prüfung passieren). art IS DISTINCT FROM
-- statt <>: art ist nullable (Default 'spritzung'), eine Zeile ohne Art prüft der CHECK nicht.
-- Vorprüfung: andere Betriebe werden nie umgesetzt – stehen dort Spritzungen mit Menge nicht in l
-- (Altwerte der alten App), bricht die Migration mit Anzahl je Betrieb ab, statt mit 23514.
-- Deutsche Meldung für PRUEFREGEL_MELDUNG (src/lib/fehler.ts) kommt mit dem Code.
DO $vorpruefung$
DECLARE
  v_liste text;
BEGIN
  SELECT string_agg(format('%s: %s', t.name, x.n), ', ' ORDER BY t.name)
    INTO v_liste
    FROM (SELECT b.tenant_id, count(*) AS n
            FROM public.behandlungen b
           WHERE b.art = 'spritzung' AND b.menge_gesamt IS NOT NULL AND b.menge_einheit IS DISTINCT FROM 'l'
           GROUP BY b.tenant_id) x
    JOIN public.tenants t ON t.id = x.tenant_id;
  IF v_liste IS NOT NULL THEN
    RAISE EXCEPTION 'KAN-133: Spritzungen mit Menge nicht in l (Altwerte) – CHECK behandlungen_spritzung_bruehe_l_check nicht möglich: %', v_liste
      USING HINT = 'Spritzbrühe dieser Maßnahmen zuerst in der App korrigieren (Bearbeiten, Nr. 9) oder Abschnitt 5 weglassen.';
  END IF;
END $vorpruefung$;

ALTER TABLE public.behandlungen DROP CONSTRAINT IF EXISTS behandlungen_spritzung_bruehe_l_check;
ALTER TABLE public.behandlungen ADD  CONSTRAINT behandlungen_spritzung_bruehe_l_check
  CHECK (art IS DISTINCT FROM 'spritzung' OR menge_gesamt IS NULL OR menge_einheit IS NOT DISTINCT FROM 'l');
