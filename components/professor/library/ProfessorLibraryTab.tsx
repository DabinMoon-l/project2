'use client';

/**
 * 교수 서재 탭 — AI 문제 생성 + 관리
 *
 * 프롬프트 + 슬라이더(스타일/범위/포커스가이드/난이도/문제수)로 AI 문제 생성
 * 백그라운드 Job 매니저(libraryJobManager)에 위임 → 다른 페이지로 이동해도 생성 계속됨
 * 생성된 퀴즈: 2열 그리드 + 신문 배경 카드 + Details 모달 + Preview 인라인 뷰
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
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
import { getDefaultQuizTab } from '@/lib/types/course';
import { generateCourseTags, COMMON_TAGS } from '@/lib/courseIndex';

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

// 선지 번호 라벨 (최대 8개 지원)
const choiceLabels = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

// ============================================================
// 인라인 프리뷰 문제 카드 (학생 QuestionCard와 동일)
// ============================================================

function PreviewQuestionCard({
  question,
  questionNumber,
  isEditMode,
  editData,
  onEditChange,
}: {
  question: any;
  questionNumber: number;
  isEditMode?: boolean;
  editData?: { text?: string; choices?: string[]; explanation?: string; choiceExplanations?: string[] };
  onEditChange?: (field: string, value: any) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedChoices, setExpandedChoices] = useState<Set<number>>(new Set());

  // 수정 모드 진입 시 자동 펼침
  useEffect(() => {
    if (isEditMode) setIsExpanded(true);
  }, [isEditMode]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-[#1A1A1A] bg-[#F5F0E8] transition-all"
    >
      {/* 헤더 */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-3 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* 문항 번호 + 타입 뱃지 */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="inline-block px-2 py-0.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8]">
                Q{questionNumber}
              </span>
              {question.type && question.type !== 'multiple' && (
                <span className="inline-block px-2 py-0.5 text-xs font-bold border border-[#1A1A1A] bg-[#F5F0E8] text-[#1A1A1A]">
                  {question.type === 'ox' ? 'OX' : question.type === 'short_answer' ? '주관식' : question.type}
                </span>
              )}
            </div>
            <p className="text-sm text-[#1A1A1A]">{editData?.text ?? question.text}</p>
          </div>

          {/* 확장 아이콘 */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <svg
              className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* 상세 정보 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-[#1A1A1A] p-4 space-y-4 bg-[#EDEAE4]">
              {/* 수정 모드: 문제 텍스트 수정 */}
              {isEditMode && onEditChange && (
                <div>
                  <label className="block text-xs font-bold text-[#5C5C5C] mb-1">문제</label>
                  <textarea
                    value={editData?.text ?? question.text}
                    onChange={(e) => onEditChange('text', e.target.value)}
                    className="w-full p-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm text-[#1A1A1A] focus:outline-none resize-none"
                    rows={3}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                  />
                </div>
              )}

              {/* 문제 이미지 */}
              {question.imageUrl && (
                <div className="mb-3">
                  <img
                    src={question.imageUrl}
                    alt="문제 이미지"
                    className="max-w-full max-h-[300px] object-contain border border-[#1A1A1A]"
                  />
                  {question.imageDescription && (
                    <p className="text-xs text-[#5C5C5C] mt-1">{question.imageDescription}</p>
                  )}
                </div>
              )}

              {/* OX 문제 */}
              {question.type === 'ox' && (() => {
                const answer = question.answer;
                const isOCorrect = answer === 0 || answer === 'O' || answer === 'o' || answer === true;
                const isXCorrect = answer === 1 || answer === 'X' || answer === 'x' || answer === false;

                return (
                  <div className="space-y-3">
                    <div className="flex gap-4 justify-center py-2">
                      <div
                        className={`w-20 h-20 text-4xl font-bold border-2 flex items-center justify-center ${
                          isOCorrect
                            ? 'bg-[#1A6B1A] border-[#1A6B1A] text-[#F5F0E8]'
                            : 'bg-[#F5F0E8] border-[#1A1A1A] text-[#5C5C5C]'
                        }`}
                      >
                        O
                      </div>
                      <div
                        className={`w-20 h-20 text-4xl font-bold border-2 flex items-center justify-center ${
                          isXCorrect
                            ? 'bg-[#1A6B1A] border-[#1A6B1A] text-[#F5F0E8]'
                            : 'bg-[#F5F0E8] border-[#1A1A1A] text-[#5C5C5C]'
                        }`}
                      >
                        X
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 객관식 문제 */}
              {(question.type === 'multiple' || (!question.type && question.choices)) && question.choices && question.choices.length > 0 && (
                <div className="space-y-3">
                  {/* 복수 정답 표시 */}
                  {Array.isArray(question.answer) && question.answer.length > 1 && (
                    <p className="text-xs text-[#8B6914] font-bold flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      복수 정답 ({question.answer.length}개)
                    </p>
                  )}
                  <div className="space-y-2">
                    {(editData?.choices ?? question.choices).map((choice: string, idx: number) => {
                      // 정답 판별 (answer가 0-indexed 숫자 또는 배열)
                      const correctAnswers: number[] = Array.isArray(question.answer)
                        ? question.answer
                        : typeof question.answer === 'number'
                          ? [question.answer]
                          : [];
                      const isCorrectOption = correctAnswers.includes(idx);

                      let bgColor = '#F5F0E8';
                      let borderColor = '#1A1A1A';
                      let textColor = '#1A1A1A';

                      if (!isEditMode && isCorrectOption) {
                        bgColor = '#1A6B1A';
                        borderColor = '#1A6B1A';
                        textColor = '#F5F0E8';
                      }

                      // 선지별 해설
                      const currentChoiceExps = editData?.choiceExplanations ?? question.choiceExplanations;
                      const choiceExp = currentChoiceExps?.[idx];
                      const isChoiceExpanded = expandedChoices.has(idx);

                      return (
                        <div key={idx}>
                          <div
                            style={isEditMode ? {} : { backgroundColor: bgColor, borderColor, color: textColor }}
                            className={`w-full p-3 border-2 flex items-start gap-3 text-left ${
                              isEditMode
                                ? 'border-[#1A1A1A] bg-[#F5F0E8]'
                                : choiceExp ? 'cursor-pointer' : ''
                            }`}
                            onClick={!isEditMode && choiceExp ? () => {
                              setExpandedChoices(prev => {
                                const next = new Set(prev);
                                if (next.has(idx)) next.delete(idx);
                                else next.add(idx);
                                return next;
                              });
                            } : undefined}
                          >
                            {/* 선지 번호 */}
                            <span
                              className={`flex-shrink-0 w-6 h-6 flex items-center justify-center text-sm font-bold ${
                                isEditMode
                                  ? 'bg-[#EDEAE4] text-[#1A1A1A]'
                                  : isCorrectOption
                                    ? 'bg-[#F5F0E8]/20 text-[#F5F0E8]'
                                    : 'bg-[#EDEAE4] text-[#1A1A1A]'
                              }`}
                            >
                              {choiceLabels[idx] || `${idx + 1}`}
                            </span>
                            {/* 선지 텍스트 */}
                            {isEditMode && onEditChange ? (
                              <input
                                type="text"
                                value={choice}
                                onChange={(e) => {
                                  const newChoices = [...(editData?.choices ?? question.choices ?? [])];
                                  newChoices[idx] = e.target.value;
                                  onEditChange('choices', newChoices);
                                }}
                                className="flex-1 text-sm bg-transparent border-b border-[#5C5C5C] focus:outline-none focus:border-[#1A1A1A] text-[#1A1A1A]"
                              />
                            ) : (
                              <span className="flex-1 text-sm leading-relaxed break-words">
                                {choice}
                                {Array.isArray(question.answer) && question.answer.length > 1 && isCorrectOption && (
                                  <span className="ml-1 font-bold">(정답)</span>
                                )}
                              </span>
                            )}
                            {/* 체크 아이콘 또는 아코디언 화살표 (수정 모드에서는 숨김) */}
                            {!isEditMode && (
                              isCorrectOption ? (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  {choiceExp && (
                                    <svg className={`w-4 h-4 transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                      fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  )}
                                </div>
                              ) : choiceExp ? (
                                <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              ) : null
                            )}
                          </div>
                          {/* 선지별 해설 — 수정 모드면 전부 펼침 + textarea */}
                          {isEditMode && onEditChange ? (
                            <div className="px-4 py-3 border-x-2 border-b-2 border-[#1A1A1A] bg-[#EDEAE4]">
                              <label className="block text-xs text-[#5C5C5C] mb-1">선지 {idx + 1} 해설</label>
                              <textarea
                                value={(editData?.choiceExplanations ?? question.choiceExplanations ?? [])[idx] || ''}
                                onChange={(e) => {
                                  const newExps = [...(editData?.choiceExplanations ?? question.choiceExplanations ?? [])];
                                  while (newExps.length <= idx) newExps.push('');
                                  newExps[idx] = e.target.value;
                                  onEditChange('choiceExplanations', newExps);
                                }}
                                className="w-full p-2 border border-[#5C5C5C] bg-[#F5F0E8] text-sm text-[#5C5C5C] focus:outline-none resize-none"
                                rows={2}
                              />
                            </div>
                          ) : choiceExp && isChoiceExpanded ? (
                            <div
                              style={{ borderColor }}
                              className="px-4 py-3 border-x-2 border-b-2 bg-[#EDEAE4]"
                            >
                              <p className={`text-sm whitespace-pre-wrap ${
                                isCorrectOption ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'
                              }`}>
                                {choiceExp.replace(/^선지\d+\s*해설\s*[:：]\s*/i, '')}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 단답형 답 */}
              {(question.type === 'short_answer' || question.type === 'short') && (
                <div className="space-y-3">
                  <div className="p-3 border-2 border-[#1A6B1A] bg-[#E8F5E9]">
                    <p className="text-xs text-[#1A6B1A] mb-1">정답</p>
                    <p className="text-sm font-medium text-[#1A6B1A] whitespace-pre-wrap">
                      {typeof question.answer === 'string'
                        ? question.answer.includes('|||')
                          ? question.answer.split('|||').map((a: string) => a.trim()).join(', ')
                          : question.answer
                        : String(question.answer ?? '')}
                    </p>
                  </div>
                </div>
              )}

              {/* 해설 */}
              {isEditMode && onEditChange ? (
                <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <label className="block text-xs font-bold text-[#5C5C5C] mb-1">해설</label>
                  <textarea
                    value={editData?.explanation ?? question.explanation ?? ''}
                    onChange={(e) => onEditChange('explanation', e.target.value)}
                    className="w-full p-2 border border-[#5C5C5C] bg-[#EDEAE4] text-sm text-[#5C5C5C] focus:outline-none resize-none"
                    rows={3}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = target.scrollHeight + 'px';
                    }}
                  />
                </div>
              ) : question.explanation ? (
                <div className="p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
                  <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                  <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">
                    {question.explanation}
                  </p>
                </div>
              ) : (
                <div className="p-3 border border-[#D4CFC4] bg-[#F5F0E8]">
                  <p className="text-xs font-bold text-[#5C5C5C]">해설 없음</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
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

  // 슬라이더
  const [showSliderPanel, setShowSliderPanel] = useState(false);
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

  // Job 이벤트 구독 — 완료/실패 시 isGenerating 해제
  useEffect(() => {
    const unsub = onLibraryJobEvent((event) => {
      if (event.type === 'started') {
        setIsGenerating(true);
        setShowProgressModal(true);
        setProgressStep('analyzing');
      }
      if (event.type === 'progress' && event.step === 'generating') {
        setProgressStep('generating');
      }
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
        setIsGenerating(false);
        setShowProgressModal(false);
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

  // previewQuiz가 onSnapshot으로 업데이트되면 반영
  useEffect(() => {
    if (!previewQuiz) return;
    const updated = quizzes.find(q => q.id === previewQuiz.id);
    if (updated && updated !== previewQuiz) {
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
    if (!difficulty) {
      alert('난이도를 선택해주세요.');
      return;
    }
    if (isLibraryJobActive()) {
      alert('이미 문제를 생성 중입니다.');
      return;
    }

    // 즉시 프로그레스 모달 표시
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
      });

      // 입력 초기화
      setPrompt('');

    } catch (err: any) {
      setShowProgressModal(false);
      const msg = err?.message || 'Job 등록 중 오류가 발생했습니다.';
      if (msg.includes('횟수') || msg.includes('초과') || msg.includes('exhausted')) {
        alert(msg);
      } else {
        alert(`오류: ${msg}`);
      }
    }
  }, [profile, prompt, sliders, difficulty, userCourseId, userCourse]);

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
            {isEditMode ? (
              <input
                type="text"
                autoFocus
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="flex-1 text-2xl font-black text-[#1A1A1A] bg-transparent border-b-2 border-[#1A1A1A] outline-none"
              />
            ) : (
              <h2 className={`text-2xl font-black text-[#1A1A1A] flex-1 ${
                isDefaultAiTitle(previewQuiz.title) ? '' : 'font-serif-display'
              }`}>
                {previewQuiz.title}
              </h2>
            )}
            {/* 연필 아이콘 / 수정 모드 버튼 */}
            {!isEditMode ? (
              <button
                onClick={handleEnterEditMode}
                className="p-1.5 text-[#5C5C5C] hover:text-[#1A1A1A] transition-colors flex-shrink-0"
                title="수정 모드"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            ) : (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    setIsEditMode(false);
                    setEditedTitle('');
                    setEditedDescription('');
                    setEditedTags([]);
                    setEditedQuestions({});
                  }}
                  className="px-3 py-1.5 text-xs font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit}
                  className="px-3 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
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
                <p className="text-sm text-[#5C5C5C] italic">
                  &ldquo;{previewQuiz.description}&rdquo;
                </p>
              )}
              {previewQuiz.tags && previewQuiz.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {previewQuiz.tags.map((tag: string) => (
                    <span key={tag} className="px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 수정 모드: 총평/태그 편집 */}
          {isEditMode && (
            <div className="space-y-3">
              {/* 총평 */}
              <div>
                <label className="block text-xs font-bold text-[#5C5C5C] mb-1.5">총평</label>
                <textarea
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  placeholder="학생들에게 전할 한마디를 입력하세요"
                  rows={2}
                  className="w-full px-3 py-2 border border-[#D4CFC4] bg-[#FDFBF7] text-[#1A1A1A] placeholder:text-[#9A9A9A] outline-none focus:border-[#1A1A1A] resize-none text-sm"
                />
              </div>

              {/* 태그 */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="text-xs font-bold text-[#5C5C5C]">태그</label>
                  <button
                    type="button"
                    onClick={() => setShowEditTagPicker(!showEditTagPicker)}
                    className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                      showEditTagPicker
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-transparent text-[#5C5C5C] border-[#D4CFC4] hover:border-[#1A1A1A]'
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
                        className="flex items-center gap-1 px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold"
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
                      <div className="flex flex-wrap gap-1.5 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
                        {editTagOptions
                          .filter(tag => !editedTags.includes(tag))
                          .map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => setEditedTags(prev => [...prev, tag])}
                              className="px-2.5 py-1 text-xs font-bold bg-[#F5F0E8] text-[#1A1A1A] border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
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
      </div>
    );
  }

  // ============================================================
  // JSX — 일반 모드 (카드 그리드)
  // ============================================================

  const hasContent = !!prompt.trim();

  return (
    <div className="flex-1 flex flex-col px-4 pb-8">
      {/* ============================================================ */}
      {/* 프롬프트 입력 영역 */}
      {/* ============================================================ */}
      <div className="border-2 border-[#1A1A1A] bg-[#FDFBF7] mb-4">
        {/* 텍스트 입력 */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="AI에게 문제 생성 지시사항을 입력하세요...&#10;예: 세포 분열 관련 문제를 만들어주세요."
          className="w-full px-4 pt-3 pb-2 text-sm text-[#1A1A1A] placeholder-[#999] bg-transparent outline-none resize-none min-h-[80px]"
          rows={3}
        />

        {/* 하단 아이콘 + 생성 버튼 */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-[#EDEAE4]">
          <div className="flex items-center gap-1">
            {/* 슬라이더 아이콘 */}
            <button
              onClick={() => setShowSliderPanel(!showSliderPanel)}
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                showSliderPanel ? 'bg-[#1A1A1A] text-[#F5F0E8]' : 'text-[#5C5C5C] hover:bg-[#EDEAE4]'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
            {/* 난이도 태그 버튼 */}
            {(['easy', 'medium', 'hard'] as const).map(d => (
              <button
                key={d}
                onClick={() => setDifficulty(prev => prev === d ? null : d)}
                className={`px-2.5 py-1 text-xs font-bold border transition-colors ${
                  difficulty === d
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-transparent text-[#5C5C5C] border-[#D4CFC4] hover:border-[#1A1A1A]'
                }`}
              >
                #{d === 'easy' ? '쉬움' : d === 'medium' ? '보통' : '어려움'}
              </button>
            ))}
          </div>

          {/* 생성 버튼 */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !hasContent || !difficulty}
            className={`px-5 py-2 text-sm font-bold transition-colors ${
              isGenerating || !hasContent || !difficulty
                ? 'bg-[#D4CFC4] text-[#999] cursor-not-allowed'
                : 'bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A]'
            }`}
          >
            {isGenerating ? '생성 중...' : '생성'}
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 슬라이더 패널 */}
      {/* ============================================================ */}
      <AnimatePresence>
        {showSliderPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="border border-[#D4CFC4] bg-[#FDFBF7] p-4 space-y-4">
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
      {/* 생성 진행 모달 (AIQuizProgress 재사용) */}
      {/* ============================================================ */}
      <LibraryProgressModal
        isOpen={showProgressModal}
        progress={progressStep}
      />

      {/* ============================================================ */}
      {/* 백그라운드 생성 진행 인라인 뱃지 (모달 닫힌 뒤에도 표시) */}
      {/* ============================================================ */}
      {isGenerating && !showProgressModal && (
        <div className="flex items-center gap-2 px-3 py-2 mb-4 border border-[#D4CFC4] bg-[#EDEAE4]">
          <div className="w-4 h-4 flex-shrink-0 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-bold text-[#1A1A1A]">AI 문제 생성 중... 다른 페이지로 이동해도 계속 생성됩니다.</span>
        </div>
      )}

      {/* ============================================================ */}
      {/* 생성된 퀴즈 카드 그리드 (2열) */}
      {/* ============================================================ */}
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
          <p className="text-sm text-[#5C5C5C]">위에서 프롬프트를 입력하고 문제를 생성해보세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {quizzes.map((quiz) => (
            <motion.div
              key={quiz.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4, boxShadow: '0 8px 25px rgba(26, 26, 26, 0.15)' }}
              transition={{ duration: 0.2 }}
              className="relative border border-[#1A1A1A] bg-[#F5F0E8] overflow-hidden shadow-md cursor-default"
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
              <div className="relative z-10 p-4 bg-[#F5F0E8]/90">
                {/* 제목 (2줄 고정 높이, AI 기본 제목은 serif 비적용) */}
                <div className="h-[44px] mb-2">
                  <h3 className={`font-bold text-base line-clamp-2 text-[#1A1A1A] leading-snug pr-8 ${
                    isDefaultAiTitle(quiz.title) ? '' : 'font-serif-display'
                  }`}>
                    {quiz.title}
                  </h3>
                </div>

                {/* 메타 정보 */}
                <p className="text-sm text-[#5C5C5C] mb-1">
                  {quiz.questionCount}문제
                </p>

                {/* 태그 (2줄 고정 높이) */}
                <div className="h-[48px] mb-2 overflow-hidden">
                  {quiz.tags && quiz.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {quiz.tags.slice(0, 8).map((tag) => (
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

                {/* 버튼 */}
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDetailQuiz(quiz);
                    }}
                    className="flex-1 py-2 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] bg-transparent hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPreview(quiz);
                    }}
                    className="flex-1 py-2 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#3A3A3A] transition-colors"
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
      {/* Details 모달 (학생 서재탭과 동일한 레이아웃) */}
      {/* ============================================================ */}
      {selectedDetailQuiz && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedDetailQuiz(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h2 className={`text-2xl font-bold text-[#1A1A1A] mb-4 ${
              isDefaultAiTitle(selectedDetailQuiz.title) ? '' : 'font-serif-display'
            }`}>
              {selectedDetailQuiz.title}
            </h2>

            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 수</span>
                <span className="font-bold text-[#1A1A1A]">{selectedDetailQuiz.questionCount}문제</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">난이도</span>
                <span className="font-bold text-[#1A1A1A]">
                  {{ easy: '쉬움', medium: '보통', hard: '어려움' }[selectedDetailQuiz.difficulty] || selectedDetailQuiz.difficulty}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5C5C5C]">문제 유형</span>
                <span className="font-bold text-[#1A1A1A]">
                  {selectedDetailQuiz.questions && selectedDetailQuiz.questions.length > 0
                    ? formatQuestionTypes(selectedDetailQuiz.questions)
                    : `${selectedDetailQuiz.questionCount}문제`}
                </span>
              </div>

              {/* 태그 */}
              {selectedDetailQuiz.tags && selectedDetailQuiz.tags.length > 0 && (
                <div className="pt-2 border-t border-[#A0A0A0]">
                  <div className="flex flex-wrap gap-1.5">
                    {selectedDetailQuiz.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-1 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-medium"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 액션 버튼 (편집 / 공개 / 삭제) */}
            <div className="flex gap-3 mb-3">
              <button
                onClick={() => {
                  router.push(`/professor/quiz/${selectedDetailQuiz.id}/edit`);
                  setSelectedDetailQuiz(null);
                }}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                편집
              </button>
              {!selectedDetailQuiz.isPublished ? (
                <button
                  onClick={() => {
                    setPublishTarget(selectedDetailQuiz.id);
                    setSelectedDetailQuiz(null);
                  }}
                  className="flex-1 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
                >
                  공개
                </button>
              ) : (
                <div className="flex-1 py-3 font-bold text-center text-[#8B6914] border-2 border-[#8B6914]">
                  공개됨
                </div>
              )}
              <button
                onClick={() => {
                  setDeleteTarget(selectedDetailQuiz.id);
                  setSelectedDetailQuiz(null);
                }}
                className="py-3 px-4 font-bold border-2 border-[#C44] text-[#C44] hover:bg-[#FEE] transition-colors"
              >
                삭제
              </button>
            </div>

            {/* 닫기 */}
            <button
              onClick={() => setSelectedDetailQuiz(null)}
              className="w-full py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
            >
              닫기
            </button>
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
            className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            {/* 지구본 아이콘 */}
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 flex items-center justify-center border-2 border-[#1A1A1A] bg-[#EDEAE4]">
                <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.6 9h16.8M3.6 15h16.8" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
                </svg>
              </div>
            </div>

            {/* 텍스트 */}
            <h3 className="text-center font-bold text-lg text-[#1A1A1A] mb-2">
              퀴즈를 공개할까요?
            </h3>
            <p className="text-center text-sm text-[#5C5C5C] mb-6">
              공개하면 다른 학생들도 풀 수 있어요.<br />참여 통계도 확인할 수 있어요.
            </p>

            {/* 버튼: 취소 + 공개(드롭다운) */}
            <div className="flex gap-3">
              <button
                onClick={() => { setPublishTarget(null); setShowPublishDropdown(false); }}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                취소
              </button>
              <div className="flex-1 relative">
                {/* 드롭다운 (위로 열림) */}
                {showPublishDropdown && (
                  <div className="absolute bottom-full left-0 w-full border-2 border-[#1A1A1A] border-b-0 bg-[#F5F0E8]">
                    {[
                      { value: 'midterm', label: '중간 대비' },
                      { value: 'final', label: '기말 대비' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={async () => {
                          setShowPublishDropdown(false);
                          if (publishTarget) {
                            await publishQuiz(publishTarget, opt.value);
                            setPublishTarget(null);
                            onPublish?.();
                          }
                        }}
                        className="w-full py-2.5 text-sm font-bold text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                {/* 공개 버튼 — 클릭 시 드롭다운 토글 */}
                <button
                  onClick={() => setShowPublishDropdown(!showPublishDropdown)}
                  className="w-full flex items-center justify-center gap-3 py-3 font-bold bg-[#1A1A1A] text-[#F5F0E8] border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
                >
                  공개
                  <svg className={`w-3.5 h-3.5 transition-transform ${showPublishDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
          >
            <h3 className="text-center font-bold text-lg text-[#1A1A1A] mb-2">퀴즈 삭제</h3>
            <p className="text-center text-sm text-[#5C5C5C] mb-6">이 퀴즈를 삭제하시겠습니까?<br />이 작업은 되돌릴 수 없습니다.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
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
                className="flex-1 py-3 font-bold bg-[#C44] text-white border-2 border-[#C44] hover:bg-[#A33] transition-colors"
              >
                삭제
              </button>
            </div>
          </div>
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
}: {
  isOpen: boolean;
  progress: 'uploading' | 'analyzing' | 'generating';
}) {
  if (typeof window === 'undefined') return null;

  const { title, subtitle } = PROGRESS_MESSAGES[progress];

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
