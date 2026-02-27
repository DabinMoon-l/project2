'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import {
  getFirestore,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
  collection,
  Timestamp,
} from 'firebase/firestore';
import { useUser } from '@/lib/contexts';
import { useCourse } from '@/lib/contexts/CourseContext';
import { getChapterIdFromTag } from '@/lib/courseIndex';
import ReviewPractice, { type PracticeResult } from '@/components/review/ReviewPractice';
import type { ReviewItem } from '@/lib/hooks/useReview';

import FloatingAIButton from './FloatingAIButton';
import AIQuizModal, { AIQuizData } from './AIQuizModal';
import AIQuizProgress from './AIQuizProgress';

interface GeneratedQuestion {
  text: string;
  type?: 'multiple' | 'ox';  // 문제 형식 (기본: multiple)
  choices?: string[];         // 객관식 선지 (ox는 없을 수 있음)
  answer: number | number[] | string; // 객관식: 0-based index, OX: 'O'/'X'
  explanation: string;
  choiceExplanations?: string[]; // 각 선지별 해설
  questionType?: string;
  trapPattern?: string;
  chapterId?: string;       // Gemini가 할당한 챕터 ID
  chapterDetailId?: string; // Gemini가 할당한 세부 챕터 ID
  imageUrl?: string;        // 학습 자료에서 크롭된 이미지 URL (HARD 난이도)
  imageDescription?: string; // 이미지 설명 (그래프, 표, 그림 등)
  bogi?: {
    questionText: string;
    items: Array<{ label: string; content: string }>;
  };
}

interface QuizDocument {
  id: string;
  title: string;
  tags: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  questions: Array<{
    id: string;
    order: number;
    type: 'multiple' | 'ox';
    text: string;
    choices?: string[];
    answer: number | number[] | string; // 복수정답 + OX 지원
    explanation: string;
    choiceExplanations?: string[]; // 각 선지별 해설
    chapterId: string | null;
    chapterDetailId: string | null;
    imageUrl?: string | null;       // 크롭된 이미지 URL (HARD 난이도)
    imageDescription?: string | null; // 이미지 설명
  }>;
}

/**
 * AI 퀴즈 시스템 통합 컨테이너
 *
 * 플로우:
 * 1. 플로팅 버튼 클릭 → AI 퀴즈 모달
 * 2. 문제 생성 → Firestore 저장 (기존 퀴즈 구조)
 * 3. ReviewPractice로 바로 연습 모드 시작
 * 4. 완료 후 오답은 reviews 컬렉션에 저장
 */
