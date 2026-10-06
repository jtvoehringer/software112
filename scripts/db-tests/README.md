# SQL-Testsuite gegen Staging (`npm run test:db`)

Wiederholbare Tests der Datenbank-Logik – Mandantentrennung (RLS), Rollen und Schreibmodule, Sperren
(Abo-Schreibsperre, Lösch- und Periodensperren), Schutz-Trigger, Geheimnis-Spaltenrechte, Zwei-Faktor in der
Datenbank, Plattform-Admin-Policies, SECURITY-DEFINER-RPCs und Storage – **ausschließlich gegen Staging**
(`sjpeghrlhsowmquacjhb`). Jede Testdatei ist **eine** Transaktion, die immer mit `RAISE` endet und deshalb
vollständig zurückgerollt wird: auf Staging bleibt nichts zurück.

`test:db` gehört bewusst **nicht** zu `verify`/`prebuild` (braucht Netzwerk und einen Supabase-Login). Die
Unit-Tests des Runners (`scripts/tests/db-tests.test.mjs`, ohne Datenbank) laufen über `test:csv` in
`npm run verify` mit – sie prüfen u. a. alle Testdateien hier statisch.

## Aufruf

```
npm run test:db                              # alle Dateien in Namensreihenfolge, 00 zuerst
npm run test:db -- --nur 10,11               # nur diese (00_rahmen läuft trotzdem immer zuerst)
npm run test:db -- --mutationen [datei]      # jede deklarierte Mutation einzeln (Mutationsprüfung)
npm run test:db -- --ausfuehrlich            # auch die Namen der OK-Prüfungen
npm run test:db -- --streng                  # BEKANNT zählt als Fehler (z. B. Sicherheitsreview)
npm run test:db -- --liste                   # Dateien, Ziele, Mutationen, statische Prüfung – ohne DB
npm run test:db -- --json lauf.json          # maschinenlesbare Zusammenfassung (nie einchecken)
```

Voraussetzung: angemeldete Supabase-CLI (`npx supabase login` bzw. `SUPABASE_ACCESS_TOKEN`). Die CLI kommt
aus dem npx-Cache und ist nicht fixiert (Stand 2.118.0); der Runner protokolliert die Version und liest die
Antworten tolerant. Kein Python nötig.

| Exit | Bedeutung |
|------|-----------|
| 0 | grün – `fehler=0` überall (BEKANNT erlaubt, außer mit `--streng`) |
| 1 | Testfehler, rotes 00 (Abbruch) oder überlebte Mutation |
| 2 | echter SQL- oder Infrastrukturfehler (Meldung samt CONTEXT), statisch fehlerhafte Datei |
| 3 | kein Rollback: eine Datei endete ohne `RAISE` (ALARM, sofort Stopp) oder S112TEST-Reste gefunden |
| 4 | nicht Staging: Vorprüfung oder Wächter schlug an – kein Test läuft (weiter) |

Ausgabe je Datei `✓/✗ <datei> ok=… fehler=… bekannt=… (db … ms, gesamt … s)`, danach alle FEHLER-Einträge und
**immer** der Block „Bekannte Lücken (n)“ (über alle Dateien dedupliziert) – so bleibt jede echte Lücke sichtbar,
auch wenn die Suite grün ist. Laufzeit: je CLI-Aufruf 5–15 s (npx-Start, Login-Rolle, API), in der Datenbank
meist unter 1 s; Aufrufe laufen **streng nacheinander** (parallel scheitern sie mit 28P01). Wiederholt (bis zu
dreimal) werden nur Infrastrukturfehler: 28P01/ConnectTempRole, HTTP 401/429/5xx, Zeitüberschreitung und eine
leere CLI-Antwort ohne SQL-Fehlertext (nur npm-Hinweise; Meldung mit Exit-Status und stderr-Länge).

## Sicherheit: Produktionsschutz in fünf Stufen

