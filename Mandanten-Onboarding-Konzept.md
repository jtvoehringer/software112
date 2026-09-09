# Konzept: Onboarding neuer Mandanten

Stand: 14.08.2026. Ausgangspunkt: Logo jetzt per Datei-Upload möglich (siehe
`commit-mandant-logo-upload.ps1`). Diese Notiz beantwortet Punkt 3 ("bester
Weg für Mandanten-Onboarding") und legt die offene Entscheidung zu Punkt 2
(Gebeshuber-Sonderfall) konkret vor.

## 1. Was heute schon vorhanden ist

Ich habe den bestehenden Code genau angesehen, bevor ich etwas vorschlage –
die gute Nachricht: der Großteil der Infrastruktur für "leerer Mandant +
Dateiimport" existiert bereits.

- **"Neuer Mandant" (admin/mandanten → `createMandant`)**: legt heute schon
  einen komplett leeren Mandanten an (nur `name` + `slug` in `tenants`,
  keine Kopie von Modul-Toggles, keine Stammdaten). Migration 159
  (Sandbox-Basis für Gebeshuber) war eine bewusste Einmal-Ausnahme, kein
  Bestandteil des normalen "Neuer Mandant"-Flows. Punkt 2 ist also für alle
  *künftigen* Mandanten bereits erfüllt, ohne dass ich etwas ändern muss.
- **Branding** (Anzeigename, Logo, Farben) – jetzt inkl. Datei-Upload.
- **Module-Toggles** (CRM, Kellerbuch, Weingarten, E/A, SumUp, Export,
  Assistent) – manuell im Branding-Tab, bewusst nicht automatisch von der
  Sandbox übernommen.
- **Benutzerverwaltung**: System-Admin lädt den ersten Benutzer
  (Betriebsleiter/`tenant_admin`) über `admin/mandanten/[id]` ein; danach
  kann der `tenant_admin` selbst weitere Benutzer über `/benutzer`
  verwalten (inkl. Aktiv/Inaktiv-Toggle aus der letzten Änderung).
- **Datenimport (`/admin/import`)**: fertiges CSV-Import-Werkzeug mit
  Spalten-Mapping für Kontakte, Firmen, Füllungen (Weinlager-Bestand),
  Rieden (nur Name/Notizen) und Gebinde – plus eine
  Anfangsbestandsbuchung, um eine einzelne Charge mit Restbestand aus
  einem Altsystem direkt in ein Gebinde einzubuchen.

## 2. Die Lücke

Der Datenimport deckt **Weingärten und Grundstücke (GST-Nummern) nicht ab**
– nur den reinen Riednamen. Genau das war der Grund, warum ich für
Gebeshuber eine handgeschriebene SQL-Migration (159) mit fix codierten
Spaltenlisten für `lagen` → `weingarten` → `grundstuecke` →
`weingarten_rebsorten` bauen musste. Ohne diese Lücke zu schließen, würde
jeder künftige Mandant mit eigenen Weingärten wieder eine Sondermigration
von mir brauchen – das widerspricht der von dir gewünschten
Dateiimport-Logik.

**Vorschlag**: Den Datenimport um zwei neue Typen erweitern, analog zu
"Rieden"/"Gebinde":

- **Weingärten**: Name*, Ried (Textabgleich gegen vorhandene Rieden – bei
  keinem Treffer wird die Ried automatisch mit angelegt, wie es intern bei
  `assignWeingartenToLage` schon funktioniert), Rebsorte, Pflanzjahr,
  Bewirtschaftung, Fläche (ha).
- **Grundstücke**: GST-Nr*, Weingarten (Textabgleich gegen Name),
  Katastralgemeinde-Nr, Fläche lt. AMA, Fläche lt. Kataster, Rebsorte,
  Status.

Damit wäre der komplette in Punkt 4 genannte Fall ("übrige Stammdaten
NICHT übernehmen, außer Rieden/GST als Sonderfall") für alle künftigen
Mandanten ohne meine Mitwirkung selbst erledigbar – reiner
CSV-Upload durch den `tenant_admin`.

## 3. Vorgeschlagener Standard-Ablauf für einen neuen Mandanten

1. System-Admin: "Neuer Mandant" (Name) – startet leer.
2. System-Admin: Branding (Anzeigename, Logo hochladen, Farben).
3. System-Admin: benötigte Module aktivieren.
4. System-Admin: Rechnungs-/Kundennummern-Kreis + USt-Satz setzen (die
   Felder, die bei Gebeshuber aus der Sandbox kopiert wurden – hier würde
   ich vorschlagen, im "Neuer Mandant"-Dialog gleich sinnvolle
   Standardwerte vorzubelegen, z. B. USt 20 %, statt komplett leer zu
   starten. Diskussionspunkt, keine Vorentscheidung meinerseits.)
5. System-Admin: ersten Benutzer (Betriebsleiter) einladen.
6. `tenant_admin`: Stammdaten per Datenimport einspielen – Kontakte,
   Firmen, Gebinde, Füllungen, **neu: Weingärten + Grundstücke**.
7. `tenant_admin`: bei Bedarf Anfangsbestandsbuchungen für Gebinde
   (Restbestand aus Altsystem).
8. `tenant_admin`: verwaltet weitere Benutzer selbst über `/benutzer`.

Die bereits vorhandene Onboarding-Checkliste in
`admin/mandanten/[id]/MandantDetailClient.tsx` (der `CheckItem`-Block ganz
unten) bildet einen Teil davon schon ab – die könnte ich um die neuen
Datenimport-Schritte ergänzen, sodass sie den kompletten Ablauf oben
1:1 als abhakbare Liste zeigt.

## 4. Offene Entscheidung: Gebeshuber selbst

Du hast es explizit offengelassen, ob Gebeshuber beim aktuellen
Sonderfall (Rieden/Weingärten/GST aus der Sandbox kopiert) bleibt, oder ob
wir es nachträglich auf den neuen "leer + Dateiimport"-Weg umstellen. Zwei
Optionen, beide technisch machbar:

**A – So lassen (empfohlen für jetzt):** Gebeshuber bleibt die
dokumentierte Ausnahme, genau wie ursprünglich besprochen. Kein weiterer
Eingriff nötig, keine Gefahr, bereits im System erfasste/bearbeitete Daten
zu verlieren.

**B – Zurücksetzen und neu befüllen:** Die kopierten
Rieden/Weingärten/Grundstücke bei Gebeshuber werden gelöscht, der Mandant
wird danach über den neuen Import-Weg (Punkt 2 oben) neu befüllt. Das
setzt voraus, dass die Weingärten/Grundstücke-Importtypen zuerst gebaut
sind, und dass seit der Anlage noch niemand Daten zu diesen Rieden/GSTs in
Gebeshuber erfasst hat (sonst gehen die verloren).

Ich habe bewusst nichts an den Gebeshuber-Daten verändert, bis du dich
entschieden hast.

## Nächste Schritte

Sobald du zurück bist: kurz sagen, ob ich (1) die Weingärten-/
Grundstücke-Importtypen bauen soll, und (2) welche Option (A/B) für
Gebeshuber gilt. Der Logo-Upload ist unabhängig davon bereits fertig und
liegt zum Committen bereit.
