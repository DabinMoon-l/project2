// Phase 2 이미지 압축 — 큰 PNG 파일을 WebP로 변환
// 사용: node scripts/_convert_images_to_webp.js [--dry-run]
//
// 정책: 1MB 이상 PNG만 대상. quality 80 (시각 차이 거의 없음, 크기 5~20% 수준)
//       변환 후 원본 PNG는 보관 (별도 삭제 단계)

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const IMAGES_DIR = path.join(__dirname, "../public/images");
const MIN_SIZE = 1024 * 1024; // 1MB

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const files = fs.readdirSync(IMAGES_DIR).filter((f) => f.endsWith(".png"));

  const targets = files
    .map((f) => {
      const fullPath = path.join(IMAGES_DIR, f);
      const size = fs.statSync(fullPath).size;
      return { file: f, fullPath, size };
    })
    .filter((t) => t.size >= MIN_SIZE)
    .sort((a, b) => b.size - a.size);

  console.log(`[대상] ${targets.length}개 파일 (1MB 이상 PNG)`);
  let totalBefore = 0;
  let totalAfter = 0;

  for (const t of targets) {
    const webpPath = t.fullPath.replace(/\.png$/, ".webp");
    const beforeKB = (t.size / 1024).toFixed(0);

    if (dryRun) {
      console.log(`  ${t.file}: ${beforeKB}KB → (dry-run)`);
      totalBefore += t.size;
      continue;
    }

    try {
      await sharp(t.fullPath)
        .webp({ quality: 80, effort: 6 })
        .toFile(webpPath);

      const afterSize = fs.statSync(webpPath).size;
      const afterKB = (afterSize / 1024).toFixed(0);
      const ratio = ((afterSize / t.size) * 100).toFixed(0);

      console.log(
        `  ${t.file}: ${beforeKB}KB → ${afterKB}KB (${ratio}%)`
      );
      totalBefore += t.size;
      totalAfter += afterSize;
    } catch (e) {
      console.error(`  ${t.file}: ERROR — ${e.message}`);
    }
  }

  const beforeMB = (totalBefore / 1024 / 1024).toFixed(1);
  const afterMB = (totalAfter / 1024 / 1024).toFixed(1);
  const savedMB = ((totalBefore - totalAfter) / 1024 / 1024).toFixed(1);
  console.log(
    `\n[결과] 전체 ${beforeMB}MB → ${afterMB}MB (${savedMB}MB 절감)`
  );

  if (!dryRun) {
    console.log(`\n다음 단계:`);
    console.log(`  1. 코드의 .png 참조를 .webp 로 변경`);
    console.log(`  2. 원본 .png 삭제 (별도 명령)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
