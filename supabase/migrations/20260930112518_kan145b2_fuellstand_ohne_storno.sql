-- KAN-145 Block B, Etappe 2: Füllstand je Gebinde ohne stornierte Buchungen – ENTWURF, erst nach „OK, einspielen“
--
-- Ab B2 bleiben stornierte Umzüge und Verschnitte stehen (Kennzeichen storniert_am, Migration kan145b1). Die Sicht
-- v_behaelter_fuellstand summiert keller_umzuege, verschneidungen, fuellungen und zukauf_posten direkt – ohne Filter
-- zählte ein stornierter Umzug weiter mit. Neu: stornierte Zeilen fallen überall heraus (auch bei den Kontakten
-- Charge ↔ Gebinde). Sonst identisch mit der Fassung aus 204_fuellstand_je_mandant (security_invoker bleibt, Rechte
-- bleiben – CREATE OR REPLACE VIEW mit denselben Spalten). Heute ohne Wirkung: es gibt noch keine stornierten Zeilen.

CREATE OR REPLACE VIEW public.v_behaelter_fuellstand WITH (security_invoker = true) AS
 WITH charge_kontakte AS (
         SELECT w.behaelter_id,
            w.id AS charge_id,
            w.tenant_id
           FROM weinausbau w
          WHERE (w.behaelter_id IS NOT NULL)
        UNION
         SELECT ku.nach_behaelter_id,
            ku.nach_weinausbau_id,
            ku.tenant_id
           FROM keller_umzuege ku
          WHERE ((ku.nach_behaelter_id IS NOT NULL) AND (ku.nach_weinausbau_id IS NOT NULL) AND (ku.storniert_am IS NULL))
        UNION
         SELECT ku.von_behaelter_id,
            ku.von_weinausbau_id,
            ku.tenant_id
           FROM keller_umzuege ku
          WHERE ((ku.von_behaelter_id IS NOT NULL) AND (ku.von_weinausbau_id IS NOT NULL) AND (ku.storniert_am IS NULL))
        UNION
         SELECT pb.behaelter_id,
            pb.weinausbau_id,
            p_1.tenant_id
           FROM (pressung_behaelter pb
             JOIN pressungen p_1 ON ((p_1.id = pb.pressung_id)))
          WHERE (pb.behaelter_id IS NOT NULL)
        ), anfangsbestand AS (
         SELECT w.behaelter_id,
            w.tenant_id,
            sum(COALESCE(w.anfangsbestand_liter, w.menge_liter, (0)::numeric)) AS liter
           FROM weinausbau w
          WHERE ((w.ist_eroeffnungsbestand = true) AND (w.behaelter_id IS NOT NULL))
          GROUP BY w.behaelter_id, w.tenant_id
        ), zukauf_ein AS (
         SELECT wa.behaelter_id,
            wa.tenant_id,
            sum(zp.menge) AS liter
           FROM (zukauf_posten zp
             JOIN weinausbau wa ON ((wa.id = zp.ziel_weinausbau_id)))
          WHERE ((zp.aktiv = true) AND (zp.storniert_am IS NULL) AND (zp.art = ANY (ARRAY['wein'::text, 'most'::text])) AND (zp.ziel_weinausbau_id IS NOT NULL) AND (wa.behaelter_id IS NOT NULL))
          GROUP BY wa.behaelter_id, wa.tenant_id
        ), pressungen_ein AS (
         SELECT pb.behaelter_id,
            p_1.tenant_id,
            sum(COALESCE(pb.menge_liter, wa.menge_liter, (0)::numeric)) AS liter
           FROM ((pressung_behaelter pb
             JOIN pressungen p_1 ON ((p_1.id = pb.pressung_id)))
             LEFT JOIN weinausbau wa ON ((wa.id = pb.weinausbau_id)))
          WHERE (pb.behaelter_id IS NOT NULL)
          GROUP BY pb.behaelter_id, p_1.tenant_id
        ), umzuege_ein AS (
         SELECT ku.nach_behaelter_id AS behaelter_id,
            ku.tenant_id,
            sum(
                CASE
                    WHEN (ku.brutto_liter IS NOT NULL) THEN ku.menge_liter
                    ELSE GREATEST((0)::numeric, (ku.menge_liter - COALESCE(ku.schwund_liter, (0)::numeric)))
                END) AS liter
           FROM keller_umzuege ku
          WHERE ((ku.nach_behaelter_id IS NOT NULL) AND (ku.storniert_am IS NULL))
          GROUP BY ku.nach_behaelter_id, ku.tenant_id
        ), umzuege_aus AS (
         SELECT ck.behaelter_id,
            ku.tenant_id,
            sum(
                CASE
                    WHEN (ku.zeilen_typ = 'quelle'::text) THEN ku.menge_liter
                    ELSE COALESCE(ku.brutto_liter, ku.menge_liter)
                END) AS liter
           FROM (keller_umzuege ku
             JOIN charge_kontakte ck ON ((ck.charge_id = ku.von_weinausbau_id)))
          WHERE (ku.storniert_am IS NULL)
          GROUP BY ck.behaelter_id, ku.tenant_id
        ), abfuellungen AS (
         SELECT ck.behaelter_id,
            f.tenant_id,
            sum(COALESCE(f.menge_liter_gefuellt, (((f.anzahl_flaschen)::numeric * (f.flaschengroesse_ml)::numeric) / 1000.0))) AS liter
           FROM (fuellungen f
             JOIN charge_kontakte ck ON ((ck.charge_id = f.weinausbau_id)))
          WHERE (f.storniert_am IS NULL)
          GROUP BY ck.behaelter_id, f.tenant_id
        ), verkaeufe AS (
         SELECT ck.behaelter_id,
            vs.tenant_id,
            sum(vp.menge) AS liter
           FROM ((verkauf_positionen vp
             JOIN verkaufsposten vs ON ((vs.id = vp.verkaufsposten_id)))
             JOIN charge_kontakte ck ON ((ck.charge_id = vp.weinausbau_id)))
          WHERE ((vp.typ = 'tank'::text) AND (NOT COALESCE(vs.storniert, false)))
          GROUP BY ck.behaelter_id, vs.tenant_id
        ), verschneidungen_ein AS (
         SELECT ck.behaelter_id,
            v.tenant_id,
            sum(vq.menge_liter) AS liter
           FROM ((verschneidung_quellen vq
             JOIN verschneidungen v ON ((v.id = vq.verschneidung_id)))
             JOIN charge_kontakte ck ON ((ck.charge_id = v.ziel_weinausbau_id)))
          WHERE (v.storniert_am IS NULL)
          GROUP BY ck.behaelter_id, v.tenant_id
        ), verschneidungen_aus AS (
         SELECT ck.behaelter_id,
            v.tenant_id,
            sum(vq.menge_liter) AS liter
           FROM ((verschneidung_quellen vq
             JOIN verschneidungen v ON ((v.id = vq.verschneidung_id)))
             JOIN charge_kontakte ck ON ((ck.charge_id = vq.quell_weinausbau_id)))
          WHERE (v.storniert_am IS NULL)
          GROUP BY ck.behaelter_id, v.tenant_id
        ), paare AS (
         SELECT anfangsbestand.behaelter_id,
            anfangsbestand.tenant_id
           FROM anfangsbestand
        UNION
         SELECT zukauf_ein.behaelter_id,
            zukauf_ein.tenant_id
           FROM zukauf_ein
        UNION
         SELECT pressungen_ein.behaelter_id,
            pressungen_ein.tenant_id
           FROM pressungen_ein
        UNION
         SELECT umzuege_ein.behaelter_id,
            umzuege_ein.tenant_id
           FROM umzuege_ein
        UNION
         SELECT umzuege_aus.behaelter_id,
            umzuege_aus.tenant_id
           FROM umzuege_aus
        UNION
         SELECT abfuellungen.behaelter_id,
            abfuellungen.tenant_id
           FROM abfuellungen
        UNION
         SELECT verkaeufe.behaelter_id,
            verkaeufe.tenant_id
           FROM verkaeufe
        UNION
         SELECT verschneidungen_ein.behaelter_id,
            verschneidungen_ein.tenant_id
           FROM verschneidungen_ein
        UNION
         SELECT verschneidungen_aus.behaelter_id,
            verschneidungen_aus.tenant_id
           FROM verschneidungen_aus
        UNION
         SELECT b.id,
            b.tenant_id
           FROM behaelter b
        )
 SELECT p.behaelter_id,
    p.tenant_id,
    round(((((((((COALESCE(ab.liter, (0)::numeric) + COALESCE(zk.liter, (0)::numeric)) + COALESCE(pr.liter, (0)::numeric)) + COALESCE(ue.liter, (0)::numeric)) + COALESCE(vi.liter, (0)::numeric)) - COALESCE(ua.liter, (0)::numeric)) - COALESCE(af.liter, (0)::numeric)) - COALESCE(vk.liter, (0)::numeric)) - COALESCE(vo.liter, (0)::numeric)), 2) AS liter_aktuell
   FROM (((((((((paare p
     LEFT JOIN anfangsbestand ab ON (((ab.behaelter_id = p.behaelter_id) AND (ab.tenant_id = p.tenant_id))))
     LEFT JOIN zukauf_ein zk ON (((zk.behaelter_id = p.behaelter_id) AND (zk.tenant_id = p.tenant_id))))
     LEFT JOIN pressungen_ein pr ON (((pr.behaelter_id = p.behaelter_id) AND (pr.tenant_id = p.tenant_id))))
     LEFT JOIN umzuege_ein ue ON (((ue.behaelter_id = p.behaelter_id) AND (ue.tenant_id = p.tenant_id))))
     LEFT JOIN umzuege_aus ua ON (((ua.behaelter_id = p.behaelter_id) AND (ua.tenant_id = p.tenant_id))))
     LEFT JOIN abfuellungen af ON (((af.behaelter_id = p.behaelter_id) AND (af.tenant_id = p.tenant_id))))
     LEFT JOIN verkaeufe vk ON (((vk.behaelter_id = p.behaelter_id) AND (vk.tenant_id = p.tenant_id))))
     LEFT JOIN verschneidungen_ein vi ON (((vi.behaelter_id = p.behaelter_id) AND (vi.tenant_id = p.tenant_id))))
     LEFT JOIN verschneidungen_aus vo ON (((vo.behaelter_id = p.behaelter_id) AND (vo.tenant_id = p.tenant_id))));

-- Selbstprüfung: security_invoker bleibt, Sicht filtert den Storno
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.v_behaelter_fuellstand'::regclass
                  AND 'security_invoker=true' = ANY (c.reloptions)) THEN
    RAISE EXCEPTION 'KAN-145 B2: v_behaelter_fuellstand ohne security_invoker';
  END IF;
  IF pg_get_viewdef('public.v_behaelter_fuellstand'::regclass) NOT LIKE '%storniert_am IS NULL%' THEN
    RAISE EXCEPTION 'KAN-145 B2: v_behaelter_fuellstand filtert stornierte Buchungen nicht';
  END IF;
END $$;
