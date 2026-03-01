'use client';

/**
 * 교수 서재 탭 — AI 문제 생성 + 관리
 *
 * 프롬프트 + 슬라이더(스타일/범위/포커스가이드/난이도/문제수)로 AI 문제 생성
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
  startLibraryJob,
  isLibraryJobActive,
  onLibraryJobEvent,
} from '@/lib/utils/libraryJobManager';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/common';
import MobileBottomSheet from '@/components/common/MobileBottomSheet';
import { getDefaultQuizTab } from '@/lib/types/course';
import { generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import { useKeyboardAware } from '@/lib/hooks/useKeyboardAware';
import PreviewQuestionCard from '@/components/professor/PreviewQuestionCard';

// ============================================================
// 타입
// ============================================================

interface SliderWeights {
  style: number;           // 0-100 (출제 스타일)
  scopeFocusGuide: number; // 0-100 (낮=scope중심, 높=focusGuide중심)
  questionCount: number;   // 5-20
}

// ============================================================
// 유틸
// ============================================================

/** 넓게↔핵심 슬라이더 라벨 */
function getScopeFocusLabel(value: number): string {
  if (value < 30) return '넓게 출제';
  if (value < 70) return '균형';
  return '핵심만 출제';
}

/** 신문 배경 텍스트 */
const NEWSPAPER_BG_TEXT = `The cell membrane, also known as the plasma membrane, is a biological membrane that separates and protects the interior of all cells from the outside environment. The cell membrane consists of a lipid bilayer, including cholesterols that sit between phospholipids to maintain their fluidity at various temperatures. The membrane also contains membrane proteins, including integral proteins that span the membrane serving as membrane transporters, and peripheral proteins that loosely attach to the outer side of the cell membrane, acting as enzymes to facilitate interaction with the cell's environment.`;

/** AI 기본 제목 판별 (날짜 형식이면 serif 비적용) */
function isDefaultAiTitle(title: string): boolean {
  return /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*\d{1,2}:\d{2}$/.test(title.trim());
}

/** 문제 유형 라벨 */
function formatQuestionTypes(questions: any[]): string {
  let ox = 0, mc = 0, sa = 0;
  for (const q of questions) {
    if (q.type === 'ox') ox++;
    else if (q.type === 'multiple') mc++;
    else if (q.type === 'short_answer') sa++;
  }
  const parts: string[] = [];
  if (ox > 0) parts.push(`OX ${ox}`);
  if (mc > 0) parts.push(`객관식 ${mc}`);
  if (sa > 0) parts.push(`주관식 ${sa}`);
  return parts.length > 0 ? parts.join(' / ') : `${questions.length}문제`;
}

// ============================================================
// 컴포넌트
// ============================================================

