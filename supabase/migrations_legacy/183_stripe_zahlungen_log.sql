-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 183 – Stripe-Zahlungen-Log für Hohenstein-Suite-Sync
-- Rückmeldung 31.8.2026: "wir müssten unsere Stripe Implementierung noch
-- einbauen... ich frag mich ob wir das Zahlungstracking nicht in die
-- Hohenstein Suite übernehmen können und bei den Kunden im E&A Modul
-- anhängen" - bei 200 Mandanten ist manuelles Nachschauen im Admin-Bereich
-- keine Buchhaltung mehr. Statt Stripe-Zugangsdaten mit der Hohenstein Suite
-- zu teilen, protokolliert der bestehende Webhook (api/stripe/webhook/route.ts)
-- jede erfolgreiche Zahlung hier. Die Hohenstein Suite hat bereits per
-- Service-Role Lesezugriff auf dieses Projekt (src/lib/s112/admin.ts, bisher
-- nur für den Demo-Mandanten genutzt) und holt sich neue Zeilen von hier ab,
-- um sie automatisch als E&A-Einnahme zu verbuchen. Rein additiv/protokollierend
-- - kein Tenant-Zugriff, keine RLS-Policies (nur service_role liest/schreibt).
-- ─────────────────────────────────────────────────────────────────────────────

create table stripe_zahlungen_log (
  id                      uuid        primary key default gen_random_uuid(),
  tenant_id               uuid        not null references tenants(id) on delete cascade,
  stripe_invoice_id       text        not null unique,
  stripe_customer_id      text        not null,
  stripe_subscription_id  text,
  stripe_plan             text,
  betrag_brutto           numeric(10,2) not null check (betrag_brutto >= 0),
  waehrung                text        not null default 'eur',
  periode_start           timestamptz,
  periode_ende            timestamptz,
  bezahlt_am              timestamptz not null,
  -- Wird von der Hohenstein Suite gesetzt, nachdem die Zahlung als
  -- E&A-Einnahme verbucht wurde (Idempotenz für den Abhol-Vorgang).
  hs_verbucht_am          timestamptz,
  erstellt_am             timestamptz not null default now()
);
comment on table stripe_zahlungen_log is 'Protokoll erfolgreicher Stripe-Zahlungen (Plattform-Abo) für den Abgleich mit der Hohenstein Suite (E&A-Buchung).';

create index idx_stripe_zlog_tenant     on stripe_zahlungen_log(tenant_id, bezahlt_am desc);
create index idx_stripe_zlog_unverbucht on stripe_zahlungen_log(bezahlt_am) where hs_verbucht_am is null;

-- Keine RLS-Policies: Tabelle ist ausschließlich für service_role gedacht
-- (Webhook schreibt, Hohenstein Suite liest/markiert) - RLS aktiv = Default-Deny
-- für anon/authenticated, service_role umgeht RLS ohnehin.
alter table stripe_zahlungen_log enable row level security;
