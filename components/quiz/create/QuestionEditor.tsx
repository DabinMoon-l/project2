'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { QuestionType, RubricItem } from '@/lib/ocr';
import ChapterSelector from './ChapterSelector';
import ExtractedImagePicker from './ExtractedImagePicker';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 보기 타입 ('text': 텍스트 박스 형식, 'labeled': ㄱ.ㄴ.ㄷ. 형식)
 */
export type ExamplesType = 'text' | 'labeled';

/**
 * 보기 데이터 (기존 호환성 유지)
 */
export interface ExamplesData {
  /** 보기 유형 */
  type: ExamplesType;
  /** 보기 항목들 */
  items: string[];
}

/**
 * ㄱㄴㄷ 블록 내 개별 항목
 */
export interface LabeledItem {
  id: string;
  label: string; // ㄱ, ㄴ, ㄷ 등
  content: string;
}

/**
 * 혼합 보기 블록 (텍스트박스, ㄱㄴㄷ 그룹, 이미지, 또는 묶음)
 * - text: 텍스트박스 (content 필드 사용)
 * - labeled: ㄱ.ㄴ.ㄷ. 형식 (items 배열 사용, 블록 내에서 항목 추가/삭제 가능)
 * - image: 이미지 (imageUrl 필드 사용)
 * - grouped: 묶음 (children 배열 사용 - 여러 블록을 하나로 묶음)
 */
export interface MixedExampleBlock {
  id: string;
  type: 'text' | 'labeled' | 'image' | 'grouped';
  content?: string; // text 타입일 때
  items?: LabeledItem[]; // labeled 타입일 때
  imageUrl?: string; // image 타입일 때
  children?: MixedExampleBlock[]; // grouped 타입일 때
}

/**
 * @deprecated 이전 버전 호환용 - MixedExampleBlock으로 마이그레이션됨
 */
export interface MixedExampleItem {
  id: string;
  type: 'text' | 'labeled';
  label?: string;
  content: string;
}

/**
 * 공통 지문 타입 (결합형에서 사용)
 * - 'text': 텍스트 박스 형식 (자유롭게 작성)
 * - 'korean_abc': ㄱ.ㄴ.ㄷ. 형식 (각 항목 개별 입력)
 */
export type PassageType = 'text' | 'korean_abc';

/**
 * 한글 자음 라벨 순서 (ㄱ ~ ㅎ)
 */
export const KOREAN_LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/**
 * ㄱㄴㄷ식 보기 항목 (결합형 공통 지문용)
 */
export interface KoreanAbcItem {
  label: string; // ㄱ, ㄴ, ㄷ, ㄹ, ㅁ 등
  text: string;
}

/**
 * 하위 문제 (결합형에서 사용)
 */
export interface SubQuestion {
  id: string;
  text: string;
  type: Exclude<QuestionType, 'combined' | 'essay'>;
  choices?: string[];
  answerIndex?: number;
  answerIndices?: number[];
  answerText?: string;
  answerTexts?: string[];
  rubric?: RubricItem[];
  explanation?: string;
  /** 보기 유형 ('text': 텍스트 박스, 'korean_abc': ㄱㄴㄷ 형식) */
  examplesType?: 'text' | 'korean_abc';
  /** 보기 - 텍스트 박스용 (줄바꿈으로 구분) */
  examples?: string[];
  /** 보기 - ㄱㄴㄷ 형식용 */
  koreanAbcExamples?: KoreanAbcItem[];
  /** 이미지 URL (하위 문제별 개별 이미지) */
  image?: string;
  /** 복수정답 모드 (객관식용) */
  isMultipleAnswer?: boolean;
  /** 챕터 ID */
  chapterId?: string;
  /** 세부항목 ID */
  chapterDetailId?: string;
}

/**
 * 문제 데이터 타입
 */
export interface QuestionData {
  /** 고유 ID */
  id: string;
  /** 문제 텍스트 */
  text: string;
  /** 문제 유형 */
  type: QuestionType;
  /** 선지 (객관식) */
  choices: string[];
  /** 정답 인덱스 (OX: 0=O, 1=X / 객관식: 0~7 / 단답형/서술형: -1) */
  answerIndex: number;
  /** 복수 정답 인덱스 (객관식에서 복수정답 사용 시) */
  answerIndices?: number[];
  /** 정답 텍스트 (단답형) */
  answerText: string;
  /** 복수 정답 텍스트 (단답형에서 복수정답 사용 시) */
  answerTexts?: string[];
  /** 해설 */
  explanation: string;
  /** 문제 이미지 URL */
  imageUrl?: string | null;
  /** 보기 데이터 (기존 - 호환성 유지) */
  examples?: ExamplesData | null;
  /** 혼합 보기 블록들 (텍스트박스 또는 ㄱㄴㄷ 그룹) */
  mixedExamples?: MixedExampleBlock[];
  /** 루브릭 (서술형용) */
  rubric?: RubricItem[];
  /** 채점 방식 (서술형용) - 기본값: 'manual' */
  scoringMethod?: 'ai_assisted' | 'manual';
  /** 하위 문제 (결합형용) */
  subQuestions?: SubQuestion[];
  /** 공통 지문 타입 (결합형용) - text: 텍스트 박스, korean_abc: ㄱㄴㄷ식 보기 */
  passageType?: PassageType;
  /** 공통 지문 텍스트 (결합형에서 passageType이 text일 때) - text 필드와 함께 사용 */
  passage?: string;
  /** ㄱㄴㄷ식 보기 항목들 (결합형에서 passageType이 korean_abc일 때) */
  koreanAbcItems?: KoreanAbcItem[];
  /** 공통 지문 이미지 (결합형용) */
  passageImage?: string | null;
  /** 공통 문제 (결합형용) - 공통 지문 위에 표시되는 문제 텍스트 */
  commonQuestion?: string;
  /** 챕터 ID (결합형이 아닌 문제용) */
  chapterId?: string;
  /** 세부항목 ID (결합형이 아닌 문제용) */
  chapterDetailId?: string;
}

/**
 * 에디터에서 사용하는 추출 이미지 타입
 */
export interface ExtractedImageForEditor {
  id: string;
  dataUrl: string;
  sourceFileName?: string;
}

