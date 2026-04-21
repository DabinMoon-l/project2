'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { doc, getDoc, updateDoc, serverTimestamp, Timestamp, db } from '@/lib/repositories';
import { auth } from '@/lib/firebase';
import { sanitizeForFirestore } from '@/lib/utils/quizImageUpload';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/common';
import type { QuestionData, SubQuestion, MixedExampleBlock } from '@/components/quiz/create/QuestionEditor';
import QuestionList from '@/components/quiz/create/QuestionList';

// 대형 컴포넌트 lazy load (4,074줄 — 수정 시에만 로드)
const QuestionEditor = dynamic(() => import('@/components/quiz/create/QuestionEditor'));
import QuizMetaForm, { type QuizMeta, validateRequiredTags, getChapterTags } from '@/components/quiz/create/QuizMetaForm';
import ImageRegionSelector, { type UploadedFileItem } from '@/components/quiz/create/ImageRegionSelector';
import { AnimatePresence } from 'framer-motion';

/** Firestore 원본 문제 데이터 (퀴즈 문서 내 questions 배열) */
interface RawQuestion {
  id?: string;
  text?: string;
  type?: string;
  choices?: string[];
  answer?: number | number[] | string;
  explanation?: string;
  choiceExplanations?: string[];
  imageUrl?: string;
  examples?: unknown;
  mixedExamples?: unknown;
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  combinedMainText?: string;
  passageType?: string;
  passage?: string;
  koreanAbcItems?: string[];
  passageMixedExamples?: unknown[];
  passageImage?: string;
  commonQuestion?: string;
  chapterId?: string;
  chapterDetailId?: string;
  questionUpdatedAt?: unknown;
  passagePrompt?: string;
  bogi?: { questionText?: string; items?: Array<{ id?: string; label: string; content: string }> } | null;
  passageBlocks?: Array<{ id: string; type: string; content?: string; items?: Array<{ id: string; label: string; content: string }>; imageUrl?: string; children?: unknown[]; prompt?: string }>;
}

interface EditQuizSheetProps {
  quizId: string;
  onClose: () => void;
  /** 저장 완료 후 콜백 */
  onSaved?: () => void;
  /** 패널 모드: absolute 위치 + 투명 오버레이 */
  isPanelMode?: boolean;
}

/**
 * 퀴즈 수정 바텀시트 컴포넌트
 * 관리 페이지 위에 오버레이로 렌더링됩니다.
 */
