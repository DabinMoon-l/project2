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

    const chapterRawContent = content.slice(startIndex, endIndex).trim();

    // 1단계 sub-chapter: "### N-M. 이름" (예: ### 5-3. 나선균군)
    const subChapterRegex = new RegExp(
      `^###\\s*${chapterNumber}-(\\d+)[.\\s]+(.+?)$`,
      "gm"
    );
    const subMatches = [...chapterRawContent.matchAll(subChapterRegex)];

    if (subMatches.length === 0) {
      chapters.push({
        chapterId: `ch_${chapterNumber}`,
        chapterNumber,
        chapterName,
        content: chapterRawContent,
        keywords: extractKeywordsFromContent(chapterRawContent),
        wordCount: chapterRawContent.length,
      });
      continue;
    }

    // sub-chapter 있음 → 메인(개요) + sub들
    const firstSubIndex = subMatches[0].index;
    const mainContent = chapterRawContent.slice(0, firstSubIndex).trim();
    chapters.push({
      chapterId: `ch_${chapterNumber}`,
      chapterNumber,
      chapterName,
      content: mainContent,
      keywords: extractKeywordsFromContent(mainContent),
      wordCount: mainContent.length,
    });

    for (let j = 0; j < subMatches.length; j++) {
      const sm = subMatches[j];
      const subNumber = sm[1];
      const subName = sm[2].trim();
      const subStart = sm.index;
      const subEnd =
        j < subMatches.length - 1 ? subMatches[j + 1].index : chapterRawContent.length;
      const subRawContent = chapterRawContent.slice(subStart, subEnd).trim();
      const subKey = `${chapterNumber}_${subNumber}`;

      // 2단계 sub-sub-chapter: "#### N-M-L. 이름" (예: #### 7-1-2. 헤르페스바이러스과)
      const subSubRegex = new RegExp(
        `^####\\s*${chapterNumber}-${subNumber}-(\\d+)[.\\s]+(.+?)$`,
        "gm"
      );
      const subSubMatches = [...subRawContent.matchAll(subSubRegex)];

      if (subSubMatches.length === 0) {
        chapters.push({
          chapterId: `ch_${subKey}`,
          chapterNumber: subKey,
          chapterName: subName,
          parentChapterNumber: chapterNumber,
          content: subRawContent,
          keywords: extractKeywordsFromContent(subRawContent),
          wordCount: subRawContent.length,
        });
        continue;
      }

      // 2단계 있음 → sub-chapter(개요) + sub-sub들 분리
      const firstSubSubIndex = subSubMatches[0].index;
      const subMainContent = subRawContent.slice(0, firstSubSubIndex).trim();
      chapters.push({
        chapterId: `ch_${subKey}`,
        chapterNumber: subKey,
        chapterName: subName,
        parentChapterNumber: chapterNumber,
        content: subMainContent,
        keywords: extractKeywordsFromContent(subMainContent),
        wordCount: subMainContent.length,
      });

      for (let k = 0; k < subSubMatches.length; k++) {
        const ssm = subSubMatches[k];
        const subSubKey = `${chapterNumber}_${subNumber}_${ssm[1]}`;
        const ssStart = ssm.index;
        const ssEnd =
          k < subSubMatches.length - 1 ? subSubMatches[k + 1].index : subRawContent.length;
        const ssContent = subRawContent.slice(ssStart, ssEnd).trim();

        chapters.push({
          chapterId: `ch_${subSubKey}`,
          chapterNumber: subSubKey,
          chapterName: ssm[2].trim(),
          parentChapterNumber: subKey,
          content: ssContent,
          keywords: extractKeywordsFromContent(ssContent),
          wordCount: ssContent.length,
        });
      }
    }
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

  const depthOf = (c) => (c.chapterNumber.match(/_/g) || []).length;
  const mainChapters = chapters.filter((c) => depthOf(c) === 0);
  const subChapters = chapters.filter((c) => depthOf(c) === 1);
  const subSubChapters = chapters.filter((c) => depthOf(c) === 2);

  console.log(
    `\n[파싱 결과] 메인 ${mainChapters.length} + sub ${subChapters.length} + sub-sub ${subSubChapters.length} = ${chapters.length}개 도큐먼트`
  );
  let total = 0;
  for (const ch of chapters) {
    const d = depthOf(ch);
    const prefix = d === 2 ? "        └─ " : d === 1 ? "    └ " : "  ";
    console.log(
      `${prefix}${ch.chapterNumber}. ${ch.chapterName}: ${ch.wordCount}자, 키워드 ${ch.keywords.length}개`
    );
    total += ch.wordCount;
  }
  console.log(`  전체: ${total}자`);

  if (dryRun) {
    console.log("\n[dry-run] 업로드 건너뜀");
    return;
  }

  console.log(`\n[업로드 시작] courseScopes/${COURSE_ID}`);

  // 기존 chapters 컬렉션 정리 — sub-chapter 추가/제거 시 stale 도큐먼트 잔류 방지
  const scopeRef = db.collection("courseScopes").doc(COURSE_ID);
  const existing = await scopeRef.collection("chapters").get();
  if (!existing.empty) {
    const cleanupBatch = db.batch();
    for (const doc of existing.docs) cleanupBatch.delete(doc.ref);
    await cleanupBatch.commit();
    console.log(`  (기존 ${existing.size}개 도큐먼트 삭제)`);
  }

  const batch = db.batch();

  batch.set(scopeRef, {
    courseId: COURSE_ID,
    courseName: COURSE_NAME,
    totalChapters: mainChapters.length,
    totalWordCount: total,
    availableChapters: mainChapters.map((c) => c.chapterNumber),
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
  console.log(
    `✅ 업로드 완료: 메인 ${mainChapters.length}장 + sub ${subChapters.length}개 + sub-sub ${subSubChapters.length}개, ${total}자`
  );
}

main()
  .catch((e) => {
    console.error("업로드 오류:", e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
