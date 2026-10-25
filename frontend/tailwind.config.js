/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,jsx}',
    './src/components/**/*.{js,jsx}',
    './src/context/**/*.{js,jsx}',
    // The status colours live in lib/orderStatus.js; without this, a colour used
    // nowhere else (partly delivered, pickup scheduled) is never generated.
    './src/lib/**/*.{js,jsx}',
  ],
  // The visitor's own switch decides, not the device: `dark` on <html> is set from their
  // saved choice (cookie + localStorage) before the page paints — see app/layout.js.
  darkMode: 'class',
  theme: {
    extend: {
      // Ready Marine's palette (DESIGN.md "Marine & Precision Velocity"): cyan for actions and
      // active states, teal for structure, navy for the deepest surfaces.
      colors: {
        marine: {
          cyan: '#00A6CE',
          'cyan-dark': '#008CAE',
          primary: '#006781',
          teal: '#1A4D68',
          navy: '#0E2A38',
          ink: '#1E272E',
          muted: '#3D484E',
          outline: '#6D797E',
          line: '#BCC8CE',
          canvas: '#F6FAFF',
          mist: '#EBF5FE',
          haze: '#E6EFF9',
          frost: '#DAE4ED',
          success: '#00B894',
          warning: '#F39C12',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        pod: '0 8px 24px -4px rgba(26, 77, 104, 0.08), 0 2px 6px -1px rgba(0, 166, 206, 0.06)',
        aura: '0 12px 28px -6px rgba(0, 166, 206, 0.18)',
      },
    },
  },
  plugins: [],
};
