/**
 * Scope 파일을 Firestore에 업로드하는 스크립트
 *
 * 사용법:
 * node scripts/uploadScopes.js
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Firebase Admin 초기화
const serviceAccount = require("../serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Scope 파일 정보
const SCOPE_FILES = [
  {
    courseId: "pathophysiology",
    courseName: "병태생리학",
    filePath: path.join(__dirname, "..", "pathophysiologyScope.md"),
  },
  {
    courseId: "biology",
    courseName: "생물학",
    filePath: path.join(__dirname, "..", "biologyScope.md"),
  },
  {
    courseId: "microbiology",
    courseName: "미생물학",
    filePath: path.join(__dirname, "..", "microbiologyScope.md"),
  },
];

/**
 * Markdown 내용을 챕터별로 파싱
 */
function parseChapters(content) {
  const chapters = [];

  // ## 숫자. 또는 ## 숫자장. 또는 ## Chapter 숫자. 패턴으로 챕터 구분
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

    // 키워드 추출
    const keywords = extractKeywords(chapterContent);

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

/**
 * 챕터 내용에서 키워드 추출
 */
function extractKeywords(content) {
  const keywords = new Set();

  // **굵은 글씨** 추출
  const boldMatches = content.matchAll(/\*\*([^*]+)\*\*/g);
  for (const match of boldMatches) {
    const term = match[1].trim();
    if (term.length >= 2 && term.length <= 30 && !/^\d+$/.test(term)) {
      keywords.add(term);
    }
  }

  // ⭐ 표시된 섹션 제목 추출
  const starMatches = content.matchAll(/⭐+\s*(?:\(\d+\))?\s*(.+?)(?:\n|$)/g);
  for (const match of starMatches) {
    const term = match[1].trim().replace(/[()]/g, "");
    if (term.length >= 2 && term.length <= 50) {
      keywords.add(term);
    }
  }

  return Array.from(keywords).slice(0, 100);
}

/**
 * 단일 과목 Scope 업로드
 */
async function uploadScope(courseId, courseName, filePath) {
  console.log(`\n📚 ${courseName} (${courseId}) 업로드 시작...`);

  // 파일 읽기
  const content = fs.readFileSync(filePath, "utf-8");
  console.log(`  파일 크기: ${content.length.toLocaleString()}자`);

  // 챕터 파싱
  const chapters = parseChapters(content);
  console.log(`  파싱된 챕터: ${chapters.length}개`);

  if (chapters.length === 0) {
    console.log("  ⚠️ 파싱된 챕터가 없습니다. 건너뜁니다.");
    return;
  }

  const batch = db.batch();
  const scopeRef = db.collection("courseScopes").doc(courseId);

  // 메인 문서
  const scopeData = {
    courseId,
    courseName,
    totalChapters: chapters.length,
    totalWordCount: chapters.reduce((sum, c) => sum + c.wordCount, 0),
    availableChapters: chapters.map((c) => c.chapterNumber),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  batch.set(scopeRef, scopeData);

  // 챕터별 저장
  for (const chapter of chapters) {
    const chapterRef = scopeRef.collection("chapters").doc(chapter.chapterId);
    batch.set(chapterRef, {
      ...chapter,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();

  console.log(`  ✅ 업로드 완료!`);
  console.log(`     - 총 챕터: ${chapters.length}개`);
  console.log(`     - 총 글자수: ${scopeData.totalWordCount.toLocaleString()}자`);
  console.log(`     - 챕터 목록: ${scopeData.availableChapters.join(", ")}장`);

  // 챕터별 상세
  for (const ch of chapters) {
    console.log(`       ${ch.chapterNumber}장. ${ch.chapterName}: ${ch.wordCount.toLocaleString()}자, 키워드 ${ch.keywords.length}개`);
  }
}

/**
 * 메인 실행
 */
async function main() {
  console.log("🚀 Scope 업로드 시작\n");

  for (const scope of SCOPE_FILES) {
    if (!fs.existsSync(scope.filePath)) {
      console.log(`⚠️ ${scope.courseName}: 파일을 찾을 수 없습니다 (${scope.filePath})`);
      continue;
    }

    try {
      await uploadScope(scope.courseId, scope.courseName, scope.filePath);
    } catch (error) {
      console.error(`❌ ${scope.courseName} 업로드 실패:`, error.message);
    }
  }

  console.log("\n✨ 모든 Scope 업로드 완료!");
  process.exit(0);
}

main();
