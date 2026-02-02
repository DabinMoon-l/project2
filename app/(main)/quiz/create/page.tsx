'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse, useUser } from '@/lib/contexts';
import { useExpToast } from '@/components/common';
import {
  ImageUploader,
  OCRProcessor,
  QuestionEditor,
  QuestionList,
  QuizMetaForm,
  calculateTotalQuestionCount,
  type QuestionData,
  type QuizMeta,
} from '@/components/quiz/create';
import type { ParseResult, ParsedQuestion } from '@/lib/ocr';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 페이지 단계
 */
type Step = 'upload' | 'questions' | 'meta' | 'confirm';

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 자체제작 퀴즈 생성 페이지
 *
 * OCR을 통한 이미지/PDF 업로드 또는 직접 입력으로
 * 퀴즈 문제를 생성하고 저장합니다.
 */
export default function QuizCreatePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const { profile } = useUser();
  const { showExpToast } = useExpToast();

  // 단계 관리
  const [step, setStep] = useState<Step>('upload');

  // 파일 업로드 상태
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isOCRProcessing, setIsOCRProcessing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // 문제 관리
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // 퀴즈 메타 정보
  const [quizMeta, setQuizMeta] = useState<QuizMeta>({
    title: '',
    tags: [],
    isPublic: true,
    difficulty: 'normal',
  });

  // 저장 상태
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 유효성 검사 에러
  const [metaErrors, setMetaErrors] = useState<{ title?: string; tags?: string }>({});

  // 초안 저장/복원 관련 상태
  const [showExitModal, setShowExitModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [savedDraftInfo, setSavedDraftInfo] = useState<{ questionCount: number; title: string } | null>(null);

  // localStorage 키
  const DRAFT_KEY = 'quiz_create_draft';

  /**
   * 데이터 정리 (undefined, null, 빈 배열 제거)
   * localStorage와 Firestore 모두 직렬화 가능한 데이터만 허용
   */
  const cleanDataForStorage = useCallback((data: any): any => {
    if (data === null || data === undefined) return null;
    if (Array.isArray(data)) {
      return data.map(item => cleanDataForStorage(item)).filter(item => item !== null && item !== undefined);
    }
    if (typeof data === 'object') {
      const cleaned: any = {};
      for (const key in data) {
        const value = data[key];
        // undefined, 함수, File 객체 제외
        if (value !== undefined && typeof value !== 'function' && !(value instanceof File)) {
          const cleanedValue = cleanDataForStorage(value);
          if (cleanedValue !== null && cleanedValue !== undefined) {
            cleaned[key] = cleanedValue;
          }
        }
      }
      return Object.keys(cleaned).length > 0 ? cleaned : null;
    }
    return data;
  }, []);

  /**
   * 초안 저장
   */
  const saveDraft = useCallback(() => {
    try {
      // 데이터 정리 후 저장
      const cleanedQuestions = cleanDataForStorage(questions) || [];
      const cleanedMeta = cleanDataForStorage(quizMeta) || {};

      const draftData = {
        step,
        questions: cleanedQuestions,
        quizMeta: cleanedMeta,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
      return true;
    } catch (err) {
      console.error('초안 저장 실패:', err);
      return false;
    }
  }, [step, questions, quizMeta, cleanDataForStorage]);

  /**
   * 초안 불러오기
   */
  const loadDraft = useCallback(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.error('초안 불러오기 실패:', err);
    }
    return null;
  }, []);

  /**
   * 초안 삭제
   */
  const deleteDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      console.error('초안 삭제 실패:', err);
    }
  }, []);

  /**
   * 페이지 로드 시 저장된 초안 확인
   */
  useEffect(() => {
    const draft = loadDraft();
    if (draft && (draft.questions?.length > 0 || draft.quizMeta?.title)) {
      setSavedDraftInfo({
        questionCount: draft.questions?.length || 0,
        title: draft.quizMeta?.title || '',
      });
      setShowResumeModal(true);
    }
  }, [loadDraft]);

  /**
   * 이전 초안 이어서 작성
   */
  const handleResumeDraft = useCallback(() => {
    const draft = loadDraft();
    if (draft) {
      if (draft.step) setStep(draft.step);
      if (draft.questions) setQuestions(draft.questions);
      if (draft.quizMeta) setQuizMeta(draft.quizMeta);
    }
    setShowResumeModal(false);
    setSavedDraftInfo(null);
  }, [loadDraft]);

  /**
   * 처음부터 새로 작성
   */
  const handleStartFresh = useCallback(() => {
    deleteDraft();
    setShowResumeModal(false);
    setSavedDraftInfo(null);
  }, [deleteDraft]);

  /**
   * 저장하고 나가기
   */
  const handleSaveAndExit = useCallback(() => {
    const success = saveDraft();
    if (success) {
      router.back();
    } else {
      alert('저장에 실패했습니다.');
    }
  }, [saveDraft, router]);

  /**
   * 저장하지 않고 나가기
   */
  const handleExitWithoutSave = useCallback(() => {
    deleteDraft();
    router.back();
  }, [deleteDraft, router]);

  /**
   * 뒤로가기 버튼 핸들러
   */
  const handleBackButton = useCallback(() => {
    // 작성 중인 내용이 있으면 모달 표시
    if (step !== 'upload' || questions.length > 0 || quizMeta.title) {
      setShowExitModal(true);
    } else {
      router.back();
    }
  }, [step, questions.length, quizMeta.title, router]);

  /**
   * 파일 선택 핸들러
   */
  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file);
    setIsOCRProcessing(true);
    setOcrError(null);
  }, []);

  /**
   * OCR 완료 핸들러
   */
  const handleOCRComplete = useCallback((result: ParseResult) => {
    setIsOCRProcessing(false);

    // 파싱된 문제가 있으면 문제 목록에 추가하고 자동으로 다음 단계로 이동
    if (result.questions.length > 0) {
      const convertedQuestions: QuestionData[] = result.questions.map(
        (parsed: ParsedQuestion, index: number) => ({
          id: `ocr_${Date.now()}_${index}`,
          text: parsed.text,
          type: parsed.type,
          choices: parsed.choices || ['', '', '', ''],
          answerIndex:
            typeof parsed.answer === 'number'
              ? parsed.answer
              : parsed.type === 'ox'
                ? String(parsed.answer).toLowerCase() === 'o' ||
                  String(parsed.answer) === '참'
                  ? 0
                  : 1
                : -1,
          answerText:
            parsed.type === 'subjective' && typeof parsed.answer === 'string'
              ? parsed.answer
              : '',
          explanation: parsed.explanation || '',
          imageUrl: null,
          examples: null,
        })
      );

      setQuestions((prev) => [...prev, ...convertedQuestions]);

      // 문제가 추출되면 자동으로 문제 편집 단계로 이동
      setStep('questions');
    } else if (result.rawText.trim()) {
      // 텍스트는 추출되었지만 문제 형식을 인식하지 못한 경우
      // 사용자에게 알림 후 문제 편집 단계로 이동하여 직접 입력하도록 함
      alert(`텍스트가 추출되었지만 문제 형식을 인식하지 못했습니다.\n직접 문제를 입력해주세요.\n\n추출된 텍스트:\n${result.rawText.slice(0, 200)}...`);
      setStep('questions');
      setIsAddingNew(true);
    }
  }, []);

  /**
   * OCR 에러 핸들러
   */
  const handleOCRError = useCallback((error: string) => {
    setIsOCRProcessing(false);
    setOcrError(error);
  }, []);

  /**
   * OCR 취소 핸들러
   */
  const handleOCRCancel = useCallback(() => {
    setIsOCRProcessing(false);
    setSelectedFile(null);
    setOcrError(null);
  }, []);

  /**
   * 새 문제 추가 시작
   */
  const handleStartAddQuestion = useCallback(() => {
    setIsAddingNew(true);
    setEditingIndex(null);
  }, []);

  /**
   * 문제 편집 시작
   */
  const handleEditQuestion = useCallback((index: number) => {
    setEditingIndex(index);
    setIsAddingNew(false);
  }, []);

  /**
   * 문제 저장 (새 문제 또는 편집)
   */
  const handleSaveQuestion = useCallback(
    (question: QuestionData) => {
      if (editingIndex !== null) {
        // 기존 문제 수정
        setQuestions((prev) => {
          const newQuestions = [...prev];
          newQuestions[editingIndex] = question;
          return newQuestions;
        });
        setEditingIndex(null);
      } else {
        // 새 문제 추가
        setQuestions((prev) => [...prev, question]);
        setIsAddingNew(false);
      }
    },
    [editingIndex]
  );

  /**
   * 문제 편집 취소
   */
  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setIsAddingNew(false);
  }, []);

  /**
   * 다음 단계로 이동
   */
  const handleNextStep = useCallback(() => {
    if (step === 'upload') {
      // 문제가 없으면 직접 입력 모드로 전환
      setStep('questions');
    } else if (step === 'questions') {
      // 최소 3문제 확인 (결합형 하위문제 포함)
      const totalCount = calculateTotalQuestionCount(questions);
      if (totalCount < 3) {
        return;
      }
      setStep('meta');
    } else if (step === 'meta') {
      // 유효성 검사
      const errors: { title?: string; tags?: string } = {};

      if (!quizMeta.title.trim()) {
        errors.title = '퀴즈 제목을 입력해주세요.';
      }

      if (Object.keys(errors).length > 0) {
        setMetaErrors(errors);
        return;
      }

      setMetaErrors({});
      setStep('confirm');
    }
  }, [step, questions, quizMeta.title]);

  /**
   * 이전 단계로 이동
   */
  const handlePrevStep = useCallback(() => {
    if (step === 'questions') {
      // upload로 돌아갈 때 파일 상태 초기화
      setSelectedFile(null);
      setIsOCRProcessing(false);
      setOcrError(null);
      setStep('upload');
    } else if (step === 'meta') {
      setStep('questions');
    } else if (step === 'confirm') {
      setStep('meta');
    }
  }, [step]);

  /**
   * 퀴즈 저장
   */
  const handleSaveQuiz = useCallback(async () => {
    if (!user) {
      setSaveError('로그인이 필요합니다.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      // Firestore에 퀴즈 저장
      const quizData = {
        // 메타 정보
        title: quizMeta.title.trim(),
        tags: quizMeta.tags,
        isPublic: quizMeta.isPublic,
        difficulty: quizMeta.difficulty,
        type: 'custom' as const, // 자체제작 퀴즈

        // 문제 정보 - 결합형은 하위 문제를 개별 문제로 펼침
        questions: (() => {
          const flattenedQuestions: any[] = [];
          let orderIndex = 0;

          questions.forEach((q) => {
            // 결합형 문제: 하위 문제를 개별 문제로 펼침
            if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
              const combinedGroupId = `combined_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              const subQuestionsCount = q.subQuestions.length;

              q.subQuestions.forEach((sq, sqIndex) => {
                // 하위 문제 정답 처리
                let subAnswer: string | number;
                if (sq.type === 'short_answer') {
                  const answerTexts = (sq.answerTexts || [sq.answerText || '']).filter(t => t.trim());
                  subAnswer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
                } else if (sq.type === 'multiple') {
                  // 객관식: 1-indexed로 변환
                  if (sq.answerIndices && sq.answerIndices.length > 1) {
                    // 복수정답
                    subAnswer = sq.answerIndices.map(i => i + 1).join(',');
                  } else if (sq.answerIndices && sq.answerIndices.length === 1) {
                    // 단일정답 (answerIndices에서)
                    subAnswer = sq.answerIndices[0] + 1;
                  } else if (sq.answerIndex !== undefined && sq.answerIndex >= 0) {
                    // 단일정답 (answerIndex에서)
                    subAnswer = sq.answerIndex + 1;
                  } else {
                    subAnswer = -1;
                  }
                } else {
                  // OX: 0 = O, 1 = X (그대로 저장)
                  subAnswer = sq.answerIndex ?? -1;
                }

                const subQuestionData: any = {
                  order: orderIndex++,
                  text: sq.text,
                  type: sq.type,
                  choices: sq.type === 'multiple' ? sq.choices?.filter((c) => c.trim()) : null,
                  answer: subAnswer,
                  explanation: sq.explanation || null,
                  imageUrl: sq.image || null,
                  examples: sq.examples ? {
                    type: sq.examplesType || 'text',
                    items: sq.examples.filter((item) => item.trim()),
                  } : sq.koreanAbcExamples ? {
                    type: 'labeled',
                    items: sq.koreanAbcExamples.map(item => item.text).filter(t => t.trim()),
                  } : null,
                  // 결합형 그룹 정보
                  combinedGroupId,
                  combinedIndex: sqIndex,
                  combinedTotal: subQuestionsCount,
                };

                // 첫 번째 하위 문제에만 공통 지문 정보 포함
                if (sqIndex === 0) {
                  subQuestionData.passageType = q.passageType || 'text';
                  subQuestionData.passage = q.passageType === 'text' ? (q.passage || q.text || '') : '';
                  subQuestionData.passageImage = q.passageImage || null;
                  subQuestionData.koreanAbcItems = q.passageType === 'korean_abc'
                    ? (q.koreanAbcItems || []).filter((item) => item.text?.trim()).map(item => item.text)
                    : null;
                  subQuestionData.combinedMainText = q.text || ''; // 결합형 메인 문제 텍스트
                }

                flattenedQuestions.push(subQuestionData);
              });
            } else {
              // 일반 문제 처리
              let answer: string | number;
              if (q.type === 'subjective' || q.type === 'short_answer') {
                const answerTexts = (q.answerTexts || [q.answerText]).filter(t => t.trim());
                answer = answerTexts.length > 1 ? answerTexts.join('|||') : answerTexts[0] || '';
              } else if (q.type === 'multiple') {
                // 객관식: 1-indexed로 변환
                if (q.answerIndices && q.answerIndices.length > 1) {
                  // 복수정답
                  answer = q.answerIndices.map(i => i + 1).join(',');
                } else if (q.answerIndices && q.answerIndices.length === 1) {
                  // 단일정답 (answerIndices에서)
                  answer = q.answerIndices[0] + 1;
                } else if (q.answerIndex !== undefined && q.answerIndex >= 0) {
                  // 단일정답 (answerIndex에서)
                  answer = q.answerIndex + 1;
                } else {
                  answer = -1;
                }
              } else {
                // OX: 0 = O, 1 = X (그대로 저장)
                answer = q.answerIndex;
              }

              flattenedQuestions.push({
                order: orderIndex++,
                text: q.text,
                type: q.type === 'subjective' ? 'short_answer' : q.type,
                choices: q.type === 'multiple' ? q.choices.filter((c) => c.trim()) : null,
                answer,
                explanation: q.explanation || null,
                imageUrl: q.imageUrl || null,
                examples: q.examples ? {
                  type: q.examples.type,
                  items: q.examples.items.filter((item) => item.trim()),
                } : null,
              });
            }
          });

          return flattenedQuestions;
        })(),
        // 실제 문제 수 계산 (결합형 하위 문제 포함)
        questionCount: (() => {
          return questions.reduce((total, q) => {
            if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
              return total + q.subQuestions.length;
            }
            return total + 1;
          }, 0);
        })(),

        // 생성자 정보
        creatorId: user.uid,
        creatorNickname: profile?.nickname || user.displayName || '익명 용사',
        creatorClassType: profile?.classType || null,

        // 과목 정보
        courseId: userCourseId || null,

        // 통계 (초기값)
        participantCount: 0,
        averageScore: 0,
        completedUsers: [],
        userScores: {},

      };

      // undefined 값 제거 (Firestore는 undefined를 허용하지 않음)
      const cleanedQuizData = JSON.parse(JSON.stringify(quizData));

      // 타임스탬프 추가 (JSON 직렬화 후에 추가해야 함)
      cleanedQuizData.createdAt = serverTimestamp();
      cleanedQuizData.updatedAt = serverTimestamp();

      await addDoc(collection(db, 'quizzes'), cleanedQuizData);

      // EXP 토스트 표시 (퀴즈 생성 15 EXP)
      // Cloud Functions에서 자동으로 EXP가 지급됨
      const earnedExp = 15;
      showExpToast(earnedExp, '퀴즈 생성');

      // 저장된 초안 삭제
      deleteDraft();

      // 성공 시 퀴즈 목록 페이지로 이동
      setTimeout(() => {
        router.push('/quiz?created=true');
      }, 300);
    } catch (error) {
      console.error('퀴즈 저장 실패:', error);
      setSaveError('퀴즈 저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  }, [user, quizMeta, questions, router, userCourseId, showExpToast, deleteDraft]);

  /**
   * 단계별 진행률
   */
  const getProgress = () => {
    switch (step) {
      case 'upload':
        return 25;
      case 'questions':
        return 50;
      case 'meta':
        return 75;
      case 'confirm':
        return 100;
      default:
        return 0;
    }
  };

  // 페이지 애니메이션
  const pageVariants = {
    initial: { opacity: 0, x: 20 },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.3, ease: 'easeOut' },
    },
    exit: { opacity: 0, x: -20 },
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={handleBackButton}
            className="w-10 h-10 flex items-center justify-center border border-[#1A1A1A]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="font-serif-display text-lg font-bold text-[#1A1A1A]">퀴즈 만들기</h1>
          <div className="w-10" />
        </div>
      </header>

      {/* 진행률 바 */}
      <div className="sticky top-[57px] z-10 border-b border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="px-4 py-3">
          {/* 단계 표시 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-[#1A1A1A]">
              {step === 'upload' && '1. 업로드'}
              {step === 'questions' && '2. 문제 편집'}
              {step === 'meta' && '3. 퀴즈 정보'}
              {step === 'confirm' && '4. 확인'}
            </span>
            <span className="text-sm text-[#5C5C5C]">{getProgress()}%</span>
          </div>

          {/* 진행률 바 */}
          <div className="h-1.5 bg-[#EDEAE4] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getProgress()}%` }}
              transition={{ duration: 0.3 }}
              className="h-full bg-[#1A1A1A]"
            />
          </div>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* Step 1: 업로드 */}
          {step === 'upload' && (
            <motion.div
              key="upload"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
                  사진/PDF로 문제 추출
                </h2>
                <p className="text-sm text-[#5C5C5C]">
                  시험지나 교재 사진을 업로드하면 OCR로 텍스트를 추출합니다.
                </p>
              </div>

              {/* 이미지 업로더 */}
              <ImageUploader
                onFileSelect={handleFileSelect}
                isLoading={isOCRProcessing}
                error={ocrError}
              />

              {/* OCR 처리기 */}
              {selectedFile && (
                <OCRProcessor
                  file={selectedFile}
                  onComplete={handleOCRComplete}
                  onError={handleOCRError}
                  onCancel={handleOCRCancel}
                />
              )}

              {/* 직접 입력 버튼 */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#1A1A1A]" />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 text-sm text-[#5C5C5C]" style={{ backgroundColor: '#F5F0E8' }}>또는</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setStep('questions');
                  setIsAddingNew(true);
                }}
                disabled={isOCRProcessing}
                className="w-full py-3 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                직접 문제 입력하기
              </button>
            </motion.div>
          )}

          {/* Step 2: 문제 편집 */}
          {step === 'questions' && (
            <motion.div
              key="questions"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
                  문제 편집
                </h2>
                <p className="text-sm text-[#5C5C5C]">
                  문제를 추가하거나 수정하세요. 최소 3문제 이상 필요합니다.
                </p>
              </div>

              {/* 문제 편집기 (편집 또는 새 문제 추가 중일 때) */}
              <AnimatePresence>
                {(editingIndex !== null || isAddingNew) && (
                  <QuestionEditor
                    initialQuestion={
                      editingIndex !== null ? questions[editingIndex] : undefined
                    }
                    onSave={handleSaveQuestion}
                    onCancel={handleCancelEdit}
                    questionNumber={
                      editingIndex !== null ? editingIndex + 1 : questions.length + 1
                    }
                    userRole={profile?.role === 'professor' ? 'professor' : 'student'}
                  />
                )}
              </AnimatePresence>

              {/* 문제 목록 */}
              {editingIndex === null && !isAddingNew && (
                <>
                  <QuestionList
                    questions={questions}
                    onQuestionsChange={setQuestions}
                    onEditQuestion={handleEditQuestion}
                    userRole={profile?.role === 'professor' ? 'professor' : 'student'}
                  />

                  {/* 문제 추가 버튼 */}
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartAddQuestion}
                    className="w-full py-4 px-6 flex items-center justify-center gap-2 border-2 border-dashed border-[#1A1A1A] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    문제 추가
                  </motion.button>
                </>
              )}
            </motion.div>
          )}

          {/* Step 3: 퀴즈 정보 */}
          {step === 'meta' && (
            <motion.div
              key="meta"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
                  퀴즈 정보
                </h2>
                <p className="text-sm text-[#5C5C5C]">
                  퀴즈 제목과 태그를 입력하고 공개 여부를 설정하세요.
                </p>
              </div>

              <QuizMetaForm
                meta={quizMeta}
                onChange={setQuizMeta}
                errors={metaErrors}
              />
            </motion.div>
          )}

          {/* Step 4: 확인 */}
          {step === 'confirm' && (
            <motion.div
              key="confirm"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-6"
            >
              <div>
                <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">
                  퀴즈 확인
                </h2>
                <p className="text-sm text-[#5C5C5C]">
                  내용을 확인하고 퀴즈를 저장하세요.
                </p>
              </div>

              {/* 퀴즈 요약 카드 */}
              <div className="p-6 border border-[#1A1A1A] space-y-4" style={{ backgroundColor: '#F5F0E8' }}>
                {/* 제목 */}
                <div>
                  <span className="text-xs text-[#5C5C5C]">퀴즈 제목</span>
                  <p className="text-lg font-bold text-[#1A1A1A]">{quizMeta.title}</p>
                </div>

                {/* 태그 */}
                {quizMeta.tags.length > 0 && (
                  <div>
                    <span className="text-xs text-[#5C5C5C] mb-1 block">태그</span>
                    <div className="flex flex-wrap gap-2">
                      {quizMeta.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 border border-[#1A1A1A] text-[#1A1A1A] text-sm"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 정보 그리드 */}
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[#1A1A1A]">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-[#1A1A1A]">
                      {questions.length}
                    </p>
                    <p className="text-xs text-[#5C5C5C]">문제 수</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-[#1A1A1A]">
                      {quizMeta.difficulty === 'easy'
                        ? '쉬움'
                        : quizMeta.difficulty === 'hard'
                          ? '어려움'
                          : '보통'}
                    </p>
                    <p className="text-xs text-[#5C5C5C]">난이도</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-[#1A1A1A]">
                      {quizMeta.isPublic ? '공개' : '비공개'}
                    </p>
                    <p className="text-xs text-[#5C5C5C]">공개 설정</p>
                  </div>
                </div>
              </div>

              {/* 문제 미리보기 */}
              <div className="p-4 border border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
                <h3 className="font-bold text-[#1A1A1A] mb-3">문제 미리보기</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {questions.map((q, index) => (
                    <div
                      key={q.id}
                      className="flex items-start gap-2 p-2 bg-[#EDEAE4]"
                    >
                      <span className="w-6 h-6 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {index + 1}
                      </span>
                      <p className="text-sm text-[#1A1A1A] line-clamp-1 flex-1">
                        {q.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 저장 에러 */}
              {saveError && (
                <div className="p-3 border border-[#8B1A1A] text-[#8B1A1A] text-sm">
                  {saveError}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 하단 버튼 - 고정 */}
      <div className="sticky bottom-0 border-t-2 border-[#1A1A1A] px-4 py-4" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="max-w-lg mx-auto flex gap-3">
          {/* 이전 버튼 */}
          {step !== 'upload' && (
            <button
              type="button"
              onClick={handlePrevStep}
              disabled={isSaving}
              className="px-6 py-3 border-2 border-[#1A1A1A] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              이전
            </button>
          )}

          {/* 다음/저장 버튼 - upload 단계에서는 숨김 (직접 입력하기 버튼 사용) */}
          {step === 'upload' ? null : step !== 'confirm' ? (
            <button
              type="button"
              onClick={handleNextStep}
              disabled={
                (step === 'questions' && calculateTotalQuestionCount(questions) < 3) ||
                isOCRProcessing ||
                editingIndex !== null ||
                isAddingNew
              }
              className="flex-1 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              다음
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveQuiz}
              disabled={isSaving}
              className="flex-1 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSaving && (
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              퀴즈 저장하기
            </button>
          )}
        </div>
      </div>

      {/* 나가기 확인 모달 */}
      <AnimatePresence>
        {showExitModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            {/* 백드롭 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExitModal(false)}
              className="absolute inset-0 bg-black/50"
            />

            {/* 모달 */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 max-w-sm w-full"
            >
              <div className="text-center">
                {/* 아이콘 */}
                <div className="w-12 h-12 bg-[#FFF8E7] border-2 border-[#D4A84B] flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-[#D4A84B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>

                {/* 제목 */}
                <h3 className="text-lg font-bold text-[#1A1A1A] mb-2">
                  작성 중인 내용이 있습니다
                </h3>

                {/* 설명 */}
                <p className="text-sm text-[#5C5C5C] mb-6">
                  저장하지 않고 나가면 작성 중인 내용이 사라집니다.
                  <br />나중에 이어서 작성하시겠습니까?
                </p>

                {/* 버튼 */}
                <div className="space-y-2">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSaveAndExit}
                    className="w-full py-2.5 px-4 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
                  >
                    저장하고 나가기
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleExitWithoutSave}
                    className="w-full py-2.5 px-4 bg-[#EDEAE4] text-[#8B1A1A] font-bold border-2 border-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                  >
                    저장하지 않고 나가기
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowExitModal(false)}
                    className="w-full py-2.5 px-4 bg-[#EDEAE4] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                  >
                    계속 작성하기
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 초안 복원 모달 */}
      <AnimatePresence>
        {showResumeModal && savedDraftInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            {/* 백드롭 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50"
            />

            {/* 모달 */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 max-w-sm w-full"
            >
              <div className="text-center">
                {/* 아이콘 */}
                <div className="w-12 h-12 bg-[#E8F5E9] border-2 border-[#1A6B1A] flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-[#1A6B1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>

                {/* 제목 */}
                <h3 className="text-lg font-bold text-[#1A1A1A] mb-2">
                  이전 작성 내용이 있습니다
                </h3>

                {/* 진행 상황 정보 */}
                <div className="bg-[#EDEAE4] p-3 mb-4 text-left">
                  <p className="text-sm text-[#5C5C5C]">
                    {savedDraftInfo.title && (
                      <span className="block mb-1">
                        제목: <span className="text-[#1A1A1A] font-medium">{savedDraftInfo.title}</span>
                      </span>
                    )}
                    <span className="block">
                      문제 수: <span className="text-[#1A1A1A] font-medium">{savedDraftInfo.questionCount}개</span>
                    </span>
                  </p>
                </div>

                {/* 설명 */}
                <p className="text-sm text-[#5C5C5C] mb-6">
                  이어서 작성하시겠습니까?
                </p>

                {/* 버튼 */}
                <div className="flex gap-3">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartFresh}
                    className="flex-1 py-2.5 px-4 bg-[#EDEAE4] text-[#1A1A1A] font-bold border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                  >
                    처음부터
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleResumeDraft}
                    className="flex-1 py-2.5 px-4 bg-[#1A6B1A] text-[#F5F0E8] font-bold border-2 border-[#1A6B1A] hover:bg-[#145214] transition-colors"
                  >
                    이어서 작성
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
