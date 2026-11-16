import { PB } from './src/config/pickleballPalette.js'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{astro,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        // "Blueprint" brand (src/styles/brand.css); fallbacks are metric-matched there.
        display: ['var(--font-display)'],
        label: ['var(--font-label)'],
        longform: ['var(--font-longform)'],
      },
      fontSize: {
        'step--1': 'var(--step--1)',
        'step-0': 'var(--step-0)',
        'step-1': 'var(--step-1)',
        'step-2': 'var(--step-2)',
        'step-3': 'var(--step-3)',
        'step-4': 'var(--step-4)',
        'step-5': 'var(--step-5)',
      },
      borderRadius: {
        'dl-xs': 'var(--radius-xs)',
        'dl-s': 'var(--radius-s)',
        'dl-m': 'var(--radius-m)',
      },
      maxWidth: {
        container: 'var(--container)',
      },
      colors: {
        // Brand roles as CSS variables, so `.ink-panel` inverts them in place.
        dl: {
          paper: 'var(--paper)',
          'paper-2': 'var(--paper-2)',
          ink: 'var(--ink)',
          'ink-2': 'var(--ink-2)',
          'ink-3': 'var(--ink-3)',
          rule: 'var(--rule)',
          redline: 'var(--redline)',
          ok: 'var(--ok)',
          link: 'var(--link)',
          // Diagram and exhibit accents (spec N.3): magenta and violet only inside figures, amber only inside exhibits.
          magenta: 'var(--redline)',
          violet: 'var(--violet)',
          blue: 'var(--link)',
          amber: 'var(--amber)',
          danger: 'var(--danger)',
        },
        brand: {
          DEFAULT: '#4500ff',
          ink: '#11142a',
          teal: '#4500ff',
          mint: '#eeefff',
          orange: '#0800ff',
          orangeDark: '#0800cc',
          shell: '#f5f5fc',
        },
        // DevLab Pickleball (src/config/pickleballPalette.js): graphite surfaces, indigo play, magenta team B.
        pb: {
          canvas: PB.canvas,
          sunken: PB.sunken,
          surface: PB.surface,
          raised: PB.raised,
          rule: PB.rule,
          field: PB.field,
          ink: PB.ink,
          'ink-2': PB.ink2,
          play: PB.play,
          'team-b': PB.teamB,
        },
      },
      boxShadow: {
        glass: '0 20px 50px rgba(10, 13, 33, 0.22)',
        card: '0 14px 36px rgba(17, 20, 42, 0.08)',
        elevated: '0 28px 70px rgba(10, 13, 33, 0.20)',
      },
      backdropBlur: {
        18: '18px',
      },
    },
  },
  plugins: [],
}

