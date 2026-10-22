# Meldungskonzept (KAN-359, verbindlich seit 22.10.2026)

**Anlass:** UAT-Befund (Paul): „Alle Warnhinweise, Fehlermeldungen sind unterschiedlich und an verschiedenen Plätzen –
Pop-up rechts unten, Pop-up, Warnhinweis oben, etc.“
**Entscheidung Jörgen (22.10.2026):** vor dem Echtbetrieb einheitlich nach den drei Mustern unten.

Browser-Dialoge (`window.confirm`, `alert`, `prompt`) gibt es nicht mehr – der Wächter `scripts/check-rueckfragen.js`
(prebuild, CI) lässt den Build sonst scheitern.

## Die drei Muster

| Was | Wo | Baustein |
|---|---|---|
| **Fehler** (etwas ging nicht, Eingabe fehlt) | direkt am Feld bzw. im Formular, als roter Meldungskasten mit `role="alert"` | Meldungskasten im Formular; Feldfehler mit `aria-describedby` |
| **Erfolg** (gespeichert, gebucht) | kurzes Pop-up an **einer** Stelle: am Handy oben unter der Kopfleiste, ab md unten rechts | `zeigeErfolg(text)` bzw. `<ErfolgsMeldung text={…} />`; nach Redirect `zielNachVorgang(…, 'gespeichert')` |
| **Rückfrage** (vor Löschen, Entziehen, Unumkehrbarem) | eigener Dialog in der Bildmitte (am Handy unten angedockt) | `await rueckfrage({ titel, text, bestaetigen, gefaehrlich })` |

### 1. Fehler – am Feld bzw. Formular

- Der Text steht **nur** dort, wo der Fehler entstand: im Formular (Kasten oben bzw. über dem Knopf) oder am Feld.
- Kasten: `bg-s112-err-bg border … text-s112-err-fg` mit `role="alert"` (Wächter `check-meldungen`).
- Feldfehler: kleiner Text unter dem Feld mit `id`, das Feld bekommt `aria-describedby` (und `aria-invalid`), wo das
  Formular schon feldweise prüft.
- Fehler bei Aktionen in Listen (Löschen-Knopf in einer Zeile): Meldungskasten über der Liste bzw. an der Zeile
  (Beispiel `LoeschenButton`, `StornoButton`).
- Liegt der Kasten außer Sicht (langes Formular, „Speichern“ unten), erscheint im Pop-up-Bereich nur der Hinweis
  **„Es gibt eine Fehlermeldung außer Sicht.“** mit **„Zur Meldung“** (`MeldungsPopup`) – kein zweiter Ort für den Text.
- Eingaben bleiben nach einem Fehler stehen.

### 2. Erfolg – kurzes Pop-up an einer Stelle

- `zeigeErfolg('Gespeichert.')` (aus `src/lib/ui/erfolg.ts`) direkt nach einer erfolgreichen Aktion, oder
  `<ErfolgsMeldung text={ok} />` statt eines grünen „Gespeichert.“-Kastens (zeigt den Text, sobald er gesetzt wird).
- Nach einem Redirect: Ziel mit `zielNachVorgang(standard, '<schlüssel>')`, `hierBleiben()` bzw. serverseitig
  `zielNachAbschluss(…)` – der Parameter `erledigt=<schlüssel>` (Text aus `ERLEDIGT_TEXT`) wird von `ZurueckLeiste`
  in das Pop-up umgeleitet und fällt danach aus der URL.
- Das Pop-up hat `role="status"`, verschwindet nach 5 Sekunden, lässt sich schließen (✕, Esc) und bleibt über einen
  Seitenwechsel erhalten.
- Ergebnisse mit Inhalt (Importbericht, gebuchte Umzüge mit Links, Support-Bestätigung mit Nummer) bleiben als
  Ergebniskasten mit `role="status"` an ihrer Stelle; erscheint so ein Kasten nach einer Aktion außer Sicht, kommt sein
  Text zusätzlich als Erfolgs-Pop-up.

