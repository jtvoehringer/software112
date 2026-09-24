# E-Mail → Lead (Stand 15.9.2026)

Öffnet ein Benutzer unter **Nachrichten** eine E-Mail, prüft die Plattform, ob der Absender bereits im CRM ist. Ist er es nicht, fragt sie **„Soll ein Lead angelegt werden?“** und belegt Kontakt und Firma – wie beim Visitenkarten-Scan – per KI aus der Signatur vor. Segment, Firma, Rabattgruppe, Zahlungsziel und Notizen werden im Dialog erfasst.

## Absender-Erkennung (`src/lib/crm/absender.ts`)

Ein Index je Aufruf (drei kleine Abfragen, kein Query je Nachricht):

1. **exakte Adresse** (klein geschrieben) auf `kontakte.email` bzw. `firmen.email`
2. **Firmendomain** auf `firmen.email`, `firmen.website` und die Adressen der Ansprechpersonen (`kontakte.firma_id`) – nicht bei Freemail-Domains (gmx, gmail, aon, outlook …)

Leads zählen als bekannt (`istLead = true`, Kennzeichen „Lead“ in der Oberfläche). Kein Lead-Vorschlag bei:

| Status | Bedeutung |
|---|---|
| `kontakt` / `firma` / `lead` | bekannt, E-Mail wird wie bisher als Aktivität abgelegt |
| `eigen` | eigenes Postfach, geteilte Mailbox oder eigene Domain |
| `ignoriert` | „Nein, nicht mehr fragen“ (`email_lead_ignoriert`, Migration 202) |
| `system` | noreply, newsletter, mailer-daemon, postmaster … |
| `unbekannt` | → Frage-Balken über der Mail, Markierung „neu“ in der Liste |

Verwendet in `/api/nachrichten/message` (Einzelmail, liefert `kontaktInfo`, `absender`, `leadVorschlag`) und `/api/nachrichten/list` (Feld `absender` je Nachricht). Der Domain-Treffer bewirkt nebenbei, dass Mails jeder Adresse einer bekannten Firma in deren Historie landen.

## Dialog (`nachrichten/LeadDialog.tsx`)

- Frage-Balken in `NachrichtenClient.tsx`: **Ja, Lead anlegen** · **Jetzt nicht** (nur diese Sitzung) · **Nein, nicht mehr fragen** (Server Action `ignoriereAbsender`).
- `POST /api/nachrichten/lead-vorschlag` mit `von, vonName, betreff, bodyText, bodyHtml`: HTML → Text, Antwortverlauf abgeschnitten, auf 7.000 Zeichen begrenzt; Claude Haiku (wie `/api/visitkarte`, kein KI-Kontingent) liefert `LeadVorbelegung` (Name, Firma, Position, E-Mail, Telefon, Mobil, Adresse, Land, Website, Segment-Vorschlag, Anliegen). Ohne Schlüssel oder bei Fehlern: Fallback aus Anzeigename und Domain. Dazu Rabattgruppen, alle aktiven Firmen und „Kandidaten“ (ähnlich benannte Firmen).
- Firma: **Privatperson** · **neu anlegen (als Lead)** · **bestehende Firma** (Kandidaten zuerst, Suchfeld). Zahlungsziel-Vorschlag 14 Tage (privat) bzw. 30 (Firma).
- Speichern: `createLeadAusEmail` (`crm/actions.ts`) – Firma optional, Kontakt mit `is_lead = true`, Accountnummer über `get_next_accountnummer`, Position und Anliegen in `notizen`, E-Mail als Aktivität `art = 'email'` (Upsert auf `tenant_id,email_id`) am Kontakt.
- Danach: Kopfzeile zeigt den neuen Lead, alle Mails dieses Absenders in der Liste tragen „lead“.

## Rollen

Lesen der Ignorier-Liste: alle Mitglieder. Schreiben (`email_lead_ignoriert`, Kontakte, Firmen): system_admin, tenant_admin, winzer (RLS wie bei Kontakten).

## Dateien

`supabase/migrations_legacy/202_email_lead_ignoriert.sql`, `src/lib/crm/absender.ts`, `src/lib/crm/leadEmail.ts`, `src/app/api/nachrichten/lead-vorschlag/route.ts`, `src/app/api/nachrichten/{message,list}/route.ts`, `src/app/(dashboard)/nachrichten/{LeadDialog.tsx,NachrichtenClient.tsx}`, `src/app/(dashboard)/crm/actions.ts` (createLeadAusEmail, ignoriereAbsender), Handbuch 2.7 / FAQ.
