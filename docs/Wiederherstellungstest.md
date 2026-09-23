# Wiederherstellungstest der Datensicherung (O5)

Vertrag Anlage 3, Abschnitt 6: jährlicher Test, ob sich die Datensicherung tatsächlich zurückspielen lässt. Stand der Vorbereitung: 23.9.2026.

## Was gesichert wird

| Bereich | Sicherung | Im Test enthalten |
| --- | --- | --- |
| Datenbank (alle Betriebe, Benutzerkonten mit Passwort-Hash, 2FA-Faktoren) | Supabase Pro: tägliche Sicherung, 7 Tage aufbewahrt | ja |
| Verschlüsselte Zugangsdaten (E-Mail, Microsoft 365, Brevo, SumUp, bawb) | liegen verschlüsselt in der Datenbank; Schlüssel EMAIL_CRYPT_SECRET_V2 in Vercel und im Passwort-Manager | ja (Werte), Schlüssel separat |
| Dateien im Speicher (Logos, Dokumente zu Aktivitäten) | **nicht** in der Datenbanksicherung enthalten | nein – siehe Befund unten |
| Programmcode | GitHub (jede Version) | nicht nötig |
| Einstellungen Vercel/Supabase (Umgebungsvariablen, Auth-Einstellungen) | nur in den Dashboards und im Passwort-Manager | nein – Liste im Notfallplan |

## Ablauf (ca. 1 Stunde, davon 10 Minuten Handarbeit)

1. **Supabase-Dashboard** → Projekt „Software112“ → Database → Backups → Reiter **„Restore to a New Project“**.
   Falls der Reiter fehlt, sind physische Sicherungen für das Projekt nicht aktiv – dann Supabase-Support fragen oder den Test per Download der Tagessicherung und Einspielen in ein leeres Projekt durchführen.
2. Jüngste Sicherung wählen, neues Projekt in derselben Region wie das Original anlegen lassen (**eu-west-1, Irland** – wie im Sicherheitsblatt angegeben), Name `software112-restoretest-JJJJ-MM`.
   Das Original bleibt unberührt. Das neue Projekt kostet anteilig wie ein Pro-Projekt – nach dem Test löschen.
3. Sobald das neue Projekt läuft: `scripts/restore-test.sql` auf **beiden** Projekten ausführen (oder Claude bitten, den Abgleich über die Supabase-Verbindung zu machen).
4. Vergleichen:
   - gleiche Zahl an Tabellen und gleiche höchste Migrationsnummer,
   - Datensätze je Tabelle gleich oder nur dort abweichend, wo seit der Sicherung gearbeitet wurde,
   - Anzahl Benutzer und 2FA-Faktoren gleich,
   - verschlüsselte Werte vorhanden (Format v2).
5. Stichprobe: im neuen Projekt drei Datensätze aus Kellerbuch, Verkauf und CRM mit der Produktion vergleichen.
6. Ergebnis unten eintragen, neues Projekt löschen (Settings → General → Delete project).

## Referenzwerte Produktion (23.9.2026, nach Migration 227)

104 Tabellen, 28.380 Datensätze, 9 Benutzerkonten, höchste Migration 20260923140145.

## Befund aus der Vorbereitung

Die Datenbanksicherung enthält **keine Dateien aus dem Speicher**. Heute sind das nur 3 Dateien (Logos, ein Dokument, zusammen ca. 120 kB). Sobald Belege oder Dokumente in größerem Umfang hochgeladen werden (Aufbewahrungspflicht 7 Jahre), braucht es eine eigene Dateisicherung, z. B. einen wöchentlichen Export in einen zweiten Speicher. Bis dahin: kein Handlungsbedarf, aber vor der Freischaltung des Beleg-Uploads für Kunden erledigen.

## Protokoll

| Datum | Sicherung vom | Durchgeführt von | Ergebnis | Dauer bis lauffähig |
| --- | --- | --- | --- | --- |
| | | | | |
