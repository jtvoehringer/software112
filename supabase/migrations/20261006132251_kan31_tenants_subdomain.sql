-- KAN-31 (06.10.2026): Betrieb je Tab über die Subdomain (gebeshuber.software112.icp-consultants.at …).
-- tenants.subdomain = Kurzname des Betriebs unter NEXT_PUBLIC_S112_SUBDOMAIN_BASIS. Die App liest den Betrieb aus dem
-- Host jeder Anfrage und prüft ihn gegen die eigenen aktiven Mitgliedschaften (getCurrentMembership).
-- Schreiben nur Service-Role/Plattform-Admins: Der Trigger a_schutz_plattformfelder lässt Benutzern auf tenants nur
-- bio_status/updated_at durch – die neue Spalte ist damit automatisch geschützt. Lesen wie die übrigen Spalten
-- (Mitglieder sehen ihre Betriebe). Muster und reservierte Namen = RESERVIERTE_SUBDOMAINS in src/lib/tenant/subdomain.ts.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

ALTER TABLE public.tenants ADD COLUMN subdomain text;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_subdomain_check CHECK (
  subdomain IS NULL OR (
    subdomain ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'
    AND length(subdomain) >= 2
    AND subdomain NOT IN ('www', 'app', 'api', 'admin', 'auth', 'login', 'mail', 'smtp', 'staging', 'static', 'status', 'preview')
  )
);
CREATE UNIQUE INDEX tenants_subdomain_uidx ON public.tenants (subdomain) WHERE subdomain IS NOT NULL;
COMMENT ON COLUMN public.tenants.subdomain IS
  'KAN-31: Betriebs-Subdomain unter NEXT_PUBLIC_S112_SUBDOMAIN_BASIS (z. B. gebeshuber) – nur Plattform-Admins/Service-Role';
