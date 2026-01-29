import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { WebVitalsReporter } from "@/components/common/WebVitalsReporter";

// 노토 산스 KR 폰트 설정
const notoSansKR = Noto_Sans_KR({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: true,
  variable: "--font-noto-sans-kr",
});

export const metadata: Metadata = {
  title: "토끼키우기",
  description: "퀴즈를 풀고 토끼를 성장시키는 학습 앱",
  // PWA manifest 링크 설정
  manifest: "/manifest.json",
  // SEO 최적화
  keywords: ["퀴즈", "학습", "대학", "게이미피케이션", "토끼"],
  authors: [{ name: "토끼키우기 팀" }],
  // Open Graph
  openGraph: {
    title: "토끼키우기",
    description: "퀴즈를 풀고 토끼를 성장시키는 학습 앱",
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
    <html lang="ko" className={notoSansKR.variable}>
      <head>
        {/* DNS prefetch 최적화 */}
        <link rel="dns-prefetch" href="https://firebasestorage.googleapis.com" />
        <link rel="dns-prefetch" href="https://www.googleapis.com" />
        {/* Preconnect for faster loading */}
        <link rel="preconnect" href="https://firebasestorage.googleapis.com" crossOrigin="anonymous" />
      </head>
      <body className={`${notoSansKR.className} antialiased`}>
        {children}
        {/* Web Vitals 리포터 (클라이언트 전용) */}
        <WebVitalsReporter />
      </body>
    </html>
  );
}
