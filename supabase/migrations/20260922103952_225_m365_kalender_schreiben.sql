alter table tenant_einstellungen add column if not exists m365_kalender_schreiben boolean not null default false;
comment on column tenant_einstellungen.m365_kalender_schreiben is 'Termine aus dem CRM in Outlook anlegen (Calendars.ReadWrite in Entra freigegeben)';
alter table user_email_connections add column if not exists m365_scope text;;