export default function EditQuizSheet({ quizId, onClose, onSaved, isPanelMode }: EditQuizSheetProps) {
  const { user } = useAuth();
  const { userCourseId } = useCourse();

  // 상태
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 퀴즈 메타 정보
  const [quizMeta, setQuizMeta] = useState<QuizMeta>({
    title: '',
    tags: [],
    isPublic: true,
    difficulty: 'normal',
  });
  const [metaErrors, setMetaErrors] = useState<{ title?: string; tags?: string }>({});

  // 문제 관리
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [originalQuestions, setOriginalQuestions] = useState<RawQuestion[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // 편집 모드
  const [editMode, setEditMode] = useState<'meta' | 'questions'>('questions');

  // 추출 이미지 관련
  const [extractedImages, setExtractedImages] = useState<Array<{ id: string; dataUrl: string; sourceFileName?: string }>>([]);
  const [showImageExtractor, setShowImageExtractor] = useState(false);
  const [extractorFiles, setExtractorFiles] = useState<UploadedFileItem[]>([]);

  // blob → dataUrl 변환
  const blobToDataUrl = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, []);

  // 추출 이미지 추가
  const handleExtractImage = useCallback((dataUrl: string, sourceFileName?: string) => {
    const newImage = {
      id: `extracted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dataUrl,
      sourceFileName,
    };
    setExtractedImages((prev) => [...prev, newImage]);
  }, []);

  // 추출 이미지 삭제
  const handleRemoveExtractedImage = useCallback((id: string) => {
    setExtractedImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

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

        if (data.creatorId !== user.uid) {
          setError('수정 권한이 없습니다.');
          return;
        }

        setQuizMeta({
          title: data.title || '',
          tags: data.tags || [],
          isPublic: data.isPublic !== false,
          difficulty: data.difficulty || 'normal',
        });

        setOriginalQuestions((data.questions || []) as RawQuestion[]);

        const rawQuestions = (data.questions || []) as RawQuestion[];
        const loadedQuestions: QuestionData[] = [];
        const processedCombinedGroups = new Set<string>();

        rawQuestions.forEach((q, index) => {
          if (q.combinedGroupId) {
            if (processedCombinedGroups.has(q.combinedGroupId)) return;
            processedCombinedGroups.add(q.combinedGroupId);

            const groupQuestions = rawQuestions.filter(
              (gq) => gq.combinedGroupId === q.combinedGroupId
            ).sort((a, b) => (a.combinedIndex || 0) - (b.combinedIndex || 0));

            const firstQ = groupQuestions[0];

            const subQuestions: SubQuestion[] = groupQuestions.map((sq) => {
              let answerIndex = -1;
              let answerIndices: number[] | undefined;
              let isMultipleAnswer = false;

              if (sq.type === 'multiple') {
                if (Array.isArray(sq.answer)) {
                  // 복수 정답
                  const sqChoiceCount = (sq.choices || []).length || 4;
                  const anyOver = (sq.answer as number[]).some((a) => typeof a === 'number' && a >= sqChoiceCount);
                  answerIndices = anyOver ? (sq.answer as number[]).map((a) => typeof a === 'number' ? a - 1 : a) : [...(sq.answer as number[])];
                  isMultipleAnswer = true;
                  answerIndex = (answerIndices && answerIndices[0] !== undefined) ? answerIndices[0] : -1;
                } else if (typeof sq.answer === 'number') {
                  const sqChoiceCount = (sq.choices || []).length || 4;
                  if (sq.answer >= sqChoiceCount) {
                    answerIndex = sq.answer - 1;
                  } else if (sq.answer >= 0) {
                    answerIndex = sq.answer;
                  }
                } else if (typeof sq.answer === 'string') {
                  // AI 생성 등에서 문자열로 저장된 경우 ("2", "0,2")
                  if (sq.answer.includes(',')) {
                    const parsed = sq.answer.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
                    if (parsed.length > 1) {
                      answerIndices = parsed;
                      isMultipleAnswer = true;
                      answerIndex = parsed[0];
                    } else if (parsed.length === 1) {
                      answerIndex = parsed[0];
                    }
                  } else {
                    const parsed = parseInt(sq.answer, 10);
                    if (!isNaN(parsed)) {
                      const sqChoiceCount = (sq.choices || []).length || 4;
                      answerIndex = parsed >= sqChoiceCount ? parsed - 1 : parsed;
                    }
                  }
                }
              } else if (sq.type === 'ox') {
                if (typeof sq.answer === 'number') {
                  answerIndex = sq.answer;
                } else if (typeof sq.answer === 'string') {
                  const upper = sq.answer.toUpperCase();
                  answerIndex = (upper === 'O' || upper === '0') ? 0 : 1;
                }
              }

              // 객관식/OX의 문자열 answer는 answerIndex로 변환 완료
              const sqAnswerText = (sq.type !== 'multiple' && sq.type !== 'ox' && typeof sq.answer === 'string')
                ? sq.answer : undefined;

              return {
                id: sq.id || `${q.combinedGroupId}_${sq.combinedIndex || 0}`,
                text: sq.text || '',
                type: (sq.type || 'multiple') as SubQuestion['type'],
                choices: sq.choices || undefined,
                answerIndex: sq.type === 'multiple' || sq.type === 'ox' ? answerIndex : undefined,
                answerIndices: isMultipleAnswer ? answerIndices : undefined,
                isMultipleAnswer: isMultipleAnswer || undefined,
                answerText: sqAnswerText,
                explanation: sq.explanation || undefined,
                choiceExplanations: Array.isArray(sq.choiceExplanations) ? [...sq.choiceExplanations] : undefined,
                mixedExamples: (sq.mixedExamples || sq.examples || undefined) as MixedExampleBlock[] | undefined,
                image: sq.imageUrl || undefined,
                passagePrompt: sq.passagePrompt || undefined,
                bogi: (sq.bogi || undefined) as SubQuestion['bogi'],
                passageBlocks: (sq.passageBlocks || undefined) as SubQuestion['passageBlocks'],
                chapterId: sq.chapterId || undefined,
                chapterDetailId: sq.chapterDetailId || undefined,
              };
            });

            const combinedQuestion: QuestionData = {
              id: q.combinedGroupId,
              text: firstQ.combinedMainText || '',
              type: 'combined',
              choices: [],
              answerIndex: -1,
              answerText: '',
              explanation: '',
              subQuestions,
              passageType: (firstQ.passageType || undefined) as QuestionData['passageType'],
              passage: firstQ.passage || undefined,
              koreanAbcItems: (firstQ.koreanAbcItems || undefined) as QuestionData['koreanAbcItems'],
              passageMixedExamples: (firstQ.passageMixedExamples || undefined) as QuestionData['passageMixedExamples'],
              passageImage: firstQ.passageImage || undefined,
              commonQuestion: firstQ.commonQuestion || undefined,
            };

            loadedQuestions.push(combinedQuestion);
          } else {
            let answerIndex = -1;
            let answerIndices: number[] | undefined;
            let isMultipleAnswer = false;

            if (q.type === 'multiple') {
              if (Array.isArray(q.answer)) {
                // 복수 정답
                const qChoiceCount = (q.choices || []).length || 4;
                const anyOver = q.answer.some((a: number) => typeof a === 'number' && a >= qChoiceCount);
                answerIndices = anyOver ? q.answer.map((a: number) => typeof a === 'number' ? a - 1 : a) : [...q.answer];
                isMultipleAnswer = true;
                answerIndex = (answerIndices && answerIndices[0] !== undefined) ? answerIndices[0] : -1;
              } else if (typeof q.answer === 'number') {
                const qChoiceCount = (q.choices || []).length || 4;
                if (q.answer >= qChoiceCount) {
                  answerIndex = q.answer - 1;
                } else if (q.answer >= 0) {
                  answerIndex = q.answer;
                }
              } else if (typeof q.answer === 'string') {
                // AI 생성 등에서 문자열로 저장된 경우 ("2", "0,2")
                if (q.answer.includes(',')) {
                  const parsed = q.answer.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
                  if (parsed.length > 1) {
                    answerIndices = parsed;
                    isMultipleAnswer = true;
                    answerIndex = parsed[0];
                  } else if (parsed.length === 1) {
                    answerIndex = parsed[0];
                  }
                } else {
                  const parsed = parseInt(q.answer, 10);
                  if (!isNaN(parsed)) {
                    const qChoiceCount = (q.choices || []).length || 4;
                    answerIndex = parsed >= qChoiceCount ? parsed - 1 : parsed;
                  }
                }
              }
            } else if (q.type === 'ox') {
              if (typeof q.answer === 'number') {
                answerIndex = q.answer;
              } else if (typeof q.answer === 'string') {
                const upper = q.answer.toUpperCase();
                answerIndex = (upper === 'O' || upper === '0') ? 0 : 1;
              }
            }

            const questionType = (q.type || 'multiple') as QuestionData['type'];
            // 객관식/OX의 문자열 answer는 answerIndex로 변환 완료 → answerText는 주관식/단답용만
            const answerText = (q.type !== 'multiple' && q.type !== 'ox' && typeof q.answer === 'string')
              ? q.answer : '';
            loadedQuestions.push({
              id: q.id || `q_${index}`,
              text: q.text || '',
              type: questionType,
              choices: q.choices || ['', '', '', ''],
              answerIndex,
              answerIndices: isMultipleAnswer ? answerIndices : undefined,
              isMultipleAnswer: isMultipleAnswer || undefined,
              answerText,
              explanation: q.explanation || '',
              choiceExplanations: Array.isArray(q.choiceExplanations) ? [...q.choiceExplanations] : undefined,
              imageUrl: q.imageUrl || null,
              examples: (q.examples || null) as QuestionData['examples'],
              mixedExamples: (q.mixedExamples || null) as QuestionData['mixedExamples'],
              passagePrompt: q.passagePrompt || undefined,
              bogi: (q.bogi || undefined) as QuestionData['bogi'],
              passageBlocks: (q.passageBlocks || undefined) as QuestionData['passageBlocks'],
              chapterId: q.chapterId || undefined,
              chapterDetailId: q.chapterDetailId || undefined,
            });
          }
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

  const handleEditQuestion = useCallback((index: number) => {
    setEditingIndex(index);
    setIsAddingNew(false);
  }, []);

  const handleStartAddQuestion = useCallback(() => {
    setIsAddingNew(true);
    setEditingIndex(null);
  }, []);

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

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setIsAddingNew(false);
  }, []);

  const isQuestionChanged = (original: RawQuestion | undefined, current: QuestionData): boolean => {
    if (!original) return true;
    if ((original.text || '') !== (current.text || '')) return true;
    if (original.type !== current.type) return true;
    if (current.type === 'subjective' || current.type === 'short_answer') {
      if ((original.answer?.toString() || '') !== (current.answerText || '')) return true;
    } else if (current.type === 'multiple') {
      // 복수정답 비교
      if (Array.isArray(original.answer) || (current.answerIndices && current.answerIndices.length > 0)) {
        const origArr = Array.isArray(original.answer) ? [...original.answer].sort() : [original.answer];
        const currArr = current.answerIndices && current.answerIndices.length > 0
          ? [...current.answerIndices].sort()
          : [current.answerIndex];
        if (JSON.stringify(origArr) !== JSON.stringify(currArr)) return true;
      } else {
        // 단일 정답: 0-indexed 기준 비교 (answer가 1-indexed일 수 있으므로 choices 수로 판별)
        const origNum = parseInt(String(original.answer), 10);
        if (!isNaN(origNum)) {
          const choiceCount = (original.choices || []).length || 4;
          const origAnswer = origNum >= choiceCount ? origNum - 1 : origNum;
          if (origAnswer !== current.answerIndex) return true;
        }
      }
    } else if (current.type === 'ox') {
      // OX: 0/"0"/"O" = O, 1/"1"/"X" = X
      const normalizeOx = (v: unknown): number | unknown => {
        const s = String(v).toUpperCase();
        if (s === '0' || s === 'O' || s === 'TRUE') return 0;
        if (s === '1' || s === 'X' || s === 'FALSE') return 1;
        return v;
      };
      if (normalizeOx(original.answer) !== normalizeOx(current.answerIndex)) return true;
    }
    if (current.type === 'multiple') {
      const origChoices = original.choices || [];
      const currChoices = current.choices.filter((c) => c.trim());
      if (origChoices.length !== currChoices.length) return true;
      for (let i = 0; i < currChoices.length; i++) {
        if (origChoices[i] !== currChoices[i]) return true;
      }
    }
    if ((original.explanation || '') !== (current.explanation || '')) return true;
    if (JSON.stringify(original.choiceExplanations || []) !== JSON.stringify(current.choiceExplanations || [])) return true;
    if ((original.imageUrl || null) !== (current.imageUrl || null)) return true;
    if ((original.chapterId || '') !== (current.chapterId || '')) return true;
    if ((original.chapterDetailId || '') !== (current.chapterDetailId || '')) return true;
    return false;
  };

  const isQuestionChangedForSubQuestion = (original: RawQuestion | undefined, current: SubQuestion): boolean => {
    if (!original) return true;
    if (original.text !== current.text) return true;
    if (original.type !== current.type) return true;
    if (current.type === 'subjective' || current.type === 'short_answer') {
      if (original.answer !== (current.answerText || '')) return true;
    } else if (current.type === 'multiple') {
      // 0-indexed 기준 비교 (answer가 1-indexed일 수 있으므로 choices 수로 판별)
      const origNum = parseInt(String(original.answer), 10);
      if (!isNaN(origNum)) {
        const choiceCount = (original.choices || []).length || 4;
        const origAnswer = origNum >= choiceCount ? origNum - 1 : origNum;
        if (origAnswer !== (current.answerIndex ?? -1)) return true;
      }
    } else if (current.type === 'ox') {
      // OX: 0/"0"/"O" = O, 1/"1"/"X" = X
      const normalizeOx = (v: unknown): number | unknown => {
        const s = String(v).toUpperCase();
        if (s === '0' || s === 'O' || s === 'TRUE') return 0;
        if (s === '1' || s === 'X' || s === 'FALSE') return 1;
        return v;
      };
      if (normalizeOx(original.answer) !== normalizeOx(current.answerIndex ?? 0)) return true;
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
    if (JSON.stringify(original.choiceExplanations || []) !== JSON.stringify(current.choiceExplanations || [])) return true;
    if ((original.imageUrl || null) !== (current.image || null)) return true;
    return false;
  };

  // 퀴즈 저장
  const handleSave = async () => {
    if (!user || !quizId) return;

    const errors: { title?: string; tags?: string } = {};
    if (!quizMeta.title.trim()) errors.title = '퀴즈 제목을 입력해주세요.';

    const chapterTags = getChapterTags(userCourseId || undefined);
    const tagError = validateRequiredTags(quizMeta.tags, chapterTags);
    if (tagError) errors.tags = tagError;

    if (errors.title || errors.tags) {
      setMetaErrors(errors);
      setEditMode('meta');
      return;
    }

    if (questions.length < 3) {
      alert('최소 3개 이상의 문제가 필요합니다.');
      return;
    }

    try {
      setIsSaving(true);

      const flattenedQuestions: Record<string, unknown>[] = [];
      let orderIndex = 0;

      questions.forEach((q) => {
        if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
          const combinedGroupId = q.id || `combined_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const subQuestionsCount = q.subQuestions.length;

          const originalFirst = originalQuestions.find(
            (oq) => oq.combinedGroupId === combinedGroupId && oq.combinedIndex === 0
          );
          const passageChanged = originalFirst ? (
            (originalFirst.passage || '') !== (q.passage || '') ||
            (originalFirst.passageType || '') !== (q.passageType || '') ||
            (originalFirst.passageImage || '') !== (q.passageImage || '') ||
            (originalFirst.commonQuestion || '') !== (q.commonQuestion || '') ||
            (originalFirst.combinedMainText || '') !== (q.text || '') ||
            JSON.stringify(originalFirst.koreanAbcItems || null) !== JSON.stringify(q.koreanAbcItems || null) ||
            JSON.stringify(originalFirst.passageMixedExamples || null) !== JSON.stringify(q.passageMixedExamples || null)
          ) : false;

          q.subQuestions.forEach((sq, sqIndex) => {
            let answer: string | number | number[];
            if (sq.type === 'subjective' || sq.type === 'short_answer') {
              answer = sq.answerText || '';
            } else if (sq.type === 'multiple') {
              // 복수정답이면 배열, 단일정답이면 숫자 (0-indexed)
              if (sq.answerIndices && sq.answerIndices.length > 1) {
                answer = sq.answerIndices;
              } else if (sq.answerIndices && sq.answerIndices.length === 1) {
                answer = sq.answerIndices[0];
              } else {
                answer = (sq.answerIndex !== undefined && sq.answerIndex >= 0) ? sq.answerIndex : -1;
              }
            } else {
              answer = sq.answerIndex ?? 0;
            }

            const originalQ = originalQuestions.find((oq) => oq.id === sq.id);
            const hasChanged = !originalQ || passageChanged || isQuestionChangedForSubQuestion(originalQ, sq);

            const subQuestionData: Record<string, unknown> = {
              ...(originalQ || {}),
              id: sq.id || `${combinedGroupId}_${sqIndex}`,
              order: orderIndex++,
              text: sq.text,
              type: sq.type,
              choices: sq.type === 'multiple' ? (sq.choices || []).filter((c) => c.trim()) : null,
              answer,
              explanation: sq.explanation || null,
              choiceExplanations: sq.type === 'multiple' && sq.choiceExplanations && sq.choiceExplanations.some((e) => e && e.trim())
                ? sq.choiceExplanations.slice(0, (sq.choices || []).filter((c) => c.trim()).length)
                : null,
              imageUrl: sq.image || null,
              examples: sq.mixedExamples || null,
              mixedExamples: sq.mixedExamples || null,
              passagePrompt: sq.passagePrompt || null,
              bogi: sq.bogi || null,
              passageBlocks: sq.passageBlocks || null,
              combinedGroupId,
              combinedIndex: sqIndex,
              combinedTotal: subQuestionsCount,
              chapterId: sq.chapterId || null,
              chapterDetailId: sq.chapterDetailId || null,
              questionUpdatedAt: originalQ?.questionUpdatedAt || null,
            };

            if (sqIndex === 0) {
              subQuestionData.passageType = q.passageType || null;
              subQuestionData.passage = q.passage || null;
              subQuestionData.koreanAbcItems = q.koreanAbcItems || null;
              subQuestionData.passageMixedExamples = q.passageMixedExamples || null;
              subQuestionData.passageImage = q.passageImage || null;
              subQuestionData.commonQuestion = q.commonQuestion || null;
              subQuestionData.combinedMainText = q.text || '';
            }

            flattenedQuestions.push(sanitizeForFirestore(subQuestionData) as Record<string, unknown>);
          });
        } else {
          let answer: string | number | number[];
          if (q.type === 'subjective' || q.type === 'short_answer') {
            answer = q.answerText;
          } else if (q.type === 'multiple') {
            // 복수정답이면 배열, 단일정답이면 숫자 (0-indexed)
            if (q.answerIndices && q.answerIndices.length > 1) {
              answer = q.answerIndices;
            } else if (q.answerIndices && q.answerIndices.length === 1) {
              answer = q.answerIndices[0];
            } else {
              answer = q.answerIndex >= 0 ? q.answerIndex : -1;
            }
          } else {
            answer = q.answerIndex;
          }

          const originalQ = originalQuestions.find((oq) => oq.id === q.id);
          const hasChanged = isQuestionChanged(originalQ, q);

          flattenedQuestions.push(sanitizeForFirestore({
            ...(originalQ || {}),
            id: q.id,
            order: orderIndex++,
            text: q.text,
            type: q.type,
            choices: q.type === 'multiple' ? q.choices.filter((c) => c.trim()) : null,
            answer,
            explanation: q.explanation || null,
            choiceExplanations: q.type === 'multiple' && q.choiceExplanations && q.choiceExplanations.some((e) => e && e.trim())
              ? q.choiceExplanations.slice(0, q.choices.filter((c) => c.trim()).length)
              : null,
            imageUrl: q.imageUrl || null,
            examples: q.examples || null,
            mixedExamples: q.mixedExamples || null,
            passagePrompt: q.passagePrompt || null,
            bogi: q.bogi || null,
            passageBlocks: (q.passageBlocks && q.passageBlocks.length > 0) ? q.passageBlocks : null,
            chapterId: q.chapterId || null,
            chapterDetailId: q.chapterDetailId || null,
            questionUpdatedAt: hasChanged ? Timestamp.now() : (originalQ?.questionUpdatedAt || null),
          }) as Record<string, unknown>);
        }
      });

      const questionCount = flattenedQuestions.length;
      const { ensureQuestionIds } = await import('@/lib/utils/questionId');
      const questionsWithIds = ensureQuestionIds(flattenedQuestions);

      const quizData = {
        title: quizMeta.title.trim(),
        tags: quizMeta.tags,
        difficulty: quizMeta.difficulty,
        isPublic: quizMeta.isPublic,
        questions: questionsWithIds,
        questionCount,
        oxCount: flattenedQuestions.filter(q => q.type === 'ox').length,
        multipleChoiceCount: flattenedQuestions.filter(q => q.type === 'multiple').length,
        subjectiveCount: flattenedQuestions.filter(q => q.type === 'short_answer' || q.type === 'subjective').length,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'quizzes', quizId), quizData);
      alert('퀴즈가 수정되었습니다.');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error('퀴즈 저장 실패:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div
        className={`${isPanelMode ? 'absolute' : 'fixed'} inset-0 z-[65] flex items-end`}
        style={isPanelMode ? undefined : { backgroundColor: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full bg-[#F5F0E8] rounded-t-2xl shadow-[0_-8px_32px_rgba(0,0,0,0.12)] border border-[#D4CFC4]/60 border-b-0 flex flex-col"
          style={{ maxHeight: '93vh' }}
        >
          {/* 드래그 핸들 */}
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 bg-[#D4CFC4]/80 rounded-full" />
          </div>

          {isLoading ? (
            <div className="px-3 py-6 space-y-3">
              <Skeleton className="w-full h-8 rounded-none" />
              <Skeleton className="w-full h-24 rounded-none" />
              <Skeleton className="w-full h-24 rounded-none" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-4 py-12">
              <h2 className="text-sm font-bold text-[#1A1A1A] mb-2">오류</h2>
              <p className="text-xs text-[#5C5C5C] text-center mb-4">{error}</p>
              <button onClick={onClose} className="px-4 py-2 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold">돌아가기</button>
            </div>
          ) : (
            <>
              {/* 헤더 */}
              <div className="shrink-0 border-b border-[#D4CFC4]/60">
                <div className="flex items-center justify-center px-3 py-2">
                  <h1 className="font-bold text-sm text-[#1A1A1A]">퀴즈 수정</h1>
                </div>
                {/* 탭 */}
                <div className="flex border-t border-[#D4CFC4]/60">
                  <button
                    type="button"
                    onClick={() => setEditMode('meta')}
                    className={`flex-1 py-2 text-xs font-bold transition-colors ${
                      editMode === 'meta'
                        ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                        : 'bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
                    }`}
                  >
                    퀴즈 정보
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditMode('questions')}
                    className={`flex-1 py-2 text-xs font-bold transition-colors border-l border-[#D4CFC4]/60 ${
                      editMode === 'questions'
                        ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                        : 'bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
                    }`}
                  >
                    문제 수정 ({questions.length})
                  </button>
                </div>
              </div>

              {/* 스크롤 콘텐츠 */}
              <div className="flex-1 overflow-y-auto overscroll-contain">
                <main className="px-3 py-4 max-w-lg mx-auto space-y-4">
                  {editMode === 'meta' && (
                    <QuizMetaForm
                      meta={quizMeta}
                      onChange={setQuizMeta}
                      errors={metaErrors}
                      courseId={userCourseId || undefined}
                    />
                  )}

                  {editMode === 'questions' && (
                    <>
                      <AnimatePresence>
                        {(editingIndex !== null || isAddingNew) && (
                          <QuestionEditor
                            initialQuestion={editingIndex !== null ? questions[editingIndex] : undefined}
                            onSave={handleSaveQuestion}
                            onCancel={handleCancelEdit}
                            questionNumber={editingIndex !== null ? editingIndex + 1 : questions.length + 1}
                            courseId={userCourseId || undefined}
                            extractedImages={extractedImages}
                            onAddExtracted={handleExtractImage}
                            onRemoveExtracted={handleRemoveExtractedImage}
                          />
                        )}
                      </AnimatePresence>

                      {editingIndex === null && !isAddingNew && (
                        <>
                          <div>
                            <QuestionList
                              questions={questions}
                              onQuestionsChange={setQuestions}
                              onEditQuestion={handleEditQuestion}
                              userRole="student"
                              isPanelMode={isPanelMode}
                            />
                          </div>

                          <button
                            type="button"
                            onClick={handleStartAddQuestion}
                            className="w-full py-3 flex items-center justify-center gap-1.5 border-2 border-dashed border-[#1A1A1A] text-[#1A1A1A] text-xs font-bold hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            문제 추가
                          </button>
                        </>
                      )}
                    </>
                  )}
                </main>
              </div>

              {/* 하단 저장 버튼 */}
              {editingIndex === null && !isAddingNew && (
                <div className="shrink-0 border-t border-[#D4CFC4]/60 px-3 py-3">
                  <div className="max-w-lg mx-auto">
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving || questions.length < 3}
                      className="w-full py-2.5 bg-[#1A1A1A] text-[#F5F0E8] text-xs font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 rounded-lg"
                    >
                      {isSaving && (
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      )}
                      완료하기
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      </div>

      {/* 이미지 추출 모달 */}
      {showImageExtractor && extractorFiles.length > 0 && (
        <ImageRegionSelector
          uploadedFiles={extractorFiles}
          extractedImages={extractedImages}
          onExtract={handleExtractImage}
          onRemoveExtracted={handleRemoveExtractedImage}
          onClose={() => {
            setShowImageExtractor(false);
            setExtractorFiles([]);
          }}
        />
      )}
    </>
  );
}
