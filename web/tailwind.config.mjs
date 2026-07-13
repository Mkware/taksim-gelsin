/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#F5B915',
          dark: '#D4A008',
          light: '#FFD54A',
        },
        ink: {
          DEFAULT: '#0B1020',
          soft: '#1A2135',
        },
        midnight: {
          DEFAULT: '#05070A',
          elevated: '#0C1219',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F5F6FA',
          subtle: '#EEF0F6',
        },
        border: '#E4E7EE',
        muted: '#6B7280',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 24px -4px rgba(11, 16, 32, 0.08)',
        glow: '0 0 40px -8px rgba(245, 185, 21, 0.35)',
      },
    },
  },
  plugins: [],
};
