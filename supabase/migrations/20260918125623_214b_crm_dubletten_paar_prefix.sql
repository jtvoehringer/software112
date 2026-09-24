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
    OR (an <> '' AND an = bn AND av <> '' AND bv <> '' AND (position(av IN bv) = 1 OR position(bv IN av) = 1) AND least(length(av), length(bv)) >= 3)
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
END $$;;
