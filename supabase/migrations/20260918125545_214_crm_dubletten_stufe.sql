-- Migration 214 (18.9.2026): Dubletten einstufen – sicher / prüfen / unwahrscheinlich
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION crm_dubletten_paar(p_art text, a jsonb, b jsonb)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  av text := crm_norm_name(a->>'vorname');  an text := crm_norm_name(a->>'nachname');
  bv text := crm_norm_name(b->>'vorname');  bn text := crm_norm_name(b->>'nachname');
  af text := av || an;  bf text := bv || bn;
  ag text := an || av;  bg text := bn || bv;
  ae text := lower(trim(coalesce(a->>'email','')));
  be text := lower(trim(coalesce(b->>'email','')));
  ad text := split_part(ae, '@', 2);  bd text := split_part(be, '@', 2);
  namen_gleich boolean;
  nachname_gleich boolean;
BEGIN
  namen_gleich :=
       (af <> '' AND (af = bf OR af = bg OR ag = bf))
    OR (an <> '' AND an = bn AND (av = '' OR bv = ''))
    OR (an <> '' AND an = bn AND av <> '' AND bv <> '' AND (left(av,1) = left(bv,1)) AND (length(av) = 1 OR length(bv) = 1))
    OR (an <> '' AND an = bn AND av <> '' AND bv <> '' AND extensions.levenshtein(av, bv) <= 2)
    OR (af <> '' AND bf <> '' AND extensions.levenshtein(af, bf) <= 2)
    OR (af <> '' AND bf <> '' AND (position(af IN bf) > 0 OR position(bf IN af) > 0) AND least(length(af), length(bf)) >= 6);
  nachname_gleich := an <> '' AND (an = bn OR (bn <> '' AND extensions.levenshtein(an, bn) <= 1));

  IF p_art = 'email' THEN
    IF namen_gleich THEN RETURN 3; END IF;
    IF nachname_gleich THEN RETURN 2; END IF;
    RETURN 1;
  END IF;

  IF (ae <> '' AND ae = be)
     OR (ad <> '' AND ad = bd)
     OR (nullif(trim(coalesce(a->>'plz','')),'') IS NOT NULL AND trim(coalesce(a->>'plz','')) = trim(coalesce(b->>'plz','')))
     OR (nullif(crm_norm_name(a->>'ort'),'') IS NOT NULL AND crm_norm_name(a->>'ort') = crm_norm_name(b->>'ort'))
     OR (nullif(regexp_replace(coalesce(a->>'telefon',''), '[^0-9]', '', 'g'),'') IS NOT NULL
         AND regexp_replace(coalesce(a->>'telefon',''), '[^0-9]', '', 'g') = regexp_replace(coalesce(b->>'telefon',''), '[^0-9]', '', 'g'))
  THEN RETURN 3; END IF;
  RETURN 2;
END $$;

CREATE OR REPLACE FUNCTION crm_dubletten_stufe(p_art text, p_kontakte jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE max(crm_dubletten_paar(p_art, p_kontakte->0, k))
           WHEN 3 THEN 'sicher' WHEN 2 THEN 'pruefen' ELSE 'unwahrscheinlich' END
  FROM jsonb_array_elements(p_kontakte) WITH ORDINALITY AS t(k, i)
  WHERE i > 1
$$;

DROP FUNCTION IF EXISTS crm_dubletten(uuid);
CREATE OR REPLACE FUNCTION crm_dubletten(p_tenant_id uuid)
RETURNS TABLE (art text, schluessel text, anzahl int, stufe text, kontakte jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ok AS (
    SELECT session_user = 'postgres'
        OR COALESCE(auth.jwt() ->> 'role','') = 'service_role'
        OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv) AS darf
  ),
  k AS (
    SELECT k.id, k.accountnummer, k.vorname, k.nachname, k.email, k.email_weitere, k.plz, k.ort, k.telefon, k.is_lead, k.erstellt_am, k.firma_id,
           (SELECT count(*) FROM aktivitaeten a WHERE a.kontakt_id = k.id) AS anz_aktivitaeten,
           (SELECT count(*) FROM verkaufsposten v WHERE v.kontakt_id = k.id) AS anz_verkaeufe
    FROM kontakte k, ok
    WHERE ok.darf AND k.tenant_id = p_tenant_id AND k.aktiv
  ),
  adressen AS (
    SELECT id, lower(trim(email)) AS e FROM k WHERE email IS NOT NULL AND trim(email) <> ''
    UNION
    SELECT k.id, lower(trim(w)) FROM k, unnest(k.email_weitere) AS w WHERE trim(w) <> ''
  ),
  schluessel AS (
    SELECT 'email' AS art, 'm:' || e AS schluessel, id FROM adressen
    UNION
    SELECT 'name', 'n:' || crm_norm_name(vorname) || '|' || crm_norm_name(nachname), id FROM k
     WHERE crm_norm_name(vorname) <> '' AND crm_norm_name(nachname) <> ''
  ),
  gruppen AS (
    SELECT s.art, s.schluessel, array_agg(DISTINCT s.id ORDER BY s.id) AS ids
    FROM schluessel s
    GROUP BY s.art, s.schluessel
    HAVING count(DISTINCT s.id) > 1
  ),
  gruppen2 AS (
    SELECT g.* FROM gruppen g
    WHERE g.art = 'email'
       OR NOT EXISTS (SELECT 1 FROM gruppen e WHERE e.art = 'email' AND e.ids = g.ids)
  ),
  mit_kontakten AS (
    SELECT g.art, g.schluessel, array_length(g.ids, 1) AS anzahl,
           (SELECT jsonb_agg(jsonb_build_object(
                'id', k.id, 'accountnummer', k.accountnummer, 'vorname', k.vorname, 'nachname', k.nachname,
                'email', k.email, 'email_weitere', to_jsonb(k.email_weitere), 'plz', k.plz, 'ort', k.ort, 'telefon', k.telefon,
                'is_lead', k.is_lead, 'erstellt_am', k.erstellt_am, 'firma_id', k.firma_id,
                'anz_aktivitaeten', k.anz_aktivitaeten, 'anz_verkaeufe', k.anz_verkaeufe)
              ORDER BY k.anz_verkaeufe DESC, k.anz_aktivitaeten DESC, k.erstellt_am)
            FROM k WHERE k.id = ANY (g.ids)) AS kontakte
    FROM gruppen2 g
    WHERE NOT EXISTS (SELECT 1 FROM crm_dubletten_ignoriert i WHERE i.tenant_id = p_tenant_id AND i.schluessel = g.schluessel)
  )
  SELECT m.art, m.schluessel, m.anzahl, crm_dubletten_stufe(m.art, m.kontakte) AS stufe, m.kontakte
  FROM mit_kontakten m
  ORDER BY CASE crm_dubletten_stufe(m.art, m.kontakte) WHEN 'sicher' THEN 0 WHEN 'pruefen' THEN 1 ELSE 2 END, m.art, m.schluessel
$$;
GRANT EXECUTE ON FUNCTION crm_dubletten(uuid) TO authenticated, service_role;;
