-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 159: Ersten echten Mandanten anlegen - Weingut Johannes Gebeshuber
-- ═══════════════════════════════════════════════════════════════════════════
-- WICHTIG: Dies ist eine EINMALIGE Schema- + Daten-Migration, kein wiederholbares
-- reines Schema-Update. Bitte NUR EINMAL manuell im Supabase SQL-Editor ausführen.
-- Läuft komplett in einer Transaktion - schlägt ein Teil fehl, wird alles
-- zurückgerollt (kein halb angelegter Mandant).
--
-- Inhalt:
-- 1. Schema (gilt automatisch für ALLE Mandanten, auch künftige):
--    tenant_memberships.aktiv - Mitgliedschaft de-/aktivierbar, ohne sie zu
--    löschen. Die drei zentralen RLS-Hilfsfunktionen werden angepasst, damit
--    eine inaktive Mitgliedschaft app-weit wie "kein Zugriff" zählt. Die
--    UI dazu (Toggle in der Benutzerverwaltung /benutzer) kommt über den
--    separaten Code-Commit "commit-mitgliedschaft-aktiv-toggle.ps1".
-- 2. Neuen Mandanten "Weingut Johannes Gebeshuber" anlegen.
-- 3. tenant_einstellungen: NUR Modul-Toggles + Rechnungsnummern-/USt-Schema
--    von der Sandbox übernehmen. Bewusst NICHT übernommen: Branding, sowie
--    JEDE Art von Zugangsdaten/Secrets (Brevo, M365, SMTP/IMAP, SumUp,
--    bawb.at) - das sind Sandbox-Testwerte und gehören nicht ungeprüft in
--    einen echten Kunden-Mandanten.
-- 4. jv@icp-consultants.at als system_admin im neuen Mandanten hinterlegen
--    (aktiv, kann vom Betriebsleiter/tenant_admin über /benutzer jederzeit
--    de-/reaktiviert werden - siehe Punkt 1).
-- 5. Sonderfall: Rieden (lagen) + die zugehörigen Weingarten-Datensätze +
--    deren GST-Nummern (grundstuecke) + Rebsorten-Zuordnungen
--    (weingarten_rebsorten) werden 1:1 von der Sandbox übernommen (neue IDs,
--    identische Fachdaten). GST hängt technisch zwingend an einem Weingarten
--    (FK not null) - daher müssen die Weingarten als Träger mitkommen, das
--    ist hier bewusst so gewollt. ALLE ÜBRIGEN Stammdaten (Firmen, Kontakte,
--    PSM/Düngemittel-Lager, Fässer/Behälter, Preislisten, ...) werden NICHT
--    übernommen, Bewegungsdaten (Verkäufe, Behandlungen, Kellerbuch, ...)
--    schon gar nicht.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1a. Schema: tenant_memberships.aktiv ────────────────────────────────────
alter table tenant_memberships
  add column if not exists aktiv boolean not null default true;

comment on column tenant_memberships.aktiv is
  'false = Zugriff auf diesen Mandanten gesperrt (Mitgliedschaft bleibt erhalten, wird aber wie "kein Zugriff" behandelt) - de-/aktivierbar über /benutzer durch tenant_admin oder system_admin';

-- ─── 1b. Zentrale RLS-Hilfsfunktionen: inaktive Mitgliedschaft = kein Zugriff ─
-- Diese drei Funktionen werden von praktisch allen RLS-Policies im gesamten
-- System verwendet - eine Änderung hier wirkt sofort und einheitlich überall
-- (auch für alle künftigen Mandanten, siehe Punkt 6 der Anfrage).

create or replace function get_user_tenant_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select tenant_id
  from tenant_memberships
  where user_id = auth.uid()
    and aktiv   = true
$$;

