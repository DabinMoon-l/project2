'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useRouter, useParams } from 'next/navigation';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCourse } from '@/lib/contexts';
import { formatChapterLabel, generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';
import QuestionEditor, { type QuestionData, type SubQuestion } from '@/components/quiz/create/QuestionEditor';
import QuestionList from '@/components/quiz/create/QuestionList';
import { useProfessorQuiz, type QuizInput } from '@/lib/hooks/useProfessorQuiz';

// ============================================================
// 수정 나가기 확인 모달
// ============================================================

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 25 } },
  exit: { opacity: 0, scale: 0.95, y: 10, transition: { duration: 0.15 } },
};

function EditExitModal({
  isOpen,
  onClose,
  onSaveAndExit,
  onExitWithoutSave,
  isSaving,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaveAndExit: () => void;
  onExitWithoutSave: () => void;
  isSaving: boolean;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      modalRef.current?.focus();
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
      if (previousActiveElement.current) previousActiveElement.current.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isSaving]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            variants={backdropVariants}
            initial="hidden" animate="visible" exit="exit"
            onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onClose(); }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            ref={modalRef}
            variants={modalVariants}
            initial="hidden" animate="visible" exit="exit"
            role="alertdialog" aria-modal="true" tabIndex={-1}
            className="relative w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] shadow-xl overflow-hidden focus:outline-none"
          >
            <div className="flex justify-center pt-6">
              <div className="w-16 h-16 border-2 border-[#8B6914] bg-[#FFF8E1] flex items-center justify-center">
                <svg className="w-8 h-8 text-[#8B6914]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
            <div className="px-6 py-4 text-center">
              <h2 className="text-lg font-bold text-[#1A1A1A] mb-2">수정을 중단하시겠습니까?</h2>
              <p className="text-sm text-[#5C5C5C] leading-relaxed">
                저장하지 않으면 변경사항이<br />모두 사라집니다.
              </p>
            </div>
            <div className="flex flex-col gap-2 px-6 py-4 border-t-2 border-[#1A1A1A] bg-[#EDEAE4]">
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={onClose} disabled={isSaving}
                className="w-full py-3 font-bold text-[#F5F0E8] bg-[#1A1A1A] border-2 border-[#1A1A1A] transition-all duration-200 hover:bg-[#2A2A2A] disabled:opacity-50"
              >
                계속 수정하기
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={onSaveAndExit} disabled={isSaving}
                className="w-full py-3 font-bold bg-[#F5F0E8] text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#E5E0D8] transition-all duration-200 disabled:opacity-50 flex items-center justify-center"
              >
                {isSaving ? (
                  <>
                    <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    저장 중...
                  </>
                ) : '저장하고 나가기'}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={onExitWithoutSave} disabled={isSaving}
                className="w-full py-3 font-bold bg-[#F5F0E8] text-[#8B1A1A] border-2 border-[#8B1A1A] hover:bg-[#FDEAEA] transition-all duration-200 disabled:opacity-50"
              >
                저장하지 않고 나가기
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ============================================================
// 타입
// ============================================================

interface PreviewQuestion {
  id: string;
  number: number;
  question: string;
  type: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  /** 결합형 공통 지문 (첫 번째 문제에만) */
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
  passageMixedExamples?: any[];
  commonQuestion?: string;
  /** 문제 이미지 */
  image?: string;
  subQuestionOptions?: string[];
  subQuestionOptionsType?: 'text' | 'labeled' | 'mixed';
  mixedExamples?: any[];
  subQuestionImage?: string;
  chapterId?: string;
  chapterDetailId?: string;
  passagePrompt?: string;
  bogiQuestionText?: string;
  bogi?: {
    questionText?: string;
    items: Array<{ label: string; content: string }>;
  } | null;
  choiceExplanations?: string[];
  rubric?: Array<{ criteria: string; percentage: number; description?: string }>;
}

interface DisplayItem {
  type: 'single' | 'combined_group';
  result?: PreviewQuestion;
  results?: PreviewQuestion[];
  combinedGroupId?: string;
  displayNumber: number;
}

// ============================================================
// 유틸리티: Firestore 문제 → QuestionData 변환
// ============================================================

