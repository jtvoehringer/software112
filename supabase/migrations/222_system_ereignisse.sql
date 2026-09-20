-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 222: Systemereignisse (Grundlage des täglichen Systemberichts)
--
-- Sweep 20.9.2026: Fehler passierten tagelang unbemerkt (Demo-Reset, stille
-- Schreibaufrufe, maskierte Action-Fehler). Ab jetzt landen hier zentral:
--   server  – jeder nicht gefangene Serverfehler (Next.js onRequestError in
--             src/instrumentation.ts: Server Components, Actions, Route Handler)
--   client  – Fehlergrenze im Browser ((dashboard)/error.tsx → /api/system/ereignis)
--   cron    – Ergebnis der täglichen Läufe (Daueraufträge, E-Mail-Spiegel,
--             Morgenberichte, Demo-Reset) inkl. Fehlern je Betrieb
--   db      – von Datenbankseite gemeldete Fehler (z.B. Demo-Reset-Trigger)
--
-- Nur der Admin-Client (Service-Role) schreibt und liest – keine Policies für
-- authenticated. Anzeige: /admin/system (Super-Admin), Morgenbericht Sandbox.
-- Aufbewahrung 30 Tage (Bereinigung im täglichen Cron).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.system_ereignisse (
  id          bigint generated always as identity primary key,
  erstellt_am timestamptz not null default now(),
  art         text not null check (art in ('server', 'client', 'cron', 'db')),
  quelle      text not null,
  meldung     text not null,
  digest      text,
  tenant_id   uuid,
  user_id     uuid,
  details     jsonb
);

create index if not exists system_ereignisse_erstellt_idx on public.system_ereignisse (erstellt_am desc);

alter table public.system_ereignisse enable row level security;
-- bewusst keine Policies: nur service_role (Admin-Client)

comment on table public.system_ereignisse is 'Zentrales Fehler-/Ereignisprotokoll (Migration 222), nur Service-Role, 30 Tage';
