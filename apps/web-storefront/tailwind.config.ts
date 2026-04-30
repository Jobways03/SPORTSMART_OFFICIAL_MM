import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Cool neutral scale — clean off-white surfaces, charcoal type.
        // Sportsmart pivots from the warm cream feel to a crisper athletic
        // canvas to let the brand red and accent teal carry the visual energy.
        ink: {
          DEFAULT: '#1A1A1A',
          900: '#0F1115',  // near-black charcoal — primary text + buttons
          800: '#1F232A',
          700: '#363B43',
          600: '#525A65',  // body secondary text — 7.5:1 on white, AAA
          500: '#7A828F',
          400: '#A6ACB6',
          300: '#D2D6DC',
          200: '#E5E7EB',
          100: '#F3F4F6',
          50:  '#FAFAFA',  // page background
        },
        // Brand accent — Nutsby-style teal. Used for headings, links, soft
        // hover states, and any "calm" interactive element.
        accent: {
          DEFAULT: '#3FA1AE',
          dark:    '#2A8595',
          light:   '#7BC4CF',
          soft:    '#E6F4F7',  // pale tint for selected rows + section bands
        },
        // Sale / urgency — Sportsmart brand red (lifted from the wordmark).
        // Use for prices, discount chips, hot CTAs ("Buy now"), low-stock,
        // wishlist heart fill.
        sale: {
          DEFAULT: '#DC2626',
          dark:    '#B91C1C',
          light:   '#F87171',
          soft:    '#FEE2E2',
        },
        // Membership / promo — gold. Used for the announcement strip when
        // it's an offer, BMI calculator pill, "Flex membership" surfaces.
        gold: {
          DEFAULT: '#FACC15',
          dark:    '#CA8A04',
          light:   '#FDE68A',
          soft:    '#FEF3C7',
        },
        // Navy — used for the footer + any deep "premium" panel
        navy: {
          DEFAULT: '#0F2C3F',
          light:   '#1E3A52',
          soft:    '#15384F',
        },
        // Section warm background — for nuts/foods style category bands.
        peach: {
          DEFAULT: '#FCEBDF',
          dark:    '#F5C6A8',
          deep:    '#8B4513',  // copy on peach surface
        },
        success: '#16A34A',
        warning: '#D97706',
        danger:  '#DC2626',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Impact', 'sans-serif'],
        sans:    ['var(--font-sans)', 'system-ui', 'sans-serif'],
        // Brush-style hand-drawn font for high-energy hero callouts.
        // Used sparingly — REVAMP YOUR GAME, DOMINATE THE GAME, etc.
        brush:   ['var(--font-brush)', 'Impact', 'cursive'],
      },
      fontSize: {
        'caption':  ['12px', { lineHeight: '1.4' }],
        'body-sm':  ['13px', { lineHeight: '1.5' }],
        'body':     ['14px', { lineHeight: '1.5' }],
        'body-lg':  ['16px', { lineHeight: '1.5' }],
        'h3':       ['20px', { lineHeight: '1.3', fontWeight: '600' }],
        'h2':       ['28px', { lineHeight: '1.2', fontWeight: '600' }],
        'h1':       ['40px', { lineHeight: '1.1', fontWeight: '700' }],
        'display':  ['64px', { lineHeight: '1.0', fontWeight: '700', letterSpacing: '-0.02em' }],
        'display-xl': ['96px', { lineHeight: '0.95', fontWeight: '700', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        'none': '0',
        'sm':   '8px',
        DEFAULT: '12px',
        'md':   '16px',
        'lg':   '20px',
        'xl':   '28px',
        '2xl':  '36px',
        '3xl':  '48px',
        'pill': '9999px',
      },
      maxWidth: {
        'container': '1440px',
      },
      transitionDuration: {
        DEFAULT: '180ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'marquee': {
          from: { transform: 'translateX(0)' },
          to:   { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'marquee': 'marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
