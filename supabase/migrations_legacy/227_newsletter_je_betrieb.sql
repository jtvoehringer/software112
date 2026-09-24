-- 227 – Newsletter je Betrieb (23.9.2026)
-- Öffentliche Anmeldeseite /newsletter/<kurzname> statt einer fest auf einen Betrieb
-- verdrahteten Seite. Kurzname, Datenschutz-Link und Einleitungstext je Betrieb.
-- Brevo-Zugang (API-Key, Absender, Listen) lag schon je Betrieb in tenant_einstellungen,
-- wurde aber nicht verwendet; der API-Key wird ab jetzt verschlüsselt gespeichert (App).

alter table public.tenant_einstellungen
  add column if not exists newsletter_kurzname        text,
  add column if not exists newsletter_datenschutz_url text,
  add column if not exists newsletter_einleitung      text;

-- Kurzname: klein, a–z/0–9/Bindestrich, 2–40 Zeichen, keine reservierten Unterseiten
alter table public.tenant_einstellungen
  drop constraint if exists tenant_einstellungen_newsletter_kurzname_check;
alter table public.tenant_einstellungen
  add constraint tenant_einstellungen_newsletter_kurzname_check
  check (
    newsletter_kurzname is null
    or (newsletter_kurzname ~ '^[a-z0-9][a-z0-9-]{1,39}$'
        and newsletter_kurzname not in ('bestaetigt', 'abmelden', 'anmelden', 'admin', 'api'))
  );

create unique index if not exists tenant_einstellungen_newsletter_kurzname_uidx
  on public.tenant_einstellungen (newsletter_kurzname)
  where newsletter_kurzname is not null;

alter table public.tenant_einstellungen
  drop constraint if exists tenant_einstellungen_newsletter_datenschutz_url_check;
alter table public.tenant_einstellungen
  add constraint tenant_einstellungen_newsletter_datenschutz_url_check
  check (newsletter_datenschutz_url is null or newsletter_datenschutz_url ~ '^https://');

-- Bestätigungslinks werden jetzt ohne festen Betrieb über das Token gefunden
create index if not exists kontakte_newsletter_token_idx
  on public.kontakte (newsletter_token)
  where newsletter_token is not null;

comment on column public.tenant_einstellungen.newsletter_kurzname is
  'Öffentliche Adresse der Newsletter-Anmeldung: /newsletter/<kurzname> (Migration 227)';
