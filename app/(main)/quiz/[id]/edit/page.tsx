'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { Skeleton } from '@/components/common';
import QuestionEditor, { type QuestionData } from '@/components/quiz/create/QuestionEditor';
import QuestionList from '@/components/quiz/create/QuestionList';

/**
 * 퀴즈 수정 페이지 (학생용)
 */
export default function EditQuizPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const quizId = params.id as string;

  // 상태
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 퀴즈 데이터
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // 퀴즈 로드
  useEffect(() => {
    const loadQuiz = async () => {
      if (!quizId || !user) return;

      try {
        setIsLoading(true);
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));

        if (!quizDoc.exists()) {
          setError('퀴즈를 찾을 수 없습니다.');
          return;
        }

        const data = quizDoc.data();

        // 본인이 만든 퀴즈인지 확인
        if (data.creatorId !== user.uid) {
          setError('수정 권한이 없습니다.');
          return;
        }

        setTitle(data.title || '');

        // 문제 데이터 변환 (DB는 1-indexed, 내부는 0-indexed)
        const loadedQuestions: QuestionData[] = (data.questions || []).map((q: any, index: number) => {
          // 객관식: DB의 1-indexed를 0-indexed로 변환
          let answerIndex = -1;
          if (q.type === 'multiple' && typeof q.answer === 'number' && q.answer > 0) {
            answerIndex = q.answer - 1; // 1-indexed -> 0-indexed
          } else if (q.type === 'ox' && typeof q.answer === 'number') {
            answerIndex = q.answer; // OX는 0=O, 1=X로 그대로
          }

          return {
            id: q.id || `q_${index}`,
            text: q.text || '',
            type: q.type || 'multiple',
            choices: q.choices || ['', '', '', ''],
            answerIndex,
            answerText: typeof q.answer === 'string' ? q.answer : '',
            explanation: q.explanation || '',
            imageUrl: q.imageUrl || null,
            examples: q.examples || null,
          };
        });

        setQuestions(loadedQuestions);
      } catch (err) {
        console.error('퀴즈 로드 실패:', err);
        setError('퀴즈를 불러오는데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadQuiz();
  }, [quizId, user]);

  // 문제 편집 시작
  const handleEditQuestion = useCallback((index: number) => {
    setEditingIndex(index);
    setIsAddingNew(false);
  }, []);

  // 새 문제 추가 시작
  const handleStartAddQuestion = useCallback(() => {
    setIsAddingNew(true);
    setEditingIndex(null);
  }, []);

  // 문제 저장
  const handleSaveQuestion = useCallback(
    (question: QuestionData) => {
      if (editingIndex !== null) {
        setQuestions((prev) => {
          const newQuestions = [...prev];
          newQuestions[editingIndex] = question;
          return newQuestions;
        });
        setEditingIndex(null);
      } else {
        setQuestions((prev) => [...prev, question]);
        setIsAddingNew(false);
      }
    },
    [editingIndex]
  );

  // 편집 취소
  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setIsAddingNew(false);
  }, []);

  // 퀴즈 저장
  const handleSave = async () => {
    if (!user || !quizId) return;

    if (!title.trim()) {
      alert('퀴즈 제목을 입력해주세요.');
      return;
    }

    if (questions.length < 3) {
      alert('최소 3개 이상의 문제가 필요합니다.');
      return;
    }

    try {
      setIsSaving(true);

      const quizData = {
        title: title.trim(),
        questions: questions.map((q, index) => {
          // 정답 처리 (내부 0-indexed -> DB 1-indexed)
          let answer: string | number;
          if (q.type === 'subjective' || q.type === 'short_answer') {
            answer = q.answerText;
          } else if (q.type === 'multiple') {
            // 객관식: 0-indexed -> 1-indexed
            answer = q.answerIndex >= 0 ? q.answerIndex + 1 : -1;
          } else {
            // OX: 0=O, 1=X 그대로
            answer = q.answerIndex;
          }

          return {
            id: q.id,
            order: index,
            text: q.text,
            type: q.type,
            choices: q.type === 'multiple' ? q.choices.filter((c) => c.trim()) : null,
            answer,
            explanation: q.explanation || null,
            imageUrl: q.imageUrl || null,
            examples: q.examples || null,
          };
        }),
        questionCount: questions.length,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'quizzes', quizId), quizData);
      alert('퀴즈가 수정되었습니다.');
      router.push('/quiz');
    } catch (err) {
      console.error('퀴즈 저장 실패:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // 로딩 UI
  if (isLoading) {
    return (
      <div className="min-h-screen pb-20" style={{ backgroundColor: '#F5F0E8' }}>
        <header className="sticky top-0 z-20 border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
          <div className="flex items-center justify-between px-4 py-3">
            <Skeleton className="w-10 h-10 rounded-none" />
            <Skeleton className="w-32 h-6 rounded-none" />
            <Skeleton className="w-10 h-10 rounded-none" />
          </div>
        </header>
        <div className="px-4 py-6 space-y-4">
          <Skeleton className="w-full h-12 rounded-none" />
          <Skeleton className="w-full h-32 rounded-none" />
          <Skeleton className="w-full h-32 rounded-none" />
        </div>
      </div>
    );
  }

  // 에러 UI
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">오류</h2>
        <p className="text-[#5C5C5C] text-center mb-6">{error}</p>
        <button
          onClick={() => router.back()}
          className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold"
        >
          돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => {
              if (window.confirm('수정 중인 내용이 사라집니다. 나가시겠습니까?')) {
                router.back();
              }
            }}
            className="w-10 h-10 flex items-center justify-center border border-[#1A1A1A]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="font-bold text-lg text-[#1A1A1A]">퀴즈 수정</h1>
          <div className="w-10" />
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="px-4 py-6 max-w-lg mx-auto space-y-6">
        {/* 제목 입력 */}
        <div>
          <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
            퀴즈 제목
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="퀴즈 제목을 입력하세요"
            className="w-full px-4 py-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] outline-none focus:border-[#5C5C5C]"
          />
        </div>

        {/* 문제 편집기 */}
        <AnimatePresence>
          {(editingIndex !== null || isAddingNew) && (
            <QuestionEditor
              initialQuestion={editingIndex !== null ? questions[editingIndex] : undefined}
              onSave={handleSaveQuestion}
              onCancel={handleCancelEdit}
              questionNumber={editingIndex !== null ? editingIndex + 1 : questions.length + 1}
            />
          )}
        </AnimatePresence>

        {/* 문제 목록 */}
        {editingIndex === null && !isAddingNew && (
          <>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[#1A1A1A]">
                  문제 목록 ({questions.length}개)
                </h2>
                <span className="text-xs text-[#5C5C5C]">
                  최소 3문제 필요
                </span>
              </div>

              <QuestionList
                questions={questions}
                onQuestionsChange={setQuestions}
                onEditQuestion={handleEditQuestion}
              />
            </div>

            {/* 문제 추가 버튼 */}
            <button
              type="button"
              onClick={handleStartAddQuestion}
              className="w-full py-4 flex items-center justify-center gap-2 border-2 border-dashed border-[#1A1A1A] text-[#1A1A1A] font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              문제 추가
            </button>
          </>
        )}
      </main>

      {/* 하단 버튼 */}
      {editingIndex === null && !isAddingNew && (
        <div className="fixed bottom-0 left-0 right-0 border-t-2 border-[#1A1A1A] px-4 py-4 safe-area-pb" style={{ backgroundColor: '#F5F0E8' }}>
          <div className="max-w-lg mx-auto">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || questions.length < 3}
              className="w-full py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSaving && (
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              저장하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
