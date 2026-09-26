-- ─────────────────────────────────────────────────────────────────────────────
-- kan128_mostgewicht_oechsle (KAN-128 Teil A, 26.09.2026)
--
-- Zweck: Mostgewicht in °KMW ODER °Oe erfassen. Öchsle wird ein echter Messwert mit
-- Einheit; ein Trigger rechnet die jeweils andere Spalte, °KMW bleibt gesetzlich führend
-- (Stufenprüfung, Mittel- und Mindestwerte lesen nur die °KMW-Spalte).
-- Betroffen: ernte_parzellen (klosterneuburger), pressungen (kmw_grad), pressung_weingaerten (kmw),
-- traubenverkauf (kmw_grad), weinausbau (kmw), zukauf_posten (kmw) – je °KMW, oechsle, mostgewicht_einheit.
--
-- Entscheidungen (Jörgen, 26.09.2026; Spezifikation KAN-128 Teil A):
--   1  Öchsle ist echte Eingabe: Messwert mit Einheit speichern (mostgewicht_einheit 'kmw'/'oechsle').
--   3  Bevorzugte Einheit je Betrieb: tenant_einstellungen.mostgewicht_einheit, Standard 'kmw' –
--      alle vier Betriebe bleiben 'kmw' (Gebeshuber misst in °KMW). Einstellen nur mit canAdmin;
--      die App schreibt das Feld über die Service-Role, a_schutz_plattformfelder bekommt KEIN
--      neues Argument (authenticated/anon ändern es nicht direkt).
--   6  °Oe → °KMW nach Variante B (Gleichsetzung wie BKI-Tabelle Anlage Ia): größter °KMW auf dem
--      0,01-Raster, dessen °Oe (kaufmännisch auf 0,1) den Messwert nicht übersteigt;
--      83,5 / 94,2 / 105,0 °Oe = 17,00 / 19,00 / 21,00 °KMW. Variante A nur im Rechenkern (Vergleich).
--   9  °Oe mit 1 Nachkommastelle speichern: numeric(5,1) wie ernte_parzellen.oechsle.
--   Rechenregel 8: pressungen.kmw_grad, traubenverkauf.kmw_grad, zukauf_posten.kmw → numeric(5,2),
--      sonst springt ein umgerechneter Wert über eine Schwelle (94 °Oe = 18,97 °KMW, gespeichert 19,0).
--   Offene Frage 3 (entschieden): °KMW, °Oe und Einheit stehen im Änderungsprotokoll
--      (z_protokoll_aendern) der sechs Tabellen – in dieser Migration.
--   Nur App (KAN-128 S1–S8, nicht hier): BKI-EDV-Liste mit beiden Spalten (Entscheidung 5),
--      Grenzfall-Band ±0,2 °KMW, TB-Formblatt nur °KMW (7), °KMW-Anzeige abgerundet (8).
--
-- Rechenregeln im Trigger b_mostgewicht (Regel 4 der Spezifikation):
--   INSERT nur °Oe → 'oechsle', sonst die mitgegebene Einheit (Standard 'kmw');
--   UPDATE mit ausdrücklich geänderter Einheit → diese Einheit (Ergänzung zu Regel 4, Review
--   26.09.2026 II): der neue Code (mostgewichtSpalten) schreibt immer alle drei Spalten. Wird eine
--   °KMW-Zeile neu in °Oe erfasst und entspricht das °Oe dem gespeicherten Wert, ändert sich außer der
--   Einheit nur °KMW (Variante B) – z. B. 15,00 → 15,01 bei 73,1 °Oe, 16,99 → 17,00 bei 83,5 °Oe
--   (Kabinett); ohne diese Regel bliebe die Zeile 'kmw' mit einem nie gemessenen °KMW (93 von 201
--   einstelligen °KMW-Werten 10,0–30,0 betroffen, per SELECT). Die alte App schickt nie eine Einheit.
--   Sonst: UPDATE nur °KMW (auch auf NULL) → 'kmw'; nur °Oe → 'oechsle'; beide oder keine → mitgegeben.
--   Leeres °Oe löscht nie °KMW (Einheit wird dann 'kmw'). Gegenstück (Ergänzung zu Regel 4, Review
--   26.09.2026): gelöschtes °KMW löscht nie ein neu gemessenes °Oe – UPDATE °KMW → NULL mit neuem °Oe
--   wird 'oechsle', auch wenn die Einheit fehlt oder als 'kmw' mitkommt (wie INSERT nur °Oe).
--   Löschen = beide Spalten auf NULL.
--   'kmw': °Oe = round(°KMW × (0,022 × °KMW + 4,54), 1); 'oechsle': °KMW = s112_kmw_aus_oechsle(°Oe).
--   Werte der App für die gerechnete Spalte zählen nie (auch nicht für die Wahl der Einheit).
--   Ohne Messwert gilt 'kmw'.
--   Messwert außerhalb des CHECK-Bereichs: die andere Spalte bleibt leer, der CHECK der gemessenen
--   Spalte lehnt mit 23514 ab (kein Überlauf 22003 aus der Umrechnung).
--
-- Datenstand 26.09.2026 (live per SELECT geprüft):
--   Zeilen mit °KMW: ernte_parzellen 15 (nur Musterhof; °Oe dort round(°KMW × 4,8), 1,2–3,1 °Oe unter
--   der Formel), pressungen 17 und pressung_weingaerten 20 (Musterhof), traubenverkauf 0 (Tabelle leer),
--   weinausbau 119 von 146 (Gebeshuber 74, Spaetrot 17, Musterhof 26, Sandbox 2), zukauf_posten 2 (Sandbox).
--   °KMW 15,0–21,4, keiner mit 2 Stellen, keine Zeile nur mit °Oe. Auf den Mostgewichtsspalten hängen
--   keine Views, Policies, Indizes, Constraints oder Trigger (pg_depend leer) – Typänderung ohne
--   Abhängigkeiten. Keine Spalten-ACLs. tenant_einstellungen: 4 Zeilen (alle Betriebe).
--   Nachgerechnet (SELECT, 0,0–360,0 °Oe in 0,1-Schritten, 3.601 Werte): s112_kmw_aus_oechsle entspricht
--   der Definition B (Brute Force über das 0,01-Raster 0–62 °KMW) ohne Abweichung, hin und zurück
--   verlustfrei; ab 50 °Oe höchstens ein Schritt über dem A-Startwert, darunter (1,5–42,0 °Oe) bei
--   20 Werten zwei – daher Schleife statt der Ein-Schritt-Formel der Skizze. 10,00–40,00 °KMW:
--   °Oe zurück gerechnet ergibt °KMW oder °KMW + 0,01 (nie weniger).
--
-- Nebenwirkungen:
--   * Nachtrag (Abschnitt 7) = 173 UPDATEs durch den Trigger (15 + 17 + 20 + 0 + 119 + 2), ohne
--     Trigger-Abschalten und ohne session_replication_role (KAN-124): °KMW unverändert, °Oe = Formel,
--     Einheit 'kmw'. Musterhof: die 15 Lese-°Oe steigen um 1,2–3,1 °Oe.
--   * weinausbau.updated_at springt für diese 119 Zeilen auf den Migrationszeitpunkt (Trigger
--     weinausbau_updated_at, BEFORE UPDATE ohne Spaltenliste – nur mit Trigger-Abschalten vermeidbar).
--     Gelesen nur in lade_behaelter (ORDER BY updated_at für den Namen des Fremdbetriebs im gemeinsamen
--     Gebinde; je Gebinde ist nur ein Fremdbetrieb möglich, also ohne Wirkung), im Code nicht.
--     traubenverkauf.updated_at hat keinen Trigger (Tabelle leer).
--   * Bestandsprotokoll: 0 Zeilen durch den Nachtrag. Er läuft VOR der Erweiterung von
--     z_protokoll_aendern: der alte Trigger überwacht keine Mostgewichtsspalte, AFTER UPDATE OF feuert
--     nur für Spalten im SET (hier nur mostgewicht_einheit). Gewollt: abgeleitete Werte, keine
--     fachliche Änderung, °KMW bleibt gleich (sonst 173 Protokollzeilen, 91 davon echte Betriebe).
--   * Demo-Reset (demo_musterhof_zuruecksetzen, demo_musterhof_y2_kette) schreibt weiter
--     round(°KMW × 4,8) in ernte_parzellen.oechsle – der Trigger ersetzt das beim INSERT durch die
--     Formel (Einheit 'kmw', da °KMW mitgegeben). ama_meldepositionen.oechsle bleibt (KAN-131).
--     OFFEN (Folge-Migration zu S3 bzw. nächste Überarbeitung von demo_musterhof_zuruecksetzen, hier
--     bewusst nicht – die Funktion hat 106.000 Zeichen): Der Reset setzt tenant_einstellungen.
--     mostgewicht_einheit nicht zurück (sein UPDATE tenant_einstellungen setzt nur Zähler und
--     ea_betriebsbeginn). Stellt ein Demo-Konto (tenant_admin = canAdmin) auf 'oechsle' um, bleibt das
--     nach dem Reset – im ersten UPDATE tenant_einstellungen „mostgewicht_einheit = 'kmw'“ ergänzen.
--   * Sperren: ACCESS EXCLUSIVE auf ernte_parzellen, pressungen, pressung_weingaerten, traubenverkauf,
--     weinausbau, zukauf_posten, verschneidungen, keller_umzuege, tenant_einstellungen bis zum Ende der
--     Transaktion; die Typänderung schreibt pressungen, traubenverkauf, zukauf_posten neu (≤ 17 Zeilen).
--     lock_timeout wie KAN-73: hält eine lange Transaktion eine Sperre, bricht die Migration nach 5 s ab.
--
-- Reihenfolge und Übergang:
--   * ERST diese Migration, DANN der Code (KAN-128 S1–S8). Der neue Code schreibt oechsle und
--     mostgewicht_einheit – vor der Migration scheiterte das (PGRST204, Spalte unbekannt).
--   * Die heutige App (origin/main efc7813) läuft mit der Migration weiter: keine Spalte entfällt, neue
--     NOT-NULL-Spalten haben einen Default, alle Schreibstellen schicken nur °KMW (die Lese zusätzlich
--     ein leeres oechsle):
--       - Lese neu (createMultipleErnteParzellen, upsertErnteParzelle), Pressung, Traubenverkauf,
--         Zukauf, Charge, Demo: °KMW mit oechsle NULL → 'kmw', °Oe gerechnet.
--       - Lese bearbeiten (upsertErnteParzelle, oechsle leer): °KMW bleibt, °Oe aus °KMW – bisher
--         wurde °Oe dort gelöscht. Eine künftige 'oechsle'-Zeile kippte so nur in der Einheit auf
--         'kmw' (unter B ohne Wertdrift; solche Zeilen gibt es noch nicht) – deshalb das neue
--         Lese-Formular direkt nach der Migration ausrollen.
--       - Neu abgelehnt (23514): °KMW außerhalb 0–60, gemessenes °Oe außerhalb 0–350. Die heutige App
--         zeigt dann den allgemeinen Prüfregel-Text; deutsche Meldungen je Constraint-Name kommen mit
--         dem Code (src/lib/fehler.ts, PRUEFREGEL_MELDUNG).
--   * Bereichsgrenzen (Review 26.09.2026 III, vorher °Oe 0–360): 60 °KMW = 351,6 °Oe, 350 °Oe = 59,78 °KMW.
--     Gemessenes °Oe bis 350 → gerechnetes °KMW ≤ 59,78: eine °Oe-Messung scheitert nie am °KMW-CHECK
--     (vorher lehnte bei 351,7–360 °Oe der °KMW-CHECK ab). Umgekehrt ergeben gemessene 59,79–60 °KMW
--     gerechnet 350,1–351,6 °Oe – der °Oe-CHECK lässt daher bei Einheit 'kmw' bis 351,6 (= f(60 °KMW))
--     zu, sonst scheiterte eine °KMW-Messung am °Oe-CHECK. Der Trigger rechnet nur innerhalb dieser
--     Bereiche (°KMW 0–60, °Oe 0–350), ein gemessener Wert außerhalb scheitert am CHECK seiner Spalte.
--   * MERGE-VORAUSSETZUNG Weinbuch (Review 26.09.2026 II): ernte_parzellen.oechsle war bei echten
--     Betrieben bisher leer (live 26.09.2026: alle 15 Lesezeilen Musterhof). Ab der Migration steht bei
--     jeder Lese mit °KMW das gerechnete, nicht rechtsverbindliche °Oe dort – beim INSERT und bei jedem
--     Lese-Bearbeiten (die alte App schickt oechsle leer, der Trigger setzt f(°KMW) ein). Weinbuch und
--     Weinbuch-Sammlung (Pflichtmeldungen weinbuch/weinbuch-sammlung) gaben es in origin/main roh aus
--     (`if (ep.oechsle) details.push(`${ep.oechsle} °Oe`)` → „86.7 °Oe“: Punkt, ohne „≈“ – gegen
--     Rechenregel 9). ERLEDIGT im Teil-A-PR (Commit 547e6d2): weinbuch.ts liest mostgewicht_einheit
--     (Lese und Pressungs-Fallback) und schreibt mostgewichtWeinbuchText() – °KMW immer (Komma),
--     °Oe nur als Messwert, bei Messung in °Oe „≈ 17,09 °KMW · 84,0 °Oe“; das gerechnete °Oe
--     einer °KMW-Messung erscheint nicht (Test scripts/tests/kellerbuch.test.mjs). Offen nur noch:
--     scripts/schema.json nach dem Einspielen aus der Live-DB neu erzeugen (die Spalten sind dort
--     schon von Hand ergänzt).
--     Ablauf: apply_migration erst, wenn der Teil-A-PR merge-bereit ist, Deploy unmittelbar danach.
--     Gebeshubers Lese 2026 (noch nicht erfasst) bis zum Deploy nicht erfassen – sonst zeigt das
--     Weinbuch dazwischen den Rechenwert (Daten korrekt, nur die Anzeige).
--   * Spätere Migrationen, die z_protokoll_aendern dieser Tabellen neu anlegen (KAN-126 pw.ernte_datum,
--     KAN-129 lese_id), müssen die hier ergänzten Spalten übernehmen. Abschnitt 8 liest die bestehende
--     Spaltenliste aus pg_trigger und hängt nur an – die Reihenfolge der Migrationen ist daher egal.
--
-- Neue CHECK-Constraints (Namen für PRUEFREGEL_MELDUNG):
--   <tabelle>_<kmw-spalte>_bereich_check (0–60), <tabelle>_oechsle_bereich_check (gemessen 0–350,
--   aus °KMW gerechnet bis 351,6), <tabelle>_mostgewicht_einheit_check – für ernte_parzellen (klosterneuburger), pressungen (kmw_grad),
--   pressung_weingaerten (kmw), traubenverkauf (kmw_grad), weinausbau (kmw), zukauf_posten (kmw);
--   tenant_einstellungen_mostgewicht_einheit_check, verschneidungen_ziel_mostgewicht_einheit_vorher_check,
--   keller_umzuege_mostgewicht_einheit_vorher_check, keller_umzuege_mostgewicht_einheit_nachher_check.
--
-- Wiederholbar (CREATE OR REPLACE, IF [NOT] EXISTS, Typänderung nur wenn nötig, Nachtrag nur für
-- Zeilen mit °Oe ≠ Formel und Einheit 'kmw' – ein zweiter Lauf ändert auch nach Nutzung der App keine
-- Zeile –, Abschnitt 8 hängt nur fehlende Spalten an). Achtung für spätere Migrationen: Solange
-- b_mostgewicht bzw. z_protokoll_aendern eine Mostgewichtsspalte in UPDATE OF führen, lehnt PostgreSQL
-- ALTER COLUMN … TYPE dieser Spalte ab (0A000) – Trigger vorher entfernen und danach neu anlegen.
-- Probelauf lokal (PGlite, PostgreSQL 17.5, Nachbau der neun Tabellen samt Triggern und Funktionen aus
-- der Live-DB): Rollback-Test OK (mit und ohne Demo-Reset-Nachbau), Migration zweimal hintereinander
-- und ein drittes Mal nach einer °Oe-Messung (Einheit bleibt 'oechsle', 0 Protokollzeilen), Rückbau
-- samt Sperre; elf absichtlich eingebaute Fehler erkennt der Rollback-Test (_pglite/mutation.mjs).
-- Danach: Security Advisor (Lint 0028/0029, search_path), plpgsql_check (Trigger-Funktion mit Relation:
-- plpgsql_check_function('public.s112_mostgewicht_abgleichen()', 'public.weinausbau')),
-- `npx supabase migration list`, scripts/schema.json, Smoke-Test.
-- Rückbau (nur im Notfall): rueckbau.sql. Rollback-Test: rollback_test.sql.
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';


