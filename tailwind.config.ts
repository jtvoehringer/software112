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
        // software:112 Brand Palette
        // teal + yellow werden per CSS-Variable pro Tenant überschrieben (siehe layout.tsx)
        's112': {
          teal:    'var(--s112-teal, #025450)',    // Primärfarbe → tenant primary_color
          yellow:  'var(--s112-yellow, #F9E54F)',  // Highlight   → tenant secondary_color
          navy:    '#0E3C62',  // Sekundär/Dark
          green:   '#98C780',  // Akzent Grün
          blue:    '#98C6DD',  // Akzent Blau
          bg:      '#F8F8F3',  // Hintergrund
          muted:   '#5C6E6B',  // Gedämpfter Text
          border:  '#E2E8E7',  // Rahmenfarbe
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
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
