import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        ink: "#0b0b10",
        paper: "#f8f7f2"
      }
    }
  },
  plugins: []
};

export default config;
