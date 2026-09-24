-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 027: Verkauf-Stornierung + Kundennummern
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Verkaufsposten: Stornierung ───────────────────────────────────────────

alter table verkaufsposten
  add column if not exists storniert    boolean     not null default false,
  add column if not exists storniert_am timestamptz;

-- ── 2. CRM Aktivitäten: 'verkauf' als erlaubte Art ergänzen ─────────────────

alter table aktivitaeten
  drop constraint if exists aktivitaeten_art_check;

alter table aktivitaeten
  add constraint aktivitaeten_art_check
  check (art in ('notiz','anruf','email','verkostung','messe','besuch','angebot','verkauf','sonstiges'));

-- ── 3. Kundennummer in kontakte + firmen ─────────────────────────────────────

alter table kontakte
  add column if not exists kundennummer text;

alter table firmen
  add column if not exists kundennummer text;

create unique index if not exists idx_kontakte_kundennummer
  on kontakte(tenant_id, kundennummer) where kundennummer is not null;

create unique index if not exists idx_firmen_kundennummer
  on firmen(tenant_id, kundennummer) where kundennummer is not null;

-- ── 4. Tenant-Einstellungen: Kundennummer-Zähler ────────────────────────────

alter table tenant_einstellungen
  add column if not exists kunden_prefix   text    not null default 'K',
  add column if not exists kunden_zaehler  integer not null default 1,
  add column if not exists kunden_stellen  integer not null default 4;

-- ── 5. Atomische Funktion: Nächste Kundennummer ──────────────────────────────

create or replace function get_next_kundennummer(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix   text;
  v_stellen  integer;
  v_zaehler  integer;
begin
  update tenant_einstellungen
  set    kunden_zaehler = kunden_zaehler + 1
  where  tenant_id = p_tenant_id
  returning
    kunden_prefix,
    kunden_stellen,
    kunden_zaehler - 1
  into v_prefix, v_stellen, v_zaehler;

  if not found then
    return null;
  end if;

  return v_prefix || '-' || lpad(v_zaehler::text, v_stellen, '0');
end;
$$;

revoke all    on function get_next_kundennummer(uuid) from public;
grant  execute on function get_next_kundennummer(uuid) to authenticated;
