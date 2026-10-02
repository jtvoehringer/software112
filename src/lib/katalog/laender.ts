// ── Länderkatalog (KAN-187, 02.10.2026) – client-sicher, ohne Imports ──
//
// Spiegel der Tabelle kat_land (Migration kan39a_kataloge): ISO 3166-1 alpha-2, deutscher Name, EU-Kennzeichen.
// scripts/tests/kan187-laender.test.mjs vergleicht beide Seiten – wer hier etwas ändert, braucht dazu eine
// Migration (und umgekehrt). Die Liste ist aus der Migrationsdatei erzeugt, nicht abgetippt.
//
// Gespeichert wird in kontakte/firmen.land und exportauftraege.destination_land immer der ISO-Code.
// Eingaben (Formular, Import, KI-Vorschlag) laufen über normalisiereLand().

export type KatLand = { iso2: string; name: string; eu: boolean }

/** Alle 249 Länder in der Reihenfolge der Migration (nach ISO-Code) */
export const KAT_LAND: readonly KatLand[] = [
  { iso2: 'AD', name: 'Andorra', eu: false },
  { iso2: 'AE', name: 'Vereinigte Arabische Emirate', eu: false },
  { iso2: 'AF', name: 'Afghanistan', eu: false },
  { iso2: 'AG', name: 'Antigua und Barbuda', eu: false },
  { iso2: 'AI', name: 'Anguilla', eu: false },
  { iso2: 'AL', name: 'Albanien', eu: false },
  { iso2: 'AM', name: 'Armenien', eu: false },
  { iso2: 'AO', name: 'Angola', eu: false },
  { iso2: 'AQ', name: 'Antarktis', eu: false },
  { iso2: 'AR', name: 'Argentinien', eu: false },
  { iso2: 'AS', name: 'Amerikanisch-Samoa', eu: false },
  { iso2: 'AT', name: 'Österreich', eu: true },
  { iso2: 'AU', name: 'Australien', eu: false },
  { iso2: 'AW', name: 'Aruba', eu: false },
  { iso2: 'AX', name: 'Ålandinseln', eu: false },
  { iso2: 'AZ', name: 'Aserbaidschan', eu: false },
  { iso2: 'BA', name: 'Bosnien und Herzegowina', eu: false },
  { iso2: 'BB', name: 'Barbados', eu: false },
  { iso2: 'BD', name: 'Bangladesch', eu: false },
  { iso2: 'BE', name: 'Belgien', eu: true },
  { iso2: 'BF', name: 'Burkina Faso', eu: false },
  { iso2: 'BG', name: 'Bulgarien', eu: true },
  { iso2: 'BH', name: 'Bahrain', eu: false },
  { iso2: 'BI', name: 'Burundi', eu: false },
  { iso2: 'BJ', name: 'Benin', eu: false },
  { iso2: 'BL', name: 'St. Barthélemy', eu: false },
  { iso2: 'BM', name: 'Bermuda', eu: false },
  { iso2: 'BN', name: 'Brunei Darussalam', eu: false },
  { iso2: 'BO', name: 'Bolivien', eu: false },
  { iso2: 'BQ', name: 'Karibische Niederlande', eu: false },
  { iso2: 'BR', name: 'Brasilien', eu: false },
  { iso2: 'BS', name: 'Bahamas', eu: false },
  { iso2: 'BT', name: 'Bhutan', eu: false },
  { iso2: 'BV', name: 'Bouvetinsel', eu: false },
  { iso2: 'BW', name: 'Botsuana', eu: false },
  { iso2: 'BY', name: 'Belarus', eu: false },
  { iso2: 'BZ', name: 'Belize', eu: false },
  { iso2: 'CA', name: 'Kanada', eu: false },
  { iso2: 'CC', name: 'Kokosinseln', eu: false },
  { iso2: 'CD', name: 'Kongo-Kinshasa', eu: false },
  { iso2: 'CF', name: 'Zentralafrikanische Republik', eu: false },
  { iso2: 'CG', name: 'Kongo-Brazzaville', eu: false },
  { iso2: 'CH', name: 'Schweiz', eu: false },
  { iso2: 'CI', name: 'Côte d’Ivoire', eu: false },
  { iso2: 'CK', name: 'Cookinseln', eu: false },
  { iso2: 'CL', name: 'Chile', eu: false },
  { iso2: 'CM', name: 'Kamerun', eu: false },
  { iso2: 'CN', name: 'China', eu: false },
  { iso2: 'CO', name: 'Kolumbien', eu: false },
  { iso2: 'CR', name: 'Costa Rica', eu: false },
  { iso2: 'CU', name: 'Kuba', eu: false },
  { iso2: 'CV', name: 'Cabo Verde', eu: false },
  { iso2: 'CW', name: 'Curaçao', eu: false },
  { iso2: 'CX', name: 'Weihnachtsinsel', eu: false },
  { iso2: 'CY', name: 'Zypern', eu: true },
  { iso2: 'CZ', name: 'Tschechien', eu: true },
  { iso2: 'DE', name: 'Deutschland', eu: true },
  { iso2: 'DJ', name: 'Dschibuti', eu: false },
  { iso2: 'DK', name: 'Dänemark', eu: true },
  { iso2: 'DM', name: 'Dominica', eu: false },
  { iso2: 'DO', name: 'Dominikanische Republik', eu: false },
  { iso2: 'DZ', name: 'Algerien', eu: false },
  { iso2: 'EC', name: 'Ecuador', eu: false },
  { iso2: 'EE', name: 'Estland', eu: true },
  { iso2: 'EG', name: 'Ägypten', eu: false },
  { iso2: 'EH', name: 'Westsahara', eu: false },
  { iso2: 'ER', name: 'Eritrea', eu: false },
  { iso2: 'ES', name: 'Spanien', eu: true },
  { iso2: 'ET', name: 'Äthiopien', eu: false },
  { iso2: 'FI', name: 'Finnland', eu: true },
  { iso2: 'FJ', name: 'Fidschi', eu: false },
  { iso2: 'FK', name: 'Falklandinseln', eu: false },
  { iso2: 'FM', name: 'Mikronesien', eu: false },
  { iso2: 'FO', name: 'Färöer', eu: false },
  { iso2: 'FR', name: 'Frankreich', eu: true },
  { iso2: 'GA', name: 'Gabun', eu: false },
  { iso2: 'GB', name: 'Vereinigtes Königreich', eu: false },
  { iso2: 'GD', name: 'Grenada', eu: false },
  { iso2: 'GE', name: 'Georgien', eu: false },
  { iso2: 'GF', name: 'Französisch-Guayana', eu: false },
  { iso2: 'GG', name: 'Guernsey', eu: false },
  { iso2: 'GH', name: 'Ghana', eu: false },
  { iso2: 'GI', name: 'Gibraltar', eu: false },
  { iso2: 'GL', name: 'Grönland', eu: false },
  { iso2: 'GM', name: 'Gambia', eu: false },
  { iso2: 'GN', name: 'Guinea', eu: false },
  { iso2: 'GP', name: 'Guadeloupe', eu: false },
  { iso2: 'GQ', name: 'Äquatorialguinea', eu: false },
  { iso2: 'GR', name: 'Griechenland', eu: true },
  { iso2: 'GS', name: 'Südgeorgien und die Südlichen Sandwichinseln', eu: false },
  { iso2: 'GT', name: 'Guatemala', eu: false },
  { iso2: 'GU', name: 'Guam', eu: false },
  { iso2: 'GW', name: 'Guinea-Bissau', eu: false },
  { iso2: 'GY', name: 'Guyana', eu: false },
  { iso2: 'HK', name: 'Sonderverwaltungsregion Hongkong', eu: false },
  { iso2: 'HM', name: 'Heard und McDonaldinseln', eu: false },
  { iso2: 'HN', name: 'Honduras', eu: false },
  { iso2: 'HR', name: 'Kroatien', eu: true },
  { iso2: 'HT', name: 'Haiti', eu: false },
  { iso2: 'HU', name: 'Ungarn', eu: true },
  { iso2: 'ID', name: 'Indonesien', eu: false },
  { iso2: 'IE', name: 'Irland', eu: true },
  { iso2: 'IL', name: 'Israel', eu: false },
  { iso2: 'IM', name: 'Isle of Man', eu: false },
  { iso2: 'IN', name: 'Indien', eu: false },
  { iso2: 'IO', name: 'Britisches Territorium im Indischen Ozean', eu: false },
  { iso2: 'IQ', name: 'Irak', eu: false },
  { iso2: 'IR', name: 'Iran', eu: false },
  { iso2: 'IS', name: 'Island', eu: false },
  { iso2: 'IT', name: 'Italien', eu: true },
  { iso2: 'JE', name: 'Jersey', eu: false },
  { iso2: 'JM', name: 'Jamaika', eu: false },
  { iso2: 'JO', name: 'Jordanien', eu: false },
  { iso2: 'JP', name: 'Japan', eu: false },
  { iso2: 'KE', name: 'Kenia', eu: false },
  { iso2: 'KG', name: 'Kirgisistan', eu: false },
  { iso2: 'KH', name: 'Kambodscha', eu: false },
  { iso2: 'KI', name: 'Kiribati', eu: false },
  { iso2: 'KM', name: 'Komoren', eu: false },
  { iso2: 'KN', name: 'St. Kitts und Nevis', eu: false },
  { iso2: 'KP', name: 'Nordkorea', eu: false },
  { iso2: 'KR', name: 'Südkorea', eu: false },
  { iso2: 'KW', name: 'Kuwait', eu: false },
  { iso2: 'KY', name: 'Kaimaninseln', eu: false },
  { iso2: 'KZ', name: 'Kasachstan', eu: false },
  { iso2: 'LA', name: 'Laos', eu: false },
  { iso2: 'LB', name: 'Libanon', eu: false },
  { iso2: 'LC', name: 'St. Lucia', eu: false },
  { iso2: 'LI', name: 'Liechtenstein', eu: false },
  { iso2: 'LK', name: 'Sri Lanka', eu: false },
  { iso2: 'LR', name: 'Liberia', eu: false },
  { iso2: 'LS', name: 'Lesotho', eu: false },
  { iso2: 'LT', name: 'Litauen', eu: true },
  { iso2: 'LU', name: 'Luxemburg', eu: true },
  { iso2: 'LV', name: 'Lettland', eu: true },
  { iso2: 'LY', name: 'Libyen', eu: false },
  { iso2: 'MA', name: 'Marokko', eu: false },
  { iso2: 'MC', name: 'Monaco', eu: false },
  { iso2: 'MD', name: 'Republik Moldau', eu: false },
  { iso2: 'ME', name: 'Montenegro', eu: false },
  { iso2: 'MF', name: 'St. Martin', eu: false },
  { iso2: 'MG', name: 'Madagaskar', eu: false },
  { iso2: 'MH', name: 'Marshallinseln', eu: false },
  { iso2: 'MK', name: 'Nordmazedonien', eu: false },
  { iso2: 'ML', name: 'Mali', eu: false },
  { iso2: 'MM', name: 'Myanmar', eu: false },
  { iso2: 'MN', name: 'Mongolei', eu: false },
  { iso2: 'MO', name: 'Sonderverwaltungsregion Macau', eu: false },
  { iso2: 'MP', name: 'Nördliche Marianen', eu: false },
  { iso2: 'MQ', name: 'Martinique', eu: false },
  { iso2: 'MR', name: 'Mauretanien', eu: false },
  { iso2: 'MS', name: 'Montserrat', eu: false },
  { iso2: 'MT', name: 'Malta', eu: true },
  { iso2: 'MU', name: 'Mauritius', eu: false },
  { iso2: 'MV', name: 'Malediven', eu: false },
  { iso2: 'MW', name: 'Malawi', eu: false },
  { iso2: 'MX', name: 'Mexiko', eu: false },
  { iso2: 'MY', name: 'Malaysia', eu: false },
  { iso2: 'MZ', name: 'Mosambik', eu: false },
  { iso2: 'NA', name: 'Namibia', eu: false },
  { iso2: 'NC', name: 'Neukaledonien', eu: false },
  { iso2: 'NE', name: 'Niger', eu: false },
  { iso2: 'NF', name: 'Norfolkinsel', eu: false },
  { iso2: 'NG', name: 'Nigeria', eu: false },
  { iso2: 'NI', name: 'Nicaragua', eu: false },
  { iso2: 'NL', name: 'Niederlande', eu: true },
  { iso2: 'NO', name: 'Norwegen', eu: false },
  { iso2: 'NP', name: 'Nepal', eu: false },
  { iso2: 'NR', name: 'Nauru', eu: false },
  { iso2: 'NU', name: 'Niue', eu: false },
  { iso2: 'NZ', name: 'Neuseeland', eu: false },
  { iso2: 'OM', name: 'Oman', eu: false },
  { iso2: 'PA', name: 'Panama', eu: false },
  { iso2: 'PE', name: 'Peru', eu: false },
  { iso2: 'PF', name: 'Französisch-Polynesien', eu: false },
  { iso2: 'PG', name: 'Papua-Neuguinea', eu: false },
  { iso2: 'PH', name: 'Philippinen', eu: false },
  { iso2: 'PK', name: 'Pakistan', eu: false },
  { iso2: 'PL', name: 'Polen', eu: true },
  { iso2: 'PM', name: 'St. Pierre und Miquelon', eu: false },
  { iso2: 'PN', name: 'Pitcairninseln', eu: false },
  { iso2: 'PR', name: 'Puerto Rico', eu: false },
  { iso2: 'PS', name: 'Palästinensische Autonomiegebiete', eu: false },
  { iso2: 'PT', name: 'Portugal', eu: true },
  { iso2: 'PW', name: 'Palau', eu: false },
  { iso2: 'PY', name: 'Paraguay', eu: false },
  { iso2: 'QA', name: 'Katar', eu: false },
  { iso2: 'RE', name: 'Réunion', eu: false },
  { iso2: 'RO', name: 'Rumänien', eu: true },
  { iso2: 'RS', name: 'Serbien', eu: false },
  { iso2: 'RU', name: 'Russland', eu: false },
  { iso2: 'RW', name: 'Ruanda', eu: false },
  { iso2: 'SA', name: 'Saudi-Arabien', eu: false },
  { iso2: 'SB', name: 'Salomonen', eu: false },
  { iso2: 'SC', name: 'Seychellen', eu: false },
  { iso2: 'SD', name: 'Sudan', eu: false },
  { iso2: 'SE', name: 'Schweden', eu: true },
  { iso2: 'SG', name: 'Singapur', eu: false },
  { iso2: 'SH', name: 'St. Helena', eu: false },
  { iso2: 'SI', name: 'Slowenien', eu: true },
  { iso2: 'SJ', name: 'Spitzbergen und Jan Mayen', eu: false },
  { iso2: 'SK', name: 'Slowakei', eu: true },
  { iso2: 'SL', name: 'Sierra Leone', eu: false },
  { iso2: 'SM', name: 'San Marino', eu: false },
  { iso2: 'SN', name: 'Senegal', eu: false },
  { iso2: 'SO', name: 'Somalia', eu: false },
  { iso2: 'SR', name: 'Suriname', eu: false },
  { iso2: 'SS', name: 'Südsudan', eu: false },
  { iso2: 'ST', name: 'São Tomé und Príncipe', eu: false },
  { iso2: 'SV', name: 'El Salvador', eu: false },
  { iso2: 'SX', name: 'Sint Maarten', eu: false },
  { iso2: 'SY', name: 'Syrien', eu: false },
  { iso2: 'SZ', name: 'Eswatini', eu: false },
  { iso2: 'TC', name: 'Turks- und Caicosinseln', eu: false },
  { iso2: 'TD', name: 'Tschad', eu: false },
  { iso2: 'TF', name: 'Französische Süd- und Antarktisgebiete', eu: false },
  { iso2: 'TG', name: 'Togo', eu: false },
  { iso2: 'TH', name: 'Thailand', eu: false },
  { iso2: 'TJ', name: 'Tadschikistan', eu: false },
  { iso2: 'TK', name: 'Tokelau', eu: false },
  { iso2: 'TL', name: 'Timor-Leste', eu: false },
  { iso2: 'TM', name: 'Turkmenistan', eu: false },
  { iso2: 'TN', name: 'Tunesien', eu: false },
  { iso2: 'TO', name: 'Tonga', eu: false },
  { iso2: 'TR', name: 'Türkei', eu: false },
  { iso2: 'TT', name: 'Trinidad und Tobago', eu: false },
  { iso2: 'TV', name: 'Tuvalu', eu: false },
  { iso2: 'TW', name: 'Taiwan', eu: false },
  { iso2: 'TZ', name: 'Tansania', eu: false },
  { iso2: 'UA', name: 'Ukraine', eu: false },
  { iso2: 'UG', name: 'Uganda', eu: false },
  { iso2: 'UM', name: 'Amerikanische Überseeinseln', eu: false },
  { iso2: 'US', name: 'Vereinigte Staaten', eu: false },
  { iso2: 'UY', name: 'Uruguay', eu: false },
  { iso2: 'UZ', name: 'Usbekistan', eu: false },
  { iso2: 'VA', name: 'Vatikanstadt', eu: false },
  { iso2: 'VC', name: 'St. Vincent und die Grenadinen', eu: false },
  { iso2: 'VE', name: 'Venezuela', eu: false },
  { iso2: 'VG', name: 'Britische Jungferninseln', eu: false },
  { iso2: 'VI', name: 'Amerikanische Jungferninseln', eu: false },
  { iso2: 'VN', name: 'Vietnam', eu: false },
  { iso2: 'VU', name: 'Vanuatu', eu: false },
  { iso2: 'WF', name: 'Wallis und Futuna', eu: false },
  { iso2: 'WS', name: 'Samoa', eu: false },
  { iso2: 'YE', name: 'Jemen', eu: false },
  { iso2: 'YT', name: 'Mayotte', eu: false },
  { iso2: 'ZA', name: 'Südafrika', eu: false },
  { iso2: 'ZM', name: 'Sambia', eu: false },
  { iso2: 'ZW', name: 'Simbabwe', eu: false },
]

