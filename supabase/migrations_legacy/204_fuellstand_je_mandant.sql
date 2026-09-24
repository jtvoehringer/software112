-- Füllstand je Gebinde UND Betrieb (Kellergemeinschaft, Folge zu Migration 203).
-- Bisher war v_behaelter_fuellstand nach behaelter.tenant_id (Eigentümer) gruppiert
-- und summierte alle Chargen im Gebinde - bei geteilten Gebinden also auch den
-- Wein des Partnerbetriebs: Der Eigentümer sah dessen Liter in „Liter in Ausbau“
-- und doppelt im Füllstand (Sicht + fremd_liter), der Partner sah seinen eigenen
-- Wein im fremden Gebinde gar nicht (tenant_id ≠ eigener Betrieb).
-- Jetzt: eine Zeile je (behaelter_id, tenant_id des Inhalts), alle Ereignisse
-- (Eröffnungsbestand, Zukauf, Pressung, Umzug, Abfüllung, Tankverkauf,
-- Verschnitt) tragen den Betrieb der jeweiligen Charge/Bewegung.
-- Spalten unverändert (behaelter_id, tenant_id, liter_aktuell); Aufrufer filtern
-- weiterhin .eq('tenant_id', aktiver Betrieb).

CREATE OR REPLACE VIEW v_behaelter_fuellstand WITH (security_invoker = true) AS
WITH charge_kontakte AS (
  SELECT w.behaelter_id, w.id AS charge_id, w.tenant_id
    FROM weinausbau w WHERE w.behaelter_id IS NOT NULL
  UNION
  SELECT ku.nach_behaelter_id, ku.nach_weinausbau_id, ku.tenant_id
    FROM keller_umzuege ku WHERE ku.nach_behaelter_id IS NOT NULL AND ku.nach_weinausbau_id IS NOT NULL
  UNION
  SELECT ku.von_behaelter_id, ku.von_weinausbau_id, ku.tenant_id
    FROM keller_umzuege ku WHERE ku.von_behaelter_id IS NOT NULL AND ku.von_weinausbau_id IS NOT NULL
  UNION
  SELECT pb.behaelter_id, pb.weinausbau_id, p.tenant_id
    FROM pressung_behaelter pb JOIN pressungen p ON p.id = pb.pressung_id
   WHERE pb.behaelter_id IS NOT NULL
),
anfangsbestand AS (
  SELECT w.behaelter_id, w.tenant_id, SUM(COALESCE(w.anfangsbestand_liter, w.menge_liter, 0)) AS liter
    FROM weinausbau w
   WHERE w.ist_eroeffnungsbestand = true AND w.behaelter_id IS NOT NULL
   GROUP BY w.behaelter_id, w.tenant_id
),
zukauf_ein AS (
  SELECT wa.behaelter_id, wa.tenant_id, SUM(zp.menge) AS liter
    FROM zukauf_posten zp JOIN weinausbau wa ON wa.id = zp.ziel_weinausbau_id
   WHERE zp.aktiv = true AND zp.art IN ('wein', 'most') AND zp.ziel_weinausbau_id IS NOT NULL AND wa.behaelter_id IS NOT NULL
   GROUP BY wa.behaelter_id, wa.tenant_id
),
pressungen_ein AS (
  SELECT pb.behaelter_id, p.tenant_id, SUM(COALESCE(pb.menge_liter, wa.menge_liter, 0)) AS liter
    FROM pressung_behaelter pb
    JOIN pressungen p ON p.id = pb.pressung_id
    LEFT JOIN weinausbau wa ON wa.id = pb.weinausbau_id
   WHERE pb.behaelter_id IS NOT NULL
   GROUP BY pb.behaelter_id, p.tenant_id
),
umzuege_ein AS (
  SELECT ku.nach_behaelter_id AS behaelter_id, ku.tenant_id,
         SUM(CASE WHEN ku.brutto_liter IS NOT NULL THEN ku.menge_liter
                  ELSE GREATEST(0, ku.menge_liter - COALESCE(ku.schwund_liter, 0)) END) AS liter
    FROM keller_umzuege ku
   WHERE ku.nach_behaelter_id IS NOT NULL
   GROUP BY ku.nach_behaelter_id, ku.tenant_id
),
umzuege_aus AS (
  SELECT ck.behaelter_id, ku.tenant_id,
         SUM(CASE WHEN ku.zeilen_typ = 'quelle' THEN ku.menge_liter ELSE COALESCE(ku.brutto_liter, ku.menge_liter) END) AS liter
    FROM keller_umzuege ku JOIN charge_kontakte ck ON ck.charge_id = ku.von_weinausbau_id
   GROUP BY ck.behaelter_id, ku.tenant_id
),
abfuellungen AS (
  SELECT ck.behaelter_id, f.tenant_id,
         SUM(COALESCE(f.menge_liter_gefuellt, f.anzahl_flaschen::numeric * f.flaschengroesse_ml::numeric / 1000.0)) AS liter
    FROM fuellungen f JOIN charge_kontakte ck ON ck.charge_id = f.weinausbau_id
   GROUP BY ck.behaelter_id, f.tenant_id
),
verkaeufe AS (
  SELECT ck.behaelter_id, vs.tenant_id, SUM(vp.menge) AS liter
    FROM verkauf_positionen vp
    JOIN verkaufsposten vs ON vs.id = vp.verkaufsposten_id
    JOIN charge_kontakte ck ON ck.charge_id = vp.weinausbau_id
   WHERE vp.typ = 'tank' AND NOT COALESCE(vs.storniert, false)
   GROUP BY ck.behaelter_id, vs.tenant_id
),
verschneidungen_ein AS (
  SELECT ck.behaelter_id, v.tenant_id, SUM(vq.menge_liter) AS liter
    FROM verschneidung_quellen vq
    JOIN verschneidungen v ON v.id = vq.verschneidung_id
    JOIN charge_kontakte ck ON ck.charge_id = v.ziel_weinausbau_id
   GROUP BY ck.behaelter_id, v.tenant_id
),
verschneidungen_aus AS (
  SELECT ck.behaelter_id, v.tenant_id, SUM(vq.menge_liter) AS liter
    FROM verschneidung_quellen vq
    JOIN verschneidungen v ON v.id = vq.verschneidung_id
    JOIN charge_kontakte ck ON ck.charge_id = vq.quell_weinausbau_id
   GROUP BY ck.behaelter_id, v.tenant_id
),
paare AS (
  SELECT behaelter_id, tenant_id FROM anfangsbestand
  UNION SELECT behaelter_id, tenant_id FROM zukauf_ein
  UNION SELECT behaelter_id, tenant_id FROM pressungen_ein
  UNION SELECT behaelter_id, tenant_id FROM umzuege_ein
  UNION SELECT behaelter_id, tenant_id FROM umzuege_aus
  UNION SELECT behaelter_id, tenant_id FROM abfuellungen
  UNION SELECT behaelter_id, tenant_id FROM verkaeufe
  UNION SELECT behaelter_id, tenant_id FROM verschneidungen_ein
  UNION SELECT behaelter_id, tenant_id FROM verschneidungen_aus
  UNION SELECT b.id, b.tenant_id FROM behaelter b   -- Eigentümer: immer eine Zeile (auch 0)
)
SELECT p.behaelter_id,
       p.tenant_id,
       ROUND(COALESCE(ab.liter, 0) + COALESCE(zk.liter, 0) + COALESCE(pr.liter, 0) + COALESCE(ue.liter, 0) + COALESCE(vi.liter, 0)
           - COALESCE(ua.liter, 0) - COALESCE(af.liter, 0) - COALESCE(vk.liter, 0) - COALESCE(vo.liter, 0), 2) AS liter_aktuell
  FROM paare p
  LEFT JOIN anfangsbestand      ab ON ab.behaelter_id = p.behaelter_id AND ab.tenant_id = p.tenant_id
  LEFT JOIN zukauf_ein          zk ON zk.behaelter_id = p.behaelter_id AND zk.tenant_id = p.tenant_id
  LEFT JOIN pressungen_ein      pr ON pr.behaelter_id = p.behaelter_id AND pr.tenant_id = p.tenant_id
  LEFT JOIN umzuege_ein         ue ON ue.behaelter_id = p.behaelter_id AND ue.tenant_id = p.tenant_id
  LEFT JOIN umzuege_aus         ua ON ua.behaelter_id = p.behaelter_id AND ua.tenant_id = p.tenant_id
  LEFT JOIN abfuellungen        af ON af.behaelter_id = p.behaelter_id AND af.tenant_id = p.tenant_id
  LEFT JOIN verkaeufe           vk ON vk.behaelter_id = p.behaelter_id AND vk.tenant_id = p.tenant_id
  LEFT JOIN verschneidungen_ein vi ON vi.behaelter_id = p.behaelter_id AND vi.tenant_id = p.tenant_id
  LEFT JOIN verschneidungen_aus vo ON vo.behaelter_id = p.behaelter_id AND vo.tenant_id = p.tenant_id;
