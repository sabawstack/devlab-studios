/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{astro,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#4500ff',
          ink: '#11142a',
          teal: '#4500ff',
          mint: '#eeefff',
          orange: '#0800ff',
          orangeDark: '#0800cc',
          shell: '#f5f5fc',
        },
        navy: {
          50: '#e8edff',
          100: '#cfd9ff',
          200: '#a3b8ff',
          300: '#7594fb',
          400: '#4d72ef',
          500: '#3055d6',
          600: '#1f3fa6',
          700: '#193480',
          800: '#152b66',
          900: '#11214d',
          950: '#0b1b34',
        },
        ink: '#0b1426',
        mist: '#b5c4e1',
        // Free open play (spec §11): one neon accent layered on DevLab navy/violet.
        pickle: {
          neon: '#c6ff2e',
          teamb: '#8d9bff',
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