export default function ProfessorLibraryTab({
  onPreviewChange,
  isPreviewActive,
  onPublish,
}: {
  onPreviewChange?: (active: boolean) => void;
  isPreviewActive?: boolean;
  onPublish?: () => void;
}) {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId, userCourse } = useCourse();
  const { quizzes, loading: quizzesLoading, deleteQuiz, publishQuiz, updateTitle, updateQuestions, updateMeta } = useProfessorAiQuizzes();

  // 태그 옵션 (과목별)
  const editTagOptions = useMemo(() => {
    const courseTags = generateCourseTags(userCourseId);
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [userCourseId]);

  // 프롬프트
  const [prompt, setPrompt] = useState('');

  // 챕터 태그 (생성 시 필수)
  const [selectedGenTags, setSelectedGenTags] = useState<string[]>([]);
  const genTagOptions = useMemo(() => {
    const courseTags = generateCourseTags(userCourseId);
    // 챕터 태그만 (중간/기말/기타 제외)
    return courseTags;
  }, [userCourseId]);

  // 슬라이더
  const [sliders, setSliders] = useState<SliderWeights>({
    style: 50,
    scopeFocusGuide: 50,
    questionCount: 10,
  });

  // 난이도 — 태그 버튼 (별도 state)
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | null>(null);

  // 백그라운드 Job 진행 상태 (libraryJobManager 이벤트 구독)
  const [isGenerating, setIsGenerating] = useState(() => isLibraryJobActive());
  const [progressStep, setProgressStep] = useState<'uploading' | 'analyzing' | 'generating'>('uploading');
  const [showProgressModal, setShowProgressModal] = useState(false);
  // 사용자가 모달을 직접 닫았으면 같은 Job 동안 다시 띄우지 않음
  const modalDismissedRef = useRef(false);

  // 모바일 키보드 인식
  const { isKeyboardOpen, bottomOffset, dismissKeyboard } = useKeyboardAware();
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isPromptFocused, setIsPromptFocused] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'slider' | 'tags' | null>(null);

  // Job 이벤트 구독 — 완료/실패 시 isGenerating 해제
  useEffect(() => {
    const unsub = onLibraryJobEvent((event) => {
      if (event.type === 'started') {
        setIsGenerating(true);
        setProgressStep('analyzing');
        // handleGenerate에서 이미 모달을 띄우므로 여기서는 생략
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
  const [publishType, setPublishType] = useState<string>(() => {
    const tab = getDefaultQuizTab();
    return tab === 'final' ? 'final' : 'midterm';
  });
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);

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
  const [editedQuestions, setEditedQuestions] = useState<Record<number, { text?: string; choices?: string[]; explanation?: string; choiceExplanations?: string[] }>>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // 프리뷰 열기
  const openPreview = useCallback((quiz: ProfessorAiQuiz) => {
    setPreviewQuiz(quiz);
    setIsEditMode(false);
    setEditedTitle('');
    setEditedQuestions({});
    onPreviewChange?.(true);
  }, [onPreviewChange]);

  // 프리뷰 닫기
  const closePreview = useCallback(() => {
    setPreviewQuiz(null);
    setIsEditMode(false);
    setEditedTitle('');
    setEditedDescription('');
    setEditedTags([]);
    setEditedQuestions({});
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
    setEditedQuestions({});
  }, [previewQuiz]);

  // 수정 저장
  const handleSaveEdit = useCallback(async () => {
    if (!previewQuiz) return;
    setIsSavingEdit(true);
    try {
      // 제목 변경
      if (editedTitle && editedTitle !== previewQuiz.title) {
        await updateTitle(previewQuiz.id, editedTitle);
      }
      // 총평/태그 변경
      const descChanged = editedDescription !== (previewQuiz.description || '');
      const tagsChanged = JSON.stringify(editedTags) !== JSON.stringify(previewQuiz.tags || []);
      if (descChanged || tagsChanged) {
        await updateMeta(previewQuiz.id, {
          description: editedDescription,
          tags: editedTags,
        });
      }
      // 문제 변경
      const hasQuestionEdits = Object.keys(editedQuestions).length > 0;
      if (hasQuestionEdits) {
        const newQuestions = previewQuiz.questions.map((q: any, idx: number) => {
          const edit = editedQuestions[idx];
          if (!edit) return q;
          return {
            ...q,
            ...(edit.text !== undefined ? { text: edit.text } : {}),
            ...(edit.choices !== undefined ? { choices: edit.choices } : {}),
            ...(edit.explanation !== undefined ? { explanation: edit.explanation } : {}),
            ...(edit.choiceExplanations !== undefined ? { choiceExplanations: edit.choiceExplanations } : {}),
          };
        });
        await updateQuestions(previewQuiz.id, newQuestions);
      }
      setIsEditMode(false);
      setEditedTitle('');
      setEditedDescription('');
      setEditedTags([]);
      setEditedQuestions({});
    } catch (err: any) {
      alert('저장 실패: ' + (err?.message || ''));
    } finally {
      setIsSavingEdit(false);
    }
  }, [previewQuiz, editedTitle, editedDescription, editedTags, editedQuestions, updateTitle, updateQuestions, updateMeta]);

  // 부모에서 프리뷰 해제 시 내부 상태도 초기화
  useEffect(() => {
    if (isPreviewActive === false && previewQuiz) {
      setPreviewQuiz(null);
      setIsEditMode(false);
      setEditedTitle('');
      setEditedDescription('');
      setEditedTags([]);
      setEditedQuestions({});
    }
  }, [isPreviewActive]);

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
  // AI 문제 생성
  // ============================================================

  const handleGenerate = useCallback(async () => {
    if (!profile?.uid) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!prompt.trim()) {
      alert('프롬프트를 입력해주세요.');
      return;
    }
    if (selectedGenTags.length === 0) {
      alert('챕터 태그를 1개 이상 선택해주세요.\nAI가 정확한 범위에서 문제를 생성합니다.');
      return;
    }
    if (!difficulty) {
      alert('난이도를 선택해주세요.');
      return;
    }
    if (isLibraryJobActive()) {
      alert('이미 문제를 생성 중입니다.');
      return;
    }

    // 즉시 프로그레스 모달 표시
    modalDismissedRef.current = false;
    setShowProgressModal(true);
    setProgressStep('uploading');

    // 통합 슬라이더 → scope/focusGuide로 분리 (백엔드 호환)
    const scopeValue = Math.max(10, 100 - sliders.scopeFocusGuide);
    const focusGuideValue = Math.max(10, sliders.scopeFocusGuide);

    try {
      const enqueueJob = httpsCallable<
        {
          text?: string;
          images?: string[];
          difficulty: string;
          questionCount: number;
          courseId: string;
          courseName?: string;
          courseCustomized?: boolean;
          sliderWeights?: { style: number; scope: number; focusGuide: number; questionCount: number };
          professorPrompt?: string;
          tags?: string[];
        },
        { jobId: string; status: string; deduplicated: boolean }
      >(functions, 'enqueueGenerationJob');

      const enqueueResult = await enqueueJob({
        text: prompt.trim(),
        difficulty,
        questionCount: sliders.questionCount,
        courseId: userCourseId || 'biology',
        courseName: userCourse?.name || '일반',
        courseCustomized: true,
        sliderWeights: {
          style: sliders.style,
          scope: scopeValue,
          focusGuide: focusGuideValue,
          questionCount: sliders.questionCount,
        },
        professorPrompt: prompt.trim() || undefined,
        tags: selectedGenTags,
      });

      const { jobId } = enqueueResult.data;

      // 학기 계산
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const semester = month >= 3 && month <= 8 ? `${year}-1` : `${year}-2`;

      // 백그라운드 Job 매니저에 위임 (fire-and-forget)
      startLibraryJob(jobId, {
        uid: profile.uid,
        nickname: profile.nickname || '교수',
        courseId: userCourseId || 'biology',
        semester,
        questionCount: sliders.questionCount,
        difficulty,
        tags: selectedGenTags.length > 0 ? selectedGenTags : undefined,
      });

      // 입력 초기화
      setPrompt('');
      setSelectedGenTags([]);
      setMobilePanel(null);

    } catch (err: any) {
      setShowProgressModal(false);
      const msg = err?.message || 'Job 등록 중 오류가 발생했습니다.';
      if (msg.includes('횟수') || msg.includes('초과') || msg.includes('exhausted')) {
        alert(msg);
      } else {
        alert(`오류: ${msg}`);
      }
    }
  }, [profile, prompt, sliders, difficulty, userCourseId, userCourse, selectedGenTags]);

  // ============================================================
  // 슬라이더 라벨
  // ============================================================

  const getWeightLabel = (value: number): string => {
    if (value < 10) return 'OFF';
    if (value < 50) return '낮음';
    if (value < 75) return '보통';
    if (value < 95) return '높음';
    return '강력';
  };

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
            {isEditMode ? (
              <input
                type="text"
                autoFocus
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="w-2/3 text-3xl font-black text-[#1A1A1A] bg-transparent border-b-2 border-[#1A1A1A] outline-none"
              />
            ) : (
              <h2 className="text-3xl font-black text-[#1A1A1A] flex-1">
                {previewQuiz.title}
              </h2>
            )}
            {/* 연필 아이콘 + 휴지통 / 수정 모드 버튼 */}
            {!isEditMode ? (
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
            ) : (
              <div className="flex gap-1.5 flex-shrink-0">
                <button
                  onClick={() => {
                    setIsEditMode(false);
                    setEditedTitle('');
                    setEditedDescription('');
                    setEditedTags([]);
                    setEditedQuestions({});
                  }}
                  className="px-3.5 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors rounded-lg"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit}
                  className="px-3.5 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors rounded-lg"
                >
                  {isSavingEdit ? '저장 중...' : '저장'}
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

          {/* 수정 모드: 총평/태그 편집 */}
          {isEditMode && (
            <div className="space-y-4">
              {/* 총평 */}
              <div>
                <label className="block text-base font-bold text-[#1A1A1A] mb-2">총평</label>
                <input
                  type="text"
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  placeholder="학생들에게 전할 한마디를 입력하세요"
                  className="w-full bg-transparent border-b-2 border-[#D4CFC4] focus:border-[#1A1A1A] text-[#1A1A1A] placeholder:text-[#9A9A9A] outline-none text-base py-1.5 transition-colors"
                />
              </div>

              {/* 태그 */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="text-sm font-bold text-[#1A1A1A]">태그</label>
                  <button
                    type="button"
                    onClick={() => setShowEditTagPicker(!showEditTagPicker)}
                    className={`px-2 py-0.5 text-xs font-bold border rounded transition-colors ${
                      showEditTagPicker
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-transparent text-[#5C5C5C] border-[#D4CFC4] hover:border-[#1A1A1A]'
                    }`}
                  >
                    {showEditTagPicker ? '닫기' : '+ 추가'}
                  </button>
                </div>
                {editedTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {editedTags.map((tag) => (
                      <div
                        key={tag}
                        className="flex items-center gap-0.5 px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold rounded"
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
                      <div className="flex flex-wrap gap-1.5 p-2 bg-[#EDEAE4] border border-[#D4CFC4] rounded-lg">
                        {editTagOptions
                          .filter(tag => !editedTags.includes(tag))
                          .map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setEditedTags(prev => [...prev, tag])}
                              className="px-2 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors rounded"
                            >
                              #{tag}
                            </button>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          <p className="text-sm text-[#5C5C5C]">
            총 {questions.length}문제
          </p>
        </div>

        {/* 문제 카드 목록 */}
        <div className="space-y-2">
          {questions.map((q: any, idx: number) => (
            <PreviewQuestionCard
              key={q.id || `q${idx}`}
              question={q}
              questionNumber={idx + 1}
              isEditMode={isEditMode}
              editData={editedQuestions[idx]}
              onEditChange={isEditMode ? (field, value) => {
                setEditedQuestions(prev => ({
                  ...prev,
                  [idx]: { ...prev[idx], [field]: value },
                }));
              } : undefined}
            />
          ))}
        </div>

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

  const hasContent = !!prompt.trim();

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
                <div className="absolute top-2 right-2 z-20 w-7 h-7 flex items-center justify-center text-[#8B6914]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
                  </svg>
                </div>
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
      {/* 프롬프트 입력 — 플로팅 글래스 카드 */}
      {/* ============================================================ */}
      <div
        className="fixed left-3 right-3 z-40 rounded-2xl bg-[#F5F0E8]/80 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#D4CFC4]/60"
        style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {/* 선택된 태그 + 난이도 표시 */}
        {(selectedGenTags.length > 0 || difficulty) && (
          <div className="flex flex-wrap gap-1.5 px-3.5 pt-2.5">
            {selectedGenTags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedGenTags(prev => prev.filter(t => t !== tag))}
                className="flex items-center gap-0.5 px-2.5 py-1 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8] rounded-full hover:bg-[#3A3A3A] transition-colors"
              >
                #{tag}
                <span className="opacity-50 text-[9px] ml-0.5">✕</span>
              </button>
            ))}
            {difficulty && (
              <button
                onClick={() => setDifficulty(null)}
                className="flex items-center gap-0.5 px-2.5 py-1 text-[11px] font-bold bg-[#1A1A1A] text-[#F5F0E8] rounded-full hover:bg-[#3A3A3A] transition-colors"
              >
                #{difficulty === 'easy' ? '쉬움' : difficulty === 'medium' ? '보통' : '어려움'}
                <span className="opacity-50 text-[9px] ml-0.5">✕</span>
              </button>
            )}
          </div>
        )}

        {/* textarea */}
        <textarea
          ref={promptTextareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onFocus={() => setIsPromptFocused(true)}
          onBlur={() => setIsPromptFocused(false)}
          placeholder="AI에게 문제 생성 지시사항을 입력하세요..."
          className="w-full px-4 pt-2.5 pb-1 text-sm text-[#1A1A1A] placeholder-[#999] bg-transparent outline-none resize-none"
          rows={2}
        />

        {/* 하단 바: 슬라이더 > 태그 + 생성 */}
        <div className="flex items-center justify-between px-3 pb-2.5">
          <div className="flex items-center gap-1">
            {/* 슬라이더 아이콘 → MobileBottomSheet */}
            <button
              onClick={() => setMobilePanel(mobilePanel === 'slider' ? null : 'slider')}
              className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors ${
                mobilePanel === 'slider' ? 'bg-[#1A1A1A] text-[#F5F0E8]' : 'text-[#5C5C5C] hover:bg-[#EDEAE4]/80'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
            {/* 태그 아이콘 → MobileBottomSheet */}
            <button
              onClick={() => setMobilePanel(mobilePanel === 'tags' ? null : 'tags')}
              className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors relative ${
                mobilePanel === 'tags' ? 'bg-[#1A1A1A] text-[#F5F0E8]' : (selectedGenTags.length > 0 || difficulty) ? 'text-[#1A1A1A]' : 'text-[#5C5C5C] hover:bg-[#EDEAE4]/80'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              {selectedGenTags.length > 0 && mobilePanel !== 'tags' && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#1A1A1A] text-[#F5F0E8] text-[9px] font-bold flex items-center justify-center rounded-full">
                  {selectedGenTags.length}
                </span>
              )}
            </button>
          </div>

          {/* 생성 버튼 */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !hasContent || !difficulty || selectedGenTags.length === 0}
            className={`px-5 py-2 text-sm font-bold rounded-xl transition-colors ${
              isGenerating || !hasContent || !difficulty || selectedGenTags.length === 0
                ? 'bg-[#D4CFC4]/80 text-[#999] cursor-not-allowed'
                : 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
            }`}
          >
            {isGenerating ? '생성 중...' : '생성'}
          </button>
        </div>

        {/* 태그/난이도 미선택 안내 */}
        {hasContent && (selectedGenTags.length === 0 || !difficulty) && !isGenerating && (
          <p className="text-xs text-[#999] px-4 pb-2 text-right">
            {selectedGenTags.length === 0 && !difficulty
              ? '태그 아이콘에서 챕터·난이도를 설정해주세요'
              : selectedGenTags.length === 0
                ? '태그 아이콘에서 챕터를 선택해주세요'
                : '태그 아이콘에서 난이도를 선택해주세요'}
          </p>
        )}
      </div>

      {/* ============================================================ */}
      {/* 모바일: 키보드 위 플로팅 툴바 */}
      {/* ============================================================ */}
      {typeof document !== 'undefined' && isPromptFocused && isKeyboardOpen && createPortal(
        <div
          className="fixed left-3 right-3 z-50 flex items-center justify-between px-3 py-2 rounded-2xl bg-[#F5F0E8]/80 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-[#D4CFC4]/60"
          style={{ bottom: bottomOffset }}
        >
          <div className="flex items-center gap-1">
            {/* 슬라이더 */}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { dismissKeyboard(); setMobilePanel('slider'); }}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-[#5C5C5C] hover:bg-[#EDEAE4]/80 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
            {/* 태그 */}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { dismissKeyboard(); setMobilePanel('tags'); }}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors relative text-[#5C5C5C] hover:bg-[#EDEAE4]/80"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              {selectedGenTags.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#1A1A1A] text-[#F5F0E8] text-[9px] font-bold flex items-center justify-center rounded-full">
                  {selectedGenTags.length}
                </span>
              )}
            </button>
          </div>
          {/* 생성 */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { dismissKeyboard(); handleGenerate(); }}
            disabled={isGenerating || !hasContent || !difficulty || selectedGenTags.length === 0}
            className={`px-5 py-2 text-sm font-bold rounded-xl transition-colors ${
              isGenerating || !hasContent || !difficulty || selectedGenTags.length === 0
                ? 'bg-[#D4CFC4]/80 text-[#999] cursor-not-allowed'
                : 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
            }`}
          >
            {isGenerating ? '생성 중...' : '생성'}
          </button>
        </div>,
        document.body,
      )}

      {/* ============================================================ */}
      {/* 슬라이더 바텀시트 */}
      {/* ============================================================ */}
      <MobileBottomSheet open={mobilePanel === 'slider'} onClose={() => setMobilePanel(null)}>
        <div className="p-4 space-y-4">
          <SliderRow
            label="출제 스타일"
            value={sliders.style}
            weightLabel={getWeightLabel(sliders.style)}
            onChange={(v) => setSliders(prev => ({ ...prev, style: v }))}
          />
          <SliderRow
            label="출제 범위"
            value={sliders.scopeFocusGuide}
            weightLabel={getScopeFocusLabel(sliders.scopeFocusGuide)}
            onChange={(v) => setSliders(prev => ({ ...prev, scopeFocusGuide: v }))}
          />
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold text-[#1A1A1A]">문제 수</span>
              <span className="text-sm font-bold text-[#1A1A1A]">{sliders.questionCount}문제</span>
            </div>
            <input
              type="range"
              min={5}
              max={20}
              step={1}
              value={sliders.questionCount}
              onChange={(e) => setSliders(prev => ({ ...prev, questionCount: parseInt(e.target.value) }))}
              className="w-full h-2 bg-[#D4CFC4] appearance-none cursor-pointer accent-[#1A1A1A]"
              style={{
                background: `linear-gradient(to right, #1A1A1A 0%, #1A1A1A ${((sliders.questionCount - 5) / 15) * 100}%, #D4CFC4 ${((sliders.questionCount - 5) / 15) * 100}%, #D4CFC4 100%)`
              }}
            />
          </div>
        </div>
      </MobileBottomSheet>

      {/* ============================================================ */}
      {/* 태그/난이도 바텀시트 */}
      {/* ============================================================ */}
      <MobileBottomSheet open={mobilePanel === 'tags'} onClose={() => setMobilePanel(null)}>
        <div className="p-3 space-y-2">
          {/* 챕터 태그 */}
          <div>
            <span className="text-[11px] font-bold text-[#5C5C5C]">챕터</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {genTagOptions.map(tag => {
                const selected = selectedGenTags.includes(tag.value);
                return (
                  <button
                    key={tag.value}
                    onClick={() => setSelectedGenTags(prev =>
                      selected ? prev.filter(t => t !== tag.value) : [...prev, tag.value]
                    )}
                    className={`px-2 py-1 text-xs font-bold border-2 rounded transition-colors ${
                      selected
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-transparent text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* 구분선 */}
          <div className="border-t border-[#1A1A1A]" />
          {/* 난이도 */}
          <div>
            <span className="text-[11px] font-bold text-[#5C5C5C]">난이도</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {(['easy', 'medium', 'hard'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setDifficulty(prev => prev === d ? null : d)}
                  className={`px-2 py-1 text-xs font-bold border-2 rounded transition-colors ${
                    difficulty === d
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-transparent text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                  }`}
                >
                  #{d === 'easy' ? '쉬움' : d === 'medium' ? '보통' : '어려움'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </MobileBottomSheet>

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

            {/* 닫기 / 삭제 */}
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedDetailQuiz(null)}
                className="flex-1 py-2 text-xs font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors rounded-lg"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  setDeleteTarget(selectedDetailQuiz.id);
                  setSelectedDetailQuiz(null);
                }}
                className="flex-1 py-2 text-xs font-bold border-2 border-[#C44] text-[#C44] hover:bg-[#FEE] transition-colors rounded-lg"
              >
                삭제
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
                onClick={() => { setPublishTarget(null); setShowPublishDropdown(false); }}
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
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={async () => {
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
                {/* 공개 버튼 — 클릭 시 드롭다운 토글 */}
                <button
                  onClick={() => setShowPublishDropdown(!showPublishDropdown)}
                  className="w-full flex items-center justify-center gap-2 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors rounded-lg"
                >
                  공개
                  <svg className={`w-3 h-3 transition-transform ${showPublishDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    </div>
  );
}

// ============================================================
// 슬라이더 행 컴포넌트
// ============================================================

function SliderRow({
  label,
  value,
  weightLabel,
  onChange,
}: {
  label: string;
  value: number;
  weightLabel: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-[#1A1A1A]">{label}</span>
        <span className="text-xs font-bold text-[#5C5C5C]">{value}% ({weightLabel})</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-2 bg-[#D4CFC4] appearance-none cursor-pointer accent-[#1A1A1A]"
        style={{
          background: `linear-gradient(to right, #1A1A1A 0%, #1A1A1A ${value}%, #D4CFC4 ${value}%, #D4CFC4 100%)`
        }}
      />
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
