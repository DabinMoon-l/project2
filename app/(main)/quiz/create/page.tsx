'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { Header, Button } from '@/components/common';
import {
  ImageUploader,
  OCRProcessor,
  QuestionEditor,
  QuestionList,
  QuizMetaForm,
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

    // 파싱된 문제가 있으면 문제 목록에 추가
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
        })
      );

      setQuestions((prev) => [...prev, ...convertedQuestions]);
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
      // 최소 3문제 확인
      if (questions.length < 3) {
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
  }, [step, questions.length, quizMeta.title]);

  /**
   * 이전 단계로 이동
   */
  const handlePrevStep = useCallback(() => {
    if (step === 'questions') {
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

        // 문제 정보
        questions: questions.map((q, index) => ({
          order: index,
          text: q.text,
          type: q.type,
          choices: q.type === 'multiple' ? q.choices.filter((c) => c.trim()) : null,
          answer:
            q.type === 'subjective' ? q.answerText : q.answerIndex,
          explanation: q.explanation || null,
        })),
        questionCount: questions.length,

        // 생성자 정보
        creatorId: user.uid,
        creatorNickname: user.displayName || '익명 용사',

        // 통계 (초기값)
        participantCount: 0,
        averageScore: 0,
        completedUsers: [],
        userScores: {},

        // 타임스탬프
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'quizzes'), quizData);

      console.log('퀴즈 생성 완료:', docRef.id);

      // 성공 시 퀴즈 목록 페이지로 이동
      router.push('/quiz?created=true');
    } catch (error) {
      console.error('퀴즈 저장 실패:', error);
      setSaveError('퀴즈 저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSaving(false);
    }
  }, [user, quizMeta, questions, router]);

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
    <div className="min-h-screen bg-gray-50 pb-safe">
      {/* 헤더 */}
      <Header
        title="퀴즈 만들기"
        showBack
        onBack={() => {
          if (step !== 'upload' || questions.length > 0) {
            // 변경사항이 있으면 확인
            if (window.confirm('작성 중인 내용이 사라집니다. 나가시겠습니까?')) {
              router.back();
            }
          } else {
            router.back();
          }
        }}
      />

      {/* 진행률 바 */}
      <div className="sticky top-14 z-10 bg-white border-b border-gray-100">
        <div className="px-4 py-3">
          {/* 단계 표시 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              {step === 'upload' && '1. 업로드'}
              {step === 'questions' && '2. 문제 편집'}
              {step === 'meta' && '3. 퀴즈 정보'}
              {step === 'confirm' && '4. 확인'}
            </span>
            <span className="text-sm text-gray-500">{getProgress()}%</span>
          </div>

          {/* 진행률 바 */}
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getProgress()}%` }}
              transition={{ duration: 0.3 }}
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full"
            />
          </div>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      <main className="px-4 py-6 max-w-lg mx-auto">
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
                <h2 className="text-xl font-bold text-gray-800 mb-2">
                  사진/PDF로 문제 추출
                </h2>
                <p className="text-sm text-gray-500">
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
                />
              )}

              {/* 직접 입력 버튼 */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 bg-gray-50 text-sm text-gray-500">또는</span>
                </div>
              </div>

              <Button
                variant="secondary"
                fullWidth
                onClick={handleNextStep}
              >
                직접 문제 입력하기
              </Button>
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
                <h2 className="text-xl font-bold text-gray-800 mb-2">
                  문제 편집
                </h2>
                <p className="text-sm text-gray-500">
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
                  />

                  {/* 문제 추가 버튼 */}
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartAddQuestion}
                    className="
                      w-full py-4 px-6
                      flex items-center justify-center gap-2
                      bg-white border-2 border-dashed border-gray-300
                      rounded-2xl
                      text-gray-600 font-medium
                      hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600
                      transition-colors
                    "
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
                <h2 className="text-xl font-bold text-gray-800 mb-2">
                  퀴즈 정보
                </h2>
                <p className="text-sm text-gray-500">
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
                <h2 className="text-xl font-bold text-gray-800 mb-2">
                  퀴즈 확인
                </h2>
                <p className="text-sm text-gray-500">
                  내용을 확인하고 퀴즈를 저장하세요.
                </p>
              </div>

              {/* 퀴즈 요약 카드 */}
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
                {/* 제목 */}
                <div>
                  <span className="text-xs text-gray-500">퀴즈 제목</span>
                  <p className="text-lg font-bold text-gray-800">{quizMeta.title}</p>
                </div>

                {/* 태그 */}
                {quizMeta.tags.length > 0 && (
                  <div>
                    <span className="text-xs text-gray-500 mb-1 block">태그</span>
                    <div className="flex flex-wrap gap-2">
                      {quizMeta.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-lg text-sm"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 정보 그리드 */}
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-indigo-600">
                      {questions.length}
                    </p>
                    <p className="text-xs text-gray-500">문제 수</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-800">
                      {quizMeta.difficulty === 'easy'
                        ? '쉬움'
                        : quizMeta.difficulty === 'hard'
                          ? '어려움'
                          : '보통'}
                    </p>
                    <p className="text-xs text-gray-500">난이도</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-800">
                      {quizMeta.isPublic ? '공개' : '비공개'}
                    </p>
                    <p className="text-xs text-gray-500">공개 설정</p>
                  </div>
                </div>
              </div>

              {/* 문제 미리보기 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <h3 className="font-medium text-gray-700 mb-3">문제 미리보기</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {questions.map((q, index) => (
                    <div
                      key={q.id}
                      className="flex items-start gap-2 p-2 bg-gray-50 rounded-lg"
                    >
                      <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {index + 1}
                      </span>
                      <p className="text-sm text-gray-700 line-clamp-1 flex-1">
                        {q.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 저장 에러 */}
              {saveError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm">
                  {saveError}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 하단 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-4 pb-safe">
        <div className="max-w-lg mx-auto flex gap-3">
          {/* 이전 버튼 */}
          {step !== 'upload' && (
            <Button
              variant="secondary"
              onClick={handlePrevStep}
              disabled={isSaving}
            >
              이전
            </Button>
          )}

          {/* 다음/저장 버튼 */}
          {step !== 'confirm' ? (
            <Button
              fullWidth
              onClick={handleNextStep}
              disabled={
                (step === 'questions' && questions.length < 3) ||
                isOCRProcessing ||
                editingIndex !== null ||
                isAddingNew
              }
            >
              {step === 'upload' ? '다음' : step === 'questions' ? '다음' : '다음'}
            </Button>
          ) : (
            <Button
              fullWidth
              onClick={handleSaveQuiz}
              loading={isSaving}
              disabled={isSaving}
            >
              퀴즈 저장하기
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
