/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sienne: '#E2725B',
        paper: '#f8f4ee',
        parchment: '#f2ece3',
        mist: '#f6f7f5',
        ink: '#1f2933',
        slate: '#68707d',
        border: '#d9ddd7',
        olive: '#5a6b5d',
      },
      fontFamily: {
        sans: ['Montserrat', 'Manrope', 'Avenir Next', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        field: '0 16px 38px rgba(32, 28, 22, 0.08)',
        journal: '0 14px 34px rgba(62, 52, 40, 0.12)',
      },
      backgroundImage: {
        'recycled-paper':
          'radial-gradient(circle at 12% 14%, rgba(226, 114, 91, 0.08), transparent 20%), radial-gradient(circle at 82% 78%, rgba(108, 122, 106, 0.08), transparent 18%), linear-gradient(180deg, rgba(255,255,255,0.72), rgba(248,244,238,0.96))',
      },
      letterSpacing: {
        field: '0.08em',
      },
    },
  },
  safelist: [
    'bg-sienne',
    'text-sienne',
    'border-sienne/25',
    'rounded-card',
    'shadow-field',
    'bg-recycled-paper',
    'font-sans',
  ],
}
