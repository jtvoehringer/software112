-- Migration 090: RPC für behandlung_grundstuecke-Lookup
-- Umgeht RLS-Subquery-Problem bei direktem Tabellenzugriff.
-- Läuft als security definer und prüft Tenant-Zugehörigkeit selbst.

create or replace function get_behandlungen_fuer_grundstuecke(
  p_grundstueck_ids uuid[],
  p_tenant_id       uuid
)
returns table (
  behandlung_id        uuid,
  datum                date,
  art                  text,
  psm_name             text,
  aufwandmenge         numeric,
  aufwandmenge_einheit text,
  bbch_stadium         text,
  schaderreger         text,
  notizen              text,
  weingarten_name      text
)
language sql
security definer
stable
as $$
  select distinct
    b.id                  as behandlung_id,
    b.datum,
    b.art,
    psm.name              as psm_name,
    b.aufwandmenge,
    b.aufwandmenge_einheit,
    b.bbch_stadium,
    b.schaderreger,
    b.notizen,
    wg.name               as weingarten_name
  from behandlung_grundstuecke bg
  join behandlungen b       on b.id  = bg.behandlung_id
  left join pflanzenschutzmittel psm on psm.id = b.psm_id
  left join weingarten wg   on wg.id = b.weingarten_id
  where bg.grundstueck_id = any(p_grundstueck_ids)
    and b.tenant_id = p_tenant_id
    and p_tenant_id in (select get_user_tenant_ids())
  order by b.datum
$$;

grant execute on function get_behandlungen_fuer_grundstuecke(uuid[], uuid) to authenticated;
