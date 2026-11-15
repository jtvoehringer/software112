# Weinshop: Weindaten aus software:112 auf der Produktseite anzeigen

Anleitung für die Person, die den WooCommerce-Shop betreut (Webdesign). Stand 15.11.2026, KAN-462.

## Was software:112 liefert

software:112 schreibt je zugeordnetem Produkt **eigene Meta-Felder** (Custom Fields). Titel, Beschreibung, Bilder,
Preise, Kategorien und Attribute des Produkts bleiben unberührt.

| Meta-Feld | Inhalt | Beispiel |
|---|---|---|
| `s112_weindaten_html` | **fertiger Block** zum Einbinden (Tabelle der Werte, Allergenhinweis, Link aufs E-Label) | siehe unten |
| `s112_jahrgang` | Jahrgang | `2025` |
| `s112_rebsorte` | Rebsorte | `Zierfandler` |
| `s112_ried` | Ried – nur, wenn der Wein ganz aus einer Ried stammt | `Modler` |
| `s112_herkunft` | Herkunft (Weinbaugebiet) | `Thermenregion` |
| `s112_qualitaet` | Qualitätsstufe | `Qualitätswein DAC` |
| `s112_alkohol_vol` | Alkohol in % vol (Dezimalpunkt) | `12.5` |
| `s112_restzucker_gl` | Restzucker in g/l | `1.2` |
| `s112_saeure_gl` | Säure in g/l | `5.4` |
| `s112_allergene` | Allergene, kommagetrennt | `Sulfite` |
| `s112_energie_kj`, `s112_energie_kcal` | Brennwert je 100 ml | `301`, `72` |
| `s112_elabel_url` | Link zum E-Label (Nährwerte und Zutaten, 24 Sprachen) | `https://…/ABCDEFGH23` |
| `s112_stand` | Tag der letzten Übertragung | `2026-11-15` |

Fehlt ein Wert in software:112, ist das Feld **leer** (nie `0`). Der Block enthält dann die Zeile nicht.

## Einbinden – einmal in der Produktvorlage

Am einfachsten wird nur der fertige Block eingebunden; er aktualisiert sich mit jeder Übertragung von selbst.

**Elementor Pro (Theme Builder, Vorlage „Einzelnes Produkt“):**

1. Widget „Text-Editor“ (oder „HTML“) an die gewünschte Stelle ziehen.
2. Beim Inhalt auf das Symbol „Dynamische Tags“ klicken → „Beitrags-Custom-Field“ (Post Custom Field).
3. Als Schlüssel `s112_weindaten_html` eintragen (bei „Eigener Schlüssel“ / Custom Key).
4. Speichern. Bei Produkten ohne Zuordnung bleibt die Stelle leer.

**Ohne Elementor Pro** (Shortcode in der `functions.php` des Child-Themes oder in einem Snippet-Plugin):

```php
add_shortcode('s112_weindaten', function () {
    $html = get_post_meta(get_the_ID(), 's112_weindaten_html', true);
    return is_string($html) ? wp_kses_post($html) : '';
});
```

Danach in der Produktvorlage den Shortcode `[s112_weindaten]` einsetzen.

## Aussehen

Der Block kommt ohne eigene Formatierung, damit er die Schrift des Shops übernimmt:

```html
<div class="s112-weindaten">
  <table class="s112-weindaten-tabelle"><tbody>
    <tr><th scope="row">Jahrgang</th><td>2025</td></tr>
    <tr><th scope="row">Alkohol</th><td>12,5 % vol</td></tr>
  </tbody></table>
  <p class="s112-weindaten-allergene">Enthält <strong>Sulfite</strong></p>
  <p class="s112-weindaten-elabel"><a href="https://…" rel="noopener">Nährwerte und Zutaten</a></p>
</div>
```

Gestaltet wird über die Klassen `s112-weindaten`, `s112-weindaten-tabelle`, `s112-weindaten-allergene` und
`s112-weindaten-elabel`, zum Beispiel:

```css
.s112-weindaten-tabelle th { text-align: left; font-weight: 600; padding-right: 1.5em; }
.s112-weindaten-tabelle td, .s112-weindaten-tabelle th { padding-top: .25em; padding-bottom: .25em; }
```

## Hinweise

- Den bisherigen, von Hand gepflegten Text mit Analysewerten und den Link „Nährwerte (extern)“ in der Kurzbeschreibung
  entfernt software:112 **nicht** – das bitte nach dem Einbau des Blocks einmal von Hand bereinigen.
- Einzelne Werte lassen sich auch getrennt verwenden (z. B. `s112_alkohol_vol` in einer eigenen Zeile der Vorlage).
- Die Felder nicht im WordPress-Adminbereich ändern: Die nächste Übertragung überschreibt sie.
