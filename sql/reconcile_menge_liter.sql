-- ═══════════════════════════════════════════════════════════════════════════════
-- software:112 – Kellerbuch Reconciliation
-- Abgleich weinausbau.menge_liter mit der Event-History
--
-- ABLAUF:
--   1. SCHRITT 1 ausführen (reiner SELECT – keine Änderungen)
--   2. Ergebnis prüfen: Macht die Differenz für jede Charge Sinn?
--   3. SCHRITT 2 auskommentieren und ausführen
--
-- Tenant-ID Sandbox: fa22dc07-eca5-43df-af96-f7b9b09f0471
--
-- ─── ACHTUNG seit KAN-35 (24.09.2026) ─────────────────────────────────────────
-- Migration 20260924170709_kan35_datenintegritaet:
--  • Jede Löschung und bestandsrelevante Änderung an Kellerbuch-, Lese- und
--    Verkaufstabellen (weinausbau, keller_umzuege, verschneidungen, verschneidung_
--    quellen, keller_behandlungen, fuellungen, fuellung_chargen, fuellung_bewegungen,
--    zukauf_posten, pressungen, pressung_behaelter, pressung_weingaerten,
--    ernte_parzellen, traubenverkauf, verkaufsposten, verkauf_positionen,
--    ama_erntemeldungen, ama_meldepositionen, weinjahrgaenge) landet per Trigger im
--    bestandsprotokoll – auch im SQL-Editor und bei FK-Kaskaden. Das ist gewollt.
--  • TRUNCATE ist auf diesen Tabellen gesperrt – nur zeilenweise mit DELETE löschen.
--  • Nicht mit SET session_replication_role = 'replica' arbeiten: das schaltet
--    Protokoll-Trigger, FK-Prüfungen UND FK-Kaskaden ab (ungeprotokollierte
--    Löschungen, verwaiste Zeilen z. B. in fuellung_bewegungen).
--  • Löschreihenfolge wegen der FKs ohne ON DELETE (NO ACTION): verschneidungen
--    (samt verschneidung_quellen), keller_behandlungen, keller_umzuege,
--    fuellung_chargen und pressung_behaelter VOR weinausbau; weinausbau,
--    keller_umzuege, keller_behandlungen und pressung_behaelter VOR behaelter;
--    traubenverkauf VOR weinjahrgaenge.
--  • Mengenkorrekturen nicht per UPDATE, sondern über die RPCs schwund_buchen(...)
--    (Liter einer Charge mindern, datierte Schwundzeile) bzw. fuellung_bestand_buchen(...)
--    (Flaschenbestand ±, datierte Zeile in fuellung_bewegungen) – aus dem SQL-Editor
--    mit Parameternamen aufrufbar, z. B.
--      select schwund_buchen(p_tenant_id => '…', p_weinausbau_id => '…', p_liter => 12.5,
--                            p_datum => current_date, p_notiz => 'Korrektur …');
--    Ein direktes UPDATE von menge_liter/bestand_flaschen wird zwar protokolliert,
--    hinterlässt aber keine datierte Bewegung im Bewegungsbuch.
--  • SCHRITT 2 (UPDATE menge_liter) ist genau die stille Mengenänderung, die KAN-35
--    ablöst: Minderungen je Charge über schwund_buchen(...) buchen; Mehrmengen
--    fachlich klären (fehlender Zugang = eigene Buchung), nicht still hochsetzen.
--    Die Soll-Formel unten berücksichtigt fuellung_chargen (Füllungen aus mehreren
--    Chargen) nicht – Ergebnis von SCHRITT 1 deshalb nur als Hinweis lesen.
-- ───────────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Hilfsfunktion: Soll-Menge je weinausbau-Datensatz ───────────────────────
-- Logik identisch mit der Bewegungen-Page (behaelter/[id]/bewegungen):
--
--   Basis          = anfangsbestand_liter (manuell / Eröffnungsbestand)
--                  + Pressungen (nur wenn anfangsbestand_liter IS NULL,
--                    d.h. die Charge wurde durch eine Pressung erst angelegt)
--   + Zugänge      = eingehende keller_umzuege (nach_weinausbau_id = id)
--   - Abgänge      = ausgehende keller_umzuege (von_weinausbau_id = id)
--                    · neues Format (zeilen_typ='quelle'): brutto_liter
--                    · altes Format (brutto_liter gesetzt):  brutto_liter
--                    · ältestes Format (kein brutto_liter):  menge_liter + schwund_liter
--   - Abfüllungen  = fuellungen.menge_liter_gefuellt
--                    (fallback: anzahl_flaschen × flaschengroesse_ml / 1000)
--   - Tankverkäufe = verkauf_positionen.menge WHERE typ='tank' AND NOT storniert
-- ────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHRITT 1: DIAGNOSE (nur lesen – keine Daten werden geändert)
-- ═══════════════════════════════════════════════════════════════════════════════

