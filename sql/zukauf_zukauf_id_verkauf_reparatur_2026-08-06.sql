-- ============================================================================
-- Reparatur: Verkaeufe, die faelschlich ueber den Zukauf-Pfad (zukauf_id statt
-- weinausbau_id) gebucht wurden, obwohl der Zukauf bereits in ein Gebinde
-- abgefuellt war.
--
-- Hintergrund: src/app/api/verkauf-stammdaten/route.ts bot bereits abgefuellte
-- Zukaeufe (ziel_weinausbau_id gesetzt) beim Tank-Verkauf faelschlich ZUSAETZLICH
-- als eigenstaendige "Zukauf"-Option an. Ein Verkauf darueber hat
-- zukauf_posten.menge direkt dekrementiert, OHNE die zugehoerige Kellerbuch-
-- Charge (weinausbau.menge_liter) zu beruehren - dadurch:
--   a) zeigt der Zukauf seither einen falschen Preis/L (Gesamtpreis wird beim
--      Neuladen durch die faelschlich reduzierte Menge geteilt),
--   b) fehlt der Verkauf in der tatsaechlichen Kellerbuch-Charge (die zeigt
--      dadurch mehr Bestand, als physisch vorhanden ist - bis diese Charge
--      spaeter selbst bewegt/verkauft/umgezogen wird, wonach der Fehler
--      "vererbt" und schwerer nachzuvollziehen wird).
--
-- Der Code-Fix (verkauf-stammdaten/route.ts) verhindert das Problem ab jetzt fuer
-- NEUE Verkaeufe. Dieses Skript hilft, bereits VORHANDENE betroffene Zukaeufe zu
-- finden und - wo eindeutig moeglich - zu reparieren.
--
-- WICHTIG: Bitte Teil 1 (Diagnose) zuerst separat ausfuehren und das Ergebnis
-- pruefen/mit mir teilen, BEVOR Teil 3 (Reparatur) verwendet wird. Teil 3 ist
-- absichtlich als Kommentar auskommentiert und nutzt Platzhalter - erst nach
-- Pruefung der Diagnose-Ergebnisse fuer den/die konkreten Fall/Faelle anpassen
-- und gezielt (nicht als Bulk-Update ueber alle Zeilen) ausfuehren.
-- ============================================================================


-- ── Teil 1: Diagnose - welche Zukauf-Posten sind ueberhaupt betroffen? ───────
--
-- Ein Zukauf-Posten ist betroffen, wenn er bereits einem Gebinde zugeordnet ist
-- (ziel_weinausbau_id gesetzt) UND mindestens eine verkauf_positionen-Zeile mit
-- zukauf_id = seiner eigenen id existiert (das ist der fehlerhafte Pfad - der
-- korrekte Pfad fuer abgefuellte Zukaeufe laeuft ausschliesslich ueber
-- weinausbau_id).

SELECT
  zp.id                          AS zukauf_posten_id,
  zp.datum,
  zp.rebsorte,
  zp.menge                       AS aktuelle_zukauf_menge,      -- vermutlich zu niedrig (faelschlich reduziert)
  zp.preis_gesamt,
  zp.einstandspreis_pro_liter    AS urspruenglicher_preis_pro_liter,
  zp.ziel_weinausbau_id,
  wa.behaelter_id                AS ursprungs_behaelter_id,
  b.name                         AS ursprungs_behaelter_name,
  wa.menge_liter                 AS charge_aktueller_bestand,   -- live Bestand der urspruenglichen Charge (kann 0 sein, falls seither komplett umgezogen)
  wa.aktiv                       AS charge_aktiv,
  wa.status                      AS charge_status,
  (
    SELECT COALESCE(SUM(vp.menge), 0)
    FROM verkauf_positionen vp
    JOIN verkaufsposten vk ON vk.id = vp.verkaufsposten_id
    WHERE vp.zukauf_id = zp.id
      AND vk.storniert = false
  )                               AS faelschlich_ueber_zukauf_id_verkauft_liter
FROM zukauf_posten zp
LEFT JOIN weinausbau wa ON wa.id = zp.ziel_weinausbau_id
LEFT JOIN behaelter   b  ON b.id  = wa.behaelter_id
WHERE zp.aktiv = true
  AND zp.ziel_weinausbau_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM verkauf_positionen vp2
    JOIN verkaufsposten vk2 ON vk2.id = vp2.verkaufsposten_id
    WHERE vp2.zukauf_id = zp.id
      AND vk2.storniert = false
  )
ORDER BY zp.datum DESC;


