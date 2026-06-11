-- ═══════════════════════════════════════════════════════════════════════════════
-- Diagnose: Füllstand-Diskrepanz zwischen View (event-basiert) und menge_liter
-- Ausführen im Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

WITH

charge_kontakte AS (
  SELECT behaelter_id, id AS charge_id FROM weinausbau WHERE behaelter_id IS NOT NULL
  UNION
  SELECT ku.nach_behaelter_id, ku.nach_weinausbau_id FROM keller_umzuege ku WHERE ku.nach_behaelter_id IS NOT NULL AND ku.nach_weinausbau_id IS NOT NULL
  UNION
  SELECT ku.von_behaelter_id, ku.von_weinausbau_id FROM keller_umzuege ku WHERE ku.von_behaelter_id IS NOT NULL AND ku.von_weinausbau_id IS NOT NULL
  UNION
  SELECT pb.behaelter_id, pb.weinausbau_id FROM pressung_behaelter pb WHERE pb.behaelter_id IS NOT NULL
),

ab AS (
  SELECT behaelter_id, COALESCE(anfangsbestand_liter, menge_liter, 0) AS liter
  FROM weinausbau WHERE ist_eroeffnungsbestand = true AND behaelter_id IS NOT NULL
),
pr AS (
  SELECT behaelter_id, SUM(menge_liter) AS liter FROM pressung_behaelter GROUP BY behaelter_id
),
ue AS (
  SELECT nach_behaelter_id AS behaelter_id,
    SUM(CASE WHEN brutto_liter IS NOT NULL THEN menge_liter ELSE GREATEST(0, menge_liter - COALESCE(schwund_liter,0)) END) AS liter
  FROM keller_umzuege WHERE nach_behaelter_id IS NOT NULL GROUP BY nach_behaelter_id
),
ua AS (
  SELECT ck.behaelter_id,
    SUM(CASE WHEN ku.zeilen_typ='quelle' THEN ku.menge_liter ELSE COALESCE(ku.brutto_liter, ku.menge_liter) END) AS liter
  FROM keller_umzuege ku JOIN charge_kontakte ck ON ck.charge_id = ku.von_weinausbau_id GROUP BY ck.behaelter_id
),
af AS (
  SELECT ck.behaelter_id,
    SUM(COALESCE(f.menge_liter_gefuellt, f.anzahl_flaschen::numeric * f.flaschengroesse_ml::numeric / 1000.0)) AS liter
  FROM fuellungen f JOIN charge_kontakte ck ON ck.charge_id = f.weinausbau_id GROUP BY ck.behaelter_id
),
vk AS (
  SELECT ck.behaelter_id, SUM(vp.menge) AS liter
  FROM verkauf_positionen vp
  JOIN verkaufsposten vs ON vs.id = vp.verkaufsposten_id
  JOIN charge_kontakte ck ON ck.charge_id = vp.weinausbau_id
  WHERE vp.typ = 'tank' AND NOT COALESCE(vs.storniert, false)
  GROUP BY ck.behaelter_id
),

-- Summe menge_liter aller aktiven Chargen pro Behälter (was Abfüllen-Form sieht)
ml AS (
  SELECT behaelter_id, SUM(menge_liter) AS liter
  FROM weinausbau
  WHERE behaelter_id IS NOT NULL AND aktiv = true AND status != 'abgeschlossen'
  GROUP BY behaelter_id
)

SELECT
  b.name                                AS behaelter,
  ROUND(COALESCE(ab.liter,0),1)         AS "EB (Anfangsbestand)",
  ROUND(COALESCE(pr.liter,0),1)         AS "+ Pressungen",
  ROUND(COALESCE(ue.liter,0),1)         AS "+ Umzüge rein",
  ROUND(COALESCE(ua.liter,0),1)         AS "- Umzüge raus",
  ROUND(COALESCE(af.liter,0),1)         AS "- Abfüllungen",
  ROUND(COALESCE(vk.liter,0),1)         AS "- Tankverkäufe",
  ROUND((
    COALESCE(ab.liter,0)+COALESCE(pr.liter,0)+COALESCE(ue.liter,0)
    -COALESCE(ua.liter,0)-COALESCE(af.liter,0)-COALESCE(vk.liter,0)
  )::numeric,1)                         AS "View (event-basiert)",
  ROUND(COALESCE(ml.liter,0)::numeric,1) AS "menge_liter (Abfüllen-Limit)",
  ROUND((
    COALESCE(ab.liter,0)+COALESCE(pr.liter,0)+COALESCE(ue.liter,0)
    -COALESCE(ua.liter,0)-COALESCE(af.liter,0)-COALESCE(vk.liter,0)
    - COALESCE(ml.liter,0)
  )::numeric,1)                         AS "Differenz (View - menge_liter)"

FROM behaelter b
LEFT JOIN ab ON ab.behaelter_id = b.id
LEFT JOIN pr ON pr.behaelter_id = b.id
LEFT JOIN ue ON ue.behaelter_id = b.id
LEFT JOIN ua ON ua.behaelter_id = b.id
LEFT JOIN af ON af.behaelter_id = b.id
LEFT JOIN vk ON vk.behaelter_id = b.id
LEFT JOIN ml ON ml.behaelter_id = b.id
WHERE b.aktiv = true
ORDER BY b.name;
