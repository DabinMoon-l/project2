import withPWA from "next-pwa";
import defaultCache from "next-pwa/cache.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack 설정 (workspace root 경고 해결)
  turbopack: {
    root: '.',
  },
  // CDN 캐시 헤더 — 정적 에셋 + 이미지
  async headers() {
    return [
      {
        // 토끼 이미지, 리본 이미지 등 정적 에셋 (1년 캐시, immutable)
        source: '/images/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/rabbit/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/rabbit_profile/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/lottie/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // 폰트 (1년 캐시)
        source: '/fonts/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // API 라우트 — 랭킹/레이더 CDN 캐시 (5분 edge, 10분 stale)
        source: '/api/cache/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=600' },
        ],
      },
    ];
  },
  // 이미지 최적화 설정
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        pathname: "/v0/b/**",
      },
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
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
  // FCM 서비스 워커를 next-pwa SW에 통합 (별도 등록 충돌 방지)
  customWorkerDir: "worker",
  runtimeCaching: [
    // 비디오 파일은 캐시하지 않음 (ERR_CACHE_OPERATION_NOT_SUPPORTED 방지)
    {
      urlPattern: /\.(?:mp4|webm|ogg)$/i,
      handler: "NetworkOnly",
    },
    // Next.js 페이지 네비게이션 — StaleWhileRevalidate로 전환:
    //   • 캐시에서 즉시 응답 → iOS PWA cold reload·저속 네트워크에서 빈 화면 시간 최소화
    //   • 백그라운드에서 네트워크 요청해 다음 방문 시 최신 반영
    //   • 배포 후 chunk mismatch는 layout.tsx의 ChunkLoadError 자동 리로드가 복구
    //   • skipWaiting: true와 함께 SW가 즉시 활성화되고, HTML은 SWR로 갱신
    {
      urlPattern: /^\/_next\/data\/.+\.json$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "next-data",
        expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    // Next.js RSC 페이로드 — StaleWhileRevalidate
    {
      urlPattern: ({ request }) => request.headers.get("RSC") === "1",
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "next-rsc",
        expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
      },
    },
    // HTML 페이지 — StaleWhileRevalidate
    {
      urlPattern: ({ request }) => request.mode === "navigate",
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "pages",
        expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 },
      },
    },
    // 기본 캐싱 규칙 (비디오 CacheFirst 제거)
    ...defaultCache.filter(entry => entry.options?.cacheName !== "static-video-assets"),
  ],
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
