// microbiologyScope.md 를 Firestore courseScopes/microbiology 에 업로드
// CF uploadCourseScope 와 동일한 로직 (parseChapters, extractKeywordsFromContent, removeCommonKeywords)
// 사용: node scripts/upload-microbiology-scope.js [--dry-run]

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.join(__dirname, "../serviceAccountKey.json"))
  ),
});
const db = admin.firestore();

const COURSE_ID = "microbiology";
const COURSE_NAME = "미생물학";
const SCOPE_FILE = path.join(__dirname, "../microbiologyScope.md");

// ---------- CF courseScope.ts 와 동일한 파서 ----------

function parseChapters(content) {
  const chapters = [];
  const chapterRegex = /^##\s*(?:Chapter\s+)?0*(\d+)(?:장)?[.\s]+(.+?)$/gm;
  const matches = [...content.matchAll(chapterRegex)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const chapterNumber = match[1];
    const chapterName = match[2].trim();
    const startIndex = match.index;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index : content.length;

    const chapterContent = content.slice(startIndex, endIndex).trim();
    const wordCount = chapterContent.length;
    const keywords = extractKeywordsFromContent(chapterContent);

    chapters.push({
      chapterId: `ch_${chapterNumber}`,
      chapterNumber,
      chapterName,
      content: chapterContent,
      keywords,
      wordCount,
    });
  }
  return chapters;
}

function extractKeywordsFromContent(content) {
  const keywords = new Set();
  const koreanMatches = content.match(/[가-힣]{3,}/g);
  if (koreanMatches) {
    for (const word of koreanMatches) {
      const stem = word.replace(/[은는이가을를의에로와과도만까지서며고]$/, "");
      if (stem.length >= 3) keywords.add(stem);
      if (word.length >= 3) keywords.add(word);
    }
  }
  const mixedMatches = content.match(/[A-Za-z]+[가-힣]{2,}/g);
  if (mixedMatches) {
    for (const word of mixedMatches) {
      keywords.add(word);
    }
  }
  return Array.from(keywords);
}

function removeCommonKeywords(chapters) {
  const wordChapterCount = new Map();
  for (const ch of chapters) {
    const uniqueWords = new Set(ch.keywords);
    for (const word of uniqueWords) {
      wordChapterCount.set(word, (wordChapterCount.get(word) || 0) + 1);
    }
  }
  const threshold = Math.min(3, Math.ceil(chapters.length * 0.3));
  for (const ch of chapters) {
    ch.keywords = ch.keywords.filter(
      (w) => (wordChapterCount.get(w) || 0) < threshold
    );
  }
}

// ---------- 실행 ----------

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const scopeContent = fs.readFileSync(SCOPE_FILE, "utf8");
  console.log(`[파일] ${SCOPE_FILE} (${scopeContent.length}자)`);

  const chapters = parseChapters(scopeContent);
  if (chapters.length === 0) {
    console.error("❌ 파싱된 챕터가 없습니다. 헤딩 형식을 확인하세요.");
    process.exit(1);
  }

  removeCommonKeywords(chapters);

  console.log(`\n[파싱 결과] ${chapters.length}개 챕터`);
  let total = 0;
  for (const ch of chapters) {
    console.log(`  ${ch.chapterNumber}장. ${ch.chapterName}: ${ch.wordCount}자, 키워드 ${ch.keywords.length}개`);
    total += ch.wordCount;
  }
  console.log(`  전체: ${total}자`);

  if (dryRun) {
    console.log("\n[dry-run] 업로드 건너뜀");
    return;
  }

  console.log(`\n[업로드 시작] courseScopes/${COURSE_ID}`);

  const batch = db.batch();
  const scopeRef = db.collection("courseScopes").doc(COURSE_ID);

  batch.set(scopeRef, {
    courseId: COURSE_ID,
    courseName: COURSE_NAME,
    totalChapters: chapters.length,
    totalWordCount: total,
    availableChapters: chapters.map((c) => c.chapterNumber),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  for (const chapter of chapters) {
    const chapterRef = scopeRef.collection("chapters").doc(chapter.chapterId);
    batch.set(chapterRef, {
      ...chapter,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  console.log(`✅ 업로드 완료: ${chapters.length}개 챕터, ${total}자`);
}

main()
  .catch((e) => {
    console.error("업로드 오류:", e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
