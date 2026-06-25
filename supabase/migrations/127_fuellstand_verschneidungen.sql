-- Migration 127: v_behaelter_fuellstand um Verschneidungen erweitern
-- Problem: Verschneidungen (Liter-Transfers zwischen Chargen/Behältern)
--          wurden in der View nicht berücksichtigt → falsche Füllstände.

CREATE OR REPLACE VIEW v_behaelter_fuellstand
WITH (security_invoker = true)
AS
WITH

-- ── Alle Charge-IDs die jemals einem Behälter zugeordnet waren ───────────────
charge_kontakte AS (
  SELECT behaelter_id, id AS charge_id
  FROM weinausbau
  WHERE behaelter_id IS NOT NULL

  UNION

  SELECT ku.nach_behaelter_id, ku.nach_weinausbau_id
  FROM keller_umzuege ku
  WHERE ku.nach_behaelter_id IS NOT NULL
    AND ku.nach_weinausbau_id IS NOT NULL

  UNION

  SELECT ku.von_behaelter_id, ku.von_weinausbau_id
  FROM keller_umzuege ku
  WHERE ku.von_behaelter_id IS NOT NULL
    AND ku.von_weinausbau_id IS NOT NULL

  UNION

  SELECT pb.behaelter_id, pb.weinausbau_id
  FROM pressung_behaelter pb
  WHERE pb.behaelter_id IS NOT NULL
),

-- ── Anfangsbestand: EB-Charge pro Behälter (nur für Migration / Onboarding) ──
anfangsbestand AS (
  SELECT
    behaelter_id,
    COALESCE(anfangsbestand_liter, menge_liter, 0) AS liter
  FROM weinausbau
  WHERE ist_eroeffnungsbestand = true
    AND behaelter_id IS NOT NULL
),

-- ── Zukäufe (Wein/Most) direkt in einen Behälter ─────────────────────────────
zukauf_ein AS (
  SELECT
    wa.behaelter_id,
    SUM(zp.menge) AS liter
  FROM zukauf_posten zp
  JOIN weinausbau wa ON wa.id = zp.ziel_weinausbau_id
  WHERE zp.aktiv = true
    AND zp.art IN ('wein', 'most')
    AND zp.ziel_weinausbau_id IS NOT NULL
    AND wa.behaelter_id IS NOT NULL
  GROUP BY wa.behaelter_id
),

-- ── Pressungen direkt am Behälter ─────────────────────────────────────────────
pressungen AS (
  SELECT
    pb.behaelter_id,
    SUM(COALESCE(pb.menge_liter, wa.menge_liter, 0)) AS liter
  FROM pressung_behaelter pb
  LEFT JOIN weinausbau wa ON wa.id = pb.weinausbau_id
  WHERE pb.behaelter_id IS NOT NULL
  GROUP BY pb.behaelter_id
),

-- ── Eingehende Umzüge (netto nach Schwund) ───────────────────────────────────
umzuege_ein AS (
  SELECT
    nach_behaelter_id AS behaelter_id,
    SUM(CASE
      WHEN brutto_liter IS NOT NULL
        THEN menge_liter
        ELSE GREATEST(0, menge_liter - COALESCE(schwund_liter, 0))
    END) AS liter
  FROM keller_umzuege
  WHERE nach_behaelter_id IS NOT NULL
  GROUP BY nach_behaelter_id
),

-- ── Ausgehende Umzüge von Chargen dieses Behälters (brutto) ──────────────────
umzuege_aus AS (
  SELECT
    ck.behaelter_id,
    SUM(CASE
      WHEN ku.zeilen_typ = 'quelle'
        THEN ku.menge_liter
        ELSE COALESCE(ku.brutto_liter, ku.menge_liter)
    END) AS liter
  FROM keller_umzuege ku
  JOIN charge_kontakte ck ON ck.charge_id = ku.von_weinausbau_id
  GROUP BY ck.behaelter_id
),

-- ── Abfüllungen für Chargen dieses Behälters ─────────────────────────────────
abfuellungen AS (
  SELECT
    ck.behaelter_id,
    SUM(COALESCE(
      f.menge_liter_gefuellt,
      f.anzahl_flaschen::numeric * f.flaschengroesse_ml::numeric / 1000.0
    )) AS liter
  FROM fuellungen f
  JOIN charge_kontakte ck ON ck.charge_id = f.weinausbau_id
  GROUP BY ck.behaelter_id
),

-- ── Tank-Verkäufe (nicht storniert) ──────────────────────────────────────────
verkaufe AS (
  SELECT
    ck.behaelter_id,
    SUM(vp.menge) AS liter
  FROM verkauf_positionen vp
  JOIN verkaufsposten     vs ON vs.id = vp.verkaufsposten_id
  JOIN charge_kontakte    ck ON ck.charge_id = vp.weinausbau_id
  WHERE vp.typ = 'tank'
    AND NOT COALESCE(vs.storniert, false)
  GROUP BY ck.behaelter_id
),

-- ── Verschneidungen eingehend (Ziel-Charge liegt in diesem Behälter) ─────────
verschneidungen_ein AS (
  SELECT
    ck.behaelter_id,
    SUM(vq.menge_liter) AS liter
  FROM verschneidung_quellen vq
  JOIN verschneidungen v ON v.id = vq.verschneidung_id
  JOIN charge_kontakte ck ON ck.charge_id = v.ziel_weinausbau_id
  GROUP BY ck.behaelter_id
),

-- ── Verschneidungen ausgehend (Quell-Charge lag in diesem Behälter) ──────────
verschneidungen_aus AS (
  SELECT
    ck.behaelter_id,
    SUM(vq.menge_liter) AS liter
  FROM verschneidung_quellen vq
  JOIN charge_kontakte ck ON ck.charge_id = vq.quell_weinausbau_id
  GROUP BY ck.behaelter_id
)

SELECT
  b.id        AS behaelter_id,
  b.tenant_id,
  ROUND((
      COALESCE(ab.liter, 0)
    + COALESCE(zk.liter, 0)
    + COALESCE(pr.liter, 0)
    + COALESCE(ue.liter, 0)
    + COALESCE(vi.liter, 0)
    - COALESCE(ua.liter, 0)
    - COALESCE(af.liter, 0)
    - COALESCE(vk.liter, 0)
    - COALESCE(vo.liter, 0)
  )::numeric, 2) AS liter_aktuell

FROM behaelter b
LEFT JOIN anfangsbestand      ab ON ab.behaelter_id = b.id
LEFT JOIN zukauf_ein          zk ON zk.behaelter_id = b.id
LEFT JOIN pressungen          pr ON pr.behaelter_id = b.id
LEFT JOIN umzuege_ein         ue ON ue.behaelter_id = b.id
LEFT JOIN umzuege_aus         ua ON ua.behaelter_id = b.id
LEFT JOIN abfuellungen        af ON af.behaelter_id = b.id
LEFT JOIN verkaufe            vk ON vk.behaelter_id = b.id
LEFT JOIN verschneidungen_ein vi ON vi.behaelter_id = b.id
LEFT JOIN verschneidungen_aus vo ON vo.behaelter_id = b.id;
