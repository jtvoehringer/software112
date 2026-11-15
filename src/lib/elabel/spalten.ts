// KAN-462 (15.11.2026): Spalten, die das öffentliche E-Label UND die Weindaten im Shop lesen – eine Stelle, damit
// Etikett und Shop nie auseinanderlaufen (Akzeptanzkriterium „dieselben Werte wie am E-Label“). Ohne Importe.

/** Inhalt eines E-Labels: Zutaten (samt Allergenen über den Katalog) und Nährwerte je 100 ml */
export const ELABEL_INHALT_SPALTEN = 'zutaten_ids, alkohol_vol, energie_kj, energie_kcal, fett_g, fett_gesaettigt_g, kohlenhydrate_g, zucker_g, eiweiss_g, salz_g'

/** Anzeige-Felder der Füllung auf dem E-Label */
export const ELABEL_FUELLUNG_SPALTEN = 'name, jahrgang, rebsorte, qualitaet, zusatzbezeichnung, erzeugnis, sekt_stufe, flaschengroesse_ml'

/** Katalog der Zutaten und Zusatzstoffe (global) */
export const ELABEL_KATALOG_SPALTEN = 'id, kategorie, name_de, name_en, e_nummer, allergen, sortierung'
