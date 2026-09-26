-- ─────────────────────────────────────────────────────────────────────────────
-- kan143_laubschneiden (KAN-143, 26.09.2026)
--
-- Zweck: neue Maßnahmen-Art „Laubschneiden“ (Wert 'laubschneiden') für das maschinelle
-- Laubschneiden an Seiten und Gipfel. Erweitert werden die beiden CHECKs der Maßnahmen-Arten:
--   behandlungen_art_check       spritzung, duengung, bodenbearbeitung, schnitt, laubarbeit,
--                                laubschneiden (neu), lese, sonstiges
--   saetze_massnahmen_art_check  dieselben ohne lese (Stunden-/Hektarsätze, Kosten-Vorschlag)
-- Reihenfolge der bisherigen Werte unverändert (aus pg_constraint gelesen), 'laubschneiden'
-- direkt nach 'laubarbeit'. NULL-Semantik wie bisher: behandlungen.art bleibt nullable
-- (Default 'spritzung', unverändert), saetze_massnahmen.art NOT NULL. Namen unverändert
-- (auto-benannt aus migrations_legacy 015 bzw. 133); im Code nicht referenziert – src/lib/fehler.ts
-- hat keinen Eintrag, eine Verletzung zeigt den allgemeinen Prüfregel-Text.
--
-- Entscheidungen (Jörgen, 26.09.2026, Kommentar in KAN-143):
--   * „Gipfeln“ bleibt Unterart von Laubarbeit (behandlungen.laubarbeit_art, Handarbeit).
--   * „Laubschneiden“ ist die neue Art für das maschinelle Laubschneiden an Seiten und Gipfel.
--   * Bestehende Einträge bleiben unverändert – kein Umschlüsseln, kein Nachtrag.
--
-- Datenstand 26.09.2026 (live per SELECT geprüft):
--   behandlungen: 52 Zeilen, alle Weingut Musterhof (Demo) – spritzung 30, laubarbeit 8,
--   bodenbearbeitung 6, duengung 4, schnitt 2, sonstiges 2; lese 0, NULL 0. laubarbeit_art der
--   8 Laubarbeiten: Ausbrechen, Ausdünnen / Grünlese, Entblättern Traubenzone, Heften / Einstricken
--   (je 2) – kein „Gipfeln“. Gebeshuber, Spaetrot und Sandbox: 0 Maßnahmen.
--   saetze_massnahmen: 5 Zeilen, alle Musterhof (spritzung, schnitt, laubarbeit, bodenbearbeitung,
--   duengung), keine globale Vorlage (tenant_id NULL).
--   Kommentare: behandlungen.art „Art der Massnahme: spritzung, duengung, etc.“ (Migration 015),
--   behandlungen.laubarbeit_art „Laubarbeit: z.B. Entblättern, Ausgeizen, Gipfeln“ (Migration 133),
--   saetze_massnahmen.art ohne; beide CHECKs ohne Kommentar.
--   Die neuen CHECKs werden gegen den Bestand geprüft (kein NOT VALID) – er erfüllt sie.
--
-- Weitere Stellen, die die Arten kennen (Repo-Stand origin/main 1c7d8e8 durchsucht und live per
-- SELECT bestätigt am 26.09.2026 – _selects/s1_constraints.sql, s3_abh.sql; pg_depend auf art:
-- Default, behandlungen_art_check, behandlungen_spritzung_bruehe_l_check,
-- saetze_massnahmen_art_check, idx_saetze_massnahmen_art – sonst nichts):
--   * CHECK behandlungen_spritzung_bruehe_l_check (KAN-133, Migration 20260926155758
--     kan133_spritzbruehe_demo_kommentare), ohne Kommentar:
--       CHECK ((art IS DISTINCT FROM 'spritzung') OR menge_gesamt IS NULL OR menge_einheit = 'l')
--     Kennt art nur über 'spritzung' und bleibt unverändert; 'laubschneiden' fällt nicht darunter.
--     Bestand erfüllt sie (30 Spritzungen, alle mit Menge in l). Wer später 'spritzung' umbenennt
--     oder diese Migration zurückbaut, muss sie mitdenken. Die Datei zu 20260926155758 fehlt in
--     supabase/migrations (weder in HEAD noch in origin/main) – separat gemeldet.
--   * Übrige CHECKs auf behandlungen (aufwandmenge_einheit, menge_einheit, windstaerke, witterung)
--     ohne Art-Bezug; der Rollback-Test vergleicht alle übrigen CHECKs vor/nach.
--   * Funktionen: demo_musterhof_zuruecksetzen() (SECURITY DEFINER; einzige mit 'laubarbeit' und
--     einzige mit Art-Vergleich auf behandlungen) – legt die Demo-Laubarbeiten und den Stundensatz
--     „Laubarbeit“ an. Bleibt unverändert, schreibt kein 'laubschneiden' und scheitert nicht an der
--     Erweiterung. ki_erlaubte_tabellen() nennt saetze_massnahmen nur als Tabellennamen.
--   * Views/Materialized Views: keine auf behandlungen oder saetze_massnahmen.
--   * Policies: 12 auf behandlungen, 12 auf saetze_massnahmen, 10 auf behandlung_grundstuecke
--     (Rolle, Modul, Abo-Schreibsperre, Mitgliedschaft, Zwei-Faktor; alle TO authenticated) –
--     keine mit Art-Werten, keine hängt an der Spalte art.
--   * Trigger: behandlungen_updated_at, saetze_massnahmen_updated_at (update_updated_at) – ohne
--     Art-Bezug; kein Änderungsprotokoll (z_protokoll_*) auf diesen Tabellen, keiner auf
--     behandlung_grundstuecke.
--   * KI: ki_erlaubte_tabellen() führt behandlungen und saetze_massnahmen nur als Tabellennamen,
--     ki_schema_info liefert Spalten und Typen (art bleibt text) – keine Änderung nötig. Die Werte
--     kennt die KI aus dem Code (api/ki-abfrage/route.ts, lib/assistent/tools/massnahme.ts) –
--     Teil des KAN-143-Codes, nicht dieser Migration.
--   * Kein Enum-Typ. Der Default 'spritzung' auf behandlungen.art und idx_saetze_massnahmen_art
--     (einfacher B-Baum auf der Spalte) bleiben unverändert.
--
-- Nebenwirkungen:
--   * Keine Datenänderung: kein UPDATE, kein updated_at-Sprung, keine Protokollzeilen, keine
--     Sequenzen. Typen der Data API (generate_typescript_types) ändern sich nicht (art bleibt text).
--   * Sperren: DROP/ADD CONSTRAINT holen ACCESS EXCLUSIVE auf behandlungen (52 Zeilen) und
--     saetze_massnahmen (5 Zeilen) bis zum Ende der Transaktion; der Prüf-Scan ist kurz.
--     lock_timeout wie KAN-73/KAN-128: hält eine lange Transaktion eine Sperre, bricht die
--     Migration nach 5 s ab, statt alle folgenden Zugriffe hinter sich zu stauen.
--
-- Reihenfolge und Übergang:
--   * ERST diese Migration, DANN der Code von KAN-143. Der neue Code bietet 'laubschneiden' in
--     Maßnahme-Formular, Stundensätzen und Assistent an – vor der Migration scheiterte das Speichern
--     mit 23514 (behandlungen_art_check bzw. saetze_massnahmen_art_check).
--   * Die heutige App (origin/main 1c7d8e8) läuft mit der Migration unverändert weiter: sie schreibt
--     nur die bisherigen Werte, alle bleiben erlaubt; keine Spalte, kein Default, keine Policy
--     ändert sich.
--   * Code-Rollback nach ersten Laubschneiden-Einträgen: die alte App zeigt in Listen den Rohwert
--     „laubschneiden“ (Labels mit „?? art“-Fallback: BehandlungenClient, psm.ts, rueckverfolgung.ts,
--     GrundstueckePanel); Formulare und Filter kennen die Art nicht. Ein Rückbau der Migration ist
--     dann erst nach bewusster Entscheidung über diese Einträge möglich (rueckbau.sql bricht ab).
--
-- Wiederholbar: Vorprüfung akzeptiert den Stand vor UND nach der Migration; DROP CONSTRAINT IF
-- EXISTS + ADD, COMMENT überschreibt. Ein zweiter Lauf ändert nichts.
-- Rollback-Test: rollback_test.sql (EIN DO-Block, endet immer mit RAISE EXCEPTION).
-- Rückbau (nur im Notfall): rueckbau.sql.
-- Danach: `npx supabase migration list`, md5 gegen schema_migrations.statements, Security Advisor
-- (keine neue Funktion, trotzdem prüfen), Smoke-Test live (Maßnahme und Stundensatz
-- „Laubschneiden“ im Musterhof anlegen und wieder löschen).
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';


