// ── Weinexport: Länderhinweise „Was ist für dieses Land nötig?“ (KAN-437 Teil 1, 13.11.2026) ──
// Bisher stand am Exportauftrag nirgends, was das Zielland verlangt (Registrierungen, Dokumente, Etikett, Zoll).
// Grundlage: Zollrecherche KAN-417, Abschnitt C (Stand 11.11.2026) – eine Recherche, keine Rechtsberatung.
//
// Das Risiko dieser Datei ist ihr Inhalt: Ein falscher Hinweis wiegt schwerer als ein fehlender. Deshalb trägt JEDE
// Aussage das Kennzeichen `geprueft`:
//   true  = an einer amtlichen Quelle gelesen (Behörde des Ziellands, EU, Abkommenstext)
//   false = aus zweiter Hand (z. B. Länderseiten der US-Behörde TTB, Presse) bzw. in der Recherche als „nicht
//           verifiziert“ markiert – die Anzeige nennt das „nicht geprüft – mit dem Importeur klären“.
// Entscheidungen Jörgen 13.11.2026: ungeprüfte Profile werden gezeigt, aber gekennzeichnet (1A); Malaysia nur als
// kurzer Block ohne Angaben; nachgezogen wird, sobald ÖWM-Leitfäden bzw. Rückmeldungen der Importeure vorliegen (7A).
// Wer eine Aussage ändert oder auf „geprüft“ stellt, nennt die Quelle im Feld `quelle` des Profils.
// Isomorph und ohne '@/'-Importe (node:test).

export type LaenderAussage = { text: string; geprueft: boolean }

export type LaenderAbschnitt = 'registrierungen' | 'dokumente' | 'etikett' | 'zoll'

export const ABSCHNITT_TITEL: Record<LaenderAbschnitt, string> = {
  registrierungen: 'Registrierungen und Bewilligungen',
  dokumente: 'Dokumente und Angaben für den Importeur',
  etikett: 'Etikett',
  zoll: 'Zoll und Präferenz',
}
export const ABSCHNITTE: readonly LaenderAbschnitt[] = ['registrierungen', 'dokumente', 'etikett', 'zoll']

export type Laenderprofil = {
  /** ISO-Code des Ziellands */
  land: string
  name: string
  abschnitte: Record<LaenderAbschnitt, LaenderAussage[]>
  /** Woher die Angaben stammen (für die Anzeige) */
  quelle: string
}

const g = (text: string): LaenderAussage => ({ text, geprueft: true })
const u = (text: string): LaenderAussage => ({ text, geprueft: false })

/** Stand der Recherche, auf dem die Profile beruhen */
export const LAENDERPROFILE_STAND = '11.11.2026'

/** Gilt für jede Ausfuhr in ein Drittland */
export const DRITTLAND_GEMEINSAM: readonly string[] = [
  'Handelsrechnung (englisch) und Packliste mit Brutto- und Nettogewicht sowie Packstücken',
  'Frachtpapier (z. B. CMR, Luftfrachtbrief, Konnossement)',
  'Ausfuhranmeldung mit MRN (mündlich bis 1.000 EUR Warenwert, darüber elektronisch)',
  'Die Einfuhrabwicklung liegt beim Importeur – der Betrieb liefert Daten und Zertifikate.',
]

