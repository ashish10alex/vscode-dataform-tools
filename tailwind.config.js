/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: 'class',
    content: ['./webviews/dependancy_graph/**/*.{js,jsx,ts,tsx}', './webviews/preview_compiled/**/*.{js,jsx,ts,tsx}', './webviews/query_results/**/*.{js,jsx,ts,tsx}'],
    theme: {
      extend: {},
    },
    plugins: [],
  };