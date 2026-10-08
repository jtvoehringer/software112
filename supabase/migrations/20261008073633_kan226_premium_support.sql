-- KAN-226 (08.10.2026): Premium-Support als Zusatzpaket – Kennzeichen am Betrieb.
--  tenants.premium_support_seit: erster Tag mit Premium-Support (NULL = nicht gebucht)
--  tenants.premium_support_bis:  letzter Tag mit Premium-Support (NULL = unbefristet; Kündigung → Monatsende)
-- Bis Stripe steht (KAN-11) setzt der Plattform-Admin die Daten in Administration → Mandanten, danach der Webhook.
-- Schreiben nur Service-Role/Plattform-Admins: Der Trigger a_schutz_plattformfelder lässt Benutzern auf tenants nur
-- bio_status/updated_at durch – die neuen Spalten sind damit automatisch geschützt. Lesen wie die übrigen Spalten
-- (Mitglieder sehen ihre Betriebe). Regeln der App: src/lib/abo/premiumSupport.ts. DB-Test 67.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

ALTER TABLE public.tenants
  ADD COLUMN premium_support_seit date,
  ADD COLUMN premium_support_bis date,
  ADD CONSTRAINT tenants_premium_support_chk CHECK (
    premium_support_bis IS NULL OR (premium_support_seit IS NOT NULL AND premium_support_bis >= premium_support_seit)
  );
COMMENT ON COLUMN public.tenants.premium_support_seit IS 'KAN-226: erster Tag mit Premium-Support (79 € netto/Monat); NULL = nicht gebucht – nur Plattform-Admins/Service-Role';
COMMENT ON COLUMN public.tenants.premium_support_bis IS 'KAN-226: letzter Tag mit Premium-Support (inklusive); NULL = unbefristet – nur Plattform-Admins/Service-Role';

-- Rollback (nur falls nötig):
--   ALTER TABLE public.tenants DROP CONSTRAINT tenants_premium_support_chk,
--     DROP COLUMN premium_support_bis, DROP COLUMN premium_support_seit;
