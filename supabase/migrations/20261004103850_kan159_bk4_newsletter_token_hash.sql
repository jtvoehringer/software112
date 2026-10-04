-- KAN-159 BK4 (04.10.2026): kontakte.newsletter_token war für alle Mitglieder des Betriebs lesbar. Mit dem
-- Klartext ließe sich die Double-Opt-in-Anmeldung im Namen des Kontakts bestätigen (DSGVO-Nachweis).
-- Ab jetzt steht in der Spalte nur der SHA-256-Hash (hex); den Klartext kennt nur der Link in der E-Mail.
-- Die App (src/app/newsletter/actions.ts, src/lib/newsletter/token.ts) schreibt und sucht per Service-Role
-- über den Hash. Offene Tokens werden umgerechnet, damit verschickte Links gültig bleiben (Stand 04.10.2026: 0).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion – direkt vor dem Merge der App-Änderung.

ALTER TABLE public.kontakte RENAME COLUMN newsletter_token TO newsletter_token_hash;

UPDATE public.kontakte
   SET newsletter_token_hash = encode(sha256(convert_to(newsletter_token_hash, 'UTF8')), 'hex')
 WHERE newsletter_token_hash IS NOT NULL;

COMMENT ON COLUMN public.kontakte.newsletter_token_hash IS
  'SHA-256 (hex) des Double-Opt-in-Tokens; der Klartext steht nur im Bestätigungslink (KAN-159 BK4)';
