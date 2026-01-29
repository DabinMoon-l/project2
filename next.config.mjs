import withPWA from "next-pwa";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 이미지 최적화 설정
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  // 실험적 기능
  experimental: {
    // 번들 최적화
    optimizePackageImports: ["framer-motion", "firebase"],
  },
  // 프로덕션 빌드에서 console.log 제거
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
};

// PWA 설정
const pwaConfig = withPWA({
  dest: "public", // 서비스 워커 파일이 생성될 위치
  register: true, // 서비스 워커 자동 등록
  skipWaiting: true, // 새 서비스 워커 즉시 활성화
  disable: process.env.NODE_ENV === "development", // 개발 모드에서는 PWA 비활성화
});

// 번들 분석기 설정 (조건부 적용)
let finalConfig = pwaConfig(nextConfig);

if (process.env.ANALYZE === "true") {
  try {
    const withBundleAnalyzer = (await import("@next/bundle-analyzer")).default;
    const bundleAnalyzer = withBundleAnalyzer({ enabled: true });
    finalConfig = bundleAnalyzer(finalConfig);
  } catch {
    console.warn("@next/bundle-analyzer를 찾을 수 없습니다. npm install @next/bundle-analyzer를 실행해주세요.");
  }
}

export default finalConfig;
