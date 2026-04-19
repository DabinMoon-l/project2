'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  doc,
  getDoc,
  collection,
  addDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  db,
  type DocumentData,
} from '@/lib/repositories';
import { useAuth } from '@/lib/hooks/useAuth';
import { useThemeColors } from '@/styles/themes/useTheme';
import { useDetailPanel, useClosePanel } from '@/lib/contexts';
import { useQuizDraft, useAutoSaveQuizDraft } from '@/lib/hooks/useQuizDraft';
import { useSessionState } from '@/lib/hooks/useSessionState';
import { Skeleton } from '@/components/common';

/** Firestore 퀴즈 문제 문서 타입 */
type FirestoreQuestionDoc = DocumentData;

// 퀴즈 풀이 관련 컴포넌트
import QuizHeader from '@/components/quiz/QuizHeader';
import QuestionCard, { Question, QuestionType } from '@/components/quiz/QuestionCard';
import OXChoice, { OXAnswer } from '@/components/quiz/OXChoice';
import MultipleChoice from '@/components/quiz/MultipleChoice';
import ShortAnswer from '@/components/quiz/ShortAnswer';
import QuizNavigation from '@/components/quiz/QuizNavigation';
import ExitConfirmModal from '@/components/quiz/ExitConfirmModal';
import CombinedQuestionGroup from '@/components/quiz/CombinedQuestionGroup';
import { FeedbackIcon, InlineFeedbackPanel } from '@/components/common/InlineFeedback';

/**
 * 화면에 표시될 아이템 타입 (단일 문제 또는 결합형 그룹)
 */
interface DisplayItem {
  type: 'single' | 'combined_group';
  /** 단일 문제 (type === 'single'일 때) */
  question?: Question;
  /** 결합형 그룹 문제들 (type === 'combined_group'일 때) */
  questions?: Question[];
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  /** 화면에 표시될 번호 */
  displayNumber: number;
}

/**
 * 퀴즈 데이터 타입
 */
interface QuizData {
  id: string;
  title: string;
  questions: Question[];
  /** 화면에 표시될 아이템들 (결합형 그룹 처리) */
  displayItems: DisplayItem[];
  /** 과목 ID */
  courseId?: string;
  /** 퀴즈 생성자 ID */
  creatorId?: string;
  /** 퀴즈 타입 (ai-generated 등) */
  quizType?: string;
}

/**
 * 답안 타입 (문제 유형별 다른 타입)
 * - OX: 'O' | 'X'
 * - 객관식 단일: number (선택된 인덱스)
 * - 객관식 복수: number[] (선택된 인덱스 배열)
 * - 주관식: string
 */
type Answer = OXAnswer | number | number[] | string | null;

/**
 * 퀴즈 풀이 페이지
 *
 * 퀴즈 문제를 순차적으로 풀고 제출하는 페이지입니다.
 * - 문제 유형에 따라 OX, 객관식, 주관식 선지를 표시
 * - 선택한 답을 로컬 상태로 유지
 * - 페이지 새로고침/이탈 방지
 * - 진행 상황 저장/불러오기 지원
 * - 제출 시 서버에서 채점 후 결과 페이지로 이동
 */