const convertToQuestionDataList = (rawQuestions: any[]): QuestionData[] => {
  const loadedQuestions: QuestionData[] = [];
  const processedCombinedGroups = new Set<string>();

  rawQuestions.forEach((q: any, index: number) => {
    if (q.combinedGroupId) {
      if (processedCombinedGroups.has(q.combinedGroupId)) return;
      processedCombinedGroups.add(q.combinedGroupId);

      const groupQuestions = rawQuestions
        .filter((gq: any) => gq.combinedGroupId === q.combinedGroupId)
        .sort((a: any, b: any) => (a.combinedIndex || 0) - (b.combinedIndex || 0));

      const firstQ = groupQuestions[0] as any;

      const subQuestions: SubQuestion[] = groupQuestions.map((sq: any) => {
        let answerIndex = -1;
        if (sq.type === 'multiple' && typeof sq.answer === 'number' && sq.answer > 0) {
          answerIndex = sq.answer - 1;
        } else if (sq.type === 'ox' && typeof sq.answer === 'number') {
          answerIndex = sq.answer;
        }
        return {
          id: sq.id || `${q.combinedGroupId}_${sq.combinedIndex || 0}`,
          text: sq.text || '',
          type: sq.type || 'multiple',
          choices: sq.choices || undefined,
          answerIndex: sq.type === 'multiple' || sq.type === 'ox' ? answerIndex : undefined,
          answerText: typeof sq.answer === 'string' ? sq.answer : undefined,
          explanation: sq.explanation || undefined,
          mixedExamples: sq.examples || sq.mixedExamples || undefined,
          image: sq.imageUrl || undefined,
          chapterId: sq.chapterId || undefined,
          chapterDetailId: sq.chapterDetailId || undefined,
          // 추가 필드 보존
          passagePrompt: sq.passagePrompt || undefined,
          bogi: sq.bogi || null,
          passageBlocks: sq.passageBlocks || undefined,
        };
      });

      loadedQuestions.push({
        id: q.combinedGroupId,
        text: firstQ.combinedMainText || '',
        type: 'combined',
        choices: [],
        answerIndex: -1,
        answerText: '',
        explanation: '',
        subQuestions,
        passageType: firstQ.passageType || undefined,
        passage: firstQ.passage || undefined,
        koreanAbcItems: firstQ.koreanAbcItems || undefined,
        passageMixedExamples: firstQ.passageMixedExamples || undefined,
        passageImage: firstQ.passageImage || undefined,
        commonQuestion: firstQ.commonQuestion || undefined,
      });
    } else {
      let answerIndex = -1;
      if (q.type === 'multiple' && typeof q.answer === 'number' && q.answer > 0) {
        answerIndex = q.answer - 1;
      } else if (q.type === 'ox' && typeof q.answer === 'number') {
        answerIndex = q.answer;
      }

      loadedQuestions.push({
        id: q.id || `q_${index}`,
        text: q.text || '',
        type: q.type || 'multiple',
        choices: q.choices || ['', '', '', ''],
        answerIndex,
        answerText: typeof q.answer === 'string' ? q.answer : '',
        explanation: q.explanation || '',
        imageUrl: q.imageUrl || null,
        examples: q.examples || null,
        mixedExamples: q.mixedExamples || null,
        chapterId: q.chapterId || undefined,
        chapterDetailId: q.chapterDetailId || undefined,
        // 추가 필드 보존 (수정 시 유실 방지)
        passagePrompt: q.passagePrompt || undefined,
        bogi: q.bogi || null,
        rubric: q.rubric || undefined,
        scoringMethod: q.scoringMethod || undefined,
        passageBlocks: q.passageBlocks || undefined,
      });
    }
  });

  return loadedQuestions;
};

// ============================================================
// 미리보기 페이지
// ============================================================

