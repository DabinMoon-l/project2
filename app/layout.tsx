import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WebVitalsReporter } from "@/components/common/WebVitalsReporter";

// 최적화된 폰트 설정 (next/font)
const inter = Inter({
  subsets: ["latin"],
  display: "swap", // 폰트 로딩 최적화
  preload: true,
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "용사 퀴즈",
  description: "용사 퀴즈 앱",
  // PWA manifest 링크 설정
  manifest: "/manifest.json",
  // SEO 최적화
  keywords: ["퀴즈", "학습", "대학", "게이미피케이션"],
  authors: [{ name: "용사 퀴즈 팀" }],
  // Open Graph
  openGraph: {
    title: "용사 퀴즈",
    description: "대학 수업 보조 앱 - 퀴즈와 게시판으로 함께 성장하세요",
    type: "website",
    locale: "ko_KR",
  },
};

// Viewport 설정 분리 (Next.js 14+ 권장)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#4F46E5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={inter.variable}>
      <head>
        {/* DNS prefetch 최적화 */}
        <link rel="dns-prefetch" href="https://firebasestorage.googleapis.com" />
        <link rel="dns-prefetch" href="https://www.googleapis.com" />
        {/* Preconnect for faster loading */}
        <link rel="preconnect" href="https://firebasestorage.googleapis.com" crossOrigin="anonymous" />
      </head>
      <body className={`${inter.className} antialiased`}>
        {children}
        {/* Web Vitals 리포터 (클라이언트 전용) */}
        <WebVitalsReporter />
      </body>
    </html>
  );
}
