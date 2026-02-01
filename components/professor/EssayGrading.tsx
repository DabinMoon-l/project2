'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import {
  calculateEssayScore,
  createEmptyEssayScore,
  updateRubricScore,
  updateOverallFeedback,
  scoreToGrade,
  type EssayScoreResult,
  type RubricScore,
} from '@/lib/scoring';
import type { RubricItem } from '@/lib/ocr';

// ============================================================
// 타입 정의
// ============================================================

interface EssayGradingProps {
  /** 문제 ID */
  questionId: string;
  /** 문제 텍스트 */
  questionText: string;
  /** 모범답안 */
  modelAnswer: string;
  /** 학생 답안 */
  studentAnswer: string;
  /** 루브릭 */
  rubric: RubricItem[];
  /** 퀴즈 ID (저장용) */
  quizId?: string;
  /** 학생 ID (저장용) */
  studentId?: string;
  /** 학생 이름 (표시용) */
  studentName?: string;
  /** 채점 완료 콜백 */
  onGradingComplete?: (result: EssayScoreResult) => void;
  /** 닫기 콜백 */
  onClose?: () => void;
}

// ============================================================
// 컴포넌트
// ============================================================

/**
 * 서술형 문제 채점 UI
 *
 * 수동 채점과 AI 보조 채점을 모두 지원합니다.
 */
