-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 133 – Maßnahmenformular Phase 2
-- Bio-Status (Betrieb), eigene Düngemittel-Stammdaten, PSM-Ergänzungen,
-- neue Behandlungen-Felder je Art, Stundensätze-Referenztabelle
-- Basis: "Analyse Maßnahmen.docx" Abschnitt 8 (Antworten vom 18.07.2026)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1) BIO-STATUS AUF BETRIEBS-EBENE (tenants) ──────────────────────────────
alter table tenants
  add column if not exists bio_status text
    check (bio_status in ('konventionell','kip','nachhaltig','bio_eu','biodynamisch'))
    default 'konventionell';

comment on column tenants.bio_status is
  'Bewirtschaftungsstatus des Betriebs: konventionell, kip (kontrolliert integrierte Produktion), '
  'nachhaltig, bio_eu, biodynamisch. Steuert Warn-/Sperrlogik bei der Mittelwahl (siehe 4.3).';

-- ─── 2) DÜNGEMITTEL-STAMMDATEN (eigene Tabelle, analog pflanzenschutzmittel) ──
create table duengemittel (
  id                  uuid        primary key default uuid_generate_v4(),
  tenant_id           uuid        references tenants(id) on delete cascade,
                                  -- NULL = globales Mittel (system_admin verwaltet)
  name                text        not null,
  handelsname         text,
  typ                 text        check (typ in ('organisch','mineralisch')),
  naehrstoff_n_pct    numeric(6,3),   -- Stickstoff-Anteil %
  naehrstoff_p_pct    numeric(6,3),   -- Phosphor-Anteil %
  naehrstoff_k_pct    numeric(6,3),   -- Kalium-Anteil %
  wartezeit_tage      integer     check (wartezeit_tage >= 0),
  oeko_zugelassen     boolean     not null default false,
  einarbeitung_erforderlich boolean not null default false,
  preis_pro_einheit   numeric(10,4),  -- optional, für Kosten-Vorschlag (jährlich zu pflegen)
  einheit             text        check (einheit in ('kg','l')),
  notizen             text,
  aktiv               boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table duengemittel is 'Düngemittel-Stammdaten: global + tenant-eigene Mittel (getrennt von pflanzenschutzmittel)';
comment on column duengemittel.tenant_id is 'NULL = global (von system_admin verwaltet)';
comment on column duengemittel.preis_pro_einheit is 'Für automatische Kosten-Vorschläge; muss jährlich manuell aktualisiert werden';

create trigger duengemittel_updated_at
  before update on duengemittel
  for each row execute function update_updated_at();

create index idx_duengemittel_tenant on duengemittel(tenant_id);

alter table duengemittel enable row level security;

create policy "duengemittel: read global + own"
  on duengemittel for select
  using (tenant_id is null or tenant_id in (select get_user_tenant_ids()));

create policy "duengemittel: winzer+ can insert own"
  on duengemittel for insert
  with check (tenant_id is not null and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "duengemittel: winzer+ can update own"
  on duengemittel for update
  using (tenant_id is not null and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "duengemittel: admin can delete own"
  on duengemittel for delete
  using (tenant_id is not null and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin']));

-- ─── 3) PFLANZENSCHUTZMITTEL: fehlende Felder ergänzen ───────────────────────
-- zulassungsnr (= PSM-Registernummer) und bienengefaehrlich existieren bereits seit
-- Migration 008 – hier nur die beiden tatsächlich fehlenden Felder aus 5.1 ergänzen.
alter table pflanzenschutzmittel
  add column if not exists eppo_code         text,        -- z.B. 'VITVI' für Reben (fixer Wert im Formular)
  add column if not exists preis_pro_einheit numeric(10,4);

comment on column pflanzenschutzmittel.eppo_code is 'EPPO-Code der Kultur (EU-VO 2023/564 Pflichtangabe), bei Reben immer VITVI';
comment on column pflanzenschutzmittel.preis_pro_einheit is 'Für automatische Kosten-Vorschläge; muss jährlich manuell aktualisiert werden';

-- ─── 4) BEHANDLUNGEN: neue Felder je Maßnahmenart ────────────────────────────
alter table behandlungen
  add column if not exists duengemittel_id        uuid references duengemittel(id),
  add column if not exists bearbeitungstiefe_cm    numeric(5,1),
  add column if not exists bearbeitungsgeraet      text,
  add column if not exists schnittart              text,
  add column if not exists laubarbeit_art          text,
  add column if not exists einarbeitung            boolean,
  add column if not exists einarbeitung_zeitpunkt  date;

comment on column behandlungen.duengemittel_id       is 'Verweis auf duengemittel-Stammdaten (nur bei art=duengung)';
comment on column behandlungen.bearbeitungstiefe_cm  is 'Bodenbearbeitung: Bearbeitungstiefe in cm';
comment on column behandlungen.bearbeitungsgeraet    is 'Bodenbearbeitung: eingesetztes Gerät';
comment on column behandlungen.schnittart            is 'Schnitt: Art des Rebschnitts';
comment on column behandlungen.laubarbeit_art        is 'Laubarbeit: z.B. Entblättern, Ausgeizen, Gipfeln';
comment on column behandlungen.einarbeitung          is 'Düngung: wurde das Mittel eingearbeitet (bei organischem Dünger relevant)';
comment on column behandlungen.einarbeitung_zeitpunkt is 'Düngung: Zeitpunkt der Einarbeitung';

create index if not exists idx_behandlungen_duengemittel on behandlungen(duengemittel_id);

-- ─── 5) STUNDENSÄTZE / HEKTARSÄTZE (Bauernkammer-Referenzwerte) ──────────────
-- Editierbare Referenztabelle statt hartcodierter Zahlen – der Winzer pflegt die
-- aktuellen Kammer-/IDB-Sätze selbst (siehe Antwort zu Frage 4, jährliche Anpassung nötig).
create table saetze_massnahmen (
  id            uuid        primary key default uuid_generate_v4(),
  tenant_id     uuid        references tenants(id) on delete cascade,
                            -- NULL = globale Vorlage (system_admin verwaltet)
  art           text        not null check (art in (
                              'spritzung','duengung','bodenbearbeitung',
                              'schnitt','laubarbeit','sonstiges'
                            )),
  bezeichnung   text        not null,   -- z.B. "Handlese", "Laubschnitt maschinell"
  satz_pro_ha   numeric(10,2) not null,
  gueltig_ab    date        not null default current_date,
  notizen       text,
  aktiv         boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table saetze_massnahmen is
  'Bauernkammer-/IDB-Hektarsätze je Maßnahmenart, vom Betrieb selbst gepflegt (jährliche Anpassung).';

create trigger saetze_massnahmen_updated_at
  before update on saetze_massnahmen
  for each row execute function update_updated_at();

create index idx_saetze_massnahmen_tenant on saetze_massnahmen(tenant_id);
create index idx_saetze_massnahmen_art    on saetze_massnahmen(art);

alter table saetze_massnahmen enable row level security;

create policy "saetze: read global + own"
  on saetze_massnahmen for select
  using (tenant_id is null or tenant_id in (select get_user_tenant_ids()));

create policy "saetze: winzer+ can insert own"
  on saetze_massnahmen for insert
  with check (tenant_id is not null and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "saetze: winzer+ can update own"
  on saetze_massnahmen for update
  using (tenant_id is not null and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "saetze: admin can delete own"
  on saetze_massnahmen for delete
  using (tenant_id is not null and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin']));

NOTIFY pgrst, 'reload schema';
