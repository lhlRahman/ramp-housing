import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        // shadcn CSS variable colors
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground, #fff)" },
        input: "var(--input)",
        ring: "var(--ring)",
        // App colors
        ramp: {
          lime: "#EBF123",
          "lime-hover": "#D4DA1F",
          "lime-dim": "rgba(235, 241, 35, 0.08)",
        },
        surface: {
          0: "#0A0A0A",
          1: "#111111",
          2: "#1A1A1A",
          3: "#222222",
          4: "#2A2A2A",
        },
        border: {
          DEFAULT: "#1F1F1F",
          light: "#2A2A2A",
          hover: "#3A3A3A",
        },
        text: {
          primary: "#F5F5F5",
          secondary: "rgba(245, 245, 245, 0.6)",
          muted: "rgba(245, 245, 245, 0.35)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        glow: "0 0 20px rgba(235, 241, 35, 0.08)",
        "glow-lg": "0 0 40px rgba(235, 241, 35, 0.12)",
        card: "0 1px 3px rgba(0,0,0,0.3)",
        "card-hover": "0 8px 24px rgba(0,0,0,0.4)",
        drawer: "-12px 0 40px rgba(0,0,0,0.5)",
      },
      animation: {
        "slide-in": "slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 0.15s ease-out",
        shimmer: "shimmer 2s infinite linear",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      keyframes: {
        "slide-in": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