export default function EssayGrading({
  questionId,
  questionText,
  modelAnswer,
  studentAnswer,
  rubric,
  quizId,
  studentId,
  studentName = '학생',
  onGradingComplete,
  onClose,
}: EssayGradingProps) {
  // 채점 결과 상태
  const [scoreResult, setScoreResult] = useState<EssayScoreResult>(() =>
    createEmptyEssayScore(questionId, rubric)
  );

  // AI 채점 로딩 상태
  const [isAIGrading, setIsAIGrading] = useState(false);
  const [aiError, setAIError] = useState<string | null>(null);

  // 저장 상태
  const [isSaving, setIsSaving] = useState(false);

  /**
   * 루브릭 항목 점수 업데이트
   */
  const handleScoreChange = useCallback(
    (index: number, achieved: number, feedback?: string) => {
      setScoreResult((prev) =>
        updateRubricScore(prev, index, achieved, feedback)
      );
    },
    []
  );

  /**
   * 전체 피드백 업데이트
   */
  const handleOverallFeedbackChange = useCallback((feedback: string) => {
    setScoreResult((prev) => updateOverallFeedback(prev, feedback));
  }, []);

  /**
   * AI 채점 요청
   */
  const handleAIGrading = useCallback(async () => {
    setIsAIGrading(true);
    setAIError(null);

    try {
      const gradeEssay = httpsCallable(functions, 'gradeEssay');

      const response = await gradeEssay({
        questionId,
        questionText,
        modelAnswer,
        studentAnswer,
        rubric,
        quizId,
        studentId,
      });

      const data = response.data as {
        success: boolean;
        totalScore: number;
        rubricScores: RubricScore[];
        overallFeedback: string;
        error?: string;
      };

      if (data.success) {
        setScoreResult({
          questionId,
          totalScore: data.totalScore,
          rubricScores: data.rubricScores,
          overallFeedback: data.overallFeedback,
        });
      } else {
        setAIError(data.error || 'AI 채점에 실패했습니다.');
      }
    } catch (error) {
      console.error('AI 채점 에러:', error);
      setAIError(
        error instanceof Error
          ? error.message
          : 'AI 채점 중 오류가 발생했습니다.'
      );
    } finally {
      setIsAIGrading(false);
    }
  }, [questionId, questionText, modelAnswer, studentAnswer, rubric, quizId, studentId]);

  /**
   * 채점 완료
   */
  const handleComplete = useCallback(() => {
    onGradingComplete?.(scoreResult);
  }, [scoreResult, onGradingComplete]);

  return (
    <div className="bg-white border-2 border-[#1A1A1A] overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b-2 border-[#1A1A1A] bg-[#EDEAE4]">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[#1A1A1A]">서술형 채점</h3>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center hover:bg-[#1A1A1A] hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {studentName && (
          <p className="text-sm text-[#5C5C5C] mt-1">{studentName}의 답안</p>
        )}
      </div>

      <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
        {/* 문제 */}
        <div>
          <label className="block text-xs font-bold text-[#5C5C5C] mb-1">문제</label>
          <p className="text-sm text-[#1A1A1A] p-3 bg-[#EDEAE4] border border-[#1A1A1A]">
            {questionText}
          </p>
        </div>

        {/* 모범답안 */}
        <div>
          <label className="block text-xs font-bold text-[#5C5C5C] mb-1">모범답안</label>
          <p className="text-sm text-[#1A1A1A] p-3 bg-[#EDEAE4] border border-[#1A1A1A] whitespace-pre-wrap">
            {modelAnswer}
          </p>
        </div>

        {/* 학생 답안 */}
        <div>
          <label className="block text-xs font-bold text-[#5C5C5C] mb-1">학생 답안</label>
          <p className="text-sm text-[#1A1A1A] p-3 bg-white border-2 border-[#1A1A1A] whitespace-pre-wrap min-h-[80px]">
            {studentAnswer || '(미작성)'}
          </p>
        </div>

        {/* AI 채점 버튼 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAIGrading}
            disabled={isAIGrading || !studentAnswer}
            className="flex-1 py-2.5 px-4 bg-[#1A6B1A] text-white font-bold border-2 border-[#1A6B1A] hover:bg-[#145214] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isAIGrading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                AI 채점 중...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI 보조 채점
              </>
            )}
          </button>
          <span className="text-xs text-[#5C5C5C]">
            예상 비용: ~20원
          </span>
        </div>

        {/* AI 에러 메시지 */}
        <AnimatePresence>
          {aiError && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3 bg-[#8B1A1A]/10 border border-[#8B1A1A] text-[#8B1A1A] text-sm"
            >
              {aiError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 루브릭별 채점 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-[#5C5C5C]">평가 항목별 채점</label>
            <span className="text-sm font-bold text-[#1A1A1A]">
              총점: {scoreResult.totalScore}점 ({scoreToGrade(scoreResult.totalScore)})
            </span>
          </div>

          <div className="space-y-3">
            {scoreResult.rubricScores.map((score, index) => (
              <div
                key={index}
                className="p-3 border border-[#1A1A1A] bg-[#EDEAE4]"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-[#1A1A1A]">
                    {score.criteria}
                  </span>
                  <span className="text-xs text-[#5C5C5C]">
                    최대 {score.maxPercentage}점
                  </span>
                </div>

                {/* 점수 슬라이더 */}
                <div className="flex items-center gap-3 mb-2">
                  <input
                    type="range"
                    min={0}
                    max={score.maxPercentage}
                    value={score.achievedPercentage}
                    onChange={(e) =>
                      handleScoreChange(index, Number(e.target.value))
                    }
                    className="flex-1 h-2 bg-white border border-[#1A1A1A] appearance-none cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none
                      [&::-webkit-slider-thumb]:w-4
                      [&::-webkit-slider-thumb]:h-4
                      [&::-webkit-slider-thumb]:bg-[#1A1A1A]
                      [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                  <input
                    type="number"
                    min={0}
                    max={score.maxPercentage}
                    value={score.achievedPercentage}
                    onChange={(e) =>
                      handleScoreChange(index, Number(e.target.value))
                    }
                    className="w-16 px-2 py-1 text-center text-sm font-bold border-2 border-[#1A1A1A] bg-white"
                  />
                  <span className="text-sm text-[#5C5C5C]">점</span>
                </div>

                {/* 항목별 피드백 */}
                <input
                  type="text"
                  placeholder="피드백 (선택사항)"
                  value={score.feedback || ''}
                  onChange={(e) =>
                    handleScoreChange(index, score.achievedPercentage, e.target.value)
                  }
                  className="w-full px-3 py-2 text-sm border border-[#1A1A1A] bg-white placeholder:text-[#999]"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 전체 피드백 */}
        <div>
          <label className="block text-xs font-bold text-[#5C5C5C] mb-1">
            종합 피드백
          </label>
          <textarea
            value={scoreResult.overallFeedback || ''}
            onChange={(e) => handleOverallFeedbackChange(e.target.value)}
            placeholder="전체적인 피드백을 작성해주세요..."
            rows={3}
            className="w-full px-3 py-2 text-sm border-2 border-[#1A1A1A] bg-white placeholder:text-[#999] resize-none"
          />
        </div>

        {/* 점수 요약 */}
        <div className="p-4 bg-[#1A1A1A] text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-white/70">최종 점수</p>
              <p className="text-3xl font-bold">{scoreResult.totalScore}점</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-white/70">등급</p>
              <p className="text-3xl font-bold">{scoreToGrade(scoreResult.totalScore)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 하단 버튼 */}
      <div className="px-4 py-3 border-t-2 border-[#1A1A1A] bg-[#EDEAE4] flex gap-3">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors"
          >
            취소
          </button>
        )}
        <button
          type="button"
          onClick={handleComplete}
          disabled={isSaving}
          className="flex-1 py-2.5 font-bold bg-[#1A1A1A] text-white border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors disabled:opacity-50"
        >
          {isSaving ? '저장 중...' : '채점 완료'}
        </button>
      </div>
    </div>
  );
}
