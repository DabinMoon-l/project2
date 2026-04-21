'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { QuestionType } from '@/lib/ocr';
import ChapterSelector from './ChapterSelector';
import ExtractedImagePicker from './ExtractedImagePicker';

// 분리된 모듈에서 임포트
import type {
  ExamplesType,
  MixedExampleBlock,
  MixedExampleItem,
  QuestionData,
  SubQuestion,
  ExtractedImageForEditor,
  QuestionEditorProps,
} from './questionTypes';
import {
  KOREAN_LABELS,
  GANA_LABELS,
  BOGI_QUESTION_PRESETS,
} from './questionTypes';
import { generateId, typeLabels, getInitialQuestionData, validateQuestion } from './questionUtils';
import SubQuestionMixedExamplesEditor from './SubQuestionMixedExamplesEditor';
import SubQuestionEditor from './SubQuestionEditor';
import OXAnswerEditor from './editors/OXAnswerEditor';
import MultipleChoiceEditor from './editors/MultipleChoiceEditor';
import ShortAnswerEditor from './editors/ShortAnswerEditor';
import BogiEditor from './editors/BogiEditor';
import MixedExamplesEditor from './editors/MixedExamplesEditor';

// 기존 import 경로 호환을 위한 re-export
export type { ExamplesType, ExamplesData, LabeledItem, MixedExampleBlock, PassageBlock, BogiData, MixedExampleItem, PassageType, KoreanAbcItem, SubQuestion, QuestionData, ExtractedImageForEditor } from './questionTypes';
export { BOGI_QUESTION_PRESETS, KOREAN_LABELS, GANA_LABELS } from './questionTypes';
export { calculateTotalQuestionCount } from './questionUtils';

// ============================================================
// 메인 컴포넌트
// ============================================================

/**
 * 문제 편집기 컴포넌트
 *
 * 문제 텍스트, 유형, 선지, 정답, 해설을 입력/수정할 수 있습니다.
 * OX, 객관식, 단답형, 서술형, 결합형을 지원합니다.
 */
