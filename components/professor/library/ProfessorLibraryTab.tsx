'use client';

/**
 * 교수 서재 탭 — AI 문제 생성 + 관리
 *
 * 프롬프트 + 챕터 태그 + 난이도/문제수 선택으로 AI 문제 생성
 * 백그라운드 Job 매니저(libraryJobManager)에 위임 → 다른 페이지로 이동해도 생성 계속됨
 * 생성된 퀴즈: 2열 그리드 + 신문 배경 카드 + Details 모달 + Preview 인라인 뷰
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useUser } from '@/lib/contexts';
import { useCourse } from '@/lib/contexts/CourseContext';
import { useProfessorAiQuizzes, ProfessorAiQuiz } from '@/lib/hooks/useProfessorAiQuizzes';
import {
  isLibraryJobActive,
  onLibraryJobEvent,
} from '@/lib/utils/libraryJobManager';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const QuizStatsModal = dynamic(() => import('@/components/quiz/manage/QuizStatsModal'), { ssr: false });
const QuestionEditor = dynamic(() => import('@/components/quiz/create/QuestionEditor'));
import { Skeleton } from '@/components/common';
import { getDefaultQuizTab, getPastExamOptions } from '@/lib/types/course';
import { generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import PreviewQuestionCard from '@/components/professor/PreviewQuestionCard';
import QuestionList from '@/components/quiz/create/QuestionList';
import type { QuestionData } from '@/components/quiz/create/questionTypes';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  NEWSPAPER_BG_TEXT,
  isDefaultAiTitle,
  formatQuestionTypes,
  convertToQuestionDataList,
} from './professorLibraryUtils';
import { isQuestionChanged, isQuestionChangedForSubQuestion, flattenQuestionsForSave } from '@/lib/utils/questionSerializer';

// ============================================================
// 컴포넌트
// ============================================================

export default function ProfessorLibraryTab({
  onPreviewChange,
  isPreviewActive,
  onPublish,
  onEditStateChange,
}: {
  onPreviewChange?: (active: boolean) => void;
  isPreviewActive?: boolean;
  onPublish?: () => void;
  onEditStateChange?: (state: { isEditMode: boolean; isSaving: boolean; onCancel: () => void; onSave: () => void } | null) => void;
}) {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId, userCourse } = useCourse();
  const { quizzes, loading: quizzesLoading, deleteQuiz, publishQuiz, unpublishQuiz, updateTitle, updateQuestions, updateMeta } = useProfessorAiQuizzes();

  // 태그 옵션 (과목별)
  const editTagOptions = useMemo(() => {
    const courseTags = generateCourseTags(userCourseId);
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [userCourseId]);

  // 백그라운드 Job 진행 상태 (libraryJobManager 이벤트 구독)
  const [isGenerating, setIsGenerating] = useState(() => isLibraryJobActive());
  const [progressStep, setProgressStep] = useState<'uploading' | 'analyzing' | 'generating'>('uploading');
  const [showProgressModal, setShowProgressModal] = useState(false);
  // 사용자가 모달을 직접 닫았으면 같은 Job 동안 다시 띄우지 않음
  const modalDismissedRef = useRef(false);

  // Job 이벤트 구독 — 완료/실패 시 isGenerating 해제
  useEffect(() => {
    const unsub = onLibraryJobEvent((event) => {
      if (event.type === 'started') {
        setIsGenerating(true);
        setProgressStep('analyzing');
      }
      if (event.type === 'progress' && event.step === 'generating') {
        setProgressStep('generating');
      }
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
        setIsGenerating(false);
        setShowProgressModal(false);
        modalDismissedRef.current = false;
      }
    });
    return unsub;
  }, []);

  // 공개 모달
  const [publishTarget, setPublishTarget] = useState<string | null>(null);
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);
  // 기출 선택 시 서브 드롭다운
  const [showPastSubDropdown, setShowPastSubDropdown] = useState(false);
  const [selectedPastExam, setSelectedPastExam] = useState<string | null>(null);

  // 비공개 전환 모달
  const [unpublishTarget, setUnpublishTarget] = useState<string | null>(null);

  // Stats 모달
  const [statsQuizId, setStatsQuizId] = useState<{ id: string; title: string } | null>(null);

  // 삭제 확인
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Details 모달
  const [selectedDetailQuiz, setSelectedDetailQuiz] = useState<ProfessorAiQuiz | null>(null);

  // 인라인 프리뷰
  const [previewQuiz, setPreviewQuiz] = useState<ProfessorAiQuiz | null>(null);

  // 수정 모드
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedTags, setEditedTags] = useState<string[]>([]);
  const [showEditTagPicker, setShowEditTagPicker] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  // QuestionList + QuestionEditor 기반 수정 모드
  const [editableQuestions, setEditableQuestions] = useState<QuestionData[]>([]);
  const [originalQuestions, setOriginalQuestions] = useState<any[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editType, setEditType] = useState<'midterm' | 'final' | 'past' | 'independent'>('midterm');
  const [editDifficulty, setEditDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [requireRetest, setRequireRetest] = useState(false);

  // 피드백 데이터: questionNumber(1-indexed) → { counts, otherTexts }
  const [feedbackByQuestion, setFeedbackByQuestion] = useState<Map<number, {
    counts: Record<string, number>;
    otherTexts: string[];
  }>>(new Map());

  // 프리뷰 퀴즈 변경 시 피드백 로드
  useEffect(() => {
    if (!previewQuiz?.id) { setFeedbackByQuestion(new Map()); return; }
    const load = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'questionFeedbacks'),
          where('quizId', '==', previewQuiz.id),
        ));
        const map = new Map<number, { counts: Record<string, number>; otherTexts: string[] }>();
        snap.forEach((d) => {
          const data = d.data();
          let qNum = 0;
          if (data.questionNumber > 0) qNum = data.questionNumber;
          else if (data.questionId) {
            const m = data.questionId.match(/^q(\d{1,3})$/);
            if (m) qNum = parseInt(m[1], 10) + 1;
          }
          if (qNum === 0) return;
          if (!map.has(qNum)) map.set(qNum, { counts: {}, otherTexts: [] });
          const entry = map.get(qNum)!;
          const type = data.type || data.feedbackType || 'other';
          entry.counts[type] = (entry.counts[type] || 0) + 1;
          if (type === 'other' && (data.content || data.feedback)) {
            entry.otherTexts.push(data.content || data.feedback);
          }
        });
        setFeedbackByQuestion(map);
      } catch (err) {
        console.error('[서재] 피드백 로드 실패:', err);
      }
    };
    load();
  }, [previewQuiz?.id]);

  // 프리뷰 열기
  const openPreview = useCallback((quiz: ProfessorAiQuiz) => {
    setPreviewQuiz(quiz);
    setIsEditMode(false);
    setEditedTitle('');
    setEditingIndex(null);
    onPreviewChange?.(true);
  }, [onPreviewChange]);

  // 프리뷰 닫기
  const closePreview = useCallback(() => {
    setPreviewQuiz(null);
    setIsEditMode(false);
    setEditedTitle('');
    setEditedDescription('');
    setEditedTags([]);
    setEditingIndex(null);
    onPreviewChange?.(false);
  }, [onPreviewChange]);

  // 수정 모드 진입
  const handleEnterEditMode = useCallback(() => {
    if (!previewQuiz) return;
    setIsEditMode(true);
    setEditedTitle(previewQuiz.title);
    setEditedDescription(previewQuiz.description || '');
    setEditedTags(previewQuiz.tags || []);
    setShowEditTagPicker(false);
    setEditingIndex(null);
    // 퀴즈 메타
    setEditType((previewQuiz as any).type || (previewQuiz as any).quizType || 'midterm');
    setEditDifficulty((previewQuiz as any).difficulty || 'normal');
    setRequireRetest(false);
    // 문제 변환
    const questions = previewQuiz.questions || [];
    setOriginalQuestions(questions);
    setEditableQuestions(convertToQuestionDataList(questions));
  }, [previewQuiz]);

  // 문제 편집 핸들러
  const handleEditQuestion = (index: number) => setEditingIndex(index);
  const handleAddQuestion = () => setEditingIndex(-1);
  const handleCancelEdit = () => setEditingIndex(null);
  const handleSaveQuestion = (question: QuestionData) => {
    if (editingIndex === -1) {
      setEditableQuestions(prev => [...prev, question]);
    } else if (editingIndex !== null) {
      setEditableQuestions(prev => prev.map((q, i) => i === editingIndex ? question : q));
    }
    setEditingIndex(null);
  };

  // 변경된 문제 ID 수집
  const getChangedQuestionIds = (): string[] => {
    const changedIds: string[] = [];
    editableQuestions.forEach((q) => {
      if (q.type === 'combined' && q.subQuestions) {
        q.subQuestions.forEach((sq) => {
          const originalQ = originalQuestions.find(oq => oq.id === sq.id);
          if (!originalQ || isQuestionChangedForSubQuestion(originalQ, sq)) {
            changedIds.push(sq.id);
          }
        });
      } else {
        const originalQ = originalQuestions.find(oq => oq.id === q.id);
        if (!originalQ || isQuestionChanged(originalQ, q)) {
          changedIds.push(q.id);
        }
      }
    });
    return changedIds;
  };

  // 수정 저장
  const handleSaveEdit = useCallback(async () => {
    if (!previewQuiz || editableQuestions.length < 1) return;
    setIsSavingEdit(true);
    try {
      // 변경된 문제 ID 수집 (저장 전에)
      const changedIds = getChangedQuestionIds();

      // 재시험 모드면 questionUpdatedAt 설정, 아니면 설정 안 함
      const flattenedQuestions = flattenQuestionsForSave(editableQuestions, originalQuestions, { trackChanges: true, useQuestionUpdatedAt: requireRetest, cleanupUndefined: true });
      // 제목 변경
      if (editedTitle && editedTitle !== previewQuiz.title) {
        await updateTitle(previewQuiz.id, editedTitle);
      }
      // 메타 변경
      const descChanged = editedDescription !== (previewQuiz.description || '');
      const tagsChanged = JSON.stringify(editedTags) !== JSON.stringify(previewQuiz.tags || []);
      const typeChanged = editType !== ((previewQuiz as any).type || (previewQuiz as any).quizType || 'midterm');
      const diffChanged = editDifficulty !== ((previewQuiz as any).difficulty || 'normal');
      if (descChanged || tagsChanged || typeChanged || diffChanged) {
        await updateMeta(previewQuiz.id, {
          description: editedDescription,
          tags: editedTags,
          type: editType,
          difficulty: editDifficulty,
        });
      }
      // 문제 저장
      await updateQuestions(previewQuiz.id, flattenedQuestions);

      // 재시험 모드가 아니고 변경된 문제가 있으면 → 재채점 CF 호출
      if (!requireRetest && changedIds.length > 0) {
        try {
          const regradeQuestionsFn = httpsCallable(functions, 'regradeQuestions');
          await regradeQuestionsFn({ quizId: previewQuiz.id, questionIds: changedIds });
        } catch (err) {
          console.warn('재채점 실패 (무시 가능):', err);
        }
      }

      setIsEditMode(false);
      setEditingIndex(null);
    } catch (err: any) {
      alert('저장 실패: ' + (err?.message || ''));
    } finally {
      setIsSavingEdit(false);
    }
  }, [previewQuiz, editedTitle, editedDescription, editedTags, editType, editDifficulty, editableQuestions, originalQuestions, requireRetest, updateTitle, updateQuestions, updateMeta]);

  // 부모에서 프리뷰 해제 시 내부 상태도 초기화
  useEffect(() => {
    if (isPreviewActive === false && previewQuiz) {
      setPreviewQuiz(null);
      setIsEditMode(false);
      setEditedTitle('');
      setEditedDescription('');
      setEditedTags([]);
      setEditingIndex(null);
    }
  }, [isPreviewActive]);

  // 수정 모드 상태를 부모에 전달
  useEffect(() => {
    if (isEditMode) {
      onEditStateChange?.({
        isEditMode: true,
        isSaving: isSavingEdit,
        onCancel: () => {
          setIsEditMode(false);
          setEditingIndex(null);
          setEditedTitle('');
          setEditedDescription('');
          setEditedTags([]);
        },
        onSave: handleSaveEdit,
      });
    } else {
      onEditStateChange?.(null);
    }
  }, [isEditMode, isSavingEdit, handleSaveEdit, onEditStateChange]);

  // previewQuiz가 onSnapshot으로 업데이트되면 반영 (updatedAt 비교로 불필요한 갱신 방지)
  useEffect(() => {
    if (!previewQuiz) return;
    const updated = quizzes.find(q => q.id === previewQuiz.id);
    if (!updated) return;
    // updatedAt 타임스탬프가 다를 때만 갱신
    const prevTime = previewQuiz.updatedAt?.seconds ?? previewQuiz.updatedAt?.getTime?.() ?? 0;
    const nextTime = updated.updatedAt?.seconds ?? updated.updatedAt?.getTime?.() ?? 0;
    if (nextTime !== prevTime) {
      setPreviewQuiz(updated);
    }
  }, [quizzes, previewQuiz]);

  // ============================================================
  // JSX — 인라인 프리뷰 모드
  // ============================================================

  if (previewQuiz) {
    const questions = previewQuiz.questions || [];
    return (
      <div className="flex-1 flex flex-col pb-8">
        {/* 제목 영역 (학생 서재 상세보기와 동일 — 연필 아이콘 포함) */}
        <div className="py-3">
          <div className="flex items-start gap-2">
            {/* 뒤로가기 화살표 (수정 모드에서는 숨김) */}
            {!isEditMode && (
              <button
                onClick={closePreview}
                className="mt-1 p-1 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-3xl font-black text-[#1A1A1A] flex-1">
              {isEditMode ? editedTitle : previewQuiz.title}
            </h2>
            {/* 연필 아이콘 + 휴지통 (보기 모드만) */}
            {!isEditMode && (
              <div className="flex gap-0.5 flex-shrink-0">
                <button
                  onClick={handleEnterEditMode}
                  className="p-1.5 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors"
                  title="수정 모드"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                <button
                  onClick={() => previewQuiz && setDeleteTarget(previewQuiz.id)}
                  className="p-1.5 text-[#5C5C5C] hover:text-[#C44] transition-colors"
                  title="퀴즈 삭제"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 총평 + 태그 + 총 N문제 */}
        <div className="py-3 space-y-3">
          {/* 보기 모드: 총평/태그 표시 */}
          {!isEditMode && (previewQuiz.description || (previewQuiz.tags && previewQuiz.tags.length > 0)) && (
            <div className="space-y-2">
              {previewQuiz.description && (
                <p className="text-base text-[#5C5C5C] italic">
                  &ldquo;{previewQuiz.description}&rdquo;
                </p>
              )}
              {previewQuiz.tags && previewQuiz.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {previewQuiz.tags.map((tag: string) => (
                    <span key={tag} className="px-2.5 py-1 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 수정 모드: 제목 + 시험유형 + 난이도 + 총평 + 태그 (외곽 박스 없음) */}
          {isEditMode && (
            <div className="space-y-4">
              {/* 퀴즈 제목 */}
              <div>
                <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
                  퀴즈 제목 <span className="text-[#8B1A1A]">*</span>
                </label>
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="예: 중간고사 대비 퀴즈"
                  className="w-full px-3 py-2.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm text-[#1A1A1A] placeholder:text-[#9A9A9A] outline-none focus:bg-[#FDFBF7]"
                />
              </div>
              {/* 시험 유형 */}
              <div>
                <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">시험 유형</label>
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { value: 'midterm' as const, label: '중간' },
                    { value: 'past' as const, label: '기출' },
                    { value: 'final' as const, label: '기말' },
                    { value: 'independent' as const, label: '단독' },
                  ]).map(({ value, label }) => (
                    <motion.button
                      key={value}
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setEditType(value)}
                      className={`py-2 px-3 font-bold text-xs border-2 transition-all duration-200 ${
                        editType === value
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                      }`}
                    >
                      {label}
                    </motion.button>
                  ))}
                </div>
              </div>
              {/* 난이도 */}
              <div>
                <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">난이도</label>
                <div className="flex gap-2">
                  {([
                    { value: 'easy' as const, label: '쉬움' },
                    { value: 'normal' as const, label: '보통' },
                    { value: 'hard' as const, label: '어려움' },
                  ]).map(({ value, label }) => (
                    <motion.button
                      key={value}
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setEditDifficulty(value)}
                      className={`flex-1 py-2 px-3 font-bold text-xs border-2 transition-all duration-200 ${
                        editDifficulty === value
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                      }`}
                    >
                      {label}
                    </motion.button>
                  ))}
                </div>
              </div>
              {/* 총평 */}
              <div>
                <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">총평 (선택)</label>
                <textarea
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  placeholder="학생들에게 전할 한마디를 입력하세요"
                  rows={2}
                  className="w-full px-3 py-2.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] placeholder:text-[#9A9A9A] outline-none focus:bg-[#FDFBF7] resize-none text-xs"
                />
              </div>
              {/* 태그 */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="text-xs font-bold text-[#1A1A1A]">태그</label>
                  <button
                    type="button"
                    onClick={() => setShowEditTagPicker(!showEditTagPicker)}
                    className={`px-2.5 py-0.5 text-xs font-bold border-2 transition-colors ${
                      showEditTagPicker
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-transparent text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                    }`}
                  >
                    {showEditTagPicker ? '닫기' : '+ 추가'}
                  </button>
                </div>
                {editedTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {editedTags.map((tag) => (
                      <div
                        key={tag}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold"
                      >
                        #{tag}
                        <button
                          type="button"
                          onClick={() => setEditedTags(prev => prev.filter(t => t !== tag))}
                          className="ml-0.5 hover:text-[#D4CFC4]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <AnimatePresence>
                  {showEditTagPicker && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap gap-1.5 p-2.5 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                        {editTagOptions
                          .filter(tag => !editedTags.includes(tag))
                          .map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setEditedTags(prev => [...prev, tag])}
                              className="px-2.5 py-1 text-xs font-bold bg-transparent text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                            >
                              #{tag}
                            </button>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 재시험 체크박스 */}
              <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={requireRetest}
                  onChange={(e) => setRequireRetest(e.target.checked)}
                  className="w-4 h-4 accent-[#1A1A1A]"
                />
                <span className="text-sm text-[#1A1A1A] font-medium">
                  재시험 (수정 이전 응답 제외 + 수정 뱃지 표시)
                </span>
              </label>
            </div>
          )}

          <p className="text-sm text-[#5C5C5C]">
            총 {isEditMode ? editableQuestions.length : questions.length}문제
          </p>
        </div>

        {/* 문제 카드 목록 */}
        {isEditMode ? (
          <div className="space-y-4">
            <AnimatePresence>
              {editingIndex !== null && (
                <QuestionEditor
                  initialQuestion={editingIndex >= 0 ? editableQuestions[editingIndex] : undefined}
                  questionNumber={editingIndex >= 0 ? editingIndex + 1 : editableQuestions.length + 1}
                  onSave={handleSaveQuestion}
                  onCancel={handleCancelEdit}
                  userRole="professor"
                  courseId={userCourseId || undefined}
                />
              )}
            </AnimatePresence>
            {editingIndex === null && (
              <QuestionList
                questions={editableQuestions}
                onQuestionsChange={setEditableQuestions}
                onEditQuestion={handleEditQuestion}
                userRole="professor"
                courseId={userCourseId || undefined}
              />
            )}
            {editingIndex === null && (
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={handleAddQuestion}
                className="w-full py-3 border-2 border-dashed border-[#1A1A1A] text-[#1A1A1A] font-bold text-sm hover:bg-[#EDEAE4] transition-colors"
              >
                + 새 문제 추가
              </motion.button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {questions.map((q: any, idx: number) => (
              <PreviewQuestionCard
                key={q.id || `q${idx}`}
                question={q}
                questionNumber={idx + 1}
                feedbackData={feedbackByQuestion.get(idx + 1)}
              />
            ))}
          </div>
        )}

        {/* 프리뷰 내 삭제 확인 모달 */}
        {deleteTarget && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-xl"
            >
              <div className="flex justify-center mb-3">
                <div className="w-9 h-9 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                  <svg className="w-4 h-4 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
              </div>
              <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-2">
                퀴즈를 삭제할까요?
              </h3>
              <p className="text-xs text-[#5C5C5C] mb-1">
                - 삭제된 퀴즈는 복구할 수 없습니다.
              </p>
              <p className="text-xs text-[#5C5C5C] mb-4">
                - 이미 푼 사람은 복습 가능합니다.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (deleteTarget) {
                      await deleteQuiz(deleteTarget);
                      setDeleteTarget(null);
                      closePreview();
                    }
                  }}
                  className="flex-1 py-1.5 text-xs font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors rounded-lg"
                >
                  삭제
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // JSX — 일반 모드 (카드 그리드)
  // ============================================================



  return (
    <div className="flex-1 flex flex-col pb-[140px]">
        {/* 백그라운드 생성 진행 인라인 뱃지 */}
        {isGenerating && !showProgressModal && (
          <div className="flex items-center gap-2 px-1 py-2 mb-4">
            <div className="w-3.5 h-3.5 flex-shrink-0 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-bold text-[#1A1A1A]">AI 문제 생성 중... 다른 페이지로 이동해도 계속 생성됩니다.</span>
          </div>
        )}

        {/* 생성된 퀴즈 카드 그리드 (2열) */}
        {quizzesLoading ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-48 rounded-none" />
            <Skeleton className="h-48 rounded-none" />
            <Skeleton className="h-48 rounded-none" />
            <Skeleton className="h-48 rounded-none" />
          </div>
        ) : quizzes.length === 0 && !isGenerating ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <svg className="w-12 h-12 text-[#D4CFC4] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-base font-bold text-[#1A1A1A] mb-1">아직 생성된 퀴즈가 없습니다</p>
            <p className="text-sm text-[#5C5C5C]">아래에서 프롬프트를 입력하고 문제를 생성해보세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {quizzes.map((quiz) => (
            <motion.div
              key={quiz.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)' }}
              transition={{ duration: 0.2 }}
              className="relative border border-[#999] bg-[#F5F0E8]/70 backdrop-blur-sm overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.06)] cursor-default rounded-xl"
            >
              {/* 신문 배경 텍스트 */}
              <div className="absolute inset-0 p-2 overflow-hidden pointer-events-none">
                <p className="text-[5px] text-[#E8E8E8] leading-tight break-words">
                  {NEWSPAPER_BG_TEXT.slice(0, 300)}
                </p>
              </div>

              {/* 공개 아이콘: 미공개=자물쇠, 공개됨=지구본 */}
              {!quiz.isPublished ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPublishTarget(quiz.id);
                  }}
                  className="absolute top-2 right-2 z-20 w-7 h-7 flex items-center justify-center text-[#5C5C5C] hover:text-[#1A1A1A] hover:scale-110 transition-all"
                  title="공개로 전환"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setUnpublishTarget(quiz.id);
                  }}
                  className="absolute top-2 right-2 z-20 w-7 h-7 flex items-center justify-center text-[#8B6914] hover:text-[#5C4A0A] hover:scale-110 transition-all"
                  title="비공개로 전환"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
                  </svg>
                </button>
              )}

              {/* 카드 내용 */}
              <div className="relative z-10 p-3 bg-[#F5F0E8]/60">
                {/* 제목 (2줄 고정 높이, AI 기본 제목은 serif 비적용) */}
                <div className="h-[36px] mb-1.5">
                  <h3 className="font-bold text-sm line-clamp-2 text-[#1A1A1A] leading-snug pr-8">
                    {quiz.title}
                  </h3>
                </div>

                {/* 메타 정보 */}
                <p className="text-xs text-[#5C5C5C] mb-1">
                  {quiz.questionCount}문제
                </p>

                {/* 태그 (2줄 고정 높이) */}
                <div className="h-[42px] mb-1.5 overflow-hidden">
                  {quiz.tags && quiz.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {quiz.tags.slice(0, 8).map((tag) => (
                        <span
                          key={tag}
                          className="px-1 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-[10px] font-medium"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 버튼 */}
                <div className="flex gap-1.5 mt-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDetailQuiz(quiz);
                    }}
                    className="flex-1 py-1.5 text-xs font-bold border border-[#3A3A3A] text-[#1A1A1A] bg-white/30 hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded-lg"
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPreview(quiz);
                    }}
                    className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
                  >
                    Preview
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {/* ============================================================ */}
      {/* 생성 진행 모달 (AIQuizProgress 재사용) */}
      {/* ============================================================ */}
      <LibraryProgressModal
        isOpen={showProgressModal}
        progress={progressStep}
        onClose={() => {
          setShowProgressModal(false);
          modalDismissedRef.current = true;
        }}
      />

      {/* ============================================================ */}
      {/* Details 모달 (학생 서재탭과 동일한 레이아웃) */}
      {/* ============================================================ */}
      {selectedDetailQuiz && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedDetailQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[300px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-xl"
          >
            <h2 className="text-base font-bold text-[#1A1A1A] mb-3">
              {selectedDetailQuiz.title}
            </h2>

            <div className="space-y-1.5 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{selectedDetailQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {{ easy: '쉬움', medium: '보통', hard: '어려움' }[selectedDetailQuiz.difficulty] || selectedDetailQuiz.difficulty}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedDetailQuiz.questions && selectedDetailQuiz.questions.length > 0
                    ? formatQuestionTypes(selectedDetailQuiz.questions)
                    : `${selectedDetailQuiz.questionCount}문제`}
                </span>
              </div>

              {/* 총평 */}
              <div className="flex justify-between text-xs">
                <span className="text-[#5C5C5C]">총평</span>
                {selectedDetailQuiz.description && (
                  <span className="font-bold text-[#1A1A1A]">
                    &ldquo;{selectedDetailQuiz.description}&rdquo;
                  </span>
                )}
              </div>

              {/* 태그 */}
              <div className="pt-2 border-t border-[#A0A0A0]">
                {selectedDetailQuiz.tags && selectedDetailQuiz.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedDetailQuiz.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-medium"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 닫기 / Stats */}
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedDetailQuiz(null)}
                className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                닫기
              </button>
              <button
                disabled={!(selectedDetailQuiz.isPublished || (selectedDetailQuiz as any).wasPublished)}
                onClick={() => {
                  setStatsQuizId({ id: selectedDetailQuiz.id, title: selectedDetailQuiz.title });
                  setSelectedDetailQuiz(null);
                }}
                className={`flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] rounded-lg transition-colors ${
                  selectedDetailQuiz.isPublished || (selectedDetailQuiz as any).wasPublished
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333]'
                    : 'opacity-50 cursor-not-allowed bg-[#D4CFC4] text-[#5C5C5C] border-[#999]'
                }`}
              >
                Stats
              </button>
            </div>
          </motion.div>
        </div>,
        document.body
      )}

      {/* ============================================================ */}
      {/* 공개 타입 선택 모달 */}
      {/* ============================================================ */}
      {publishTarget && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setPublishTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-xl"
          >
            {/* 지구본 아이콘 */}
            <div className="flex justify-center mb-3">
              <div className="w-9 h-9 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <svg className="w-4 h-4 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
                </svg>
              </div>
            </div>

            {/* 텍스트 */}
            <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-2">
              퀴즈를 공개할까요?
            </h3>
            <p className="text-center text-xs text-[#5C5C5C] mb-4">
              공개하면 다른 학생들도 풀 수 있어요.<br />참여 통계도 확인할 수 있어요.
            </p>

            {/* 버튼: 취소 + 공개(드롭다운) */}
            <div className="flex gap-2">
              <button
                onClick={() => { setPublishTarget(null); setShowPublishDropdown(false); setShowPastSubDropdown(false); setSelectedPastExam(null); }}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                취소
              </button>
              <div className="flex-1 relative">
                {/* 드롭다운 (위로 열림) */}
                {showPublishDropdown && (
                  <div className="absolute bottom-full left-0 w-full border-2 border-[#1A1A1A] border-b-0 bg-[#F5F0E8] rounded-t-lg overflow-hidden">
                    {[
                      { value: 'midterm', label: '중간 대비' },
                      { value: 'final', label: '기말 대비' },
                      { value: 'past', label: '기출' },
                      { value: 'independent', label: '단독' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={async () => {
                          // 기출 선택 시 서브 드롭다운 표시
                          if (opt.value === 'past') {
                            setShowPublishDropdown(false);
                            setShowPastSubDropdown(true);
                            return;
                          }
                          setShowPublishDropdown(false);
                          if (publishTarget) {
                            try {
                              await publishQuiz(publishTarget, opt.value);
                              onPublish?.();
                            } catch (err) {
                              console.error('퀴즈 공개 실패:', err);
                            } finally {
                              setPublishTarget(null);
                            }
                          }
                        }}
                        className="w-full py-2 text-xs font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                {/* 기출 서브 드롭다운 (위로 열림) */}
                {showPastSubDropdown && (
                  <div className="absolute bottom-full left-0 w-full border-2 border-[#1A1A1A] border-b-0 bg-[#F5F0E8] rounded-t-lg overflow-hidden max-h-[200px] overflow-y-auto">
                    {/* 뒤로가기 */}
                    <button
                      onClick={() => { setShowPastSubDropdown(false); setShowPublishDropdown(true); }}
                      className="w-full py-2 text-xs font-bold text-[#5C5C5C] hover:bg-[#EDEAE4] transition-colors flex items-center justify-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      기출 선택
                    </button>
                    <div className="border-t border-[#D4CFC4]" />
                    {getPastExamOptions(userCourseId).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={async () => {
                          setShowPastSubDropdown(false);
                          if (publishTarget) {
                            try {
                              await publishQuiz(publishTarget, 'past', { pastYear: opt.year, pastExamType: opt.examType });
                              onPublish?.();
                            } catch (err) {
                              console.error('퀴즈 공개 실패:', err);
                            } finally {
                              setPublishTarget(null);
                            }
                          }
                        }}
                        className="w-full py-2 text-xs font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                {/* 공개 버튼 — 클릭 시 드롭다운 토글 */}
                <button
                  onClick={() => {
                    setShowPastSubDropdown(false);
                    setShowPublishDropdown(!showPublishDropdown);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
                >
                  공개
                  <svg className={`w-3 h-3 transition-transform ${showPublishDropdown || showPastSubDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 삭제 확인 모달 */}
      {/* ============================================================ */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setDeleteTarget(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4"
          >
            <div className="flex justify-center mb-3">
              <div className="w-9 h-9 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <svg className="w-4 h-4 text-[#8B1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
            </div>
            <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-2">
              퀴즈를 삭제할까요?
            </h3>
            <p className="text-xs text-[#5C5C5C] mb-1">
              - 삭제된 퀴즈는 복구할 수 없습니다.
            </p>
            <p className="text-xs text-[#5C5C5C] mb-4">
              - 이미 푼 사람은 복습 가능합니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  if (deleteTarget) {
                    await deleteQuiz(deleteTarget);
                    setDeleteTarget(null);
                  }
                }}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] bg-[#F5F0E8] hover:bg-[#FDEAEA] transition-colors"
              >
                삭제
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 비공개 전환 확인 모달 */}
      {/* ============================================================ */}
      {unpublishTarget && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setUnpublishTarget(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[280px] bg-[#F5F0E8] border-2 border-[#1A1A1A] p-4 rounded-xl"
          >
            {/* 자물쇠 아이콘 */}
            <div className="flex justify-center mb-3">
              <div className="w-9 h-9 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4] rounded-lg">
                <svg className="w-4 h-4 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>
            <h3 className="text-center font-bold text-sm text-[#1A1A1A] mb-2">
              비공개로 전환할까요?
            </h3>
            <p className="text-center text-xs text-[#5C5C5C] mb-4">
              비공개 전환 시 학생들이 더 이상 풀 수 없어요.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setUnpublishTarget(null)}
                className="flex-1 py-1.5 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  if (unpublishTarget) {
                    try {
                      await unpublishQuiz(unpublishTarget);
                      onPublish?.();
                    } catch (err) {
                      console.error('비공개 전환 실패:', err);
                    } finally {
                      setUnpublishTarget(null);
                    }
                  }
                }}
                className="flex-1 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
              >
                비공개
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Stats 모달 */}
      {/* ============================================================ */}
      {statsQuizId && (
        <QuizStatsModal
          quizId={statsQuizId.id}
          quizTitle={statsQuizId.title}
          isOpen={!!statsQuizId}
          onClose={() => setStatsQuizId(null)}
          isProfessor
        />
      )}
    </div>
  );
}

// ============================================================
// 생성 진행 모달 (학생 AIQuizProgress 기반)
// ============================================================

const PROGRESS_MESSAGES = {
  uploading: {
    title: 'Job 등록 중...',
    subtitle: '문제 생성을 준비하고 있어요',
  },
  analyzing: {
    title: '자료 분석 중...',
    subtitle: '출제 스타일과 학습 범위를 분석하고 있어요',
  },
  generating: {
    title: '문제 생성 중...',
    subtitle: '열심히 문제를 만들고 있어요',
  },
};

function LibraryProgressModal({
  isOpen,
  progress,
  onClose,
}: {
  isOpen: boolean;
  progress: 'uploading' | 'analyzing' | 'generating';
  onClose: () => void;
}) {
  // 2초 후 자동으로 닫기 (토스트가 이어서 표시)
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(onClose, 2000);
    return () => clearTimeout(timer);
  }, [isOpen, onClose]);

  if (typeof window === 'undefined') return null;

  const { title, subtitle } = PROGRESS_MESSAGES[progress];

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] shadow-[4px_4px_0px_#1A1A1A] p-8"
          >
            <div className="flex flex-col items-center text-center">
              {/* 아이콘 + 스피너 */}
              <div className="relative mb-6">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  className="absolute -inset-4 border-2 border-[#1A1A1A] border-t-transparent rounded-full"
                />
                <div className="p-4 bg-white border-2 border-[#1A1A1A] rounded-full">
                  <svg className="w-12 h-12 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
              </div>

              <h3 className="text-xl font-bold text-[#1A1A1A] mb-2">{title}</h3>
              <p className="text-sm text-[#5C5C5C] mb-1">{subtitle}</p>
              <p className="text-xs text-[#999]">다른 페이지로 이동해도 계속 생성됩니다</p>

              {/* 진행 인디케이터 */}
              <div className="flex gap-2 mt-6">
                {(['uploading', 'analyzing', 'generating'] as const).map((step, idx) => {
                  const steps = ['uploading', 'analyzing', 'generating'];
                  const currentIdx = steps.indexOf(progress);
                  return (
                    <div
                      key={step}
                      className={`w-3 h-3 rounded-full transition-all ${
                        idx < currentIdx
                          ? 'bg-[#1A6B1A]'
                          : idx === currentIdx
                          ? 'bg-[#1A1A1A] animate-pulse'
                          : 'bg-[#E5E5E5]'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
