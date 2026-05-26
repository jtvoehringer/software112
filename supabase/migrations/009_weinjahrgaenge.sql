-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009 – Weinjahrgänge & Ernte-Basiserfassung
-- Jahrgangs-Stammdaten, Ernte-Mengen je Parzelle
-- Grundlage für AMA-Erntemeldung und Kellerbuch-Verknüpfung
-- ─────────────────────────────────────────────────────────────────────────────

create table weinjahrgaenge (
  id                  uuid        primary key default uuid_generate_v4(),
  tenant_id           uuid        not null references tenants(id) on delete cascade,
  jahrgang            integer     not null check (jahrgang between 1900 and 2100),

  -- Qualitative Einschätzung
  qualitaet_gesamt    text        check (qualitaet_gesamt in (
                                    'sehr_gut', 'gut', 'durchschnittlich', 'schlecht'
                                  )),
  witterungscharakter text,       -- Freitextbeschreibung des Jahrgangs

  -- Ernte-Gesamtübersicht
  ernte_beginn        date,
  ernte_ende          date,
  gesamtertrag_kg     numeric(12,2),
  gesamtertrag_hl     numeric(12,2),

  -- AMA-Meldung
  ama_gemeldet        boolean     not null default false,
  ama_meldedatum      date,
  ama_meldungsnr      text,

  -- Status
  abgeschlossen       boolean     not null default false,
  notizen             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique(tenant_id, jahrgang)
);

comment on table weinjahrgaenge is 'Weinjahrgänge: Übersicht, Qualität, AMA-Meldung';

create trigger weinjahrgaenge_updated_at
  before update on weinjahrgaenge
  for each row execute function update_updated_at();

create index idx_weinjahrgaenge_tenant   on weinjahrgaenge(tenant_id);
create index idx_weinjahrgaenge_jahrgang on weinjahrgaenge(tenant_id, jahrgang);

-- ─── ERNTE-PARZELLEN (Ernte je Weingarten und Rebsorte) ──────────────────────
create table ernte_parzellen (
  id                  uuid        primary key default uuid_generate_v4(),
  jahrgang_id         uuid        not null references weinjahrgaenge(id) on delete cascade,
  weingarten_id       uuid        references weingarten(id) on delete set null,
  rebsorte_id         uuid        references rebsorten(id),

  ernte_datum         date,
  menge_kg            numeric(12,2),
  menge_hl            numeric(12,2),  -- umgerechnet (1 hl ≈ 130 kg)
  oechsle             numeric(5,1),   -- Mostgewicht in °Oe
  klosterneuburger    numeric(5,2),   -- KMW °KMW
  qualitaetsstufe     text        check (qualitaetsstufe in (
                                    'tafelwein', 'landwein', 'qualitaetswein',
                                    'kabinett', 'spaetlese', 'auslese',
                                    'beerenauslese', 'trockenbeerenauslese', 'eiswein'
                                  )),
  lesemethode         text        check (lesemethode in ('handlese', 'maschinenlese', 'selektionslese')),
  notizen             text,
  created_at          timestamptz not null default now()
);

comment on table ernte_parzellen is 'Ernte-Einzeldaten je Parzelle und Rebsorte';
comment on column ernte_parzellen.oechsle is 'Mostgewicht °Oe (Österreich: Klosterneuburger Mostwaage = °KMW)';

create index idx_ernte_jahrgang    on ernte_parzellen(jahrgang_id);
create index idx_ernte_weingarten  on ernte_parzellen(weingarten_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table weinjahrgaenge enable row level security;

create policy "jahrgaenge: members can select"
  on weinjahrgaenge for select
  using (tenant_id in (select get_user_tenant_ids()));

create policy "jahrgaenge: winzer+ can insert"
  on weinjahrgaenge for insert
  with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "jahrgaenge: winzer+ can update"
  on weinjahrgaenge for update
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "jahrgaenge: admin can delete"
  on weinjahrgaenge for delete
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin']));

alter table ernte_parzellen enable row level security;

create policy "ernte_parzellen: select via jahrgang"
  on ernte_parzellen for select
  using (
    jahrgang_id in (
      select id from weinjahrgaenge
      where tenant_id in (select get_user_tenant_ids())
    )
  );

create policy "ernte_parzellen: winzer+ can write"
  on ernte_parzellen for insert
  with check (
    jahrgang_id in (
      select id from weinjahrgaenge wj
      where user_has_role_in_tenant(wj.tenant_id, array['system_admin','tenant_admin','winzer'])
    )
  );

create policy "ernte_parzellen: winzer+ can update"
  on ernte_parzellen for update
  using (
    jahrgang_id in (
      select id from weinjahrgaenge wj
      where user_has_role_in_tenant(wj.tenant_id, array['system_admin','tenant_admin','winzer'])
    )
  );

create policy "ernte_parzellen: admin can delete"
  on ernte_parzellen for delete
  using (
    jahrgang_id in (
      select id from weinjahrgaenge wj
      where user_has_role_in_tenant(wj.tenant_id, array['system_admin','tenant_admin'])
    )
  );