-- ─── 1. Umrechnung ──────────────────────────────────────────────────────────
-- Beide Funktionen rechnen nur (keine Tabellen), SECURITY INVOKER. Der Abgleich-Trigger läuft als
-- INVOKER und ruft sie im Namen des schreibenden Benutzers auf – authenticated und service_role
-- brauchen daher EXECUTE (SECURITY DEFINER brächte keinen Vorteil, nur mehr Rechte). anon und PUBLIC
-- nicht (Konvention seit Migration 182).

CREATE OR REPLACE FUNCTION public.s112_oechsle_aus_kmw(p_kmw numeric)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
  SET search_path = public
AS $fn$
  -- °Oe = °KMW × (4,54 + 0,022 × °KMW), kaufmännisch auf 0,1 (numeric rundet ab ,5 weg von 0)
  SELECT CASE WHEN p_kmw >= 0 AND p_kmw < 1000
              THEN round(p_kmw * (0.022 * p_kmw + 4.54), 1)
         END
$fn$;

COMMENT ON FUNCTION public.s112_oechsle_aus_kmw(numeric) IS
  'KAN-128: °KMW → °Oe = round(°KMW × (0,022 × °KMW + 4,54), 1) (Formel der BKI-Anreicherungstabelle, nicht rechtsverbindlich). NULL bei NULL, negativen Werten, NaN und ab 1000 (Spaltentyp numeric(5,2)).';

