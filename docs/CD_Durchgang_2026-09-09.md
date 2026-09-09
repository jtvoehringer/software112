# CD-Durchgang 9.9.2026 – Bestandsseiten auf hohenstein-Tokens

Mechanischer Durchgang über alle `src/**/*.ts(x)` (204 Dateien, ca. 3.900 Zeilen):
die Tailwind-Standardpalette (gray/red/green/amber/blue/purple …) und die Alt-Tokens
(`s112-navy`, `text-s112-teal` als Linkfarbe) wurden nach fester Ersetzungstabelle auf
das Design-System aus dem HC CD-Manual umgestellt. `tsc --noEmit` ist danach fehlerfrei.

## Ersetzungstabelle

| Bestand | Neu (Token) | Begründung |
|---|---|---|
| `text-gray-900/800` | `text-s112-text` (#22252B) | Fließtext, Überschriften, Zahlen |
| `text-gray-700` | `text-s112-text-1` (#5A5D66) | sekundärer Text |
| `text-gray-600/500` | `text-s112-text-2` (#6E717A) | Labels, inaktive Icons |
| `text-gray-400/300` | `text-s112-tertiary` (#A0A3AB) | Meta-Text, Platzhalter |
| `bg-gray-50` / `-100` / `-200` / `-300` | `bg-s112-bg` / `bg-[#F2F3F5]` / `bg-s112-line` / `bg-s112-line-str` | Grau-Stufen des Manuals |
| `border-gray-100/200` / `-300/400` | `border-s112-line` / `border-s112-line-str` | Linie / Rahmen |
| `red`/`rose` (Text, Fläche, Rahmen) | `s112-err`, `s112-err-fg`, `s112-err-bg`, `err/30` | Signalfarbe Fehler |
| `green`/`emerald`/`lime` | `s112-ok`, `s112-ok-fg`, `s112-ok-bg`, `ok/30` | Signalfarbe OK |
| `amber`/`yellow`/`orange` | `s112-warn`, `s112-warn-fg`, `s112-warn-bg`, `warn/30` | Signalfarbe Warnung |
| `blue`/`sky`/`indigo` | `s112-blue-700` (Text), `blue-50` / `blue-100` (Flächen), `s112-teal` (Buttons) | Blauskala des Manuals |
| `purple`/`violet`/`pink`/`fuchsia`/`teal`/`cyan` (Kategorie-Chips) | neutral: `text-s112-text-1`, `bg-[#F2F3F5]`, `border-s112-line-str` | CD: Farbe ist kein Gestaltungsmittel |
| `text-s112-teal` (Links, Icons) | `text-s112-blue-700` (#2F63AC) | Blau 700 = blauer Text auf Hell (AA); Aktion-Blau bleibt für Buttons |
| `text-s112-navy` / `bg-s112-navy` (Kopfzeile) | `text-s112-text` / `bg-s112-text` (Anthrazit) | Navy #0E3C62 ist nicht im CD |
| `font-bold` / `font-extrabold` | `font-semibold` | Poppins SemiBold / Plex Sans SemiBold |
| `rounded-2xl` | `rounded-xl` | Radius des Design-Systems (12 px) |
| `shadow-md` | `shadow-sm` | flache Karten; `shadow-lg/xl` bleiben für Modale |

Hex-Werte außerhalb von Tailwind (Kellerplan-Editor, CRM-Kalender, Rechnungs-PDF,
Weinpass, Nachrichten-Vorschau) wurden auf die CD-Werte gesetzt; Behältertypen im
Kellerplan werden jetzt über Grau-/Blau-Stufen statt Signalfarben unterschieden.

## Manuelle Nacharbeiten im Durchgang

- Bestätigungs-Buttons in Warn-Dialogen (`bg-amber-600 text-white`, z. B. „Trotzdem übernehmen“, „Schwund buchen“) → `bg-s112-warn-fg text-white` (Kontrast), Hover `opacity-90`.
- Grüne/amberfarbene Aktions-Buttons ohne Warn-Kontext („+ Anlegen“, „Schließen“) → Aktion-Button `bg-s112-teal text-s112-yellow hover:bg-s112-blue-700`.
- Lead/Kunde-Umschalter: Lead grau statt amber.
- Weinart-Punkte (weiß/rot/rosé) neutral (tertiary / text / grey) statt warn/err.
- Hover-Zustände, die nach der Ersetzung mit dem Grundzustand identisch waren, auf `hover:opacity-75`, `hover:bg-s112-line`, `hover:bg-s112-blue-700` usw. gesetzt.
- `globals.css`: `.card` rounded-xl, `.input`/`.form-input` Rahmen `line-str` + Platzhalter `tertiary`, `.form-label` `text-1`, `.btn-secondary` Blau 700 mit neutralem Rahmen, `.nav-item.active` Blau 50 / Blau 700; Alt-Variablen `--s112-navy/green/blue` auf CD-Werte gesetzt.

## Nicht angefasst

- `text-s112-muted` / `border-s112-border` (Aliase mit identischen Werten) – bewusst belassen, um den Diff klein zu halten.
- Zwei Dateien in tiefer Verzeichnisebene (`kellerbuch/weinausbau/[id]/analysen/neu/page.tsx`,
  `api/crm/aktivitaet/[id]/dokument/[dok_id]/route.ts`) – konnten nicht übertragen werden;
  bei Bedarf `python cdpass.py src` lokal laufen lassen (Skript im Patch-Ordner).
- Mandanten-Override: `s112-teal`/`s112-yellow` bleiben pro Mandant über `primary_color` / `secondary_color` überschreibbar.
