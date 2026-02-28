/**
 * 교수 서재 — 백그라운드 AI 문제 생성 Job 매니저 (모듈 싱글톤)
 *
 * 컴포넌트 라이프사이클과 독립적으로 동작.
 * 페이지를 벗어나도 폴링이 유지되고, 완료 시 Firestore 저장 + 이벤트 발행.
 */

import { httpsCallable } from 'firebase/functions';
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  serverTimestamp,
} from 'firebase/firestore';
import { functions } from '@/lib/firebase';
import { getCourseIndex } from '@/lib/courseIndex';

// ============================================================
// 타입
// ============================================================

export type JobEventType = 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';

export interface JobEvent {
  type: JobEventType;
  step?: string; // uploading | analyzing | generating
  questionCount?: number;
  error?: string;
}

export interface QuizSaveConfig {
  uid: string;
  nickname: string;
  courseId: string;
  semester: string;
  questionCount: number;
  difficulty: string;
  tags?: string[];
}

interface GeneratedQuestion {
  text: string;
  choices: string[];
  answer: number | number[];
  explanation: string;
  choiceExplanations?: string[];
  chapterId?: string;
  chapterDetailId?: string;
  imageUrl?: string;
  imageDescription?: string;
  bogi?: {
    questionText: string;
    items: Array<{ label: string; content: string }>;
  };
}

// ============================================================
// 모듈 레벨 싱글톤 상태
// ============================================================

let activeJobId: string | null = null;
let pollingActive = false;
let saveConfig: QuizSaveConfig | null = null;
let listeners: Array<(event: JobEvent) => void> = [];

// ============================================================
// 이벤트 리스너
// ============================================================

export function onLibraryJobEvent(listener: (event: JobEvent) => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

function emit(event: JobEvent) {
  for (const l of listeners) {
    try { l(event); } catch {}
  }
}

// ============================================================
// 상태 조회
// ============================================================

export function isLibraryJobActive(): boolean {
  return pollingActive;
}

export function getActiveJobId(): string | null {
  return activeJobId;
}

// ============================================================
// Job 시작 (fire-and-forget)
// ============================================================

export function startLibraryJob(jobId: string, config: QuizSaveConfig): void {
  // 이미 진행 중이면 무시
  if (pollingActive) return;

  activeJobId = jobId;
  saveConfig = config;
  pollingActive = true;

  emit({ type: 'started' });

  // 백그라운드 폴링 시작 (detached promise)
  pollAndSave(jobId, config).catch(() => {});
}

// ============================================================
// Job 취소
// ============================================================

export function cancelLibraryJob(): void {
  pollingActive = false;
  activeJobId = null;
  saveConfig = null;
  emit({ type: 'cancelled' });
}

// ============================================================
// 태그 → chapterId 폴백 (Gemini가 chapterId를 누락했을 때)
// ============================================================

/**
 * 태그 배열에서 chapterId 후보 목록을 추출
 * 예: courseId="biology", tags=["2_세포의 특성"] → ["bio_2"]
 */
function extractChapterIdsFromTags(courseId: string, tags: string[]): string[] {
  const courseIndex = getCourseIndex(courseId);
  if (!courseIndex) return [];

  const EXCLUDED = new Set(['중간', '기말', '기타']);
  const chapterIds: string[] = [];

  for (const tag of tags) {
    if (EXCLUDED.has(tag)) continue;
    // "2_세포의 특성" → 챕터 번호 "2"
    const match = tag.match(/^(\d+)_/);
    if (match) {
      const num = match[1];
      // courseIndex에서 해당 번호의 챕터 ID 찾기
      const chapter = courseIndex.chapters.find(c => c.name.startsWith(`${num}.`));
      if (chapter) {
        chapterIds.push(chapter.id);
      }
    }
  }

  return [...new Set(chapterIds)];
}

// ============================================================
// 내부: 폴링 + Firestore 저장
// ============================================================

async function pollAndSave(jobId: string, config: QuizSaveConfig) {
  const checkStatus = httpsCallable<
    { jobId: string },
    {
      jobId: string;
      status: string;
      result?: { questions: GeneratedQuestion[]; meta?: any };
      error?: string;
    }
  >(functions, 'checkJobStatus');

  const MAX_POLLS = 90; // 최대 3분
  let pollCount = 0;

  try {
    let questions: GeneratedQuestion[] = [];
    let generatedTitle: string | undefined;

    while (pollingActive && pollCount < MAX_POLLS) {
      const statusResult = await checkStatus({ jobId });
      const { status, result, error } = statusResult.data;

      if (status === 'RUNNING') {
        emit({ type: 'progress', step: 'generating' });
      }

      if (status === 'COMPLETED' && result) {
        questions = result.questions.slice(0, config.questionCount);
        generatedTitle = result.meta?.title || undefined;
        break;
      }

      if (status === 'FAILED') {
        throw new Error(error || '문제 생성에 실패했습니다.');
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      pollCount++;
    }

    if (!pollingActive) return; // 취소됨

    if (questions.length === 0) {
      throw new Error('문제 생성 시간이 초과되었습니다.');
    }

    // Firestore 저장
    const firestoreDb = getFirestore();
    const quizRef = doc(collection(firestoreDb, 'quizzes'));

    // 태그에서 chapterId 폴백 후보 추출 (Gemini가 chapterId 누락 시 사용)
    const fallbackChapterIds = extractChapterIdsFromTags(
      config.courseId,
      config.tags || []
    );
    const defaultChapterId = fallbackChapterIds.length > 0 ? fallbackChapterIds[0] : null;

    const quizData = {
      title: generatedTitle || (() => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}. ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      })(),
      tags: config.tags || [],
      isPublic: false,
      difficulty: config.difficulty,
      type: 'professor-ai',
      questions: questions.map((q, idx) => {
        // chapterId 폴백: Gemini 응답 → 태그 기반 추론
        let chapterId = q.chapterId || null;
        if (!chapterId && defaultChapterId) {
          // 태그가 1개면 해당 챕터로 배정, 여러 개면 첫 번째 챕터로 배정
          chapterId = defaultChapterId;
        }
        return {
          id: `q${idx + 1}`,
          order: idx + 1,
          type: 'multiple' as const,
          text: q.text,
          choices: q.choices,
          answer: q.answer,
          explanation: q.explanation || '',
          ...(q.choiceExplanations ? { choiceExplanations: q.choiceExplanations } : {}),
          ...(q.bogi ? { bogi: q.bogi } : {}),
          chapterId,
          chapterDetailId: q.chapterDetailId || null,
          imageUrl: q.imageUrl || null,
          imageDescription: q.imageDescription || null,
        };
      }),
      questionCount: questions.length,
      oxCount: 0,
      multipleChoiceCount: questions.length,
      subjectiveCount: 0,
      participantCount: 0,
      userScores: {},
      creatorId: config.uid,
      creatorUid: config.uid,
      creatorNickname: config.nickname,
      courseId: config.courseId,
      semester: config.semester,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(quizRef, quizData);

    emit({ type: 'completed', questionCount: questions.length });

  } catch (err: any) {
    emit({ type: 'failed', error: err?.message || '문제 생성 중 오류가 발생했습니다.' });
  } finally {
    pollingActive = false;
    activeJobId = null;
    saveConfig = null;
  }
}
