// Phase 2 — 코드의 /images/*.png 참조를 .webp 로 일괄 변경
// 대상은 Phase 2에서 WebP 변환된 20개 파일 한정. 다른 .png 는 건드리지 않음.
// 사용: node scripts/_replace_png_to_webp.js [--dry-run]

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

// 대상 파일 명 (확장자 제외)
const TARGETS = [
  "home-wide", "home-book", "home-fight",
  "difficulty-easy", "difficulty-normal", "difficulty-hard",
  "completed-badge", "character-card-bg",
  "biology-quiz-ribbon", "biology-review-ribbon",
  "biology-students-ribbon", "biology-dashboard-ribbon",
  "microbiology-quiz-ribbon", "microbiology-review-ribbon",
  "microbiology-students-ribbon", "microbiology-dashboard-ribbon",
  "pathophysiology-quiz-ribbon", "pathophysiology-review-ribbon",
  "pathophysiology-students-ribbon", "pathophysiology-dashboard-ribbon",
];

// 정규식: /images/<targets>.png 패턴만 정확히 매칭
const pattern = new RegExp(
  `(/images/)(${TARGETS.join("|")})(\\.png)\\b`,
  "g"
);

// 검색 대상 디렉토리
const SEARCH_DIRS = ["app", "components", "lib", "scripts", "tests"];
const SEARCH_EXTS = [".ts", ".tsx", ".js", ".mjs", ".jsx"];

function walk(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, list);
    else if (SEARCH_EXTS.some((e) => entry.name.endsWith(e))) list.push(full);
  }
  return list;
}

const files = SEARCH_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

let totalChanges = 0;
let touchedFiles = 0;

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const matches = content.match(pattern);
  if (!matches || matches.length === 0) continue;

  const newContent = content.replace(pattern, "$1$2.webp");
  const changes = matches.length;
  totalChanges += changes;
  touchedFiles++;

  const rel = path.relative(ROOT, file);
  console.log(`  ${rel}: ${changes}곳`);

  if (!dryRun) fs.writeFileSync(file, newContent);
}

console.log(
  `\n[${dryRun ? "dry-run" : "완료"}] ${touchedFiles}개 파일, ${totalChanges}곳 변경`
);