CREATE OR REPLACE FUNCTION public.s112_kmw_aus_oechsle(p_oechsle numeric)
  RETURNS numeric
  LANGUAGE plpgsql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
  SET search_path = public
AS $fn$
DECLARE
  v_kmw numeric;
BEGIN
  -- negative Werte, NaN und Unendlich haben keinen °KMW (NaN/Infinity würden die Schleifen nie beenden)
  IF NOT (p_oechsle >= 0 AND p_oechsle < 10000) THEN
    RETURN NULL;
  END IF;

  -- Startwert = Variante A: exakte Umkehrformel, auf 0,01 abgerundet (4,54² = 20,6116;
  -- +1e-9 gegen Rundungsrauschen von sqrt, z. B. 156,0 °Oe = genau 30,00 °KMW)
  v_kmw := floor(((sqrt(20.6116 + 0.088 * p_oechsle) - 4.54) / 0.044) * 100 + 0.000000001) / 100;

  -- Variante B (Entscheidung 6): größter Rasterwert, dessen °Oe (kaufmännisch 0,1) den Messwert nicht
  -- übersteigt. f ist für °KMW ≥ 0 streng steigend, also endet die Schleife beim gesuchten Wert.
  -- Nachgerechnet 0,0–360,0 °Oe: ab 50 °Oe höchstens ein Schritt, darunter bis zu zwei; nie abwärts.
  WHILE public.s112_oechsle_aus_kmw(v_kmw + 0.01) <= p_oechsle LOOP
    v_kmw := v_kmw + 0.01;
  END LOOP;
  WHILE v_kmw > 0 AND public.s112_oechsle_aus_kmw(v_kmw) > p_oechsle LOOP
    v_kmw := v_kmw - 0.01;   -- Absicherung, falls der Startwert je zu hoch läge
  END LOOP;

  RETURN round(v_kmw, 2);
END
$fn$;

COMMENT ON FUNCTION public.s112_kmw_aus_oechsle(numeric) IS
  'KAN-128, Variante B (Entscheidung 6): größter °KMW auf dem 0,01-Raster mit s112_oechsle_aus_kmw(°KMW) <= °Oe – wie BKI-Tabelle Anlage Ia (83,5/94,2/105,0 °Oe = 17,00/19,00/21,00 °KMW), auf dem 0,1-°Oe-Raster verlustfrei hin und zurück. 0 °Oe ergibt 0,01 (Definition). NULL bei NULL, negativen Werten, NaN und ab 10000. Gleichlauf mit src/lib/wein/mostgewicht.ts per Golden-Tabelle.';