WITH soll AS (

  SELECT
    wa.id,
    wa.name,
    wa.jahrgang,
    wa.ist_eroeffnungsbestand,
    wa.aktiv,
    wa.status,
    wa.behaelter_id,
    b.name                              AS behaelter_name,
    ROUND(wa.menge_liter::numeric, 2)   AS ist_liter,

    -- ── Basis ──────────────────────────────────────────────────────────────
    COALESCE(wa.anfangsbestand_liter, 0)

    -- Pressungen: nur einrechnen wenn kein anfangsbestand vorhanden
    -- (sonst wäre die Pressung schon im anfangsbestand enthalten)
    + CASE
        WHEN wa.anfangsbestand_liter IS NULL THEN
          COALESCE((
            SELECT SUM(pb.menge_liter)
            FROM   pressung_behaelter pb
            WHERE  pb.weinausbau_id = wa.id
          ), 0)
        ELSE 0
      END

    -- ── Zugänge: eingehende Umzüge (neues Format mit nach_weinausbau_id) ──
    + COALESCE((
        SELECT SUM(ku.menge_liter)
        FROM   keller_umzuege ku
        WHERE  ku.nach_weinausbau_id = wa.id
      ), 0)

    -- ── Abgänge: ausgehende Umzüge ─────────────────────────────────────────
    - COALESCE((
        SELECT SUM(
          CASE
            WHEN ku.zeilen_typ = 'quelle'    THEN COALESCE(ku.brutto_liter, ku.menge_liter)
            WHEN ku.brutto_liter IS NOT NULL  THEN ku.brutto_liter
            ELSE COALESCE(ku.menge_liter, 0) + COALESCE(ku.schwund_liter, 0)
          END
        )
        FROM keller_umzuege ku
        WHERE ku.von_weinausbau_id = wa.id
      ), 0)

    -- ── Abfüllungen ────────────────────────────────────────────────────────
    - COALESCE((
        SELECT SUM(
          COALESCE(
            f.menge_liter_gefuellt,
            (f.anzahl_flaschen::numeric * f.flaschengroesse_ml::numeric / 1000.0)
          )
        )
        FROM fuellungen f
        WHERE f.weinausbau_id = wa.id
      ), 0)

    -- ── Tank-Verkäufe (nicht storniert) ────────────────────────────────────
    - COALESCE((
        SELECT SUM(vp.menge)
        FROM   verkauf_positionen vp
        JOIN   verkaufsposten     vk ON vk.id = vp.verkaufsposten_id
        WHERE  vp.weinausbau_id = wa.id
          AND  vp.typ = 'tank'
          AND  NOT COALESCE(vk.storniert, false)
      ), 0)

    AS soll_liter

  FROM weinausbau wa
  LEFT JOIN behaelter b ON b.id = wa.behaelter_id
  WHERE wa.tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
    AND wa.ist_eroeffnungsbestand = false   -- EB-Chargen werden nicht angefasst
    AND wa.status != 'abgeschlossen'        -- abgeschlossene Chargen sind raus

)

SELECT
  id,
  name,
  jahrgang,
  aktiv,
  status,
  behaelter_name,
  ist_liter,
  ROUND(soll_liter::numeric, 2)             AS soll_liter,
  ROUND((soll_liter - ist_liter)::numeric, 2) AS differenz,
  CASE
    WHEN ABS(soll_liter - ist_liter) < 0.1  THEN '✅ ok'
    WHEN soll_liter < 0                      THEN '⚠️  soll negativ – manuell prüfen'
    ELSE                                          '❌ abweichend'
  END AS status_check

FROM soll
ORDER BY ABS(soll_liter - ist_liter) DESC;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SCHRITT 2: UPDATE
-- Erst ausführen nachdem Schritt 1 geprüft wurde!
-- Nur Datensätze wo |differenz| > 0.1 L UND soll_liter >= 0
-- (negative soll-Werte = Buchungsfehler → manuell klären, nicht blind überschreiben)
-- ═══════════════════════════════════════════════════════════════════════════════

/*

UPDATE weinausbau wa
SET    menge_liter = soll.soll_liter
FROM (
  SELECT
    wa2.id,
    (
      COALESCE(wa2.anfangsbestand_liter, 0)

      + CASE
          WHEN wa2.anfangsbestand_liter IS NULL THEN
            COALESCE((SELECT SUM(pb.menge_liter) FROM pressung_behaelter pb WHERE pb.weinausbau_id = wa2.id), 0)
          ELSE 0
        END

      + COALESCE((SELECT SUM(ku.menge_liter)   FROM keller_umzuege ku WHERE ku.nach_weinausbau_id = wa2.id), 0)

      - COALESCE((
          SELECT SUM(
            CASE
              WHEN ku.zeilen_typ = 'quelle'    THEN COALESCE(ku.brutto_liter, ku.menge_liter)
              WHEN ku.brutto_liter IS NOT NULL  THEN ku.brutto_liter
              ELSE COALESCE(ku.menge_liter, 0) + COALESCE(ku.schwund_liter, 0)
            END
          )
          FROM keller_umzuege ku
          WHERE ku.von_weinausbau_id = wa2.id
        ), 0)

      - COALESCE((
          SELECT SUM(COALESCE(f.menge_liter_gefuellt, f.anzahl_flaschen::numeric * f.flaschengroesse_ml::numeric / 1000.0))
          FROM fuellungen f WHERE f.weinausbau_id = wa2.id
        ), 0)

      - COALESCE((
          SELECT SUM(vp.menge)
          FROM   verkauf_positionen vp
          JOIN   verkaufsposten     vk ON vk.id = vp.verkaufsposten_id
          WHERE  vp.weinausbau_id = wa2.id
            AND  vp.typ = 'tank'
            AND  NOT COALESCE(vk.storniert, false)
        ), 0)
    ) AS soll_liter
  FROM weinausbau wa2
  WHERE wa2.tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
    AND wa2.ist_eroeffnungsbestand = false
    AND wa2.status != 'abgeschlossen'
) AS soll
WHERE wa.id = soll.id
  AND ABS(soll.soll_liter - wa.menge_liter) > 0.1   -- nur echte Abweichungen
  AND soll.soll_liter >= 0;                           -- keine negativen Werte blind setzen

-- Zur Kontrolle: wie viele Zeilen wurden aktualisiert?
-- (Supabase zeigt das im Result-Panel)

*/