export default function QuizPage({ panelQuizId, onPanelNavigate }: { panelQuizId?: string; onPanelNavigate?: (path: string) => void } = {}) {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const colors = useThemeColors();
  const quizId = panelQuizId || (params?.id as string);
  const isPanelMode = !!panelQuizId;
  const closePanel = useClosePanel();

  // 퀴즈 풀이 페이지: data-main-content의 paddingTop 제거 (헤더가 직접 처리)
  // 패널 모드에서는 스킵 (3쪽 안에서 동작)
  useEffect(() => {
    if (isPanelMode) return;
    const el = document.querySelector('[data-main-content]') as HTMLElement | null;
    if (el) el.style.paddingTop = '0px';
    return () => { if (el) el.style.paddingTop = ''; };
  }, [isPanelMode]);

  // 최초 진입 시에만 슬라이드 애니메이션 (뒤로가기 시 재발동 방지)
  const [slideIn] = useState(() => {
    if (typeof window === 'undefined') return false;
    const key = `visited_quiz_${quizId}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  });

  // 퀴즈 데이터 상태
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 퀴즈 풀이 상태
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 바로 채점 상태
  const [submittedQuestions, setSubmittedQuestions] = useState<Set<string>>(new Set());
  const [gradeResults, setGradeResults] = useState<Record<string, { isCorrect: boolean; correctAnswer: string }>>({});
  // 선지별 해설 아코디언 상태 — cold reload에도 유지
  const [expandedChoiceIdx, setExpandedChoiceIdx] = useSessionState<number | null>(
    `quiz-play-expChoice:${quizId}`,
    null,
  );

  // 저장된 진행 상황 ID
  const [progressId, setProgressId] = useState<string | null>(null);

  // 모달 상태
  const [showExitModal, setShowExitModal] = useState(false);

  // 인라인 피드백 상태
  const [inlineFeedbackOpen, setInlineFeedbackOpen] = useState<string | null>(null); // 열린 문제 ID
  const [inlineFeedbackSubmitted, setInlineFeedbackSubmitted] = useState<Set<string>>(new Set());

  // 이전 진행상황 복원 모달
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [savedProgress, setSavedProgress] = useState<{
    id: string;
    answers: Record<string, Answer>;
    currentQuestionIndex: number;
    answeredCount: number;
    submittedQuestions: string[];
    gradeResults: Record<string, { isCorrect: boolean; correctAnswer: string }>;
  } | null>(null);

  // localStorage 기반 draft (PWA eviction 대응)
  const quizDraft = useQuizDraft<Answer, { isCorrect: boolean; correctAnswer: string }>(
    user?.uid,
    quizId,
  );
  // 로컬 draft 복원 1회 트리거 플래그
  const [localDraftChecked, setLocalDraftChecked] = useState(false);

  // 퀴즈 로드 완료 + Firestore resume modal 없음 + 아직 답변 없음일 때 로컬 draft 복원
  useEffect(() => {
    if (localDraftChecked) return;
    if (!quiz || !user?.uid) return;
    if (showResumeModal) return; // Firestore resume 우선
    if (Object.values(answers).some(a => a !== null && a !== '' && !(Array.isArray(a) && a.length === 0))) return;

    const draft = quizDraft.load();
    if (!draft) {
      setLocalDraftChecked(true);
      return;
    }
    // 복원
    setAnswers(draft.answers);
    setCurrentQuestionIndex(draft.currentQuestionIndex || 0);
    if (Array.isArray(draft.submittedQuestions) && draft.submittedQuestions.length > 0) {
      setSubmittedQuestions(new Set(draft.submittedQuestions));
    }
    if (draft.gradeResults && Object.keys(draft.gradeResults).length > 0) {
      setGradeResults(draft.gradeResults);
    }
    setLocalDraftChecked(true);
  }, [quiz, user?.uid, showResumeModal, answers, quizDraft, localDraftChecked]);

  // 답안/진행 상태 변경 시 debounced localStorage 저장
  useAutoSaveQuizDraft({
    enabled: !!quiz && !!user?.uid && !isSubmitting && !showResumeModal,
    userId: user?.uid,
    quizId,
    answers,
    currentQuestionIndex,
    submittedQuestions,
    gradeResults,
  });

  // 현재 표시 아이템 (단일 문제 또는 결합형 그룹)
  const currentDisplayItem = useMemo(
    () => quiz?.displayItems[currentQuestionIndex] || null,
    [quiz, currentQuestionIndex]
  );

  // 현재 문제 (단일 문제일 때만 사용, 결합형은 displayItem.questions 사용)
  const currentQuestion = useMemo(
    () => currentDisplayItem?.type === 'single' ? currentDisplayItem.question || null : null,
    [currentDisplayItem]
  );

  // 답변한 문제 수
  const answeredCount = useMemo(() => {
    return Object.values(answers).filter((answer) => {
      if (answer === null || answer === '') return false;
      if (Array.isArray(answer) && answer.length === 0) return false;
      return true;
    }).length;
  }, [answers]);

  // 현재 화면에서 답변 완료 여부 확인 (Hook 순서 보장을 위해 조기 return 전에 선언)
  const isCurrentItemAnswered = useMemo(() => {
    if (!currentDisplayItem) return false;

    if (currentDisplayItem.type === 'single' && currentDisplayItem.question) {
      const answer = answers[currentDisplayItem.question.id];
      if (answer === null || answer === '') return false;
      if (Array.isArray(answer) && answer.length === 0) return false;
      return true;
    }

    if (currentDisplayItem.type === 'combined_group' && currentDisplayItem.questions) {
      // 결합형 그룹: 모든 하위 문제에 답변해야 함
      return currentDisplayItem.questions.every((q) => {
        const answer = answers[q.id];
        if (answer === null || answer === '') return false;
        if (Array.isArray(answer) && answer.length === 0) return false;
        return true;
      });
    }

    return false;
  }, [currentDisplayItem, answers]);

  /**
   * 저장된 진행 상황 불러오기
   */
  const loadSavedProgress = useCallback(async () => {
    if (!user || !quizId) return null;

    try {
      const progressQuery = query(
        collection(db, 'quizProgress'),
        where('userId', '==', user.uid),
        where('quizId', '==', quizId)
      );
      const snapshot = await getDocs(progressQuery);

      if (!snapshot.empty) {
        const progressDoc = snapshot.docs[0];
        const data = progressDoc.data();
        return {
          id: progressDoc.id,
          answers: data.answers || {},
          currentQuestionIndex: data.currentQuestionIndex || 0,
          submittedQuestions: data.submittedQuestions || [],
          gradeResults: data.gradeResults || {},
        };
      }
    } catch (err) {
      console.error('진행 상황 불러오기 실패:', err);
    }

    return null;
  }, [user, quizId]);

  /**
   * 퀴즈 데이터 로드
   */
  const fetchQuiz = useCallback(async () => {
    if (!quizId || !user) return;

    try {
      setIsLoading(true);
      setError(null);

      // 퀴즈 기본 정보 조회
      const quizRef = doc(db, 'quizzes', quizId);
      const quizDoc = await getDoc(quizRef);

      if (!quizDoc.exists()) {
        setError('퀴즈를 찾을 수 없습니다.');
        return;
      }

      const quizData = quizDoc.data();

      // 비공개 퀴즈 접근 차단 (본인 퀴즈는 허용)
      if (quizData.creatorId !== user.uid && quizData.creatorUid !== user.uid) {
        if (quizData.isPublished === false || quizData.isPublic === false) {
          setError('이 퀴즈는 현재 비공개 상태입니다.');
          return;
        }
      }

      // 이미 완료한 퀴즈인지 확인 (중복 제출 방지)
      const completionDocId = `${quizId}_${user.uid}`;
      const completionDoc = await getDoc(doc(db, 'quiz_completions', completionDocId));
      if (completionDoc.exists()) {
        // 이미 풀었으면 복습 페이지로 리다이렉트
        router.replace(`/review/quiz/${quizId}`);
        return;
      }

      // 문제 목록 - 퀴즈 문서 내부의 questions 배열에서 가져옴
      const questionsData = quizData.questions || [];
      const questions: Question[] = [];
      let questionNumber = 0;

      console.log('[QuizPage] 원본 문제 데이터:', questionsData);

      questionsData.forEach((q: FirestoreQuestionDoc, index: number) => {
        console.log(`[QuizPage] 문제 ${index + 1}:`, {
          type: q.type,
          combinedGroupId: q.combinedGroupId,
          combinedIndex: q.combinedIndex,
          combinedTotal: q.combinedTotal,
          hasSubQuestions: !!q.subQuestions,
          subQuestionsLength: q.subQuestions?.length,
          passageType: q.passageType,
          hasPassage: !!q.passage,
          hasPassageImage: !!q.passageImage,
        });

        // 새로운 구조: combinedGroupId가 있으면 이미 펼쳐진 결합형 문제
        if (q.combinedGroupId) {
          questionNumber++;

          // 복수정답 여부 확인
          const answerStr = q.answer?.toString() || '';
          const hasMultipleAnswers = q.type === 'multiple' && answerStr.includes(',');

          // 문제 유형 매핑
          let mappedType: QuestionType = (q.type || 'multiple') as QuestionType;
          if (q.type === 'subjective' || q.type === 'short_answer') {
            mappedType = 'short';
          }

          const questionData: Question = {
            id: q.id || `q${index}`,
            number: questionNumber,
            type: mappedType,
            text: q.text || '',
            imageUrl: q.imageUrl || undefined,
            choices: q.choices || undefined,
            examples: q.examples || undefined,
            mixedExamples: q.passageBlocks || q.mixedExamples || undefined,
            hasMultipleAnswers,
            // 결합형 그룹 정보 추가
            combinedGroupId: q.combinedGroupId,
            combinedIndex: q.combinedIndex,
            combinedTotal: q.combinedTotal,
            // 발문 정보 추가
            passagePrompt: q.passagePrompt || undefined,
            bogi: q.bogi || undefined,
            // 챕터 정보 추가
            chapterId: q.chapterId || undefined,
            chapterDetailId: q.chapterDetailId || undefined,
            // 채점용 필드
            answer: q.answer,
            explanation: q.explanation || undefined,
            choiceExplanations: q.choiceExplanations || undefined,
          };

          // 첫 번째 하위 문제 (combinedIndex === 0)에만 공통 지문 정보 표시
          if (q.combinedIndex === 0) {
            questionData.passageType = q.passageType || 'text';
            questionData.passage = q.passage || undefined;
            questionData.passageImage = q.passageImage || undefined;
            questionData.koreanAbcItems = q.koreanAbcItems || undefined;
            questionData.passageMixedExamples = q.passageMixedExamples || undefined;
            questionData.commonQuestion = q.commonQuestion || undefined;

            console.log('[QuizPage] 결합형 공통 지문 정보:', {
              passageType: questionData.passageType,
              passage: questionData.passage?.substring(0, 50),
              hasPassageImage: !!questionData.passageImage,
              koreanAbcItems: questionData.koreanAbcItems,
              hasPassageMixedExamples: !!questionData.passageMixedExamples,
              combinedGroupId: q.combinedGroupId,
              commonQuestion: questionData.commonQuestion?.substring(0, 50),
            });
          }

          questions.push(questionData);
        }
        // 기존 구조: type === 'combined'이고 subQuestions가 있는 경우 (하위 호환)
        else if (q.type === 'combined') {
          const subQuestions = q.subQuestions || [];

          if (subQuestions.length > 0) {
            const legacyCombinedGroupId = `legacy_combined_${index}`;

            subQuestions.forEach((sq: FirestoreQuestionDoc, sqIndex: number) => {
              questionNumber++;
              // 복수정답 여부 확인
              const hasMultipleAnswers = sq.type === 'multiple' &&
                (sq.answerIndices?.length > 1 || false);

              // 문제 유형 매핑
              let mappedType: QuestionType = (sq.type || 'multiple') as QuestionType;
              if (sq.type === 'subjective' || sq.type === 'short_answer') {
                mappedType = 'short';
              }

              const questionData: Question = {
                id: sq.id || `q${index}_sub${sqIndex}`,
                number: questionNumber,
                type: mappedType,
                text: sq.text || '',
                imageUrl: sq.imageUrl || undefined,
                choices: sq.choices || undefined,
                examples: sq.examples || undefined,
                mixedExamples: sq.passageBlocks || sq.mixedExamples || undefined,
                hasMultipleAnswers,
                // 결합형 그룹 정보 추가 (하위 호환)
                combinedGroupId: legacyCombinedGroupId,
                combinedIndex: sqIndex,
                combinedTotal: subQuestions.length,
                // 발문 정보 추가
                passagePrompt: sq.passagePrompt || undefined,
                bogi: sq.bogi || undefined,
                // 챕터 정보 추가
                chapterId: q.chapterId || undefined,
                chapterDetailId: q.chapterDetailId || undefined,
                // 채점용 필드
                answer: sq.answer,
                explanation: sq.explanation || undefined,
                choiceExplanations: sq.choiceExplanations || undefined,
              };

              // 첫 번째 하위 문제에만 공통 지문 정보 표시
              if (sqIndex === 0) {
                questionData.passageType = q.passageType || 'text';
                questionData.passage = q.passage || undefined;
                questionData.passageImage = q.passageImage || undefined;
                questionData.koreanAbcItems = q.koreanAbcItems || undefined;
                questionData.passageMixedExamples = q.passageMixedExamples || undefined;
                questionData.commonQuestion = q.commonQuestion || undefined;

                console.log('[QuizPage] 결합형 공통 지문 정보 (레거시):', {
                  passageType: questionData.passageType,
                  passage: questionData.passage?.substring(0, 50),
                  hasPassageImage: !!questionData.passageImage,
                  koreanAbcItems: questionData.koreanAbcItems,
                  hasPassageMixedExamples: !!questionData.passageMixedExamples,
                  commonQuestion: questionData.commonQuestion?.substring(0, 50),
                });
              }

              questions.push(questionData);
            });
          } else {
            // 하위 문제가 없는 결합형 문제 (예외 처리)
            questionNumber++;
            questions.push({
              id: q.id || `q${index}`,
              number: questionNumber,
              type: 'combined' as QuestionType,
              text: q.text || '(하위 문제가 없습니다)',
              passageType: q.passageType || 'text',
              passage: q.passage || undefined,
              passageImage: q.passageImage || undefined,
              koreanAbcItems: q.koreanAbcItems || undefined,
              passageMixedExamples: q.passageMixedExamples || undefined,
              commonQuestion: q.commonQuestion || undefined,
              chapterId: q.chapterId || undefined,
              chapterDetailId: q.chapterDetailId || undefined,
            });
          }
        } else {
          questionNumber++;
          // 복수정답 여부 확인 (answer가 쉼표를 포함하면 복수정답)
          const answerStr = q.answer?.toString() || '';
          const hasMultipleAnswers = q.type === 'multiple' && answerStr.includes(',');

          // 문제 유형 매핑 (subjective, short_answer -> short)
          let mappedType: QuestionType = (q.type || 'multiple') as QuestionType;
          if (q.type === 'subjective' || q.type === 'short_answer') {
            mappedType = 'short';
          }

          questions.push({
            id: q.id || `q${index}`,
            number: questionNumber,
            type: mappedType,
            text: q.text || '',
            imageUrl: q.imageUrl || undefined,
            choices: q.choices || undefined,
            examples: q.examples || undefined,
            mixedExamples: q.passageBlocks || q.mixedExamples || undefined,
            hasMultipleAnswers,
            // 발문 정보 추가
            passagePrompt: q.passagePrompt || undefined,
            bogi: q.bogi || undefined,
            // 챕터 정보 추가
            chapterId: q.chapterId || undefined,
            chapterDetailId: q.chapterDetailId || undefined,
            // 채점용 필드
            answer: q.answer,
            explanation: q.explanation || undefined,
            choiceExplanations: q.choiceExplanations || undefined,
          });
        }
      });

      console.log('[QuizPage] 변환된 문제 목록:', questions.map(q => ({
        id: q.id,
        number: q.number,
        type: q.type,
        hasPassage: !!q.passage || !!q.passageImage,
        combinedGroupId: q.combinedGroupId,
      })));

      // 문제 번호순 정렬
      questions.sort((a, b) => a.number - b.number);

      // 문제가 없으면 에러
      if (questions.length === 0) {
        setError('퀴즈에 문제가 없습니다.');
        return;
      }

      // displayItems 생성: 결합형 그룹을 하나의 화면으로 묶기
      const displayItems: DisplayItem[] = [];
      const processedGroupIds = new Set<string>();
      let displayNumber = 0;

      questions.forEach((question) => {
        if (question.combinedGroupId) {
          // 이미 처리된 그룹이면 스킵
          if (processedGroupIds.has(question.combinedGroupId)) {
            return;
          }
          processedGroupIds.add(question.combinedGroupId);

          // 같은 그룹의 모든 문제 찾기
          const groupQuestions = questions.filter(
            (q) => q.combinedGroupId === question.combinedGroupId
          );

          displayNumber++;
          displayItems.push({
            type: 'combined_group',
            questions: groupQuestions,
            combinedGroupId: question.combinedGroupId,
            displayNumber,
          });
        } else {
          // 일반 문제
          displayNumber++;
          displayItems.push({
            type: 'single',
            question,
            displayNumber,
          });
        }
      });

      console.log('[QuizPage] displayItems:', displayItems.map(item => ({
        type: item.type,
        displayNumber: item.displayNumber,
        questionCount: item.type === 'combined_group' ? item.questions?.length : 1,
      })));

      setQuiz({
        id: quizId,
        title: quizData.title || '퀴즈',
        questions,
        displayItems,
        courseId: quizData.courseId || undefined,
        creatorId: quizData.creatorId || undefined,
        quizType: quizData.type || undefined,
      });

      // 저장된 진행 상황 확인
      const loadedProgress = await loadSavedProgress();

      if (loadedProgress) {
        // 진행상황이 있으면 답변 개수 계산
        const answeredCount = Object.values(loadedProgress.answers).filter(
          (answer) => answer !== null && answer !== ''
        ).length;

        // 저장된 진행상황 정보 저장 및 모달 표시
        setSavedProgress({
          ...loadedProgress,
          answeredCount,
        });
        setShowResumeModal(true);

        // 초기 상태는 빈 상태로 설정 (모달에서 선택 후 적용)
        const initialAnswers: Record<string, Answer> = {};
        questions.forEach((q) => {
          initialAnswers[q.id] = null;
        });
        setAnswers(initialAnswers);
      } else {
        // 초기 답안 상태 설정
        const initialAnswers: Record<string, Answer> = {};
        questions.forEach((q) => {
          initialAnswers[q.id] = null;
        });
        setAnswers(initialAnswers);
      }
    } catch (err: unknown) {
      console.error('퀴즈 로드 실패:', err);
      console.error('에러 코드:', (err as { code?: string })?.code);
      console.error('에러 메시지:', (err as Error)?.message);
      setError('퀴즈를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [quizId, user, loadSavedProgress]);

  // 퀴즈 데이터 로드
  useEffect(() => {
    fetchQuiz();
  }, [fetchQuiz]);

  // 페이지 이탈 방지
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (answeredCount > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [answeredCount]);

  /**
   * 답안 변경 핸들러
   */
  const handleAnswerChange = useCallback((questionId: string, answer: Answer) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: answer,
    }));
  }, []);

  /**
   * 현재 화면의 문제들을 로컬 채점
   */
  const handleGradeCurrentItem = useCallback(() => {
    if (!currentDisplayItem) return;

    const questionsToGrade = currentDisplayItem.type === 'single' && currentDisplayItem.question
      ? [currentDisplayItem.question]
      : currentDisplayItem.questions || [];

    const newResults: Record<string, { isCorrect: boolean; correctAnswer: string }> = {};
    const newSubmitted = new Set(submittedQuestions);

    for (const q of questionsToGrade) {
      newSubmitted.add(q.id);

      if (q.type === 'essay') {
        // 서술형은 수동 채점이므로 오답 처리
        newResults[q.id] = { isCorrect: false, correctAnswer: '' };
        continue;
      }

      const userAns = answers[q.id];
      const correctAns = q.answer;

      if (q.type === 'ox') {
        const isO = correctAns === 0 || correctAns === 'O' || correctAns === 'o';
        const correctStr = isO ? 'O' : 'X';
        const userStr = userAns === 'O' ? 'O' : userAns === 'X' ? 'X' : '';
        newResults[q.id] = { isCorrect: correctStr === userStr, correctAnswer: correctStr };
      } else if (q.type === 'multiple') {
        if (Array.isArray(correctAns) && correctAns.length > 1) {
          // 복수정답 (2개 이상)
          const userSorted = Array.isArray(userAns)
            ? [...userAns].map(Number).sort()
            : [];
          const correctSorted = [...correctAns].map(Number).sort();
          newResults[q.id] = {
            isCorrect: JSON.stringify(userSorted) === JSON.stringify(correctSorted),
            correctAnswer: correctAns.map((a: number) => `${Number(a) + 1}번`).join(', '),
          };
        } else {
          // 단일정답 — 서버(gradeQuestion)와 동일한 Number() 강제변환
          const correctNum = Number(Array.isArray(correctAns) ? correctAns[0] : correctAns);
          const userNum = Number(userAns);
          if (process.env.NODE_ENV === 'development' && userNum === correctNum && userAns !== correctNum) {
            console.warn('[채점 타입 불일치]', q.id, { userAns, correctAns, userType: typeof userAns, correctType: typeof correctAns });
          }
          newResults[q.id] = {
            isCorrect: userNum === correctNum,
            correctAnswer: `${correctNum + 1}번`,
          };
        }
      } else {
        // short_answer, short
        const correctStr = String(correctAns ?? '');
        const userStr = String(userAns ?? '');
        const accepted = correctStr.split('|||').map(s => s.trim().toLowerCase());
        newResults[q.id] = {
          isCorrect: accepted.includes(userStr.trim().toLowerCase()),
          correctAnswer: correctStr.replace(/\|\|\|/g, ' 또는 '),
        };
      }
    }

    setSubmittedQuestions(newSubmitted);
    setGradeResults(prev => ({ ...prev, ...newResults }));
    setExpandedChoiceIdx(null);
  }, [currentDisplayItem, answers, submittedQuestions]);

  // 현재 화면의 모든 문제가 제출(채점)되었는지
  const isCurrentItemSubmitted = useMemo(() => {
    if (!currentDisplayItem) return false;
    if (currentDisplayItem.type === 'single' && currentDisplayItem.question) {
      return submittedQuestions.has(currentDisplayItem.question.id);
    }
    if (currentDisplayItem.type === 'combined_group' && currentDisplayItem.questions) {
      return currentDisplayItem.questions.every(q => submittedQuestions.has(q.id));
    }
    return false;
  }, [currentDisplayItem, submittedQuestions]);

  /**
   * 이전 문제로 이동
   */
  const handlePrev = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
      setExpandedChoiceIdx(null);
    }
  }, [currentQuestionIndex]);

  /**
   * 다음 문제로 이동
   */
  const handleNext = useCallback(() => {
    if (quiz && currentQuestionIndex < quiz.displayItems.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      setExpandedChoiceIdx(null);
    }
  }, [quiz, currentQuestionIndex]);

  /**
   * 진행 상황 저장
   */
  const saveProgress = useCallback(async () => {
    if (!user || !quizId) return;

    try {
      setIsSaving(true);

      const progressData = {
        userId: user.uid,
        quizId,
        answers,
        currentQuestionIndex,
        // 채점 결과도 저장 (바로 채점 모드에서 복원 시 필요)
        submittedQuestions: Array.from(submittedQuestions),
        gradeResults,
        updatedAt: serverTimestamp(),
      };

      if (progressId) {
        // 기존 진행 상황 업데이트
        await setDoc(doc(db, 'quizProgress', progressId), progressData);
      } else {
        // 새 진행 상황 저장
        const docRef = await addDoc(collection(db, 'quizProgress'), {
          ...progressData,
          createdAt: serverTimestamp(),
        });
        setProgressId(docRef.id);
      }

      return true;
    } catch (err) {
      console.error('진행 상황 저장 실패:', err);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [user, quizId, answers, currentQuestionIndex, progressId, submittedQuestions, gradeResults]);

  /**
   * 진행 상황 삭제
   */
  const deleteProgress = useCallback(async () => {
    if (!progressId) return;

    try {
      await deleteDoc(doc(db, 'quizProgress', progressId));
      setProgressId(null);
    } catch (err) {
      console.error('진행 상황 삭제 실패:', err);
    }
  }, [progressId]);

  /**
   * 퀴즈 제출
   */
  const handleSubmit = useCallback(async () => {
    if (!quiz || !user || isSubmitting) return;

    try {
      setIsSubmitting(true);

      // 문제 순서대로 답안 배열 생성
      const orderedAnswers = quiz.questions.map((q) => {
        const answer = answers[q.id];
        // 답안 타입에 따라 적절한 형태로 변환
        if (answer === null || answer === undefined) return '';

        // 객관식 답안 처리: 0-indexed 그대로 저장
        if (q.type === 'multiple') {
          if (Array.isArray(answer)) {
            return answer.join(',');
          } else if (typeof answer === 'number') {
            return answer.toString();
          }
        }

        return answer.toString();
      });

      // 답안을 localStorage에 저장 (결과 페이지에서 사용)
      localStorage.setItem(`quiz_answers_${quizId}`, JSON.stringify(orderedAnswers));
      localStorage.setItem(`quiz_time_${quizId}`, '0'); // 시간 측정은 나중에 구현

      // 저장된 진행 상황 삭제 (Firestore + 로컬 draft)
      await deleteProgress();
      quizDraft.clear();

      // 결과 페이지로 이동
      if (onPanelNavigate) { onPanelNavigate(`/quiz/${quizId}/result`); return; }
      router.push(`/quiz/${quizId}/result`);
    } catch (err) {
      console.error('퀴즈 제출 실패:', err);
      alert('제출에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  }, [quiz, user, answers, isSubmitting, quizId, router, deleteProgress, quizDraft]);

  /**
   * 이전 진행상황 이어서 하기
   */
  const handleResume = useCallback(() => {
    if (savedProgress) {
      setProgressId(savedProgress.id);
      setAnswers(savedProgress.answers);
      setCurrentQuestionIndex(savedProgress.currentQuestionIndex);
      // 채점 결과 복원 (바로 채점 모드)
      if (savedProgress.submittedQuestions.length > 0) {
        setSubmittedQuestions(new Set(savedProgress.submittedQuestions));
      }
      if (Object.keys(savedProgress.gradeResults).length > 0) {
        setGradeResults(savedProgress.gradeResults);
      }
    }
    setShowResumeModal(false);
    setSavedProgress(null);
  }, [savedProgress]);

  /**
   * 처음부터 다시 하기
   */
  const handleStartFresh = useCallback(async () => {
    // 기존 저장된 진행상황 삭제 (Firestore + 로컬 draft)
    if (savedProgress) {
      try {
        await deleteDoc(doc(db, 'quizProgress', savedProgress.id));
      } catch (err) {
        console.error('진행상황 삭제 실패:', err);
      }
    }
    quizDraft.clear();
    setShowResumeModal(false);
    setSavedProgress(null);
    setProgressId(null);
    setCurrentQuestionIndex(0);
  }, [savedProgress, quizDraft]);

  /**
   * 저장하고 나가기
   */
  const handleSaveAndExit = useCallback(async () => {
    const success = await saveProgress();
    if (success) {
      if (onPanelNavigate) { onPanelNavigate('/quiz'); return; }
      if (isPanelMode) { closePanel(); return; }
      router.push('/quiz');
    } else {
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    }
  }, [saveProgress, router, isPanelMode, closePanel, onPanelNavigate]);

  /**
   * 저장하지 않고 나가기 (기존 저장된 진행상황도 삭제)
   */
  const handleExitWithoutSave = useCallback(async () => {
    await deleteProgress();
    quizDraft.clear();
    if (onPanelNavigate) { onPanelNavigate('/quiz'); return; }
    if (isPanelMode) { closePanel(); return; }
    router.push('/quiz');
  }, [router, deleteProgress, isPanelMode, closePanel, onPanelNavigate, quizDraft]);

  // 로딩 상태
  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#F5F0E8' }}>
        {/* 헤더 스켈레톤 */}
        <div className="sticky top-0 z-50 border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="flex items-center justify-between h-14 px-4">
            <Skeleton className="w-10 h-10 rounded-none" />
            <Skeleton className="w-32 h-6 rounded-none" />
            <Skeleton className="w-12 h-6 rounded-none" />
          </div>
          <Skeleton className="h-1 w-full rounded-none" />
        </div>

        <div className="px-4 py-6 space-y-4">
          <Skeleton className="w-full h-40 rounded-none" />
          <Skeleton className="w-full h-16 rounded-none" />
          <Skeleton className="w-full h-16 rounded-none" />
          <Skeleton className="w-full h-16 rounded-none" />
          <Skeleton className="w-full h-16 rounded-none" />
        </div>
      </div>
    );
  }

  // 에러 상태
  if (error || !quiz) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 border-2 border-[#8B1A1A] bg-[#FDEAEA] flex items-center justify-center">
            <svg
              className="w-10 h-10 text-[#8B1A1A]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[#1A1A1A] mb-2">
            {error || '퀴즈를 불러올 수 없습니다'}
          </h2>
          <p className="text-sm text-[#5C5C5C] mb-4">
            잠시 후 다시 시도해주세요.
          </p>
          <button
            onClick={() => onPanelNavigate ? onPanelNavigate('/quiz') : isPanelMode ? closePanel() : router.push('/quiz')}
            className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 현재 답안 가져오기 (단일 문제용)
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : null;

  return (
    <motion.div
      className={isPanelMode ? 'relative flex flex-col h-full overflow-hidden' : 'min-h-screen pb-24'}
      style={{ backgroundColor: '#F5F0E8' }}
      initial={slideIn ? { opacity: 0, x: 60 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
    >
      {/* 퀴즈 헤더 */}
      <QuizHeader
        title={quiz.title}
        currentQuestion={currentQuestionIndex + 1}
        totalQuestions={quiz.displayItems.length}
        onBack={() => setShowExitModal(true)}
      />

      {/* 문제 영역 */}
      <main className={isPanelMode ? 'flex-1 overflow-y-auto px-4 py-6' : 'px-4 py-6'}>
        <AnimatePresence mode="wait">
          {currentDisplayItem && (
            <motion.div
              key={currentDisplayItem.type === 'single'
                ? currentDisplayItem.question?.id
                : currentDisplayItem.combinedGroupId}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              {/* 단일 문제 */}
              {currentDisplayItem.type === 'single' && currentQuestion && (
                <>
                  {/* 문제 카드 */}
                  <QuestionCard
                    question={currentQuestion}
                    courseId={quiz?.courseId}
                    headerRight={
                      quiz?.creatorId !== user?.uid && quiz?.quizType !== 'ai-generated' ? (
                        <FeedbackIcon
                          isOpen={inlineFeedbackOpen === currentQuestion.id}
                          isSubmitted={inlineFeedbackSubmitted.has(currentQuestion.id)}
                          onClick={() => setInlineFeedbackOpen(
                            inlineFeedbackOpen === currentQuestion.id ? null : currentQuestion.id
                          )}
                        />
                      ) : undefined
                    }
                  />

                  {/* 선지 영역 */}
                  {(() => {
                    const isSubmitted = submittedQuestions.has(currentQuestion.id);
                    const result = gradeResults[currentQuestion.id];

                    return (
                      <div className="mt-4">
                        {/* OX 선지 */}
                        {currentQuestion.type === 'ox' && (
                          <OXChoice
                            selected={currentAnswer as OXAnswer}
                            onSelect={(answer) =>
                              handleAnswerChange(currentQuestion.id, answer)
                            }
                            disabled={isSubmitted}
                          />
                        )}

                        {/* 객관식 선지 */}
                        {currentQuestion.type === 'multiple' &&
                          currentQuestion.choices && (
                            currentQuestion.hasMultipleAnswers ? (
                              <MultipleChoice
                                choices={currentQuestion.choices}
                                multiSelect
                                selectedIndices={Array.isArray(currentAnswer) ? currentAnswer : []}
                                onMultiSelect={(indices) =>
                                  handleAnswerChange(currentQuestion.id, indices)
                                }
                                disabled={isSubmitted}
                                correctIndices={isSubmitted && Array.isArray(currentQuestion.answer) ? currentQuestion.answer : undefined}
                              />
                            ) : (
                              <MultipleChoice
                                choices={currentQuestion.choices}
                                selected={currentAnswer as number | null}
                                onSelect={(index) =>
                                  handleAnswerChange(currentQuestion.id, index)
                                }
                                disabled={isSubmitted}
                                correctIndex={isSubmitted ? Number(Array.isArray(currentQuestion.answer) ? currentQuestion.answer[0] : currentQuestion.answer) : undefined}
                              />
                            )
                          )}

                        {/* 주관식/단답형 입력 */}
                        {(currentQuestion.type === 'short' || currentQuestion.type === 'short_answer') && (
                          <ShortAnswer
                            value={(currentAnswer as string) || ''}
                            onChange={(value) =>
                              handleAnswerChange(currentQuestion.id, value)
                            }
                            disabled={isSubmitted}
                          />
                        )}

                        {/* 서술형 입력 */}
                        {currentQuestion.type === 'essay' && (
                          <ShortAnswer
                            value={(currentAnswer as string) || ''}
                            onChange={(value) =>
                              handleAnswerChange(currentQuestion.id, value)
                            }
                            maxLength={200}
                            placeholder="아는 것을 200자 내로 적어주세요."
                            disabled={isSubmitted}
                          />
                        )}

                        {/* 결합형 문제인데 선지가 없는 경우 (데이터 오류) - 주관식으로 대체 */}
                        {currentQuestion.type === 'combined' && !currentQuestion.choices && (
                          <div className="space-y-4">
                            <div className="p-3 bg-[#FFF8E1] border border-[#8B6914] text-sm text-[#8B6914]">
                              이 문제는 하위 문제가 설정되지 않았습니다. 텍스트로 답변해주세요.
                            </div>
                            <ShortAnswer
                              value={(currentAnswer as string) || ''}
                              onChange={(value) =>
                                handleAnswerChange(currentQuestion.id, value)
                              }
                              disabled={isSubmitted}
                            />
                          </div>
                        )}

                        {/* 채점 결과 + 해설 */}
                        <AnimatePresence>
                          {isSubmitted && result && (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              transition={{ duration: 0.3 }}
                              className="mt-4 space-y-3"
                            >
                              {/* 정답/오답 표시 */}
                              <div className={`p-3 border-2 ${
                                result.isCorrect
                                  ? 'bg-[#E8F5E9] border-[#1A6B1A]'
                                  : 'bg-[#FDEAEA] border-[#8B1A1A]'
                              }`}>
                                <p className={`text-sm font-bold ${
                                  result.isCorrect ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'
                                }`}>
                                  {result.isCorrect ? '정답입니다!' : '오답입니다'}
                                </p>
                                {!result.isCorrect && result.correctAnswer && (
                                  <p className="text-xs text-[#5C5C5C] mt-1">
                                    정답: <span className="font-bold text-[#1A6B1A]">{result.correctAnswer}</span>
                                  </p>
                                )}
                              </div>

                              {/* 해설 */}
                              {currentQuestion.explanation && (
                                <div className="p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
                                  <p className="text-xs font-bold text-[#1A1A1A] mb-1">해설</p>
                                  <p className="text-xs text-[#1A1A1A] leading-relaxed whitespace-pre-wrap">
                                    {currentQuestion.explanation}
                                  </p>
                                </div>
                              )}

                              {/* 선지별 해설 아코디언 */}
                              {currentQuestion.choiceExplanations && currentQuestion.type === 'multiple' && currentQuestion.choices && (
                                <div className="border-2 border-[#D4CFC4] overflow-hidden">
                                  <p className="px-3 py-2 text-xs font-bold text-[#5C5C5C] bg-[#EDEAE4] border-b border-[#D4CFC4]">
                                    선지별 해설
                                  </p>
                                  {currentQuestion.choices.map((choice, idx) => {
                                    const expText = currentQuestion.choiceExplanations?.[idx];
                                    if (!expText) return null;
                                    const isExpanded = expandedChoiceIdx === idx;
                                    return (
                                      <div key={idx} className="border-b border-[#D4CFC4] last:border-b-0">
                                        <button
                                          onClick={() => setExpandedChoiceIdx(isExpanded ? null : idx)}
                                          className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-[#F5F0E8] transition-colors"
                                        >
                                          <span className="text-xs font-bold text-[#5C5C5C] flex-shrink-0">{idx + 1}번</span>
                                          <span className="text-xs text-[#1A1A1A] flex-1 truncate">{choice}</span>
                                          <svg className={`w-3 h-3 text-[#5C5C5C] transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                        <AnimatePresence>
                                          {isExpanded && (
                                            <motion.div
                                              initial={{ height: 0, opacity: 0 }}
                                              animate={{ height: 'auto', opacity: 1 }}
                                              exit={{ height: 0, opacity: 0 }}
                                              transition={{ duration: 0.2 }}
                                              className="overflow-hidden"
                                            >
                                              <p className="px-3 pb-2 text-xs text-[#5C5C5C] leading-relaxed whitespace-pre-wrap">
                                                {expText}
                                              </p>
                                            </motion.div>
                                          )}
                                        </AnimatePresence>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })()}

                  {/* 인라인 피드백 패널 — 자기 퀴즈/AI 퀴즈가 아닐 때만 표시 */}
                  <AnimatePresence>
                    {inlineFeedbackOpen === currentQuestion.id && user && quiz?.creatorId !== user.uid && quiz?.quizType !== 'ai-generated' && (
                      <InlineFeedbackPanel
                        questionId={currentQuestion.id}
                        quizId={quizId}
                        quizCreatorId={quiz?.creatorId}
                        userId={user.uid}
                        questionNumber={currentQuestion.number}
                        isSubmitted={inlineFeedbackSubmitted.has(currentQuestion.id)}
                        onSubmitted={(qId) => {
                          setInlineFeedbackSubmitted(prev => new Set(prev).add(qId));

                          // localStorage에 인라인 피드백 카운트 저장 (exp 페이지에서 사용)
                          const key = `quiz_inline_feedback_count_${quizId}`;
                          const current = parseInt(localStorage.getItem(key) || '0', 10);
                          localStorage.setItem(key, String(current + 1));
                        }}
                        onClose={() => setInlineFeedbackOpen(null)}
                      />
                    )}
                  </AnimatePresence>
                </>
              )}

              {/* 결합형 문제 그룹 */}
              {currentDisplayItem.type === 'combined_group' && currentDisplayItem.questions && (
                <CombinedQuestionGroup
                  questions={currentDisplayItem.questions}
                  answers={answers}
                  onAnswerChange={handleAnswerChange}
                  groupNumber={currentDisplayItem.displayNumber}
                  courseId={quiz?.courseId}
                  submittedQuestions={submittedQuestions}
                  gradeResults={gradeResults}
                  inlineFeedbackOpen={inlineFeedbackOpen}
                  inlineFeedbackSubmitted={inlineFeedbackSubmitted}
                  onFeedbackToggle={quiz?.creatorId !== user?.uid ? (qId) => setInlineFeedbackOpen(
                    inlineFeedbackOpen === qId ? null : qId
                  ) : undefined}
                  onFeedbackSubmitted={quiz?.creatorId !== user?.uid ? (qId) => {
                    setInlineFeedbackSubmitted(prev => new Set(prev).add(qId));
                    const key = `quiz_inline_feedback_count_${quizId}`;
                    const current = parseInt(localStorage.getItem(key) || '0', 10);
                    localStorage.setItem(key, String(current + 1));
                    setInlineFeedbackOpen(null);
                  } : undefined}
                  quizCreatorId={quiz?.creatorId}
                  quizId={quizId}
                  userId={user?.uid}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 네비게이션 — 나가기 모달 열림 시 invisible (DOM 유지로 레이아웃 안정) */}
      <div className={showExitModal ? 'invisible' : ''}>
        <QuizNavigation
          currentQuestion={currentQuestionIndex + 1}
          totalQuestions={quiz.displayItems.length}
          onPrev={handlePrev}
          onNext={handleNext}
          onSubmit={handleSubmit}
          hasAnswered={isCurrentItemAnswered}
          isSubmitting={isSubmitting}
          onGrade={handleGradeCurrentItem}
          isGraded={isCurrentItemSubmitted}
          isPanelMode={isPanelMode}
        />
      </div>

      {/* 나가기 확인 모달 */}
      <ExitConfirmModal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        onSaveAndExit={handleSaveAndExit}
        onExitWithoutSave={handleExitWithoutSave}
        answeredCount={answeredCount}
        totalQuestions={quiz.questions.length}
        isSaving={isSaving}
        hideExitWithoutSave
        isPanelMode={isPanelMode}
      />

      {/* 이전 진행상황 복원 모달 */}
      <AnimatePresence>
        {showResumeModal && savedProgress && (
          isPanelMode ? (
            /* 패널 모드: 3쪽 하단 바텀시트 (오버레이 없이) */
            <div className="absolute bottom-0 left-0 right-0 z-50">
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                className="w-full bg-[#F5F0E8] rounded-t-2xl border-t-2 border-x-2 border-[#1A1A1A] shadow-[0_-4px_24px_rgba(0,0,0,0.15)] p-4"
              >
                <div className="flex justify-center mb-2"><div className="w-8 h-1 rounded-full bg-[#D4CFC4]" /></div>
                <div className="flex justify-center mb-3">
                  <div className="w-10 h-10 bg-[#FFF8E1] border-2 border-[#8B6914] flex items-center justify-center rounded-lg">
                    <svg className="w-5 h-5 text-[#8B6914]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                </div>
                <h2 className="text-base font-bold text-[#1A1A1A] text-center mb-1.5">이전 진행상황이 있습니다</h2>
                <p className="text-xs text-[#5C5C5C] text-center mb-3">이전에 풀던 문제가 저장되어 있습니다.</p>
                <div className="bg-[#EDEAE4] border border-[#1A1A1A] p-2.5 mb-3 rounded-lg">
                  <div className="flex justify-between text-xs"><span className="text-[#5C5C5C]">답변한 문제</span><span className="font-bold">{savedProgress.answeredCount} / {quiz.questions.length}문제</span></div>
                  <div className="flex justify-between text-xs mt-1"><span className="text-[#5C5C5C]">마지막 위치</span><span className="font-bold">{savedProgress.currentQuestionIndex + 1}번 문제</span></div>
                </div>
                <div className="space-y-1.5">
                  <button onClick={handleResume} className="w-full py-2.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] rounded-xl">이어서 풀기</button>
                </div>
              </motion.div>
            </div>
          ) : (
            /* 모바일: 기존 센터 모달 */
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4"
              >
                <div className="flex justify-center mb-3">
                  <div className="w-10 h-10 bg-[#FFF8E1] border-2 border-[#8B6914] flex items-center justify-center">
                    <svg className="w-5 h-5 text-[#8B6914]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                </div>
                <h2 className="text-base font-bold text-[#1A1A1A] text-center mb-1.5">이전 진행상황이 있습니다</h2>
                <p className="text-xs text-[#5C5C5C] text-center mb-3">이전에 풀던 문제가 저장되어 있습니다.</p>
                <div className="bg-[#EDEAE4] border border-[#1A1A1A] p-2.5 mb-3">
                  <div className="flex justify-between text-xs"><span className="text-[#5C5C5C]">답변한 문제</span><span className="font-bold text-[#1A1A1A]">{savedProgress.answeredCount} / {quiz.questions.length}문제</span></div>
                  <div className="flex justify-between text-xs mt-1"><span className="text-[#5C5C5C]">마지막 위치</span><span className="font-bold text-[#1A1A1A]">{savedProgress.currentQuestionIndex + 1}번 문제</span></div>
                </div>
                <div className="space-y-1.5">
                  <button onClick={handleResume} className="w-full py-2.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors">이어서 풀기</button>
                </div>
              </motion.div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </motion.div>
  );
}
