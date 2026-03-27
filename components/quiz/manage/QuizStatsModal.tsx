/**
 * 퀴즈 통계 모달
 *
 * 학생이 만든 퀴즈의 참여자 통계를 표시합니다.
 * - 참여자 수, 평균/최고/최저 점수
 * - 오답률 Top 3
 * - 문제별 분석 (스와이프/드롭다운)
 * - 반별 필터링 (전체/A/B/C/D)
 */

'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection,
  query,
  where,
  doc,
  getDoc,
  getDocs,
  db,
} from '@/lib/repositories';
import { formatChapterLabel } from '@/lib/courseIndex';
import { useCustomFolders } from '@/lib/hooks/useCustomFolders';
import FolderSelectModal from '@/components/common/FolderSelectModal';
import { scaleCoord } from '@/lib/hooks/useViewportScale';
import type {
  SourceRect,
  QuizStatsModalProps,
  LabeledItem,
  BogiData,
  MixedExampleItem,
  FlattenedQuestion,
  QuestionStats,
  QuizStats,
  ResultWithClass,
  ClassFilter,
} from './quizStatsTypes';
import { CLASS_FILTERS } from './quizStatsTypes';
import { flattenQuestions, isValidMixedItem, checkCorrect, getTypeLabel, toMillis } from './quizStatsUtils';
import CountUp from './CountUp';
import ClassPieChart from './ClassPieChart';
import StatsQuizFeedbackModal from './StatsQuizFeedbackModal';
import StatsEssayAnswersModal from './StatsEssayAnswersModal';

// 모듈 레벨 classId 캐시 (모달 닫았다 열어도 유지, 페이지 이동 시에도 유지)
const _statsUserClassCache = new Map<string, 'A' | 'B' | 'C' | 'D' | null>();
// 모듈 레벨 이름 캐시
const _statsUserNameCache = new Map<string, string>();

// ============================================================
// 메인 컴포넌트
// ============================================================

/**
 * 퀴즈 통계 모달
 */
