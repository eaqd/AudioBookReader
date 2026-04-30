import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Spotify-flavored palette
        bg: "#000000",
        surface: "#121212",
        card: "#181818",
        cardHover: "#1f1f1f",
        elev: "#282828",
        line: "#2a2a2a",
        text: "#ffffff",
        muted: "#a7a7a7",
        subtle: "#6a6a6a",
        accent: "#1DB954",
        accentHover: "#1ED760"
      },
      fontFamily: {
        display: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif"
        ]
      },
      boxShadow: {
        card: "0 4px 24px rgba(0,0,0,0.5)"
      }
    }
  },
  plugins: []
};

export default config;
