/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#52c41a',
          dark: '#389e0d',
          light: '#95de64',
        },
        neu: {
          bg: '#f0f2f5',
          shadow: '#d1d9e6',
          light: '#ffffff',
        },
      },
      boxShadow: {
        'neu-card': '6px 6px 12px #d1d9e6, -6px -6px 12px #ffffff',
        'neu-inset': 'inset 4px 4px 8px #d1d9e6, inset -4px -4px 8px #ffffff',
        'neu-sm': '3px 3px 6px #d1d9e6, -3px -3px 6px #ffffff',
        'neu-pressed': 'inset 3px 3px 6px #d1d9e6, inset -3px -3px 6px #ffffff',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
