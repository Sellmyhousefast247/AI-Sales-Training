import type { Config } from "tailwindcss";

/**
 * Dark navy + cyan theme ("Acquisitions AI OS" redesign).
 *
 * The app was written against a light theme: `bg-white` cards on an `ink`
 * gray scale (50 lightest … 900 darkest) with stock Tailwind status colors
 * (emerald/amber/red 50–100 tint backgrounds, 700–900 dark text).
 *
 * Rather than touching ~20 pages, the theme is inverted at the token level:
 *  - `white`  → card navy (every bg-white card goes dark automatically)
 *  - `ink`    → reversed: 50 is now the darkest page bg, 900 near-white text
 *  - status hues → low steps become dark tints, high steps light text
 * CTA buttons (`bg-ink-900 text-white`) get a cyan gradient via globals.css.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        white: "#182136",
        ink: {
          50:  "#0E1424",
          100: "#1C2742",
          200: "#263352",
          300: "#35446C",
          400: "#64749B",
          500: "#93A3C6",
          600: "#B4C2DE",
          700: "#CFDAEE",
          800: "#E3EBF7",
          900: "#F2F6FC",
        },
        brand: {
          DEFAULT: "#38BDF8",
          accent:  "#38BDF8",
        },
        tier: {
          1: "#94A3B8",
          2: "#22D3EE",
          3: "#3B82F6",
          4: "#8B5CF6",
          5: "#F59E0B",
        },
        // Status hues re-stepped for the dark surface: 50/100 are tint
        // backgrounds, 600-900 are light readable text.
        emerald: {
          50:  "#0B2A20",
          100: "#0F3A2C",
          200: "#14533A",
          300: "#1B6B4A",
          600: "#34D399",
          700: "#6EE7B7",
          800: "#A7F3D0",
          900: "#D1FAE5",
        },
        amber: {
          50:  "#2E2208",
          100: "#3A2B0A",
          200: "#4A3A0E",
          300: "#6B5312",
          600: "#FBBF24",
          700: "#FCD34D",
          800: "#FDE68A",
          900: "#FEF3C7",
        },
        red: {
          50:  "#331416",
          100: "#401B1E",
          200: "#57242A",
          300: "#7A3138",
          600: "#F87171",
          700: "#FCA5A5",
          800: "#FECACA",
          900: "#FEE2E2",
        },
        rose: {
          50:  "#33141A",
          100: "#401B22",
          200: "#5A2530",
          300: "#7A3140",
          700: "#FDA4AF",
          800: "#FECDD3",
        },
        green: {
          600: "#4ADE80",
        },
        cyan: {
          700: "#67E8F9",
          800: "#A5F3FC",
        },
        blue: {
          700: "#93C5FD",
          800: "#BFDBFE",
        },
        violet: {
          700: "#C4B5FD",
          800: "#DDD6FE",
        },
      },
      boxShadow: {
        glow: "0 0 18px rgba(56, 189, 248, 0.30)",
        card: "0 1px 3px rgba(0, 0, 0, 0.4)",
      },
      fontFamily: {
        sans: ['-apple-system','BlinkMacSystemFont','Segoe UI','Roboto','sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
