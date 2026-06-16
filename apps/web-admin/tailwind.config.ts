import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sportsmart admin palette — red + white + grey.
        brand: {
          DEFAULT: '#D11A2A',
          dark: '#9E0E1B',
        },
        ink: {
          900: '#0F1115',
          600: '#525A65',
        },
      },
    },
  },
  plugins: [],
};

export default config;