const NACH_CODE: ReadonlyMap<string, KatLand> = new Map(KAT_LAND.map(l => [l.iso2, l]))

/** Häufige Länder – stehen in Auswahllisten oben, in dieser Reihenfolge */
export const LAENDER_HAEUFIG: readonly string[] = ['AT', 'DE', 'CH', 'LI', 'IT', 'HU', 'SK', 'CZ', 'SI', 'FR', 'NL', 'BE', 'GB', 'US']

/** true, wenn code ein ISO-Code aus dem Katalog ist (genau so geschrieben: zwei Großbuchstaben) */
export function istLand(code: string | null | undefined): boolean {
  return !!code && NACH_CODE.has(code)
}

/** Deutscher Name zum ISO-Code, null bei unbekanntem Code */
export function landName(code: string | null | undefined): string | null {
  return (code && NACH_CODE.get(code.trim().toUpperCase())?.name) || null
}

/** Name zur Anzeige: „Österreich“ bei bekanntem Code, sonst der gespeicherte Wert unverändert (Altdaten) */
export function landAnzeige(code: string | null | undefined): string {
  return landName(code) ?? (code ?? '')
}

/** EU-Mitgliedstaat laut Katalog (Code ohne Umdeutung – 'EL'/'UK' zählen nicht, wie bisher in der BMD-Logik) */
export function istEuLand(code: string | null | undefined): boolean {
  return !!code && NACH_CODE.get(code.trim().toUpperCase())?.eu === true
}

