/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#fafafa',
          600: '#ffffff',
          700: '#e5e5e5',
          800: '#d4d4d4',
          900: '#a3a3a3',
        },
        surface: {
          750: '#1a1a1a',
          800: '#141414',
          850: '#0f0f0f',
          900: '#0a0a0a',
          950: '#000000',
        },
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.06), 0 8px 24px -8px rgba(0,0,0,0.8)',
        glow: '0 0 0 1px rgba(255,255,255,0.08)',
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
};