export default function QuizPreviewPage() {
  const router = useRouter();
  const params = useParams();
  const { userCourseId } = useCourse();
  const quizId = params.id as string;

  const [quizTitle, setQuizTitle] = useState('');
  const [averageScore, setAverageScore] = useState(0);
  const [participantCount, setParticipantCount] = useState(0);
  const [questions, setQuestions] = useState<PreviewQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set());

  // 수정 모드 상태
  const [isEditMode, setIsEditMode] = useState(false);
  const [rawQuizData, setRawQuizData] = useState<any>(null);
  const [editableQuestions, setEditableQuestions] = useState<QuestionData[]>([]);
  const [originalQuestions, setOriginalQuestions] = useState<any[]>([]);
  const [editTitle, setEditTitle] = useState('');
  const [editDifficulty, setEditDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editDescription, setEditDescription] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);

  const { updateQuiz, clearError } = useProfessorQuiz();

  // 태그 옵션 (과목별)
  const tagOptions = useMemo(() => {
    const courseId = userCourseId || 'biology';
    const courseTags = generateCourseTags(courseId);
    return [...COMMON_TAGS.map(t => t.value), ...courseTags.map(t => t.value)];
  }, [userCourseId]);

  // 선지별 해설 접두사 제거
  const stripChoicePrefix = (text: string) =>
    text.replace(/^선지\s*\d+\s*해설\s*[:：]\s*/i, '');

  // 퀴즈 문서 로드
  useEffect(() => {
    if (!quizId) return;

    const loadQuiz = async () => {
      try {
        setIsLoading(true);
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (!quizDoc.exists()) {
          setError('퀴즈를 찾을 수 없습니다.');
          return;
        }

        const data = quizDoc.data();
        setRawQuizData(data);
        setQuizTitle(data.title || '퀴즈');
        setAverageScore(data.averageScore || 0);
        setParticipantCount(data.participantCount || 0);

        const rawQuestions = data.questions || [];
        const parsed: PreviewQuestion[] = rawQuestions.map((q: any, index: number) => {
          // 정답 변환
          let correctAnswer: string = '';
          if (q.correctAnswer !== undefined && q.correctAnswer !== null) {
            correctAnswer = String(q.correctAnswer);
          } else if (q.answer !== undefined && q.answer !== null) {
            if (q.type === 'multiple') {
              if (Array.isArray(q.answer)) {
                correctAnswer = q.answer.map((a: number) => String(a + 1)).join(',');
              } else if (typeof q.answer === 'number') {
                correctAnswer = String(q.answer + 1);
              } else {
                correctAnswer = String(q.answer);
              }
            } else if (q.type === 'ox') {
              correctAnswer = q.answer === 0 ? 'O' : 'X';
            } else if (q.type === 'essay') {
              correctAnswer = '';
            } else {
              correctAnswer = String(q.answer);
            }
          }

          const result: PreviewQuestion = {
            id: q.id || `q${index}`,
            number: index + 1,
            question: q.text || q.question || '',
            type: q.type,
            options: (q.choices || q.options || []).filter((opt: any) => opt != null),
            correctAnswer,
            explanation: q.explanation || '',
            rubric: q.rubric || undefined,
            image: q.image || q.imageUrl || null,
            subQuestionOptions: (() => {
              if (q.mixedExamples && Array.isArray(q.mixedExamples) && q.mixedExamples.length > 0) return null;
              if (Array.isArray(q.examples)) return q.examples.filter((item: any) => item != null);
              if (q.examples && typeof q.examples === 'object' && Array.isArray(q.examples.items)) {
                return q.examples.items.filter((item: any) => item != null);
              }
              if (q.koreanAbcExamples && Array.isArray(q.koreanAbcExamples)) {
                return q.koreanAbcExamples.map((e: { text: string }) => e.text).filter((text: any) => text != null);
              }
              return q.subQuestionOptions || null;
            })(),
            subQuestionOptionsType: (() => {
              if (q.mixedExamples && Array.isArray(q.mixedExamples) && q.mixedExamples.length > 0) return 'mixed';
              if (Array.isArray(q.examples)) return 'text';
              if (q.examples && typeof q.examples === 'object' && q.examples.type) return q.examples.type;
              if (q.koreanAbcExamples && Array.isArray(q.koreanAbcExamples)) return 'labeled';
              return null;
            })(),
            mixedExamples: q.mixedExamples || null,
            subQuestionImage: q.subQuestionImage || null,
            chapterId: q.chapterId || null,
            chapterDetailId: q.chapterDetailId || null,
            passagePrompt: q.passagePrompt || null,
            bogiQuestionText: q.bogi?.questionText || null,
            bogi: q.bogi ? {
              questionText: q.bogi.questionText,
              items: (q.bogi.items || []).map((item: any) => ({
                label: item.label,
                content: item.content,
              })),
            } : null,
            choiceExplanations: q.choiceExplanations || null,
          };

          // 결합형 필드
          if (q.combinedGroupId) {
            result.combinedGroupId = q.combinedGroupId;
            result.combinedIndex = q.combinedIndex;
            result.combinedTotal = q.combinedTotal;
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
        });

        setQuestions(parsed);
      } catch (err) {
        console.error('퀴즈 로드 오류:', err);
        setError('퀴즈를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadQuiz();
  }, [quizId, reloadKey]);

  // displayItems: 결합형 그룹 처리
  const displayItems = useMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = [];
    const processedGroupIds = new Set<string>();
    let displayNumber = 0;

    questions.forEach((q) => {
      if (q.combinedGroupId) {
        if (processedGroupIds.has(q.combinedGroupId)) return;
        processedGroupIds.add(q.combinedGroupId);
        const groupResults = questions.filter((r) => r.combinedGroupId === q.combinedGroupId);
        displayNumber++;
        items.push({
          type: 'combined_group',
          results: groupResults,
          combinedGroupId: q.combinedGroupId,
          displayNumber,
        });
      } else {
        displayNumber++;
        items.push({ type: 'single', result: q, displayNumber });
      }
    });

    return items;
  }, [questions]);

  const totalCount = questions.length;

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroupExpand = (groupId: string) => {
    setExpandedGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  // ============================================================
  // 수정 모드 함수들
  // ============================================================

  const enterEditMode = () => {
    if (!rawQuizData) return;
    const converted = convertToQuestionDataList(rawQuizData.questions || []);
    setEditableQuestions(converted);
    setOriginalQuestions(rawQuizData.questions || []);
    setEditTitle(rawQuizData.title || '');
    setEditDifficulty(rawQuizData.difficulty || 'normal');
    setEditTags(rawQuizData.tags || []);
    setEditDescription(rawQuizData.description || '');
    setEditingIndex(null);
    setShowTagPicker(false);
    setIsEditMode(true);
  };

  // 저장하고 나가기
  const handleSaveAndExit = async () => {
    if (editableQuestions.length < 1) {
      alert('최소 1개 이상의 문제를 추가해주세요.');
      return;
    }
    try {
      setSaving(true);
      clearError();
      const flattenedQuestions = flattenQuestionsForSave();
      const quizInput: Partial<QuizInput> = {
        title: editTitle,
        description: editDescription,
        difficulty: editDifficulty,
        tags: editTags,
        questions: flattenedQuestions,
      };
      await updateQuiz(quizId, quizInput);
      setShowExitModal(false);
      setIsEditMode(false);
      setEditingIndex(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error('퀴즈 저장 실패:', err);
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  // 저장하지 않고 나가기
  const handleExitWithoutSave = () => {
    setShowExitModal(false);
    setIsEditMode(false);
    setEditingIndex(null);
  };

  // 수정 모드에서 브라우저 뒤로가기/새로고침 방지
  useEffect(() => {
    if (!isEditMode) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isEditMode]);

  const toggleEditMode = () => {
    if (isEditMode) {
      setShowExitModal(true);
    } else {
      enterEditMode();
    }
  };

  // 문제 편집 핸들러
  const handleEditQuestion = (index: number) => setEditingIndex(index);
  const handleAddQuestion = () => setEditingIndex(-1);
  const handleCancelEdit = () => setEditingIndex(null);
  const handleSaveQuestion = (question: QuestionData) => {
    if (editingIndex === -1) {
      setEditableQuestions((prev) => [...prev, question]);
    } else if (editingIndex !== null) {
      setEditableQuestions((prev) =>
        prev.map((q, i) => (i === editingIndex ? question : q))
      );
    }
    setEditingIndex(null);
  };

  // 태그 추가/삭제
  const handleRemoveTag = (tag: string) => {
    setEditTags((prev) => prev.filter((t) => t !== tag));
  };

  // 변경 감지
  const isQuestionChanged = (original: any | undefined, current: QuestionData): boolean => {
    if (!original) return true;
    if (original.text !== current.text) return true;
    if (original.type !== current.type) return true;
    if (current.type === 'subjective' || current.type === 'short_answer') {
      if (original.answer !== current.answerText) return true;
    } else if (current.type === 'multiple') {
      const origAnswer = typeof original.answer === 'number' ? original.answer - 1 : -1;
      if (origAnswer !== current.answerIndex) return true;
    } else {
      if (original.answer !== current.answerIndex) return true;
    }
    if (current.type === 'multiple') {
      const origChoices = original.choices || [];
      const currChoices = current.choices?.filter((c) => c.trim()) || [];
      if (origChoices.length !== currChoices.length) return true;
      for (let i = 0; i < currChoices.length; i++) {
        if (origChoices[i] !== currChoices[i]) return true;
      }
    }
    if ((original.explanation || '') !== (current.explanation || '')) return true;
    // 이미지 비교
    if ((original.imageUrl || null) !== (current.imageUrl || null)) return true;
    // 발문 비교
    if ((original.passagePrompt || '') !== (current.passagePrompt || '')) return true;
    // 보기/루브릭 비교
    if (JSON.stringify(original.bogi || null) !== JSON.stringify(current.bogi || null)) return true;
    if (JSON.stringify(original.rubric || null) !== JSON.stringify(current.rubric || null)) return true;
    return false;
  };

  const isQuestionChangedForSubQuestion = (original: any, current: SubQuestion): boolean => {
    if (!original) return true;
    if (original.text !== current.text) return true;
    if (original.type !== current.type) return true;
    if (current.type === 'subjective' || current.type === 'short_answer') {
      if (original.answer !== (current.answerText || '')) return true;
    } else if (current.type === 'multiple') {
      const origAnswer = typeof original.answer === 'number' ? original.answer - 1 : -1;
      if (origAnswer !== (current.answerIndex ?? -1)) return true;
    } else {
      if (original.answer !== (current.answerIndex ?? 0)) return true;
    }
    if (current.type === 'multiple') {
      const origChoices = original.choices || [];
      const currChoices = (current.choices || []).filter((c) => c.trim());
      if (origChoices.length !== currChoices.length) return true;
      for (let i = 0; i < currChoices.length; i++) {
        if (origChoices[i] !== currChoices[i]) return true;
      }
    }
    if ((original.explanation || '') !== (current.explanation || '')) return true;
    if ((original.imageUrl || null) !== (current.image || null)) return true;
    // 발문/보기 비교
    if ((original.passagePrompt || '') !== (current.passagePrompt || '')) return true;
    if (JSON.stringify(original.bogi || null) !== JSON.stringify(current.bogi || null)) return true;
    return false;
  };

  // QuestionData[] → Firestore 저장 형식 변환
  const flattenQuestionsForSave = (): any[] => {
    const flattenedQuestions: any[] = [];
    let orderIndex = 0;

    editableQuestions.forEach((q) => {
      if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
        const combinedGroupId = q.id || `combined_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const subQuestionsCount = q.subQuestions.length;

        // 결합형 공통 지문 변경 감지 (지문/이미지만 수정 시에도 뱃지 표시)
        let parentChanged = false;
        const origFirstQ = originalQuestions.find(
          (oq) => oq.combinedGroupId === combinedGroupId && (oq.combinedIndex === 0 || oq.combinedIndex === undefined)
        );
        if (!origFirstQ) {
          parentChanged = true;
        } else {
          if ((origFirstQ.passage || '') !== (q.passage || '')) parentChanged = true;
          if ((origFirstQ.passageImage || null) !== (q.passageImage || null)) parentChanged = true;
          if ((origFirstQ.commonQuestion || '') !== (q.commonQuestion || '')) parentChanged = true;
          if ((origFirstQ.combinedMainText || '') !== (q.text || '')) parentChanged = true;
          if (JSON.stringify(origFirstQ.koreanAbcItems || null) !== JSON.stringify(q.koreanAbcItems || null)) parentChanged = true;
          if (JSON.stringify(origFirstQ.passageMixedExamples || null) !== JSON.stringify(q.passageMixedExamples || null)) parentChanged = true;
        }

        q.subQuestions.forEach((sq, sqIndex) => {
          let answer: string | number;
          if (sq.type === 'subjective' || sq.type === 'short_answer') {
            answer = sq.answerText || '';
          } else if (sq.type === 'multiple') {
            answer = (sq.answerIndex !== undefined && sq.answerIndex >= 0) ? sq.answerIndex + 1 : -1;
          } else {
            answer = sq.answerIndex ?? 0;
          }

          const originalQ = originalQuestions.find((oq) => oq.id === sq.id);
          const hasChanged = parentChanged || !originalQ || isQuestionChangedForSubQuestion(originalQ, sq);

          const subQuestionData: any = {
            // 원본 필드 보존 (choiceExplanations 등 QuestionData에 없는 필드)
            ...(originalQ || {}),
            // 수정 가능한 필드 덮어쓰기
            id: sq.id || `${combinedGroupId}_${sqIndex}`,
            order: orderIndex++,
            text: sq.text,
            type: sq.type,
            choices: sq.type === 'multiple' ? (sq.choices || []).filter((c) => c.trim()) : undefined,
            answer,
            explanation: sq.explanation || undefined,
            imageUrl: sq.image || undefined,
            examples: sq.mixedExamples || undefined,
            mixedExamples: sq.mixedExamples || undefined,
            passagePrompt: sq.passagePrompt || undefined,
            bogi: sq.bogi || undefined,
            passageBlocks: sq.passageBlocks || undefined,
            combinedGroupId,
            combinedIndex: sqIndex,
            combinedTotal: subQuestionsCount,
            chapterId: sq.chapterId || undefined,
            chapterDetailId: sq.chapterDetailId || undefined,
            questionUpdatedAt: hasChanged ? Timestamp.now() : (originalQ?.questionUpdatedAt || null),
          };

          if (sqIndex === 0) {
            subQuestionData.passageType = q.passageType || undefined;
            subQuestionData.passage = q.passage || undefined;
            subQuestionData.koreanAbcItems = q.koreanAbcItems || undefined;
            subQuestionData.passageMixedExamples = q.passageMixedExamples || undefined;
            subQuestionData.passageImage = q.passageImage || undefined;
            subQuestionData.commonQuestion = q.commonQuestion || undefined;
            subQuestionData.combinedMainText = q.text || '';
          }

          flattenedQuestions.push(subQuestionData);
        });
      } else {
        let answer: string | number;
        if (q.type === 'subjective' || q.type === 'short_answer') {
          answer = q.answerText;
        } else if (q.type === 'multiple') {
          answer = q.answerIndex >= 0 ? q.answerIndex + 1 : -1;
        } else {
          answer = q.answerIndex;
        }

        // ID 기반 매칭만 사용 (인덱스 폴백 제거 — 삭제/순서변경 시 오매칭 방지)
        const originalQ = originalQuestions.find((oq) => oq.id === q.id);
        const hasChanged = !originalQ || isQuestionChanged(originalQ, q);

        flattenedQuestions.push({
          // 원본 필드 보존 (choiceExplanations 등 QuestionData에 없는 필드)
          ...(originalQ || {}),
          // 수정 가능한 필드 덮어쓰기
          id: q.id,
          order: orderIndex++,
          text: q.text,
          type: q.type,
          choices: q.type === 'multiple' ? q.choices?.filter((c) => c.trim()) : undefined,
          answer,
          explanation: q.explanation || undefined,
          imageUrl: q.imageUrl || undefined,
          examples: q.examples || undefined,
          mixedExamples: q.mixedExamples || undefined,
          passagePrompt: q.passagePrompt || undefined,
          bogi: q.bogi || undefined,
          rubric: q.rubric || undefined,
          scoringMethod: q.scoringMethod || undefined,
          passageBlocks: q.passageBlocks || undefined,
          chapterId: q.chapterId || undefined,
          chapterDetailId: q.chapterDetailId || undefined,
          questionUpdatedAt: hasChanged ? Timestamp.now() : (originalQ?.questionUpdatedAt || null),
        });
      }
    });

    return flattenedQuestions;
  };

  // 저장 핸들러
  const handleSave = async () => {
    if (editableQuestions.length < 1) {
      alert('최소 1개 이상의 문제를 추가해주세요.');
      return;
    }

    try {
      setSaving(true);
      clearError();

      const flattenedQuestions = flattenQuestionsForSave();

      const quizInput: Partial<QuizInput> = {
        title: editTitle,
        description: editDescription,
        difficulty: editDifficulty,
        tags: editTags,
        questions: flattenedQuestions,
      };

      await updateQuiz(quizId, quizInput);

      // 저장 성공 → 수정 모드 해제 + 데이터 리로드
      setIsEditMode(false);
      setEditingIndex(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error('퀴즈 저장 실패:', err);
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  // 문제 상세 렌더링
  const renderQuestionDetail = (q: PreviewQuestion) => {
    const groupedBlocks = q.mixedExamples?.filter(b => b.type === 'grouped') || [];
    const nonGroupedBlocks = q.mixedExamples?.filter(b => b.type !== 'grouped') || [];
    const hasMixedExamples = q.mixedExamples && q.mixedExamples.length > 0;

    return (
      <>
        {/* 묶은 보기 (grouped) */}
        {groupedBlocks.map((block: any) => (
          <div key={block.id} className="mb-3 p-3 border-2 border-[#1A1A1A] bg-[#FFF8E1]">
            <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
            <div className="space-y-1">
              {block.children?.map((child: any) => (
                <div key={child.id}>
                  {child.type === 'text' && child.content?.trim() && (
                    <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>
                  )}
                  {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                    <p key={item.id} className="text-sm text-[#1A1A1A]">
                      <span className="font-bold">{item.label}.</span> {item.content}
                    </p>
                  ))}
                  {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
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

        {/* 나머지 제시문 */}
        {nonGroupedBlocks.map((block: any) => {
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
                  {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
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
                  {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
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

        {/* 레거시 보기 - 텍스트 */}
        {!hasMixedExamples && q.subQuestionOptions && q.subQuestionOptions.length > 0 && q.subQuestionOptionsType === 'text' && (
          <div className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
            <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
            <p className="text-sm text-[#1A1A1A]">{q.subQuestionOptions.join(', ')}</p>
          </div>
        )}

        {/* 레거시 보기 - ㄱㄴㄷ */}
        {!hasMixedExamples && q.subQuestionOptions && q.subQuestionOptions.length > 0 && q.subQuestionOptionsType === 'labeled' && (
          <div className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
            <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
            <div className="space-y-1">
              {q.subQuestionOptions.map((itm, idx) => (
                <p key={idx} className="text-sm text-[#1A1A1A]">
                  <span className="font-bold">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ'][idx]}.</span> {itm}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* 문제 이미지 */}
        {q.image && (
          <div className="mb-3">
            <p className="text-xs font-bold text-[#5C5C5C] mb-2">문제 이미지</p>
            <img src={q.image} alt="문제 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
          </div>
        )}

        {/* 하위 문제 이미지 */}
        {q.subQuestionImage && (
          <div className="mb-3">
            <p className="text-xs font-bold text-[#5C5C5C] mb-2">이미지</p>
            <img src={q.subQuestionImage} alt="하위 문제 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
          </div>
        )}

        {/* 보기 (<보기> 박스) */}
        {q.bogi && q.bogi.items && q.bogi.items.some(i => i.content?.trim()) && (
          <div className="mb-3 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
            <p className="text-xs text-center text-[#5C5C5C] mb-2 font-bold">&lt;보 기&gt;</p>
            <div className="space-y-1">
              {q.bogi.items.filter(i => i.content?.trim()).map((item, idx) => (
                <p key={idx} className="text-sm text-[#1A1A1A]">
                  <span className="font-bold mr-1">{item.label}.</span>
                  {item.content}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* 발문 */}
        {(q.passagePrompt || q.bogiQuestionText) && (
          <div className="mb-3 p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
            <p className="text-sm text-[#1A1A1A]">
              {q.passagePrompt && q.bogiQuestionText
                ? `${q.passagePrompt} ${q.bogiQuestionText}`
                : q.passagePrompt || q.bogiQuestionText}
            </p>
          </div>
        )}

        {/* 선지 (객관식) — 정답만 강조 */}
        {q.options && q.options.length > 0 && (
          <div>
            {(() => {
              const correctAnswerStr = q.correctAnswer?.toString() || '';
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
              {q.options.map((opt, idx) => {
                const optionNum = (idx + 1).toString();
                const correctAnswerStr = q.correctAnswer?.toString() || '';
                const correctAnswers = correctAnswerStr.includes(',')
                  ? correctAnswerStr.split(',').map(a => a.trim())
                  : [correctAnswerStr];
                const isCorrectOption = correctAnswers.includes(optionNum);
                const isMultipleAnswer = correctAnswers.length > 1;
                const choiceExp = q.choiceExplanations?.[idx];
                const choiceKey = `${q.id}-${idx}`;
                const isChoiceExpanded = expandedChoices.has(choiceKey);

                return (
                  <div key={idx}>
                    <div
                      className={`text-sm p-2 border ${
                        isCorrectOption
                          ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]'
                          : 'border-[#EDEAE4] text-[#1A1A1A]'
                      } flex items-center justify-between ${choiceExp ? 'cursor-pointer' : ''}`}
                      onClick={choiceExp ? () => {
                        setExpandedChoices(prev => {
                          const next = new Set(prev);
                          if (next.has(choiceKey)) next.delete(choiceKey); else next.add(choiceKey);
                          return next;
                        });
                      } : undefined}
                    >
                      <span>
                        {idx + 1}. {opt}
                        {isMultipleAnswer && isCorrectOption && ' (정답)'}
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

        {/* OX 문제 — 정답만 강조 */}
        {q.type === 'ox' && (!q.options || q.options.length === 0) && (
          <div className="space-y-2">
            {(() => {
              const correctRaw = q.correctAnswer?.toString().toUpperCase() || '';
              const correctOX = correctRaw === '0' || correctRaw === 'O' ? 'O' : 'X';

              return (
                <div className="flex gap-3 justify-center py-2">
                  <div className={`w-20 h-20 flex items-center justify-center font-bold text-2xl border-2 ${
                    correctOX === 'O' ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]' : 'border-[#EDEAE4] bg-white text-[#5C5C5C]'
                  }`}>
                    O
                  </div>
                  <div className={`w-20 h-20 flex items-center justify-center font-bold text-2xl border-2 ${
                    correctOX === 'X' ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]' : 'border-[#EDEAE4] bg-white text-[#5C5C5C]'
                  }`}>
                    X
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* 주관식 — 정답 표시 (서술형 제외) */}
        {q.type !== 'ox' && q.type !== 'essay' && (!q.options || q.options.length === 0) && (
          <div className="space-y-2">
            {q.correctAnswer?.toString().includes('|||') ? (
              <p className="text-sm">
                <span className="text-[#5C5C5C]">정답: </span>
                <span className="font-bold text-[#1A6B1A]">
                  {q.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')}
                </span>
              </p>
            ) : (
              <p className="text-sm">
                <span className="text-[#5C5C5C]">정답: </span>
                <span className="font-bold text-[#1A6B1A]">{q.correctAnswer}</span>
              </p>
            )}
          </div>
        )}

        {/* 서술형: 루브릭 → 해설 (있는 것만) */}
        {q.type === 'essay' ? (
          <>
            {q.rubric && q.rubric.length > 0 && q.rubric.some(r => r.criteria.trim()) && (
              <div>
                <p className="text-xs font-bold text-[#5C5C5C] mb-1">평가 기준</p>
                <div className="bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
                  <ul className="space-y-1 text-sm">
                    {q.rubric.filter(r => r.criteria.trim()).map((item, idx) => (
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
            {q.explanation && (
              <div>
                <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                <p className="text-sm text-[#1A1A1A] bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
                  {q.explanation}
                </p>
              </div>
            )}
          </>
        ) : (
          /* 비서술형: 해설 항상 표시 */
          q.explanation ? (
            <div>
              <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
              <p className="text-sm text-[#1A1A1A] bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
                {q.explanation}
              </p>
            </div>
          ) : null
        )}
      </>
    );
  };

  // 로딩
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}>
        <motion.div className="flex flex-col items-center gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <motion.div
            className="w-12 h-12 border-4 border-[#1A1A1A] border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-[#5C5C5C] font-bold">문제 로딩 중...</p>
        </motion.div>
      </div>
    );
  }

  // 에러
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">오류 발생</h2>
        <p className="text-[#5C5C5C] text-center mb-6">{error}</p>
        <button
          onClick={() => router.back()}
          className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
        >
          돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isEditMode ? 'pb-24' : 'pb-8'}`} style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-50 w-full border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex items-center h-14 px-4">
          {isEditMode ? (
            <div className="w-12 h-12" />
          ) : (
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-sm text-[#1A1A1A] hover:text-[#5C5C5C] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              뒤로가기
            </button>
          )}
          <h1 className="flex-1 text-center text-base font-bold text-[#1A1A1A] truncate px-4">
            {isEditMode ? '퀴즈 수정' : '문제 미리보기'}
          </h1>
          <button
            onClick={toggleEditMode}
            className={`w-12 h-12 flex items-center justify-center transition-colors ${
              isEditMode ? 'text-[#8B1A1A]' : 'text-[#5C5C5C] hover:text-[#1A1A1A]'
            }`}
            aria-label={isEditMode ? '수정 모드 해제' : '수정 모드'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="px-4 pt-6 space-y-6"
      >
        {/* 퀴즈 정보 */}
        {isEditMode ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* 퀴즈 제목 + 난이도 + 총평 + 태그 */}
            <div className="border-2 border-[#1A1A1A] p-6 space-y-6 bg-[#F5F0E8]">
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                  퀴즈 제목 <span className="text-[#8B1A1A]">*</span>
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="예: 중간고사 대비 퀴즈"
                  className="w-full px-4 py-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] placeholder:text-[#9A9A9A] outline-none focus:bg-[#FDFBF7]"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">난이도</label>
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
                      className={`flex-1 py-2.5 px-4 font-bold text-sm border-2 transition-all duration-200 ${
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

              {/* 구분선 */}
              <div className="border-t-2 border-[#1A1A1A]" />

              {/* 총평 (선택) */}
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">총평 (선택)</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="학생들에게 전할 한마디를 입력하세요"
                  rows={2}
                  className="w-full px-4 py-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A] placeholder:text-[#9A9A9A] outline-none focus:bg-[#FDFBF7] resize-none text-sm"
                />
              </div>

              {/* 태그 (선택) */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-sm font-bold text-[#1A1A1A]">태그</label>
                  <button
                    type="button"
                    onClick={() => setShowTagPicker(!showTagPicker)}
                    className={`px-2.5 py-0.5 text-xs font-bold border-2 transition-colors ${
                      showTagPicker
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-transparent text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                    }`}
                  >
                    {showTagPicker ? '닫기' : '+ 추가'}
                  </button>
                </div>
                {editTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {editTags.map((tag) => (
                      <div
                        key={tag}
                        className="flex items-center gap-1 px-2.5 py-1 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold"
                      >
                        #{tag}
                        <button
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          className="ml-0.5 hover:text-[#D4CFC4]"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <AnimatePresence>
                  {showTagPicker && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap gap-2 p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8]">
                        {tagOptions
                          .filter(tag => !editTags.includes(tag))
                          .map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setEditTags(prev => [...prev, tag])}
                              className="px-3 py-1.5 text-sm font-bold bg-transparent text-[#1A1A1A] border-2 border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
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
          </motion.div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold text-[#1A1A1A]">{quizTitle}</h2>
              <p className="text-sm text-[#5C5C5C] mt-1">
                {totalCount}문제 · {participantCount}명 참여
                {rawQuizData?.difficulty && (
                  <span>
                    {' '}· {rawQuizData.difficulty === 'easy' ? '쉬움' : rawQuizData.difficulty === 'hard' ? '어려움' : '보통'}
                  </span>
                )}
              </p>
            </div>
            {(rawQuizData?.description || (rawQuizData?.tags && rawQuizData.tags.length > 0)) && (
              <div className="space-y-2">
                {rawQuizData?.description && (
                  <p className="text-sm text-[#5C5C5C] italic">
                    &ldquo;{rawQuizData.description}&rdquo;
                  </p>
                )}
                {rawQuizData?.tags && rawQuizData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {rawQuizData.tags.map((tag: string) => (
                      <span key={tag} className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 문제 리스트 */}
        {isEditMode ? (
          <div className="space-y-4">
            {/* 문제 편집기 */}
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

            {/* 문제 목록 */}
            {editingIndex === null && (
              <QuestionList
                questions={editableQuestions}
                onQuestionsChange={setEditableQuestions}
                onEditQuestion={handleEditQuestion}
                userRole="professor"
                courseId={userCourseId || undefined}
              />
            )}

            {/* 새 문제 추가 — 목록 아래 */}
            {editingIndex === null && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={handleAddQuestion}
                className="w-full p-4 border-2 border-dashed border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                새 문제 추가
              </motion.button>
            )}
          </div>
        ) : (
        <div className="space-y-3">
          <h3 className="font-bold text-[#1A1A1A]">문제 정보</h3>
          {displayItems.map((item) => {
            // 단일 문제
            if (item.type === 'single' && item.result) {
              const q = item.result;
              return (
                <div key={q.id}>
                  <button
                    onClick={() => toggleExpand(q.id)}
                    className="w-full border-2 border-[#1A1A1A] p-4 text-left bg-[#F5F0E8]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#1A1A1A]">
                          Q{item.displayNumber}
                        </span>
                        {/* 챕터 */}
                        {userCourseId && q.chapterId && (
                          <span className="px-1.5 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
                            {formatChapterLabel(userCourseId, q.chapterId, q.chapterDetailId)}
                          </span>
                        )}
                      </div>
                      <svg
                        className={`w-5 h-5 text-[#5C5C5C] transition-transform ${expandedIds.has(q.id) ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    <p className="text-sm text-[#1A1A1A] mt-2 line-clamp-2">
                      {q.question}
                      {(q.passagePrompt || q.bogiQuestionText) && (
                        <span className="ml-1 text-[#5C5C5C]">
                          {q.passagePrompt || q.bogiQuestionText}
                        </span>
                      )}
                    </p>
                  </button>

                  <AnimatePresence>
                    {expandedIds.has(q.id) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-2 border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-3">
                          {renderQuestionDetail(q)}
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
              const firstResult = groupResults[0];
              const isGroupExpanded = expandedGroupIds.has(groupId);

              return (
                <div key={groupId}>
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
                          {groupResults.length}문제
                        </span>
                      </div>
                      <svg
                        className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    {(firstResult.commonQuestion || firstResult.passagePrompt) && (
                      <p className="text-sm text-[#1A1A1A] mt-2 line-clamp-2">
                        {firstResult.commonQuestion || ''}
                        {firstResult.passagePrompt && (
                          <span className={firstResult.commonQuestion ? 'ml-1 text-[#5C5C5C]' : ''}>
                            {firstResult.passagePrompt}
                          </span>
                        )}
                      </p>
                    )}
                  </button>

                  <AnimatePresence>
                    {isGroupExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-4">
                          {/* 공통 지문 */}
                          {(firstResult.passage || firstResult.passageImage || firstResult.koreanAbcItems || (firstResult.passageMixedExamples && firstResult.passageMixedExamples.length > 0)) && (
                            <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                              <p className="text-xs font-bold text-[#8B6914] mb-2">
                                {firstResult.passageType === 'korean_abc' ? '보기' : '공통 지문'}
                              </p>
                              {firstResult.passage && firstResult.passageType !== 'korean_abc' && firstResult.passageType !== 'mixed' && (
                                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstResult.passage}</p>
                              )}
                              {firstResult.passageType === 'korean_abc' && firstResult.koreanAbcItems && firstResult.koreanAbcItems.length > 0 && (
                                <div className="space-y-1">
                                  {firstResult.koreanAbcItems.map((itm, idx) => (
                                    <p key={idx} className="text-sm text-[#1A1A1A]">
                                      <span className="font-bold">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ'][idx]}.</span> {itm}
                                    </p>
                                  ))}
                                </div>
                              )}
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
                              {firstResult.passageImage && (
                                <img src={firstResult.passageImage} alt="공통 이미지" className="mt-2 max-w-full h-auto border border-[#1A1A1A]" />
                              )}
                            </div>
                          )}

                          {/* 하위 문제들 */}
                          <div className="space-y-3 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
                            {groupResults.map((subQ, subIdx) => (
                              <div key={subQ.id}>
                                <button
                                  onClick={() => toggleExpand(subQ.id)}
                                  className="w-full border border-[#1A1A1A] p-3 text-left bg-[#F5F0E8]"
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-bold text-[#1A1A1A]">
                                        Q{item.displayNumber}-{subIdx + 1}
                                      </span>
                                      {userCourseId && subQ.chapterId && (
                                        <span className="px-1.5 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-[10px] font-medium">
                                          {formatChapterLabel(userCourseId, subQ.chapterId, subQ.chapterDetailId)}
                                        </span>
                                      )}
                                    </div>
                                    <svg
                                      className={`w-4 h-4 text-[#5C5C5C] transition-transform ${expandedIds.has(subQ.id) ? 'rotate-180' : ''}`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                  <p className="text-sm text-[#1A1A1A] mt-1 line-clamp-2">
                                    {subQ.question}
                                    {(subQ.passagePrompt || subQ.bogiQuestionText) && (
                                      <span className="ml-1 text-[#5C5C5C]">
                                        {subQ.passagePrompt || subQ.bogiQuestionText}
                                      </span>
                                    )}
                                  </p>
                                </button>

                                <AnimatePresence>
                                  {expandedIds.has(subQ.id) && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="border-2 border-t-0 border-[#1A1A1A] bg-white p-3 space-y-2">
                                        {renderQuestionDetail(subQ)}
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
        )}
      </motion.main>

      {/* 수정 모드 하단 저장 버튼 */}
      {isEditMode && editingIndex === null && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#F5F0E8] border-t-2 border-[#1A1A1A] z-50">
          <button
            onClick={handleSave}
            disabled={saving || editableQuestions.length === 0}
            className={`w-full py-3 font-bold border-2 border-[#1A1A1A] transition-colors ${
              saving || editableQuestions.length === 0
                ? 'bg-[#D4CFC4] text-[#5C5C5C] cursor-not-allowed'
                : 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333]'
            }`}
          >
            {saving ? '저장 중...' : '변경사항 저장'}
          </button>
          {editableQuestions.length === 0 && (
            <p className="text-xs text-center text-[#5C5C5C] mt-2">
              최소 1개 이상의 문제가 필요합니다
            </p>
          )}
        </div>
      )}

      {/* 수정 나가기 확인 모달 */}
      <EditExitModal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        onSaveAndExit={handleSaveAndExit}
        onExitWithoutSave={handleExitWithoutSave}
        isSaving={saving}
      />
    </div>
  );
}
