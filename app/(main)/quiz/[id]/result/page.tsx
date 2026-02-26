'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  increment,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import { formatChapterLabel } from '@/lib/courseIndex';

/**
 * 문제 결과 타입
 */
interface QuestionResult {
  id: string;
  number: number;
  question: string;
  type: string;
  options?: string[];
  correctAnswer: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation: string;
  /** 서술형 루브릭 */
  rubric?: Array<{ criteria: string; percentage: number; description?: string }>;
  isBookmarked: boolean;
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  /** 결합형 그룹 내 순서 */
  combinedIndex?: number;
  /** 결합형 그룹 내 총 문제 수 */
  combinedTotal?: number;
  /** 결합형 공통 지문 (첫 번째 문제에만) */
  passage?: string;
  /** 결합형 공통 지문 타입 */
  passageType?: string;
  /** 결합형 공통 이미지 */
  passageImage?: string;
  /** 결합형 ㄱㄴㄷ 보기 항목 */
  koreanAbcItems?: string[];
  /** 결합형 공통 지문 혼합 보기 */
  passageMixedExamples?: any[];
  /** 결합형 공통 문제 */
  commonQuestion?: string;
  /** 문제 이미지 */
  image?: string;
  /** 하위 문제 보기 (ㄱㄴㄷ 형식) */
  subQuestionOptions?: string[];
  /** 보기 타입 */
  subQuestionOptionsType?: 'text' | 'labeled' | 'mixed';
  /** 혼합 보기 원본 데이터 (렌더링용) */
  mixedExamples?: Array<{
    id: string;
    type: 'text' | 'labeled' | 'gana' | 'image' | 'grouped';
    label?: string;
    content?: string;
    items?: Array<{ id: string; label: string; content: string }>;
    imageUrl?: string;
    children?: Array<{
      id: string;
      type: 'text' | 'labeled' | 'gana' | 'image';
      label?: string;
      content?: string;
      items?: Array<{ id: string; label: string; content: string }>;
      imageUrl?: string;
    }>;
  }>;
  /** 하위 문제 이미지 */
  subQuestionImage?: string;
  /** 챕터 ID */
  chapterId?: string;
  /** 챕터 세부항목 ID */
  chapterDetailId?: string;
  /** 제시문 발문 */
  passagePrompt?: string;
  /** 보기 발문 (보기 박스 위에 표시되는 질문) */
  bogiQuestionText?: string;
  /** 보기 (<보기> 박스 데이터) */
  bogi?: {
    questionText?: string;
    items: Array<{ label: string; content: string }>;
  } | null;
  /** 선지별 해설 (AI 생성 문제용) */
  choiceExplanations?: string[];
}

/**
 * 결과 화면에 표시될 아이템 (단일 문제 또는 결합형 그룹)
 */
interface ResultDisplayItem {
  type: 'single' | 'combined_group';
  /** 단일 문제 (type === 'single'일 때) */
  result?: QuestionResult;
  /** 결합형 그룹 문제들 (type === 'combined_group'일 때) */
  results?: QuestionResult[];
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  /** 화면에 표시될 번호 */
  displayNumber: number;
}

/**
 * 퀴즈 결과 데이터 타입
 */
interface QuizResultData {
  quizId: string;
  quizTitle: string;
  quizCreatorId?: string; // 퀴즈 제작자 ID
  quizType?: string; // 퀴즈 타입 (ai-generated, custom 등)
  correctCount: number;
  totalCount: number;
  earnedExp: number;
  questionResults: QuestionResult[];
  quizUpdatedAt?: any; // 퀴즈 수정 시간 (알림용)
}

/**
 * 퀴즈 결과 페이지
 */
