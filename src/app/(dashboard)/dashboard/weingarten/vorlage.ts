// Vorlagen der Sicht "Weingarten & Ernte" (eigene Datei: 'use server'-Module
// dürfen nur async-Funktionen exportieren).

// Vorlage für eine neue Lesevorbereitungs-Checkliste (je Betrieb anpassbar –
// Punkte können danach ergänzt/gelöscht werden).
export const LESE_VORLAGE: { text: string; zustaendig: string; hinweis: string }[] = [
  { text: 'Lesetermine mit Erntehelfern abstimmen',                 zustaendig: 'Betrieb',    hinweis: 'Anfang Sept.' },
  { text: 'Wartefristen Pflanzenschutz je Ried prüfen',             zustaendig: 'Weingarten', hinweis: 'vor Lese' },
  { text: 'Reife-Messungen je Ried (KMW-Verlauf)',                  zustaendig: 'Weingarten', hinweis: 'wöchentlich' },
  { text: 'Presse warten, Dichtungen und Schläuche prüfen',         zustaendig: 'Keller',     hinweis: 'vor Lese' },
  { text: 'Gebinde reinigen (Tanks, Bottiche, Fässer)',             zustaendig: 'Keller',     hinweis: 'vor Lese' },
  { text: 'Waage kalibrieren und Übernahmescheine vorbereiten',     zustaendig: 'Betrieb',    hinweis: 'vor Lese' },
  { text: 'Lesekisten, Transportbehälter und Anhänger bereitstellen', zustaendig: 'Betrieb',  hinweis: 'vor Lese' },
  { text: 'Hefen, Enzyme und Schwefel bevorraten',                  zustaendig: 'Keller',     hinweis: 'vor Lese' },
  { text: 'Jahrgang im System anlegen (Lese → Pressungen)',         zustaendig: 'Betrieb',    hinweis: 'Lesebeginn' },
  { text: 'Erntemeldung-Entwurf aus den Pressungen prüfen',         zustaendig: 'Betrieb',    hinweis: 'Nov.' },
]
