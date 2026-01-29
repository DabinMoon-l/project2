import withPWA from "next-pwa";

/** @type {import('next').NextConfig} */
const nextConfig = {};

// PWA 설정
const pwaConfig = withPWA({
  dest: "public", // 서비스 워커 파일이 생성될 위치
  register: true, // 서비스 워커 자동 등록
  skipWaiting: true, // 새 서비스 워커 즉시 활성화
  disable: process.env.NODE_ENV === "development", // 개발 모드에서는 PWA 비활성화
});

export default pwaConfig(nextConfig);