export default function QuizStatsModal({
  quizId,
  quizTitle,
  isOpen,
  onClose,
  isProfessor = false,
  sourceRect = null,
  isPanelMode = false,
}: QuizStatsModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [showQuestionDropdown, setShowQuestionDropdown] = useState(false);

  // 폴더 저장
  const { customFolders, createCustomFolder, addToCustomFolder } = useCustomFolders();
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderSaveToast, setFolderSaveToast] = useState<string | null>(null);

  // 피드백 모달
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSourceRect, setFeedbackSourceRect] = useState<SourceRect | null>(null);
  const [allFeedbacks, setAllFeedbacks] = useState<Record<string, any>[] | null>(null); // 전체 피드백 캐시
  const [feedbackQuestionNum, setFeedbackQuestionNum] = useState<number>(0); // 필터링할 문제 번호 (1-indexed, 0이면 전체)

  // 서술형 답안 모달
  const [showEssayModal, setShowEssayModal] = useState(false);

  // 문제 스와이프 (가로 슬라이드)
  const questionContentRef = useRef<HTMLDivElement>(null);
  const slideEnterFromRef = useRef<'left' | 'right' | null>(null);
  const swipeTransitioning = useRef(false);
  const swipeRef = useRef({
    startX: 0,
    startY: 0,
    direction: 'none' as 'none' | 'horizontal' | 'vertical',
    offsetX: 0,
  });

  // 원본 데이터
  const [questions, setQuestions] = useState<FlattenedQuestion[]>([]);
  const [resultsWithClass, setResultsWithClass] = useState<ResultWithClass[]>([]);
  const [courseId, setCourseId] = useState<string | undefined>();

  // 모달이 열릴 때 문제 인덱스 리셋
  useEffect(() => {
    if (isOpen) {
      setSelectedQuestionIndex(0);
    }
  }, [isOpen]);

  // 모달 열림 시 body 스크롤 완전 잠금 (패널 모드에서는 불필요)
  useEffect(() => {
    if (!isOpen || isPanelMode) return;
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      window.scrollTo(0, scrollY);
    };
  }, [isOpen, isPanelMode]);

  useEffect(() => {
    if (!isOpen) return;

    // classId 캐시 (모듈 레벨 — 모달을 닫았다 다시 열어도 유지)
    const userClassCache = _statsUserClassCache;

    const setup = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. 퀴즈 데이터 가져오기 (1회)
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (!quizDoc.exists()) {
          setError('퀴즈를 찾을 수 없습니다.');
          setLoading(false);
          return;
        }

        const quizData = quizDoc.data();
        const flatQuestions = flattenQuestions(quizData.questions || []);
        setQuestions(flatQuestions);
        setCourseId(quizData.courseId);

        // 2. 퀴즈 결과 1회성 조회 (onSnapshot → getDocs: 읽기 전용 통계이므로 실시간 불필요)
        const resultsQuery = query(
          collection(db, 'quizResults'),
          where('quizId', '==', quizId)
        );

        const resultsSnapshot = await getDocs(resultsQuery);

        // 유저별 첫 풀이만 추출 (3단계 필터링)
        // 1단계: userId별로 모든 결과를 시간순 그룹핑
        const allByUser = new Map<string, { docSnapshot: { id: string }; data: Record<string, any>; ts: number }[]>();
        resultsSnapshot.docs.forEach((docSnapshot) => {
          const data = docSnapshot.data();
          const uid = data.userId;
          if (!uid) return;
          const ts = data.createdAt?.toMillis?.() || data.createdAt?.seconds * 1000 || 0;
          if (!allByUser.has(uid)) allByUser.set(uid, []);
          allByUser.get(uid)!.push({ docSnapshot, data, ts });
        });

        // 2단계: 교수 계정 제외
        const professorIds = new Set<string>();
        const userIds = Array.from(allByUser.keys());
        // 배치로 교수 여부 확인 (10명씩, 권한 에러 무시)
        for (let i = 0; i < userIds.length; i += 10) {
          const batch = userIds.slice(i, i + 10);
          const userDocs = await Promise.all(
            batch.map(async (uid) => {
              try {
                return await getDoc(doc(db, 'users', uid));
              } catch {
                return null; // 학생 계정 — 다른 유저 get 권한 없음
              }
            })
          );
          userDocs.forEach((userDoc) => {
            if (userDoc?.exists() && userDoc.data()?.role === 'professor') {
              professorIds.add(userDoc.id);
            }
          });
        }

        // 3단계: 유저별 첫 풀이 선택 (순수 시간순 — isUpdate 플래그 역전 버그 대응)
        const firstResultByUser = new Map<string, { docSnapshot: { id: string }; data: Record<string, any> }>();
        allByUser.forEach((results, uid) => {
          if (professorIds.has(uid)) return; // 교수 제외
          results.sort((a, b) => a.ts - b.ts);
          const earliest = results[0];
          if (earliest) {
            firstResultByUser.set(uid, { docSnapshot: earliest.docSnapshot, data: earliest.data });
          }
        });

        const dedupedResults = Array.from(firstResultByUser.values());

        if (dedupedResults.length === 0) {
          setResultsWithClass([]);
          setLoading(false);
          return;
        }

        // 항상 users 컬렉션에서 반 정보 조회 (결과의 classId는 퀴즈 문서에서 온 것일 수 있어 신뢰 불가)
        const resultsWithClassDirect: ResultWithClass[] = [];
        const resultsNeedingClass: { data: Record<string, any> }[] = [];

        dedupedResults.forEach(({ data }) => {
          if (userClassCache.has(data.userId)) {
            resultsWithClassDirect.push({
              userId: data.userId,
              classType: userClassCache.get(data.userId) || null,
              score: data.score || 0,
              questionScores: data.questionScores || {},
              createdAt: data.createdAt,
            });
          } else {
            resultsNeedingClass.push({ data });
          }
        });

        // 캐시에 없는 유저들 배치로 조회 (30개씩)
        const classNeededUserIds = [...new Set(resultsNeedingClass.map((r) => r.data.userId))];

        if (classNeededUserIds.length > 0) {
          // 30개씩 배치로 쿼리 (Firestore 'in' 제한)
          for (let i = 0; i < classNeededUserIds.length; i += 30) {
            const batch = classNeededUserIds.slice(i, i + 30);
            const batchResults = await Promise.all(
              batch.map(async (userId) => {
                try {
                  const userDoc = await getDoc(doc(db, 'users', userId));
                  const userData = userDoc.exists() ? userDoc.data() : null;
                  // 이름도 캐시
                  if (userData?.name) _statsUserNameCache.set(userId, userData.name);
                  return { userId, classId: userData?.classId || null };
                } catch {
                  return { userId, classId: null };
                }
              })
            );
            batchResults.forEach(({ userId, classId }) => {
              userClassCache.set(userId, classId);
            });
          }
        }

        // 결과에 classType 추가
        const resultsFromUsers: ResultWithClass[] = resultsNeedingClass.map(({ data }) => ({
          userId: data.userId,
          classType: userClassCache.get(data.userId) || null,
          score: data.score || 0,
          questionScores: data.questionScores || {},
          createdAt: data.createdAt,
        }));

        const results: ResultWithClass[] = [...resultsWithClassDirect, ...resultsFromUsers];
        setResultsWithClass(results);
        setLoading(false);

        // 피드백도 미리 로드 (문제별 ! 표시용)
        try {
          const feedbacksRef = collection(db, 'questionFeedbacks');
          const fbQuery = query(feedbacksRef, where('quizId', '==', quizId));
          const fbSnapshot = await getDocs(fbQuery);
          const fbItems: Record<string, any>[] = [];
          fbSnapshot.forEach((d) => {
            const data = d.data();
            fbItems.push({
              id: d.id,
              ...data,
              feedbackType: data.type || data.feedbackType,
              feedback: data.content || data.feedback || '',
              classType: _statsUserClassCache.get(data.userId) || null,
            });
          });
          // 반 정보가 없는 피드백 유저는 배치 조회
          const fbNeedClass = fbItems.filter((fb) => fb.userId && !fb.classType && !_statsUserClassCache.has(fb.userId));
          const fbUniqueUids = [...new Set(fbNeedClass.map((fb) => fb.userId as string))];
          for (let i = 0; i < fbUniqueUids.length; i += 30) {
            const batch = fbUniqueUids.slice(i, i + 30);
            await Promise.all(batch.map(async (uid) => {
              try {
                const userDoc = await getDoc(doc(db, 'users', uid));
                const cls = userDoc.exists() ? userDoc.data()?.classId || null : null;
                _statsUserClassCache.set(uid, cls);
              } catch { /* ignore */ }
            }));
          }
          // 반 정보 재적용
          fbItems.forEach((fb) => {
            if (!fb.classType && fb.userId) {
              fb.classType = _statsUserClassCache.get(fb.userId) || null;
            }
          });
          fbItems.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
          });
          setAllFeedbacks(fbItems);
        } catch (fbErr) {
          console.warn('피드백 미리 로드 실패:', fbErr);
        }
      } catch (err) {
        console.error('통계 로드 실패:', err);
        setError('통계를 불러오는데 실패했습니다.');
        setLoading(false);
      }
    };

    setup();
  }, [isOpen, quizId]);

  // 필터링된 결과 기반으로 통계 계산
  const stats = useMemo<QuizStats | null>(() => {
    if (questions.length === 0) return null;

    // 반별 필터링
    const filteredResults =
      classFilter === 'all'
        ? resultsWithClass
        : resultsWithClass.filter((r) => r.classType === classFilter);

    if (filteredResults.length === 0) {
      return {
        participantCount: 0,
        averageScore: 0,
        highestScore: 0,
        lowestScore: 0,
        stdDev: 0,
        courseId,
        questionStats: questions.map((q, idx) => ({
          questionId: `${q.id}_${idx}`,
          questionIndex: idx,
          questionText: q.text || '',
          questionType: q.type || 'multiple',
          correctRate: 0,
          wrongRate: 100,
          discrimination: 0,
          totalAttempts: 0,
          correctCount: 0,
          correctAnswer: q.answer,
          choices: q.choices,
          chapterId: q.chapterId,
          chapterDetailId: q.chapterDetailId,
          imageUrl: q.imageUrl,
          mixedExamples: q.mixedExamples,
          passagePrompt: q.passagePrompt,
          bogi: q.bogi,
          passage: q.passage,
          passageType: q.passageType,
          passageImage: q.passageImage,
          koreanAbcItems: q.koreanAbcItems,
          explanation: q.explanation,
          choiceExplanations: q.choiceExplanations,
        })),
      };
    }

    // 문제 ID → 문제 객체 맵 (O(1) 룩업용)
    const questionMap = new Map<string, FlattenedQuestion>();
    const questionUpdatedAtMap = new Map<string, number>();
    questions.forEach((q) => {
      questionMap.set(q.id, q);
      if (q.questionUpdatedAt) {
        questionUpdatedAtMap.set(q.id, q.questionUpdatedAt);
      }
    });

    // 통계 계산
    // 참여자 수/점수: 모든 유니크 사용자 포함 (수정 문제 풀었든 안 풀었든)
    // 문제별 정답률/선지: 수정된 문제는 수정 후 응답만, 비수정 문제는 전체
    const scores: number[] = [];
    const questionCorrectCounts: Record<string, number> = {};
    const questionAttemptCounts: Record<string, number> = {};
    // 유저별 정답(1)/오답(0) 기록 — 변별도 계산용
    const questionScoreArrays: Record<string, number[]> = {};
    // 유저별 총점 — 변별도에서 상/하위 구분용
    const userTotalScores: Record<string, number> = {};
    const oxSelections: Record<string, { o: number; x: number }> = {};
    const optionSelections: Record<string, Record<string, number>> = {};
    const shortAnswerResponses: Record<string, Record<string, number>> = {};
    const essayResponses: Record<string, { answer: string; userId: string }[]> = {};

    // 변별도 계산용: 문제별로 { userId, isCorrect }[] 기록
    const questionUserScores: Record<string, { userId: string; isCorrect: boolean }[]> = {};

    filteredResults.forEach((result) => {
      scores.push(result.score);
      userTotalScores[result.userId] = result.score;

      // 문제별 점수 분석
      Object.entries(result.questionScores).forEach(
        ([questionId, scoreData]) => {
          const question = questionMap.get(questionId);
          if (!question) return;

          // 수정된 문제의 경우 수정 이후 응답만 포함
          const updatedAt = questionUpdatedAtMap.get(questionId);
          if (updatedAt) {
            const answeredAt = toMillis(scoreData.answeredAt) || toMillis(result.createdAt);
            // 타임스탬프 없는 레거시 결과는 수정 이전으로 간주하여 제외
            if (answeredAt === 0 || answeredAt < updatedAt) return;
          }

          if (questionAttemptCounts[questionId] === undefined) {
            questionCorrectCounts[questionId] = 0;
            questionAttemptCounts[questionId] = 0;
            questionScoreArrays[questionId] = [];
            questionUserScores[questionId] = [];
          }
          // 현재 정답 기준으로 재판정 (문제 수정 시 서버 isCorrect와 불일치 방지)
          const isCorrect = checkCorrect(question, scoreData.userAnswer ?? '');
          questionAttemptCounts[questionId]++;
          questionScoreArrays[questionId].push(isCorrect ? 1 : 0);
          questionUserScores[questionId].push({ userId: result.userId, isCorrect });
          if (isCorrect) {
            questionCorrectCounts[questionId]++;
          }

          // OX 선택 분포
          if (question.type === 'ox') {
            if (!oxSelections[questionId]) {
              oxSelections[questionId] = { o: 0, x: 0 };
            }
            const answer = scoreData.userAnswer?.toString().toUpperCase();
            if (answer === 'O' || answer === '0') {
              oxSelections[questionId].o++;
            } else if (answer === 'X' || answer === '1') {
              oxSelections[questionId].x++;
            }
          }

          // 객관식 선지 분포
          if (question.type === 'multiple' && scoreData.userAnswer) {
            if (!optionSelections[questionId]) {
              optionSelections[questionId] = {};
            }
            // 복수 선택 지원
            const answers = scoreData.userAnswer.toString().split(',').map((a: string) => a.trim());
            answers.forEach((ans: string) => {
              optionSelections[questionId][ans] = (optionSelections[questionId][ans] || 0) + 1;
            });
          }

          // 주관식 응답 수집 (오답만)
          if ((question.type === 'short_answer' || question.type === 'short') && !isCorrect && scoreData.userAnswer) {
            if (!shortAnswerResponses[questionId]) {
              shortAnswerResponses[questionId] = {};
            }
            const userAnswer = scoreData.userAnswer.toString().trim().toLowerCase() || '(미입력)';
            shortAnswerResponses[questionId][userAnswer] = (shortAnswerResponses[questionId][userAnswer] || 0) + 1;
          }

          // 서술형 답변 수집 (미응답도 포함)
          if (question.type === 'essay') {
            if (!essayResponses[questionId]) {
              essayResponses[questionId] = [];
            }
            essayResponses[questionId].push({
              answer: scoreData.userAnswer ? scoreData.userAnswer.toString() : '',
              userId: result.userId,
            });
          }
        }
      );
    });

    // 평균/최고/최저/표준편차
    const averageScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;
    const stdDev = scores.length >= 2
      ? Math.round(Math.sqrt(scores.reduce((sum, s) => sum + (s - averageScore) ** 2, 0) / scores.length) * 10) / 10
      : 0;

    // 문제별 통계
    const questionStats: QuestionStats[] = questions.map((q, idx) => {
      const attempts = questionAttemptCounts[q.id] || 0;
      const correct = questionCorrectCounts[q.id] || 0;
      const correctRate = attempts > 0 ? Math.round((correct / attempts) * 100) : 0;
      const wrongRate = 100 - correctRate;

      // 변별도 계산 (상위 27% 정답률 - 하위 27% 정답률, 최소 10명 이상)
      let discrimination = 0;
      const userScores = questionUserScores[q.id];
      if (userScores && userScores.length >= 10) {
        // 총점 기준 정렬
        const sorted = [...userScores].sort(
          (a, b) => (userTotalScores[b.userId] ?? 0) - (userTotalScores[a.userId] ?? 0)
        );
        const n27 = Math.max(1, Math.ceil(sorted.length * 0.27));
        const upper = sorted.slice(0, n27);
        const lower = sorted.slice(-n27);
        const upperRate = upper.filter(u => u.isCorrect).length / upper.length;
        const lowerRate = lower.filter(u => u.isCorrect).length / lower.length;
        discrimination = Math.round((upperRate - lowerRate) * 100) / 100;
      }

      const stat: QuestionStats = {
        questionId: `${q.id}_${idx}`,
        questionIndex: idx,
        questionText: q.text || '',
        questionType: q.type || 'multiple',
        correctRate,
        wrongRate,
        discrimination,
        totalAttempts: attempts,
        correctCount: correct,
        correctAnswer: q.answer,
        choices: q.choices,
        chapterId: q.chapterId,
        chapterDetailId: q.chapterDetailId,
        imageUrl: q.imageUrl,
        mixedExamples: q.mixedExamples,
        passagePrompt: q.passagePrompt,
        bogi: q.bogi,
        passage: q.passage,
        passageType: q.passageType,
        passageImage: q.passageImage,
        koreanAbcItems: q.koreanAbcItems,
        explanation: q.explanation,
        choiceExplanations: q.choiceExplanations,
      };

      // OX 분포
      if (q.type === 'ox' && oxSelections[q.id]) {
        stat.oxDistribution = oxSelections[q.id];
      }

      // 객관식 선지 분포
      if (q.type === 'multiple' && q.choices) {
        const selections = optionSelections[q.id] || {};
        // q.answer는 0-indexed (예: "0", "2", "0,2")
        const correctIndices = q.answer?.split(',').map((a) => parseInt(a.trim())).filter(n => !isNaN(n)) || [];

        // 총 선택 수 계산 (모든 선지 선택의 합)
        const totalSelections = Object.values(selections).reduce((sum, count) => sum + count, 0);

        stat.optionDistribution = q.choices.map((choice, optIdx) => {
          // selections 키는 0-indexed (서버 scoreData.userAnswer 기준)
          const optionNum = optIdx.toString();
          const count = selections[optionNum] || 0;
          const percentage = totalSelections > 0 ? Math.round((count / totalSelections) * 100) : 0;
          // 0-indexed 정답과 비교
          const isCorrect = correctIndices.includes(optIdx);
          return { option: choice, count, isCorrect, percentage };
        });

      }

      // 주관식 오답 목록
      if ((q.type === 'short_answer' || q.type === 'short') && shortAnswerResponses[q.id]) {
        stat.wrongAnswers = Object.entries(shortAnswerResponses[q.id])
          .map(([answer, count]) => ({ answer, count }))
          .sort((a, b) => b.count - a.count);
      }

      // 서술형 답변 목록
      if (q.type === 'essay' && essayResponses[q.id]) {
        stat.essayAnswers = essayResponses[q.id];
      }

      return stat;
    });

    return {
      participantCount: scores.length,
      averageScore,
      highestScore,
      lowestScore,
      stdDev,
      courseId,
      questionStats,
    };
  }, [questions, resultsWithClass, classFilter, courseId]);

  // 반별 참여자 수 계산 (모든 유니크 사용자 포함)
  const classParticipantCounts = useMemo(() => {
    const counts: Record<ClassFilter, number> = {
      all: resultsWithClass.length,
      A: 0,
      B: 0,
      C: 0,
      D: 0,
    };

    resultsWithClass.forEach((r) => {
      if (r.classType && counts[r.classType] !== undefined) {
        counts[r.classType]++;
      }
    });

    return counts;
  }, [resultsWithClass]);

  // 반별 표준편차 계산 (전체 탭에서 비교 표시용)
  const classStdDevs = useMemo(() => {
    const result: Record<string, { stdDev: number; avg: number; count: number }> = {};
    const classes = ['A', 'B', 'C', 'D'] as const;
    for (const cls of classes) {
      const scores = resultsWithClass.filter((r) => r.classType === cls).map((r) => r.score);
      if (scores.length < 2) {
        result[cls] = { stdDev: 0, avg: 0, count: scores.length };
        continue;
      }
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / scores.length;
      result[cls] = {
        stdDev: Math.round(Math.sqrt(variance) * 10) / 10,
        avg: Math.round(avg),
        count: scores.length,
      };
    }
    return result;
  }, [resultsWithClass]);

  // 오답률 Top 3 계산
  const wrongRateTop3 = useMemo(() => {
    if (!stats) return [];
    return [...stats.questionStats]
      .sort((a, b) => b.wrongRate - a.wrongRate)
      .slice(0, 3)
      .map((q, idx) => ({
        rank: idx + 1,
        questionNum: stats.questionStats.findIndex(s => s.questionId === q.questionId) + 1,
        wrongRate: q.wrongRate,
      }));
  }, [stats]);

  // 문제 전환 (비스와이프: 즉시)
  const goToQuestion = useCallback((newIdx: number) => {
    if (newIdx === selectedQuestionIndex) return;
    setSelectedQuestionIndex(newIdx);
  }, [selectedQuestionIndex]);

  // 스와이프 슬라이드 인 애니메이션
  useLayoutEffect(() => {
    const enterFrom = slideEnterFromRef.current;
    if (!enterFrom || !questionContentRef.current) return;
    slideEnterFromRef.current = null;

    const el = questionContentRef.current;
    const startX = enterFrom === 'left' ? '-100%' : '100%';
    el.style.transition = 'none';
    el.style.transform = `translateX(${startX})`;
    el.getBoundingClientRect();
    el.style.transition = 'transform 250ms cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'translateX(0)';

    const cleanup = () => {
      el.style.transition = '';
      el.style.transform = '';
      swipeTransitioning.current = false;
    };
    el.addEventListener('transitionend', cleanup, { once: true });
    const timer = setTimeout(cleanup, 350);
    return () => clearTimeout(timer);
  }, [selectedQuestionIndex]);

  // 문제 영역 터치 핸들러
  const handleQSwipeStart = useCallback((e: React.TouchEvent) => {
    if (swipeTransitioning.current) return;
    const s = swipeRef.current;
    s.startX = scaleCoord(e.touches[0].clientX);
    s.startY = scaleCoord(e.touches[0].clientY);
    s.direction = 'none';
    s.offsetX = 0;
  }, []);

  const handleQSwipeMove = useCallback((e: React.TouchEvent) => {
    if (swipeTransitioning.current) return;
    const s = swipeRef.current;
    const deltaX = scaleCoord(e.touches[0].clientX) - s.startX;
    const deltaY = scaleCoord(e.touches[0].clientY) - s.startY;

    // 방향 잠금
    if (s.direction === 'none') {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return;
      s.direction = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }

    if (s.direction !== 'horizontal' || !questionContentRef.current) return;

    const totalQ = stats?.questionStats.length || 0;
    const isAtStart = selectedQuestionIndex === 0;
    const isAtEnd = selectedQuestionIndex >= totalQ - 1;

    if ((isAtStart && deltaX > 0) || (isAtEnd && deltaX < 0)) {
      s.offsetX = deltaX * 0.15;
    } else {
      s.offsetX = deltaX * 0.5;
    }

    questionContentRef.current.style.transition = 'none';
    questionContentRef.current.style.transform = `translateX(${s.offsetX}px)`;
  }, [selectedQuestionIndex, stats]);

  const handleQSwipeEnd = useCallback(() => {
    const s = swipeRef.current;
    if (s.direction !== 'horizontal' || !questionContentRef.current) {
      s.direction = 'none';
      return;
    }

    const el = questionContentRef.current;
    const deltaX = s.offsetX;
    s.direction = 'none';

    const SWIPE_THRESHOLD = 60;
    const totalQ = stats?.questionStats.length || 0;

    if (deltaX < -SWIPE_THRESHOLD && selectedQuestionIndex < totalQ - 1) {
      // 왼쪽 스와이프 → 다음 문제
      swipeTransitioning.current = true;
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = `translateX(${-el.offsetWidth}px)`;
      setTimeout(() => {
        slideEnterFromRef.current = 'right';
        setSelectedQuestionIndex(selectedQuestionIndex + 1);
      }, 200);
      return;
    }

    if (deltaX > SWIPE_THRESHOLD && selectedQuestionIndex > 0) {
      // 오른쪽 스와이프 → 이전 문제
      swipeTransitioning.current = true;
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = `translateX(${el.offsetWidth}px)`;
      setTimeout(() => {
        slideEnterFromRef.current = 'left';
        setSelectedQuestionIndex(selectedQuestionIndex - 1);
      }, 200);
      return;
    }

    // 원위치 복귀
    el.style.transition = 'transform 250ms cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'translateX(0)';
  }, [selectedQuestionIndex, stats]);

  // 현재 선택된 문제
  const currentQuestion = stats?.questionStats[selectedQuestionIndex];

  // 피드백에서 문제 번호 추출 헬퍼
  const getFeedbackQuestionNum = useCallback((fb: Record<string, any>): number => {
    if (fb.questionNumber && fb.questionNumber > 0 && fb.questionNumber < 1000) {
      return fb.questionNumber;
    }
    if (fb.questionId) {
      const match = fb.questionId.match(/^q(\d{1,3})$/);
      if (match) return parseInt(match[1], 10) + 1;
    }
    return 0;
  }, []);

  // 반별 필터 적용된 피드백 목록
  const classFilteredFeedbacks = useMemo(() => {
    if (!allFeedbacks) return [];
    if (classFilter === 'all') return allFeedbacks;
    return allFeedbacks.filter((fb) => fb.classType === classFilter);
  }, [allFeedbacks, classFilter]);

  // 문제별 피드백 존재 여부 Set (1-indexed 문제 번호) — 반별 필터 반영
  // 문제별 피드백 개수 Map (1-indexed 문제 번호 → 개수)
  const feedbackCountByQuestion = useMemo(() => {
    const map = new Map<number, number>();
    for (const fb of classFilteredFeedbacks) {
      const num = getFeedbackQuestionNum(fb);
      if (num > 0) map.set(num, (map.get(num) || 0) + 1);
    }
    return map;
  }, [classFilteredFeedbacks, getFeedbackQuestionNum]);

  // 혼합 보기 유효성 검사
  const hasValidMixedExamples = currentQuestion?.mixedExamples &&
    currentQuestion.mixedExamples.length > 0 &&
    currentQuestion.mixedExamples.some(item => isValidMixedItem(item));

  // 피드백 모달 열기 (questionNum: 1-indexed 문제 번호, 0이면 전체)
  const handleOpenFeedback = useCallback(async (questionNum: number, rect?: SourceRect) => {
    if (rect) setFeedbackSourceRect(rect);
    setFeedbackQuestionNum(questionNum);
    setShowFeedbackModal(true);

    // 이미 캐시되어 있으면 로드 불필요
    if (allFeedbacks) return;

    // 캐시 없으면 로드
    setFeedbackLoading(true);
    try {
      const feedbacksRef = collection(db, 'questionFeedbacks');
      const q = query(feedbacksRef, where('quizId', '==', quizId));
      const snapshot = await getDocs(q);

      const items: Record<string, any>[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        items.push({
          id: d.id,
          ...data,
          feedbackType: data.type || data.feedbackType,
          feedback: data.content || data.feedback || '',
          classType: _statsUserClassCache.get(data.userId) || null,
        });
      });

      items.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });

      setAllFeedbacks(items);
    } catch (err) {
      console.error('피드백 로드 실패:', err);
    } finally {
      setFeedbackLoading(false);
    }
  }, [quizId, allFeedbacks]);

  // 현재 문제를 폴더에 저장
  const handleFolderSelect = async (folderId: string) => {
    if (!currentQuestion) return;
    try {
      await addToCustomFolder(folderId, [{
        questionId: currentQuestion.questionId,
        quizId: quizId,
        quizTitle: quizTitle,
        combinedGroupId: null,
      }]);
      setShowFolderModal(false);
      setFolderSaveToast('폴더에 추가되었습니다');
      setTimeout(() => setFolderSaveToast(null), 2000);
    } catch {
      setFolderSaveToast('추가에 실패했습니다');
      setTimeout(() => setFolderSaveToast(null), 2000);
    }
  };

  // 요술지니 애니메이션 계산 (sourceRect → 화면 중앙)
  const genieOffset = useMemo(() => {
    if (!sourceRect || typeof window === 'undefined') return { dx: 0, dy: 0 };
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    return {
      dx: sourceRect.x + sourceRect.width / 2 - cx,
      dy: sourceRect.y + sourceRect.height / 2 - cy,
    };
  }, [sourceRect]);

  // 공통 콘텐츠 래퍼
  const statsContent = (
      <div className={isPanelMode
        ? 'h-full bg-[#F5F0E8] overflow-hidden flex flex-col'
        : 'w-full max-w-lg bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[82vh] overflow-hidden flex flex-col rounded-xl'
      }
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-3 py-2 border-b-2 border-[#1A1A1A] flex items-center justify-between flex-shrink-0">
          <h2 className="text-sm font-bold text-[#1A1A1A] flex-1 pr-3 truncate">{quizTitle}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 반별 필터 탭 — 교수님만 표시 */}
        {isProfessor && (
          <div className="flex border-b border-[#D4CFC4] flex-shrink-0 bg-[#EDEAE4]">
            {CLASS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setClassFilter(filter.value)}
                className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                  classFilter === filter.value
                    ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A] bg-[#F5F0E8]'
                    : 'text-[#5C5C5C] hover:text-[#1A1A1A]'
                }`}
              >
                {filter.label}
                <span className="ml-0.5 text-[10px]">
                  ({classParticipantCounts[filter.value]})
                </span>
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8 flex-shrink-0">
            <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-center py-8 flex-shrink-0">
            <p className="text-sm text-[#8B1A1A]">{error}</p>
          </div>
        )}

        {!loading && !error && stats && (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* 요약 카드 */}
            <div className="px-3 pt-2 pb-1 flex-shrink-0">
              <div className="grid grid-cols-5 gap-1 p-2 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <div className="text-center">
                  <p className="text-[10px] text-[#5C5C5C]">참여자</p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    <CountUp key={`participant-${classFilter}`} value={stats.participantCount} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[#5C5C5C]">평균</p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    <CountUp key={`average-${classFilter}`} value={stats.averageScore} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[#5C5C5C]">최고</p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    <CountUp key={`highest-${classFilter}`} value={stats.highestScore} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[#5C5C5C]">최저</p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    <CountUp key={`lowest-${classFilter}`} value={stats.lowestScore} duration={800} />
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-[#5C5C5C]">편차(σ)</p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    {stats.stdDev > 0 ? stats.stdDev.toFixed(1) : '—'}
                  </p>
                </div>
              </div>

              {/* 전체 탭일 때 반별 편차 수치 */}
              {isProfessor && classFilter === 'all' && (() => {
                const classes = ['A', 'B', 'C', 'D'] as const;
                const hasAnyData = classes.some((c) => classStdDevs[c].count >= 2);
                if (!hasAnyData) return null;

                return (
                  <div className="mt-1 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                    <div className="grid grid-cols-4">
                      {classes.map((cls) => (
                        <div key={cls} className="text-center py-1.5 border-r last:border-r-0 border-[#D4CFC4]">
                          <p className="text-[10px] text-[#5C5C5C]">{cls}반 편차</p>
                          <p className="text-sm font-bold text-[#1A1A1A]">
                            {classStdDevs[cls].count >= 2 ? classStdDevs[cls].stdDev.toFixed(1) : '—'}
                          </p>
                          {classStdDevs[cls].count >= 2 && (
                            <p className="text-[10px] text-[#5C5C5C]">μ {classStdDevs[cls].avg}</p>
                          )}
                          {classStdDevs[cls].count < 2 && (
                            <p className="text-[10px] text-[#5C5C5C]">부족</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 문제별 분석 */}
            {stats.questionStats.length > 0 && (
              <div className="flex flex-col mx-3 mb-2 border-2 border-[#1A1A1A] bg-[#EDEAE4] flex-1 min-h-0">
                {/* 슬라이더 헤더 — 고정 */}
                <div className="flex-shrink-0 px-3 py-1 border-b border-[#1A1A1A] bg-[#F5F0E8]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[#1A1A1A]">Q{selectedQuestionIndex + 1}.</span>
                    <span className="text-xs text-[#5C5C5C]">{stats.questionStats.length}문제</span>
                  </div>
                    {/* 슬라이더 + 킬러 마커 */}
                    {stats.questionStats.length > 1 && (() => {
                      const totalQ = stats.questionStats.length;
                      const markers = wrongRateTop3
                        .map((item) => ({
                          ...item,
                          position: ((item.questionNum - 1) / (totalQ - 1)) * 100,
                          correctRate: 100 - item.wrongRate,
                        }))
                        .sort((a, b) => a.position - b.position);

                      const renderMarker = (item: typeof markers[0], placeAbove: boolean) => {
                        const rankLabel = item.rank === 1 ? '1st' : item.rank === 2 ? '2nd' : '3rd';
                        const align = item.position < 8 ? 'translateX(0)' : item.position > 92 ? 'translateX(-100%)' : 'translateX(-50%)';
                        return (
                          <span
                            key={item.rank}
                            onClick={() => goToQuestion(item.questionNum - 1)}
                            className="absolute text-[10px] font-bold text-[#1A1A1A] cursor-pointer hover:text-[#5C5C5C] text-center leading-tight whitespace-nowrap"
                            style={{
                              left: `${item.position}%`,
                              transform: align,
                              ...(placeAbove
                                ? { bottom: '100%', marginBottom: '2px' }
                                : { top: '100%', marginTop: '2px' }),
                            }}
                          >
                            {rankLabel}<br />{item.correctRate}%
                          </span>
                        );
                      };

                      return (
                        <div>
                          <div
                            className="relative"
                            style={{
                              marginTop: markers.length > 1 ? '26px' : '0',
                              marginBottom: markers.length > 0 ? '22px' : '0',
                            }}
                          >
                            <input
                              type="range"
                              min={0}
                              max={totalQ - 1}
                              value={selectedQuestionIndex}
                              onChange={(e) => goToQuestion(parseInt(e.target.value))}
                              className="w-full h-2 bg-[#D4CFC4] appearance-none cursor-pointer accent-[#1A1A1A] relative z-10"
                              style={{
                                background: `linear-gradient(to right, #1A1A1A 0%, #1A1A1A ${(selectedQuestionIndex / (totalQ - 1)) * 100}%, #D4CFC4 ${(selectedQuestionIndex / (totalQ - 1)) * 100}%, #D4CFC4 100%)`
                              }}
                            />
                            {/* 킬러 마커 — 위아래 교대 배치 */}
                            {markers.map((item, idx) =>
                              renderMarker(item, idx % 2 === 0)
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* 문제 상세 — 남은 공간에서 스크롤 */}
                  {currentQuestion && (
                    <div
                      className="relative flex-1 min-h-0 overflow-hidden flex flex-col"
                      onTouchStart={handleQSwipeStart}
                      onTouchMove={handleQSwipeMove}
                      onTouchEnd={handleQSwipeEnd}
                    >
                      {/* 피드백 아이콘 (좌측 상단) + 피드백 개수 */}
                      <div className="absolute top-1 left-1 z-10 flex items-center">
                        <button
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            handleOpenFeedback(selectedQuestionIndex + 1, { x: r.x, y: r.y, width: r.width, height: r.height });
                          }}
                          className="w-8 h-8 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
                          title="피드백 보기"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                          </svg>
                        </button>
                        {(feedbackCountByQuestion.get(selectedQuestionIndex + 1) || 0) > 0 && (
                          <span className="text-[10px] font-bold text-[#5C5C5C] -ml-1">{feedbackCountByQuestion.get(selectedQuestionIndex + 1)}</span>
                        )}
                      </div>
                      {/* 서술형 답안 확인 아이콘 (피드백 아이콘 + ! 배지 우측) */}
                      {currentQuestion.questionType === 'essay' && (
                        <button
                          onClick={() => setShowEssayModal(true)}
                          className="absolute top-1 z-10 w-8 h-8 flex items-center justify-center text-[#8B6914] hover:text-[#6B4F0E] transition-colors"
                          style={{ left: feedbackCountByQuestion.has(selectedQuestionIndex + 1) ? '2.75rem' : '2.25rem' }}
                          title="서술형 답안 보기"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </button>
                      )}
                      {/* 폴더 저장 아이콘 (우측 상단) — 교수님 전용 */}
                      {isProfessor && (
                        <button
                          onClick={() => setShowFolderModal(true)}
                          className="absolute top-1 right-1 z-10 w-8 h-8 flex items-center justify-center text-[#8B6914] hover:text-[#6B4F0E] transition-colors"
                          title="폴더에 저장"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                          </svg>
                        </button>
                      )}
                      <div
                        ref={questionContentRef}
                        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide overscroll-contain"
                        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
                      >
                      <div className="p-3 min-h-full flex flex-col justify-center items-stretch">
                        {/* 문제 헤더 */}
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <span className="text-sm font-bold text-[#1A1A1A]">
                            정답률 {currentQuestion.correctRate}%
                          </span>
                          {currentQuestion.totalAttempts >= 10 && (() => {
                            const d = currentQuestion.discrimination;
                            const label = d >= 0.4 ? '우수' : d >= 0.2 ? '양호' : d >= 0 ? '미흡' : '역변별';
                            const color = d >= 0.4 ? '#16A34A' : d >= 0.2 ? '#1A1A1A' : d >= 0 ? '#D97706' : '#DC2626';
                            return (
                              <>
                                <span className="text-xs text-[#5C5C5C]">·</span>
                                <span className="text-xs font-bold" style={{ color }}>
                                  변별도 {d.toFixed(2)} <span className="text-[10px] font-normal">({label})</span>
                                </span>
                              </>
                            );
                          })()}
                        </div>

                        {/* 문제 텍스트 (박스 없이) */}
                        <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap mb-3">{currentQuestion.questionText || '(문제 텍스트 없음)'}</p>

                        {/* 결합형 공통 지문 */}
                        {(currentQuestion.passage || currentQuestion.passageImage || (currentQuestion.koreanAbcItems && currentQuestion.koreanAbcItems.length > 0)) && (
                          <div className="space-y-3 mb-4">
                            {/* 텍스트 형식 공통 지문 */}
                            {currentQuestion.passage && (!currentQuestion.passageType || currentQuestion.passageType === 'text') && (
                              <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A] rounded-lg">
                                <p className="text-[10px] text-[#5C5C5C] mb-1 font-bold">공통 제시문</p>
                                <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap">{currentQuestion.passage}</p>
                              </div>
                            )}

                            {/* ㄱㄴㄷ 형식 공통 지문 */}
                            {currentQuestion.passageType === 'korean_abc' && currentQuestion.koreanAbcItems && currentQuestion.koreanAbcItems.length > 0 && (
                              <div className="p-2 bg-[#F5F0E8] border border-[#1A1A1A] space-y-0.5 rounded-lg">
                                <p className="text-[10px] text-[#5C5C5C] mb-1 font-bold">제시문</p>
                                {/* 정적 ㄱㄴㄷ 제시문 — 순서 고정 */}
                                {currentQuestion.koreanAbcItems.filter(i => i.trim()).map((item, idx) => (
                                  <p key={`kabc-${idx}`} className="text-xs text-[#1A1A1A]">
                                    <span className="font-bold mr-1">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.</span>
                                    {item}
                                  </p>
                                ))}
                              </div>
                            )}

                            {/* 공통 이미지 */}
                            {currentQuestion.passageImage && (
                              <div className="relative overflow-hidden bg-[#F5F0E8] border border-[#1A1A1A] rounded-lg">
                                <p className="absolute top-2 left-2 text-xs text-[#5C5C5C] font-bold bg-[#F5F0E8]/80 px-2 py-0.5 z-10">공통 이미지</p>
                                <img
                                  src={currentQuestion.passageImage}
                                  alt="공통 이미지"
                                  className="w-full h-auto object-contain max-h-40"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* 혼합 보기 (grouped) */}
                        {hasValidMixedExamples && currentQuestion.mixedExamples!
                          .filter(item => item.type === 'grouped' && isValidMixedItem(item))
                          .map((item) => (
                            <div key={item.id} className="mb-2 p-2 bg-[#F5F0E8] border border-[#1A1A1A] space-y-1 rounded-lg">
                              {item.children?.filter(child => isValidMixedItem(child)).map((child) => (
                                <div key={child.id}>
                                  {child.type === 'text' && child.content && (
                                    <p className="text-[#5C5C5C] text-xs whitespace-pre-wrap">{child.content}</p>
                                  )}
                                  {child.type === 'labeled' && (
                                    <>
                                      {child.content && (
                                        <p className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">{child.label}.</span>{child.content}
                                        </p>
                                      )}
                                      {child.items?.map((labeledItem) => (
                                        <p key={`${child.id}-${labeledItem.label}`} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">{labeledItem.label}.</span>{labeledItem.content}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                  {child.type === 'gana' && (
                                    <>
                                      {child.content && (
                                        <p className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">({child.label})</span>{child.content}
                                        </p>
                                      )}
                                      {child.items?.map((labeledItem) => (
                                        <p key={`${child.id}-${labeledItem.label}`} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">({labeledItem.label})</span>{labeledItem.content}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                  {child.type === 'bullet' && (
                                    <>
                                      {child.content && (
                                        <p className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">◦</span>{child.content}
                                        </p>
                                      )}
                                      {child.items?.map((labeledItem, idx) => (
                                        <p key={`${child.id}-bullet-${idx}`} className="text-[#1A1A1A] text-xs">
                                          <span className="font-bold mr-1">◦</span>{labeledItem.content}
                                        </p>
                                      ))}
                                    </>
                                  )}
                                  {child.type === 'image' && child.imageUrl && (
                                    <img src={child.imageUrl} alt="제시문 이미지" className="w-full max-w-xs h-auto border border-[#1A1A1A] rounded-lg" />
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}

                        {/* 나머지 제시문 (grouped 제외) */}
                        {hasValidMixedExamples && currentQuestion.mixedExamples!
                          .filter(item => item.type !== 'grouped' && isValidMixedItem(item))
                          .map((item) => {
                            if (item.type === 'text') {
                              return (
                                <div key={item.id} className="mb-2 p-2 bg-[#F5F0E8] border border-[#1A1A1A] rounded-lg">
                                  <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap">{item.content}</p>
                                </div>
                              );
                            }
                            if (item.type === 'labeled') {
                              return (
                                <div key={item.id} className="mb-2 p-2 bg-[#F5F0E8] border border-[#1A1A1A] space-y-1 rounded-lg">
                                  {item.content && (
                                    <p className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">{item.label}.</span>{item.content}
                                    </p>
                                  )}
                                  {item.items?.map((labeledItem) => (
                                    <p key={`${item.id}-${labeledItem.label}`} className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">{labeledItem.label}.</span>{labeledItem.content}
                                    </p>
                                  ))}
                                </div>
                              );
                            }
                            if (item.type === 'gana') {
                              return (
                                <div key={item.id} className="mb-2 p-2 bg-[#F5F0E8] border border-[#1A1A1A] space-y-1 rounded-lg">
                                  {item.content && (
                                    <p className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">({item.label})</span>{item.content}
                                    </p>
                                  )}
                                  {item.items?.map((labeledItem) => (
                                    <p key={`${item.id}-${labeledItem.label}`} className="text-xs text-[#1A1A1A]">
                                      <span className="font-bold mr-1">({labeledItem.label})</span>{labeledItem.content}
                                    </p>
                                  ))}
                                </div>
                              );
                            }
                            return null;
                          })}

                        {/* 문제 이미지 */}
                        {currentQuestion.imageUrl && (
                          <div className="mb-2 overflow-hidden bg-[#F5F0E8] border border-[#1A1A1A] rounded-lg">
                            <img
                              src={currentQuestion.imageUrl}
                              alt="문제 이미지"
                              className="w-full h-auto object-contain max-h-32"
                            />
                          </div>
                        )}

                        {/* 보기 (<보기> 박스) */}
                        {currentQuestion.bogi && currentQuestion.bogi.items && currentQuestion.bogi.items.some(i => i.content?.trim()) && (
                          <div className="mb-2 p-2 bg-[#F5F0E8] border-2 border-[#1A1A1A] rounded-lg">
                            <div className="space-y-1">
                              {currentQuestion.bogi.items.filter(i => i.content?.trim()).map((item) => (
                                <p key={item.label} className="text-xs text-[#1A1A1A]">
                                  <span className="font-bold mr-1">{item.label}.</span>
                                  {item.content}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 발문 (제시문 발문 + 보기 발문) */}
                        {(currentQuestion.passagePrompt || currentQuestion.bogi?.questionText) && (
                          <p className="mb-2 text-xs text-[#1A1A1A]">
                            {currentQuestion.passagePrompt && currentQuestion.bogi?.questionText
                              ? `${currentQuestion.passagePrompt} ${currentQuestion.bogi.questionText}`
                              : currentQuestion.passagePrompt || currentQuestion.bogi?.questionText}
                          </p>
                        )}

                        {/* OX 선지 */}
                        {currentQuestion.questionType === 'ox' && (() => {
                          const oCount = currentQuestion.oxDistribution?.o || 0;
                          const xCount = currentQuestion.oxDistribution?.x || 0;
                          const totalSelections = oCount + xCount;

                          const correctAnswer = currentQuestion.correctAnswer?.toUpperCase() === 'O' ||
                            currentQuestion.correctAnswer === '0' ? 'O' : 'X';

                          const oPercentage = totalSelections > 0 ? Math.round((oCount / totalSelections) * 100) : 0;
                          const xPercentage = totalSelections > 0 ? Math.round((xCount / totalSelections) * 100) : 0;

                          return (
                            <div className="flex gap-3 justify-center py-2 mb-2">
                              {['O', 'X'].map((opt) => {
                                const isCorrect = opt === correctAnswer;
                                const percentage = opt === 'O' ? oPercentage : xPercentage;

                                return (
                                  <div
                                    key={opt}
                                    className={`relative w-16 h-16 text-2xl font-bold border-2 overflow-hidden ${
                                      isCorrect ? 'border-[#1A6B1A]' : 'border-[#8B1A1A]'
                                    }`}
                                    style={{ backgroundColor: '#EDEAE4' }}
                                  >
                                    {percentage > 0 && (
                                      <motion.div
                                        initial={{ height: 0 }}
                                        animate={{ height: `${percentage}%` }}
                                        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                                        className={`absolute left-0 right-0 bottom-0 ${isCorrect ? 'bg-[#E8F5E9]' : 'bg-[#FDEAEA]'}`}
                                      />
                                    )}
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                      <span className={`relative z-10 ${isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>{opt}</span>
                                      <span className={`relative z-10 text-[10px] font-normal ${isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>{percentage}%</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* 객관식 선지 */}
                        {currentQuestion.questionType === 'multiple' && currentQuestion.optionDistribution && (() => {
                          const wrongOptions = currentQuestion.optionDistribution.filter(o => !o.isCorrect);
                          const maxWrongPercentage = wrongOptions.length > 0
                            ? Math.max(...wrongOptions.map(o => o.percentage))
                            : 0;
                          const choiceExpls = currentQuestion.choiceExplanations;

                          return (
                            <div className="space-y-1 mb-2">
                              {currentQuestion.optionDistribution.map((opt, optIdx) => {
                                const isHighestWrong = !opt.isCorrect && opt.percentage === maxWrongPercentage && maxWrongPercentage > 0;
                                const choiceExpl = choiceExpls?.[optIdx];

                                return (
                                  <div key={`dist-${optIdx}`}>
                                    <div
                                      className={`relative flex items-center gap-2 px-2 py-1.5 border overflow-hidden ${
                                        opt.isCorrect ? 'border-[#1A6B1A]' : isHighestWrong ? 'border-[#8B1A1A]' : 'border-[#D4CFC4]'
                                      }`}
                                      style={{ backgroundColor: '#F5F0E8' }}
                                    >
                                      {opt.percentage > 0 && (
                                        <motion.div
                                          initial={{ width: 0 }}
                                          animate={{ width: `${opt.percentage}%` }}
                                          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 + optIdx * 0.05 }}
                                          className={`absolute left-0 top-0 bottom-0 ${opt.isCorrect ? 'bg-[#E8F5E9]' : 'bg-[#FDEAEA]'}`}
                                        />
                                      )}
                                      <span className={`relative z-10 text-xs font-bold min-w-[18px] ${
                                        opt.isCorrect ? 'text-[#1A6B1A]' : isHighestWrong ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'
                                      }`}>
                                        {optIdx + 1}.
                                      </span>
                                      <span className="relative z-10 flex-1 text-xs text-[#1A1A1A]">{opt.option}</span>
                                      <span className={`relative z-10 text-xs font-bold ${
                                        opt.isCorrect ? 'text-[#1A6B1A]' : isHighestWrong ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'
                                      }`}>
                                        {opt.percentage}%
                                      </span>
                                    </div>
                                    {isProfessor && choiceExpl && (
                                      <p className="mt-0.5 ml-2 text-[10px] text-[#5C5C5C] italic">{choiceExpl}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* 주관식 */}
                        {(currentQuestion.questionType === 'short_answer' || currentQuestion.questionType === 'short') && (
                          <div className="space-y-1.5 mb-2">
                            <div className="p-2 bg-[#E8F5E9] border border-[#1A6B1A]">
                              <span className="text-xs text-[#1A6B1A] font-bold">정답: </span>
                              <span className="text-xs text-[#1A6B1A]">
                                {currentQuestion.correctAnswer?.includes('|||')
                                  ? currentQuestion.correctAnswer.split('|||').map(a => a.trim()).join(', ')
                                  : currentQuestion.correctAnswer || '-'}
                              </span>
                            </div>
                            {currentQuestion.wrongAnswers && currentQuestion.wrongAnswers.length > 0 && (
                              <div className="p-2 bg-[#FDEAEA] border border-[#8B1A1A]">
                                <span className="text-xs text-[#8B1A1A] font-bold">오답: </span>
                                <span className="text-xs text-[#8B1A1A]">
                                  {currentQuestion.wrongAnswers.slice(0, 5).map(w => w.answer).join(', ')}
                                  {currentQuestion.wrongAnswers.length > 5 && ` 외 ${currentQuestion.wrongAnswers.length - 5}개`}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 해설 — 교수님만 표시 */}
                        {isProfessor && (
                          <div className="mt-2 p-2 border border-dashed border-[#A0A0A0] bg-[#FDFBF7]">
                            <p className="text-[10px] font-bold text-[#5C5C5C] mb-0.5">해설</p>
                            {currentQuestion.explanation ? (
                              <p className="text-xs text-[#1A1A1A] whitespace-pre-wrap">{currentQuestion.explanation}</p>
                            ) : (
                              <p className="text-xs text-[#A0A0A0] italic">해설 없음</p>
                            )}
                          </div>
                        )}

                      </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

    </div>
  );

  // sub-modal (statsContent 밖에서 렌더)
  const subModals = (
    <>
      <StatsQuizFeedbackModal
        isOpen={showFeedbackModal}
        onClose={() => { setShowFeedbackModal(false); setFeedbackQuestionNum(0); }}
        feedbackList={classFilteredFeedbacks}
        loading={feedbackLoading}
        questionNum={feedbackQuestionNum}
        classFilter={classFilter}
        quizTitle={quizTitle}
        sourceRect={feedbackSourceRect}
        getFeedbackQuestionNum={getFeedbackQuestionNum}
        isPanelMode={isPanelMode}
      />
      <StatsEssayAnswersModal
        isOpen={showEssayModal}
        onClose={() => setShowEssayModal(false)}
        essayAnswers={currentQuestion?.essayAnswers || []}
        userClassCache={_statsUserClassCache}
        userNameCache={_statsUserNameCache}
      />
      <FolderSelectModal
        isOpen={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        onSelect={handleFolderSelect}
        folders={customFolders}
        onCreateFolder={createCustomFolder}
      />
      <AnimatePresence>
        {folderSaveToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`${isPanelMode ? 'absolute' : 'fixed'} top-6 left-0 right-0 mx-auto w-fit z-[110] px-4 py-2 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold rounded-lg`}
          >
            {folderSaveToast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  // 패널 모드: 래퍼 없이 직접 렌더 (isOpen일 때만)
  if (isPanelMode) return isOpen ? <>{statsContent}{subModals}</> : null;

  // 모달 모드: AnimatePresence + backdrop + 요술지니 애니메이션
  return (
    <AnimatePresence>
    {isOpen && (
    <>
    <motion.div
      key="stats-safe-cover"
      className="fixed inset-0 z-[100] pointer-events-none"
      style={{ left: 'var(--modal-left, 0px)', right: 'var(--modal-right, 0px)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="absolute inset-0 bg-black/50" style={{ bottom: 'calc(-1 * env(safe-area-inset-bottom, 0px))' }} />
    </motion.div>
    <motion.div
      key="stats-modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden overscroll-none"
      style={{
        left: 'var(--modal-left, 0px)',
        right: 'var(--modal-right, 0px)',
        padding: '1rem',
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.05, x: genieOffset.dx, y: genieOffset.dy }}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, scale: 0.05, x: genieOffset.dx, y: genieOffset.dy }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        {statsContent}
      </motion.div>
    </motion.div>
    {subModals}
    </>
    )}
    </AnimatePresence>
  );
}