create or replace function get_user_role_in_tenant(p_tenant_id uuid)
returns text
language sql
security definer
stable
as $$
  select role
  from tenant_memberships
  where user_id     = auth.uid()
    and tenant_id   = p_tenant_id
    and aktiv       = true
  limit 1
$$;

create or replace function user_has_role_in_tenant(
  p_tenant_id uuid,
  p_roles     text[]
)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from tenant_memberships
    where user_id   = auth.uid()
      and tenant_id = p_tenant_id
      and role      = any(p_roles)
      and aktiv     = true
  )
$$;

-- ─── 2.-5. Mandant anlegen + Daten übernehmen ────────────────────────────────
do $$
declare
  v_sandbox_id uuid;
  v_new_id     uuid;
  v_user_id    uuid;
begin
  -- Sandbox-Tenant ermitteln
  select id into v_sandbox_id from tenants where name = 'Sandbox';
  if v_sandbox_id is null then
    raise exception 'Sandbox-Mandant nicht gefunden (tenants.name = ''Sandbox'') - Migration abgebrochen.';
  end if;

  -- Ziel-User ermitteln (Jörgen)
  select id into v_user_id from auth.users where email = 'jv@icp-consultants.at';
  if v_user_id is null then
    raise exception 'User jv@icp-consultants.at nicht in auth.users gefunden - Migration abgebrochen.';
  end if;

  -- ── 2. Neuen Mandanten anlegen ──────────────────────────────────────────────
  insert into tenants (name, slug)
  values (
    'Weingut Johannes Gebeshuber',
    'weingut-johannes-gebeshuber-' || extract(epoch from now())::bigint
  )
  returning id into v_new_id;

  raise notice 'Neuer Mandant "Weingut Johannes Gebeshuber" angelegt, id=%', v_new_id;

  -- ── 3. tenant_einstellungen: nur Module + Rechnungs-/USt-Schema ────────────
  insert into tenant_einstellungen (
    tenant_id, modul_newsletter, modul_crm, modul_kellerbuch, modul_weingarten,
    modul_ea, modul_sumup, modul_export, assistent_aktiv,
    rechnung_prefix, rechnung_stellen, kunden_prefix, kunden_stellen, ust_satz_standard
  )
  select
    v_new_id, modul_newsletter, modul_crm, modul_kellerbuch, modul_weingarten,
    modul_ea, modul_sumup, modul_export, assistent_aktiv,
    rechnung_prefix, rechnung_stellen, kunden_prefix, kunden_stellen, ust_satz_standard
  from tenant_einstellungen
  where tenant_id = v_sandbox_id;

  -- Falls die Sandbox noch gar keine tenant_einstellungen-Zeile hat (sollte
  -- nicht vorkommen, aber zur Sicherheit): leere Zeile mit Defaults anlegen,
  -- damit der neue Mandant trotzdem eine tenant_einstellungen-Zeile hat.
  insert into tenant_einstellungen (tenant_id)
  select v_new_id
  where not exists (select 1 from tenant_einstellungen where tenant_id = v_new_id);

  -- ── 4. jv@icp-consultants.at als system_admin hinterlegen ──────────────────
  insert into tenant_memberships (tenant_id, user_id, role, aktiv)
  values (v_new_id, v_user_id, 'system_admin', true);

  -- ── 5. Rieden (lagen) + Weingärten + GST + Rebsorten-Zuordnung kopieren ────
  create temporary table _map_lage (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temporary table _map_weingarten (old_id uuid primary key, new_id uuid not null) on commit drop;

  -- Neue IDs für alle Sandbox-Rieden vorab generieren
  insert into _map_lage (old_id, new_id)
  select id, gen_random_uuid() from lagen where tenant_id = v_sandbox_id;

  insert into lagen (id, tenant_id, name, gemeinde, weinbaugebiet, notizen, created_at, updated_at)
  select m.new_id, v_new_id, l.name, l.gemeinde, l.weinbaugebiet, l.notizen, now(), now()
  from lagen l
  join _map_lage m on m.old_id = l.id;

  raise notice '% Rieden kopiert', (select count(*) from _map_lage);

  -- Neue IDs für alle Sandbox-Weingärten vorab generieren
  insert into _map_weingarten (old_id, new_id)
  select id, gen_random_uuid() from weingarten where tenant_id = v_sandbox_id;

  insert into weingarten (
    id, tenant_id, name, ried, flaeche_ha, rebsorte, pflanzjahr, bewirtschaftung,
    notizen, aktiv, created_at, updated_at, fs_nr, gemeinde, weinbaugebiet,
    lage_id, weinart, trauben_verkauf, trauben_herkunft_code, nachhaltig_austria,
    bewirtschaftung_seit
  )
  select
    mw.new_id, v_new_id, w.name, w.ried, w.flaeche_ha, w.rebsorte, w.pflanzjahr,
    w.bewirtschaftung, w.notizen, w.aktiv, now(), now(), w.fs_nr, w.gemeinde,
    w.weinbaugebiet, ml.new_id, w.weinart, w.trauben_verkauf, w.trauben_herkunft_code,
    w.nachhaltig_austria, w.bewirtschaftung_seit
  from weingarten w
  join _map_weingarten mw on mw.old_id = w.id
  left join _map_lage   ml on ml.old_id = w.lage_id;

  raise notice '% Weingärten kopiert', (select count(*) from _map_weingarten);

  -- GST-Nummern (grundstuecke) - rebsorte_id verweist auf die globale
  -- rebsorten-Lookup-Tabelle (kein tenant_id), braucht kein Remapping.
  insert into grundstuecke (
    id, tenant_id, weingarten_id, gst_nr, katastralgemeinde, einlagezahl,
    rebsorte, rebsorte_id, pflanzjahr, flaeche_ha, spritzbar, notizen,
    created_at, updated_at, status, flaeche_ha_kataster, trauben_herkunft_code,
    weinart, bewirtschaftung, bewirtschaftung_seit, ama_feldnummer,
    kg_bezeichnung, boden, rechtsverhaeltnis, unterlagsrebe
  )
  select
    gen_random_uuid(), v_new_id, mw.new_id, g.gst_nr, g.katastralgemeinde,
    g.einlagezahl, g.rebsorte, g.rebsorte_id, g.pflanzjahr, g.flaeche_ha,
    g.spritzbar, g.notizen, now(), now(), g.status, g.flaeche_ha_kataster,
    g.trauben_herkunft_code, g.weinart, g.bewirtschaftung, g.bewirtschaftung_seit,
    g.ama_feldnummer, g.kg_bezeichnung, g.boden, g.rechtsverhaeltnis, g.unterlagsrebe
  from grundstuecke g
  join _map_weingarten mw on mw.old_id = g.weingarten_id
  where g.tenant_id = v_sandbox_id;

  raise notice '% GST-Nummern kopiert', (
    select count(*) from grundstuecke where tenant_id = v_new_id
  );

  -- Rebsorten-Zusammensetzung je Weingarten (weingarten_rebsorten hat kein
  -- eigenes tenant_id - Tenant-Zuordnung läuft über weingarten_id)
  insert into weingarten_rebsorten (
    id, weingarten_id, rebsorte_id, anteil_pct, pflanzjahr, stock_anzahl,
    klon, unterlage, reihenabstand_m, stockabstand_m, created_at
  )
  select
    gen_random_uuid(), mw.new_id, wr.rebsorte_id, wr.anteil_pct, wr.pflanzjahr,
    wr.stock_anzahl, wr.klon, wr.unterlage, wr.reihenabstand_m, wr.stockabstand_m, now()
  from weingarten_rebsorten wr
  join _map_weingarten mw on mw.old_id = wr.weingarten_id;

  raise notice 'Migration abgeschlossen für Mandant %', v_new_id;
end $$;

commit;
