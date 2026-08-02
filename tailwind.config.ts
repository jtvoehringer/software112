import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // software:112 Brand Palette — Design-System 2026-08 (siehe project_design_relaunch.md)
        // teal + yellow werden per CSS-Variable pro Tenant überschrieben (siehe layout.tsx):
        // teal = "Aktion"-Farbe (Buttons, aktive Zustände), yellow = Text-auf-teal-Rolle.
        // Restliche Töne (Blauskala, Grau, Text-/Linienabstufungen, Status) sind global fix —
        // rudimentäres Kunden-CD wirkt nur auf primary_color/secondary_color, nicht auf diese.
        's112': {
          teal:      'var(--s112-teal, #4F86D6)',    // Aktion → tenant primary_color
          yellow:    'var(--s112-yellow, #FFFFFF)',  // Text auf teal → tenant secondary_color
          navy:      '#0E3C62',  // Alt: Sekundär/Dark (unverändert, wird noch vereinzelt verwendet)
          green:     '#98C780',  // Alt: Akzent Grün (unverändert)
          blue:      '#98C6DD',  // Alt: Akzent Blau (unverändert)

          'blue-50':  '#EEF4FD', // aktiver Nav-Hintergrund, Fokusfläche
          'blue-100': '#DCE8FA', // Diagrammbalken inaktiv, Chip-Rahmen
          'blue-300': '#77A6E7', // Logo-Blau: Marke, Diagramm-Highlight
          'blue-700': '#2F63AC', // blauer Text/Icon auf Hell (AA), Hover

          bg:        '#F7F8FA',  // App-Hintergrund
          surface:   '#FFFFFF',  // Karten, Sidebar, Kopfzeile
          line:      '#EDEEF1',  // Standard-Trennlinien, Kartenrahmen
          'line-str': '#D6D8DD', // Eingabefeld-/Sekundärbutton-Rahmen
          grey:      '#99999D',  // Logo-Grau: Avatar, neutrale Marker
          muted:     '#6E717A',  // Gedämpfter Text (Alias von text-2, für Bestandscode)
          'text-1':  '#5A5D66',  // sekundärer Text, inaktive Nav-Labels
          'text-2':  '#6E717A',  // Labels, inaktive Icons
          text:      '#22252B',  // Fließtext, Überschriften, Zahlen
          tertiary:  '#A0A3AB',  // Meta-Text, dekorative Icons, Platzhalter

          border:    '#EDEEF1',  // Alias von line, für Bestandscode (border-s112-border)

          ok:        '#3E9B79', 'ok-bg':   '#EAF5F0', 'ok-fg':   '#2C6B55',
          warn:      '#D9A441', 'warn-bg': '#FBF3E3', 'warn-fg': '#8A6415',
          err:       '#C9564E', 'err-bg':  '#FBEEED', 'err-fg':  '#8E3A34',
        },
      },
      fontFamily: {
        sans:    ['var(--font-plex-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-poppins)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        'xl': '0.75rem',
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
}

export default config
