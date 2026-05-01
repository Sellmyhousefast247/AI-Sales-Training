import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50:  "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#1E293B",
          900: "#0F172A",
        },
        // Vivid brand: indigo→violet gradient anchor, plus an electric
        // accent for CTAs and a money-green for results.
        brand: {
          50:  "#EEF2FF",
          100: "#E0E7FF",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          DEFAULT: "#4F46E5",
          accent:  "#10B981",
        },
        // Result-card tones — used on the calculator output to
        // colour-code ARV / repairs / wholesale / novation.
        money: {
          50:  "#ECFDF5",
          100: "#D1FAE5",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
        },
        flame: {
          50:  "#FFF7ED",
          100: "#FFEDD5",
          500: "#F97316",
          600: "#EA580C",
          700: "#C2410C",
        },
        sky2: {
          50:  "#F0F9FF",
          100: "#E0F2FE",
          500: "#0EA5E9",
          600: "#0284C7",
          700: "#0369A1",
        },
        violet2: {
          50:  "#F5F3FF",
          100: "#EDE9FE",
          500: "#8B5CF6",
          600: "#7C3AED",
          700: "#6D28D9",
        },
        tier: {
          1: "#94A3B8",
          2: "#22D3EE",
          3: "#3B82F6",
          4: "#8B5CF6",
          5: "#F59E0B",
        },
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #4F46E5 0%, #7C3AED 50%, #DB2777 100%)",
        "money-gradient": "linear-gradient(135deg, #059669 0%, #10B981 100%)",
        "flame-gradient": "linear-gradient(135deg, #F97316 0%, #DB2777 100%)",
        "sky-gradient": "linear-gradient(135deg, #0EA5E9 0%, #4F46E5 100%)",
      },
      fontFamily: {
        sans: ['-apple-system','BlinkMacSystemFont','Segoe UI','Roboto','sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