/** Vergleichsschlüssel: klein, ä→ae usw., Akzente weg, nur Buchstaben */
function schluessel(s: string): string {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
}

// Gängige Varianten, englische Namen und Dreibuchstaben-Codes → ISO (deutsche Katalognamen kommen automatisch dazu)
const VARIANTEN: Record<string, string> = {
  AT: 'Austria, Osterreich, Republik Österreich, AUT',
  DE: 'Germany, BRD, Bundesrepublik Deutschland, DEU, GER',
  CH: 'Switzerland, Suisse, Svizzera, Schweizerische Eidgenossenschaft, CHE',
  LI: 'Fürstentum Liechtenstein, LIE',
  IT: 'Italy, Italia, ITA',
  FR: 'France, FRA',
  HU: 'Hungary, Magyarország, HUN',
  SK: 'Slovakia, Slowakische Republik, Slovak Republic, SVK',
  CZ: 'Czech Republic, Czechia, Tschechische Republik, CZE',
  SI: 'Slovenia, Slovenija, SVN',
  HR: 'Croatia, Hrvatska, HRV',
  NL: 'Netherlands, The Netherlands, Holland, NLD',
  BE: 'Belgium, BEL',
  LU: 'Luxembourg, LUX',
  DK: 'Denmark, DNK',
  SE: 'Sweden, SWE',
  NO: 'Norway, NOR',
  FI: 'Finland, FIN',
  IS: 'Iceland',
  PL: 'Poland, POL',
  ES: 'Spain, España, ESP',
  PT: 'Portugal, PRT',
  IE: 'Ireland, IRL',
  GB: 'United Kingdom, Great Britain, Großbritannien, England, Schottland, Scotland, Wales, Nordirland, Northern Ireland, GBR',
  GR: 'Greece, GRC',
  CY: 'Cyprus',
  MT: 'Malta',
  RO: 'Romania, ROU',
  BG: 'Bulgaria, BGR',
  LT: 'Lithuania',
  LV: 'Latvia',
  EE: 'Estonia',
  MC: 'Monaco',
  SM: 'San Marino',
  VA: 'Vatikan, Vatican, Vatican City, Heiliger Stuhl, Holy See',
  AD: 'Andorra',
  AL: 'Albania',
  BA: 'Bosnia, Bosnia and Herzegovina, Bosnien',
  MK: 'North Macedonia, Macedonia, Mazedonien',
  ME: 'Montenegro',
  RS: 'Serbia',
  UA: 'Ukraine',
  BY: 'Belarus, Weißrussland',
  MD: 'Moldova, Moldau, Moldawien, Republic of Moldova',
  RU: 'Russia, Russian Federation, Russische Föderation',
  TR: 'Turkey, Türkiye, Turkiye',
  GE: 'Georgia',
  AM: 'Armenia',
  AZ: 'Azerbaijan',
  US: 'USA, United States, United States of America, Vereinigte Staaten von Amerika, Amerika, America',
  CA: 'Canada',
  MX: 'Mexico',
  BR: 'Brazil',
  AR: 'Argentina',
  CL: 'Chile',
  PE: 'Peru',
  CO: 'Colombia',
  CN: 'China, PR China, Volksrepublik China, People’s Republic of China',
  HK: 'Hongkong, Hong Kong',
  MO: 'Macau, Macao',
  TW: 'Taiwan',
  JP: 'Japan',
  KR: 'South Korea, Korea, Republic of Korea, Republik Korea',
  KP: 'North Korea',
  SG: 'Singapore',
  MY: 'Malaysia',
  TH: 'Thailand',
  VN: 'Vietnam, Viet Nam',
  PH: 'Philippines',
  ID: 'Indonesia',
  IN: 'India',
  LK: 'Sri Lanka',
  KH: 'Cambodia',
  LA: 'Laos',
  MM: 'Myanmar, Burma, Birma',
  BN: 'Brunei',
  PK: 'Pakistan',
  BD: 'Bangladesh',
  NP: 'Nepal',
  AE: 'United Arab Emirates, UAE, VAE, Emirate, Dubai',
  SA: 'Saudi Arabia',
  QA: 'Qatar',
  KW: 'Kuwait',
  BH: 'Bahrain',
  OM: 'Oman',
  IL: 'Israel',
  EG: 'Egypt',
  MA: 'Morocco',
  TN: 'Tunisia',
  MU: 'Mauritius',
  MV: 'Maldives',
  SC: 'Seychelles',
  ZA: 'South Africa',
  AU: 'Australia',
  NZ: 'New Zealand',
  CI: 'Elfenbeinküste, Ivory Coast',
  CV: 'Kap Verde, Cape Verde',
  SZ: 'Swasiland, Swaziland',
  PS: 'Palästina, Palestine',
}

