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
        's112': {
          teal:    '#025450',  // Primärfarbe
          navy:    '#0E3C62',  // Sekundär/Dark
          green:   '#98C780',  // Akzent Grün
          blue:    '#98C6DD',  // Akzent Blau
          yellow:  '#F9E54F',  // Highlight
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
