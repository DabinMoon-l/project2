/**
 * 철권퀴즈 문제 풀 생성 워커 — Cloud Run
 *
 * CF tekkenPoolRefillScheduled의 Cloud Run 버전.
 * 차이점:
 *   - Gemini API 병렬 호출 (동시 5개 → CF는 순차)
 *   - 메모리 2GB (CF 256MB 제한 해제)
 *   - 타임아웃 15분 (CF 540초 제한 해제)
 *   - 무중단 교체: 새 풀 완료 후 기존 삭제
 *
 * 트리거: Cloud Scheduler → HTTP POST /refill
 * 배포: gcloud run deploy tekken-pool-worker --region asia-northeast3
 */

const express = require('express');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Firebase Admin SDK 초기화
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
app.use(express.json());

// ── 상수 ──

const TARGET_POOL_SIZE = 300;
const BATCH_SIZE = 10; // 한 번에 생성할 문제 수
const MAX_CONCURRENT = 5; // 동시 Gemini API 호출 수
const DIFFICULTIES = { easy: 0.5, medium: 0.5 };
const CHAPTER_1_BUDGET = 4; // 챕터1 예산 제한

// 과목별 챕터 기본값
const DEFAULT_CHAPTERS = {
  biology: ['1', '2', '3', '4', '5', '6'],
  microbiology: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
  pathophysiology: ['3', '4', '5', '7', '8', '9', '10', '11'],
};

// 과목별 접두사
const COURSE_PREFIX = {
  biology: 'bio_',
  microbiology: 'micro_',
  pathophysiology: 'patho_',
};

// ── Gemini 문제 생성 ──

async function generateQuestions(courseId, chapter, difficulty, count) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prefix = COURSE_PREFIX[courseId] || '';

  const prompt = `너는 대학교 ${courseId} 과목의 ${difficulty} 난이도 4지선다 문제를 만드는 전문가야.

챕터 ${chapter}에 대한 문제 ${count}개를 JSON 배열로 생성해줘.

각 문제 형식:
{
  "text": "문제 텍스트",
  "type": "multiple",
  "choices": ["선택1", "선택2", "선택3", "선택4"],
  "correctAnswer": 0,
  "difficulty": "${difficulty}",
  "chapter": "${chapter}",
  "chapters": ["${chapter}"],
  "explanation": "정답 해설 (2-3문장)",
  "choiceExplanations": ["선택1 해설", "선택2 해설", "선택3 해설", "선택4 해설"]
}

규칙:
- correctAnswer는 0~3 인덱스
- 해설(explanation)과 선지별 해설(choiceExplanations) 필수
- 한국어로 작성
- JSON 배열만 출력 (코드블록 없이)`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // JSON 파싱 (코드블록 제거)
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const questions = JSON.parse(cleaned);

    // 유효성 검증 + chapterId 접두사 추가
    return questions
      .filter(q => q.text && q.choices?.length >= 2 && q.explanation && q.choiceExplanations)
      .map(q => ({
        ...q,
        chapterId: `${prefix}${chapter}`,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        batchId: `cloud-run-${Date.now()}`,
      }));
  } catch (err) {
    console.error(`  문제 생성 실패 (${courseId} ch${chapter} ${difficulty}):`, err.message);
    return [];
  }
}

// ── 풀 보충 메인 로직 ──