-- ─── 0. Vorprüfung ──────────────────────────────────────────────────────────
-- Bricht ab, wenn ein CHECK weder dem Stand vom 26.09.2026 (vorher) noch dem Zielstand (nachher)
-- entspricht – sonst ginge ein zwischenzeitlich ergänzter Wert beim Neuanlegen still verloren.
-- Vergleich der Werte samt Reihenfolge aus pg_get_constraintdef.
DO $vorpruefung$
DECLARE
  r_con  record;
  v_ist  text[];
BEGIN
  FOR r_con IN
    SELECT * FROM (VALUES
      ('behandlungen'::text, 'behandlungen_art_check'::text,
       ARRAY['spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'lese', 'sonstiges']::text[],
       ARRAY['spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'laubschneiden', 'lese', 'sonstiges']::text[]),
      ('saetze_massnahmen', 'saetze_massnahmen_art_check',
       ARRAY['spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'sonstiges']::text[],
       ARRAY['spritzung', 'duengung', 'bodenbearbeitung', 'schnitt', 'laubarbeit', 'laubschneiden', 'sonstiges']::text[])
    ) AS t(tabelle, constraint_name, vorher, nachher)
  LOOP
    SELECT array_agg(m.wert[1] ORDER BY m.nr) INTO v_ist
      FROM pg_constraint c,
           LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') WITH ORDINALITY AS m(wert, nr)
     WHERE c.conrelid = format('public.%I', r_con.tabelle)::regclass
       AND c.conname = r_con.constraint_name
       AND c.contype = 'c';
    IF v_ist IS DISTINCT FROM r_con.vorher AND v_ist IS DISTINCT FROM r_con.nachher THEN
      RAISE EXCEPTION 'KAN-143: % hat die Werte % – erwartet % (vorher) oder % (nachher)',
        r_con.constraint_name, coalesce(array_to_string(v_ist, ', '), '(kein CHECK)'),
        array_to_string(r_con.vorher, ', '), array_to_string(r_con.nachher, ', ')
        USING HINT = 'Definition per pg_constraint neu lesen und die Listen dieser Migration anpassen.';
    END IF;
  END LOOP;
END $vorpruefung$;


-- ─── 1. Maßnahmen (behandlungen) ────────────────────────────────────────────
ALTER TABLE public.behandlungen
  DROP CONSTRAINT IF EXISTS behandlungen_art_check;

ALTER TABLE public.behandlungen
  ADD CONSTRAINT behandlungen_art_check
  CHECK (art IN (
    'spritzung', 'duengung', 'bodenbearbeitung', 'schnitt',
    'laubarbeit', 'laubschneiden', 'lese', 'sonstiges'
  ));

COMMENT ON CONSTRAINT behandlungen_art_check ON public.behandlungen IS
  'KAN-143: Maßnahmen-Arten, laubschneiden (maschinelles Laubschneiden an Seiten und Gipfel) neu nach laubarbeit; NULL erlaubt (Default spritzung)';


-- ─── 2. Stunden-/Hektarsätze (saetze_massnahmen) ────────────────────────────
ALTER TABLE public.saetze_massnahmen
  DROP CONSTRAINT IF EXISTS saetze_massnahmen_art_check;

ALTER TABLE public.saetze_massnahmen
  ADD CONSTRAINT saetze_massnahmen_art_check
  CHECK (art IN (
    'spritzung', 'duengung', 'bodenbearbeitung', 'schnitt',
    'laubarbeit', 'laubschneiden', 'sonstiges'
  ));

COMMENT ON CONSTRAINT saetze_massnahmen_art_check ON public.saetze_massnahmen IS
  'KAN-143: Arten der Stunden-/Hektarsätze wie behandlungen_art_check ohne lese, laubschneiden neu nach laubarbeit';


-- ─── 3. Spaltenkommentare ───────────────────────────────────────────────────
COMMENT ON COLUMN public.behandlungen.art IS
  'Art der Maßnahme: spritzung, duengung, bodenbearbeitung, schnitt, laubarbeit, laubschneiden, lese, sonstiges (Default spritzung). laubschneiden = maschinelles Laubschneiden an Seiten und Gipfel (KAN-143); Gipfeln von Hand bleibt laubarbeit mit laubarbeit_art.';

COMMENT ON COLUMN public.behandlungen.laubarbeit_art IS
  'Bei art = laubarbeit (Handarbeit): Unterart, z. B. Entblättern, Ausgeizen, Gipfeln, Heften. Maschinelles Laubschneiden ist die eigene Art laubschneiden (KAN-143).';

COMMENT ON COLUMN public.saetze_massnahmen.art IS
  'Maßnahmen-Art des Satzes wie behandlungen.art, ohne lese – Kosten-Vorschlag beim Erfassen einer Maßnahme; laubschneiden seit KAN-143.';
