// PostCSS pipeline for the web build. Vite picks this up automatically
// when bundling web/tailwind.css. Tailwind generates the utility
// classes; autoprefixer adds vendor prefixes for browser compatibility.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
