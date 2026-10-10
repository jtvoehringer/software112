-- KAN-287 (10.10.2026): Passkey-Anmeldung gilt als Zwei-Faktor.
-- Supabase stuft eine Passkey-Anmeldung als aal1 ein (amr-Methode „passkey“). Ein Passkey ist Gerät plus Biometrie bzw. PIN
-- und ersetzt den Code (Entscheidung Jörgen 10.10.2026). Gleiche Regel in der App: zweiFaktorErfuellt() in src/lib/auth/mfa.ts.
-- Die amr-Liste steht im signierten Zugriffstoken (auth.jwt()), Format [{"method":"passkey","timestamp":…}].

CREATE OR REPLACE FUNCTION public.s112_aal_ok() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN coalesce((SELECT auth.jwt()) ->> 'aal', 'aal1') = 'aal2' THEN true
    WHEN (SELECT auth.uid()) IS NULL THEN true
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof((SELECT auth.jwt()) -> 'amr') = 'array' THEN (SELECT auth.jwt()) -> 'amr' ELSE '[]'::jsonb END) a
      WHERE (CASE WHEN jsonb_typeof(a) = 'object' THEN a ->> 'method' ELSE a #>> '{}' END) = 'passkey'
    ) THEN true
    ELSE NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = (SELECT auth.uid()) AND f.status = 'verified')
  END
$function$;

REVOKE EXECUTE ON FUNCTION public.s112_aal_ok() FROM PUBLIC, anon;