REVOKE EXECUTE ON FUNCTION public.s112_oechsle_aus_kmw(numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.s112_kmw_aus_oechsle(numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.s112_oechsle_aus_kmw(numeric) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.s112_kmw_aus_oechsle(numeric) TO authenticated, service_role;


-- ─── 2. Abgleich-Trigger-Funktion ───────────────────────────────────────────
-- Eine Funktion für alle sechs Tabellen; TG_ARGV: °KMW-Spalte, °Oe-Spalte, Einheit-Spalte.
-- Spalten dynamisch über jsonb (to_jsonb/jsonb_populate_record übernimmt den Spaltentyp samt typmod).
-- SECURITY INVOKER: liest und schreibt nur NEW. Trigger-Funktion → kein EXECUTE für Benutzerrollen
-- (beim Feuern wird EXECUTE nicht geprüft).

CREATE OR REPLACE FUNCTION public.s112_mostgewicht_abgleichen()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $fn$
DECLARE
  v_sp_kmw   text  := TG_ARGV[0];
  v_sp_oe    text  := TG_ARGV[1];
  v_sp_einh  text  := TG_ARGV[2];
  v_neu      jsonb := to_jsonb(NEW);
  v_alt      jsonb;
  v_kmw      numeric;
  v_oe       numeric;
  v_einheit  text;
  v_kmw_neu  boolean := false;
  v_oe_neu   boolean := false;
  v_einh_neu boolean := false;
BEGIN
  IF TG_NARGS <> 3 OR NOT (v_neu ? v_sp_kmw AND v_neu ? v_sp_oe AND v_neu ? v_sp_einh) THEN
    RAISE EXCEPTION 's112_mostgewicht_abgleichen auf „%“: drei Spaltennamen erwartet (°KMW, °Oe, Einheit)', TG_TABLE_NAME
      USING ERRCODE = '39P01';
  END IF;

  v_kmw     := (v_neu ->> v_sp_kmw)::numeric;
  v_oe      := (v_neu ->> v_sp_oe)::numeric;
  v_einheit := coalesce(v_neu ->> v_sp_einh, 'kmw');
  IF TG_OP = 'UPDATE' THEN
    v_alt      := to_jsonb(OLD);
    v_kmw_neu  := (v_neu -> v_sp_kmw)  IS DISTINCT FROM (v_alt -> v_sp_kmw);
    v_oe_neu   := (v_neu -> v_sp_oe)   IS DISTINCT FROM (v_alt -> v_sp_oe);
    v_einh_neu := (v_neu -> v_sp_einh) IS DISTINCT FROM (v_alt -> v_sp_einh);
  END IF;

  -- 1. gemessene Einheit
  IF TG_OP = 'INSERT' AND v_kmw IS NULL AND v_oe IS NOT NULL THEN
    v_einheit := 'oechsle';
  ELSIF v_einh_neu THEN
    NULL;                                   -- ausdrücklich gewechselte Einheit gilt (neuer Code: alle drei
                                            -- Spalten; °KMW nach B kann sich bei gleichem °Oe ändern)
  ELSIF v_kmw_neu AND NOT v_oe_neu THEN
    v_einheit := 'kmw';
  ELSIF v_oe_neu AND NOT v_kmw_neu THEN
    v_einheit := 'oechsle';
  END IF;                                   -- sonst: mitgegeben (INSERT: Standard 'kmw')
  IF v_einheit = 'oechsle' AND v_oe IS NULL AND v_kmw IS NOT NULL THEN
    v_einheit := 'kmw';                     -- leeres °Oe löscht nie °KMW
  END IF;
  IF v_einheit = 'kmw' AND v_kmw IS NULL AND v_oe IS NOT NULL AND v_oe_neu THEN
    v_einheit := 'oechsle';                 -- gelöschtes °KMW löscht nie ein neu gemessenes °Oe
  END IF;                                   -- (UPDATE °KMW → NULL, °Oe neu, Einheit nicht/als kmw mitgegeben;
                                            --  INSERT nur °Oe fängt schon der erste Zweig ab)

  -- 2. andere Spalte rechnen (Bereich wie die CHECKs; außerhalb bleibt sie leer → CHECK lehnt ab;
  --    350 °Oe = 59,78 °KMW, 60 °KMW = 351,6 °Oe – die gerechnete Spalte bleibt immer im Bereich)
  IF v_einheit = 'oechsle' THEN
    v_oe  := round(v_oe, 1);
    v_kmw := CASE WHEN v_oe BETWEEN 0 AND 350 THEN public.s112_kmw_aus_oechsle(v_oe) END;
  ELSIF v_einheit = 'kmw' THEN
    v_oe  := CASE WHEN v_kmw BETWEEN 0 AND 60 THEN public.s112_oechsle_aus_kmw(v_kmw) END;
  END IF;                                   -- unbekannte Einheit: <tabelle>_mostgewicht_einheit_check lehnt ab

  -- 3. ohne Messwert gilt der Standard
  IF v_kmw IS NULL AND v_oe IS NULL AND v_einheit = 'oechsle' THEN
    v_einheit := 'kmw';
  END IF;

  NEW := jsonb_populate_record(NEW, jsonb_build_object(v_sp_kmw, v_kmw, v_sp_oe, v_oe, v_sp_einh, v_einheit));
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.s112_mostgewicht_abgleichen() IS
  'KAN-128: BEFORE-INSERT/UPDATE-Trigger b_mostgewicht (Argumente: °KMW-Spalte, °Oe-Spalte, Einheit-Spalte). Einheit = gemessene Einheit (INSERT nur °Oe → oechsle; UPDATE mit geänderter Einheit → diese; sonst UPDATE nur °KMW → kmw, nur °Oe → oechsle, sonst mitgegeben); rechnet die andere Spalte (°Oe: s112_oechsle_aus_kmw, °KMW: s112_kmw_aus_oechsle, Variante B). Leeres °Oe löscht nie °KMW; gelöschtes °KMW löscht nie ein neu gemessenes °Oe (UPDATE °KMW → NULL mit neuem °Oe → oechsle); Löschen = beide NULL; ohne Messwert kmw.';

REVOKE EXECUTE ON FUNCTION public.s112_mostgewicht_abgleichen() FROM PUBLIC, anon, authenticated;


-- ─── 3. Typen, Spalten, CHECKs der sechs Tabellen ───────────────────────────
-- Typ-Erweiterung (Rechenregel 8): bisher 1 Stelle, Bestand ohne 2-stellige Werte → verlustfrei.
-- Nur wenn nötig: steht die Spalte schon in einem UPDATE OF (b_mostgewicht, z_protokoll_aendern nach
-- Abschnitt 8), lehnt PostgreSQL jede Typänderung ab (0A000) – so bleibt die Migration wiederholbar.
-- Spätere Typänderungen an den sechs °KMW-/°Oe-Spalten müssen diese Trigger vorher entfernen.
-- Bereiche (siehe Kopf „Bereichsgrenzen“): °KMW 0–60; °Oe gemessen 0–350, aus °KMW gerechnet bis
-- 351,6 (= f(60 °KMW)) – die CHECKs laufen in Namensreihenfolge, bei unbekannter Einheit greift
-- <tabelle>_mostgewicht_einheit_check vor <tabelle>_oechsle_bereich_check.
DO $typen$
DECLARE
  r_sp record;
BEGIN
  FOR r_sp IN
    SELECT * FROM (VALUES ('pressungen'::text, 'kmw_grad'::text), ('traubenverkauf', 'kmw_grad'), ('zukauf_posten', 'kmw'))
      AS t(tabelle, spalte)
  LOOP
    IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
         WHERE a.attrelid = format('public.%I', r_sp.tabelle)::regclass AND a.attname = r_sp.spalte) <> 'numeric(5,2)' THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(5,2)', r_sp.tabelle, r_sp.spalte);
    END IF;
  END LOOP;
END $typen$;

-- 3a ernte_parzellen (oechsle numeric(5,1) besteht seit Migration 006)
ALTER TABLE public.ernte_parzellen
  ADD COLUMN IF NOT EXISTS mostgewicht_einheit text NOT NULL DEFAULT 'kmw';
ALTER TABLE public.ernte_parzellen DROP CONSTRAINT IF EXISTS ernte_parzellen_klosterneuburger_bereich_check;
ALTER TABLE public.ernte_parzellen ADD  CONSTRAINT ernte_parzellen_klosterneuburger_bereich_check
  CHECK (klosterneuburger IS NULL OR klosterneuburger BETWEEN 0 AND 60);
ALTER TABLE public.ernte_parzellen DROP CONSTRAINT IF EXISTS ernte_parzellen_oechsle_bereich_check;
ALTER TABLE public.ernte_parzellen ADD  CONSTRAINT ernte_parzellen_oechsle_bereich_check
  CHECK (oechsle IS NULL OR oechsle BETWEEN 0 AND CASE WHEN mostgewicht_einheit = 'oechsle' THEN 350 ELSE 351.6 END);
ALTER TABLE public.ernte_parzellen DROP CONSTRAINT IF EXISTS ernte_parzellen_mostgewicht_einheit_check;
ALTER TABLE public.ernte_parzellen ADD  CONSTRAINT ernte_parzellen_mostgewicht_einheit_check
  CHECK (mostgewicht_einheit IN ('kmw', 'oechsle'));

-- 3b pressungen
ALTER TABLE public.pressungen
  ADD COLUMN IF NOT EXISTS oechsle numeric(5,1),
  ADD COLUMN IF NOT EXISTS mostgewicht_einheit text NOT NULL DEFAULT 'kmw';
ALTER TABLE public.pressungen DROP CONSTRAINT IF EXISTS pressungen_kmw_grad_bereich_check;
ALTER TABLE public.pressungen ADD  CONSTRAINT pressungen_kmw_grad_bereich_check
  CHECK (kmw_grad IS NULL OR kmw_grad BETWEEN 0 AND 60);
ALTER TABLE public.pressungen DROP CONSTRAINT IF EXISTS pressungen_oechsle_bereich_check;
ALTER TABLE public.pressungen ADD  CONSTRAINT pressungen_oechsle_bereich_check
  CHECK (oechsle IS NULL OR oechsle BETWEEN 0 AND CASE WHEN mostgewicht_einheit = 'oechsle' THEN 350 ELSE 351.6 END);
ALTER TABLE public.pressungen DROP CONSTRAINT IF EXISTS pressungen_mostgewicht_einheit_check;
ALTER TABLE public.pressungen ADD  CONSTRAINT pressungen_mostgewicht_einheit_check
  CHECK (mostgewicht_einheit IN ('kmw', 'oechsle'));

-- 3c pressung_weingaerten
ALTER TABLE public.pressung_weingaerten
  ADD COLUMN IF NOT EXISTS oechsle numeric(5,1),
  ADD COLUMN IF NOT EXISTS mostgewicht_einheit text NOT NULL DEFAULT 'kmw';
ALTER TABLE public.pressung_weingaerten DROP CONSTRAINT IF EXISTS pressung_weingaerten_kmw_bereich_check;
ALTER TABLE public.pressung_weingaerten ADD  CONSTRAINT pressung_weingaerten_kmw_bereich_check
  CHECK (kmw IS NULL OR kmw BETWEEN 0 AND 60);
ALTER TABLE public.pressung_weingaerten DROP CONSTRAINT IF EXISTS pressung_weingaerten_oechsle_bereich_check;
ALTER TABLE public.pressung_weingaerten ADD  CONSTRAINT pressung_weingaerten_oechsle_bereich_check
  CHECK (oechsle IS NULL OR oechsle BETWEEN 0 AND CASE WHEN mostgewicht_einheit = 'oechsle' THEN 350 ELSE 351.6 END);
ALTER TABLE public.pressung_weingaerten DROP CONSTRAINT IF EXISTS pressung_weingaerten_mostgewicht_einheit_check;
ALTER TABLE public.pressung_weingaerten ADD  CONSTRAINT pressung_weingaerten_mostgewicht_einheit_check
  CHECK (mostgewicht_einheit IN ('kmw', 'oechsle'));

-- 3d traubenverkauf
ALTER TABLE public.traubenverkauf
  ADD COLUMN IF NOT EXISTS oechsle numeric(5,1),
  ADD COLUMN IF NOT EXISTS mostgewicht_einheit text NOT NULL DEFAULT 'kmw';
ALTER TABLE public.traubenverkauf DROP CONSTRAINT IF EXISTS traubenverkauf_kmw_grad_bereich_check;
ALTER TABLE public.traubenverkauf ADD  CONSTRAINT traubenverkauf_kmw_grad_bereich_check
  CHECK (kmw_grad IS NULL OR kmw_grad BETWEEN 0 AND 60);
ALTER TABLE public.traubenverkauf DROP CONSTRAINT IF EXISTS traubenverkauf_oechsle_bereich_check;
ALTER TABLE public.traubenverkauf ADD  CONSTRAINT traubenverkauf_oechsle_bereich_check
  CHECK (oechsle IS NULL OR oechsle BETWEEN 0 AND CASE WHEN mostgewicht_einheit = 'oechsle' THEN 350 ELSE 351.6 END);
ALTER TABLE public.traubenverkauf DROP CONSTRAINT IF EXISTS traubenverkauf_mostgewicht_einheit_check;
ALTER TABLE public.traubenverkauf ADD  CONSTRAINT traubenverkauf_mostgewicht_einheit_check
  CHECK (mostgewicht_einheit IN ('kmw', 'oechsle'));

-- 3e weinausbau
ALTER TABLE public.weinausbau
  ADD COLUMN IF NOT EXISTS oechsle numeric(5,1),
  ADD COLUMN IF NOT EXISTS mostgewicht_einheit text NOT NULL DEFAULT 'kmw';
ALTER TABLE public.weinausbau DROP CONSTRAINT IF EXISTS weinausbau_kmw_bereich_check;
ALTER TABLE public.weinausbau ADD  CONSTRAINT weinausbau_kmw_bereich_check
  CHECK (kmw IS NULL OR kmw BETWEEN 0 AND 60);
ALTER TABLE public.weinausbau DROP CONSTRAINT IF EXISTS weinausbau_oechsle_bereich_check;
ALTER TABLE public.weinausbau ADD  CONSTRAINT weinausbau_oechsle_bereich_check
  CHECK (oechsle IS NULL OR oechsle BETWEEN 0 AND CASE WHEN mostgewicht_einheit = 'oechsle' THEN 350 ELSE 351.6 END);
ALTER TABLE public.weinausbau DROP CONSTRAINT IF EXISTS weinausbau_mostgewicht_einheit_check;
ALTER TABLE public.weinausbau ADD  CONSTRAINT weinausbau_mostgewicht_einheit_check
  CHECK (mostgewicht_einheit IN ('kmw', 'oechsle'));

-- 3f zukauf_posten
ALTER TABLE public.zukauf_posten
  ADD COLUMN IF NOT EXISTS oechsle numeric(5,1),
  ADD COLUMN IF NOT EXISTS mostgewicht_einheit text NOT NULL DEFAULT 'kmw';
ALTER TABLE public.zukauf_posten DROP CONSTRAINT IF EXISTS zukauf_posten_kmw_bereich_check;
ALTER TABLE public.zukauf_posten ADD  CONSTRAINT zukauf_posten_kmw_bereich_check
  CHECK (kmw IS NULL OR kmw BETWEEN 0 AND 60);
ALTER TABLE public.zukauf_posten DROP CONSTRAINT IF EXISTS zukauf_posten_oechsle_bereich_check;
ALTER TABLE public.zukauf_posten ADD  CONSTRAINT zukauf_posten_oechsle_bereich_check
  CHECK (oechsle IS NULL OR oechsle BETWEEN 0 AND CASE WHEN mostgewicht_einheit = 'oechsle' THEN 350 ELSE 351.6 END);
ALTER TABLE public.zukauf_posten DROP CONSTRAINT IF EXISTS zukauf_posten_mostgewicht_einheit_check;
ALTER TABLE public.zukauf_posten ADD  CONSTRAINT zukauf_posten_mostgewicht_einheit_check
  CHECK (mostgewicht_einheit IN ('kmw', 'oechsle'));

-- 3g Spaltenkommentare
COMMENT ON COLUMN public.ernte_parzellen.klosterneuburger IS
  'Mostgewicht in °KMW (Klosterneuburger Mostwaage), bis 2 Stellen, 0–60; gesetzlich führend (Stufe, Mittel- und Mindestwerte). Gemessen oder aus oechsle gerechnet (Variante B) – Trigger b_mostgewicht, KAN-128.';
COMMENT ON COLUMN public.ernte_parzellen.oechsle IS
  'Mostgewicht in °Oechsle (nicht °KMW), 1 Stelle, gemessen 0–350 (aus °KMW gerechnet bis 351,6). Gemessen (mostgewicht_einheit = oechsle) oder aus °KMW gerechnet: round(°KMW × (0,022 × °KMW + 4,54), 1) – Trigger b_mostgewicht, KAN-128.';
COMMENT ON COLUMN public.ernte_parzellen.mostgewicht_einheit IS
  'Gemessene Einheit des Mostgewichts: kmw oder oechsle; die andere Spalte rechnet der Trigger b_mostgewicht (KAN-128). Ohne Messwert kmw.';

COMMENT ON COLUMN public.pressungen.kmw_grad IS
  'Mostgewicht der Pressung in °KMW (Klosterneuburger Mostwaage), bis 2 Stellen (KAN-128), 0–60 – Basis für die Qualitätsableitung nach österreichischem Weingesetz. Gemessen oder aus oechsle gerechnet (Trigger b_mostgewicht).';
COMMENT ON COLUMN public.pressungen.oechsle IS
  'Mostgewicht der Pressung in °Oechsle, 1 Stelle, gemessen 0–350 (aus °KMW gerechnet bis 351,6). Gemessen oder aus °KMW gerechnet (Trigger b_mostgewicht, KAN-128).';
COMMENT ON COLUMN public.pressungen.mostgewicht_einheit IS
  'Gemessene Einheit des Mostgewichts: kmw oder oechsle (Mittelwerte immer kmw); die andere Spalte rechnet der Trigger b_mostgewicht (KAN-128).';

COMMENT ON COLUMN public.pressung_weingaerten.kmw IS
  'Mostgewicht des Weingartenanteils in °KMW, bis 2 Stellen, 0–60; gemessen oder aus oechsle gerechnet (Trigger b_mostgewicht, KAN-128).';
COMMENT ON COLUMN public.pressung_weingaerten.oechsle IS
  'Mostgewicht des Weingartenanteils in °Oechsle, 1 Stelle, gemessen 0–350 (aus °KMW gerechnet bis 351,6); gemessen oder aus °KMW gerechnet (Trigger b_mostgewicht, KAN-128).';
COMMENT ON COLUMN public.pressung_weingaerten.mostgewicht_einheit IS
  'Gemessene Einheit des Mostgewichts: kmw oder oechsle; die andere Spalte rechnet der Trigger b_mostgewicht (KAN-128).';

COMMENT ON COLUMN public.traubenverkauf.kmw_grad IS
  'Mostgewicht der verkauften Trauben in °KMW, bis 2 Stellen (KAN-128), 0–60; BKI-EDV-Liste Spalte °KMW. Gemessen oder aus oechsle gerechnet (Trigger b_mostgewicht).';
COMMENT ON COLUMN public.traubenverkauf.oechsle IS
  'Mostgewicht der verkauften Trauben in °Oechsle, 1 Stelle, gemessen 0–350 (aus °KMW gerechnet bis 351,6); BKI-EDV-Liste Spalte °Oe. Gemessen oder aus °KMW gerechnet (Trigger b_mostgewicht, KAN-128).';
COMMENT ON COLUMN public.traubenverkauf.mostgewicht_einheit IS
  'Gemessene Einheit des Mostgewichts: kmw oder oechsle; die andere Spalte rechnet der Trigger b_mostgewicht (KAN-128).';

COMMENT ON COLUMN public.weinausbau.kmw IS
  'Mostgewicht der Charge in °KMW, bis 2 Stellen, 0–60; gesetzlich führend. Gemessen oder aus oechsle gerechnet (Trigger b_mostgewicht, KAN-128); Mittelwerte massegewichtet in °KMW (KAN-130).';
COMMENT ON COLUMN public.weinausbau.oechsle IS
  'Mostgewicht der Charge in °Oechsle, 1 Stelle, gemessen 0–350 (aus °KMW gerechnet bis 351,6); gemessen oder aus °KMW gerechnet (Trigger b_mostgewicht, KAN-128). Nie °Oe mitteln.';
COMMENT ON COLUMN public.weinausbau.mostgewicht_einheit IS
  'Gemessene Einheit des Mostgewichts: kmw oder oechsle (Mittelwerte immer kmw); die andere Spalte rechnet der Trigger b_mostgewicht (KAN-128).';

COMMENT ON COLUMN public.zukauf_posten.kmw IS
  '°KMW bei Trauben und Traubenmost, bis 2 Stellen (KAN-128), 0–60; gemessen (z. B. Lieferschein) oder aus oechsle gerechnet (Trigger b_mostgewicht).';
COMMENT ON COLUMN public.zukauf_posten.oechsle IS
  '°Oechsle bei Trauben und Traubenmost, 1 Stelle, gemessen 0–350 (aus °KMW gerechnet bis 351,6); gemessen oder aus °KMW gerechnet (Trigger b_mostgewicht, KAN-128).';
COMMENT ON COLUMN public.zukauf_posten.mostgewicht_einheit IS
  'Gemessene Einheit des Mostgewichts: kmw oder oechsle; die andere Spalte rechnet der Trigger b_mostgewicht (KAN-128).';


-- ─── 4. Momentaufnahmen für das Storno (Teil B, KAN-130) ────────────────────
-- verschneidungen: wie ziel_qualitaet_vorher / ziel_herkunft_code_vorher (Ziel-Charge vor dem Verschnitt).
ALTER TABLE public.verschneidungen
  ADD COLUMN IF NOT EXISTS ziel_kmw_vorher numeric(5,2),
  ADD COLUMN IF NOT EXISTS ziel_oechsle_vorher numeric(5,1),
  ADD COLUMN IF NOT EXISTS ziel_mostgewicht_einheit_vorher text;
ALTER TABLE public.verschneidungen DROP CONSTRAINT IF EXISTS verschneidungen_ziel_mostgewicht_einheit_vorher_check;
ALTER TABLE public.verschneidungen ADD  CONSTRAINT verschneidungen_ziel_mostgewicht_einheit_vorher_check
  CHECK (ziel_mostgewicht_einheit_vorher IS NULL OR ziel_mostgewicht_einheit_vorher IN ('kmw', 'oechsle'));

COMMENT ON COLUMN public.verschneidungen.ziel_kmw_vorher IS
  '°KMW der Ziel-Charge VOR der Verschneidung – für den Restore beim Storno (KAN-128/KAN-130).';
COMMENT ON COLUMN public.verschneidungen.ziel_oechsle_vorher IS
  '°Oe der Ziel-Charge VOR der Verschneidung – für den Restore beim Storno (KAN-128/KAN-130).';
COMMENT ON COLUMN public.verschneidungen.ziel_mostgewicht_einheit_vorher IS
  'Gemessene Einheit (kmw/oechsle) der Ziel-Charge VOR der Verschneidung – für den Restore beim Storno (KAN-128/KAN-130).';

-- keller_umzuege: Muster <feld>_vorher / <feld>_nachher wie qualitaet_* und herkunft_code_*.
ALTER TABLE public.keller_umzuege
  ADD COLUMN IF NOT EXISTS kmw_vorher numeric(5,2),
  ADD COLUMN IF NOT EXISTS kmw_nachher numeric(5,2),
  ADD COLUMN IF NOT EXISTS oechsle_vorher numeric(5,1),
  ADD COLUMN IF NOT EXISTS oechsle_nachher numeric(5,1),
  ADD COLUMN IF NOT EXISTS mostgewicht_einheit_vorher text,
  ADD COLUMN IF NOT EXISTS mostgewicht_einheit_nachher text;
ALTER TABLE public.keller_umzuege DROP CONSTRAINT IF EXISTS keller_umzuege_mostgewicht_einheit_vorher_check;
ALTER TABLE public.keller_umzuege ADD  CONSTRAINT keller_umzuege_mostgewicht_einheit_vorher_check
  CHECK (mostgewicht_einheit_vorher IS NULL OR mostgewicht_einheit_vorher IN ('kmw', 'oechsle'));
ALTER TABLE public.keller_umzuege DROP CONSTRAINT IF EXISTS keller_umzuege_mostgewicht_einheit_nachher_check;
ALTER TABLE public.keller_umzuege ADD  CONSTRAINT keller_umzuege_mostgewicht_einheit_nachher_check
  CHECK (mostgewicht_einheit_nachher IS NULL OR mostgewicht_einheit_nachher IN ('kmw', 'oechsle'));

COMMENT ON COLUMN public.keller_umzuege.kmw_vorher IS
  'Zusammenführung: °KMW der Ziel-Charge (nach_weinausbau_id) vor dem Zugang – für den Restore beim Storno (KAN-128/KAN-130).';
COMMENT ON COLUMN public.keller_umzuege.kmw_nachher IS
  'Zusammenführung: °KMW der Ziel-Charge nach dem Zugang (massegewichtetes Mittel, Audit; KAN-128/KAN-130).';
COMMENT ON COLUMN public.keller_umzuege.oechsle_vorher IS
  'Zusammenführung: °Oe der Ziel-Charge vor dem Zugang – für den Restore beim Storno (KAN-128/KAN-130).';
COMMENT ON COLUMN public.keller_umzuege.oechsle_nachher IS
  'Zusammenführung: °Oe der Ziel-Charge nach dem Zugang (aus dem °KMW-Mittel gerechnet, Audit; KAN-128/KAN-130).';
COMMENT ON COLUMN public.keller_umzuege.mostgewicht_einheit_vorher IS
  'Zusammenführung: gemessene Einheit (kmw/oechsle) der Ziel-Charge vor dem Zugang – für den Restore beim Storno (KAN-128/KAN-130).';
COMMENT ON COLUMN public.keller_umzuege.mostgewicht_einheit_nachher IS
  'Zusammenführung: Einheit der Ziel-Charge nach dem Zugang (Mittelwert → kmw; Audit, KAN-128/KAN-130).';


-- ─── 5. Bevorzugte Einheit je Betrieb (Entscheidung 3) ──────────────────────
-- Default 'kmw' für alle vier Betriebe (Fast Default, kein Umschreiben, kein Trigger).
ALTER TABLE public.tenant_einstellungen
  ADD COLUMN IF NOT EXISTS mostgewicht_einheit text NOT NULL DEFAULT 'kmw';
ALTER TABLE public.tenant_einstellungen DROP CONSTRAINT IF EXISTS tenant_einstellungen_mostgewicht_einheit_check;
ALTER TABLE public.tenant_einstellungen ADD  CONSTRAINT tenant_einstellungen_mostgewicht_einheit_check
  CHECK (mostgewicht_einheit IN ('kmw', 'oechsle'));

COMMENT ON COLUMN public.tenant_einstellungen.mostgewicht_einheit IS
  'Bevorzugte Einheit des Betriebs für Mostgewicht-Eingabe und -Anzeige (kmw/oechsle, KAN-128); Exporte immer °KMW vor °Oe. Einstellen nur canAdmin, geschrieben über die Service-Role (a_schutz_plattformfelder ohne neues Argument).';


-- ─── 6. Trigger b_mostgewicht ───────────────────────────────────────────────
-- BEFORE-Trigger desselben Ereignisses feuern in Namensreihenfolge: „b_mostgewicht“ läuft vor
-- weinausbau_gebinde_pruefen_trg und weinausbau_updated_at (die anderen fünf Tabellen haben keine
-- BEFORE-Zeilen-Trigger); die AFTER-Trigger z_protokoll_* sehen die fertigen Werte.
-- UPDATE OF: feuert nur, wenn eine der drei Spalten im SET steht – andere Updates ändern nichts am
-- Mostgewicht.
DROP TRIGGER IF EXISTS b_mostgewicht ON public.ernte_parzellen;
CREATE TRIGGER b_mostgewicht
  BEFORE INSERT OR UPDATE OF klosterneuburger, oechsle, mostgewicht_einheit ON public.ernte_parzellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_mostgewicht_abgleichen('klosterneuburger', 'oechsle', 'mostgewicht_einheit');

DROP TRIGGER IF EXISTS b_mostgewicht ON public.pressungen;
CREATE TRIGGER b_mostgewicht
  BEFORE INSERT OR UPDATE OF kmw_grad, oechsle, mostgewicht_einheit ON public.pressungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_mostgewicht_abgleichen('kmw_grad', 'oechsle', 'mostgewicht_einheit');

DROP TRIGGER IF EXISTS b_mostgewicht ON public.pressung_weingaerten;
CREATE TRIGGER b_mostgewicht
  BEFORE INSERT OR UPDATE OF kmw, oechsle, mostgewicht_einheit ON public.pressung_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.s112_mostgewicht_abgleichen('kmw', 'oechsle', 'mostgewicht_einheit');

DROP TRIGGER IF EXISTS b_mostgewicht ON public.traubenverkauf;
CREATE TRIGGER b_mostgewicht
  BEFORE INSERT OR UPDATE OF kmw_grad, oechsle, mostgewicht_einheit ON public.traubenverkauf
  FOR EACH ROW EXECUTE FUNCTION public.s112_mostgewicht_abgleichen('kmw_grad', 'oechsle', 'mostgewicht_einheit');

DROP TRIGGER IF EXISTS b_mostgewicht ON public.weinausbau;
CREATE TRIGGER b_mostgewicht
  BEFORE INSERT OR UPDATE OF kmw, oechsle, mostgewicht_einheit ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_mostgewicht_abgleichen('kmw', 'oechsle', 'mostgewicht_einheit');

DROP TRIGGER IF EXISTS b_mostgewicht ON public.zukauf_posten;
CREATE TRIGGER b_mostgewicht
  BEFORE INSERT OR UPDATE OF kmw, oechsle, mostgewicht_einheit ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_mostgewicht_abgleichen('kmw', 'oechsle', 'mostgewicht_einheit');


-- ─── 7. Nachtrag: °Oe aus dem vorhandenen °KMW ──────────────────────────────
-- SET mostgewicht_einheit feuert b_mostgewicht (Spalte in UPDATE OF); keine Mostgewichtsspalte
-- geändert → Einheit wie mitgegeben ('kmw') → °Oe = Formel, °KMW bleibt. Nur Zeilen, die es brauchen
-- (Einheit 'kmw', °Oe ≠ Formel): beim ersten Lauf alle Zeilen mit °KMW – Erwartung 26.09.2026 (SELECT):
-- ernte_parzellen 15 (alle °Oe ≠ Formel), pressungen 17, pressung_weingaerten 20, traubenverkauf 0,
-- weinausbau 119, zukauf_posten 2 (°Oe dort noch NULL). Ein zweiter Lauf trifft 0 Zeilen: keine in °Oe
-- gemessene Zeile kippt auf 'kmw', keine Protokollzeile, kein updated_at-Sprung.
-- Zeilen nur mit °Oe (live 0, nur ernte_parzellen möglich) → 'oechsle', °KMW gerechnet.
UPDATE public.ernte_parzellen      SET mostgewicht_einheit = 'kmw'
 WHERE klosterneuburger IS NOT NULL AND mostgewicht_einheit = 'kmw' AND oechsle IS DISTINCT FROM public.s112_oechsle_aus_kmw(klosterneuburger);
UPDATE public.ernte_parzellen      SET mostgewicht_einheit = 'oechsle'
 WHERE klosterneuburger IS NULL AND oechsle IS NOT NULL;
UPDATE public.pressungen           SET mostgewicht_einheit = 'kmw'
 WHERE kmw_grad IS NOT NULL AND mostgewicht_einheit = 'kmw' AND oechsle IS DISTINCT FROM public.s112_oechsle_aus_kmw(kmw_grad);
UPDATE public.pressung_weingaerten SET mostgewicht_einheit = 'kmw'
 WHERE kmw IS NOT NULL AND mostgewicht_einheit = 'kmw' AND oechsle IS DISTINCT FROM public.s112_oechsle_aus_kmw(kmw);
UPDATE public.traubenverkauf       SET mostgewicht_einheit = 'kmw'
 WHERE kmw_grad IS NOT NULL AND mostgewicht_einheit = 'kmw' AND oechsle IS DISTINCT FROM public.s112_oechsle_aus_kmw(kmw_grad);
UPDATE public.weinausbau           SET mostgewicht_einheit = 'kmw'
 WHERE kmw IS NOT NULL AND mostgewicht_einheit = 'kmw' AND oechsle IS DISTINCT FROM public.s112_oechsle_aus_kmw(kmw);
UPDATE public.zukauf_posten        SET mostgewicht_einheit = 'kmw'
 WHERE kmw IS NOT NULL AND mostgewicht_einheit = 'kmw' AND oechsle IS DISTINCT FROM public.s112_oechsle_aus_kmw(kmw);


-- ─── 8. Änderungsprotokoll (offene Frage 3) ─────────────────────────────────
-- Erst NACH dem Nachtrag (siehe Kopf: keine Protokollflut). Muster Migration kan35_datenintegritaet:
-- z_protokoll_aendern AFTER UPDATE OF <Spalten> mit denselben Spalten als Argumenten neu anlegen.
-- Die bestehende Liste wird aus pg_trigger gelesen (tgargs = UPDATE OF, sonst Abbruch) und nur um
-- °KMW-Spalte, oechsle, mostgewicht_einheit ergänzt – so bleiben Ergänzungen anderer Migrationen
-- (KAN-126, KAN-129) erhalten, egal in welcher Reihenfolge sie kommen.
-- Ergebnis Stand 26.09.2026 (angehängt jeweils <°KMW-Spalte>, oechsle, mostgewicht_einheit):
--   ernte_parzellen      menge_kg, menge_hl, jahrgang_id, weingarten_id, grundstueck_id
--   pressungen           datum, jahrgang_id, most_liter_gesamt, tenant_id
--   pressung_weingaerten trauben_kg, weingarten_id, grundstueck_id, zukauf_posten_id, pressung_id
--   traubenverkauf       menge_kg, datum, jahrgang_id, weingarten_id, grundstueck_id, zukauf_posten_id, verkaufsposten_id, tenant_id
--   weinausbau           menge_liter, anfangsbestand_liter, behaelter_id, aktiv, status, qualitaetsstufe, herkunft_code, weinart, rebsorte, jahrgang, ist_eroeffnungsbestand, tenant_id
--   zukauf_posten        menge, einheit, art, aktiv, ziel_weinausbau_id, datum, tenant_id
-- bestandsprotokoll_schreiben() schreibt nur, wenn sich eine überwachte Spalte tatsächlich ändert;
-- eine °KMW-Änderung protokolliert das neu gerechnete °Oe (und ggf. die Einheit) mit.
DO $protokoll$
DECLARE
  r_tab     record;
  v_args    text[];
  v_update  text[];
  v_spalten text[];
BEGIN
  FOR r_tab IN
    SELECT * FROM (VALUES
      ('ernte_parzellen'::text, 'klosterneuburger'::text),
      ('pressungen',            'kmw_grad'),
      ('pressung_weingaerten',  'kmw'),
      ('traubenverkauf',        'kmw_grad'),
      ('weinausbau',            'kmw'),
      ('zukauf_posten',         'kmw')
    ) AS t(tabelle, kmw_spalte)
  LOOP
    SELECT array_remove(string_to_array(encode(tg.tgargs, 'escape'), '\000'), ''),
           ARRAY(SELECT a.attname::text
                   FROM unnest(tg.tgattr::int2[]) WITH ORDINALITY AS u(attnum, nr)
                   JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = u.attnum
                  ORDER BY u.nr)
      INTO v_args, v_update
      FROM pg_trigger tg
     WHERE tg.tgrelid = format('public.%I', r_tab.tabelle)::regclass
       AND tg.tgname = 'z_protokoll_aendern';

    IF v_args IS NULL OR cardinality(v_args) = 0 THEN
      RAISE EXCEPTION 'KAN-128: z_protokoll_aendern auf % fehlt oder hat keine Spalten', r_tab.tabelle;
    END IF;
    IF v_update IS DISTINCT FROM v_args THEN
      RAISE EXCEPTION 'KAN-128: z_protokoll_aendern auf %: UPDATE OF (%) ≠ Argumente (%)',
        r_tab.tabelle, array_to_string(v_update, ', '), array_to_string(v_args, ', ');
    END IF;

    v_spalten := v_args || ARRAY(
      SELECT s FROM unnest(ARRAY[r_tab.kmw_spalte, 'oechsle', 'mostgewicht_einheit']) WITH ORDINALITY AS n(s, nr)
       WHERE s <> ALL (v_args) ORDER BY nr);

    EXECUTE format('DROP TRIGGER z_protokoll_aendern ON public.%I', r_tab.tabelle);
    EXECUTE format('CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF %s ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben(%s)',
                   (SELECT string_agg(format('%I', s), ', ' ORDER BY nr) FROM unnest(v_spalten) WITH ORDINALITY AS n(s, nr)),
                   r_tab.tabelle,
                   (SELECT string_agg(quote_literal(s), ', ' ORDER BY nr) FROM unnest(v_spalten) WITH ORDINALITY AS n(s, nr)));
  END LOOP;
END $protokoll$;


-- ─── 9. Selbstprüfung ───────────────────────────────────────────────────────
-- Bricht die Migration ab, wenn der Nachtrag eine Zeile inkonsistent hinterlassen hätte.
DO $pruefung$
DECLARE
  v_inkonsistent bigint;
BEGIN
  SELECT count(*) INTO v_inkonsistent
    FROM (
      SELECT klosterneuburger AS mg_kmw, oechsle AS mg_oe, mostgewicht_einheit AS mg_einheit FROM public.ernte_parzellen
      UNION ALL SELECT kmw_grad, oechsle, mostgewicht_einheit FROM public.pressungen
      UNION ALL SELECT kmw,      oechsle, mostgewicht_einheit FROM public.pressung_weingaerten
      UNION ALL SELECT kmw_grad, oechsle, mostgewicht_einheit FROM public.traubenverkauf
      UNION ALL SELECT kmw,      oechsle, mostgewicht_einheit FROM public.weinausbau
      UNION ALL SELECT kmw,      oechsle, mostgewicht_einheit FROM public.zukauf_posten
    ) x
   WHERE (x.mg_kmw IS NULL) <> (x.mg_oe IS NULL)
      OR (x.mg_einheit = 'kmw'     AND x.mg_oe  IS DISTINCT FROM public.s112_oechsle_aus_kmw(x.mg_kmw))
      OR (x.mg_einheit = 'oechsle' AND x.mg_kmw IS DISTINCT FROM public.s112_kmw_aus_oechsle(x.mg_oe));
  IF v_inkonsistent > 0 THEN
    RAISE EXCEPTION 'KAN-128: % Zeilen mit inkonsistentem Mostgewicht nach dem Nachtrag – Abbruch', v_inkonsistent;
  END IF;
END $pruefung$;