interface QuestionEditorProps {
  /** 편집할 기존 문제 (새 문제 추가 시 undefined) */
  initialQuestion?: QuestionData;
  /** 저장 시 콜백 */
  onSave: (question: QuestionData) => void;
  /** 취소 시 콜백 */
  onCancel: () => void;
  /** 문제 번호 (새 문제 추가용) */
  questionNumber: number;
  /** 추가 클래스명 */
  className?: string;
  /** 사용자 역할 - 학생/교수 (기본값: 'student') */
  userRole?: 'student' | 'professor';
  /** 과목 ID (챕터 선택용) */
  courseId?: string;
  /** 추출된 이미지 목록 (이미지 영역 선택에서 추출) */
  extractedImages?: ExtractedImageForEditor[];
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 고유 ID 생성
 */
const generateId = (): string => {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * 문제 유형 라벨
 */
const typeLabels: Record<QuestionType, string> = {
  ox: 'OX',
  multiple: '객관식',
  short_answer: '단답형',
  subjective: '주관식',
  essay: '서술형',
  combined: '결합형',
};

/**
 * 하위 문제용 유형 라벨 (결합형, 서술형, 주관식 제외)
 */
const subQuestionTypeLabels: Record<Exclude<QuestionType, 'combined' | 'essay' | 'subjective'>, string> = {
  ox: 'OX',
  multiple: '객관식',
  short_answer: '단답형',
};

/**
 * 실제 문제 수 계산 (하위 문제 포함)
 * - 일반 문제 1개 = 1문제
 * - 결합형 1개 (하위 문제 N개) = N문제로 계산
 */
export function calculateTotalQuestionCount(questions: QuestionData[]): number {
  return questions.reduce((total, q) => {
    if (q.type === 'combined' && q.subQuestions && q.subQuestions.length > 0) {
      return total + q.subQuestions.length;
    }
    return total + 1;
  }, 0);
}

// ============================================================
// 하위 컴포넌트
// ============================================================

/**
 * 루브릭 편집기 (서술형용)
 */
function RubricEditor({
  rubric,
  onChange,
  error,
  hideLabel = false,
}: {
  rubric: RubricItem[];
  onChange: (rubric: RubricItem[]) => void;
  error?: string;
  hideLabel?: boolean;
}) {
  const totalPercentage = rubric.reduce((sum, item) => sum + item.percentage, 0);

  const handleAdd = () => {
    onChange([
      ...rubric,
      { criteria: '', percentage: 0, description: '' },
    ]);
  };

  const handleRemove = (index: number) => {
    if (rubric.length <= 1) return;
    onChange(rubric.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, field: keyof RubricItem, value: string | number) => {
    const newRubric = [...rubric];
    newRubric[index] = { ...newRubric[index], [field]: value };
    onChange(newRubric);
  };

  return (
    <div className="space-y-3">
      {!hideLabel && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-bold text-[#1A1A1A]">
            루브릭 (평가 기준)
          </label>
          <span className={`text-xs ${totalPercentage === 100 ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
            합계: {totalPercentage}%
          </span>
        </div>
      )}
      {hideLabel && (
        <div className="flex justify-end">
          <span className={`text-xs ${totalPercentage === 100 ? 'text-[#1A6B1A]' : 'text-[#8B1A1A]'}`}>
            합계: {totalPercentage}%
          </span>
        </div>
      )}
      <p className="text-xs text-[#5C5C5C]">
        부분점수 채점을 위한 평가 기준을 설정하세요
      </p>
      <div className="p-2 bg-[#EDEAE4] border border-[#1A1A1A]">
        <p className="text-xs text-[#5C5C5C]">
          <span className="font-bold">TIP:</span> 평가요소별로 점수가 배점되어 부분점수가 자동 계산됩니다.
          예: 논리성 50% + 정확성 50% = 총점 100%
        </p>
      </div>

      <div className="space-y-2">
        {rubric.map((item, index) => (
          <div key={index} className="p-3 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={item.criteria}
                    onChange={(e) => handleChange(index, 'criteria', e.target.value)}
                    placeholder="평가요소 이름"
                    className="flex-1 px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={item.percentage}
                      onChange={(e) => handleChange(index, 'percentage', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                      min="0"
                      max="100"
                      className="w-16 px-2 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm text-center focus:outline-none"
                    />
                    <span className="text-sm font-bold">%</span>
                  </div>
                </div>
                <textarea
                  value={item.description || ''}
                  onChange={(e) => handleChange(index, 'description', e.target.value)}
                  placeholder="평가 기준 상세 설명 (선택)"
                  rows={2}
                  className="w-full px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm resize-none focus:outline-none"
                />
              </div>
              {rubric.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="w-8 h-8 flex items-center justify-center text-[#8B1A1A] hover:bg-[#F5F0E8] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleAdd}
        className="w-full py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
      >
        + 평가요소 추가
      </button>

      {error && <p className="text-sm text-[#8B1A1A]">{error}</p>}

      {/* 루브릭 미리보기 */}
      {rubric.some(r => r.criteria.trim()) && (
        <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
          <p className="text-xs text-[#5C5C5C] mb-2">미리보기</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1A1A1A]">
                <th className="text-left py-1">평가요소</th>
                <th className="text-right py-1 w-20">배점</th>
              </tr>
            </thead>
            <tbody>
              {rubric.filter(r => r.criteria.trim()).map((item, idx) => (
                <tr key={idx} className="border-b border-[#1A1A1A]/30">
                  <td className="py-1">{item.criteria}</td>
                  <td className="text-right py-1">{item.percentage}%</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-1">합계</td>
                <td className="text-right py-1">{totalPercentage}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * 하위 문제 편집기 (결합형용)
 */
function SubQuestionEditor({
  subQuestion,
  index,
  onChange,
  onRemove,
  canRemove,
  courseId,
}: {
  subQuestion: SubQuestion;
  index: number;
  onChange: (subQuestion: SubQuestion) => void;
  onRemove: () => void;
  canRemove: boolean;
  courseId?: string;
}) {
  const handleTypeChange = (type: Exclude<QuestionType, 'combined' | 'essay' | 'subjective'>) => {
    onChange({
      ...subQuestion,
      type,
      choices: type === 'multiple' ? ['', ''] : undefined,
      answerIndex: type === 'ox' ? -1 : type === 'multiple' ? -1 : undefined,
      answerIndices: type === 'multiple' ? [] : undefined,
      answerText: type === 'short_answer' ? '' : undefined,
      answerTexts: type === 'short_answer' ? [''] : undefined,
    });
  };

  const handleChoiceChange = (choiceIndex: number, value: string) => {
    const newChoices = [...(subQuestion.choices || [])];
    newChoices[choiceIndex] = value;
    onChange({ ...subQuestion, choices: newChoices });
  };

  const handleAddChoice = () => {
    const currentChoices = subQuestion.choices || [];
    if (currentChoices.length >= 8) return;
    onChange({ ...subQuestion, choices: [...currentChoices, ''] });
  };

  const handleRemoveChoice = (choiceIndex: number) => {
    const currentChoices = subQuestion.choices || [];
    if (currentChoices.length <= 2) return;
    const newChoices = currentChoices.filter((_, i) => i !== choiceIndex);
    // 정답 인덱스 조정
    let newAnswerIndex = subQuestion.answerIndex;
    let newAnswerIndices = subQuestion.answerIndices || [];
    if (newAnswerIndex !== undefined && newAnswerIndex >= choiceIndex) {
      newAnswerIndex = newAnswerIndex > choiceIndex ? newAnswerIndex - 1 : -1;
    }
    newAnswerIndices = newAnswerIndices
      .filter(i => i !== choiceIndex)
      .map(i => i > choiceIndex ? i - 1 : i);
    onChange({
      ...subQuestion,
      choices: newChoices,
      answerIndex: newAnswerIndex,
      answerIndices: newAnswerIndices,
    });
  };

  // 복수정답 모드 여부
  const isMultipleAnswerMode = (subQuestion.answerIndices?.length || 0) > 1 ||
    (subQuestion as any).isMultipleAnswer === true;

  const handleToggleMultipleAnswer = () => {
    const newIsMultiple = !isMultipleAnswerMode;
    if (newIsMultiple) {
      // 복수정답 모드로 전환
      onChange({
        ...subQuestion,
        answerIndices: subQuestion.answerIndex !== undefined && subQuestion.answerIndex >= 0
          ? [subQuestion.answerIndex]
          : [],
        isMultipleAnswer: true,
      } as SubQuestion);
    } else {
      // 단일정답 모드로 전환
      const firstAnswer = (subQuestion.answerIndices || [])[0];
      onChange({
        ...subQuestion,
        answerIndex: firstAnswer ?? -1,
        answerIndices: firstAnswer !== undefined ? [firstAnswer] : [],
        isMultipleAnswer: false,
      } as SubQuestion);
    }
  };

  const handleAnswerSelect = (answerIndex: number) => {
    if (isMultipleAnswerMode) {
      const currentIndices = subQuestion.answerIndices || [];
      let newIndices: number[];
      if (currentIndices.includes(answerIndex)) {
        newIndices = currentIndices.filter(i => i !== answerIndex);
      } else {
        newIndices = [...currentIndices, answerIndex].sort((a, b) => a - b);
      }
      onChange({
        ...subQuestion,
        answerIndices: newIndices,
        answerIndex: newIndices.length > 0 ? newIndices[0] : -1,
      });
    } else {
      onChange({
        ...subQuestion,
        answerIndex,
        answerIndices: [answerIndex],
      });
    }
  };

  return (
    <div className="p-4 border-2 border-[#1A1A1A] bg-[#EDEAE4]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[#1A1A1A]">
            하위 문제 {index + 1}
          </span>
          {courseId && (
            <ChapterSelector
              courseId={courseId}
              chapterId={subQuestion.chapterId}
              detailId={subQuestion.chapterDetailId}
              onChange={(chapterId, detailId) => {
                onChange({
                  ...subQuestion,
                  chapterId,
                  chapterDetailId: detailId,
                });
              }}
              compact
            />
          )}
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="w-6 h-6 flex items-center justify-center text-[#8B1A1A] hover:bg-[#F5F0E8] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 유형 선택 */}
      <div className="flex gap-1 mb-3">
        {(Object.keys(subQuestionTypeLabels) as Exclude<QuestionType, 'combined' | 'essay' | 'subjective'>[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handleTypeChange(type)}
            className={`
              flex-1 py-1.5 text-xs font-bold border-2 transition-colors
              ${subQuestion.type === type
                ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                : 'bg-[#F5F0E8] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
              }
            `}
          >
            {subQuestionTypeLabels[type]}
          </button>
        ))}
      </div>

      {/* 문제 텍스트 */}
      <textarea
        value={subQuestion.text}
        onChange={(e) => onChange({ ...subQuestion, text: e.target.value })}
        placeholder="문제를 입력하세요"
        rows={2}
        className="w-full px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm resize-none focus:outline-none mb-3"
      />

      {/* OX 정답 */}
      {subQuestion.type === 'ox' && (
        <div className="flex gap-2">
          {['O', 'X'].map((option, idx) => (
            <button
              key={option}
              type="button"
              onClick={() => handleAnswerSelect(idx)}
              className={`
                flex-1 py-2 font-bold text-lg border-2 transition-colors
                ${subQuestion.answerIndex === idx
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'bg-[#F5F0E8] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                }
              `}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {/* 객관식 선지 */}
      {subQuestion.type === 'multiple' && (
        <div className="space-y-2">
          {/* 복수정답 토글 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#5C5C5C]">선지 (정답 클릭)</span>
            <button
              type="button"
              onClick={handleToggleMultipleAnswer}
              className={`
                px-2 py-1 text-xs font-bold border transition-colors
                ${isMultipleAnswerMode
                  ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                  : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                }
              `}
            >
              복수정답 {isMultipleAnswerMode ? 'ON' : 'OFF'}
            </button>
          </div>
          {isMultipleAnswerMode && (
            <p className="text-xs text-[#1A6B1A] mb-1">복수정답 모드: 2개 이상의 정답을 선택하세요</p>
          )}
          {(subQuestion.choices || []).map((choice, idx) => {
            const isSelected = isMultipleAnswerMode
              ? (subQuestion.answerIndices || []).includes(idx)
              : subQuestion.answerIndex === idx;
            return (
            <div key={idx} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleAnswerSelect(idx)}
                className={`
                  w-7 h-7 flex items-center justify-center text-xs font-bold border-2 transition-colors
                  ${isSelected
                    ? isMultipleAnswerMode
                      ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                      : 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#F5F0E8] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                  }
                `}
              >
                {idx + 1}
              </button>
              <input
                type="text"
                value={choice}
                onChange={(e) => handleChoiceChange(idx, e.target.value)}
                placeholder={`선지 ${idx + 1}`}
                className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
              />
              {(subQuestion.choices || []).length > 2 && (
                <button
                  type="button"
                  onClick={() => handleRemoveChoice(idx)}
                  className="w-7 h-7 flex items-center justify-center text-[#8B1A1A] hover:bg-[#F5F0E8] transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            );
          })}
          {(subQuestion.choices || []).length < 8 && (
            <button
              type="button"
              onClick={handleAddChoice}
              className="w-full py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#F5F0E8] hover:text-[#1A1A1A] transition-colors"
            >
              + 선지 추가
            </button>
          )}
        </div>
      )}

      {/* 단답형 정답 */}
      {subQuestion.type === 'short_answer' && (
        <div className="space-y-2">
          {(subQuestion.answerTexts || ['']).map((text, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={text}
                onChange={(e) => {
                  const newTexts = [...(subQuestion.answerTexts || [''])];
                  newTexts[idx] = e.target.value;
                  onChange({
                    ...subQuestion,
                    answerTexts: newTexts,
                    answerText: newTexts[0] || '',
                  });
                }}
                placeholder={`정답 ${idx + 1}`}
                className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
              />
              {(subQuestion.answerTexts || []).length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const newTexts = (subQuestion.answerTexts || []).filter((_, i) => i !== idx);
                    onChange({
                      ...subQuestion,
                      answerTexts: newTexts,
                      answerText: newTexts[0] || '',
                    });
                  }}
                  className="w-7 h-7 flex items-center justify-center text-[#8B1A1A] hover:bg-[#F5F0E8] transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          {(subQuestion.answerTexts || []).length < 5 && (
            <button
              type="button"
              onClick={() => {
                onChange({
                  ...subQuestion,
                  answerTexts: [...(subQuestion.answerTexts || ['']), ''],
                });
              }}
              className="w-full py-1.5 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#F5F0E8] hover:text-[#1A1A1A] transition-colors"
            >
              + 정답 추가
            </button>
          )}
        </div>
      )}

      {/* 하위 문제 보기 (examples) */}
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-[#1A1A1A]">
            보기 <span className="text-[#5C5C5C] font-normal">(선택)</span>
          </label>
          {(!subQuestion.examples || subQuestion.examples.length === 0) && (!subQuestion.koreanAbcExamples || subQuestion.koreanAbcExamples.length === 0) && (
            <button
              type="button"
              onClick={() => onChange({ ...subQuestion, examplesType: 'text', examples: [''] })}
              className="px-2 py-0.5 text-xs font-bold border-2 border-[#1A1A1A] bg-[#EDEAE4] text-[#5C5C5C] hover:bg-[#1A1A1A] hover:text-[#F5F0E8] transition-colors"
            >
              + 보기 추가
            </button>
          )}
        </div>

        {/* 보기가 있을 때 형식 선택 및 입력 UI */}
        {((subQuestion.examples && subQuestion.examples.length > 0) || (subQuestion.koreanAbcExamples && subQuestion.koreanAbcExamples.length > 0) || subQuestion.examplesType) && (
          <div className="space-y-2">
            {/* 형식 선택 버튼 */}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  // 텍스트 박스 형식으로 전환
                  const currentItems = subQuestion.koreanAbcExamples?.map(item => item.text) || subQuestion.examples || [''];
                  onChange({
                    ...subQuestion,
                    examplesType: 'text',
                    examples: currentItems.length > 0 ? currentItems : [''],
                    koreanAbcExamples: undefined
                  });
                }}
                className={`
                  flex-1 py-1.5 text-xs font-bold border-2 transition-colors
                  ${subQuestion.examplesType !== 'korean_abc'
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#EDEAE4] border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                  }
                `}
              >
                텍스트 박스
              </button>
              <button
                type="button"
                onClick={() => {
                  // ㄱㄴㄷ 형식으로 전환
                  const currentItems = subQuestion.examples || [];
                  const koreanAbcItems = currentItems.map((text, idx) => ({
                    label: KOREAN_LABELS[idx] || `${idx + 1}`,
                    text
                  }));
                  onChange({
                    ...subQuestion,
                    examplesType: 'korean_abc',
                    koreanAbcExamples: koreanAbcItems.length > 0 ? koreanAbcItems : [{ label: 'ㄱ', text: '' }],
                    examples: undefined
                  });
                }}
                className={`
                  flex-1 py-1.5 text-xs font-bold border-2 transition-colors
                  ${subQuestion.examplesType === 'korean_abc'
                    ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                    : 'bg-[#EDEAE4] border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                  }
                `}
              >
                ㄱ.ㄴ.ㄷ. 형식
              </button>
            </div>

            {/* 텍스트 박스 형식 */}
            {subQuestion.examplesType !== 'korean_abc' && (
              <div className="space-y-1">
                <textarea
                  value={(subQuestion.examples || []).join('\n')}
                  onChange={(e) => {
                    const lines = e.target.value.split('\n');
                    onChange({ ...subQuestion, examples: lines });
                  }}
                  placeholder="보기를 줄바꿈으로 구분하여 입력..."
                  rows={3}
                  className="w-full px-2 py-1.5 border-2 border-[#1A1A1A] bg-white text-xs resize-none focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...subQuestion, examplesType: undefined, examples: undefined })}
                  className="w-full py-1 text-xs font-bold border-2 border-[#8B1A1A] text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-[#F5F0E8] transition-colors"
                >
                  보기 삭제
                </button>
              </div>
            )}

            {/* ㄱㄴㄷ 형식 */}
            {subQuestion.examplesType === 'korean_abc' && (
              <div className="space-y-1">
                {(subQuestion.koreanAbcExamples || []).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-6 h-6 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {item.label}.
                    </span>
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => {
                        const newItems = [...(subQuestion.koreanAbcExamples || [])];
                        newItems[idx] = { ...newItems[idx], text: e.target.value };
                        onChange({ ...subQuestion, koreanAbcExamples: newItems });
                      }}
                      placeholder={`${item.label}. 내용 입력`}
                      className="flex-1 px-2 py-1 border-2 border-[#1A1A1A] bg-white text-xs focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const newItems = (subQuestion.koreanAbcExamples || []).filter((_, i) => i !== idx);
                        if (newItems.length === 0) {
                          onChange({ ...subQuestion, examplesType: undefined, koreanAbcExamples: undefined });
                        } else {
                          onChange({ ...subQuestion, koreanAbcExamples: newItems });
                        }
                      }}
                      className="w-6 h-6 flex items-center justify-center text-[#8B1A1A] hover:bg-[#F5F0E8] transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {(subQuestion.koreanAbcExamples || []).length < 14 && (
                  <button
                    type="button"
                    onClick={() => {
                      const currentItems = subQuestion.koreanAbcExamples || [];
                      const nextLabel = KOREAN_LABELS[currentItems.length] || `${currentItems.length + 1}`;
                      onChange({
                        ...subQuestion,
                        koreanAbcExamples: [...currentItems, { label: nextLabel, text: '' }]
                      });
                    }}
                    className="w-full py-1 text-xs font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#F5F0E8] hover:text-[#1A1A1A] transition-colors"
                  >
                    + 항목 추가
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 하위 문제 이미지 */}
      <div className="mt-3 space-y-2">
        <label className="text-xs font-bold text-[#1A1A1A]">
          이미지 <span className="text-[#5C5C5C] font-normal">(선택)</span>
        </label>
        {subQuestion.image ? (
          <div className="relative border-2 border-[#1A1A1A] bg-[#EDEAE4] p-1">
            <img
              src={subQuestion.image}
              alt="하위 문제 이미지"
              className="w-full max-h-32 object-contain"
            />
            <button
              type="button"
              onClick={() => onChange({ ...subQuestion, image: undefined })}
              className="absolute top-0.5 right-0.5 w-5 h-5 bg-[#8B1A1A] text-[#F5F0E8] flex items-center justify-center hover:bg-[#6B1414] transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <label className="flex items-center justify-center gap-1 w-full py-2 border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] cursor-pointer hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    onChange({ ...subQuestion, image: event.target?.result as string });
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs">이미지 업로드</span>
          </label>
        )}
      </div>

      {/* 해설 */}
      <input
        type="text"
        value={subQuestion.explanation || ''}
        onChange={(e) => onChange({ ...subQuestion, explanation: e.target.value })}
        placeholder="해설 (선택)"
        className="w-full mt-3 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none"
      />
    </div>
  );
}

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
}: QuestionEditorProps) {
  // 초기 상태 설정
  const getInitialData = (): QuestionData => {
    if (!initialQuestion) {
      // 새 문제
      return {
        id: generateId(),
        text: '',
        type: 'multiple',
        choices: ['', ''],
        answerIndex: -1,
        answerIndices: [],
        answerText: '',
        answerTexts: [''],
        explanation: '',
        imageUrl: null,
        examples: null,
        mixedExamples: [],
        rubric: [],
        scoringMethod: 'manual',
        subQuestions: [],
        passageType: 'text',
        koreanAbcItems: [],
        passageImage: null,
        passage: '',
      };
    }

    // 기존 QuestionData인 경우
    const existing = initialQuestion;
    // answerTexts 초기화: 기존 answerText가 있으면 파싱
    let answerTexts = existing.answerTexts || [];
    if (answerTexts.length === 0 && existing.answerText) {
      // 쉼표로 구분된 복수 정답 파싱
      answerTexts = existing.answerText.includes('|||')
        ? existing.answerText.split('|||').map(s => s.trim())
        : [existing.answerText];
    }
    if (answerTexts.length === 0) {
      answerTexts = [''];
    }
    // 기존 examples를 mixedExamples 블록으로 마이그레이션
    let mixedExamples: MixedExampleBlock[] = [];

    // 기존 mixedExamples가 있으면 새 블록 구조로 변환
    if (existing.mixedExamples && existing.mixedExamples.length > 0) {
      // 이전 형식(MixedExampleItem[])인지 새 형식(MixedExampleBlock[])인지 확인
      const firstItem = existing.mixedExamples[0] as MixedExampleBlock | MixedExampleItem;
      if ('items' in firstItem || (firstItem.type === 'text' && 'content' in firstItem && !('label' in firstItem))) {
        // 이미 새 형식
        mixedExamples = existing.mixedExamples as MixedExampleBlock[];
      } else {
        // 이전 형식 → 새 형식으로 변환
        // labeled 항목들을 하나의 블록으로 그룹화
        const oldItems = existing.mixedExamples as unknown as MixedExampleItem[];
        const labeledItems = oldItems.filter(item => item.type === 'labeled');
        const textItems = oldItems.filter(item => item.type === 'text');

        // 텍스트 항목들을 개별 블록으로
        textItems.forEach(item => {
          mixedExamples.push({
            id: item.id,
            type: 'text',
            content: item.content,
          });
        });

        // labeled 항목들을 하나의 블록으로
        if (labeledItems.length > 0) {
          mixedExamples.push({
            id: `labeled_${Date.now()}`,
            type: 'labeled',
            items: labeledItems.map((item, idx) => ({
              id: item.id,
              label: item.label || KOREAN_LABELS[idx],
              content: item.content,
            })),
          });
        }
      }
    } else if (existing.examples?.items?.length) {
      // 기존 examples를 mixedExamples 블록으로 변환
      if (existing.examples.type === 'labeled') {
        // ㄱㄴㄷ 형식 → labeled 블록 하나
        mixedExamples = [{
          id: `labeled_${Date.now()}`,
          type: 'labeled',
          items: existing.examples.items.map((content, idx) => ({
            id: `item_${Date.now()}_${idx}`,
            label: KOREAN_LABELS[idx],
            content,
          })),
        }];
      } else {
        // 텍스트 형식 → text 블록들
        mixedExamples = existing.examples.items.map((content, idx) => ({
          id: `text_${Date.now()}_${idx}`,
          type: 'text' as const,
          content,
        }));
      }
    }

    return {
      ...existing,
      answerIndices: existing.answerIndices || [],
      answerTexts,
      imageUrl: existing.imageUrl || null,
      examples: existing.examples || null,
      mixedExamples,
      rubric: existing.rubric || [],
      scoringMethod: existing.scoringMethod || 'manual',
      subQuestions: existing.subQuestions || [],
      passageType: existing.passageType || 'text',
      koreanAbcItems: existing.koreanAbcItems || [],
      passageImage: existing.passageImage || null,
      passage: existing.passage || '',
    };
  };

  // 상태
  const [question, setQuestion] = useState<QuestionData>(getInitialData);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 이미지 업로드 관련
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 보기 추가 모드
  const [showExamplesEditor, setShowExamplesEditor] = useState(
    () => !!(getInitialData().examples || (getInitialData().mixedExamples?.length ?? 0) > 0)
  );

  // 복수정답 모드 (객관식에서만 사용)
  const [isMultipleAnswerMode, setIsMultipleAnswerMode] = useState(
    () => (getInitialData().answerIndices?.length || 0) > 1
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
    setQuestion(getInitialData());
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
      // 서술형일 때 루브릭 및 채점방식 초기화
      rubric: type === 'essay' ? [{ criteria: '', percentage: 100, description: '' }] : [],
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
   * labeled 블록 내에 항목 추가 (ㄴ, ㄷ, ㄹ...)
   */
  const handleAddLabeledItem = useCallback((blockId: string) => {
    setQuestion((prev) => {
      const mixedExamples = (prev.mixedExamples || []).map(block => {
        if (block.id === blockId && block.type === 'labeled') {
          const items = block.items || [];
          if (items.length < KOREAN_LABELS.length) {
            const nextLabel = KOREAN_LABELS[items.length];
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
   * labeled 블록 내 항목 내용 변경
   */
  const handleLabeledItemChange = useCallback((blockId: string, itemId: string, content: string) => {
    setQuestion((prev) => {
      const mixedExamples = (prev.mixedExamples || []).map(block => {
        if (block.id === blockId && block.type === 'labeled') {
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
   * labeled 블록 내 항목 삭제 (항목이 1개면 블록 전체 삭제)
   */
  const handleRemoveLabeledItem = useCallback((blockId: string, itemId: string) => {
    setQuestion((prev) => {
      const mixedExamples = (prev.mixedExamples || []).map(block => {
        if (block.id === blockId && block.type === 'labeled') {
          const items = (block.items || []).filter(item => item.id !== itemId);
          if (items.length === 0) {
            return null; // 블록 삭제 표시
          }
          // 라벨 재정렬
          const reorderedItems = items.map((item, idx) => ({
            ...item,
            label: KOREAN_LABELS[idx] || `${idx + 1}`,
          }));
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
   * 루브릭 변경 (서술형)
   */
  const handleRubricChange = useCallback((rubric: RubricItem[]) => {
    setQuestion((prev) => ({ ...prev, rubric }));
    setErrors((prev) => ({ ...prev, rubric: '' }));
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
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // 문제 텍스트 검사 (결합형은 공통 지문 OR 공통 이미지 중 하나 이상 필수)
    if (question.type === 'combined') {
      // passageType에 따라 지문 유효성 검사
      const hasPassage = question.passageType === 'text'
        ? (question.text?.trim() || question.passage?.trim())
        : (question.koreanAbcItems && question.koreanAbcItems.length > 0 && question.koreanAbcItems.some(item => item.text.trim()));
      const hasImage = !!question.passageImage;
      const isValid = hasPassage || hasImage;
      if (!isValid) {
        newErrors.text = '공통 지문 또는 공통 이미지 중 하나 이상을 입력해주세요.';
      }
    } else {
      if (!question.text.trim()) {
        newErrors.text = '문제를 입력해주세요.';
      }
    }

    // 정답 검사
    if (question.type === 'ox') {
      if (question.answerIndex < 0) {
        newErrors.answer = '정답을 선택해주세요.';
      }
    } else if (question.type === 'multiple') {
      // 복수정답 모드일 때
      if (isMultipleAnswerMode) {
        if (!question.answerIndices || question.answerIndices.length < 2) {
          newErrors.answer = '복수정답 모드에서는 2개 이상의 정답을 선택해주세요.';
        }
        // 선택된 정답들에 내용이 있는지 확인
        const emptyAnswers = (question.answerIndices || []).filter(
          idx => !question.choices[idx]?.trim()
        );
        if (emptyAnswers.length > 0) {
          newErrors.answer = '선택된 정답에 내용이 없습니다.';
        }
      } else {
        if (question.answerIndex < 0) {
          newErrors.answer = '정답을 선택해주세요.';
        }
        if (question.answerIndex >= 0 && !question.choices[question.answerIndex]?.trim()) {
          newErrors.answer = '선택된 정답에 내용이 없습니다.';
        }
      }

      // 선지 검사
      const filledChoices = question.choices.filter((c) => c.trim()).length;
      if (filledChoices < 2) {
        newErrors.choices = '최소 2개 이상의 선지를 입력해주세요.';
      }
    } else if (question.type === 'short_answer') {
      // 복수 정답 중 하나라도 입력되어 있어야 함
      const answerTexts = question.answerTexts || [question.answerText];
      const hasValidAnswer = answerTexts.some(t => t.trim());
      if (!hasValidAnswer) {
        newErrors.answer = '정답을 입력해주세요.';
      }
    } else if (question.type === 'essay') {
      // 루브릭 검사 - AI 보조 채점일 때만 필수
      const rubric = question.rubric || [];
      const isAiAssisted = question.scoringMethod === 'ai_assisted';

      if (isAiAssisted) {
        // AI 보조 채점: 루브릭 필수
        if (rubric.length === 0) {
          newErrors.rubric = '최소 1개 이상의 평가요소를 추가해주세요.';
        } else {
          const totalPercentage = rubric.reduce((sum, item) => sum + item.percentage, 0);
          if (totalPercentage !== 100) {
            newErrors.rubric = `배점 비율의 합계가 100%가 되어야 합니다. (현재: ${totalPercentage}%)`;
          }
          const hasEmptyCriteria = rubric.some(r => !r.criteria.trim());
          if (hasEmptyCriteria) {
            newErrors.rubric = '모든 평가요소의 이름을 입력해주세요.';
          }
        }
      } else {
        // 수동 채점: 루브릭이 있으면 유효성 검사
        if (rubric.length > 0) {
          const totalPercentage = rubric.reduce((sum, item) => sum + item.percentage, 0);
          const hasContent = rubric.some(r => r.criteria.trim());
          if (hasContent && totalPercentage !== 100) {
            newErrors.rubric = `배점 비율의 합계가 100%가 되어야 합니다. (현재: ${totalPercentage}%)`;
          }
        }
      }
    } else if (question.type === 'combined') {
      // 공통 문제 검사 (필수)
      if (!question.commonQuestion?.trim()) {
        newErrors.commonQuestion = '공통 문제를 입력해주세요.';
      }

      // 하위 문제 검사
      const subQuestions = question.subQuestions || [];
      if (subQuestions.length === 0) {
        newErrors.subQuestions = '최소 1개 이상의 하위 문제를 추가해주세요.';
      } else {
        const hasEmptySubQuestion = subQuestions.some(sq => !sq.text.trim());
        if (hasEmptySubQuestion) {
          newErrors.subQuestions = '모든 하위 문제에 내용을 입력해주세요.';
        }
      }
    }

    // 챕터 검사 (courseId가 있을 때만 필수)
    if (courseId) {
      if (question.type === 'combined') {
        // 결합형: 모든 하위 문제에 챕터 필수
        const subQuestions = question.subQuestions || [];
        const hasEmptyChapter = subQuestions.some(sq => !sq.chapterId);
        if (hasEmptyChapter) {
          newErrors.chapter = '모든 하위 문제의 챕터를 설정해주세요.';
        }
      } else {
        // 일반 문제: 챕터 필수
        if (!question.chapterId) {
          newErrors.chapter = '챕터를 설정해주세요.';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * 저장
   */
  const handleSave = () => {
    if (validate()) {
      onSave(question);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={`p-6 border-2 border-[#1A1A1A] ${className}`}
      style={{ backgroundColor: '#F5F0E8' }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-[#1A1A1A]">
          문제 {questionNumber}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-2 text-[#5C5C5C] hover:text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="space-y-6">
        {/* 문제 유형 선택 */}
        <div>
          <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
            문제 유형
          </label>
          {/* 학생용: OX, 객관식, 주관식(short_answer), 결합형 - 4개 */}
          {/* 교수용: OX, 객관식, 단답형, 서술형, 결합형 - 5개 */}
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
                      w-full py-2.5 font-bold text-sm border-2
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
                    w-full py-2.5 font-bold text-sm border-2
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
              <span className="text-sm text-[#5C5C5C]">챕터:</span>
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
            <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
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
              className={`w-full px-4 py-3 border-2 bg-white resize-none transition-colors duration-200 focus:outline-none ${
                errors.commonQuestion ? 'border-[#8B1A1A]' : 'border-[#1A1A1A]'
              }`}
            />
            {errors.commonQuestion && (
              <p className="mt-1 text-sm text-[#8B1A1A]">{errors.commonQuestion}</p>
            )}
          </div>
        )}

        {/* 문제 텍스트 (결합형에서는 공통 지문) */}
        <div>
          <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
            {question.type === 'combined' ? '공통 지문' : '문제'}
          </label>

          {/* 결합형일 때 공통 지문 타입 선택 */}
          {question.type === 'combined' && (
            <div className="mb-3">
              <p className="text-xs text-[#5C5C5C] mb-2">지문 형식:</p>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setQuestion(prev => ({ ...prev, passageType: 'text' }))}
                  className={`
                    flex-1 py-2 text-sm font-bold border-2 transition-colors
                    ${question.passageType === 'text' || !question.passageType
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#EDEAE4] border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                    }
                  `}
                >
                  텍스트 박스
                </button>
                <button
                  type="button"
                  onClick={() => setQuestion(prev => ({
                    ...prev,
                    passageType: 'korean_abc',
                    koreanAbcItems: prev.koreanAbcItems && prev.koreanAbcItems.length > 0
                      ? prev.koreanAbcItems
                      : [{ label: 'ㄱ', text: '' }, { label: 'ㄴ', text: '' }, { label: 'ㄷ', text: '' }]
                  }))}
                  className={`
                    flex-1 py-2 text-sm font-bold border-2 transition-colors
                    ${question.passageType === 'korean_abc'
                      ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                      : 'bg-[#EDEAE4] border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                    }
                  `}
                >
                  ㄱ.ㄴ.ㄷ. 형식
                </button>
              </div>
            </div>
          )}

          {/* 텍스트 박스 (결합형이 아니거나 passageType이 text일 때) */}
          {(question.type !== 'combined' || question.passageType === 'text' || !question.passageType) && (
            <textarea
              value={question.text}
              onChange={(e) => handleTextChange('text', e.target.value)}
              placeholder={question.type === 'combined' ? '공통 지문을 입력하세요...' : '문제를 입력하세요'}
              rows={question.type === 'combined' ? 5 : 3}
              className={`
                w-full px-4 py-3 border-2 bg-white
                resize-none
                transition-colors duration-200
                focus:outline-none
                ${
                  errors.text
                    ? 'border-[#8B1A1A]'
                    : 'border-[#1A1A1A]'
                }
              `}
            />
          )}

          {/* ㄱㄴㄷ식 보기 UI (결합형 + korean_abc일 때) */}
          {question.type === 'combined' && question.passageType === 'korean_abc' && (
            <div className="space-y-2">
              <div className="space-y-2">
                {(question.koreanAbcItems || []).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-8 h-8 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {item.label}.
                    </span>
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => {
                        const newItems = [...(question.koreanAbcItems || [])];
                        newItems[idx] = { ...newItems[idx], text: e.target.value };
                        setQuestion(prev => ({ ...prev, koreanAbcItems: newItems }));
                      }}
                      placeholder={`${item.label}. 내용을 입력하세요`}
                      className="flex-1 px-3 py-2 border-2 border-[#1A1A1A] bg-white text-sm focus:outline-none"
                    />
                    {(question.koreanAbcItems || []).length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const newItems = (question.koreanAbcItems || []).filter((_, i) => i !== idx);
                          setQuestion(prev => ({ ...prev, koreanAbcItems: newItems }));
                        }}
                        className="w-8 h-8 flex items-center justify-center text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {(question.koreanAbcItems || []).length < 14 && (
                <button
                  type="button"
                  onClick={() => {
                    const nextLabel = KOREAN_LABELS[(question.koreanAbcItems || []).length] || `${(question.koreanAbcItems || []).length + 1}`;
                    setQuestion(prev => ({
                      ...prev,
                      koreanAbcItems: [...(prev.koreanAbcItems || []), { label: nextLabel, text: '' }]
                    }));
                  }}
                  className="w-full py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                >
                  + 항목 추가
                </button>
              )}
              {/* 미리보기 */}
              {(question.koreanAbcItems || []).some(item => item.text.trim()) && (
                <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                  <p className="text-xs text-[#5C5C5C] mb-2">미리보기</p>
                  <div className="space-y-1">
                    {(question.koreanAbcItems || []).filter(item => item.text.trim()).map((item, idx) => (
                      <p key={idx} className="text-sm text-[#1A1A1A]">
                        <span className="font-bold">{item.label}.</span> {item.text}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {errors.text && (
            <p className="mt-1 text-sm text-[#8B1A1A]">{errors.text}</p>
          )}
        </div>

        {/* 이미지 업로드 - 결합형이 아닐 때 */}
        {question.type !== 'combined' && (
          <div>
            <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
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
                  onClick={handleRemoveImage}
                  className="absolute top-1 right-1 w-7 h-7 bg-[#8B1A1A] text-[#F5F0E8] flex items-center justify-center hover:bg-[#6B1414] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
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
                      transition-colors
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
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        이미지 업로드
                      </>
                    )}
                  </label>
                </div>
                {/* 추출 이미지 삽입 버튼 */}
                {extractedImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setExtractedImageTarget('question');
                      setShowExtractedImagePicker(true);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    추출 이미지 삽입
                  </button>
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
            <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
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
                  onClick={handleRemovePassageImage}
                  className="absolute top-1 right-1 w-7 h-7 bg-[#8B1A1A] text-[#F5F0E8] flex items-center justify-center hover:bg-[#6B1414] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                {/* 이미지 업로드 버튼 */}
                <label className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] cursor-pointer hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePassageImageUpload}
                    className="hidden"
                  />
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  이미지 업로드
                </label>
                {/* 추출 이미지 삽입 버튼 */}
                {extractedImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setExtractedImageTarget('passage');
                      setShowExtractedImagePicker(true);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    추출 이미지 삽입
                  </button>
                )}
              </div>
            )}
            {errors.passageImage && (
              <p className="mt-1 text-sm text-[#8B1A1A]">{errors.passageImage}</p>
            )}
          </div>
        )}

        {/* 보기 (Examples) - 결합형 제외, 혼합 형식 지원 */}
        {question.type !== 'combined' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-bold text-[#1A1A1A]">
                보기 <span className="text-[#5C5C5C] font-normal">(선택)</span>
              </label>
              <div className="flex gap-2">
                {/* 묶기 버튼 - 보기가 2개 이상일 때만 표시 */}
                {showExamplesEditor && (question.mixedExamples || []).length >= 2 && (
                  <button
                    type="button"
                    onClick={isGroupingMode ? handleCompleteGrouping : handleToggleGroupingMode}
                    className={`
                      px-3 py-1 text-xs font-bold border border-[#1A1A1A]
                      transition-colors
                      ${isGroupingMode
                        ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                        : 'bg-[#EDEAE4] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                      }
                    `}
                  >
                    {isGroupingMode ? `묶기 완료 (${groupingSelection.size}개)` : '묶기'}
                  </button>
                )}
                {/* 묶기 취소 버튼 */}
                {isGroupingMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsGroupingMode(false);
                      setGroupingSelection(new Map());
                    }}
                    className="px-3 py-1 text-xs font-bold border border-[#8B1A1A] bg-[#EDEAE4] text-[#8B1A1A] hover:bg-[#8B1A1A] hover:text-[#F5F0E8] transition-colors"
                  >
                    취소
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleToggleExamples(!showExamplesEditor)}
                  disabled={isGroupingMode}
                  className={`
                    px-3 py-1 text-xs font-bold border border-[#1A1A1A]
                    transition-colors disabled:opacity-50
                    ${showExamplesEditor
                      ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                      : 'bg-[#EDEAE4] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                    }
                  `}
                >
                  {showExamplesEditor ? '보기 삭제' : '보기 추가'}
                </button>
              </div>
            </div>

            {/* 묶기 모드 안내 */}
            {isGroupingMode && (
              <div className="mb-3 p-2 bg-[#EDEAE4] border border-[#1A1A1A] text-sm text-[#1A1A1A]">
                묶을 블록들을 순서대로 클릭하세요. 숫자는 배열 순서입니다.
              </div>
            )}

            <AnimatePresence>
              {showExamplesEditor && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-3"
                >
                  {/* 혼합 보기 블록 입력 */}
                  <div className="space-y-4">
                    {(question.mixedExamples || []).map((block, blockIdx) => (
                      <div
                        key={block.id}
                        className={`border-2 p-4 bg-[#FAFAFA] relative transition-all ${
                          isGroupingMode
                            ? groupingSelection.has(block.id)
                              ? 'border-[#1A1A1A] ring-2 ring-[#1A1A1A] cursor-pointer bg-[#EDEAE4]'
                              : 'border-[#D4CFC4] cursor-pointer hover:border-[#1A1A1A]'
                            : 'border-[#1A1A1A]'
                        }`}
                        onClick={isGroupingMode ? () => handleToggleGroupingSelection(block.id) : undefined}
                      >
                        {/* 묶기 모드: 선택 체크박스 + 순서 번호 */}
                        {isGroupingMode && (
                          <div className={`absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center border-2 font-bold text-sm z-10 ${
                            groupingSelection.has(block.id)
                              ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white'
                              : 'bg-white border-[#1A1A1A] text-[#1A1A1A]'
                          }`}>
                            {groupingSelection.has(block.id) ? groupingSelection.get(block.id) : ''}
                          </div>
                        )}
                        {/* 블록 번호 표시 */}
                        <div className={`absolute -top-3 bg-[#1A1A1A] text-[#F5F0E8] px-2 py-0.5 text-xs font-bold ${isGroupingMode ? 'left-8' : 'left-3'}`}>
                          보기 {blockIdx + 1}
                        </div>

                        {/* 텍스트박스 블록 */}
                        {block.type === 'text' && (
                          <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-[#5C5C5C]">텍스트박스</span>
                              {!isGroupingMode && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMixedExample(block.id)}
                                  className="text-xs text-[#8B1A1A] hover:underline"
                                >
                                  블록 삭제
                                </button>
                              )}
                            </div>
                            <textarea
                              value={block.content || ''}
                              onChange={(e) => handleTextBlockChange(block.id, e.target.value)}
                              placeholder="텍스트 내용 입력 (줄바꿈 가능)"
                              rows={2}
                              disabled={isGroupingMode}
                              className="w-full px-3 py-2 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none resize-none disabled:opacity-70"
                            />
                          </div>
                        )}

                        {/* ㄱ.ㄴ.ㄷ. 블록 */}
                        {block.type === 'labeled' && (
                          <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-[#5C5C5C]">ㄱ.ㄴ.ㄷ.형식</span>
                              {!isGroupingMode && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMixedExample(block.id)}
                                  className="text-xs text-[#8B1A1A] hover:underline"
                                >
                                  블록 삭제
                                </button>
                              )}
                            </div>
                            {/* 항목들 */}
                            <div className="space-y-2">
                              {(block.items || []).map((item) => (
                                <div key={item.id} className="flex items-center gap-2">
                                  <span className="w-7 h-7 bg-[#1A1A1A] text-[#F5F0E8] flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    {item.label}
                                  </span>
                                  <input
                                    type="text"
                                    value={item.content}
                                    onChange={(e) => handleLabeledItemChange(block.id, item.id, e.target.value)}
                                    placeholder={`${item.label}. 내용 입력`}
                                    disabled={isGroupingMode}
                                    className="flex-1 px-3 py-1.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] text-sm focus:outline-none disabled:opacity-70"
                                  />
                                  {!isGroupingMode && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveLabeledItem(block.id, item.id)}
                                      className="w-7 h-7 flex items-center justify-center text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                            {/* 항목 추가 버튼 */}
                            {!isGroupingMode && (block.items || []).length < KOREAN_LABELS.length && (
                              <button
                                type="button"
                                onClick={() => handleAddLabeledItem(block.id)}
                                className="w-full py-1.5 text-xs font-bold border border-dashed border-[#5C5C5C] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                              >
                                + {KOREAN_LABELS[(block.items || []).length]} 추가
                              </button>
                            )}
                          </div>
                        )}

                        {/* 이미지 블록 */}
                        {block.type === 'image' && block.imageUrl && (
                          <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-[#5C5C5C]">이미지</span>
                              {!isGroupingMode && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMixedExample(block.id)}
                                  className="text-xs text-[#8B1A1A] hover:underline"
                                >
                                  블록 삭제
                                </button>
                              )}
                            </div>
                            <img
                              src={block.imageUrl}
                              alt="보기 이미지"
                              className="max-h-32 object-contain border border-[#D4CFC4]"
                            />
                          </div>
                        )}

                        {/* 묶음(grouped) 블록 */}
                        {block.type === 'grouped' && block.children && (
                          <div className="space-y-2" onClick={(e) => isGroupingMode && e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-[#1A1A1A]">묶음 ({block.children.length}개)</span>
                              {!isGroupingMode && (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleUngroupBlock(block.id)}
                                    className="text-xs text-[#5C5C5C] hover:underline"
                                  >
                                    묶음 해체
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveMixedExample(block.id)}
                                    className="text-xs text-[#8B1A1A] hover:underline"
                                  >
                                    블록 삭제
                                  </button>
                                </div>
                              )}
                            </div>
                            {/* 묶음 내 자식 블록들 표시 */}
                            <div className="border-l-4 border-[#1A1A1A] pl-3 space-y-2">
                              {block.children.map((child, childIdx) => (
                                <div key={child.id || childIdx} className="text-sm">
                                  {child.type === 'text' && child.content && (
                                    <p className="whitespace-pre-wrap text-[#5C5C5C]">{child.content}</p>
                                  )}
                                  {child.type === 'labeled' && (child.items || []).map((item) => (
                                    <p key={item.id} className="text-[#1A1A1A]">
                                      <span className="font-bold">{item.label}.</span> {item.content}
                                    </p>
                                  ))}
                                  {child.type === 'image' && child.imageUrl && (
                                    <img
                                      src={child.imageUrl}
                                      alt="묶음 이미지"
                                      className="max-h-24 object-contain border border-[#D4CFC4]"
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* 블록 추가 버튼들 - 묶기 모드가 아닐 때만 */}
                  {!isGroupingMode && (question.mixedExamples || []).length < 10 && (
                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleAddTextExample}
                        className="flex-1 min-w-[120px] py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                      >
                        + 텍스트박스
                      </button>
                      <button
                        type="button"
                        onClick={handleAddLabeledExample}
                        className="flex-1 min-w-[120px] py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                      >
                        + ㄱ.ㄴ.ㄷ.형식
                      </button>
                    </div>
                  )}

                  {/* 미리보기 */}
                  {(question.mixedExamples || []).some(block => {
                    if (block.type === 'text') return block.content?.trim();
                    if (block.type === 'labeled') return (block.items || []).some(i => i.content.trim());
                    if (block.type === 'image') return !!block.imageUrl;
                    if (block.type === 'grouped') return block.children && block.children.length > 0;
                    return false;
                  }) && (
                    <div className="p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
                      <p className="text-xs text-[#5C5C5C] mb-2">미리보기</p>
                      <div className="space-y-2">
                        {(question.mixedExamples || []).map((block, blockIdx) => {
                          const hasContent = (() => {
                            if (block.type === 'text') return block.content?.trim();
                            if (block.type === 'labeled') return (block.items || []).some(i => i.content.trim());
                            if (block.type === 'image') return !!block.imageUrl;
                            if (block.type === 'grouped') return block.children && block.children.length > 0;
                            return false;
                          })();
                          if (!hasContent) return null;

                          return (
                            <div key={block.id} className={`p-2 border bg-white ${block.type === 'grouped' ? 'border-[#1A1A1A] border-2' : 'border-dashed border-[#5C5C5C]'}`}>
                              <p className="text-[10px] text-[#5C5C5C] mb-1">
                                보기 {blockIdx + 1}
                                {block.type === 'grouped' && <span className="text-[#5C5C5C] ml-1">(묶음)</span>}
                              </p>
                              {block.type === 'text' && block.content?.trim() && (
                                <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{block.content}</p>
                              )}
                              {block.type === 'labeled' && (block.items || []).filter(i => i.content.trim()).map((item) => (
                                <p key={item.id} className="text-sm text-[#1A1A1A]">
                                  <span className="font-bold">{item.label}.</span> {item.content}
                                </p>
                              ))}
                              {block.type === 'image' && block.imageUrl && (
                                <img src={block.imageUrl} alt="보기 이미지" className="max-h-24 object-contain" />
                              )}
                              {block.type === 'grouped' && block.children && (
                                <div className="space-y-1">
                                  {block.children.map((child, childIdx) => (
                                    <div key={child.id || childIdx}>
                                      {child.type === 'text' && child.content?.trim() && (
                                        <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>
                                      )}
                                      {child.type === 'labeled' && (child.items || []).filter(i => i.content.trim()).map((item) => (
                                        <p key={item.id} className="text-sm text-[#1A1A1A]">
                                          <span className="font-bold">{item.label}.</span> {item.content}
                                        </p>
                                      ))}
                                      {child.type === 'image' && child.imageUrl && (
                                        <img src={child.imageUrl} alt="묶음 이미지" className="max-h-20 object-contain" />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
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
              <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                정답 선택
              </label>
              <div className="flex gap-4">
                {['O', 'X'].map((option, index) => (
                  <motion.button
                    key={option}
                    type="button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleAnswerSelect(index)}
                    className={`
                      flex-1 py-4 font-bold text-3xl border-2
                      transition-all duration-200
                      ${
                        question.answerIndex === index
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                      }
                    `}
                  >
                    {option}
                  </motion.button>
                ))}
              </div>
              {errors.answer && (
                <p className="mt-2 text-sm text-[#8B1A1A]">{errors.answer}</p>
              )}
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
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-bold text-[#1A1A1A]">
                  선지 (정답 클릭) - {question.choices.length}개
                </label>
                {/* 복수정답 토글 */}
                <button
                  type="button"
                  onClick={handleToggleMultipleAnswer}
                  className={`
                    px-3 py-1 text-xs font-bold border transition-colors
                    ${isMultipleAnswerMode
                      ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                      : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                    }
                  `}
                >
                  복수정답 {isMultipleAnswerMode ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* 복수정답 안내 */}
              {isMultipleAnswerMode && (
                <p className="text-xs text-[#1A6B1A] mb-2">
                  복수정답 모드: 2개 이상의 정답을 선택하세요
                </p>
              )}

              <div className="space-y-2">
                {question.choices.map((choice, index) => {
                  // 복수정답 모드에서는 answerIndices로, 아니면 answerIndex로 체크
                  const isSelected = isMultipleAnswerMode
                    ? (question.answerIndices || []).includes(index)
                    : question.answerIndex === index;

                  return (
                    <div key={index} className="flex items-center gap-2">
                      {/* 정답 체크 버튼 */}
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleAnswerSelect(index)}
                        className={`
                          w-8 h-8 flex items-center justify-center
                          text-sm font-bold border-2
                          transition-all duration-200
                          ${
                            isSelected
                              ? isMultipleAnswerMode
                                ? 'bg-[#1A6B1A] text-[#F5F0E8] border-[#1A6B1A]'
                                : 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                              : 'bg-[#EDEAE4] text-[#5C5C5C] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                          }
                        `}
                      >
                        {index + 1}
                      </motion.button>

                      {/* 선지 입력 */}
                      <input
                        type="text"
                        value={choice}
                        onChange={(e) => handleChoiceChange(index, e.target.value)}
                        placeholder={`선지 ${index + 1}`}
                        className={`
                          flex-1 px-4 py-2.5 border-2 bg-[#F5F0E8]
                          transition-colors duration-200
                          focus:outline-none
                          ${
                            isSelected
                              ? isMultipleAnswerMode
                                ? 'border-[#1A6B1A] bg-[#E8F5E9]'
                                : 'border-[#1A1A1A] bg-[#EDEAE4]'
                              : 'border-[#1A1A1A]'
                          }
                        `}
                      />

                      {/* 선지 삭제 버튼 (2개 초과일 때만) */}
                      {question.choices.length > 2 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveChoice(index)}
                          className="w-8 h-8 flex items-center justify-center text-[#8B1A1A] hover:bg-[#FDEAEA] transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 선지 추가 버튼 (8개 미만일 때만) */}
              {question.choices.length < 8 && (
                <button
                  type="button"
                  onClick={handleAddChoice}
                  className="mt-2 w-full py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                >
                  + 선지 추가 (최대 8개)
                </button>
              )}

              {errors.choices && (
                <p className="mt-2 text-sm text-[#8B1A1A]">{errors.choices}</p>
              )}
              {errors.answer && (
                <p className="mt-2 text-sm text-[#8B1A1A]">{errors.answer}</p>
              )}
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
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-bold text-[#1A1A1A]">
                  정답
                </label>
                <span className="text-xs text-[#5C5C5C]">
                  여러 정답 입력 가능 (어느 하나만 맞춰도 정답)
                </span>
              </div>

              {/* 정답 입력 목록 */}
              <div className="space-y-2">
                {(question.answerTexts || ['']).map((text, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={text}
                      onChange={(e) => handleAnswerTextChange(index, e.target.value)}
                      placeholder={`정답 ${index + 1}`}
                      className="flex-1 px-4 py-2.5 border-2 border-[#1A1A1A] bg-[#F5F0E8] focus:outline-none"
                    />
                    {/* 삭제 버튼 (2개 이상일 때만) */}
                    {(question.answerTexts || []).length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveAnswerText(index)}
                        className="w-10 h-10 flex items-center justify-center text-[#8B1A1A] hover:bg-[#FDEAEA] border border-[#8B1A1A] transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* 정답 추가 버튼 */}
              {(question.answerTexts || []).length < 5 && (
                <button
                  type="button"
                  onClick={handleAddAnswerText}
                  className="mt-2 w-full py-2 text-sm font-bold border border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
                >
                  + 정답 추가 (최대 5개)
                </button>
              )}

              {errors.answer && (
                <p className="mt-2 text-sm text-[#8B1A1A]">{errors.answer}</p>
              )}
            </motion.div>
          )}

          {/* 서술형 모범답안 및 루브릭 */}
          {question.type === 'essay' && (
            <motion.div
              key="essay"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4"
            >
              {/* 채점 방식 선택 (교수 전용) */}
              {userRole === 'professor' && (
                <div>
                  <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                    채점 방식
                  </label>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setQuestion(prev => ({ ...prev, scoringMethod: 'ai_assisted' }))}
                      className={`
                        w-full py-2.5 font-bold text-sm border-2 transition-colors
                        ${question.scoringMethod === 'ai_assisted'
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                        }
                      `}
                    >
                      AI 보조 채점
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuestion(prev => ({ ...prev, scoringMethod: 'manual' }))}
                      className={`
                        w-full py-2.5 font-bold text-sm border-2 transition-colors
                        ${question.scoringMethod !== 'ai_assisted'
                          ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                          : 'bg-[#EDEAE4] text-[#1A1A1A] border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                        }
                      `}
                    >
                      수동 채점
                    </button>
                  </div>

                  {/* 채점 방식 안내 */}
                  <div className="bg-[#F5F0E8] border border-[#1A1A1A] p-3">
                    {question.scoringMethod === 'ai_assisted' ? (
                      <>
                        <p className="text-sm text-[#1A1A1A] mb-2">
                          AI가 루브릭 기준에 따라 점수를 제안하고, 교수님이 검토/수정합니다.
                        </p>
                        <p className="text-xs text-[#5C5C5C]">
                          예상 비용: 160명 기준 약 3,000원 (Sonnet 모델)
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-[#1A1A1A]">
                        교수님이 직접 채점합니다. 루브릭은 채점 가이드로 활용됩니다.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 모범답안 입력 */}
              <div>
                <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
                  완벽한 답 (모범답안)
                </label>
                <p className="text-xs text-[#5C5C5C] mb-2">
                  채점 시 참고할 모범 답안을 입력하세요. 학생에게 직접 표시되지 않습니다.
                </p>
                <textarea
                  value={question.answerText}
                  onChange={(e) => handleTextChange('answerText', e.target.value)}
                  placeholder="완벽한 모범 답안을 입력하세요"
                  rows={4}
                  className="w-full px-4 py-3 border-2 border-[#1A1A1A] bg-[#F5F0E8] resize-none focus:outline-none"
                />
              </div>

              {/* 루브릭 - 교수용: 채점 방식에 따라 필수/선택 */}
              {userRole === 'professor' ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-bold text-[#1A1A1A]">
                      루브릭 {question.scoringMethod === 'ai_assisted' ? '(필수)' : '(선택)'}
                    </label>
                    {question.scoringMethod !== 'ai_assisted' && (
                      <button
                        type="button"
                        onClick={() => {
                          const hasRubric = (question.rubric || []).length > 0;
                          if (hasRubric) {
                            setQuestion(prev => ({ ...prev, rubric: [] }));
                          } else {
                            setQuestion(prev => ({ ...prev, rubric: [{ criteria: '', percentage: 100, description: '' }] }));
                          }
                        }}
                        className={`
                          px-3 py-1 text-xs font-bold border border-[#1A1A1A] transition-colors
                          ${(question.rubric || []).length > 0
                            ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                            : 'bg-[#EDEAE4] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-[#F5F0E8]'
                          }
                        `}
                      >
                        {(question.rubric || []).length > 0 ? '루브릭 삭제' : '루브릭 추가'}
                      </button>
                    )}
                  </div>
                  {(question.scoringMethod === 'ai_assisted' || (question.rubric || []).length > 0) && (
                    <RubricEditor
                      rubric={question.rubric || [{ criteria: '', percentage: 100, description: '' }]}
                      onChange={handleRubricChange}
                      error={errors.rubric}
                      hideLabel
                    />
                  )}
                </div>
              ) : (
                /* 학생용: 기존 루브릭 UI 유지 */
                <RubricEditor
                  rubric={question.rubric || [{ criteria: '', percentage: 100, description: '' }]}
                  onChange={handleRubricChange}
                  error={errors.rubric}
                />
              )}
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
                <label className="text-sm font-bold text-[#1A1A1A]">
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
                  className="w-full py-2.5 text-sm font-bold border-2 border-dashed border-[#1A1A1A] text-[#5C5C5C] hover:bg-[#EDEAE4] hover:text-[#1A1A1A] transition-colors"
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
            <label className="block text-sm font-bold text-[#1A1A1A] mb-2">
              해설 <span className="text-[#5C5C5C] font-normal">(선택)</span>
            </label>
            <textarea
              value={question.explanation}
              onChange={(e) => handleTextChange('explanation', e.target.value)}
              placeholder="해설을 입력하세요 (선택)"
              rows={2}
              className="
                w-full px-4 py-3 border-2 border-[#1A1A1A] bg-[#F5F0E8]
                resize-none
                transition-colors duration-200
                focus:outline-none
              "
            />
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="flex gap-3 pt-2">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            className="
              flex-1 py-3 px-4 border-2 border-[#1A1A1A]
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
              flex-1 py-3 px-4 border-2 border-[#1A1A1A]
              bg-[#1A1A1A] text-[#F5F0E8] font-bold
              hover:bg-[#333]
              transition-colors
            "
          >
            저장
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
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