export default function QuizResultPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { userCourseId, userClassId } = useCourse();

  const quizId = params.id as string;

  const [resultData, setResultData] = useState<QuizResultData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<Set<string>>(new Set());
  // 결합형 그룹 펼침 상태 (그룹 ID -> 펼침 여부)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  // 선지별 해설 펼침 상태 (문제ID-선지인덱스 조합)
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set());

  // 선지별 해설에서 "선지N 해설:" 접두사 제거
  const stripChoicePrefix = (text: string) =>
    text.replace(/^선지\s*\d+\s*해설\s*[:：]\s*/i, '');

  // 결과 데이터를 displayItems로 변환 (결합형 그룹 처리)
  const displayItems = useMemo<ResultDisplayItem[]>(() => {
    if (!resultData) return [];

    const items: ResultDisplayItem[] = [];
    const processedGroupIds = new Set<string>();
    let displayNumber = 0;

    resultData.questionResults.forEach((result) => {
      if (result.combinedGroupId) {
        // 이미 처리된 그룹이면 스킵
        if (processedGroupIds.has(result.combinedGroupId)) {
          return;
        }
        processedGroupIds.add(result.combinedGroupId);

        // 같은 그룹의 모든 문제 찾기
        const groupResults = resultData.questionResults.filter(
          (r) => r.combinedGroupId === result.combinedGroupId
        );

        displayNumber++;
        items.push({
          type: 'combined_group',
          results: groupResults,
          combinedGroupId: result.combinedGroupId,
          displayNumber,
        });
      } else {
        // 일반 문제
        displayNumber++;
        items.push({
          type: 'single',
          result,
          displayNumber,
        });
      }
    });

    return items;
  }, [resultData]);

  const calculateAndSaveResults = useCallback(async () => {
    if (!user || !quizId) return;

    try {
      setIsLoading(true);

      // 먼저 저장된 결과 데이터가 있는지 확인
      const storedResult = localStorage.getItem(`quiz_result_${quizId}`);
      if (storedResult) {
        try {
          const cachedResult = JSON.parse(storedResult);
          if (cachedResult.questionResults && cachedResult.questionResults.length > 0) {
            // 캐시 데이터에 choiceExplanations가 빠진 객관식 문제가 있으면 퀴즈 문서에서 보충
            const hasMissingExps = cachedResult.questionResults.some(
              (qr: any) => !qr.choiceExplanations && qr.type === 'multiple'
            );
            if (hasMissingExps) {
              try {
                const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
                if (quizDoc.exists()) {
                  const questions = quizDoc.data().questions || [];
                  cachedResult.questionResults.forEach((qr: any, qrIdx: number) => {
                    if (!qr.choiceExplanations && qr.type === 'multiple') {
                      // questionId 여러 형식으로 매칭 시도
                      const qData = questions.find((q: any, idx: number) =>
                        (q.id || `q${idx}`) === qr.id
                        || (q.id || `q${idx}`) === `q${qrIdx + 1}`
                        || (q.id || `q${idx}`) === qr.number?.toString()
                      );
                      if (qData?.choiceExplanations) {
                        qr.choiceExplanations = qData.choiceExplanations;
                      }
                    }
                  });
                  // 보충된 데이터 캐시 갱신
                  localStorage.setItem(`quiz_result_${quizId}`, JSON.stringify(cachedResult));
                }
              } catch (e) {
                console.error('choiceExplanations 보충 오류:', e);
              }
            }
            setResultData(cachedResult);
            setIsLoading(false);
            return;
          }
        } catch (e) {
          console.error('캐시된 결과 파싱 오류:', e);
        }
      }

      const answersParam = searchParams.get('answers');
      let userAnswers: string[] = [];

      if (answersParam) {
        userAnswers = JSON.parse(decodeURIComponent(answersParam));
      } else {
        const storedAnswers = localStorage.getItem(`quiz_answers_${quizId}`);
        if (storedAnswers) {
          userAnswers = JSON.parse(storedAnswers);
        } else {
          setError('퀴즈 답변 데이터를 찾을 수 없습니다.');
          return;
        }
      }

      const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizDoc.exists()) {
        setError('퀴즈를 찾을 수 없습니다.');
        return;
      }

      const quizData = quizDoc.data();
      const questions = quizData.questions || [];

      let correctCount = 0;
      const questionResults: QuestionResult[] = questions.map(
        (q: any, index: number) => {
          const userAnswer = userAnswers[index] || '';
          // correctAnswer가 있으면 그대로 사용, 없으면 answer 필드에서 변환
          let correctAnswer: any = '';
          if (q.correctAnswer !== undefined && q.correctAnswer !== null) {
            correctAnswer = q.correctAnswer;
          } else if (q.answer !== undefined && q.answer !== null) {
            // AI 퀴즈: answer가 0-indexed 숫자인 경우 1-indexed로 변환
            if (q.type === 'multiple') {
              if (Array.isArray(q.answer)) {
                correctAnswer = q.answer.map((a: number) => String(a + 1)).join(',');
              } else if (typeof q.answer === 'number') {
                correctAnswer = String(q.answer + 1);
              } else {
                correctAnswer = q.answer;
              }
            } else if (q.type === 'ox') {
              if (q.answer === 0) correctAnswer = 'O';
              else if (q.answer === 1) correctAnswer = 'X';
              else correctAnswer = q.answer;
            } else if (q.type === 'essay') {
              correctAnswer = '';
            } else {
              correctAnswer = q.answer;
            }
          }

          let isCorrect = false;
          if (q.type === 'multiple') {
            const correctAnswerStr = correctAnswer.toString();
            const userAnswerStr = userAnswer.toString();

            // 복수정답 여부 확인
            if (correctAnswerStr.includes(',')) {
              // 복수정답: 모든 정답을 선택해야 정답
              // correctAnswer와 userAnswer 모두 1-indexed (예: "1,3")
              const correctIndices = correctAnswerStr.split(',').map((s: string) => parseInt(s.trim(), 10));
              const userIndices = userAnswerStr
                ? userAnswerStr.split(',').map((s: string) => parseInt(s.trim(), 10))
                : [];

              // 정렬 후 비교
              const sortedCorrect = [...correctIndices].sort((a, b) => a - b);
              const sortedUser = [...userIndices].sort((a, b) => a - b);

              isCorrect =
                sortedCorrect.length === sortedUser.length &&
                sortedCorrect.every((val, idx) => val === sortedUser[idx]);
            } else {
              // 단일정답: 둘 다 1-indexed로 직접 비교
              isCorrect = userAnswerStr === correctAnswerStr;
            }
          } else if (q.type === 'ox') {
            // OX: 정답과 사용자 답 모두 "0"/"1" 또는 "O"/"X"일 수 있음
            // 둘 다 'O' 또는 'X'로 정규화
            let userOX = userAnswer.toString().toUpperCase();
            if (userOX === '0') userOX = 'O';
            else if (userOX === '1') userOX = 'X';

            let correctOX = correctAnswer.toString().toUpperCase();
            if (correctOX === '0') correctOX = 'O';
            else if (correctOX === '1') correctOX = 'X';

            isCorrect = userOX === correctOX;
          } else {
            // 주관식: 복수 정답 지원 ("|||"로 구분)
            const userAnswerNormalized = userAnswer.toString().trim().toLowerCase();
            if (correctAnswer.toString().includes('|||')) {
              // 복수 정답: 하나라도 맞으면 정답
              const correctAnswers = correctAnswer.toString().split('|||').map((a: string) => a.trim().toLowerCase());
              isCorrect = correctAnswers.some((ca: string) => userAnswerNormalized === ca);
            } else {
              isCorrect = userAnswerNormalized === correctAnswer.toString().trim().toLowerCase();
            }
          }

          if (isCorrect) correctCount++;

          const result: QuestionResult = {
            id: q.id || `q${index}`,
            number: index + 1,
            question: q.text || q.question || '',
            type: q.type,
            options: (q.choices || q.options || []).filter((opt: any) => opt != null),
            correctAnswer: correctAnswer,
            userAnswer,
            isCorrect,
            explanation: q.explanation || '해설이 없습니다.',
            rubric: q.rubric || undefined,
            isBookmarked: false,
            // 문제 이미지/보기 필드
            image: q.image || q.imageUrl || null,
            // 보기: examples 객체에서 items 추출
            // mixedExamples가 있으면 그것을 직접 사용하므로 subQuestionOptions는 null
            subQuestionOptions: (() => {
              // mixedExamples가 있는 경우 - mixedExamples를 직접 사용하므로 null 반환
              if (q.mixedExamples && Array.isArray(q.mixedExamples) && q.mixedExamples.length > 0) {
                return null;
              }
              // examples가 직접 배열인 경우 (이전 형식)
              if (Array.isArray(q.examples)) {
                return q.examples.filter((item: any) => item != null);
              }
              // examples가 객체이고 items 배열이 있는 경우 (새 형식)
              if (q.examples && typeof q.examples === 'object' && Array.isArray(q.examples.items)) {
                return q.examples.items.filter((item: any) => item != null);
              }
              // koreanAbcExamples가 있는 경우 (ㄱㄴㄷ 형식)
              if (q.koreanAbcExamples && Array.isArray(q.koreanAbcExamples)) {
                return q.koreanAbcExamples
                  .map((e: {text: string}) => e.text)
                  .filter((text: any) => text != null);
              }
              // 기존 subQuestionOptions 필드
              return q.subQuestionOptions || null;
            })(),
            // 보기 타입 추출
            subQuestionOptionsType: (() => {
              // mixedExamples가 있는 경우 (최신 형식 - 텍스트+ㄱㄴㄷ 혼합)
              if (q.mixedExamples && Array.isArray(q.mixedExamples) && q.mixedExamples.length > 0) {
                return 'mixed'; // 혼합 형식 표시
              }
              if (Array.isArray(q.examples)) {
                return 'text'; // 이전 형식은 기본 텍스트로
              }
              if (q.examples && typeof q.examples === 'object' && q.examples.type) {
                return q.examples.type;
              }
              if (q.koreanAbcExamples && Array.isArray(q.koreanAbcExamples)) {
                return 'labeled';
              }
              return null;
            })(),
            // 혼합 보기 원본 데이터 (렌더링용)
            mixedExamples: q.mixedExamples || null,
            subQuestionImage: q.subQuestionImage || null,
            // 챕터 정보
            chapterId: q.chapterId || null,
            chapterDetailId: q.chapterDetailId || null,
            // 발문 정보
            passagePrompt: q.passagePrompt || null,
            bogiQuestionText: q.bogi?.questionText || null,
            // 보기 (<보기> 박스)
            bogi: q.bogi ? {
              questionText: q.bogi.questionText,
              items: (q.bogi.items || []).map((item: any) => ({
                label: item.label,
                content: item.content,
              })),
            } : null,
            // 선지별 해설 (AI 생성 문제용)
            choiceExplanations: q.choiceExplanations || null,
          };

          // 결합형 그룹 정보 추가
          if (q.combinedGroupId) {
            result.combinedGroupId = q.combinedGroupId;
            result.combinedIndex = q.combinedIndex;
            result.combinedTotal = q.combinedTotal;

            // 첫 번째 하위 문제에만 공통 지문 정보 포함
            if (q.combinedIndex === 0) {
              result.passageType = q.passageType;
              result.passage = q.passage;
              result.passageImage = q.passageImage;
              result.koreanAbcItems = q.koreanAbcItems;
              result.commonQuestion = q.commonQuestion;
              result.passageMixedExamples = q.passageMixedExamples;
            }
          }

          return result;
        }
      );

      const earnedExp = correctCount * 10;
      const quizUpdatedAt = quizData.updatedAt || quizData.createdAt || null;
      const quizCreatorId = quizData.creatorId || null;

      const result: QuizResultData = {
        quizId,
        quizTitle: quizData.title || '퀴즈',
        quizCreatorId,
        quizType: quizData.type || 'custom',
        correctCount,
        totalCount: questions.length,
        earnedExp,
        questionResults,
        quizUpdatedAt,
      };

      setResultData(result);

      // 결과 저장
      try {
        // ── recordAttempt Cloud Function 호출 (서버 채점 + 분산 쓰기) ──
        // quizResults, quiz_completions, quiz_agg, quizzes 호환 업데이트를 서버에서 처리
        const recordAttemptFn = httpsCallable<
          { quizId: string; answers: { questionId: string; answer: any }[]; attemptNo?: number },
          { alreadySubmitted?: boolean; resultId: string; score: number; correctCount: number; totalCount: number }
        >(functions, 'recordAttempt');

        // 사용자 답변을 서버 형식으로 변환
        const serverAnswers = questions.map((q: any, index: number) => {
          const rawAnswer = userAnswers[index] || '';
          let answer: any = rawAnswer;

          // 서버에서 0-indexed로 채점하므로 원본 answer 필드 기준으로 전달
          if (q.type === 'multiple') {
            // 1-indexed string → 0-indexed number 변환
            if (typeof rawAnswer === 'string' && rawAnswer.includes(',')) {
              // 복수정답: "1,3" → [0, 2]
              answer = rawAnswer.split(',').map((s: string) => parseInt(s.trim(), 10) - 1);
            } else {
              const num = parseInt(rawAnswer, 10);
              answer = isNaN(num) ? rawAnswer : num - 1;
            }
          } else if (q.type === 'ox') {
            // "O"/"X" → 0/1 변환
            const upper = rawAnswer.toString().toUpperCase();
            if (upper === 'O' || upper === '0') answer = 0;
            else if (upper === 'X' || upper === '1') answer = 1;
            else answer = rawAnswer;
          }

          return {
            questionId: q.id || `q${index}`,
            answer,
          };
        });

        try {
          const attemptResult = await recordAttemptFn({
            quizId,
            answers: serverAnswers,
            attemptNo: 1,
          });

          // 서버에서 이미 제출된 경우에도 정상 처리
          if (attemptResult.data.alreadySubmitted) {
            console.log('이미 제출된 퀴즈 (idempotency):', attemptResult.data.resultId);
          }
        } catch (cfError: any) {
          // Cloud Function 실패 시 폴백: 클라이언트에서 직접 저장
          console.warn('recordAttempt CF 실패, 폴백 처리:', cfError.message);

          const score = Math.round((correctCount / questions.length) * 100);
          const questionScoreMap: Record<string, { isCorrect: boolean; userAnswer: string; answeredAt: any }> = {};
          questionResults.forEach((qr) => {
            questionScoreMap[qr.id] = {
              isCorrect: qr.isCorrect,
              userAnswer: qr.userAnswer,
              answeredAt: serverTimestamp(),
            };
          });

          await addDoc(collection(db, 'quizResults'), {
            userId: user.uid,
            quizId,
            quizTitle: quizData.title || '퀴즈',
            quizCreatorId: quizData.creatorId || null,
            score,
            correctCount,
            totalCount: questions.length,
            earnedExp,
            answers: userAnswers,
            questionScores: questionScoreMap,
            isUpdate: false,
            courseId: userCourseId || null,
            classId: userClassId || null,
            createdAt: serverTimestamp(),
          });

          // 폴백: quiz_completions 문서 생성 + userScores 업데이트
          try {
            const completionDocId = `${quizId}_${user.uid}`;
            await setDoc(doc(db, 'quiz_completions', completionDocId), {
              quizId,
              userId: user.uid,
              score,
              attemptNo: 1,
              completedAt: serverTimestamp(),
            }, { merge: true });
            await updateDoc(doc(db, 'quizzes', quizId), {
              [`userScores.${user.uid}`]: score,
            });
          } catch (e) {
            console.warn('폴백 완료 기록 실패:', e);
          }
        }

        {
          // reviews 생성 (클라이언트에서 처리 - display 필드가 복잡하므로)
          // 퀴즈 업데이트 시간 저장 (문제 수정 알림용)
          const quizUpdatedAtForReview = quizData.updatedAt || quizData.createdAt || null;

          // 모든 문제를 'solved' 타입으로 저장 (푼 문제)
          for (const questionResult of questionResults) {
            // 타입 정규화: subjective -> short
            const normalizedType = questionResult.type === 'subjective' ? 'short' : questionResult.type;
            // 결합형 필드 준비
            const combinedFields: Record<string, unknown> = {};
            if (questionResult.combinedGroupId) {
              combinedFields.combinedGroupId = questionResult.combinedGroupId;
              combinedFields.combinedIndex = questionResult.combinedIndex ?? null;
              combinedFields.combinedTotal = questionResult.combinedTotal ?? null;
              // 첫 번째 하위 문제에만 공통 지문 정보 저장
              if (questionResult.combinedIndex === 0) {
                if (questionResult.passage) combinedFields.passage = questionResult.passage;
                if (questionResult.passageType) combinedFields.passageType = questionResult.passageType;
                if (questionResult.passageImage) combinedFields.passageImage = questionResult.passageImage;
                if (questionResult.koreanAbcItems) combinedFields.koreanAbcItems = questionResult.koreanAbcItems;
                if (questionResult.commonQuestion) combinedFields.commonQuestion = questionResult.commonQuestion;
                // 공통 지문 혼합 보기
                if (questionResult.passageMixedExamples) {
                  combinedFields.passageMixedExamples = JSON.parse(JSON.stringify(questionResult.passageMixedExamples));
                }
              }
            }
            await addDoc(collection(db, 'reviews'), {
              userId: user.uid,
              quizId,
              quizTitle: quizData.title || '퀴즈',
              questionId: questionResult.number.toString(),
              question: questionResult.question,
              type: normalizedType,
              options: questionResult.options || [],
              correctAnswer: questionResult.correctAnswer,
              userAnswer: questionResult.userAnswer,
              explanation: questionResult.explanation || '',
              rubric: questionResult.rubric || null,
              isCorrect: questionResult.isCorrect,
              reviewType: 'solved',
              isBookmarked: false,
              reviewCount: 0,
              lastReviewedAt: null,
              courseId: userCourseId || null,
              quizUpdatedAt: quizUpdatedAtForReview, // 퀴즈 수정 시간 저장
              quizCreatorId: quizData.creatorId || null, // 퀴즈 제작자 ID
              quizType: quizData.type || 'custom', // 퀴즈 타입 (AI 생성 여부 확인용)
              image: questionResult.image || null, // 문제 이미지
              subQuestionOptions: questionResult.subQuestionOptions || null, // 보기 항목
              subQuestionOptionsType: questionResult.subQuestionOptionsType || null, // 보기 타입
              // 혼합 보기 원본 데이터 (undefined 값 제거를 위해 JSON 변환)
              mixedExamples: questionResult.mixedExamples
                ? JSON.parse(JSON.stringify(questionResult.mixedExamples))
                : null,
              subQuestionImage: questionResult.subQuestionImage || null, // 하위 문제 이미지
              chapterId: questionResult.chapterId || null, // 챕터 ID
              chapterDetailId: questionResult.chapterDetailId || null, // 챕터 세부항목 ID
              passagePrompt: questionResult.passagePrompt || null, // 제시문 발문
              bogiQuestionText: questionResult.bogiQuestionText || null, // 보기 발문
              bogi: questionResult.bogi ? JSON.parse(JSON.stringify(questionResult.bogi)) : null, // 보기 박스
              choiceExplanations: questionResult.choiceExplanations || null, // 선지별 해설 (AI 문제용)
              createdAt: serverTimestamp(),
              ...combinedFields,
            });
          }

          // 오답 자동 저장 (틀린 문제)
          // 결합형 문제는 하나라도 틀리면 전체 하위 문제를 저장 (1문제 = 1그룹)
          const wrongAnswers = questionResults.filter((r) => !r.isCorrect);
          const savedCombinedGroupIds = new Set<string>(); // 이미 저장된 결합형 그룹 추적

          for (const wrongAnswer of wrongAnswers) {
            // 결합형 문제 처리: 그룹당 한 번만 저장 (모든 하위 문제 포함)
            if (wrongAnswer.combinedGroupId) {
              // 이미 이 그룹이 저장되었으면 스킵
              if (savedCombinedGroupIds.has(wrongAnswer.combinedGroupId)) {
                continue;
              }
              savedCombinedGroupIds.add(wrongAnswer.combinedGroupId);

              // 같은 그룹의 모든 하위 문제 찾기 (맞은 것 + 틀린 것 모두)
              const groupSubQuestions = questionResults.filter(
                (r) => r.combinedGroupId === wrongAnswer.combinedGroupId
              );

              // 그룹의 모든 하위 문제 저장
              for (const subQ of groupSubQuestions) {
                const normalizedSubType = subQ.type === 'subjective' ? 'short' : subQ.type;
                const subCombinedFields: Record<string, unknown> = {
                  combinedGroupId: subQ.combinedGroupId,
                  combinedIndex: subQ.combinedIndex ?? null,
                  combinedTotal: subQ.combinedTotal ?? null,
                };
                // 첫 번째 하위 문제에만 공통 지문 정보 저장
                if (subQ.combinedIndex === 0) {
                  if (subQ.passage) subCombinedFields.passage = subQ.passage;
                  if (subQ.passageType) subCombinedFields.passageType = subQ.passageType;
                  if (subQ.passageImage) subCombinedFields.passageImage = subQ.passageImage;
                  if (subQ.koreanAbcItems) subCombinedFields.koreanAbcItems = subQ.koreanAbcItems;
                  if (subQ.commonQuestion) subCombinedFields.commonQuestion = subQ.commonQuestion;
                  if (subQ.passageMixedExamples) {
                    subCombinedFields.passageMixedExamples = JSON.parse(JSON.stringify(subQ.passageMixedExamples));
                  }
                }

                await addDoc(collection(db, 'reviews'), {
                  userId: user.uid,
                  quizId,
                  quizTitle: quizData.title || '퀴즈',
                  questionId: subQ.number.toString(),
                  question: subQ.question,
                  type: normalizedSubType,
                  options: subQ.options || [],
                  correctAnswer: subQ.correctAnswer,
                  userAnswer: subQ.userAnswer,
                  explanation: subQ.explanation || '',
                  rubric: subQ.rubric || null,
                  isCorrect: subQ.isCorrect, // 개별 정답 여부 저장
                  reviewType: 'wrong',
                  isBookmarked: false,
                  reviewCount: 0,
                  lastReviewedAt: null,
                  courseId: userCourseId || null,
                  quizUpdatedAt: quizUpdatedAtForReview,
                  quizCreatorId: quizData.creatorId || null,
                  quizType: quizData.type || 'custom', // 퀴즈 타입 (AI 생성 여부 확인용)
                  image: subQ.image || null,
                  subQuestionOptions: subQ.subQuestionOptions || null,
                  subQuestionOptionsType: subQ.subQuestionOptionsType || null,
                  mixedExamples: subQ.mixedExamples ? JSON.parse(JSON.stringify(subQ.mixedExamples)) : null,
                  subQuestionImage: subQ.subQuestionImage || null,
                  chapterId: subQ.chapterId || null,
                  chapterDetailId: subQ.chapterDetailId || null,
                  passagePrompt: subQ.passagePrompt || null,
                  bogiQuestionText: subQ.bogiQuestionText || null,
                  bogi: subQ.bogi ? JSON.parse(JSON.stringify(subQ.bogi)) : null,
                  choiceExplanations: subQ.choiceExplanations || null, // 선지별 해설 (AI 문제용)
                  createdAt: serverTimestamp(),
                  ...subCombinedFields,
                });
              }
            } else {
              // 비결합형 문제: 개별 저장
              const normalizedWrongType = wrongAnswer.type === 'subjective' ? 'short' : wrongAnswer.type;
              await addDoc(collection(db, 'reviews'), {
                userId: user.uid,
                quizId,
                quizTitle: quizData.title || '퀴즈',
                questionId: wrongAnswer.number.toString(),
                question: wrongAnswer.question,
                type: normalizedWrongType,
                options: wrongAnswer.options || [],
                correctAnswer: wrongAnswer.correctAnswer,
                userAnswer: wrongAnswer.userAnswer,
                explanation: wrongAnswer.explanation || '',
                rubric: wrongAnswer.rubric || null,
                isCorrect: false, // 비결합형은 오답만 저장
                reviewType: 'wrong',
                isBookmarked: false,
                reviewCount: 0,
                lastReviewedAt: null,
                courseId: userCourseId || null,
                quizUpdatedAt,
                quizCreatorId: quizData.creatorId || null,
                quizType: quizData.type || 'custom', // 퀴즈 타입 (AI 생성 여부 확인용)
                image: wrongAnswer.image || null,
                subQuestionOptions: wrongAnswer.subQuestionOptions || null,
                subQuestionOptionsType: wrongAnswer.subQuestionOptionsType || null,
                mixedExamples: wrongAnswer.mixedExamples ? JSON.parse(JSON.stringify(wrongAnswer.mixedExamples)) : null,
                subQuestionImage: wrongAnswer.subQuestionImage || null,
                chapterId: wrongAnswer.chapterId || null,
                chapterDetailId: wrongAnswer.chapterDetailId || null,
                passagePrompt: wrongAnswer.passagePrompt || null,
                bogiQuestionText: wrongAnswer.bogiQuestionText || null,
                bogi: wrongAnswer.bogi ? JSON.parse(JSON.stringify(wrongAnswer.bogi)) : null,
                choiceExplanations: wrongAnswer.choiceExplanations || null, // 선지별 해설 (AI 문제용)
                createdAt: serverTimestamp(),
              });
            }
          }
        } // reviews 생성 블록 끝
      } catch (saveError) {
        console.error('결과 저장 오류:', saveError);
      }

      // 결과 데이터를 localStorage에 저장 (피드백 페이지에서 사용)
      localStorage.setItem(`quiz_result_${quizId}`, JSON.stringify(result));
      localStorage.removeItem(`quiz_answers_${quizId}`);
      localStorage.removeItem(`quiz_time_${quizId}`);

    } catch (err) {
      console.error('결과 계산 오류:', err);
      setError('결과를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [user, quizId, searchParams]);

  useEffect(() => {
    calculateAndSaveResults();
  }, [calculateAndSaveResults]);

  const handleToggleBookmark = async (questionId: string) => {
    if (!user || !resultData) return;

    const question = resultData.questionResults.find((r) => r.id === questionId);
    if (!question) return;

    const wasBookmarked = question.isBookmarked;

    // UI 먼저 업데이트
    setResultData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questionResults: prev.questionResults.map((r) =>
          r.id === questionId ? { ...r, isBookmarked: !r.isBookmarked } : r
        ),
      };
    });

    try {
      // 기존 북마크 문서 조회
      const bookmarkQuery = query(
        collection(db, 'reviews'),
        where('userId', '==', user.uid),
        where('quizId', '==', resultData.quizId),
        where('questionId', '==', questionId),
        where('reviewType', '==', 'bookmark')
      );
      const existingBookmarks = await getDocs(bookmarkQuery);

      if (wasBookmarked) {
        // 찜 해제: 기존 문서들 삭제
        for (const docSnapshot of existingBookmarks.docs) {
          await deleteDoc(docSnapshot.ref);
        }
      } else {
        // 찜하기: 기존 문서가 없을 때만 추가
        if (existingBookmarks.empty) {
          // 타입 정규화: subjective -> short
          const normalizedBookmarkType = question.type === 'subjective' ? 'short' : question.type;
          // 결합형 필드 준비
          const bookmarkCombinedFields: Record<string, unknown> = {};
          if (question.combinedGroupId) {
            bookmarkCombinedFields.combinedGroupId = question.combinedGroupId;
            bookmarkCombinedFields.combinedIndex = question.combinedIndex ?? null;
            bookmarkCombinedFields.combinedTotal = question.combinedTotal ?? null;
            if (question.combinedIndex === 0) {
              if (question.passage) bookmarkCombinedFields.passage = question.passage;
              if (question.passageType) bookmarkCombinedFields.passageType = question.passageType;
              if (question.passageImage) bookmarkCombinedFields.passageImage = question.passageImage;
              if (question.koreanAbcItems) bookmarkCombinedFields.koreanAbcItems = question.koreanAbcItems;
              // 공통 지문 혼합 보기
              if (question.passageMixedExamples) {
                bookmarkCombinedFields.passageMixedExamples = JSON.parse(JSON.stringify(question.passageMixedExamples));
              }
            }
          }
          await addDoc(collection(db, 'reviews'), {
            userId: user.uid,
            quizId: resultData.quizId,
            quizTitle: resultData.quizTitle,
            questionId: question.number.toString(),
            question: question.question,
            type: normalizedBookmarkType,
            options: question.options || [],
            correctAnswer: question.correctAnswer,
            userAnswer: question.userAnswer,
            explanation: question.explanation || '',
            rubric: question.rubric || null,
            reviewType: 'bookmark',
            isBookmarked: true,
            reviewCount: 0,
            lastReviewedAt: null,
            courseId: userCourseId || null,
            quizUpdatedAt: resultData.quizUpdatedAt || null, // 퀴즈 수정 시간 저장
            quizCreatorId: resultData.quizCreatorId || null, // 퀴즈 제작자 ID
            quizType: resultData.quizType || 'custom', // 퀴즈 타입 (AI 생성 여부 확인용)
            image: question.image || null, // 문제 이미지
            subQuestionOptions: question.subQuestionOptions || null, // 보기 항목
            subQuestionOptionsType: question.subQuestionOptionsType || null, // 보기 타입
            // 혼합 보기 원본 데이터 (undefined 값 제거를 위해 JSON 변환)
            mixedExamples: question.mixedExamples
              ? JSON.parse(JSON.stringify(question.mixedExamples))
              : null,
            subQuestionImage: question.subQuestionImage || null, // 하위 문제 이미지
            chapterId: question.chapterId || null, // 챕터 ID
            chapterDetailId: question.chapterDetailId || null, // 챕터 세부항목 ID
            passagePrompt: question.passagePrompt || null, // 제시문 발문
            bogiQuestionText: question.bogiQuestionText || null, // 보기 발문
            bogi: question.bogi ? JSON.parse(JSON.stringify(question.bogi)) : null, // 보기 박스
            choiceExplanations: question.choiceExplanations || null, // 선지별 해설 (AI 문제용)
            createdAt: serverTimestamp(),
            ...bookmarkCombinedFields,
          });
        }
      }
    } catch (err) {
      console.error('찜하기 오류:', err);
      // 에러 시 UI 롤백
      setResultData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          questionResults: prev.questionResults.map((r) =>
            r.id === questionId ? { ...r, isBookmarked: wasBookmarked } : r
          ),
        };
      });
    }
  };

  const handleNext = () => {
    // 자기가 만든 퀴즈인 경우 바로 EXP 페이지로 이동 (피드백 건너뜀)
    const isOwnQuiz = user && resultData?.quizCreatorId === user.uid;

    if (isOwnQuiz) {
      router.push(`/quiz/${quizId}/exp`);
    } else {
      router.push(`/quiz/${quizId}/feedback`);
    }
  };

  const handleGoHome = () => {
    router.push('/quiz');
  };

  const toggleExpand = (questionId: string) => {
    setExpandedQuestionIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
      } else {
        newSet.add(questionId);
      }
      return newSet;
    });
  };

  const toggleGroupExpand = (groupId: string) => {
    setExpandedGroupIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  // 문제 상세 정보 렌더링 헬퍼 함수
  const renderQuestionDetail = (result: QuestionResult) => {
    // 혼합 보기가 있는 경우 grouped와 나머지 분리
    const groupedBlocks = result.mixedExamples?.filter(b => b.type === 'grouped') || [];
    const nonGroupedBlocks = result.mixedExamples?.filter(b => b.type !== 'grouped') || [];
    const hasMixedExamples = result.mixedExamples && result.mixedExamples.length > 0;

    return (
    <>
      {/* 1. 묶은 보기 (grouped) - 먼저 표시 */}
      {groupedBlocks.map((block) => (
        <div key={block.id} className="mb-3 p-3 border-2 border-[#1A1A1A] bg-[#FFF8E1]">
          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
          <div className="space-y-1">
            {block.children?.map((child) => (
              <div key={child.id}>
                {child.type === 'text' && child.content?.trim() && (
                  <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>
                )}
                {child.type === 'labeled' && (child.items || []).filter(i => i.content?.trim()).map((item) => (
                  <p key={item.id} className="text-sm text-[#1A1A1A]">
                    <span className="font-bold">{item.label}.</span> {item.content}
                  </p>
                ))}
                {child.type === 'gana' && (child.items || []).filter(i => i.content?.trim()).map((item) => (
                  <p key={item.id} className="text-sm text-[#1A1A1A]">
                    <span className="font-bold">({item.label})</span> {item.content}
                  </p>
                ))}
                {child.type === 'image' && child.imageUrl && (
                  <img src={child.imageUrl} alt="보기 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 2. 나머지 제시문 (grouped 제외) - 생성 순서대로 표시 */}
      {nonGroupedBlocks.map((block) => {
        if (block.type === 'text' && block.content?.trim()) {
          return (
            <div key={block.id} className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
              <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
              <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>
            </div>
          );
        }
        if (block.type === 'labeled') {
          return (
            <div key={block.id} className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
              <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
              <div className="space-y-1">
                {(block.items || []).filter(i => i.content?.trim()).map((item) => (
                  <p key={item.id} className="text-sm text-[#1A1A1A]">
                    <span className="font-bold">{item.label}.</span> {item.content}
                  </p>
                ))}
              </div>
            </div>
          );
        }
        if (block.type === 'gana') {
          return (
            <div key={block.id} className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
              <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
              <div className="space-y-1">
                {(block.items || []).filter(i => i.content?.trim()).map((item) => (
                  <p key={item.id} className="text-sm text-[#1A1A1A]">
                    <span className="font-bold">({item.label})</span> {item.content}
                  </p>
                ))}
              </div>
            </div>
          );
        }
        return null;
      })}

      {/* 레거시 보기 - 텍스트 형식 (혼합 보기가 없을 때만) */}
      {!hasMixedExamples && result.subQuestionOptions && result.subQuestionOptions.length > 0 && result.subQuestionOptionsType === 'text' && (
        <div className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
          <p className="text-sm text-[#1A1A1A]">
            {result.subQuestionOptions.join(', ')}
          </p>
        </div>
      )}

      {/* 레거시 보기 - ㄱㄴㄷ 형식 (혼합 보기가 없을 때만) */}
      {!hasMixedExamples && result.subQuestionOptions && result.subQuestionOptions.length > 0 && result.subQuestionOptionsType === 'labeled' && (
        <div className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
          <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
          <div className="space-y-1">
            {result.subQuestionOptions.map((itm, idx) => (
              <p key={idx} className="text-sm text-[#1A1A1A]">
                <span className="font-bold">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ'][idx]}.</span> {itm}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 4. 문제 이미지 - 보기 다음에 표시 */}
      {result.image && (
        <div className="mb-3">
          <p className="text-xs font-bold text-[#5C5C5C] mb-2">문제 이미지</p>
          <img src={result.image} alt="문제 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
        </div>
      )}

      {/* 하위 문제 이미지 */}
      {result.subQuestionImage && (
        <div className="mb-3">
          <p className="text-xs font-bold text-[#5C5C5C] mb-2">이미지</p>
          <img src={result.subQuestionImage} alt="하위 문제 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
        </div>
      )}

      {/* 5. 보기 (<보기> 박스) - 이미지 다음, 발문 전에 표시 */}
      {result.bogi && result.bogi.items && result.bogi.items.some(i => i.content?.trim()) && (
        <div className="mb-3 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
          <p className="text-xs text-center text-[#5C5C5C] mb-2 font-bold">&lt;보 기&gt;</p>
          <div className="space-y-1">
            {result.bogi.items.filter(i => i.content?.trim()).map((item, idx) => (
              <p key={idx} className="text-sm text-[#1A1A1A]">
                <span className="font-bold mr-1">{item.label}.</span>
                {item.content}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 6. 발문 (제시문 발문 + 보기 발문 합침, 선지 전에 표시) */}
      {(result.passagePrompt || result.bogiQuestionText) && (
        <div className="mb-3 p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
          <p className="text-sm text-[#1A1A1A]">
            {result.passagePrompt && result.bogiQuestionText
              ? `${result.passagePrompt} ${result.bogiQuestionText}`
              : result.passagePrompt || result.bogiQuestionText}
          </p>
        </div>
      )}

      {/* 선지 (객관식) - 선지별 해설 아코디언 통합 */}
      {result.options && result.options.length > 0 && (
        <div>
          {/* 복수 정답 표시 */}
          {(() => {
            const correctAnswerStr = result.correctAnswer?.toString() || '';
            const correctAnswers = correctAnswerStr.includes(',')
              ? correctAnswerStr.split(',').map(a => a.trim())
              : [correctAnswerStr];
            const isMultipleAnswer = correctAnswers.length > 1;
            return isMultipleAnswer && (
              <p className="text-xs text-[#8B6914] font-bold mb-2 flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                복수 정답 문제 ({correctAnswers.length}개)
              </p>
            );
          })()}
          <div className="space-y-1">
            {result.options.map((opt, idx) => {
              const optionNum = (idx + 1).toString();
              const correctAnswerStr = result.correctAnswer?.toString() || '';
              const correctAnswers = correctAnswerStr.includes(',')
                ? correctAnswerStr.split(',').map(a => a.trim())
                : [correctAnswerStr];
              const isCorrectOption = correctAnswers.includes(optionNum);
              const userAnswerStr = result.userAnswer?.toString() || '';
              const userAnswers = userAnswerStr.includes(',')
                ? userAnswerStr.split(',').map(a => a.trim())
                : [userAnswerStr];
              const isUserAnswer = userAnswers.includes(optionNum);
              const isMultipleAnswer = correctAnswers.length > 1;
              const choiceExp = result.choiceExplanations?.[idx];
              const choiceKey = `${result.id}-${idx}`;
              const isChoiceExpanded = expandedChoices.has(choiceKey);

              let borderColor = 'border-[#EDEAE4]';
              let bgColor = '';
              let textColor = 'text-[#1A1A1A]';
              if (isCorrectOption) {
                borderColor = 'border-[#1A6B1A]';
                bgColor = 'bg-[#E8F5E9]';
                textColor = 'text-[#1A6B1A]';
              } else if (isUserAnswer) {
                borderColor = 'border-[#8B1A1A]';
                bgColor = 'bg-[#FDEAEA]';
                textColor = 'text-[#8B1A1A]';
              }

              return (
                <div key={idx}>
                  <div
                    className={`text-sm p-2 border ${borderColor} ${bgColor} ${textColor} flex items-center justify-between ${choiceExp ? 'cursor-pointer' : ''}`}
                    onClick={choiceExp ? () => {
                      setExpandedChoices(prev => {
                        const next = new Set(prev);
                        if (next.has(choiceKey)) {
                          next.delete(choiceKey);
                        } else {
                          next.add(choiceKey);
                        }
                        return next;
                      });
                    } : undefined}
                  >
                    <span>
                      {idx + 1}. {opt}
                      {isMultipleAnswer && isCorrectOption && ' (정답)'}
                      {isMultipleAnswer && isUserAnswer && ' (내 답)'}
                    </span>
                    {choiceExp && (
                      <svg
                        className={`w-4 h-4 flex-shrink-0 ml-2 text-[#5C5C5C] transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </div>
                  <AnimatePresence>
                    {choiceExp && isChoiceExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 py-2">
                          <p className="text-sm text-[#5C5C5C] bg-[#EDEAE4] p-2 border-l-2 border-[#8B6914]">
                            {stripChoicePrefix(choiceExp)}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* OX 문제 답 - 버튼 스타일 */}
      {result.type === 'ox' && (!result.options || result.options.length === 0) && (
        <div className="space-y-2">
          {(() => {
            // 사용자 답 정규화
            const userAnswerRaw = result.userAnswer?.toString().toUpperCase() || '';
            const userOX = userAnswerRaw === '0' || userAnswerRaw === 'O' ? 'O' : userAnswerRaw === '1' || userAnswerRaw === 'X' ? 'X' : null;

            // 정답 정규화
            const correctAnswerRaw = result.correctAnswer?.toString().toUpperCase() || '';
            const correctOX = correctAnswerRaw === '0' || correctAnswerRaw === 'O' ? 'O' : 'X';

            // O 버튼 스타일 결정
            let oClassName = 'border-2 border-[#EDEAE4] bg-white text-[#5C5C5C]';
            if (correctOX === 'O') {
              oClassName = 'border-2 border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]';
            }
            if (userOX === 'O' && correctOX !== 'O') {
              oClassName = 'border-2 border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]';
            }

            // X 버튼 스타일 결정
            let xClassName = 'border-2 border-[#EDEAE4] bg-white text-[#5C5C5C]';
            if (correctOX === 'X') {
              xClassName = 'border-2 border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]';
            }
            if (userOX === 'X' && correctOX !== 'X') {
              xClassName = 'border-2 border-[#8B1A1A] bg-[#FDEAEA] text-[#8B1A1A]';
            }

            return (
              <div className="flex gap-3 justify-center py-2">
                <div className={`w-20 h-20 flex items-center justify-center font-bold text-2xl ${oClassName}`}>
                  O
                </div>
                <div className={`w-20 h-20 flex items-center justify-center font-bold text-2xl ${xClassName}`}>
                  X
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* 주관식/서술형 답 */}
      {result.type !== 'ox' && result.type !== 'essay' && (!result.options || result.options.length === 0) && (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="text-[#5C5C5C]">내 답: </span>
            <span className="font-bold text-[#1A1A1A]">
              {result.userAnswer || '(미응답)'}
            </span>
          </p>
          {/* 주관식 복수 정답 표시 */}
          {result.correctAnswer?.toString().includes('|||') ? (
            <p className="text-sm">
              <span className="text-[#5C5C5C]">정답: </span>
              <span className="font-bold text-[#1A6B1A]">
                {result.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')}
              </span>
            </p>
          ) : (
            <p className="text-sm">
              <span className="text-[#5C5C5C]">정답: </span>
              <span className="font-bold text-[#1A6B1A]">{result.correctAnswer}</span>
            </p>
          )}
        </div>
      )}

      {/* 서술형: 내 답만 표시 (정답 없음) */}
      {result.type === 'essay' && (
        <div>
          <p className="text-sm">
            <span className="text-[#5C5C5C]">내 답: </span>
            <span className="font-bold text-[#1A1A1A]">
              {result.userAnswer || '(미응답)'}
            </span>
          </p>
        </div>
      )}

      {/* 서술형: 루브릭 → 해설 (있는 것만) */}
      {result.type === 'essay' ? (
        <>
          {result.rubric && result.rubric.length > 0 && result.rubric.some(r => r.criteria.trim()) && (
            <div>
              <p className="text-xs font-bold text-[#5C5C5C] mb-1">평가 기준</p>
              <div className="bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
                <ul className="space-y-1 text-sm">
                  {result.rubric.filter(r => r.criteria.trim()).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-[#1A1A1A] font-bold shrink-0">·</span>
                      <span>
                        {item.criteria}
                        {item.percentage > 0 && <span className="text-[#5C5C5C] font-bold"> ({item.percentage}%)</span>}
                        {item.description && <span className="text-[#5C5C5C]"> — {item.description}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {result.explanation && result.explanation !== '해설이 없습니다.' && (
            <div>
              <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
              <p className="text-sm text-[#1A1A1A] bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
                {result.explanation}
              </p>
            </div>
          )}
        </>
      ) : (
        /* 비서술형: 해설 항상 표시 */
        <div>
          <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
          <p className="text-sm text-[#1A1A1A] bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
            {result.explanation}
          </p>
        </div>
      )}
    </>
    );
  };

  // 로딩 UI
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}>
        <motion.div className="flex flex-col items-center gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <motion.div
            className="w-12 h-12 border-4 border-[#1A1A1A] border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-[#5C5C5C] font-bold">결과 계산 중...</p>
        </motion.div>
      </div>
    );
  }

  // 에러 UI
  if (error || !resultData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">오류 발생</h2>
        <p className="text-[#5C5C5C] text-center mb-6">{error || '알 수 없는 오류가 발생했습니다.'}</p>
        <button
          onClick={handleGoHome}
          className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
        >
          퀴즈 목록으로
        </button>
      </div>
    );
  }

  const isPerfectScore = resultData.correctCount === resultData.totalCount;

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-50 w-full border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex items-center justify-center h-14 px-4">
          <h1 className="text-base font-bold text-[#1A1A1A]">퀴즈 결과</h1>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="px-4 pt-6 space-y-6"
      >
        {/* 점수 표시 */}
        <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 text-center">
          <p className="text-sm text-[#5C5C5C] mb-2">{resultData.quizTitle}</p>
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-5xl font-bold text-[#1A1A1A]">{resultData.correctCount}</span>
            <span className="text-2xl text-[#5C5C5C]">/</span>
            <span className="text-2xl text-[#5C5C5C]">{resultData.totalCount}</span>
          </div>
          <p className="text-sm text-[#5C5C5C]">
            {isPerfectScore
              ? '만점!'
              : `정답률 ${Math.round((resultData.correctCount / resultData.totalCount) * 100)}%`}
          </p>
        </div>


        {/* 문제별 결과 */}
        <div className="space-y-3">
          <h3 className="font-bold text-[#1A1A1A]">문제별 결과</h3>
          {displayItems.map((item) => {
            // 단일 문제
            if (item.type === 'single' && item.result) {
              const result = item.result;
              return (
                <div key={result.id}>
                  <button
                    onClick={() => toggleExpand(result.id)}
                    className={`w-full border-2 p-4 text-left ${
                      result.isCorrect
                        ? 'border-[#1A6B1A] bg-[#E8F5E9]'
                        : 'border-[#8B1A1A] bg-[#FDEAEA]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-bold ${result.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                          Q{item.displayNumber}. {result.isCorrect ? '정답' : '오답'}
                        </span>
                        {/* 챕터 표시 */}
                        {userCourseId && result.chapterId && (
                          <span className="px-1.5 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
                            {formatChapterLabel(userCourseId, result.chapterId, result.chapterDetailId)}
                          </span>
                        )}
                      </div>
                      <svg
                        className={`w-5 h-5 text-[#5C5C5C] transition-transform ${
                          expandedQuestionIds.has(result.id) ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    <p className="text-sm text-[#1A1A1A] mt-2 line-clamp-2">
                      {result.question}
                      {/* 제시문 발문 또는 보기 발문 표시 */}
                      {(result.passagePrompt || result.bogiQuestionText) && (
                        <span className="ml-1 text-[#5C5C5C]">
                          {result.passagePrompt || result.bogiQuestionText}
                        </span>
                      )}
                    </p>
                  </button>

                  {/* 상세 정보 (펼침) */}
                  <AnimatePresence>
                    {expandedQuestionIds.has(result.id) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-2 border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-3">
                          {renderQuestionDetail(result)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }

            // 결합형 그룹
            if (item.type === 'combined_group' && item.results && item.combinedGroupId) {
              const groupId = item.combinedGroupId;
              const groupResults = item.results;
              const correctInGroup = groupResults.filter(r => r.isCorrect).length;
              const totalInGroup = groupResults.length;
              const firstResult = groupResults[0];
              const isGroupExpanded = expandedGroupIds.has(groupId);

              return (
                <div key={groupId}>
                  {/* 그룹 헤더 */}
                  <button
                    onClick={() => toggleGroupExpand(groupId)}
                    className="w-full border border-[#1A1A1A] bg-[#F5F0E8] p-4 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#1A1A1A]">
                          Q{item.displayNumber}. 결합형 문제
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8]">
                          {correctInGroup}/{totalInGroup} 정답
                        </span>
                      </div>
                      <svg
                        className={`w-5 h-5 text-[#5C5C5C] transition-transform ${
                          isGroupExpanded ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    {/* 공통 문제 미리보기 */}
                    {(firstResult.commonQuestion || firstResult.passagePrompt) && (
                      <p className="text-sm text-[#1A1A1A] mt-2 line-clamp-2">
                        {firstResult.commonQuestion || ''}
                        {/* 제시문 발문 표시 */}
                        {firstResult.passagePrompt && (
                          <span className={firstResult.commonQuestion ? 'ml-1 text-[#5C5C5C]' : ''}>
                            {firstResult.passagePrompt}
                          </span>
                        )}
                      </p>
                    )}
                  </button>

                  {/* 그룹 펼침 (공통 지문 + 하위 문제들) */}
                  <AnimatePresence>
                    {isGroupExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-4">
                          {/* 공통 지문/보기 */}
                          {(firstResult.passage || firstResult.passageImage || firstResult.koreanAbcItems || (firstResult.passageMixedExamples && firstResult.passageMixedExamples.length > 0)) && (
                            <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                              <p className="text-xs font-bold text-[#8B6914] mb-2">
                                {firstResult.passageType === 'korean_abc' ? '보기' : '공통 지문'}
                              </p>
                              {/* 텍스트 */}
                              {firstResult.passage && firstResult.passageType !== 'korean_abc' && firstResult.passageType !== 'mixed' && (
                                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstResult.passage}</p>
                              )}
                              {/* ㄱㄴㄷ 형식 */}
                              {firstResult.passageType === 'korean_abc' && firstResult.koreanAbcItems && firstResult.koreanAbcItems.length > 0 && (
                                <div className="space-y-1">
                                  {firstResult.koreanAbcItems.map((itm, idx) => (
                                    <p key={idx} className="text-sm text-[#1A1A1A]">
                                      <span className="font-bold">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ'][idx]}.</span> {itm}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {/* 혼합 형식 (mixed) */}
                              {firstResult.passageMixedExamples && firstResult.passageMixedExamples.length > 0 && (
                                <div className="space-y-2">
                                  {firstResult.passageMixedExamples.map((block: any) => (
                                    <div key={block.id}>
                                      {block.type === 'grouped' && (
                                        <div className="space-y-1">
                                          {(block.children || []).map((child: any) => (
                                            <div key={child.id}>
                                              {child.type === 'text' && <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                                              {child.type === 'labeled' && (child.items || []).map((i: any) => (
                                                <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                              ))}
                                              {child.type === 'gana' && (child.items || []).map((i: any) => (
                                                <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                              ))}
                                              {child.type === 'image' && child.imageUrl && <img src={child.imageUrl} alt="" className="max-w-full h-auto" />}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {block.type === 'text' && <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>}
                                      {block.type === 'labeled' && (
                                        <div className="space-y-1">
                                          {(block.items || []).map((i: any) => (
                                            <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                          ))}
                                        </div>
                                      )}
                                      {block.type === 'gana' && (
                                        <div className="space-y-1">
                                          {(block.items || []).map((i: any) => (
                                            <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                          ))}
                                        </div>
                                      )}
                                      {block.type === 'image' && block.imageUrl && <img src={block.imageUrl} alt="" className="max-w-full h-auto" />}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* 이미지 */}
                              {firstResult.passageImage && (
                                <img src={firstResult.passageImage} alt="공통 이미지" className="mt-2 max-w-full h-auto border border-[#1A1A1A]" />
                              )}
                            </div>
                          )}

                          {/* 하위 문제들 */}
                          <div className="space-y-3 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
                            {groupResults.map((subResult, subIdx) => (
                              <div key={subResult.id}>
                                <button
                                  onClick={() => toggleExpand(subResult.id)}
                                  className={`w-full border p-3 text-left ${
                                    subResult.isCorrect
                                      ? 'border-[#1A6B1A] bg-[#E8F5E9]'
                                      : 'border-[#8B1A1A] bg-[#FDEAEA]'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`text-xs font-bold ${subResult.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
                                        Q{item.displayNumber}-{subIdx + 1}. {subResult.isCorrect ? '정답' : '오답'}
                                      </span>
                                      {/* 챕터 표시 */}
                                      {userCourseId && subResult.chapterId && (
                                        <span className="px-1.5 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-[10px] font-medium">
                                          {formatChapterLabel(userCourseId, subResult.chapterId, subResult.chapterDetailId)}
                                        </span>
                                      )}
                                    </div>
                                    <svg
                                      className={`w-4 h-4 text-[#5C5C5C] transition-transform ${
                                        expandedQuestionIds.has(subResult.id) ? 'rotate-180' : ''
                                      }`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                  <p className="text-sm text-[#1A1A1A] mt-1 line-clamp-2">
                                    {subResult.question}
                                    {/* 제시문 발문 또는 보기 발문 표시 */}
                                    {(subResult.passagePrompt || subResult.bogiQuestionText) && (
                                      <span className="ml-1 text-[#5C5C5C]">
                                        {subResult.passagePrompt || subResult.bogiQuestionText}
                                      </span>
                                    )}
                                  </p>
                                </button>

                                {/* 하위 문제 상세 */}
                                <AnimatePresence>
                                  {expandedQuestionIds.has(subResult.id) && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="border-2 border-t-0 border-[#1A1A1A] bg-white p-3 space-y-2">
                                        {renderQuestionDetail(subResult)}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }

            return null;
          })}
        </div>
      </motion.main>

      {/* 하단 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]">
        <button
          onClick={handleNext}
          className="w-full py-4 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
        >
          다음
        </button>
      </div>

    </div>
  );
}
