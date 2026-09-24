-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 148: Prozess-Assistent (Bot) – Grunddatenmodell (Phase 0)
--
-- Siehe Konzeptdokument "Prozess-Assistent für software112" (Stand 01.08.2026).
-- Legt die vier Basistabellen für den konversationellen Assistenten an:
--   - assistent_unterhaltungen: eine Chat-Sitzung
--   - assistent_nachrichten:    jede Nachricht/jeder Tool-Aufruf im Verlauf
--   - assistent_aktionen:       Protokoll jeder tatsächlich ausgeführten Schreibaktion
--   - assistent_korrekturen:    Pro-Mandant-"Gedächtnis" (gelernte Begriffe/Zuordnungen)
--
-- Der Assistent selbst nutzt ausschließlich bestehende, geprüfte Server
-- Actions (RLS greift wie in jedem anderen Formular) – hier wird nur das
-- Protokoll-/Konversationsdatenmodell angelegt, keine neue Schreiblogik.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Chat-Sitzung ──────────────────────────────────────────────────────────────
create table assistent_unterhaltungen (
  id              uuid        primary key default uuid_generate_v4(),
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  gestartet_am    timestamptz not null default now(),
  beendet_am      timestamptz,
  status          text        not null default 'aktiv'
                  check (status in ('aktiv', 'abgeschlossen', 'abgebrochen'))
);
comment on table assistent_unterhaltungen is 'Prozess-Assistent: eine Chat-Sitzung eines Users';

-- ── Nachrichtenverlauf ────────────────────────────────────────────────────────
create table assistent_nachrichten (
  id              uuid        primary key default uuid_generate_v4(),
  unterhaltung_id uuid        not null references assistent_unterhaltungen(id) on delete cascade,
  rolle           text        not null check (rolle in ('user', 'assistant', 'tool')),
  inhalt          text,
  tool_name       text,
  tool_input      jsonb,
  tool_result     jsonb,
  erstellt_am     timestamptz not null default now()
);
comment on table assistent_nachrichten is 'Prozess-Assistent: jede Nachricht bzw. jeder Tool-Aufruf im Gesprächsverlauf (Audit + Kontext für Folgefragen)';

-- ── Aktions-Protokoll ─────────────────────────────────────────────────────────
create table assistent_aktionen (
  id              uuid        primary key default uuid_generate_v4(),
  unterhaltung_id uuid        not null references assistent_unterhaltungen(id) on delete cascade,
  prozess         text        not null,   -- z.B. 'massnahme_dokumentieren', 'verkauf_anlegen', 'ernte_erfassen'
  ziel_tabelle    text        not null,   -- z.B. 'behandlungen', 'verkaufsposten', 'ernte_parzellen'
  ziel_id         uuid,                   -- id des tatsächlich angelegten Datensatzes
  erstellt_von    uuid        references auth.users(id),
  erstellt_am     timestamptz not null default now()
);
comment on table assistent_aktionen is 'Prozess-Assistent: Protokoll jeder tatsächlich über den Bot ausgeführten Schreibaktion – wer hat wann welchen Datensatz über den Bot angelegt';

-- ── Pro-Mandant-Korrekturgedächtnis ───────────────────────────────────────────
create table assistent_korrekturen (
  id              uuid        primary key default uuid_generate_v4(),
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  begriff         text        not null,   -- z.B. "Riesling-Parzelle am Berg"
  interpretation  text        not null,   -- z.B. konkrete Grundstücks-/Kontakt-ID als Text
  kategorie       text,                   -- z.B. 'grundstueck', 'psm', 'kontakt'
  erstellt_von    uuid        references auth.users(id),
  erstellt_am     timestamptz not null default now()
);
comment on table assistent_korrekturen is 'Prozess-Assistent: pro Mandant gelernte Begriffs-Zuordnungen ("soll ich mir das merken?")';

-- ── Feature-Flag ──────────────────────────────────────────────────────────────
-- Aktivierung pro Mandant, zunächst nur für den Sandbox-Mandanten gesetzt
-- (siehe Kommentar unten – manuell im SQL-Editor auf den Sandbox-Mandanten
-- setzen, hier nur die Spalte anlegen mit sicherem Default false).
alter table tenant_einstellungen
  add column if not exists assistent_aktiv boolean not null default false;
comment on column tenant_einstellungen.assistent_aktiv is
  'Prozess-Assistent (Bot) für diesen Mandanten freigeschaltet – zunächst nur für den Sandbox-Mandanten aktivieren, siehe Rollout-Plan im Konzeptdokument.';

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table assistent_unterhaltungen enable row level security;
alter table assistent_nachrichten    enable row level security;
alter table assistent_aktionen       enable row level security;
alter table assistent_korrekturen    enable row level security;

-- assistent_unterhaltungen: jeder Tenant-Member sieht alle Unterhaltungen des
-- Mandanten (analog aktivitaeten), anlegen/ändern/löschen nur für sich selbst
-- und nur mit Schreibrecht.
create policy "assist_unt_select" on assistent_unterhaltungen
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "assist_unt_insert" on assistent_unterhaltungen
  for insert with check (
    user_id = auth.uid()
    and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );
create policy "assist_unt_update" on assistent_unterhaltungen
  for update using (
    user_id = auth.uid()
    and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );
create policy "assist_unt_delete" on assistent_unterhaltungen
  for delete using (
    user_id = auth.uid()
    and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

-- assistent_nachrichten: über unterhaltung_id an den Tenant gebunden (analog pipeline_verlauf)
create policy "assist_nach_select" on assistent_nachrichten
  for select using (
    unterhaltung_id in (
      select id from assistent_unterhaltungen
      where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
    )
  );
create policy "assist_nach_insert" on assistent_nachrichten
  for insert with check (
    unterhaltung_id in (
      select id from assistent_unterhaltungen
      where user_id = auth.uid()
        and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
    )
  );

-- assistent_aktionen: nur lesend über unterhaltung_id gebunden, Einträge macht
-- ausschließlich die Server-seitige Chat-API-Route (mit User-Kontext, daher
-- gleiche Insert-Regel wie bei den Nachrichten)
create policy "assist_akt_select" on assistent_aktionen
  for select using (
    unterhaltung_id in (
      select id from assistent_unterhaltungen
      where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
    )
  );
create policy "assist_akt_insert" on assistent_aktionen
  for insert with check (
    unterhaltung_id in (
      select id from assistent_unterhaltungen
      where user_id = auth.uid()
        and user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
    )
  );

-- assistent_korrekturen: pro Mandant sichtbar/pflegbar für alle mit Schreibrecht
create policy "assist_korr_select" on assistent_korrekturen
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "assist_korr_insert" on assistent_korrekturen
  for insert with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "assist_korr_update" on assistent_korrekturen
  for update using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "assist_korr_delete" on assistent_korrekturen
  for delete using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index idx_assist_unt_tenant   on assistent_unterhaltungen(tenant_id, gestartet_am desc);
create index idx_assist_unt_user     on assistent_unterhaltungen(user_id, status);
create index idx_assist_nach_unt     on assistent_nachrichten(unterhaltung_id, erstellt_am);
create index idx_assist_akt_unt      on assistent_aktionen(unterhaltung_id);
create index idx_assist_korr_tenant  on assistent_korrekturen(tenant_id, begriff);