export const LAENDERPROFILE: readonly Laenderprofil[] = [
  {
    land: 'US', name: 'USA',
    abschnitte: {
      registrierungen: [
        g('FDA Food Facility Registration des Weinguts mit einem US-Agenten – Erneuerung alle zwei Jahre, jeweils Oktober bis Dezember gerader Jahre.'),
        g('Der Importeur braucht ein TTB Basic Permit.'),
      ],
      dokumente: [
        g('Prior Notice an die FDA je Sendung (frühestens 15 Tage vor der Ankunft) – die Nummer gehört zur Sendung.'),
        u('Bescheinigung der Kellerbehandlung: Ob die Ausnahme für EU-Wein nach dem Weinabkommen von 2006 gilt, ist nicht geklärt.'),
      ],
      etikett: [
        g('COLA (Etikettenfreigabe der TTB) beantragt der Importeur je Wein – der Betrieb liefert Etiketten, % vol, Sulfithinweis und den Text der Government Warning.'),
      ],
      zoll: [
        g('Kein Präferenzabkommen – keine Ursprungserklärung auf der Rechnung.'),
        u('Zusatzzoll von 15 % auf Wein aus der EU (Stand laut Presse, Juli 2026).'),
      ],
    },
    quelle: 'FDA (Registrierung, Prior Notice), TTB (Etikettierung importierten Weins)',
  },
  {
    land: 'GB', name: 'Vereinigtes Königreich',
    abschnitte: {
      registrierungen: [
        g('Für die Präferenz über 6.000 EUR Warenwert: Eintragung als Registrierter Ausführer (REX).'),
      ],
      dokumente: [
        g('Kein VI-1-Dokument für Großbritannien (seit 2022).'),
        u('Alkoholsteuer nach % vol und Verpackungsabgaben (EPR) treffen den Importeur – der Alkoholgehalt muss exakt angegeben sein.'),
      ],
      etikett: [
        g('England: seit 1.1.2024 Name und Anschrift eines im Vereinigten Königreich ansässigen verantwortlichen Unternehmens auf dem Etikett.'),
        g('Schottland und Wales: „imported by“ mit der Adresse des Importeurs.'),
      ],
      zoll: [
        g('Handels- und Kooperationsabkommen: Zollsatz 0 % mit Erklärung zum Ursprung auf der Rechnung.'),
      ],
    },
    quelle: 'GOV.UK (Defra, Importing wine), Handels- und Kooperationsabkommen EU–Vereinigtes Königreich',
  },
  {
    land: 'CH', name: 'Schweiz',
    abschnitte: {
      registrierungen: [
        g('Der Importeur braucht eine Generaleinfuhrbewilligung des Bundesamts für Landwirtschaft.'),
        u('Der Importeur unterliegt der Schweizer Weinhandelskontrolle.'),
      ],
      dokumente: [
        u('Verzollung in der Schweiz über e-dec bzw. Passar (durch den Importeur bzw. Spediteur).'),
      ],
      etikett: [],
      zoll: [
        g('Zollkontingent für Wein (170 Mio. Liter, Zuteilung in der Reihenfolge der Verzollung) – innerhalb des Kontingents der niedrigere Zollsatz.'),
        g('Für üblichen Still- und Schaumwein gibt es keinen Präferenzzoll – deshalb keine Ursprungserklärung auf der Rechnung (Zugeständnisse nur für Süßweine und Weinspezialitäten).'),
      ],
    },
    quelle: 'BAZG (Zollkontingente), Agrarabkommen Schweiz–EU',
  },
  {
    land: 'JP', name: 'Japan',
    abschnitte: {
      registrierungen: [
        g('Für die Präferenz über 6.000 EUR Warenwert: Eintragung als Registrierter Ausführer (REX).'),
      ],
      dokumente: [
        u('Der Importeur meldet die Sendung nach dem Food Sanitation Act bei der Quarantänestation an – dafür liefert der Betrieb Angaben zu Zutaten, Zusatzstoffen (z. B. Schwefeldioxid, Sorbinsäure) und zum Herstellungsverfahren.'),
      ],
      etikett: [
        u('Japanisches Etikett durch den Importeur: Importeur, Zusatzstoffe, % vol, Volumen, Ursprungsland.'),
      ],
      zoll: [
        g('Wirtschaftspartnerschaftsabkommen: Zollsatz 0 % mit Erklärung zum Ursprung auf der Rechnung (Ursprungskriterium von Hand eintragen).'),
      ],
    },
    quelle: 'Wirtschaftspartnerschaftsabkommen EU–Japan; Einfuhrangaben nach der Länderseite der US-Behörde TTB',
  },
  {
    land: 'CN', name: 'China',
    abschnitte: {
      registrierungen: [
        u('GACC-Registrierung des Herstellers über das Portal CIFER; seit 1.6.2026 gilt Dekret 280 (ersetzt Dekret 248). Die Registriernummer steht in der Einfuhranmeldung.'),
      ],
      dokumente: [
        u('Ursprungszeugnis (WKO) sowie Analysen- bzw. Gesundheitszeugnis – was genau verlangt wird, nennt der Importeur.'),
      ],
      etikett: [
        u('Chinesisches Etikett: Bezeichnung, % vol, Nettoinhalt, Ursprungsland, Importeur, Zuckergehalt, Warnhinweis; die neue Norm GB 7718-2025 gilt ab 16.3.2027.'),
      ],
      zoll: [
        g('Kein Präferenzabkommen – keine Ursprungserklärung auf der Rechnung.'),
        u('Einfuhrabgaben: Zoll (14 % nicht bestätigt), dazu 10 % Verbrauchsteuer und 13 % Einfuhrumsatzsteuer.'),
      ],
    },
    quelle: 'Mitteilungen ausländischer Behörden zu GACC-Dekret 280, Länderseite der US-Behörde TTB, EU SME Centre',
  },
  {
    land: 'KR', name: 'Südkorea',
    abschnitte: {
      registrierungen: [
        u('MFDS-Vorregistrierung der ausländischen Betriebsstätte (laut GTAI zwei Jahre gültig).'),
        g('Für die Präferenz über 6.000 EUR Warenwert: Bewilligung als Ermächtigter Ausführer (eine EUR.1 wird nicht anerkannt).'),
      ],
      dokumente: [
        u('Zutatenliste mit Anteilen, Beschreibung des Herstellungsverfahrens und Bescheinigung des Herstell- bzw. Abfülldatums.'),
        u('Beim ersten Import Laborprüfung (u. a. Ethylcarbamat, Cyclamat, Blei, Ochratoxin A).'),
      ],
      etikett: [
        u('Koreanisches Rückenetikett durch den Importeur.'),
      ],
      zoll: [
        g('Freihandelsabkommen: Zollsatz 0 % mit Ursprungserklärung auf der Rechnung (eigenhändig unterschrieben).'),
      ],
    },
    quelle: 'Freihandelsabkommen EU–Korea; Einfuhrangaben nach der Länderseite der US-Behörde TTB und GTAI',
  },
  {
    land: 'TH', name: 'Thailand',
    abschnitte: {
      registrierungen: [
        u('Der Importeur braucht eine Einfuhrlizenz der Excise-Behörde und die Produktregistrierung bei der thailändischen FDA.'),
      ],
      dokumente: [
        u('Ursprungszeugnis, gegebenenfalls GMP- bzw. Free-Sale-Zertifikat oder Analysenzertifikat.'),
      ],
      etikett: [
        u('Etikettenfreigabe und Steuerbanderole durch den Importeur; Etikett mit thailändischem Warnhinweis.'),
      ],
      zoll: [
        g('Kein Präferenzabkommen – keine Ursprungserklärung auf der Rechnung.'),
        u('Einfuhrzoll auf Wein seit 23.2.2024 bei 0 % (Dauer unklar), dazu Verbrauchsteuer.'),
      ],
    },
    quelle: 'Länderseite der US-Behörde TTB, USDA',
  },
  {
    land: 'BR', name: 'Brasilien',
    abschnitte: {
      registrierungen: [
        u('Der Importeur braucht je Sendung eine Einfuhrlizenz (SISCOMEX) – auf Basis einer Proforma-Rechnung.'),
      ],
      dokumente: [
        u('Ursprungs- und Analysenzertifikat einer beim Landwirtschaftsministerium (MAPA/SISCOLE) gelisteten Stelle bzw. eines gelisteten Labors; Typizitätszertifikat z. B. über 14 % vol.'),
      ],
      etikett: [
        u('Portugiesisches Etikett mit MAPA-Nummer des Importeurs, Losnummer und Glutenhinweis.'),
      ],
      zoll: [
        u('EU-Mercosur-Interimsabkommen wird seit 1.5.2026 vorläufig angewendet (stufenweiser Zollabbau) – die Form des Ursprungsnachweises mit dem Zollamt klären.'),
      ],
    },
    quelle: 'Länderseite der US-Behörde TTB, MAPA IN 67/2018, Europäische Kommission (Factsheet Mercosur)',
  },
  {
    land: 'MY', name: 'Malaysia',
    abschnitte: { registrierungen: [], dokumente: [], etikett: [], zoll: [] },
    quelle: 'keine belegten Angaben',
  },
]

