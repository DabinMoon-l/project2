import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./styles/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      // 테마 색상 (CSS 변수 활용)
      colors: {
        theme: {
          background: "var(--theme-background)",
          "background-secondary": "var(--theme-background-secondary)",
          accent: "var(--theme-accent)",
          "accent-light": "var(--theme-accent-light)",
          text: "var(--theme-text)",
          "text-secondary": "var(--theme-text-secondary)",
          border: "var(--theme-border)",
        },
        // 빈티지 신문 색상
        vintage: {
          cream: "#E8DFD0",
          "cream-light": "#F0E8DA",
          "cream-dark": "#DED5C4",
          sepia: "#4A4235",
          border: "#C4B8A8",
          "border-dark": "#8B7355",
        },
      },
      // 테마 배경색
      backgroundColor: {
        "theme-background": "var(--theme-background)",
        "theme-background-secondary": "var(--theme-background-secondary)",
        "theme-accent": "var(--theme-accent)",
        "theme-accent-light": "var(--theme-accent-light)",
      },
      // 테마 텍스트색
      textColor: {
        "theme-text": "var(--theme-text)",
        "theme-text-secondary": "var(--theme-text-secondary)",
        "theme-accent": "var(--theme-accent)",
        "theme-accent-light": "var(--theme-accent-light)",
      },
      // 테마 테두리색
      borderColor: {
        "theme-border": "var(--theme-border)",
        "theme-accent": "var(--theme-accent)",
        "theme-accent-light": "var(--theme-accent-light)",
      },
      // 테마 링 색상
      ringColor: {
        "theme-accent": "var(--theme-accent)",
        "theme-border": "var(--theme-border)",
      },
      // 기존 그라디언트 이미지
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};
export default config;
