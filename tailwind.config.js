/** @type {import('tailwindcss').Config} */
module.exports = {
  // Habilita a troca de temas manipulando a classe 'dark' na tag <html>
  darkMode: 'class',
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Fonte sem serifa moderna e altamente legível
        sans: ['Inter', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