1. **Konstanten in `run.mjs`** (`STAGING_REF`, `STAGING_SYSID`, Produktions-Ref nur zur Negativprüfung) – keine
   Option, keine Umgebungsvariable ändert sie; `SUPABASE_*` außer `SUPABASE_ACCESS_TOKEN` wird der CLI entzogen.
   Enthält die Befehlszeile die Produktions-Ref, bricht der Runner ab.
2. **Eigenes, leeres `--workdir`** (`os.tmpdir()/s112-db-tests-*`, am Ende gelöscht): `supabase/.temp/project-ref`
   im Repo zeigt auf die **Produktion** – `--linked` ohne `--project-ref` ginge dorthin. Ohne diese Datei gibt es
   keinen Rückfall auf den verknüpften Stand.
3. **Vorprüfung** vor jedem Lauf (ein SELECT, muss dreimal `true` liefern, sonst Exit 4 ohne Test):
   `system_identifier` = Staging, keiner der drei Produktions-Betriebe vorhanden, `admin@software112.test` ist
   Plattform-Admin. Dieselbe Abfrage prüft vorher und nachher, dass keine S112TEST-Reste existieren (Exit 3):
   Betriebe, Benutzer, Faktoren, Storage-Objekte, Kontakte, `pg_temp`-Funktionen, Policies `s112test%`, Tabellen/
   Views/Funktionen `public.s112test%`, `plattform_admins` mit Hinweis `S112TEST%` sowie Rechte, die Tests und
   Mutationen an echten Objekten ändern (Geheimnis-Spalten, `INSERT (tenant_id)` auf `tenant_einstellungen`,
   EXECUTE auf `s112_meine_tenants`/`s112_aal_ok`/`ist_service_kontext` u. a.; `rest_rechte` in `run.mjs`).
   Bewertet werden alle `rest_*`-Spalten der Abfrage (`REST_SPALTEN` wird aus `pruefSql()` abgeleitet). Bricht
   der Lauf nach dem ersten gesendeten Test ab (ALARM, Infrastruktur, CLI – nicht beim Wächter), läuft die
   Nachprüfung trotzdem. Eine Antwort mit Exit-Status 0 ohne JSON gilt als „ohne RAISE beendet“ (ALARM, Exit 3).
4. **Wächter in SQL**: erste Anweisung jedes DO-Blocks ist `PERFORM pg_temp.s112_nur_staging();` (current_user
   postgres, system_identifier, keine Produktions-Betriebe, Staging-Admin) – sonst `RAISE 'S112GUARD|…'`.
5. **Statisch**: Produktions-Ref und Produktions-Betriebs-IDs stehen nur im Wächter in `_helfer.sql`; der Runner
   liest die IDs von dort (`c_prod_betriebe`), die Unit-Tests prüfen alle übrigen Dateien.

Wird Staging neu aufgebaut oder wiederhergestellt, ändert sich der `system_identifier`: dann scheitert der
Wächter sicher, und `c_staging_sysid` in `_helfer.sql` sowie `STAGING_SYSID` in `run.mjs` sind nachzuziehen.

**Nie gegen die Produktion ausführen** – auch nicht „nur lesend“. Paritätsvergleiche mit der Produktion laufen
ausschließlich als reine SELECTs über den Supabase-MCP, nie über diese Suite.

## Aufbau einer Testdatei

Name `NN_<bereich>.sql` (00 = Rahmen, 01 = Katalog/Soll-Abgleich, 10–20 = Bereiche). Gesendet wird
`_helfer.sql` + (im Mutations-/Ausführlich-Modus ein Schalter) + Testdatei. Der Runner prüft jede Datei vor dem
Senden und bricht sonst ab:

- Kopf: `-- @bereich:`, `-- @ziel:` (mehrzeilig möglich) und **mindestens zwei**
  `-- @mutation <name>: <Beschreibung> | rot: <Muster der Prüfnamen>` (Muster = regulärer Ausdruck, gilt für den
  ganzen Prüfnamen, z. B. `abo_.*|insert_fremd`).
