// KAN-220 (07.10.2026): Technisches Produktdatenblatt einer Füllung als PDF (für Händler) – Betrieb, Bezeichnung,
// Sorte, Herkunft, Qualität, Analysewerte, Flaschengröße, Prüfnummer, optional Nährwerte (freigegebenes E-Label),
// Bilder von Flasche und Etikett, Links zu E-Label und Weinpass. Wie die Rechnung mit @react-pdf/renderer.
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { DatenblattDaten } from '@/lib/handel/datenblattLaden'
import { wertText } from '@/lib/handel/datenblatt'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#222' },
  kopf: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  betrieb: { fontSize: 12, fontWeight: 700 },
  klein: { fontSize: 8.5, color: '#555', marginTop: 1 },
  logo: { width: 110, height: 50, objectFit: 'contain' },
  titel: { fontSize: 8.5, color: '#2F63AC', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  name: { fontSize: 20, fontWeight: 700, marginBottom: 2 },
  unter: { fontSize: 10.5, color: '#444', marginBottom: 16 },
  inhalt: { flexDirection: 'row' },
  tabelle: { flex: 1, paddingRight: 16 },
  zeile: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#EDEEF1' },
  label: { width: 120, fontSize: 9, color: '#666' },
  wert: { flex: 1, fontSize: 9.5 },
  abschnitt: { fontSize: 8.5, fontWeight: 700, color: '#444', textTransform: 'uppercase', marginTop: 14, marginBottom: 4 },
  bilder: { width: 160 },
  bild: { width: 160, height: 220, objectFit: 'contain', marginBottom: 8 },
  bildLabel: { fontSize: 7.5, color: '#888', textAlign: 'center', marginBottom: 10 },
  fuss: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 7.5, color: '#999', borderTopWidth: 1, borderTopColor: '#EDEEF1', paddingTop: 6 },
})

function Zeile({ label, wert }: { label: string; wert: string | null }) {
  return (
    <View style={styles.zeile}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.wert}>{wert && wert.trim() ? wert : '–'}</Text>
    </View>
  )
}

function DatenblattDocument({ d, stand }: { d: DatenblattDaten; stand: string }) {
  const q = d.werte.quelle
  const quelle = !q ? null : q.art === 'elabel' ? 'Werte laut freigegebenem E-Label'
    : `Werte laut Analyse vom ${new Date(`${q.datum}T00:00:00`).toLocaleDateString('de-DE')}`
  return (
    <Document title={`Datenblatt ${d.name}`} author={d.betrieb.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.kopf}>
          <View>
            <Text style={styles.betrieb}>{d.betrieb.name}</Text>
            {d.betrieb.adresse && <Text style={styles.klein}>{d.betrieb.adresse}</Text>}
            {d.betrieb.kontakt && <Text style={styles.klein}>{d.betrieb.kontakt}</Text>}
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf-Image, kein HTML-Bild */}
          {d.betrieb.logoUrl && <Image src={d.betrieb.logoUrl} style={styles.logo} />}
        </View>

        <Text style={styles.titel}>Produktdatenblatt</Text>
        <Text style={styles.name}>{d.name}{d.jahrgang ? ` ${d.jahrgang}` : ''}</Text>
        <Text style={styles.unter}>{[d.rebsorte, d.qualitaet, d.flaschengroesse].filter(Boolean).join(' · ')}</Text>

        <View style={styles.inhalt}>
          <View style={styles.tabelle}>
            <Zeile label="Rebsorte" wert={d.rebsorte} />
            <Zeile label="Jahrgang" wert={d.jahrgang ? String(d.jahrgang) : null} />
            <Zeile label="Herkunft" wert={d.herkunft} />
            <Zeile label="Qualität" wert={d.qualitaet} />
            <Zeile label="Flaschengröße" wert={d.flaschengroesse} />
            <Zeile label="Prüfnummer" wert={d.pruefnummer} />
            <Zeile label="Los/Charge" wert={d.chargennummer} />

            <Text style={styles.abschnitt}>Analyse</Text>
            <Zeile label="Alkohol" wert={wertText(d.werte.alkohol, 1, '% vol')} />
            <Zeile label="Restzucker" wert={wertText(d.werte.restzucker, 1, 'g/l')} />
            <Zeile label="Gesamtsäure" wert={wertText(d.werte.saeure, 1, 'g/l')} />
            {quelle && <Text style={styles.klein}>{quelle}</Text>}

            {d.naehrwerte && (
              <>
                <Text style={styles.abschnitt}>Nährwerte je 100 ml</Text>
                <Zeile label="Brennwert" wert={`${d.naehrwerte.energieKj} kJ / ${d.naehrwerte.energieKcal} kcal`} />
                <Zeile label="Kohlenhydrate" wert={wertText(d.naehrwerte.kohlenhydrate, 1, 'g')} />
                <Zeile label="davon Zucker" wert={wertText(d.naehrwerte.zucker, 1, 'g')} />
              </>
            )}

            {(d.elabelLink || d.weinpassLink) && <Text style={styles.abschnitt}>Online</Text>}
            {d.elabelLink && <Zeile label="E-Label" wert={d.elabelLink} />}
            {d.weinpassLink && <Zeile label="Weinpass" wert={d.weinpassLink} />}
          </View>

          {(d.bilder.flasche || d.bilder.etikett) && (
            <View style={styles.bilder}>
              {d.bilder.flasche && (<>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf-Image, kein HTML-Bild */}
                <Image src={d.bilder.flasche.url} style={styles.bild} />
                <Text style={styles.bildLabel}>Flasche</Text>
              </>)}
              {d.bilder.etikett && (<>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf-Image, kein HTML-Bild */}
                <Image src={d.bilder.etikett.url} style={styles.bild} />
                <Text style={styles.bildLabel}>Etikett</Text>
              </>)}
            </View>
          )}
        </View>

        <Text style={styles.fuss} fixed>{d.betrieb.name} · Stand {stand} · Angaben ohne Gewähr, Änderungen vorbehalten</Text>
      </Page>
    </Document>
  )
}

export async function renderDatenblattPdf(d: DatenblattDaten, stand: string): Promise<Buffer> {
  return renderToBuffer(<DatenblattDocument d={d} stand={stand} />)
}
