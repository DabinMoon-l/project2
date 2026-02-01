import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR, Playfair_Display, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { WebVitalsReporter } from "@/components/common/WebVitalsReporter";
import SplashScreen from "@/components/common/SplashScreen";

// 노토 산스 KR 폰트 설정 (본문용)
const notoSansKR = Noto_Sans_KR({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: true,
  variable: "--font-noto-sans-kr",
});

// Playfair Display 폰트 설정 (빈티지 헤더용)
const playfairDisplay = Playfair_Display({
  weight: ["400", "500", "600", "700", "800", "900"],
  subsets: ["latin"],
  display: "swap",
  preload: true,
  variable: "--font-playfair",
});

// Cormorant Garamond 폰트 설정 (우아한 세리프)
const cormorantGaramond = Cormorant_Garamond({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: true,
  variable: "--font-cormorant",
});

export const metadata: Metadata = {
  title: "QuizBunny",
  description: "퀴즈를 풀고 토끼를 성장시키는 학습 앱",
  manifest: "/manifest.json",
  keywords: ["퀴즈", "학습", "대학", "게이미피케이션", "토끼"],
  authors: [{ name: "QuizBunny 팀" }],
  openGraph: {
    title: "QuizBunny",
    description: "퀴즈를 풀고 토끼를 성장시키는 학습 앱",
    type: "website",
    locale: "ko_KR",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#F5F0E8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${notoSansKR.variable} ${playfairDisplay.variable} ${cormorantGaramond.variable}`}
    >
      <head>
        <link rel="dns-prefetch" href="https://firebasestorage.googleapis.com" />
        <link rel="dns-prefetch" href="https://www.googleapis.com" />
        <link rel="preconnect" href="https://firebasestorage.googleapis.com" crossOrigin="anonymous" />
      </head>
      <body className={`${notoSansKR.className} antialiased`}>
        <SplashScreen>
          {children}
        </SplashScreen>
        <WebVitalsReporter />
      </body>
    </html>
  );
}
