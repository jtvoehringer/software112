-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008 – Pflanzenschutz (PSM + Behandlungen)
-- Spritzmittel-Datenbank + Behandlungsprotokoll je Weingarten
-- Österreichisches Weinrecht: Wartezeiten, Zulassungsnummern, Bio-Eignung
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── PFLANZENSCHUTZMITTEL (Spritzmittel-Stammdaten) ──────────────────────────
-- Mischung: globale Basis-DB (system_admin) + tenant-eigene Mittel
create table pflanzenschutzmittel (
  id                  uuid        primary key default uuid_generate_v4(),
  tenant_id           uuid        references tenants(id) on delete cascade,
                                  -- NULL = globales Mittel (system_admin verwaltet)
  name                text        not null,
  handelsname         text,       -- z.B. "Cuprozin progress"
  wirkstoff           text,       -- z.B. "Kupferhydroxid"
  wirkstoffgehalt_pct numeric(6,3),
  zulassungsnr        text,       -- AT-Zulassungsnummer
  zulassungsgueltig   date,       -- Zulassung gültig bis
  kategorie           text        check (kategorie in (
                                    'fungizid', 'insektizid', 'herbizid',
                                    'akarizid', 'wachstumsregler', 'naehrstoff', 'sonstiges'
                                  )),
  wirkungsbereich     text[],     -- z.B. ARRAY['echter_mehltau','falscher_mehltau']
  wartezeit_tage      integer     check (wartezeit_tage >= 0),
  max_aufwand_kg_ha   numeric(8,3),
  max_anwendungen     integer,    -- max. Anwendungen pro Saison
  oeko_zugelassen     boolean     not null default false,  -- Bio/Demeter-zugelassen
  bienengefaehrlich   boolean     not null default false,
  gewaesserschutz     boolean     not null default false,  -- Gewässerschutz-Auflagen
  sicherheitsdaten_url text,      -- Link zu Sicherheitsdatenblatt
  notizen             text,
  aktiv               boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table pflanzenschutzmittel is 'Spritzmittel-Datenbank: global + tenant-eigene Mittel';
comment on column pflanzenschutzmittel.tenant_id is 'NULL = global (von system_admin verwaltet)';
comment on column pflanzenschutzmittel.wartezeit_tage is 'Mindest-Wartezeit vor Ernte in Tagen';

create trigger psm_updated_at
  before update on pflanzenschutzmittel
  for each row execute function update_updated_at();

create index idx_psm_tenant   on pflanzenschutzmittel(tenant_id);
create index idx_psm_kategorie on pflanzenschutzmittel(kategorie);
create index idx_psm_oeko     on pflanzenschutzmittel(oeko_zugelassen);

-- ─── BEHANDLUNGEN (Behandlungsprotokoll) ─────────────────────────────────────
create table behandlungen (
  id                  uuid        primary key default uuid_generate_v4(),
  tenant_id           uuid        not null references tenants(id) on delete cascade,
  weingarten_id       uuid        references weingarten(id) on delete set null,
  psm_id              uuid        references pflanzenschutzmittel(id),

  -- Zeitpunkt & Durchführung
  datum               date        not null,
  durchgefuehrt_von   uuid        references auth.users(id),  -- User-ID des Winzers
  witterung           text        check (witterung in ('sonnig','bewoelkt','regnerisch','wind')),
  temperatur_c        numeric(4,1),
  windstaerke         text        check (windstaerke in ('windstill','schwach','maessig','stark')),

  -- Mittel & Menge
  aufwandmenge        numeric(8,3),
  aufwandmenge_einheit text       check (aufwandmenge_einheit in ('kg_ha','l_ha','g_hl','ml_hl','kg','l')),
  wasseraufwand_l_ha  numeric(8,2),
  behandelte_flaeche_ha numeric(10,4),

  -- Wachstumsstadium (BBCH-Code)
  bbch_stadium        text,       -- z.B. '57' = Blüte
  schaderreger        text,       -- Zielorganismus/Schaderreger

  -- Wartezeit-Tracking
  ernte_fruehesteins  date,       -- berechnet: datum + wartezeit_tage
  wartezeit_eingehalten boolean,

  notizen             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table behandlungen is 'Pflanzenschutz-Behandlungsprotokoll (Spritzplan/-buch)';
comment on column behandlungen.bbch_stadium is 'BBCH-Phänologieskala: 09=Knospe, 57=Blüte, 73=Erbse, 89=Reife';
comment on column behandlungen.ernte_fruehesteins is 'Automatisch: Behandlungsdatum + Wartezeit des PSM';

create trigger behandlungen_updated_at
  before update on behandlungen
  for each row execute function update_updated_at();

create index idx_behandlungen_tenant     on behandlungen(tenant_id);
create index idx_behandlungen_weingarten on behandlungen(weingarten_id);
create index idx_behandlungen_datum      on behandlungen(tenant_id, datum);
create index idx_behandlungen_psm        on behandlungen(psm_id);

-- ─── RLS: PFLANZENSCHUTZMITTEL ────────────────────────────────────────────────
alter table pflanzenschutzmittel enable row level security;

-- Globale Mittel (tenant_id IS NULL) sieht jeder; eigene Mittel nur der eigene Tenant
create policy "psm: read global + own"
  on pflanzenschutzmittel for select
  using (
    tenant_id is null
    or tenant_id in (select get_user_tenant_ids())
  );

create policy "psm: winzer+ can insert own"
  on pflanzenschutzmittel for insert
  with check (
    tenant_id is not null
    and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "psm: winzer+ can update own"
  on pflanzenschutzmittel for update
  using (
    tenant_id is not null
    and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "psm: admin can delete own"
  on pflanzenschutzmittel for delete
  using (
    tenant_id is not null
    and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
  );

-- ─── RLS: BEHANDLUNGEN ────────────────────────────────────────────────────────
alter table behandlungen enable row level security;

create policy "behandlungen: members can select"
  on behandlungen for select
  using (tenant_id in (select get_user_tenant_ids()));

create policy "behandlungen: winzer+ can insert"
  on behandlungen for insert
  with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "behandlungen: winzer+ can update"
  on behandlungen for update
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "behandlungen: admin can delete"
  on behandlungen for delete
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin']));