const NACH_NAME: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>()
  for (const l of KAT_LAND) m.set(schluessel(l.name), l.iso2)
  for (const [code, liste] of Object.entries(VARIANTEN))
    for (const v of liste.split(',')) {
      const k = schluessel(v)
      if (k && !m.has(k)) m.set(k, code)
    }
  return m
})()

/**
 * Eingabe → ISO-Code aus dem Katalog: trimmt, Großbuchstaben; 'UK' → 'GB', 'EL' → 'GR'; deutsche Katalognamen
 * und gängige Varianten (Oesterreich, Austria, Germany, USA …) werden erkannt. Leer oder unbekannt → null.
 */
export function normalisiereLand(eingabe: string | null | undefined): string | null {
  const t = (eingabe ?? '').trim()
  if (!t) return null
  if (/^[A-Za-z]{2}$/.test(t)) {
    const c = t.toUpperCase()
    const iso = c === 'UK' ? 'GB' : c === 'EL' ? 'GR' : c
    return NACH_CODE.has(iso) ? iso : null
  }
  return NACH_NAME.get(schluessel(t)) ?? null
}

export type LandOption = { wert: string; label: string; ungueltig?: boolean; trenner?: boolean }

/** Name für Auswahllisten: „Österreich (AT)“ */
export function landLabel(code: string): string {
  const n = landName(code)
  return n ? `${n} (${code})` : `${code} (ungültig)`
}

const ALPHABETISCH: readonly KatLand[] = [...KAT_LAND].sort((a, b) => a.name.localeCompare(b.name, 'de'))

/**
 * Optionen für ein Land-Auswahlfeld: häufige Länder oben, Trenner, dann alle übrigen alphabetisch nach Namen.
 * Ein gespeicherter Wert, der nicht im Katalog steht (Altdaten), kommt als „<Wert> (ungültig)“ an den Anfang –
 * sonst zeigte das Feld ihn leer an und das Speichern überschriebe ihn unbemerkt.
 */
export function landOptionen(aktuell?: string | null): LandOption[] {
  const haeufig = new Set(LAENDER_HAEUFIG)
  const out: LandOption[] = []
  if (aktuell && !istLand(aktuell)) out.push({ wert: aktuell, label: `${aktuell} (ungültig)`, ungueltig: true })
  for (const c of LAENDER_HAEUFIG) out.push({ wert: c, label: landLabel(c) })
  out.push({ wert: '', label: '──────────', trenner: true })
  for (const l of ALPHABETISCH) if (!haeufig.has(l.iso2)) out.push({ wert: l.iso2, label: `${l.name} (${l.iso2})` })
  return out
}
