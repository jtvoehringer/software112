# software:112 – E-Mail-Integration Modul
**Phase 3 Epic · Stand: 2. Juni 2026**

## Produktbeschreibung

Optionales Zusatzmodul für bidirektionale E-Mail-Integration. Alle E-Mails mit bekannten
Kontakten/Firmen werden automatisch als Aktivitäten gespeichert. Ausgehende E-Mails können
direkt aus software:112 versendet werden.

**Zwei Ausbaustufen:**
- **E-Mail Basic** – universell (IMAP/SMTP, funktioniert mit allen Anbietern inkl. Thunderbird, GMX, Outlook, Gmail)
- **M365 Premium** – Microsoft 365 mit Graph API, Echtzeit-Webhooks, Kalender-Synchronisation

---

## Lizenzmodell (Zusatz zur Basis-Lizenz, pro User)

| Paket | Preis/User/Monat | Anbindung | Marge ca. |
|-------|-----------------|-----------|-----------|
| **E-Mail Basic** | +€ 15 | IMAP/SMTP (alle Anbieter) | ~95 % |
| **M365 Premium** | +€ 25 | Microsoft Graph API + OAuth2 | ~90 % |

Beide Module können unabhängig aktiviert werden. Mindest-Abrechnungseinheit: 1 User.
Typischer Weingut-Betrieb (2–3 User): € 30–75/Monat.

---

## Features

### E-Mail Basic (IMAP/SMTP)

**Eingehend (Mailbox → Aktivitäten):**
- n8n pollt IMAP-Postfach alle 5–15 Minuten
- Absender-Email wird gegen `kontakte.email` und `firmen.email` abgeglichen
- Nur E-Mails von/an bekannte Kontakte werden geloggt (kein Spam unbekannter Absender)
- Aktivität (art='email') wird angelegt: Betreff + Text-Auszug (max. 200 Zeichen) + Datum
- Message-ID als Duplikat-Schutz (gleiche Mail nie zweimal)

**Ausgehend (software:112 → Email):**
- „E-Mail senden"-Button bei Kontakt/Firma-Detail und Aktivitäten
- Absender, Empfänger, Betreff vorausgefüllt
- Versand via SMTP im Namen des Users
- Aktivität wird sofort angelegt (art='email', erledigt=true)

**Einstellungen:**
- Modul-Tab in Mandantenverwaltung: IMAP-Host/-Port/-User/Passwort + SMTP-Host/-Port
- Passwörter AES-256 verschlüsselt in Supabase Vault
- Testverbindung-Button
- Per-User Konfiguration (jeder User kann eigene Credentials hinterlegen)

### M365 Premium (Microsoft Graph API)

Alle Features von E-Mail Basic, zusätzlich:

**OAuth2 statt Credentials:**
- Kein Passwort-Sharing – User autorisiert per Microsoft-Login (OAuth2 PKCE)
- Azure AD App-Registrierung pro Mandant (einmalig vom system_admin einzurichten)
- Admin Consent für die Organisation

**Echtzeit statt Polling:**
- Microsoft Graph Change Notifications (Webhooks)
- Neue E-Mails erscheinen innerhalb von Sekunden als Aktivitäten
- Subscription-Renewal automatisch via n8n

**Kalender-Synchronisation:**
- Outlook-Termine ↔ Pipeline-Einträge synchronisieren
- Neue software:112-Aktivitäten optional in Outlook-Kalender schreiben
- Bidirektional (Outlook → software:112 und umgekehrt)

---

## Technische Architektur

### Matching-Logik

```
Eingehende E-Mail (from: hans@weingut.at)
  → Lookup: kontakte WHERE email = 'hans@weingut.at'  → Match? → Aktivität bei Kontakt
  → Lookup: firmen WHERE email = 'hans@weingut.at'    → Match? → Aktivität bei Firma
  → Kein Match: Mail ignorieren
  
Eingehende E-Mail (to: ich@meinweingut.at, from: hans@weingut.at)
  → Nur Absender für Matching relevant (nicht Empfänger)
```

### Datenmodell (neue Felder in tenant_einstellungen)

```sql
-- E-Mail Basic
ADD COLUMN email_modul_aktiv       boolean DEFAULT false,
ADD COLUMN email_imap_host         text,
ADD COLUMN email_imap_port         int DEFAULT 993,
ADD COLUMN email_imap_user         text,
ADD COLUMN email_imap_pass_enc     text,   -- AES-256 verschlüsselt
ADD COLUMN email_smtp_host         text,
ADD COLUMN email_smtp_port         int DEFAULT 587,
ADD COLUMN email_poll_interval_min int DEFAULT 15,

-- M365 Premium
ADD COLUMN m365_modul_aktiv        boolean DEFAULT false,
ADD COLUMN m365_tenant_id          text,
ADD COLUMN m365_client_id          text,
ADD COLUMN m365_client_secret_enc  text,   -- AES-256 verschlüsselt
ADD COLUMN m365_webhook_sub_id     text;   -- Graph Subscription ID
```

### n8n Workflows

```
01_email_imap_polling.json
  → Trigger: Cron (alle 15 min)
  → IMAP: ungelesen Mails holen
  → Filter: Absender in kontakte/firmen?
  → Supabase: Aktivität anlegen
  → IMAP: Mail als gelesen markieren

02_m365_webhook_receiver.json
  → Trigger: HTTP Webhook (Graph notification)
  → Graph API: Mail-Details holen
  → Filter: Absender in kontakte/firmen?
  → Supabase: Aktivität anlegen

03_m365_subscription_renewal.json
  → Trigger: Cron (alle 2 Tage)
  → Graph API: Webhook-Subscription verlängern
```

### Aktivitäten-Felder für E-Mails

```
art:          'email'
betreff:      <Email-Betreff>
beschreibung: <Text-Auszug, max 200 Zeichen>
datum:        <Empfangs-/Sendedatum>
erledigt:     true (gesendete) / false (eingehende, unbeantwortet)
ganztags:     false
notizen:      'from: hans@weingut.at | message-id: <abc@xyz>'
```

---

## DSGVO & Sicherheit

- **Datenschutz-Hinweis:** Beim Aktivieren des Moduls muss der tenant_admin zustimmen,
  dass E-Mail-Inhalte in der Datenbank gespeichert werden
- **Inhalt:** Nur Betreff + 200-Zeichen-Auszug, keine vollständigen E-Mails
- **Attachments:** Phase 1 ohne Attachments
- **Credentials:** AES-256 in Supabase Vault, nie im Klartext in der DB
- **Scope:** Nur Mails zu bekannten Kontakten – kein unkontrolliertes Archivieren

---

## Zeitplan (Phase 3)

| Sprint | Modul | Aufwand |
|--------|-------|---------|
| Phase 3 Mitte | E-Mail Basic – IMAP-Polling + n8n | 3 Tage |
| Phase 3 Mitte | E-Mail Basic – SMTP-Senden + UI | 2 Tage |
| Phase 3 Mitte | E-Mail Basic – Modul-Einstellungen | 1 Tag |
| Phase 3 Ende | M365 – Azure AD + OAuth2 | 3 Tage |
| Phase 3 Ende | M365 – Graph API + Webhooks | 2 Tage |
| Phase 3 Ende | M365 – Kalender-Sync | 3 Tage |
| **Gesamt Basic** | | **~6 Tage** |
| **Gesamt M365 Premium** | | **~8 Tage zusätzlich** |
