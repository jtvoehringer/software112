-- 225: Outlook-Termine mit Kollegen (Einladung) – Schreibrecht auf den Kalender
-- Angewendet: 22.09.2026
--
-- Die Entra-App-Registrierung braucht dafür zusätzlich die delegierte Berechtigung
-- Calendars.ReadWrite. Solange der Betrieb sie nicht freigegeben hat, bleibt der
-- Schalter aus und die Verbindung wird weiterhin nur mit Calendars.Read angefordert –
-- sonst würde die Anmeldung für alle Benutzer des Betriebs scheitern.

alter table tenant_einstellungen add column if not exists m365_kalender_schreiben boolean not null default false;
comment on column tenant_einstellungen.m365_kalender_schreiben is 'Termine aus dem CRM in Outlook anlegen (Calendars.ReadWrite in Entra freigegeben)';

-- Welche Scopes die Verbindung des Benutzers tatsächlich erhalten hat (für Refresh + Feature-Check);
-- null = Altverbindung mit dem Basis-Scope (Mail + Calendars.Read)
alter table user_email_connections add column if not exists m365_scope text;
