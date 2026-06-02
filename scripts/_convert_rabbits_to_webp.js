// Phase 3 — 토끼 이미지 일괄 WebP 변환
// /rabbit/, /rabbit_profile/ 디렉토리 PNG 161개 변환
// 사용: node scripts/_convert_rabbits_to_webp.js [--dry-run]

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIRS = [
  path.join(ROOT, "public/rabbit"),
  path.join(ROOT, "public/rabbit_profile"),
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  let totalBefore = 0;
  let totalAfter = 0;
  let count = 0;
  let errors = 0;

  for (const dir of DIRS) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
    console.log(`\n[${path.relative(ROOT, dir)}] ${files.length}개 PNG`);

    // 병렬도 8로 제한 (CPU/IO 적절히 활용)
    const BATCH = 8;
    for (let i = 0; i < files.length; i += BATCH) {
      const slice = files.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (f) => {
          const inPath = path.join(dir, f);
          const outPath = inPath.replace(/\.png$/, ".webp");
          const beforeSize = fs.statSync(inPath).size;
          totalBefore += beforeSize;

          if (dryRun) return;

          try {
            await sharp(inPath)
              .webp({ quality: 80, effort: 6 })
              .toFile(outPath);
            totalAfter += fs.statSync(outPath).size;
            count++;
          } catch (e) {
            console.error(`  ${f}: ERROR — ${e.message}`);
            errors++;
          }
        })
      );
      process.stdout.write(`.`);
    }
    console.log(` 완료`);
  }

  const beforeMB = (totalBefore / 1024 / 1024).toFixed(1);
  const afterMB = (totalAfter / 1024 / 1024).toFixed(1);
  const savedMB = ((totalBefore - totalAfter) / 1024 / 1024).toFixed(1);
  const ratio = totalBefore > 0
    ? ((totalAfter / totalBefore) * 100).toFixed(0)
    : "-";

  console.log(
    `\n[${dryRun ? "dry-run" : "완료"}] ${count}개 변환, ${errors}개 에러`
  );
  console.log(
    `      ${beforeMB}MB → ${afterMB}MB (${ratio}%, ${savedMB}MB 절감)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