-- ── Teil 2: Details zu den betroffenen Verkaufszeilen selbst ─────────────────
-- (Rechnungsnummer, Datum, Menge - hilfreich um die Verkaeufe wiederzuerkennen
-- und ggf. zu pruefen, ob sie storniert werden muessten statt nur umgebucht)

SELECT
  vp.id                AS verkauf_position_id,
  vp.zukauf_id,
  vp.menge              AS verkaufte_menge_liter,
  vp.preis_brutto,
  vk.rechnungsnummer,
  vk.datum              AS verkaufsdatum,
  vk.storniert
FROM verkauf_positionen vp
JOIN verkaufsposten vk ON vk.id = vp.verkaufsposten_id
WHERE vp.zukauf_id IN (
  SELECT zp.id FROM zukauf_posten zp
  WHERE zp.aktiv = true AND zp.ziel_weinausbau_id IS NOT NULL
)
ORDER BY vk.datum DESC;


-- ── Teil 3: Reparatur-Vorlage (NICHT automatisch ausfuehren) ─────────────────
--
-- Fuer jeden in Teil 1 gefundenen Zukauf-Posten getrennt anwenden, NACHDEM die
-- Zahlen gegen die Diagnose oben geprueft wurden. Ersetzt Platzhalter:
--   <ZUKAUF_ID>              = zukauf_posten_id aus Teil 1
--   <FAELSCHLICH_VERKAUFT>   = faelschlich_ueber_zukauf_id_verkauft_liter aus Teil 1
--
-- Schritt A stellt zukauf_posten.menge auf den urspruenglichen Wert zurueck
-- (unstrittig - dieser Wert soll ohnehin nie durch Verkaeufe veraendert werden,
-- die Verkaufsbuchung selbst bleibt in verkauf_positionen erhalten).
--
-- Schritt B verrechnet den faelschlich uebersprungenen Abzug NACHTRAEGLICH auf
-- die urspruengliche Kellerbuch-Charge - ABER NUR, wenn diese Charge seither
-- NICHT bereits (teilweise) umgezogen/verschnitten wurde (charge_aktueller_
-- bestand aus Teil 1 sollte dazu >= <FAELSCHLICH_VERKAUFT> sein, und
-- keller_umzuege sollte keinen Eintrag mit von_weinausbau_id = <ZUKAUF-CHARGE>
-- haben). Ist die Charge bereits umgezogen worden (charge_aktueller_bestand
-- ist 0 oder kleiner als der faelschlich verkaufte Betrag, oder es gibt bereits
-- eine keller_umzuege-Zeile), darf Schritt B NICHT blind ausgefuehrt werden -
-- dann fehlt der Verkauf stattdessen in der Charge, die den Wein aktuell
-- tatsaechlich enthaelt (das muss manuell im Kellerbuch nachgetragen werden,
-- da sich diese Ziel-Charge nicht automatisch eindeutig bestimmen laesst,
-- sobald mehrere Umzuege/Verschnitte dazwischenliegen). Bitte in diesem Fall
-- die Diagnose-Ergebnisse mit mir teilen, dann bauen wir die Korrektur fuer den
-- konkreten Fall gezielt.
--
-- Schritt C ordnet die betroffenen verkauf_positionen-Zeilen dem korrekten Pfad
-- zu (weinausbau_id statt zukauf_id), damit ein spaeteres Stornieren wieder
-- korrekt (auf die Charge statt auf zukauf_posten) zurueckbucht.

-- -- Schritt A: urspruengliche Zukauf-Menge wiederherstellen
-- UPDATE zukauf_posten
-- SET menge = menge + <FAELSCHLICH_VERKAUFT>
-- WHERE id = '<ZUKAUF_ID>';

-- -- Schritt B: NUR falls die Charge seither NICHT umgezogen/verschnitten wurde -
-- -- den faelschlich uebersprungenen Verkauf nachtraeglich auf die Kellerbuch-
-- -- Charge verrechnen
-- UPDATE weinausbau
-- SET menge_liter = GREATEST(0, menge_liter - <FAELSCHLICH_VERKAUFT>)
-- WHERE id = (SELECT ziel_weinausbau_id FROM zukauf_posten WHERE id = '<ZUKAUF_ID>');

-- -- Schritt C: betroffene Verkaufszeilen auf den korrekten Pfad umbuchen
-- UPDATE verkauf_positionen
-- SET zukauf_id = NULL,
--     weinausbau_id = (SELECT ziel_weinausbau_id FROM zukauf_posten WHERE id = '<ZUKAUF_ID>')
-- WHERE zukauf_id = '<ZUKAUF_ID>';