- Oberste Ebene nur `CREATE FUNCTION pg_temp.<eigenes_präfix>_…` (z. B. `pg_temp.t10_…`; `s112_*` ist
  `_helfer.sql` vorbehalten) und **genau ein** `DO $test$ … $test$;` als letzte Anweisung.
- Erste Anweisung im Block `PERFORM pg_temp.s112_nur_staging();`, letzte `PERFORM pg_temp.s112_ende(…);` direkt
  vor dem abschließenden `END` und auf Tiefe 1. Der äußere Block hat **keinen EXCEPTION-Teil** – der Runner
  verfolgt die BEGIN/END-Tiefe (END IF/LOOP zählen nicht) und lehnt ein EXCEPTION auf Tiefe 1 ab: stünde
  `s112_ende` im Handler, liefe es ohne Fehler nie, und der Block endete ohne `RAISE` = festgeschrieben.
- `DECLARE` nur mit Konstanten, `gen_random_uuid()`, `clock_timestamp()` u. Ä. – alles andere liefe **vor** dem
  Wächter (Aufbau also nach `BEGIN`: `v_a := pg_temp.s112_aufbau();`).
- Verboten (auch in `EXECUTE`-Strings): `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `BEGIN;`, `START/PREPARE TRANSACTION`,
  `END WORK`, `ABORT`, `ALTER SYSTEM/DATABASE/ROLE`, `COMMENT ON DATABASE`, `CREATE EXTENSION`, `dblink`,
  `pg_terminate_backend`, `COPY … PROGRAM`, Ändern/Löschen von `pg_temp`-Funktionen; im Block kein `RETURN` und
  keine `<<Labels>>` (der Block endete sonst ohne `RAISE` = festgeschrieben). Diese Wörter deshalb auch nicht in
  Meldungstexten verwenden (in Kommentaren sind sie erlaubt). Replikationsmodus und Trigger-Abschalten sind
  ohnehin tabu (`scripts/check-replica.js`, auch ohne Ausnahme-Marker).

```sql
-- @bereich: Mandantentrennung
-- @ziel: Benutzer aus B sehen und ändern keine Zeilen des Musterhofs.
-- @mutation kontakte_offen: PERMISSIVE-Policy USING (true) auf kontakte | rot: fremd_.*
-- @mutation insert_offen: PERMISSIVE-Policy WITH CHECK (true) auf kontakte | rot: insert_fremd
DO $test$
DECLARE
  c_datei constant text := '10_mandanten';          -- = Dateiname ohne .sql (der Runner prüft das)
  v_t0    timestamptz := clock_timestamp();
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_z     jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_a := pg_temp.s112_aufbau();                     -- als postgres: Betrieb B + Personas
  v_z := pg_temp.s112_beispiel('kontakte', (v_a ->> 'm')::uuid);   -- Zeile im Musterhof
  -- Mutationen: nach dem Aufbau, vor den Prüfungen, auf oberster Ebene
  PERFORM pg_temp.s112_mutiere('kontakte_offen', $m$CREATE POLICY s112test_m ON public.kontakte FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('insert_offen', $m$CREATE POLICY s112test_i ON public.kontakte FOR INSERT TO authenticated WITH CHECK (true)$m$);

  -- „0 Zeilen sichtbar“ nur werten, wenn vorher als postgres belegt ist, dass die Zeile existiert
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_existiert', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE %s', pg_temp.s112_pk_where('kontakte', v_z))), '1');
  PERFORM pg_temp.s112_als((v_a ->> 'b_w')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_unsichtbar', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE %s', pg_temp.s112_pk_where('kontakte', v_z))), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('insert_fremd', pg_temp.s112_versuch(pg_temp.s112_klon_sql('kontakte', v_z)), 'R');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 3);   -- wirft IMMER → alles zurückgerollt
