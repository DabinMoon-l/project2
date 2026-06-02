// Phase 4 — 난이도 + 배경 mp4 압축
// 사용: node scripts/_compress_videos.js [--dry-run]

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const VIDEOS_DIR = path.join(__dirname, "../public/videos");
const dryRun = process.argv.includes("--dry-run");

// 파일별 정책
//   - difficulty/login: 모바일 배경 영상 → CRF 28, 가로 1280 cap
//   - character-bg: 캐릭터 박스 배경 → 동일 정책
//   - character-bg-original: 백업 추정, 손대지 않음
const TARGETS = [
  { file: "difficulty-easy.mp4", scale: "1280:-2" },
  { file: "difficulty-normal.mp4", scale: "1280:-2" },
  { file: "difficulty-hard.mp4", scale: "1280:-2" },
  { file: "login-bg.mp4", scale: null },         // 이미 464x832 (작음)
  { file: "character-bg.mp4", scale: null },     // 이미 720x1280
];

const COMMON_ARGS = [
  "-c:v", "libx264",
  "-preset", "slow",
  "-crf", "28",
  "-profile:v", "main",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "-an",                          // 오디오 제거 (배경 영상)
];

function compressOne(target) {
  const input = path.join(VIDEOS_DIR, target.file);
  const tempOut = path.join(VIDEOS_DIR, target.file + ".tmp.mp4");

  if (!fs.existsSync(input)) {
    console.log(`✗ ${target.file} 없음`);
    return null;
  }

  const beforeSize = fs.statSync(input).size;
  const beforeKB = (beforeSize / 1024).toFixed(0);

  if (dryRun) {
    console.log(`  ${target.file}: ${beforeKB}KB → (dry-run)`);
    return { before: beforeSize, after: 0 };
  }

  const args = ["-i", input, ...COMMON_ARGS];
  if (target.scale) args.push("-vf", `scale=${target.scale}`);
  args.push("-y", tempOut);

  // ffmpeg 실행 (stderr만 출력 — 진행률 정보)
  execSync(`ffmpeg ${args.map((a) => `"${a}"`).join(" ")}`, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const afterSize = fs.statSync(tempOut).size;
  const afterKB = (afterSize / 1024).toFixed(0);
  const ratio = ((afterSize / beforeSize) * 100).toFixed(0);

  // 원본 백업 후 교체
  fs.renameSync(tempOut, input);

  console.log(
    `  ${target.file}: ${beforeKB}KB → ${afterKB}KB (${ratio}%)`
  );
  return { before: beforeSize, after: afterSize };
}

let totalBefore = 0;
let totalAfter = 0;
console.log(`[대상] ${TARGETS.length}개 mp4`);

for (const t of TARGETS) {
  const r = compressOne(t);
  if (r) {
    totalBefore += r.before;
    totalAfter += r.after;
  }
}

const beforeMB = (totalBefore / 1024 / 1024).toFixed(1);
const afterMB = (totalAfter / 1024 / 1024).toFixed(1);
const savedMB = ((totalBefore - totalAfter) / 1024 / 1024).toFixed(1);
const ratio = totalBefore > 0
  ? ((totalAfter / totalBefore) * 100).toFixed(0)
  : "-";

console.log(
  `\n[${dryRun ? "dry-run" : "완료"}] ${beforeMB}MB → ${afterMB}MB (${ratio}%, ${savedMB}MB 절감)`
);