async function refillPool(courseId) {
  console.log(`\n=== ${courseId} 풀 보충 시작 ===`);

  // 1. 챕터 범위 로드
  let chapters;
  try {
    const settingsDoc = await db.doc(`settings/tekken/courses/${courseId}`).get();
    chapters = settingsDoc.exists ? settingsDoc.data().chapters : DEFAULT_CHAPTERS[courseId];
  } catch {
    chapters = DEFAULT_CHAPTERS[courseId] || ['1', '2', '3'];
  }

  if (!chapters?.length) {
    console.log(`  챕터 없음, 건너뜀`);
    return { courseId, generated: 0 };
  }

  // 2. 현재 풀 크기 확인
  const poolRef = db.collection(`tekkenQuestionPool/${courseId}/questions`);
  const existingSnap = await poolRef.count().get();
  const existingCount = existingSnap.data().count;
  const needed = TARGET_POOL_SIZE - existingCount;

  if (needed <= 0) {
    console.log(`  풀 충분 (${existingCount}/${TARGET_POOL_SIZE}), 건너뜀`);
    return { courseId, generated: 0 };
  }

  console.log(`  현재 ${existingCount}문제, ${needed}문제 생성 필요`);

  // 3. 난이도별 × 챕터별 문제 수 계산
  const tasks = [];
  for (const [difficulty, ratio] of Object.entries(DIFFICULTIES)) {
    const diffCount = Math.ceil(needed * ratio);
    const perChapter = Math.max(1, Math.floor(diffCount / chapters.length));

    for (const chapter of chapters) {
      const count = chapter === '1'
        ? Math.min(perChapter, CHAPTER_1_BUDGET)
        : perChapter;

      tasks.push({ courseId, chapter, difficulty, count });
    }
  }

  // 4. 병렬 생성 (동시 MAX_CONCURRENT)
  let totalGenerated = 0;
  const allQuestions = [];

  for (let i = 0; i < tasks.length; i += MAX_CONCURRENT) {
    const batch = tasks.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(
      batch.map(t => generateQuestions(t.courseId, t.chapter, t.difficulty, t.count))
    );

    for (const questions of results) {
      allQuestions.push(...questions);
      totalGenerated += questions.length;
    }

    console.log(`  배치 ${Math.floor(i / MAX_CONCURRENT) + 1}/${Math.ceil(tasks.length / MAX_CONCURRENT)} 완료 (누적 ${totalGenerated}문제)`);
  }

  // 5. Firestore 저장 (배치 쓰기)
  const BATCH_LIMIT = 400;
  for (let i = 0; i < allQuestions.length; i += BATCH_LIMIT) {
    const writeBatch = db.batch();
    const slice = allQuestions.slice(i, i + BATCH_LIMIT);

    for (const q of slice) {
      const ref = poolRef.doc();
      writeBatch.set(ref, q);
    }

    await writeBatch.commit();
  }

  // 6. 메타 문서 업데이트
  await db.doc(`tekkenQuestionPool/${courseId}`).set({
    totalQuestions: existingCount + totalGenerated,
    lastRefill: admin.firestore.FieldValue.serverTimestamp(),
    source: 'cloud-run',
  }, { merge: true });

  console.log(`  ${courseId}: ${totalGenerated}문제 생성 완료`);
  return { courseId, generated: totalGenerated };
}

// ── HTTP 엔드포인트 ──

app.post('/refill', async (req, res) => {
  console.log('=== 철권퀴즈 풀 보충 시작 ===');
  const startTime = Date.now();

  try {
    // 현재 학기의 과목만 처리
    const semesterDoc = await db.doc('settings/semester').get();
    const semester = semesterDoc.exists ? semesterDoc.data().currentSemester : 1;

    let courseIds;
    if (semester === 1) {
      courseIds = ['biology', 'microbiology'];
    } else {
      courseIds = ['pathophysiology'];
    }

    // 요청에서 특정 과목 지정 가능
    if (req.body?.courseIds?.length) {
      courseIds = req.body.courseIds;
    }

    // 과목별 순차 처리 (Gemini API 할당량 고려)
    const results = [];
    for (const courseId of courseIds) {
      const result = await refillPool(courseId);
      results.push(result);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalGenerated = results.reduce((sum, r) => sum + r.generated, 0);

    console.log(`\n=== 완료: ${totalGenerated}문제, ${elapsed}초 ===`);

    res.json({
      success: true,
      results,
      totalGenerated,
      elapsedSeconds: Number(elapsed),
    });
  } catch (err) {
    console.error('풀 보충 실패:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 헬스체크
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'tekken-pool-worker' });
});

// 서버 시작
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`tekken-pool-worker 실행 중: port ${PORT}`);
});