export default function AIQuizContainer() {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId, userClassId, userCourse } = useCourse();

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProgressOpen, setIsProgressOpen] = useState(false);
  const [isPracticeOpen, setIsPracticeOpen] = useState(false);

  // 진행 상태
  const [progressStep, setProgressStep] = useState<'uploading' | 'analyzing' | 'generating'>('uploading');
  const [currentFolderName, setCurrentFolderName] = useState('');

  // 저장된 퀴즈 정보 (연습 모드용)
  const [savedQuiz, setSavedQuiz] = useState<QuizDocument | null>(null);

  // 연습 모드 시 네비게이션 숨김
  useEffect(() => {
    if (isPracticeOpen) document.body.setAttribute('data-hide-nav', '');
    else document.body.removeAttribute('data-hide-nav');
    return () => document.body.removeAttribute('data-hide-nav');
  }, [isPracticeOpen]);

  // Job polling 중단용 ref
  const pollingRef = useRef(false);

  // 플로팅 버튼 클릭
  const handleFloatingButtonClick = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  // 모달 닫기
  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // 태그에서 첫 번째 챕터 ID 추출
  const getFirstChapterIdFromTags = useCallback((tags: string[]): string | null => {
    if (!userCourseId) return null;

    for (const tag of tags) {
      const chapterId = getChapterIdFromTag(userCourseId, tag);
      if (chapterId) return chapterId;
    }
    return null;
  }, [userCourseId]);

  // 퀴즈 생성 시작 (Job 시스템)
  const handleStartQuiz = useCallback(async (data: AIQuizData) => {
    if (!profile?.uid) {
      alert('로그인이 필요합니다.');
      return;
    }

    setIsModalOpen(false);
    setIsProgressOpen(true);
    setCurrentFolderName(data.folderName);
    setProgressStep('uploading');
    pollingRef.current = true;

    try {
      // 1단계: Job 등록
      setProgressStep('uploading');

      const enqueueJob = httpsCallable<
        {
          text?: string;
          images?: string[];
          difficulty: string;
          questionCount: number;
          courseId: string;
          courseName?: string;
          courseCustomized?: boolean;
          tags?: string[];
        },
        { jobId: string; status: string; deduplicated: boolean }
      >(functions, 'enqueueGenerationJob');

      const enqueueResult = await enqueueJob({
        text: data.textContent,
        images: data.images,
        difficulty: data.difficulty,
        questionCount: data.questionCount,
        courseId: userCourseId || 'biology',
        courseName: userCourse?.name || '일반',
        courseCustomized: data.courseCustomized ?? true,
        tags: data.tags.length > 0 ? data.tags : undefined,
      });

      const { jobId, status: initialStatus, deduplicated } = enqueueResult.data;

      // 이미 완료된 중복 Job이면 바로 결과 가져오기
      if (deduplicated && initialStatus === 'COMPLETED') {
        setProgressStep('generating');
      } else {
        // 2단계: 분석/생성 대기
        setProgressStep('analyzing');
      }

      // 3단계: Job 상태 polling
      const checkStatus = httpsCallable<
        { jobId: string },
        { jobId: string; status: string; result?: { questions: GeneratedQuestion[]; meta?: any }; error?: string }
      >(functions, 'checkJobStatus');

      let questions: GeneratedQuestion[] = [];
      const MAX_POLLS = 90; // 최대 90회 × 2초 = 3분
      let pollCount = 0;

      while (pollingRef.current && pollCount < MAX_POLLS) {
        const statusResult = await checkStatus({ jobId });
        const { status, result, error } = statusResult.data;

        if (status === 'RUNNING') {
          setProgressStep('generating');
        }

        if (status === 'COMPLETED' && result) {
          questions = result.questions.slice(0, data.questionCount);
          break;
        }

        if (status === 'FAILED') {
          throw new Error(error || '문제 생성에 실패했습니다. 다시 시도해주세요.');
        }

        // 2초 대기 후 재시도
        await new Promise(resolve => setTimeout(resolve, 2000));
        pollCount++;
      }

      if (!pollingRef.current) {
        // 사용자가 취소함
        return;
      }

      if (questions.length === 0) {
        throw new Error('문제 생성 시간이 초과되었습니다. 다시 시도해주세요.');
      }

      // 폴백용 챕터 ID (태그에서 추출)
      const fallbackChapterId = getFirstChapterIdFromTags(data.tags);

      // 현재 학기 계산
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const semester = month >= 3 && month <= 8 ? `${year}-1` : `${year}-2`;

      // Firestore에 퀴즈 저장 (기존 퀴즈 구조와 동일)
      const db = getFirestore();
      const quizRef = doc(collection(db, 'quizzes'));
      const quizId = quizRef.id;

      // OX / 객관식 카운트 계산
      const oxQuestions = questions.filter(q => q.type === 'ox' || (typeof q.answer === 'string' && (q.answer === 'O' || q.answer === 'X')));
      const multipleQuestions = questions.filter(q => q.type !== 'ox' && !(typeof q.answer === 'string' && (q.answer === 'O' || q.answer === 'X')));

      const quizData = {
        title: data.folderName,
        tags: data.tags,
        isPublic: false,
        difficulty: data.difficulty,
        type: 'ai-generated', // AI 생성 퀴즈 표시
        questions: questions.map((q, idx) => {
          const isOx = q.type === 'ox' || (typeof q.answer === 'string' && (q.answer === 'O' || q.answer === 'X'));
          return {
            id: `q${idx + 1}`,
            order: idx + 1,
            type: isOx ? 'ox' as const : 'multiple' as const,
            text: q.text,
            ...(isOx ? {} : { choices: q.choices || [] }),
            answer: q.answer,
            explanation: q.explanation || '',
            ...(q.choiceExplanations && !isOx ? { choiceExplanations: q.choiceExplanations } : {}),
            ...(q.bogi ? { bogi: q.bogi } : {}),
            // Gemini가 할당한 챕터 ID 사용, 없으면 태그에서 추출한 폴백 사용
            chapterId: q.chapterId || fallbackChapterId,
            chapterDetailId: q.chapterDetailId || null,
            // 학습 자료에서 크롭된 이미지 (HARD 난이도)
            imageUrl: q.imageUrl || null,
            imageDescription: q.imageDescription || null,
          };
        }),
        questionCount: questions.length,
        oxCount: oxQuestions.length,
        multipleChoiceCount: multipleQuestions.length,
        subjectiveCount: 0,
        participantCount: 0,
        userScores: {},
        creatorId: profile.uid,
        creatorNickname: profile.nickname || '익명',
        creatorClassType: profile.classType || null,
        courseId: userCourseId || 'biology',
        semester,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(quizRef, quizData);

      // 저장된 퀴즈 정보 설정
      setSavedQuiz({
        id: quizId,
        title: data.folderName,
        tags: data.tags,
        difficulty: data.difficulty,
        questions: quizData.questions,
      });

      setIsProgressOpen(false);
      setIsPracticeOpen(true);

    } catch (err: any) {
      console.error('AI 퀴즈 생성 오류:', err);
      setIsProgressOpen(false);

      const errorMessage = err?.message || err?.code || 'AI 문제 생성 중 오류가 발생했습니다.';

      if (errorMessage.includes('횟수') || errorMessage.includes('초과') || errorMessage.includes('exhausted')) {
        alert(errorMessage);
      } else {
        alert(`오류: ${errorMessage}`);
      }
    }
    pollingRef.current = false;
  }, [profile, userCourseId, userCourse, getFirstChapterIdFromTags]);

  // 저장된 퀴즈를 ReviewItem 형태로 변환
  const practiceItems: ReviewItem[] = useMemo(() => {
    if (!savedQuiz || !profile?.uid) return [];

    return savedQuiz.questions.map((q) => {
      const isOx = q.type === 'ox';
      // OX 문제: 'O'/'X' 그대로, 객관식: 0-indexed → 1-indexed
      const correctAnswer = isOx
        ? String(q.answer)
        : Array.isArray(q.answer)
          ? q.answer.map(a => String(a + 1)).join(',')
          : String(Number(q.answer) + 1);

      return {
        id: `temp_${q.id}`, // 임시 ID (아직 reviews에 저장 안됨)
        userId: profile.uid,
        quizId: savedQuiz.id,
        quizTitle: savedQuiz.title,
        questionId: q.id,
        question: q.text,
        type: isOx ? 'ox' : 'multiple',
        options: isOx ? undefined : q.choices,
        correctAnswer,
        userAnswer: '',
        explanation: q.explanation,
        reviewType: 'solved',
        isBookmarked: false,
        reviewCount: 0,
        lastReviewedAt: null,
        createdAt: Timestamp.now(),
        chapterId: q.chapterId || undefined,
        chapterDetailId: q.chapterDetailId || undefined,
        choiceExplanations: q.choiceExplanations || undefined,
        imageUrl: q.imageUrl || undefined, // 크롭된 이미지 URL
      };
    });
  }, [savedQuiz, profile?.uid]);

  // 연습 모드 닫기
  const handlePracticeClose = useCallback(() => {
    if (confirm('연습을 종료하시겠습니까?')) {
      setIsPracticeOpen(false);
      setSavedQuiz(null);
      setCurrentFolderName('');
    }
  }, []);

  // 연습 모드 완료
  const handlePracticeComplete = useCallback(async (results: PracticeResult[]) => {
    if (!profile?.uid || !savedQuiz) return;

    setIsPracticeOpen(false);

    try {
      const db = getFirestore();

      // 정답/오답 집계
      const correctCount = results.filter(r => r.isCorrect).length;
      const totalCount = results.length;
      const score = Math.round((correctCount / totalCount) * 100);

      // 각 문제에 결과 정보 추가
      const questionsWithResults = savedQuiz.questions.map(q => {
        const result = results.find(r => r.questionId === q.id);
        return {
          ...q,
          isCorrect: result?.isCorrect ?? true,
          userAnswer: result?.userAnswer ?? null,
        };
      });

      // 퀴즈 문서에 점수, 문제 결과 저장
      const quizRef = doc(db, 'quizzes', savedQuiz.id);
      await setDoc(quizRef, {
        participantCount: 1,
        userScores: { [profile.uid]: score },
        score,
        correctCount,
        totalQuestions: totalCount,
        questions: questionsWithResults,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      // quiz_completions에 완료 기록 생성
      const completionDocId = `${savedQuiz.id}_${profile.uid}`;
      await setDoc(doc(db, 'quiz_completions', completionDocId), {
        quizId: savedQuiz.id,
        userId: profile.uid,
        score,
        attemptNo: 1,
        completedAt: serverTimestamp(),
      }, { merge: true });

      // 퀴즈 결과를 quizResults 컬렉션에 저장 (통계용)
      // userAnswer를 1-indexed로 변환 (통계 모달에서 1-indexed 기대)
      const questionScores: Record<string, { isCorrect: boolean; userAnswer: string; answeredAt: ReturnType<typeof serverTimestamp> }> = {};
      results.forEach((r) => {
        const question = savedQuiz.questions.find(q => q.id === r.questionId);
        let convertedAnswer = r.userAnswer;
        if (question?.type === 'multiple' || !question?.type) {
          // r.userAnswer는 0-indexed → 1-indexed로 변환
          if (Array.isArray(r.userAnswer)) {
            convertedAnswer = r.userAnswer.map((a: any) => String(Number(a) + 1)).join(',');
          } else if (r.userAnswer !== '' && !isNaN(Number(r.userAnswer))) {
            convertedAnswer = String(Number(r.userAnswer) + 1);
          }
        }
        questionScores[r.questionId] = {
          isCorrect: r.isCorrect,
          userAnswer: convertedAnswer,
          answeredAt: serverTimestamp(),
        };
      });

      await addDoc(collection(db, 'quizResults'), {
        userId: profile.uid,
        quizId: savedQuiz.id,
        quizTitle: savedQuiz.title,
        quizCreatorId: profile.uid,
        score,
        correctCount,
        totalCount,
        earnedExp: 0, // AI 퀴즈 풀이는 서버 XP 미지급 (생성 시 지급됨)
        questionScores,
        isUpdate: false,
        courseId: userCourseId || null,
        classId: userClassId || null,
        createdAt: serverTimestamp(),
      });

      // 모든 문제를 reviews 컬렉션에 저장
      const reviewsRef = collection(db, 'reviews');

      for (const result of results) {
        const question = savedQuiz.questions.find(q => q.id === result.questionId);
        if (!question) continue;

        // 복수정답 지원: 배열이면 쉼표로 구분
        // question.answer는 0-indexed 숫자
        const correctAnswer = Array.isArray(question.answer)
          ? question.answer.map(a => String(Number(a) + 1)).join(',')
          : String(Number(question.answer) + 1);

        // result.userAnswer는 0-indexed 문자열 또는 배열
        // 숫자로 변환 후 +1 해서 1-indexed로 저장
        const userAnswer = Array.isArray(result.userAnswer)
          ? result.userAnswer.map(a => String(Number(a) + 1)).join(',')
          : String(Number(result.userAnswer) + 1);

        // solved 타입으로 저장 (모든 문제)
        await addDoc(reviewsRef, {
          userId: profile.uid,
          quizId: savedQuiz.id,
          quizTitle: savedQuiz.title,
          questionId: question.id,
          question: question.text,
          type: 'multiple',
          options: question.choices,
          correctAnswer,
          userAnswer,
          explanation: question.explanation,
          choiceExplanations: question.choiceExplanations || null,
          reviewType: 'solved',
          isBookmarked: false,
          isCorrect: result.isCorrect,
          reviewCount: 0,
          lastReviewedAt: null,
          createdAt: serverTimestamp(),
          quizUpdatedAt: serverTimestamp(),
          chapterId: question.chapterId,
          chapterDetailId: question.chapterDetailId,
          imageUrl: question.imageUrl || null, // 크롭된 이미지 URL
          courseId: userCourseId || null, // 과목 ID (필터링용)
          quizType: 'ai-generated', // 퀴즈 타입
          quizCreatorId: profile.uid, // 퀴즈 생성자
        });

        // 오답인 경우 wrong 타입으로도 저장
        if (!result.isCorrect) {
          await addDoc(reviewsRef, {
            userId: profile.uid,
            quizId: savedQuiz.id,
            quizTitle: savedQuiz.title,
            questionId: question.id,
            question: question.text,
            type: 'multiple',
            options: question.choices,
            correctAnswer,
            userAnswer,
            explanation: question.explanation,
            choiceExplanations: question.choiceExplanations || null,
            reviewType: 'wrong',
            isBookmarked: false,
            isCorrect: false,
            reviewCount: 0,
            lastReviewedAt: null,
            createdAt: serverTimestamp(),
            quizUpdatedAt: serverTimestamp(),
            chapterId: question.chapterId,
            chapterDetailId: question.chapterDetailId,
            imageUrl: question.imageUrl || null, // 크롭된 이미지 URL
            courseId: userCourseId || null, // 과목 ID (필터링용)
            quizType: 'ai-generated', // 퀴즈 타입
            quizCreatorId: profile.uid, // 퀴즈 생성자
          });
        }
      }

      // AI 퀴즈 풀이는 서버에서 XP를 지급하지 않음 (생성 시 이미 지급됨)

    } catch (err) {
      console.error('퀴즈 결과 저장 오류:', err);
    }

    setSavedQuiz(null);
    setCurrentFolderName('');
  }, [profile, savedQuiz]);

  return (
    <>
      {/* 플로팅 버튼 */}
      <FloatingAIButton onClick={handleFloatingButtonClick} />

      {/* 퀴즈 생성 모달 */}
      <AIQuizModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onStartQuiz={handleStartQuiz}
      />

      {/* 진행 상태 모달 */}
      <AIQuizProgress
        isOpen={isProgressOpen}
        progress={progressStep}
        folderName={currentFolderName}
      />

      {/* AI 퀴즈 연습 모드 */}
      {isPracticeOpen && practiceItems.length > 0 && (
        <div className="fixed inset-0 z-50 bg-[#F5F0E8]">
          <ReviewPractice
            items={practiceItems}
            quizTitle={savedQuiz?.title}
            onComplete={handlePracticeComplete}
            onClose={handlePracticeClose}
            currentUserId={profile?.uid}
            headerTitle="퀴즈"
            showFeedback={false}
          />
        </div>
      )}
    </>
  );
}
