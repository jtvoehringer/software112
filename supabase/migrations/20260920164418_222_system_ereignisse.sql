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
comment on table public.system_ereignisse is 'Zentrales Fehler-/Ereignisprotokoll (Migration 222), nur Service-Role, 30 Tage';;