export function laenderprofil(land: unknown): Laenderprofil | null {
  const iso = typeof land === 'string' ? land.trim().toUpperCase() : ''
  return LAENDERPROFILE.find(p => p.land === iso) ?? null
}

export type ProfilStand = 'geprueft' | 'teilweise' | 'ungeprueft' | 'ohne'

/** Wie belastbar ein Profil insgesamt ist – für das Kennzeichen in der Überschrift */
export function profilStand(p: Laenderprofil): ProfilStand {
  const alle = ABSCHNITTE.flatMap(a => p.abschnitte[a])
  if (alle.length === 0) return 'ohne'
  const geprueft = alle.filter(x => x.geprueft).length
  return geprueft === alle.length ? 'geprueft' : geprueft === 0 ? 'ungeprueft' : 'teilweise'
}

export const PROFIL_STAND_TEXT: Record<ProfilStand, string> = {
  geprueft: 'an amtlichen Quellen geprüft',
  teilweise: 'teilweise geprüft',
  ungeprueft: 'nicht geprüft',
  ohne: 'keine belegten Angaben',
}

/** Kennzeichen an einer nicht geprüften Aussage */
export const NICHT_GEPRUEFT = 'nicht geprüft – mit dem Importeur klären'

/** Text für ein Land ohne belegte Angaben (Malaysia) */
export const OHNE_ANGABEN =
  'Für dieses Land liegen keine belegten Angaben vor. Bitte die Anforderungen (Einfuhrlizenz, Abgaben, Etikett) mit dem Importeur bzw. dem AußenwirtschaftsCenter der WKO klären.'

export const LAENDER_HAFTUNG =
  `Stand der Recherche: ${LAENDERPROFILE_STAND}. Zusammenstellung ohne Gewähr, keine Rechtsberatung – maßgeblich sind die Vorgaben der Behörden des Ziellands und die Angaben des Importeurs.`
