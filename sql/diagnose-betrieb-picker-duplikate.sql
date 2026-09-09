-- Diagnose: Warum zeigt der Betrieb-Picker (betrieb-waehlen) mehrere Karten
-- für "Sandbox" bzw. "Gebeshuber" an?
--
-- Rein lesend (nur SELECT) – verändert keine Daten. Bitte im Supabase
-- SQL-Editor ausführen und mir die Ergebnisse (Screenshot oder Text) schicken.
--
-- Vorab ausgeschlossen: tenant_memberships hat einen unique(tenant_id, user_id)
-- Constraint (siehe Migration 001) – doppelte Mitgliedschafts-Zeilen für
-- denselben User+Mandant sind also strukturell unmöglich. Wenn trotzdem
-- mehrere Karten mit demselben Namen erscheinen, müssen es unterschiedliche
-- tenants-Datensätze (unterschiedliche tenant_id) mit demselben Namen sein.

-- 1) Alle Mandanten, für die DEIN User eine Mitgliedschaft hat
--    (das ist exakt die Liste, die der Betrieb-Picker anzeigt)
select
  t.id                as tenant_id,
  t.name,
  t.slug,
  t.plan,
  t.active            as tenant_aktiv,
  t.created_at        as tenant_erstellt,
  tm.role,
  tm.created_at       as membership_erstellt
from tenant_memberships tm
join tenants t on t.id = tm.tenant_id
where tm.user_id = (select id from auth.users where email = 'jv@icp-consultants.at')
order by t.name, tm.created_at;

-- 2) Gibt es tatsächlich mehrere tenants-Zeilen mit demselben Namen?
--    (bestätigt/widerlegt die Hypothese "doppelte Mandanten-Datensätze")
select
  name,
  count(*) as anzahl_tenant_zeilen,
  array_agg(id order by created_at) as tenant_ids,
  array_agg(slug order by created_at) as slugs,
  array_agg(created_at order by created_at) as erstellt_am
from tenants
group by name
having count(*) > 1;

-- 3) Zur Einordnung: alle Mandanten insgesamt (Name, Slug, Plan, aktiv, Anlagedatum)
select id, name, slug, plan, active, created_at
from tenants
order by name, created_at;
