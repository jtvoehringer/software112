-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026: Laufende Rechnungsnummer + Trigger-Fix Preislisten
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trigger-Fix: update_updated_at() setzt NEW.updated_at, aber
--       preislisten / preislisten_positionen haben die Spalte aktualisiert_am.
--       → Trigger droppen, neue Funktion + Trigger anlegen. ─────────────────

drop trigger if exists preislisten_updated_at           on preislisten;
drop trigger if exists preislisten_positionen_updated_at on preislisten_positionen;

create or replace function update_aktualisiert_am()
returns trigger
language plpgsql
as $$
begin
  new.aktualisiert_am = now();
  return new;
end;
$$;

create trigger preislisten_updated_at
  before update on preislisten
  for each row execute function update_aktualisiert_am();

create trigger preislisten_positionen_updated_at
  before update on preislisten_positionen
  for each row execute function update_aktualisiert_am();

-- ── 2. Neue Spalten in tenant_einstellungen ───────────────────────────────────

alter table tenant_einstellungen
  add column if not exists rechnung_prefix   text    not null default 'RE',
  add column if not exists rechnung_zaehler  integer not null default 1,
  add column if not exists rechnung_stellen  integer not null default 4;

-- ── 3. Atomische Funktion: Nächste Rechnungsnummer holen + Zähler erhöhen ────

create or replace function get_next_rechnungsnummer(p_tenant_id uuid)
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
  set    rechnung_zaehler = rechnung_zaehler + 1
  where  tenant_id = p_tenant_id
  returning
    rechnung_prefix,
    rechnung_stellen,
    rechnung_zaehler - 1
  into v_prefix, v_stellen, v_zaehler;

  if not found then
    return null;
  end if;

  return v_prefix || '-' || lpad(v_zaehler::text, v_stellen, '0');
end;
$$;

revoke all    on function get_next_rechnungsnummer(uuid) from public;
grant  execute on function get_next_rechnungsnummer(uuid) to authenticated;
