import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        ramp: {
          lime: '#EBF123',
          'lime-hover': '#D4DA1F',
          'lime-dim': 'rgba(235, 241, 35, 0.08)',
        },
        surface: {
          0: '#0A0A0A',
          1: '#111111',
          2: '#1A1A1A',
          3: '#222222',
          4: '#2A2A2A',
        },
        border: {
          DEFAULT: '#1F1F1F',
          light: '#2A2A2A',
          hover: '#3A3A3A',
        },
        text: {
          primary: '#F5F5F5',
          secondary: 'rgba(245, 245, 245, 0.6)',
          muted: 'rgba(245, 245, 245, 0.35)',
        },
      },
      boxShadow: {
        'glow': '0 0 20px rgba(235, 241, 35, 0.08)',
        'card': '0 1px 3px rgba(0,0,0,0.3)',
        'card-hover': '0 8px 24px rgba(0,0,0,0.4)',
        'drawer': '-12px 0 40px rgba(0,0,0,0.5)',
      },
      animation: {
        'slide-in': 'slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 0.15s ease-out',
      },
      keyframes: {
        'slide-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
