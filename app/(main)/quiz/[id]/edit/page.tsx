'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, getDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import { useCourse } from '@/lib/contexts';
import { Skeleton } from '@/components/common';
import QuestionEditor, { type QuestionData, type SubQuestion } from '@/components/quiz/create/QuestionEditor';
import QuestionList from '@/components/quiz/create/QuestionList';
import QuizMetaForm, { type QuizMeta, validateRequiredTags, getChapterTags } from '@/components/quiz/create/QuizMetaForm';
import ImageRegionSelector, { type UploadedFileItem } from '@/components/quiz/create/ImageRegionSelector';

/**
 * 퀴즈 수정 페이지 (학생용)
 */
export default function EditQuizPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { userCourseId } = useCourse();
  const quizId = params.id as string;

  // 어디서 왔는지 확인 (manage: 퀴즈 관리창)
  const fromManage = searchParams.get('from') === 'manage';

  // 뒤로가기 핸들러 (관리창에서 왔으면 관리창으로, 아니면 퀴즈 목록으로)
  const handleGoBack = useCallback(() => {
    if (fromManage) {
      router.push('/quiz?manage=true');
    } else {
      router.push('/quiz');
    }
  }, [router, fromManage]);

  // 상태
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 퀴즈 메타 정보 (제목, 난이도, 태그)
  const [quizMeta, setQuizMeta] = useState<QuizMeta>({
    title: '',
    tags: [],
    isPublic: true,
    difficulty: 'normal',
  });
  const [metaErrors, setMetaErrors] = useState<{ title?: string; tags?: string }>({});

  // 문제 관리
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [originalQuestions, setOriginalQuestions] = useState<any[]>([]); // 원본 문제 (수정 감지용)
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // 현재 편집 모드 (meta: 메타정보 수정, questions: 문제 수정)
  const [editMode, setEditMode] = useState<'meta' | 'questions'>('questions');

  // 추출 이미지 관련 상태
  const [extractedImages, setExtractedImages] = useState<Array<{ id: string; dataUrl: string; sourceFileName?: string }>>([]);
  const [showImageExtractor, setShowImageExtractor] = useState(false);
  const [extractorFiles, setExtractorFiles] = useState<UploadedFileItem[]>([]);
  const [isExtractProcessing, setIsExtractProcessing] = useState(false);
  const extractFileInputRef = useRef<HTMLInputElement>(null);

  // blob → dataUrl 변환
  const blobToDataUrl = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, []);

  // 이미지 추출용 파일 선택 핸들러
  const handleExtractFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileArray = Array.from(e.target.files || []);
    if (fileArray.length === 0) return;
    e.target.value = '';

    setIsExtractProcessing(true);
    const items: UploadedFileItem[] = [];

    try {
      for (const file of fileArray) {
        if (file.name.endsWith('.pptx') || file.type.includes('presentation')) {
          try {
            const idToken = await auth.currentUser!.getIdToken();
            const formData = new FormData();
            formData.append('file', file);
            const resp = await fetch(
              `${process.env.NEXT_PUBLIC_PPTX_CLOUD_RUN_URL}/convert-pdf`,
              {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${idToken}` },
                body: formData,
              }
            );
            if (!resp.ok) {
              const errData = await resp.json().catch(() => ({ error: resp.statusText }));
              throw new Error(errData.error || 'PDF 변환 실패');
            }
            const pdfBlob = await resp.blob();
            const pdfFile = new File(
              [pdfBlob],
              file.name.replace(/\.pptx$/i, '.pdf'),
              { type: 'application/pdf' }
            );
            items.push({ id: `pdf-${Date.now()}-${file.name}`, file: pdfFile, preview: 'pdf' });
          } catch (err) {
            console.error('PPT 변환 실패:', err);
            alert('PPT 파일을 변환하는 중 오류가 발생했습니다.');
          }
        } else if (file.type === 'application/pdf') {
          items.push({ id: `pdf-${Date.now()}-${file.name}`, file, preview: 'pdf' });
        } else if (file.type.startsWith('image/')) {
          items.push({
            id: `img-${Date.now()}-${file.name}`,
            file,
            preview: await blobToDataUrl(file),
          });
        }
      }
      if (items.length > 0) {
        setExtractorFiles(items);
        setShowImageExtractor(true);
      }
    } finally {
      setIsExtractProcessing(false);
    }
  }, [blobToDataUrl]);

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

        // 본인이 만든 퀴즈인지 확인
        if (data.creatorId !== user.uid) {
          setError('수정 권한이 없습니다.');
          return;
        }

        // 메타 정보 로드
        setQuizMeta({
          title: data.title || '',
          tags: data.tags || [],
          isPublic: data.isPublic !== false,
          difficulty: data.difficulty || 'normal',
        });

        // 원본 문제 저장 (수정 감지용)
        setOriginalQuestions(data.questions || []);

        // 문제 데이터 변환 (결합형 문제 재조합 포함)
        const rawQuestions = data.questions || [];
        const loadedQuestions: QuestionData[] = [];
        const processedCombinedGroups = new Set<string>();

        rawQuestions.forEach((q: any, index: number) => {
          // 결합형 문제인 경우: combinedGroupId로 그룹핑하여 재조합
          if (q.combinedGroupId) {
            // 이미 처리된 그룹이면 스킵
            if (processedCombinedGroups.has(q.combinedGroupId)) {
              return;
            }
            processedCombinedGroups.add(q.combinedGroupId);

            // 같은 combinedGroupId를 가진 모든 하위 문제 찾기
            const groupQuestions = rawQuestions.filter(
              (gq: any) => gq.combinedGroupId === q.combinedGroupId
            ).sort((a: any, b: any) => (a.combinedIndex || 0) - (b.combinedIndex || 0));

            // 첫 번째 하위 문제에서 공통 정보 추출
            const firstQ = groupQuestions[0];

            // 하위 문제들을 SubQuestion 형태로 변환
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
              };
            });

            // 결합형 문제로 재조합
            const combinedQuestion: QuestionData = {
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
            };

            loadedQuestions.push(combinedQuestion);
          } else {
            // 일반 문제: 기존 변환 로직
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

  /**
   * 문제 내용이 변경되었는지 확인
   */
  const isQuestionChanged = (original: any, current: QuestionData): boolean => {
    if (!original) return true; // 새 문제

    // 텍스트 비교
    if (original.text !== current.text) return true;

    // 타입 비교
    if (original.type !== current.type) return true;

    // 정답 비교
    if (current.type === 'subjective' || current.type === 'short_answer') {
      if (original.answer !== current.answerText) return true;
    } else if (current.type === 'multiple') {
      const origAnswer = typeof original.answer === 'number' ? original.answer - 1 : -1;
      if (origAnswer !== current.answerIndex) return true;
    } else if (current.type === 'ox') {
      if (original.answer !== current.answerIndex) return true;
    }

    // 선지 비교 (객관식)
    if (current.type === 'multiple') {
      const origChoices = original.choices || [];
      const currChoices = current.choices.filter((c) => c.trim());
      if (origChoices.length !== currChoices.length) return true;
      for (let i = 0; i < currChoices.length; i++) {
        if (origChoices[i] !== currChoices[i]) return true;
      }
    }

    // 해설 비교
    if ((original.explanation || '') !== (current.explanation || '')) return true;

    // 이미지 비교
    if ((original.imageUrl || null) !== (current.imageUrl || null)) return true;

    // 챕터 비교
    if ((original.chapterId || '') !== (current.chapterId || '')) return true;
    if ((original.chapterDetailId || '') !== (current.chapterDetailId || '')) return true;

    return false;
  };

  /**
   * 결합형 하위 문제 변경 확인
   */
  const isQuestionChangedForSubQuestion = (original: any, current: SubQuestion): boolean => {
    if (!original) return true;

    // 텍스트 비교
    if (original.text !== current.text) return true;

    // 타입 비교
    if (original.type !== current.type) return true;

    // 정답 비교
    if (current.type === 'subjective' || current.type === 'short_answer') {
      if (original.answer !== (current.answerText || '')) return true;
    } else if (current.type === 'multiple') {
      const origAnswer = typeof original.answer === 'number' ? original.answer - 1 : -1;
      if (origAnswer !== (current.answerIndex ?? -1)) return true;
    } else if (current.type === 'ox') {
      if (original.answer !== (current.answerIndex ?? 0)) return true;
    }

    // 선지 비교 (객관식)
    if (current.type === 'multiple') {
      const origChoices = original.choices || [];
      const currChoices = (current.choices || []).filter((c) => c.trim());
      if (origChoices.length !== currChoices.length) return true;
      for (let i = 0; i < currChoices.length; i++) {
        if (origChoices[i] !== currChoices[i]) return true;
      }
    }

    // 해설 비교
    if ((original.explanation || '') !== (current.explanation || '')) return true;

    // 이미지 비교
    if ((original.imageUrl || null) !== (current.image || null)) return true;

    return false;
  };

  // Firestore용 데이터 정제 함수 (undefined, File, Blob 등 제거)
  const sanitizeForFirestore = (obj: any, depth = 0): any => {
    // 무한 재귀 방지
    if (depth > 20) {
      console.warn('sanitizeForFirestore: max depth reached');
      return null;
    }

    // null, undefined 처리
    if (obj === null || obj === undefined) {
      return null;
    }

    // 기본 타입 (string, number, boolean)
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    // Firestore Timestamp 유지
    if (obj instanceof Timestamp) {
      return obj;
    }

    // Date -> Timestamp 변환
    if (obj instanceof Date) {
      return Timestamp.fromDate(obj);
    }

    // Firestore에서 가져온 Timestamp가 plain object로 역직렬화된 경우 처리
    if (typeof obj === 'object' && obj !== null && 'seconds' in obj && 'nanoseconds' in obj && Object.keys(obj).length === 2) {
      try {
        return new Timestamp(obj.seconds, obj.nanoseconds);
      } catch {
        return null;
      }
    }

    // File, Blob 등 직렬화 불가능한 타입 제거
    if (typeof File !== 'undefined' && obj instanceof File) {
      console.warn('sanitizeForFirestore: File object removed');
      return null;
    }
    if (typeof Blob !== 'undefined' && obj instanceof Blob) {
      console.warn('sanitizeForFirestore: Blob object removed');
      return null;
    }

    // 함수 제거
    if (typeof obj === 'function') {
      return null;
    }

    // 배열 처리 (빈 배열은 그대로 유지)
    if (Array.isArray(obj)) {
      const sanitized = obj
        .map(item => sanitizeForFirestore(item, depth + 1))
        .filter(item => item !== undefined);
      return sanitized;
    }

    // 일반 객체 처리
    if (typeof obj === 'object') {
      // constructor 체크로 순수 객체인지 확인
      if (obj.constructor && obj.constructor !== Object && obj.constructor.name !== 'Object') {
        // Map, Set 등 특수 객체는 plain object로 변환 시도
        if (obj instanceof Map) {
          return sanitizeForFirestore(Object.fromEntries(obj), depth + 1);
        }
        if (obj instanceof Set) {
          return sanitizeForFirestore(Array.from(obj), depth + 1);
        }
        // 기타 특수 객체는 제거
        console.warn(`sanitizeForFirestore: ${obj.constructor.name} object removed`);
        return null;
      }

      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          const sanitizedValue = sanitizeForFirestore(value, depth + 1);
          if (sanitizedValue !== undefined) {
            result[key] = sanitizedValue;
          }
        }
      }
      return Object.keys(result).length > 0 ? result : null;
    }

    return obj;
  };

  // 퀴즈 저장
  const handleSave = async () => {
    if (!user || !quizId) return;

    // 메타 정보 유효성 검사
    const errors: { title?: string; tags?: string } = {};

    if (!quizMeta.title.trim()) {
      errors.title = '퀴즈 제목을 입력해주세요.';
    }

    const chapterTags = getChapterTags(userCourseId || undefined);
    const tagError = validateRequiredTags(quizMeta.tags, chapterTags);
    if (tagError) {
      errors.tags = tagError;
    }

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

      // 문제를 펼친 배열 생성 (결합형 문제는 하위 문제로 분리)
      const flattenedQuestions: any[] = [];
      let orderIndex = 0;

      questions.forEach((q) => {
        // 결합형 문제: 하위 문제를 개별 문제로 펼침
        if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
          const combinedGroupId = q.id || `combined_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const subQuestionsCount = q.subQuestions.length;

          // 공통 지문 변경 감지 (원본 첫 번째 하위 문제와 비교)
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
            // 정답 처리
            let answer: string | number;
            if (sq.type === 'subjective' || sq.type === 'short_answer') {
              answer = sq.answerText || '';
            } else if (sq.type === 'multiple') {
              answer = (sq.answerIndex !== undefined && sq.answerIndex >= 0) ? sq.answerIndex + 1 : -1;
            } else {
              answer = sq.answerIndex ?? 0;
            }

            // 기존 문제 찾기 (ID로 찾기)
            const originalQ = originalQuestions.find((oq) => oq.id === sq.id);
            const hasChanged = !originalQ || passageChanged || isQuestionChangedForSubQuestion(originalQ, sq);

            const subQuestionData: any = {
              ...(originalQ || {}),
              id: sq.id || `${combinedGroupId}_${sqIndex}`,
              order: orderIndex++,
              text: sq.text,
              type: sq.type,
              choices: sq.type === 'multiple' ? (sq.choices || []).filter((c) => c.trim()) : null,
              answer,
              explanation: sq.explanation || null,
              imageUrl: sq.image || null,
              examples: sq.mixedExamples || null,
              mixedExamples: sq.mixedExamples || null,
              // 결합형 그룹 정보
              combinedGroupId,
              combinedIndex: sqIndex,
              combinedTotal: subQuestionsCount,
              // 챕터 정보
              chapterId: sq.chapterId || null,
              chapterDetailId: sq.chapterDetailId || null,
              // 문제별 수정 시간
              questionUpdatedAt: hasChanged ? Timestamp.now() : (originalQ?.questionUpdatedAt || null),
            };

            // 첫 번째 하위 문제에만 공통 정보 추가
            if (sqIndex === 0) {
              subQuestionData.passageType = q.passageType || null;
              subQuestionData.passage = q.passage || null;
              subQuestionData.koreanAbcItems = q.koreanAbcItems || null;
              subQuestionData.passageMixedExamples = q.passageMixedExamples || null;
              subQuestionData.passageImage = q.passageImage || null;
              subQuestionData.commonQuestion = q.commonQuestion || null;
              subQuestionData.combinedMainText = q.text || '';
            }

            flattenedQuestions.push(sanitizeForFirestore(subQuestionData));
          });
        } else {
          // 일반 문제
          let answer: string | number;
          if (q.type === 'subjective' || q.type === 'short_answer') {
            answer = q.answerText;
          } else if (q.type === 'multiple') {
            answer = q.answerIndex >= 0 ? q.answerIndex + 1 : -1;
          } else {
            answer = q.answerIndex;
          }

          // 기존 문제 찾기 (ID로만)
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
            imageUrl: q.imageUrl || null,
            examples: q.examples || null,
            mixedExamples: q.mixedExamples || null,
            chapterId: q.chapterId || null,
            chapterDetailId: q.chapterDetailId || null,
            questionUpdatedAt: hasChanged ? Timestamp.now() : (originalQ?.questionUpdatedAt || null),
          }));
        }
      });

      // 실제 문제 수 계산 (결합형 하위 문제 포함)
      const questionCount = flattenedQuestions.length;

      const quizData = {
        title: quizMeta.title.trim(),
        tags: quizMeta.tags,
        difficulty: quizMeta.difficulty,
        isPublic: quizMeta.isPublic,
        questions: flattenedQuestions,
        questionCount,
        // 문제 유형별 개수
        oxCount: flattenedQuestions.filter(q => q.type === 'ox').length,
        multipleChoiceCount: flattenedQuestions.filter(q => q.type === 'multiple').length,
        subjectiveCount: flattenedQuestions.filter(q => q.type === 'short_answer' || q.type === 'subjective').length,
        updatedAt: serverTimestamp(),
      };

      // 디버깅: 저장할 데이터 출력
      console.log('Saving quiz data:', JSON.stringify(quizData, (key, value) => {
        if (value instanceof Timestamp) return `Timestamp(${value.toDate().toISOString()})`;
        return value;
      }, 2));

      await updateDoc(doc(db, 'quizzes', quizId), quizData);
      alert('퀴즈가 수정되었습니다.');
      handleGoBack();
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
          onClick={handleGoBack}
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
                handleGoBack();
              }
            }}
            className="flex items-center gap-2 text-sm text-[#1A1A1A]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            뒤로가기
          </button>
          <h1 className="font-bold text-lg text-[#1A1A1A]">퀴즈 수정</h1>
          <div className="w-20" />
        </div>

        {/* 탭 */}
        <div className="flex border-t border-[#1A1A1A]">
          <button
            type="button"
            onClick={() => setEditMode('meta')}
            className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
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
            className={`flex-1 py-2.5 text-sm font-bold transition-colors border-l border-[#1A1A1A] ${
              editMode === 'questions'
                ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                : 'bg-[#F5F0E8] text-[#1A1A1A] hover:bg-[#EDEAE4]'
            }`}
          >
            문제 수정 ({questions.length})
          </button>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="px-4 py-6 max-w-lg mx-auto space-y-6">
        {/* 메타 정보 수정 모드 */}
        {editMode === 'meta' && (
          <QuizMetaForm
            meta={quizMeta}
            onChange={setQuizMeta}
            errors={metaErrors}
            courseId={userCourseId || undefined}
          />
        )}

        {/* 문제 수정 모드 */}
        {editMode === 'questions' && (
          <>
            {/* 이미지 추출 버튼 */}
            <div className="space-y-2">
              <input
                ref={extractFileInputRef}
                type="file"
                accept="image/*,.pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                multiple
                className="hidden"
                onChange={handleExtractFileSelect}
              />
              <button
                type="button"
                onClick={() => extractFileInputRef.current?.click()}
                disabled={isExtractProcessing}
                className="w-full py-2.5 text-sm font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isExtractProcessing ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    변환 중...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    이미지 추출 (이미지 / PDF / PPT)
                  </>
                )}
              </button>

              {extractedImages.length > 0 && (
                <div className="bg-[#E8F5E9] p-3 border border-[#1A6B1A]">
                  <p className="text-xs text-[#1A6B1A] font-bold">
                    추출된 이미지 {extractedImages.length}개가 있습니다.
                  </p>
                </div>
              )}
            </div>

            {/* 문제 편집기 */}
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
                    userRole="student"
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
              완료하기
            </button>
          </div>
        </div>
      )}

      {/* 이미지 추출 모달 (ImageRegionSelector) */}
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
    </div>
  );
}
