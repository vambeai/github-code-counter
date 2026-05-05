import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        race: ['"Bungee"', "system-ui", "sans-serif"],
        pixel: ['"Press Start 2P"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