export default function QuestionEditor({
  initialQuestion,
  onSave,
  onCancel,
  questionNumber,
  className = '',
  userRole = 'student',
  courseId,
  extractedImages = [],
  onAddExtracted,
  onRemoveExtracted,
}: QuestionEditorProps) {
  // 상태
  const [question, setQuestion] = useState<QuestionData>(() => getInitialQuestionData(initialQuestion));
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 이미지 업로드 관련
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [imageUrlInputValue, setImageUrlInputValue] = useState('');
  const imageUrlInputRef = useRef<HTMLInputElement>(null);
  const [showPassageImageUrlInput, setShowPassageImageUrlInput] = useState(false);
  const [passageImageUrlInputValue, setPassageImageUrlInputValue] = useState('');
  const passageImageUrlInputRef = useRef<HTMLInputElement>(null);

  // 보기 추가 모드
  const [showExamplesEditor, setShowExamplesEditor] = useState(
    () => !!(getInitialQuestionData(initialQuestion).examples || (getInitialQuestionData(initialQuestion).mixedExamples?.length ?? 0) > 0)
  );

  // 복수정답 모드 (객관식에서만 사용)
  const [isMultipleAnswerMode, setIsMultipleAnswerMode] = useState(
    () => (getInitialQuestionData(initialQuestion).answerIndices?.length || 0) > 1
  );

  // 추출 이미지 선택 모달 표시 여부
  const [showExtractedImagePicker, setShowExtractedImagePicker] = useState(false);
  // 추출 이미지 선택 대상 ('question' | 'passage' | 'example')
  const [extractedImageTarget, setExtractedImageTarget] = useState<'question' | 'passage' | 'example'>('question');

  // 묶기 모드 관련 상태
  const [isGroupingMode, setIsGroupingMode] = useState(false);
  // 묶기 선택 항목 (블록 ID -> 선택 순서)
  const [groupingSelection, setGroupingSelection] = useState<Map<string, number>>(new Map());

  // 초기 문제가 변경되면 상태 업데이트
  useEffect(() => {
    setQuestion(getInitialQuestionData(initialQuestion));
    setErrors({});
  }, [initialQuestion]);

  /**
   * 문제 유형 변경
   */
  const handleTypeChange = useCallback((type: QuestionType) => {
    setQuestion((prev) => ({
      ...prev,
      type,
      // 유형 변경 시 정답 초기화
      answerIndex: -1,
      answerIndices: [],
      answerText: '',
      answerTexts: [''],
      // 객관식일 때만 선지 유지
      choices: type === 'multiple' ? (prev.choices.length >= 2 ? prev.choices : ['', '']) : ['', ''],
      scoringMethod: type === 'essay' ? 'manual' : prev.scoringMethod,
      // 결합형일 때 하위 문제 초기화
      subQuestions: type === 'combined' ? [{
        id: generateId(),
        text: '',
        type: 'multiple',
        choices: ['', ''],
        answerIndex: -1,
        answerIndices: [],
      }] : [],
      // 결합형 관련 필드 초기화
      passageType: type === 'combined' ? 'text' : prev.passageType,
      koreanAbcItems: type === 'combined' ? [] : prev.koreanAbcItems,
      passageImage: type === 'combined' ? null : prev.passageImage,
      passage: type === 'combined' ? '' : prev.passage,
    }));
    setErrors({});
    // 객관식이 아니면 복수정답 모드 해제
    if (type !== 'multiple') {
      setIsMultipleAnswerMode(false);
    }
  }, []);

  /**
   * 텍스트 필드 변경
   */
  const handleTextChange = useCallback((field: keyof QuestionData, value: string) => {
    setQuestion((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  }, []);

  /**
   * 선지 변경
   */
  const handleChoiceChange = useCallback((index: number, value: string) => {
    setQuestion((prev) => {
      const newChoices = [...prev.choices];
      newChoices[index] = value;
      return { ...prev, choices: newChoices };
    });
    setErrors((prev) => ({ ...prev, choices: '' }));
  }, []);

  /**
   * 선지 추가
   */
  const handleAddChoice = useCallback(() => {
    setQuestion((prev) => {
      if (prev.choices.length >= 8) return prev;
      return { ...prev, choices: [...prev.choices, ''] };
    });
  }, []);

  /**
   * 선지 삭제
   */
  const handleRemoveChoice = useCallback((index: number) => {
    setQuestion((prev) => {
      if (prev.choices.length <= 2) return prev;
      const newChoices = prev.choices.filter((_, i) => i !== index);
      // 정답 인덱스 조정
      let newAnswerIndex = prev.answerIndex;
      let newAnswerIndices = prev.answerIndices || [];
      if (newAnswerIndex >= index) {
        newAnswerIndex = newAnswerIndex > index ? newAnswerIndex - 1 : -1;
      }
      newAnswerIndices = newAnswerIndices
        .filter(i => i !== index)
        .map(i => i > index ? i - 1 : i);
      return {
        ...prev,
        choices: newChoices,
        answerIndex: newAnswerIndex,
        answerIndices: newAnswerIndices,
      };
    });
  }, []);

  /**
   * 정답 선택 (OX/객관식)
   */
  const handleAnswerSelect = useCallback((index: number) => {
    setQuestion((prev) => {
      // 복수정답 모드일 때 (객관식만)
      if (isMultipleAnswerMode && prev.type === 'multiple') {
        const currentIndices = prev.answerIndices || [];
        let newIndices: number[];

        if (currentIndices.includes(index)) {
          // 이미 선택된 경우 제거
          newIndices = currentIndices.filter(i => i !== index);
        } else {
          // 새로 선택 추가
          newIndices = [...currentIndices, index].sort((a, b) => a - b);
        }

        return {
          ...prev,
          answerIndices: newIndices,
          // answerIndex는 첫 번째 선택된 것으로 설정 (호환성)
          answerIndex: newIndices.length > 0 ? newIndices[0] : -1,
        };
      }

      // 단일 정답 모드
      return {
        ...prev,
        answerIndex: index,
        answerIndices: [index],
      };
    });
    setErrors((prev) => ({ ...prev, answer: '' }));
  }, [isMultipleAnswerMode]);

  /**
   * 복수정답 모드 토글
   */
  const handleToggleMultipleAnswer = useCallback(() => {
    setIsMultipleAnswerMode(prev => {
      const newMode = !prev;
      // 모드 변경 시 정답 초기화
      if (!newMode) {
        // 복수정답 -> 단일정답: 첫 번째 정답만 유지
        setQuestion(q => {
          const firstAnswer = (q.answerIndices || [])[0] ?? -1;
          return {
            ...q,
            answerIndex: firstAnswer,
            answerIndices: firstAnswer >= 0 ? [firstAnswer] : [],
          };
        });
      }
      return newMode;
    });
  }, []);

  /**
   * 단답형 정답 텍스트 변경
   */
  const handleAnswerTextChange = useCallback((index: number, value: string) => {
    setQuestion((prev) => {
      const newAnswerTexts = [...(prev.answerTexts || [''])];
      newAnswerTexts[index] = value;
      return {
        ...prev,
        answerTexts: newAnswerTexts,
        // answerText는 첫 번째 정답으로 설정 (호환성)
        answerText: newAnswerTexts[0] || '',
      };
    });
    setErrors((prev) => ({ ...prev, answer: '' }));
  }, []);

  /**
   * 단답형 정답 추가
   */
  const handleAddAnswerText = useCallback(() => {
    setQuestion((prev) => {
      const currentTexts = prev.answerTexts || [''];
      if (currentTexts.length >= 5) return prev; // 최대 5개
      return {
        ...prev,
        answerTexts: [...currentTexts, ''],
      };
    });
  }, []);

  /**
   * 단답형 정답 삭제
   */
  const handleRemoveAnswerText = useCallback((index: number) => {
    setQuestion((prev) => {
      const currentTexts = prev.answerTexts || [''];
      if (currentTexts.length <= 1) return prev; // 최소 1개 유지
      const newTexts = currentTexts.filter((_, i) => i !== index);
      return {
        ...prev,
        answerTexts: newTexts,
        answerText: newTexts[0] || '',
      };
    });
  }, []);

  /**
   * 이미지 업로드 핸들러
   */
  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 파일 타입 검사
    if (!file.type.startsWith('image/')) {
      setErrors((prev) => ({ ...prev, image: '이미지 파일만 업로드할 수 있습니다.' }));
      return;
    }

    // 파일 크기 검사 (5MB 제한)
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, image: '파일 크기는 5MB 이하여야 합니다.' }));
      return;
    }

    setIsUploadingImage(true);
    setErrors((prev) => ({ ...prev, image: '' }));

    try {
      // Base64로 변환 (Firebase Storage 업로드 대신 로컬 저장)
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageUrl = event.target?.result as string;
        setQuestion((prev) => ({ ...prev, imageUrl }));
        setIsUploadingImage(false);
      };
      reader.onerror = () => {
        setErrors((prev) => ({ ...prev, image: '이미지 업로드에 실패했습니다.' }));
        setIsUploadingImage(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      setErrors((prev) => ({ ...prev, image: '이미지 업로드에 실패했습니다.' }));
      setIsUploadingImage(false);
    }
  }, []);

  /**
   * 이미지 삭제
   */
  const handleRemoveImage = useCallback(() => {
    setQuestion((prev) => ({ ...prev, imageUrl: null }));
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  }, []);

  /**
   * 결합형 공통 이미지(passageImage) 업로드 핸들러
   */
  const handlePassageImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrors((prev) => ({ ...prev, passageImage: '이미지 파일만 업로드할 수 있습니다.' }));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, passageImage: '파일 크기는 5MB 이하여야 합니다.' }));
      return;
    }

    setErrors((prev) => ({ ...prev, passageImage: '' }));

    const reader = new FileReader();
    reader.onload = (event) => {
      const passageImage = event.target?.result as string;
      setQuestion((prev) => ({ ...prev, passageImage }));
    };
    reader.onerror = () => {
      setErrors((prev) => ({ ...prev, passageImage: '이미지 업로드에 실패했습니다.' }));
    };
    reader.readAsDataURL(file);
  }, []);

  /**
   * 결합형 공통 이미지(passageImage) 삭제
   */
  const handleRemovePassageImage = useCallback(() => {
    setQuestion((prev) => ({ ...prev, passageImage: null }));
  }, []);

  /**
   * 추출 이미지 선택 시 처리
   */
  const handleSelectExtractedImage = useCallback((dataUrl: string) => {
    if (extractedImageTarget === 'question') {
      setQuestion((prev) => ({ ...prev, imageUrl: dataUrl }));
    } else if (extractedImageTarget === 'passage') {
      setQuestion((prev) => ({ ...prev, passageImage: dataUrl }));
    } else if (extractedImageTarget === 'example') {
      // 보기 블록에 이미지 추가 (인라인 처리)
      setQuestion((prev) => {
        const mixedExamples = [...(prev.mixedExamples || [])];
        if (mixedExamples.length < 10) {
          mixedExamples.push({
            id: `ex_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: 'image',
            imageUrl: dataUrl,
          });
        }
        return { ...prev, mixedExamples };
      });
    }
    setShowExtractedImagePicker(false);
  }, [extractedImageTarget]);

  /**
   * 혼합 보기 항목 ID 생성
   */
  const generateExampleId = useCallback(() => {
    return `ex_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  }, []);

  /**
   * 텍스트박스 블록 추가
   */
  const handleAddTextExample = useCallback(() => {
    setQuestion((prev) => {
      const mixedExamples = [...(prev.mixedExamples || [])];
      if (mixedExamples.length < 10) {
        mixedExamples.push({
          id: generateExampleId(),
          type: 'text',
          content: '',
        });
      }
      return { ...prev, mixedExamples };
    });
  }, [generateExampleId]);

  /**
   * ㄱ.ㄴ.ㄷ. 블록 추가 (기본 ㄱ 항목 1개 포함)
   */
  const handleAddLabeledExample = useCallback(() => {
    setQuestion((prev) => {
      const mixedExamples = [...(prev.mixedExamples || [])];
      if (mixedExamples.length < 10) {
        mixedExamples.push({
          id: generateExampleId(),
          type: 'labeled',
          items: [{
            id: generateExampleId(),
            label: 'ㄱ',
            content: '',
          }],
        });
      }
      return { ...prev, mixedExamples };
    });
  }, [generateExampleId]);

  /**
   * (가)(나)(다) 블록 추가 (기본 가 항목 1개 포함)
   */
  const handleAddGanaExample = useCallback(() => {
    setQuestion((prev) => {
      const mixedExamples = [...(prev.mixedExamples || [])];
      if (mixedExamples.length < 10) {
        mixedExamples.push({
          id: generateExampleId(),
          type: 'gana',
          items: [{
            id: generateExampleId(),
            label: '가',
            content: '',
          }],
        });
      }
      return { ...prev, mixedExamples };
    });
  }, [generateExampleId]);

  /**
   * ◦ 항목 블록 추가 (기본 1개 포함)
   */
  const handleAddBulletExample = useCallback(() => {
    setQuestion((prev) => {
      const mixedExamples = [...(prev.mixedExamples || [])];
      if (mixedExamples.length < 10) {
        mixedExamples.push({
          id: generateExampleId(),
          type: 'bullet',
          items: [{
            id: generateExampleId(),
            label: '◦',
            content: '',
          }],
        });
      }
      return { ...prev, mixedExamples };
    });
  }, [generateExampleId]);

  /**
   * labeled, gana 또는 bullet 블록 내에 항목 추가
   */
  const handleAddLabeledItem = useCallback((blockId: string) => {
    setQuestion((prev) => {
      const mixedExamples = (prev.mixedExamples || []).map(block => {
        if (block.id === blockId && (block.type === 'labeled' || block.type === 'gana' || block.type === 'bullet')) {
          const items = block.items || [];
          if (block.type === 'bullet') {
            // bullet은 항상 ◦, 최대 20개까지
            if (items.length < 20) {
              return {
                ...block,
                items: [...items, {
                  id: generateExampleId(),
                  label: '◦',
                  content: '',
                }],
              };
            }
          } else {
            const labels = block.type === 'gana' ? GANA_LABELS : KOREAN_LABELS;
            if (items.length < labels.length) {
              const nextLabel = labels[items.length];
              return {
                ...block,
                items: [...items, {
                  id: generateExampleId(),
                  label: nextLabel,
                  content: '',
                }],
              };
            }
          }
        }
        return block;
      });
      return { ...prev, mixedExamples };
    });
  }, [generateExampleId]);

  /**
   * 텍스트박스 블록 내용 변경
   */
  const handleTextBlockChange = useCallback((blockId: string, content: string) => {
    setQuestion((prev) => {
      const mixedExamples = (prev.mixedExamples || []).map(block =>
        block.id === blockId && block.type === 'text'
          ? { ...block, content }
          : block
      );
      return { ...prev, mixedExamples };
    });
  }, []);

  /**
   * labeled 또는 gana 블록 내 항목 내용 변경
   */
  const handleLabeledItemChange = useCallback((blockId: string, itemId: string, content: string) => {
    setQuestion((prev) => {
      const mixedExamples = (prev.mixedExamples || []).map(block => {
        if (block.id === blockId && (block.type === 'labeled' || block.type === 'gana' || block.type === 'bullet')) {
          return {
            ...block,
            items: (block.items || []).map(item =>
              item.id === itemId ? { ...item, content } : item
            ),
          };
        }
        return block;
      });
      return { ...prev, mixedExamples };
    });
  }, []);

  /**
   * 블록 삭제
   */
  const handleRemoveMixedExample = useCallback((blockId: string) => {
    setQuestion((prev) => {
      const mixedExamples = (prev.mixedExamples || []).filter(block => block.id !== blockId);
      return { ...prev, mixedExamples };
    });
  }, []);

  /**
   * labeled, gana 또는 bullet 블록 내 항목 삭제 (항목이 1개면 블록 전체 삭제)
   */
  const handleRemoveLabeledItem = useCallback((blockId: string, itemId: string) => {
    setQuestion((prev) => {
      const mixedExamples = (prev.mixedExamples || []).map(block => {
        if (block.id === blockId && (block.type === 'labeled' || block.type === 'gana' || block.type === 'bullet')) {
          const items = (block.items || []).filter(item => item.id !== itemId);
          if (items.length === 0) {
            return null; // 블록 삭제 표시
          }
          // 라벨 재정렬 (bullet은 항상 ◦, gana면 GANA_LABELS, 아니면 KOREAN_LABELS 사용)
          let reorderedItems;
          if (block.type === 'bullet') {
            reorderedItems = items.map((item) => ({
              ...item,
              label: '◦',
            }));
          } else {
            const labels = block.type === 'gana' ? GANA_LABELS : KOREAN_LABELS;
            reorderedItems = items.map((item, idx) => ({
              ...item,
              label: labels[idx] || `${idx + 1}`,
            }));
          }
          return { ...block, items: reorderedItems };
        }
        return block;
      }).filter((block): block is MixedExampleBlock => block !== null);
      return { ...prev, mixedExamples };
    });
  }, []);

  /**
   * 이미지 블록 추가
   */
  const handleAddImageExample = useCallback((imageUrl: string) => {
    setQuestion((prev) => {
      const mixedExamples = [...(prev.mixedExamples || [])];
      if (mixedExamples.length < 10) {
        mixedExamples.push({
          id: generateExampleId(),
          type: 'image',
          imageUrl,
        });
      }
      return { ...prev, mixedExamples };
    });
  }, [generateExampleId]);

  /**
   * 이미지 블록 업로드 핸들러
   */
  const handleExampleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const imageUrl = event.target?.result as string;
      handleAddImageExample(imageUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // 같은 파일 재선택 가능하도록
  }, [handleAddImageExample]);

  /**
   * 묶기 모드 토글
   */
  const handleToggleGroupingMode = useCallback(() => {
    if (isGroupingMode) {
      // 묶기 모드 해제 시 선택 초기화
      setGroupingSelection(new Map());
    }
    setIsGroupingMode(!isGroupingMode);
  }, [isGroupingMode]);

  /**
   * 묶기 항목 선택/해제 토글
   */
  const handleToggleGroupingSelection = useCallback((blockId: string) => {
    setGroupingSelection((prev) => {
      const newMap = new Map(prev);
      if (newMap.has(blockId)) {
        // 선택 해제
        const removedOrder = newMap.get(blockId)!;
        newMap.delete(blockId);
        // 순서 재정렬
        const reordered = new Map<string, number>();
        newMap.forEach((order, id) => {
          reordered.set(id, order > removedOrder ? order - 1 : order);
        });
        return reordered;
      } else {
        // 선택 추가
        const nextOrder = newMap.size + 1;
        newMap.set(blockId, nextOrder);
        return newMap;
      }
    });
  }, []);

  /**
   * 묶기 완료 - 선택된 항목들을 하나의 grouped 블록으로 결합
   */
  const handleCompleteGrouping = useCallback(() => {
    if (groupingSelection.size < 2) {
      alert('2개 이상의 항목을 선택해주세요.');
      return;
    }

    setQuestion((prev) => {
      const mixedExamples = [...(prev.mixedExamples || [])];

      // 선택된 블록들을 순서대로 정렬
      const selectedBlocks: { id: string; order: number; block: MixedExampleBlock }[] = [];
      groupingSelection.forEach((order, id) => {
        const block = mixedExamples.find(b => b.id === id);
        if (block) {
          selectedBlocks.push({ id, order, block });
        }
      });
      selectedBlocks.sort((a, b) => a.order - b.order);

      // 선택된 블록들을 리스트에서 제거
      const remainingBlocks = mixedExamples.filter(
        block => !groupingSelection.has(block.id)
      );

      // 새로운 grouped 블록 생성
      const groupedBlock: MixedExampleBlock = {
        id: generateExampleId(),
        type: 'grouped',
        children: selectedBlocks.map(item => ({ ...item.block })),
      };

      // 첫 번째 선택된 블록의 위치에 grouped 블록 삽입
      const firstSelectedIdx = mixedExamples.findIndex(
        block => block.id === selectedBlocks[0].id
      );

      const result = [...remainingBlocks];
      result.splice(firstSelectedIdx, 0, groupedBlock);

      return { ...prev, mixedExamples: result };
    });

    // 묶기 모드 종료
    setIsGroupingMode(false);
    setGroupingSelection(new Map());
  }, [groupingSelection, generateExampleId]);

  /**
   * grouped 블록 해체 (개별 블록으로 분리)
   */
  const handleUngroupBlock = useCallback((groupedBlockId: string) => {
    setQuestion((prev) => {
      const mixedExamples = [...(prev.mixedExamples || [])];
      const groupedIdx = mixedExamples.findIndex(b => b.id === groupedBlockId);

      if (groupedIdx === -1) return prev;

      const groupedBlock = mixedExamples[groupedIdx];
      if (groupedBlock.type !== 'grouped' || !groupedBlock.children) return prev;

      // grouped 블록 제거 후 children들을 해당 위치에 삽입
      mixedExamples.splice(groupedIdx, 1, ...groupedBlock.children.map(child => ({
        ...child,
        id: generateExampleId(), // 새 ID 부여
      })));

      return { ...prev, mixedExamples };
    });
  }, [generateExampleId]);

  /**
   * 보기 활성화/비활성화
   */
  const handleToggleExamples = useCallback((enabled: boolean) => {
    setShowExamplesEditor(enabled);
    if (!enabled) {
      setQuestion((prev) => ({ ...prev, examples: null, mixedExamples: [] }));
    } else {
      // 활성화 시 빈 상태로 시작 (사용자가 텍스트/ㄱㄴㄷ 선택)
      setQuestion((prev) => ({
        ...prev,
        mixedExamples: prev.mixedExamples?.length ? prev.mixedExamples : [],
      }));
    }
  }, []);

  // 기존 호환성을 위한 핸들러 (deprecated - 점진적 마이그레이션용)
  const handleExamplesTypeChange = useCallback((type: ExamplesType) => {
    setQuestion((prev) => ({
      ...prev,
      examples: {
        type,
        items: prev.examples?.items || [''],
      },
    }));
  }, []);

  const handleExamplesItemChange = useCallback((index: number, value: string) => {
    setQuestion((prev) => {
      const items = [...(prev.examples?.items || [''])];
      items[index] = value;
      return {
        ...prev,
        examples: {
          type: prev.examples?.type || 'text',
          items,
        },
      };
    });
  }, []);

  const handleAddExamplesItem = useCallback(() => {
    setQuestion((prev) => {
      const items = [...(prev.examples?.items || [''])];
      if (items.length < 6) {
        items.push('');
      }
      return {
        ...prev,
        examples: {
          type: prev.examples?.type || 'text',
          items,
        },
      };
    });
  }, []);

  const handleRemoveExamplesItem = useCallback((index: number) => {
    setQuestion((prev) => {
      const items = [...(prev.examples?.items || [''])];
      if (items.length > 1) {
        items.splice(index, 1);
      }
      return {
        ...prev,
        examples: {
          type: prev.examples?.type || 'text',
          items,
        },
      };
    });
  }, []);

  /**
   * 하위 문제 변경 (결합형)
   */
  const handleSubQuestionChange = useCallback((index: number, subQuestion: SubQuestion) => {
    setQuestion((prev) => {
      const newSubQuestions = [...(prev.subQuestions || [])];
      newSubQuestions[index] = subQuestion;
      return { ...prev, subQuestions: newSubQuestions };
    });
  }, []);

  /**
   * 하위 문제 추가 (결합형)
   */
  const handleAddSubQuestion = useCallback(() => {
    setQuestion((prev) => {
      const currentSubs = prev.subQuestions || [];
      if (currentSubs.length >= 10) return prev;
      return {
        ...prev,
        subQuestions: [
          ...currentSubs,
          {
            id: generateId(),
            text: '',
            type: 'multiple',
            choices: ['', ''],
            answerIndex: -1,
            answerIndices: [],
          },
        ],
      };
    });
  }, []);

  /**
   * 하위 문제 삭제 (결합형)
   */
  const handleRemoveSubQuestion = useCallback((index: number) => {
    setQuestion((prev) => {
      const currentSubs = prev.subQuestions || [];
      if (currentSubs.length <= 1) return prev;
      return {
        ...prev,
        subQuestions: currentSubs.filter((_, i) => i !== index),
      };
    });
  }, []);

  /**
   * 유효성 검사
   */
  const handleSave = () => {
    const newErrors = validateQuestion(question, { courseId, isMultipleAnswerMode });
    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) {
      onSave(question);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={`p-4 border-2 border-[#1A1A1A] ${className}`}
      style={{ backgroundColor: '#F5F0E8' }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold text-[#1A1A1A]">
          문제 {questionNumber}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="space-y-4">
        {/* 문제 유형 선택 */}
        <div>
          <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
            문제 유형
          </label>
          {/* 학생용: OX, 객관식, 주관식(short_answer), 결합형 - 4개 */}
          {/* 교수용: OX, 객관식, 주관식, 서술형, 결합형 - 5개 */}
          {userRole === 'student' ? (
            <div className="grid grid-cols-4 gap-2">
              {(['ox', 'multiple', 'short_answer', 'combined'] as QuestionType[]).map((type) => {
                // 학생용 라벨: short_answer는 "주관식"
                const studentLabels: Record<QuestionType, string> = {
                  ox: 'OX',
                  multiple: '객관식',
                  short_answer: '주관식',
                  subjective: '주관식',
                  essay: '서술형',
                  combined: '결합형',
                };
                return (
                  <motion.button
                    key={type}
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleTypeChange(type)}
                    className={`
                      w-full py-1.5 font-bold text-xs border-2
                      transition-colors duration-200
                      ${
                        question.type === type
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                      }
                    `}
                  >
                    {studentLabels[type]}
                  </motion.button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {(['ox', 'multiple', 'short_answer', 'essay', 'combined'] as QuestionType[]).map((type) => (
                <motion.button
                  key={type}
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleTypeChange(type)}
                  className={`
                    w-full py-1.5 font-bold text-xs border-2
                    transition-colors duration-200
                    ${
                      question.type === type
                        ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                        : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                    }
                  `}
                >
                  {typeLabels[type]}
                </motion.button>
              ))}
            </div>
          )}

          {/* 챕터 선택 (결합형이 아닌 문제만) */}
          {courseId && question.type !== 'combined' && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-[#5C5C5C]">챕터:</span>
              <ChapterSelector
                courseId={courseId}
                chapterId={question.chapterId}
                detailId={question.chapterDetailId}
                onChange={(chapterId, detailId) => {
                  setQuestion(prev => ({
                    ...prev,
                    chapterId,
                    chapterDetailId: detailId,
                  }));
                  setErrors(prev => ({ ...prev, chapter: '' }));
                }}
                error={errors.chapter}
              />
            </div>
          )}
        </div>

        {/* 결합형 공통 문제 (공통 지문 위에 표시) */}
        {question.type === 'combined' && (
          <div className="mb-4">
            <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
              공통 문제 <span className="text-[#8B1A1A]">*</span>
            </label>
            <textarea
              value={question.commonQuestion || ''}
              onChange={(e) => {
                setQuestion(prev => ({ ...prev, commonQuestion: e.target.value }));
                setErrors(prev => ({ ...prev, commonQuestion: '' }));
              }}
              placeholder="공통 문제를 입력하세요 (예: 다음 자료를 보고 물음에 답하시오.)"
              rows={2}
              className={`w-full px-3 py-2 text-sm border-2 bg-white resize-none transition-colors duration-200 focus:outline-none ${
                errors.commonQuestion ? 'border-[#8B1A1A]' : 'border-[#1A1A1A]'
              }`}
            />
            {errors.commonQuestion && (
              <p className="mt-1 text-sm text-[#8B1A1A]">{errors.commonQuestion}</p>
            )}
          </div>
        )}

        {/* 문제 텍스트 (결합형 제외) */}
        {question.type !== 'combined' && (
          <div>
            <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
              문제
            </label>
            <textarea
              value={question.text}
              onChange={(e) => handleTextChange('text', e.target.value)}
              placeholder="문제를 입력하세요"
              rows={3}
              className={`
                w-full px-3 py-2 text-sm border-2 bg-white
                resize-none
                transition-colors duration-200
                focus:outline-none
                ${errors.text ? 'border-[#8B1A1A]' : 'border-[#1A1A1A]'}
              `}
            />
            {errors.text && (
              <p className="mt-1 text-sm text-[#8B1A1A]">{errors.text}</p>
            )}
          </div>
        )}

        {/* 공통 제시문 (결합형만) - 일반 문제의 제시문과 동일한 UI */}
        {question.type === 'combined' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-[#1A1A1A]">
                공통 제시문
              </label>
              <button
                type="button"
                onClick={() => {
                  if (question.passageMixedExamples && question.passageMixedExamples.length > 0) {
                    // 제시문 삭제
                    setQuestion(prev => ({ ...prev, passageMixedExamples: undefined, passageType: undefined }));
                  } else {
                    // 제시문 추가
                    setQuestion(prev => ({ ...prev, passageMixedExamples: [], passageType: 'mixed' }));
                  }
                }}
                className={`
                  px-3 py-1 text-xs font-bold border border-[#1A1A1A]
                  transition-colors
                  ${question.passageMixedExamples && question.passageMixedExamples.length >= 0
                    ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                    : 'bg-[#EDEAE4] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                  }
                `}
              >
                {question.passageMixedExamples !== undefined ? '제시문 삭제' : '제시문 추가'}
              </button>
            </div>

            <AnimatePresence>
              {question.passageMixedExamples !== undefined && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <SubQuestionMixedExamplesEditor
                    mixedExamples={question.passageMixedExamples || []}
                    onChange={(newMixed) => setQuestion(prev => ({ ...prev, passageMixedExamples: newMixed }))}
                    onDelete={() => setQuestion(prev => ({ ...prev, passageMixedExamples: undefined, passageType: undefined }))}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 이미지 업로드 - 결합형이 아닐 때 */}
        {question.type !== 'combined' && (
          <div>
            <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
              문제 이미지 <span className="text-[#5C5C5C] font-normal">(선택)</span>
            </label>

            {question.imageUrl ? (
              <div className="relative border-2 border-[#1A1A1A] bg-[#EDEAE4] p-2">
                <img
                  src={question.imageUrl}
                  alt="문제 이미지"
                  className="w-full max-h-48 object-contain"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemoveImage();
                    setShowImageUrlInput(false);
                  }}
                  className="absolute top-1 right-1 z-10 w-8 h-8 bg-[#8B1A1A] text-[#F5F0E8] flex items-center justify-center hover:bg-[#6B1414] transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {/* 이미지 업로드 버튼 */}
                  <div className="relative flex-1">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={isUploadingImage}
                      className="hidden"
                      id="question-image"
                    />
                    <label
                      htmlFor="question-image"
                      className={`
                        flex items-center justify-center gap-2
                        w-full py-3 border-2 border-dashed border-[#1A1A1A]
                        text-[#5C5C5C] cursor-pointer
                        hover:bg-[#EDEAE4] hover:text-[#1A1A1A]
                        transition-colors text-xs
                        ${isUploadingImage ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      {isUploadingImage ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          업로드 중...
                        </span>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          이미지 업로드
                        </>
                      )}
                    </label>
                  </div>
                  {/* URL 이미지 버튼 */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowImageUrlInput(v => !v);
                      setTimeout(() => imageUrlInputRef.current?.focus(), 100);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed text-xs transition-colors ${
                      showImageUrlInput
                        ? 'border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8]'
                        : 'border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A]'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    URL 이미지
                  </button>
                  {/* 추출 이미지 삽입 버튼 */}
                  {extractedImages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setExtractedImageTarget('question');
                        setShowExtractedImagePicker(true);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors text-xs"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      추출 이미지
                    </button>
                  )}
                </div>
                {/* URL 입력 패널 */}
                {showImageUrlInput && (
                  <div className="flex items-center gap-2 p-2 border border-[#D4CFC4] bg-[#FDFBF7]">
                    <input
                      ref={imageUrlInputRef}
                      type="url"
                      value={imageUrlInputValue}
                      onChange={(e) => setImageUrlInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const url = imageUrlInputValue.trim();
                          if (url) {
                            setQuestion(prev => ({ ...prev, imageUrl: url }));
                            setImageUrlInputValue('');
                            setShowImageUrlInput(false);
                          }
                        }
                      }}
                      placeholder="이미지 URL을 붙여넣으세요"
                      className="flex-1 px-2.5 py-1.5 text-xs outline-none bg-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const url = imageUrlInputValue.trim();
                        if (url) {
                          setQuestion(prev => ({ ...prev, imageUrl: url }));
                          setImageUrlInputValue('');
                          setShowImageUrlInput(false);
                        }
                      }}
                      disabled={!imageUrlInputValue.trim()}
                      className="flex-shrink-0 px-2.5 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-30 transition-opacity"
                    >
                      추가
                    </button>
                  </div>
                )}
              </div>
            )}
            {errors.image && (
              <p className="mt-1 text-sm text-[#8B1A1A]">{errors.image}</p>
            )}
          </div>
        )}

        {/* 공통 이미지 업로드 - 결합형일 때 */}
        {question.type === 'combined' && (
          <div>
            <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
              공통 이미지
            </label>

            {question.passageImage ? (
              <div className="relative border-2 border-[#1A1A1A] bg-[#EDEAE4] p-2">
                <img
                  src={question.passageImage}
                  alt="공통 이미지"
                  className="w-full max-h-48 object-contain"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleRemovePassageImage();
                  }}
                  className="absolute top-1 right-1 z-10 w-8 h-8 bg-[#8B1A1A] text-[#F5F0E8] flex items-center justify-center hover:bg-[#6B1414] transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div>
                <div className="flex gap-2">
                  {/* 이미지 업로드 버튼 */}
                  <label className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] cursor-pointer hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors text-xs">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePassageImageUpload}
                      className="hidden"
                    />
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    이미지 업로드
                  </label>
                  {/* URL 이미지 버튼 */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowPassageImageUrlInput(!showPassageImageUrlInput);
                      if (!showPassageImageUrlInput) {
                        setTimeout(() => passageImageUrlInputRef.current?.focus(), 100);
                      }
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors text-xs ${
                      showPassageImageUrlInput
                        ? 'bg-[#EDEAE4] text-[#1A1A1A]'
                        : ''
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    URL 이미지
                  </button>
                  {/* 추출 이미지 삽입 버튼 */}
                  {extractedImages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setExtractedImageTarget('passage');
                        setShowExtractedImagePicker(true);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors text-xs"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      추출 이미지
                    </button>
                  )}
                </div>
                {/* URL 입력 패널 */}
                {showPassageImageUrlInput && (
                  <div className="flex items-center gap-2 p-2 border border-[#D4CFC4] bg-[#FDFBF7] mt-1">
                    <input
                      ref={passageImageUrlInputRef}
                      type="url"
                      value={passageImageUrlInputValue}
                      onChange={(e) => setPassageImageUrlInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const url = passageImageUrlInputValue.trim();
                          if (url) {
                            setQuestion(prev => ({ ...prev, passageImage: url }));
                            setPassageImageUrlInputValue('');
                            setShowPassageImageUrlInput(false);
                          }
                        }
                      }}
                      placeholder="이미지 URL을 붙여넣으세요"
                      className="flex-1 px-2.5 py-1.5 text-xs outline-none bg-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const url = passageImageUrlInputValue.trim();
                        if (url) {
                          setQuestion(prev => ({ ...prev, passageImage: url }));
                          setPassageImageUrlInputValue('');
                          setShowPassageImageUrlInput(false);
                        }
                      }}
                      disabled={!passageImageUrlInputValue.trim()}
                      className="flex-shrink-0 px-2.5 py-1.5 text-xs font-bold bg-[#1A1A1A] text-[#F5F0E8] disabled:opacity-30 transition-opacity"
                    >
                      추가
                    </button>
                  </div>
                )}
              </div>
            )}
            {errors.passageImage && (
              <p className="mt-1 text-sm text-[#8B1A1A]">{errors.passageImage}</p>
            )}
          </div>
        )}

        {/* 제시문 (Passage) - 결합형 제외, 혼합 형식 지원 */}
        {question.type !== 'combined' && (
          <MixedExamplesEditor
            mixedExamples={question.mixedExamples || []}
            showExamplesEditor={showExamplesEditor}
            onToggleExamples={handleToggleExamples}
            passagePrompt={question.passagePrompt}
            onPassagePromptChange={(value) => setQuestion(prev => ({ ...prev, passagePrompt: value }))}
            onAddTextExample={handleAddTextExample}
            onAddGanaExample={handleAddGanaExample}
            onAddBulletExample={handleAddBulletExample}
            onRemoveMixedExample={handleRemoveMixedExample}
            onTextBlockChange={handleTextBlockChange}
            onAddLabeledItem={handleAddLabeledItem}
            onLabeledItemChange={handleLabeledItemChange}
            onRemoveLabeledItem={handleRemoveLabeledItem}
            onUngroupBlock={handleUngroupBlock}
            isGroupingMode={isGroupingMode}
            groupingSelection={groupingSelection}
            onToggleGroupingMode={handleToggleGroupingMode}
            onCompleteGrouping={handleCompleteGrouping}
            onGroupingSelect={handleToggleGroupingSelection}
            onCancelGrouping={() => {
              setIsGroupingMode(false);
              setGroupingSelection(new Map());
            }}
          />
        )}

        {/* 보기 (<보기> 박스) - 객관식/주관식에서만 사용, OX는 사용 안함 */}
        {(question.type === 'multiple' || question.type === 'short_answer') && (
          <BogiEditor
            bogi={question.bogi || null}
            onBogiChange={(bogi) => setQuestion(prev => ({ ...prev, bogi }))}
          />
        )}

        {/* OX 선택지 */}
        <AnimatePresence mode="wait">
          {question.type === 'ox' && (
            <motion.div
              key="ox"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <OXAnswerEditor
                answerIndex={question.answerIndex}
                onChange={handleAnswerSelect}
                error={errors.answer}
              />
            </motion.div>
          )}

          {/* 객관식 선지 */}
          {question.type === 'multiple' && (
            <motion.div
              key="multiple"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <MultipleChoiceEditor
                choices={question.choices}
                answerIndex={question.answerIndex}
                answerIndices={question.answerIndices || []}
                isMultipleAnswerMode={isMultipleAnswerMode}
                onChoiceChange={handleChoiceChange}
                onAddChoice={handleAddChoice}
                onRemoveChoice={handleRemoveChoice}
                onAnswerSelect={handleAnswerSelect}
                onToggleMultipleMode={handleToggleMultipleAnswer}
                error={errors.answer}
                choicesError={errors.choices}
              />
            </motion.div>
          )}

          {/* 단답형 정답 */}
          {question.type === 'short_answer' && (
            <motion.div
              key="short_answer"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <ShortAnswerEditor
                answerTexts={question.answerTexts || ['']}
                onAnswerChange={handleAnswerTextChange}
                onAddAnswer={handleAddAnswerText}
                onRemoveAnswer={handleRemoveAnswerText}
                error={errors.answer}
              />
            </motion.div>
          )}


          {/* 결합형 하위 문제 */}
          {question.type === 'combined' && (
            <motion.div
              key="combined"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1A1A1A]">
                  하위 문제 ({(question.subQuestions || []).length}/10)
                </label>
              </div>

              <div className="space-y-3">
                {(question.subQuestions || []).map((subQ, index) => (
                  <SubQuestionEditor
                    key={subQ.id}
                    subQuestion={subQ}
                    index={index}
                    courseId={courseId}
                    onChange={(updated) => handleSubQuestionChange(index, updated)}
                    onRemove={() => handleRemoveSubQuestion(index)}
                    canRemove={(question.subQuestions || []).length > 1}
                  />
                ))}
              </div>

              {(question.subQuestions || []).length < 10 && (
                <button
                  type="button"
                  onClick={handleAddSubQuestion}
                  className="w-full py-2 text-xs font-bold border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                >
                  + 하위 문제 추가 (최대 10개)
                </button>
              )}

              {errors.subQuestions && (
                <p className="text-sm text-[#8B1A1A]">{errors.subQuestions}</p>
              )}
              {errors.chapter && (
                <p className="text-sm text-[#8B1A1A]">{errors.chapter}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 해설 (선택) - 결합형 제외 */}
        {question.type !== 'combined' && (
          <div>
            <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
              해설 <span className="text-[#5C5C5C] font-normal">(선택)</span>
            </label>
            <textarea
              value={question.explanation}
              onChange={(e) => handleTextChange('explanation', e.target.value)}
              placeholder="해설을 입력하세요 (선택)"
              rows={2}
              className="
                w-full px-3 py-2 text-sm border-2 border-[#1A1A1A] bg-[#F5F0E8]
                resize-none
                transition-colors duration-200
                focus:outline-none
              "
            />
          </div>
        )}

        {/* 선지별 해설 (객관식 전용, 선택) */}
        {question.type === 'multiple' && (
          <div>
            <label className="block text-xs font-bold text-[#1A1A1A] mb-1.5">
              선지별 해설 <span className="text-[#5C5C5C] font-normal">(선택)</span>
            </label>
            <div className="space-y-1.5">
              {question.choices.map((choice, idx) => {
                const currentExps = question.choiceExplanations || [];
                const value = currentExps[idx] || '';
                const label = String.fromCharCode(9312 + idx); // ①②③④⑤⑥⑦⑧
                return (
                  <div
                    key={`choice-exp-${idx}`}
                    className="border-2 border-[#D4CFC4] bg-[#FDFBF7]"
                  >
                    <div className="flex items-center gap-2 px-2 py-1 bg-[#EDEAE4] border-b border-[#D4CFC4]">
                      <span className="text-xs font-bold text-[#1A1A1A] shrink-0">
                        {label}
                      </span>
                      <span className="text-[11px] text-[#5C5C5C] truncate flex-1">
                        {choice.trim() || <em className="text-[#8C8C8C]">(선지 비어있음)</em>}
                      </span>
                    </div>
                    <textarea
                      value={value}
                      onChange={(e) => {
                        const next = [...currentExps];
                        while (next.length < question.choices.length) next.push('');
                        next[idx] = e.target.value;
                        setQuestion((prev) => ({ ...prev, choiceExplanations: next }));
                      }}
                      placeholder={`${label} 선지에 대한 해설 (선택)`}
                      rows={2}
                      className="
                        w-full px-2 py-1.5 text-xs bg-[#FDFBF7]
                        resize-none focus:outline-none
                      "
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="flex gap-2 pt-2">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            className="
              flex-1 py-2 px-3 text-xs border-2 border-[#1A1A1A]
              bg-[#EDEAE4] text-[#1A1A1A] font-bold
              hover:bg-[#1A1A1A] hover:text-[#F5F0E8]
              transition-colors
            "
          >
            취소
          </motion.button>
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSave}
            className="
              flex-1 py-2 px-3 text-xs border-2 border-[#1A1A1A]
              bg-[#1A1A1A] text-[#F5F0E8] font-bold
              hover:bg-[#333]
              transition-colors
            "
          >
            수정
          </motion.button>
        </div>
      </div>

      {/* 추출 이미지 선택 모달 */}
      <AnimatePresence>
        {showExtractedImagePicker && extractedImages.length > 0 && (
          <ExtractedImagePicker
            extractedImages={extractedImages}
            onSelect={handleSelectExtractedImage}
            onClose={() => setShowExtractedImagePicker(false)}
            onRemove={onRemoveExtracted}
            onAddExtracted={onAddExtracted}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
