/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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