### 3. Rückfrage – eigener Dialog

```ts
import { rueckfrage } from '@/lib/ui/rueckfrage'

if (!(await rueckfrage({
  titel: 'Charge löschen?',
  text: 'Die Charge wird endgültig entfernt.',
  bestaetigen: 'Löschen',
  gefaehrlich: true,
}))) return
```

- `RueckfrageDialog` (Root-Layout) zeigt sie: `role="alertdialog"`, Titel als Name, Text als Beschreibung, Fokus beim
  Öffnen auf **Abbrechen**, wenn `gefaehrlich` (sonst auf dem Bestätigungsknopf), Tab bleibt im Dialog, **Esc =
  Abbrechen**, Klick daneben schließt nicht, Fokus danach zurück. Am Handy unten angedockt mit großen Knöpfen, scrollt
  selbst (`max-h-[calc(100dvh-2rem)] overflow-y-auto`).
- `useRueckfrage()` liefert dieselbe Funktion für Komponenten, die lieber einen Hook verwenden.
- **Server-Rückfragen** bleiben: Die Server Action antwortet `{ bestaetigung }` (z. B. Prüfnummer-Schaden, KAN-100),
  der Client fragt mit `rueckfrage({ titel: 'Prüfnummer betroffen', text: r.bestaetigung, … })` und sendet bei „ja“
  erneut mit `pn_bestaetigt=1`.
- Formulare mit Server Action: Knopf fängt den Klick ab, fragt, und sendet bei „ja“ selbst (`form.requestSubmit(knopf)`,
  Beispiel `ConfirmDeleteForm`).
- `gefaehrlich: true` für Löschen, Entfernen, Entziehen, Kündigen, Zurücksetzen und alles, was sich nicht rückgängig
  machen lässt.

## Texte

- Umlaute (ä, ö, ü, ß), nie ae/oe/ue.
- Du-Form wie im Rest der App („Bitte wähle eine Ried aus.“); kurze Sätze.
- **Titel einer Rückfrage** = kurze Frage mit dem Gegenstand: „Kontakt „Maier“ löschen?“, nicht „Sind Sie sicher?“.
- **Text** = Folgen und was bleibt: „Aktivitäten und Verkäufe bleiben erhalten.“
- **Knopf** = Verb der Aktion („Löschen“, „Buchen“, „Kündigen“), nicht „OK“/„Ja“.
- **Fehler** = was ist passiert + was tun: „Die Charge ist leer. Wähle eine andere Charge.“
- **Erfolg** = kurz und konkret: „Umzug gebucht.“, „Gespeichert.“

## Bausteine

| Datei | Zweck |
|---|---|
| `src/lib/ui/rueckfrage.ts` | Zustand der Rückfragen: `rueckfrage()`, `useRueckfrage()`, `beantworte()`, Esc/Fokus-Regeln |
| `src/components/RueckfrageDialog.tsx` | der Dialog (Root-Layout) |
| `src/lib/ui/erfolg.ts` | Zustand der Erfolgs-Pop-ups: `zeigeErfolg()`, Dauer, höchstens 3 |
| `src/components/ErfolgsMeldung.tsx` | `<ErfolgsMeldung text={ok} />` – Erfolg aus einem State |
| `src/components/MeldungsPopup.tsx` | die eine Pop-up-Stelle (Root-Layout): Erfolg und Hinweis „Fehlermeldung außer Sicht“ |
| `src/lib/ui/meldungen.ts` | Regeln, was eine Meldung ist und wann der Hinweis erscheint (KAN-338) |

## Wächter

- `scripts/check-rueckfragen.js` – kein `confirm(`/`alert(`/`prompt(` (auch nicht über `window.`) in `src/`;
  Ausnahme je Stelle `// rueckfrage-ok: <Grund ≥ 15 Zeichen>` (bei Einführung: keine).
- `scripts/check-meldungen.js` – Meldungskästen tragen `role="alert"` bzw. `role="status"`.
- `scripts/check-dialoge.js` – Dialoge scrollen selbst.
