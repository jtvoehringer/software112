# Betrieb (Mandant) löschen – Runbook

Stand 01.10.2026 (KAN-151). Gilt für das endgültige Löschen eines Betriebs, z. B. nach Vertragsende. **Nicht** für die Sandbox – die setzt `sql/sandbox_zuruecksetzen.sql` zurück (Stammdaten bleiben).

Ein Betrieb wird ausschließlich über die Datenbankfunktion `public.s112_mandant_loeschen` gelöscht – nie per `DELETE FROM tenants`, nie mit Cleanup-Skripten, nie mit `session_replication_role = 'replica'` oder `DISABLE TRIGGER` (KAN-124).

## Ablauf

1. **Datenübergabe** (falls vertraglich vereinbart): Exporte unter Controlling › Datenexport und die Behördenmeldungen (CSV) für den Betrieb ziehen und übergeben. Aufbewahrungspflichten (§ 132 BAO) mit dem Betrieb klären.
2. **Abo beenden**: Stripe-Abo kündigen, sobald Stripe eingerichtet ist (`docs/STRIPE_EINRICHTUNG.md`). Bis dahin genügt die Namensbestätigung unten.
3. **Prüfen, ob andere Betriebe betroffen sind** (Kellergemeinschaft): Liegen Chargen, Umzüge, Behandlungen oder Pressungen eines anderen Betriebs in Gebinden dieses Betriebs, bricht die Routine mit Fehler 55000 ab, ohne etwas zu ändern. Dann zuerst im anderen Betrieb umziehen bzw. bereinigen.
4. **Routine im Supabase-SQL-Editor ausführen** (Produktion, als postgres) – zweiter Parameter ist der **exakte Name** des Betriebs:

   ```sql
   select public.s112_mandant_loeschen('<tenant-uuid>', '<Name des Betriebs>');
   ```

   - Läuft in einer Transaktion: entweder alles oder nichts.
   - Rückgabe: Zeilen je Tabelle und Gesamtzahl. Ein Eintrag in `system_ereignisse` (art `db`, quelle `s112_mandant_loeschen`) hält UUID und Zählung fest – ohne Personendaten.
   - Funktioniert auch im Nur-Lesen-Modus (gekündigter Betrieb).
   - Das Änderungsprotokoll (`bestandsprotokoll`) des Betriebs bleibt stehen (siehe Schritt 8).
5. **FK-Waisen prüfen**: `scripts/fk-waisen.sql` im SQL-Editor ausführen – **0 Zeilen** erwartet.
6. **Storage-Ordner löschen**: In allen Buckets (`mandant-logos`, `ea-belege`, `aktivitaet-dokumente`, `analysen`, `dokumente`, `etiketten`) den Ordner `<tenant-uuid>/` über das Supabase-Dashboard bzw. die Storage-API löschen (SQL-DELETE auf `storage.objects` ist gesperrt). Danach prüfen – **0 Zeilen** erwartet:

   ```sql
   select bucket_id, name from storage.objects o
    where not exists (select 1 from public.tenants t where t.id::text = (storage.foldername(o.name))[1]);
   ```

7. **Auth-Benutzer aufräumen**: Benutzer, die keine weitere Mitgliedschaft haben, im Supabase-Dashboard (Authentication › Users) löschen – **nie** Plattform-Admins (`plattform_admins`). Prüfabfrage:

   ```sql
   select u.id, u.email from auth.users u
    where not exists (select 1 from public.tenant_memberships m where m.user_id = u.id)
      and not exists (select 1 from public.plattform_admins p where p.user_id = u.id);
   ```

8. **Nach Ablauf der Frist** (mit AVV/AGB abzustimmen, KAN-145 Frage 2): Änderungsprotokoll des Betriebs entfernen:

   ```sql
   select public.bestandsprotokoll_mandant_loeschen('<tenant-uuid>');
   ```

**E-Labels (KAN-219, Entscheidung Jörgen 07.10.2026):** `s112_mandant_loeschen` kopiert vor dem Löschen alle freigegebenen
E-Labels (Inhalt des Umleitungsziels, dazu Name des Betriebs) nach `s112_archiv.elabel_archiv`. Gedruckte QR-Codes zeigen
damit noch **5 Jahre** ab der Löschung die Zutaten und Nährwerte (`/e/<code>` liest über `s112_elabel_archiv_lesen`). Die
Regel gehört in die AGB. Vorzeitig entfernen nur auf ausdrücklichen Wunsch, per SQL-Editor:

```sql
delete from s112_archiv.elabel_archiv where quelle_tenant = '<tenant-uuid>';
```

## Offene Altlast (Stand 01.10.2026)

- `mandant-logos/c3d357c5…/`: verwaistes Logo eines bereits gelöschten Betriebs (Prüfabfrage aus Schritt 6 liefert 1 Zeile) – über das Supabase-Dashboard löschen.

## Hintergrund

- Routine: Migration `supabase/migrations/20261001140409_kan151g1_mandant_loeschen.sql`, Test `scripts/db-tests/21_mandant_loeschen.sql`.
- Ein `DELETE FROM tenants` ohne die Routine scheitert an den Löschsperren (KAN-145, KAN-150) – gewollt.
- Der Signup-Rückbau eines frisch angelegten Betriebs (`src/app/signup/actions.ts`) bleibt davon unberührt.