END
$test$;
```

## Hilfsfunktionen (`_helfer.sql`, alle in `pg_temp`, immer qualifiziert aufrufen)

| Funktion | Zweck |
|---|---|
| `s112_nur_staging()` | Wächter, erste Anweisung jedes Blocks |
| `s112_als(uid, rolle='authenticated', aal='aal1')` | als Benutzer weiter (`s112_als(NULL, 'anon')` für anon); setzt Claims, `SET LOCAL ROLE`, leert `app.active_tenant_id`, `s112.protokoll_aus`, `storage.allow_delete_query` |
| `s112_als_postgres()` | zurück zu postgres, Claims geleert (sonst hält `ist_service_kontext()` die Sitzung für authenticated) |
| `s112_versuch(sql)` | ausführen und **sofort zurückrollen** → `k<n>` (Erfolg, n Zeilen), `R` (RLS lehnt neue Zeile ab), `G` (Recht fehlt), `T` (anderes 42501, Trigger/RPC), `E<sqlstate>` |
| `s112_zaehle(sql)` | ein Wert als Text (`'0'`, `'15'`) oder Fehlercode wie oben |
| `s112_fehlertext(sql)` | `'ok'` oder `'<SQLSTATE>: <Meldung> \| HINT: …'` (Erfolg bleibt bestehen) |
| `s112_policy(tab, cmd, zeile)` | Policy-Schicht (PERMISSIVE OR, RESTRICTIVE AND; UPDATE = USING und WITH CHECK) für eine Zeile als aktive Rolle → `'ja'`/`'nein'`/Fehlercode – für UPDATE/DELETE fremder oder unlesbarer Zeilen (siehe Fallen) |
| `s112_erwarte(name, ist, soll)` / `s112_ok` / `s112_fehler(name, beleg)` | Ergebniseinträge `OK:…` / `FEHLER:…` |
| `s112_bekannt(titel, beleg)` | bekannte Lücke (`BEKANNT:<titel> [<beleg>]`), Titel mit Lücken-ID beginnen |
| `s112_luecke(name, ist, soll_sicher, ist_bei_luecke, titel)` | Ratsche: Lücke unverändert → BEKANNT, behoben → FEHLER „BEHOBEN – in harte Prüfung umwandeln“, sonst FEHLER |
| `s112_baseline(name, ist, baseline, titel[, beleg])` | aggregierte Lücke: gleich → BEKANNT, mehr → FEHLER, weniger → FEHLER „BEHOBEN – Baseline senken“ |
| `s112_mutiere(name, sql)` | Mutation anwenden, wenn der Lauf sie verlangt (als postgres), und für `s112_ende` belegen |
| `s112_ende(datei, erg, t0, min_pruefungen)` | zählt und wirft `S112TEST\|…` (P0001); zu wenige Prüfungen = FEHLER |
| `s112_betrieb(name, stripe_status)` | neuer Betrieb (tenants + tenant_einstellungen, ohne PLZ) |
| `s112_benutzer(rolle, tenant, schreibmodule, aktiv)` / `s112_mitglied(…)` | Test-Benutzer `s112test-<uuid>@software112.test` + Mitgliedschaft |
| `s112_plattform_admin(betriebe)` / `s112_faktor(uid, status='verified')` | Test-Plattform-Admin / TOTP-Faktor |
| `s112_aufbau(mit_c=false)` | Standard-Personas → jsonb (siehe unten) |
| `s112_klasse(tab)` / `s112_mandantentabellen()` | T (tenant_id) / K (Kind über FK) / G (global); Eltern-FK, No-op-UPDATE-Spalte, PK |
| `s112_zeile(tab, tenant, werte)` | generische Beispielzeile (Pflichtspalten, FKs im selben Betrieb, CHECK-Literale) |
| `s112_keine_eltern(ids)` / `s112_keine_eltern_liste()` | Zeilen, die `s112_zeile`/`s112_beispiel` nicht als vorhandene Elternzeile wählen (Probezeilen, deren Löschen geprüft wird – sonst hängt sich je nach zufälliger UUID eine später angelegte Zeile an sie und eine Löschsperre greift; Datei 14 kippte so). Nur im Hauptblock aufrufen |
| `s112_beispiel(tab, tenant, persona, werte)` | vollständige Beispielzeile für Positivkontrollen (Eigentümerspalten = Persona, AMA-Entwurf, Mehrspalten-CHECKs) – deckt alle 98 Nicht-G-Tabellen in B ab |
| `s112_klon_sql(tab, zeile, änderungen)` / `s112_klon(…)` | Kopie einfügen (für `s112_versuch` bzw. als postgres) |
| `s112_pk_where(tab, zeile)` | typisierte PK-Bedingung (`%I = %L::<typ>`) |
| `s112_soll()` | Rollenmatrix (tabelle, aktion, rollen, module, roh) aus `inventar/matrix.txt` |
| `s112_soll_liste(art)` | Soll-Listen: `geheimnis_spalten`, `public_policies`, `g_tabellen`, `protokoll_tabellen` (42), `loeschsperre_tabellen` (26; KAN-150 F2a: + Anträge, Analysen, Export), `stammdaten_loeschsperre` (KAN-150 F1a: 9 Stammdatentabellen mit `a_stammdaten_loeschsperre`), `abo_ausnahmen`, `abo_status_gesperrt`, `anon_execute_erlaubt`, `anon_execute_bekannt`, `tid_nullable`, `tid_ohne_fk`, `truncate_authenticated`, `truncate_anon`, `schreibmodule`, `abo_rpc_ausnahmen` (schreibende SECURITY-DEFINER-RPCs ohne Abo-Prüfung, begründet), `ptz_ausnahmen` (INVOKER-Funktionen mit `p_tenant_id` ohne `pruefe_tenant_zugriff`) |
| `s112_soll_rpc()` | Einstufung der 93 SECURITY-DEFINER-Funktionen (Stand KAN-150 F2a) (`rls_hilfe`, `mandant`, `mandant_eigen`, `session_user`, `intern`, `trigger`), Soll-Rechte `A/U/S`, Abo-Prüfung |

Ergebnisse gehören in die lokale Variable `v_erg text[]` – nicht in GUCs (ein scheiternder Unterblock setzt sie
zurück) und nicht in temporäre Tabellen (authenticated darf die von postgres nicht lesen). Rollen- und
Claim-Wechsel in einem scheiternden Unterblock werden mit zurückgerollt.

### Personas (`s112_aufbau()`)

Nur neue Test-Benutzer; die vier Staging-Konten bleiben unberührt. `m` = Musterhof
`33333333-3333-4333-8333-333333333333`, `b` = neuer Betrieb B (`c` nur mit `s112_aufbau(true)`).

`pa` Test-Plattform-Admin (system_admin in M, B, C) · `m_sa` system_admin ohne Plattform-Admin · `m_ta`, `b_ta`
tenant_admin · `m_w`, `b_w` winzer mit allen 6 Modulen · `m_wc` winzer nur `crm` · `m_w0` winzer ohne Modul (`'{}'`)
· `m_l`, `b_l` leser · `m_inak` winzer inaktiv · `mb_ta` tenant_admin in M **und** B · `mix` aktiv in B, inaktiv in
M · `ohne` angemeldet ohne Betrieb · `c_ta` tenant_admin C.

### Fallen (belegt)

- Der **Musterhof ist fest von der Abo-Sperre ausgenommen** – Abo-Tests immer in B (`s112_betrieb(…, 'canceled')`
  oder `UPDATE tenants SET stripe_status …` als postgres).
- Jeder neue Betrieb bekommt **alle Plattform-Admins** automatisch als system_admin (`trg_tenant_plattform_admins`).
- winzer mit `schreibmodule` NULL bekommt alle 6 Module; `'{}'` bleibt leer; andere Rollen bekommen NULL.
- `create_profile_on_signup` ist auf Staging toter Code (42P10, verschluckt); `handle_new_user` legt das Profil an.
- `bestandsprotokoll_id_seq` und `system_ereignisse_id_seq` sind nicht transaktional (harmlose Nummernlücken).
- RLS-WITH-CHECK greift vor NOT NULL: `INSERT (tenant_id)` in den eigenen Betrieb → `E23502`, in einen fremden → `R`.
  Positivkontrollen brauchen deshalb vollständige Zeilen (`s112_beispiel`).
- `ki_readonly_query` setzt `app.active_tenant_id` transaktionslokal (danach sähe man auf GUT-Tabellen nur diesen
  Betrieb) – `s112_als` setzt den Schalter zurück.
- Storage: DELETE auf `storage.objects` braucht `set_config('storage.allow_delete_query', 'true', true)`, sonst 42501
  (`storage.protect_delete`). Staging hat keine Storage-Objekte – Tests legen eigene an (Pfad beginnt mit der
  tenant_id, Name mit `s112test`). Policies auf `storage.objects` gehören `supabase_storage_admin` (postgres ist kein
  Mitglied): Storage-Mutationen laufen über `public.s112_meine_tenants`, `s112_darf_schreiben`, `user_has_role_in_tenant`.
- Auf Staging: alle 19 Musterhof-Behälter haben `gemeinsam = true`; es gibt keine globalen `duengemittel`,
  `pflanzenschutzmittel` oder `saetze_massnahmen` – Tests legen sie selbst an.
- `crm_dubletten`, `crm_filterwerte`, `crm_zaehler`, `lade_behaelter`, `lade_kellergemeinschaft` und
  `kontakte_zusammenfuehren` erlauben bei `session_user = postgres` – über die Management-API nur statisch prüfbar.
- Im Musterhof kollidieren manche Beispielzeilen mit vorhandenen Schlüsseln (`module_flags`); dann Werte über
  `werte` vorgeben. In B deckt `s112_beispiel` alle Nicht-G-Tabellen ab.
- `current_setting('…', true)` liefert nach einem gescheiterten Setzversuch `''` statt NULL – immer `nullif(…, '')`.
- **UPDATE/DELETE per `WHERE <pk>` ist für unlesbare Zeilen wertlos**: sobald WHERE (oder SET/RETURNING) eine Spalte
  nennt, wendet PostgreSQL zusätzlich die SELECT-Policies an – eine fremde oder für die Rolle unlesbare Zeile ergibt
  immer `k0`, egal was die UPDATE-/DELETE-Policy erlaubt. `DELETE FROM tab` ohne WHERE bzw. `UPDATE tab SET x = <Literal>`
  prüft dagegen nur die DELETE-/UPDATE-Policy (belegt: zusätzliche `FOR DELETE USING (true)` auf `zeiterfassung` →
  per PK `k0`, ohne WHERE `k1`). Deshalb die Policy-Schicht zusätzlich mit `s112_policy` auswerten (11: `*_policy`-
  Prüfungen, 12: `t12_wirkung`, 17: `t17_policy`); `SET x = x` ohne WHERE reicht NICHT (Spaltenbezug im SET).

## Bekannte Lücken und Ratsche

Echte Sicherheitslücken lassen die Suite **nicht** scheitern: sie zählen als BEKANNT (`s112_bekannt`,
`s112_luecke`, `s112_baseline`) und stehen in jedem Lauf im Block „Bekannte Lücken“. Wird eine Lücke behoben,
wird die Prüfung rot („BEHOBEN – …“), bis sie in eine harte Prüfung umgewandelt bzw. die Baseline gesenkt ist –
so kann sie nicht still wieder aufgehen. `--streng` macht jede BEKANNT-Meldung rot.

Titel immer mit der Lücken-ID beginnen (der Runner dedupliziert über den Titel):

| ID | Lücke (Stand Planungsprobe 28.09.2026) |
|----|--------|
| ~~B1~~ | behoben (KAN-159, 29.09.2026): Zahlung auf einen fremden Verkaufsposten wird abgelehnt – 11 |
| ~~B2~~ | behoben (KAN-178, 04.10.2026): alle 92 Fremd-FK-Spalten prüft der Trigger `s112_fremdverweis_pruefen` (eigener Betrieb; global bei PSM/Dünger/Kategorien; Partner der Kellergemeinschaft bei Behältern; Kindtabellen über die Elternzeile) – 11, harte Prüfung |
| ~~B3~~ | behoben (KAN-159 Teil 2, 04.10.2026): Profile nur eigenes Umfeld (gemeinsame Betriebe, Plattform-Admin alle), Policy `profiles_lesen` – 10 |
| ~~B4~~ | behoben (KAN-159 Teil 2): `get_user_tenant_ids` nur aktive Mitgliedschaften – inaktives Mitglied sieht die `tenants`-Zeile nicht mehr – 13 (RPC-Teil: KAN-127) |
| ~~B5~~ | behoben (KAN-159 Teil 2): `mitgliedschaft_aktiv` NULL-sicher auch auf den vier Tabellen mit globalen Zeilen – 01, 13 |
| ~~B6~~ | behoben (KAN-159, 01.10.2026): `ki_readonly_query` liest nur den aktiven Betrieb – RESTRICTIVE-Policy `ki_aktiver_betrieb` auf allen KI-Tabellen mit `tenant_id` – 18, Regel für neue KI-Tabellen in 01 |
| ~~B7~~ | behoben (KAN-149 D3, 01.10.2026): Periodensperre (`a_ea_periodensperre`), unveränderlicher Abschluss (`a_ea_abschluss_schutz`: Monatsabschluss, gesperrte UVA, verbuchte Belege) und Löschsperre für Verkauf/E-A in der Datenbank – 20 |
| ~~B8~~ | behoben: Storno (KAN-149 D1), AMA (KAN-148 C2), abgeschlossener Jahrgang (KAN-159 Teil 2, Trigger `a_jahrgang_abschluss_schutz`, AMA-Felder frei) – 20 |
| ~~B9~~ | behoben (KAN-159): schreibende RPCs prüfen das Schreibmodul (`s112_pruefe_schreibmodul`); `is_locked` beim Kontenabgleich bewusst offen – 18 |
| ~~B10~~ | behoben (KAN-159 Teil 2): anon/PUBLIC-EXECUTE nur noch `s112_pre_request` – 01, 18 |
| ~~B11~~ | behoben (KAN-159 Teil 2): keine Triggerfunktion mit EXECUTE für authenticated – 18 |
| ~~B12.1~~ | Soll (Entscheidung Jörgen 04.10.2026): wer im CRM schreiben darf, löscht auch Dokumente anderer Mitglieder – wie die App; hart geprüft (k1) – 12 |
| ~~B13~~ | behoben (KAN-159): Benutzer ändern an `benachrichtigungen` nur `gelesen_am` (Spaltenrecht) – 11 |
| ~~B14~~ | behoben (KAN-159 Teil 2, Entscheidung Jörgen 04.10.2026): Assistent-Verläufe privat je Benutzer – 10, 12 |
| ~~B15~~ | behoben (KAN-159 Teil 2): die sechs RPCs mit eigener Mitgliedsprüfung prüfen `s112_aal_ok` und den deaktivierten Betrieb – 15 |
| ~~B16~~ | behoben (KAN-159 Teil 2, Entscheidung Jörgen 04.10.2026): deaktivierter Betrieb (`tenants.active = false`) wie inaktive Mitgliedschaft – `s112_betrieb_gesperrt` in `s112_gesperrte_tenants`, `s112_meine_tenants`, `get_user_tenant_ids`, `user_has_role_in_tenant`, `pruefe_tenant_zugriff`; Plattform-Admins ausgenommen – 13 |
| ~~B17~~ | behoben (KAN-195, 04.10.2026): Paket-Module (E&A, Export, SumUp, Kostenrechnung, Assistent) sperren das Schreiben in der DB – Policies `paketmodul_*` mit `s112_paketmodul_frei`, E&A-RPCs mit `s112_pruefe_paketmodul`; Kernmodule bleiben frei; Plattform-Admin/Service-Role ausgenommen – 01, 12. Vorher: Modul-/Paketschalter (`tenant_einstellungen.modul_*`, `module_flags`) werden beim Schreiben nicht in der DB durchgesetzt: mit allen Schaltern aus legen tenant_admin und Winzer per Direkt-API weiter `kontakte`, `weinausbau`, `weingarten`, `verkaufsposten`, `ea_transaktionen`, `exportauftraege` an (die modul_*-Policies prüfen nur die Schreibmodule der Mitgliedschaft; Soll: durchsetzen, eigenes Folgeticket) – 12 |
| ~~BK4~~ | behoben (KAN-159, 04.10.2026): `kontakte.newsletter_token_hash` enthält nur den SHA-256-Hash des Double-Opt-in-Tokens, der Klartext steht nur im Link – 01 |
| Baselines | keine mehr: `tenant_id` ohne FK nur noch bewusst `bestandsprotokoll`/`system_ereignisse` (BK3 seit KAN-159 Teil 2), anon-EXECUTE (B10) und TRUNCATE (BK1/BK2) hart geprüft (01, 18) |

## Mutationsprüfung (`--mutationen`)

Jede im Kopf deklarierte Mutation läuft einzeln: `run.mjs` ersetzt `pg_temp.s112_mutation()`, die Datei wendet
sie mit `pg_temp.s112_mutiere('<name>', $m$…$m$)` an (DDL oder Funktionsersatz in derselben, zurückgerollten
Transaktion). Erwartet: `fehler ≥ 1`, mindestens ein FEHLER-Name passt aufs Muster, und `mutation=<name>` in der
Ergebniszeile belegt die Anwendung – sonst „überlebt“ (Exit 1). Mutationen halten für einige Sekunden Sperren auf
Staging-Tabellen und laufen deshalb nur auf Anforderung.

## Pflege

- **Neue Tabelle** → `s112_soll()` (Rollenmatrix) ergänzen, sonst sind 01 und 12 rot.
- **Neue SECURITY-DEFINER-RPC** → `s112_soll_rpc()` einstufen, sonst sind 01 und 18 rot. Schreibt sie (INSERT/UPDATE/
  DELETE/ON CONFLICT im Quelltext) und nimmt `p_tenant_id`, verlangt 01 (`rpc_schreibt_ohne_abo`) den Aufruf von
  `s112_pruefe_abo_schreibsperre` – unabhängig vom Flag `abo`; Ausnahmen nur begründet in
  `s112_soll_liste('abo_rpc_ausnahmen')` und mit Ist-Stand in 14.
- **Neue INVOKER-Funktion mit `p_tenant_id`** und EXECUTE für authenticated → `pruefe_tenant_zugriff` aufrufen,
  sonst ist 01 rot (`ptz_invoker`); Ausnahmen begründet in `s112_soll_liste('ptz_ausnahmen')`.
- **Neue Stammdatentabelle mit Löschsperre** (`a_stammdaten_loeschsperre`, KAN-150 F1a) → `s112_soll_liste('stammdaten_loeschsperre')`
  (Katalog in 20; 13 und 14 ersetzen Beispielzeilen mit Bezug durch frische Zeilen ohne Bezug).
- **Neues Geheimnis** → `s112_soll_liste('geheimnis_spalten')` (01, 16).
- **Lücke behoben** → `s112_luecke` in eine harte Prüfung umwandeln bzw. Baseline in `s112_soll_liste` senken.
- **Nach jeder Migration mit RLS-, Trigger- oder RPC-Änderung**: zuerst auf Staging einspielen, dann
  `npm run test:db`, erst danach Produktion.
- Ein CI-Job (workflow_dispatch + wöchentlich, Secret `SUPABASE_ACCESS_TOKEN`) kommt erst nach Jörgens OK.
