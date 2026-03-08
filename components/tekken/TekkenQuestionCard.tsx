'use client';

/**
 * 배틀 문제 카드
 *
 * OX / 객관식 선택 UI
 * 타이머 게이지: 처음 5초(25%) 구간 = 금색 크리티컬, 나머지 = 파란색
 */

import { useState, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BattleQuestion } from '@/lib/types/tekken';

// BATTLE_CONFIG.QUESTION_TIMEOUT = 20000ms, CRITICAL_TIME = 5000ms
const QUESTION_TIMEOUT = 20000;
const CRITICAL_WINDOW = 5000;

interface TekkenQuestionCardProps {
  question: BattleQuestion | null;
  questionTimeLeft: number;
  onAnswer: (answer: number) => void;
  disabled: boolean;
  roundIndex: number;
}

function TekkenQuestionCard({
  question,
  questionTimeLeft,
  onAnswer,
  disabled,
  roundIndex,
}: TekkenQuestionCardProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);

  // 라운드 변경 시 선택 초기화
  useEffect(() => {
    setSelectedAnswer(null);
  }, [roundIndex]);

  if (!question) return null;

  const handleSelect = (index: number) => {
    if (disabled || selectedAnswer !== null) return;
    setSelectedAnswer(index);
    onAnswer(index);
  };

  const timePercent = Math.max(0, (questionTimeLeft / QUESTION_TIMEOUT) * 100);
  const timeSeconds = Math.ceil(questionTimeLeft / 1000);
  // 경과 시간 = QUESTION_TIMEOUT - questionTimeLeft
  const elapsed = QUESTION_TIMEOUT - questionTimeLeft;
  const isInCritical = elapsed < CRITICAL_WINDOW;

  return (
    <div className="w-full px-4 flex-1 flex flex-col min-h-0">
      {/* 문제 타이머 바 */}
      <div className="mb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2.5 bg-black/40 rounded-full overflow-hidden border border-white/10 relative">
            {/* 게이지 바 — CSS transition */}
            <div
              className={`h-full rounded-full relative z-10 ${
                isInCritical
                  ? 'bg-gradient-to-r from-yellow-400 to-amber-500'
                  : timePercent > 30
                    ? 'bg-gradient-to-r from-blue-400 to-cyan-400'
                    : 'bg-gradient-to-r from-red-400 to-orange-400'
              }`}
              style={{
                width: `${timePercent}%`,
                transition: 'width 1s linear',
              }}
            />
          </div>
          <span className={`text-sm font-bold min-w-[32px] text-right ${
            isInCritical ? 'text-yellow-400' : timeSeconds <= 5 ? 'text-red-400' : 'text-white/70'
          }`}>
            {timeSeconds}초
          </span>
        </div>
      </div>

      {/* 스크롤 가능 영역: 문제 + 선지 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* 문제 텍스트 */}
        <AnimatePresence mode="wait">
          <motion.div
            key={roundIndex}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-black/40 border border-white/10 rounded-2xl p-3 mb-2"
          >
            <p className="text-sm font-bold text-white leading-relaxed">
              {question.text}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* 선택지 (5지선다) */}
        <div className="grid gap-1.5 grid-cols-1 pb-1">
          {question.choices.map((choice, idx) => {
            const isSelected = selectedAnswer === idx;

            return (
              <button
                key={`${roundIndex}-${idx}`}
                onClick={() => handleSelect(idx)}
                disabled={disabled || selectedAnswer !== null}
                className={`
                  relative px-3 py-2 rounded-xl border-2 font-bold text-left transition-all
                  ${isSelected
                    ? 'border-yellow-400 bg-yellow-400/20 text-yellow-300'
                    : 'border-white/20 bg-white/5 text-white hover:border-white/40 hover:bg-white/10'
                  }
                  ${disabled || selectedAnswer !== null ? 'opacity-60 cursor-default' : 'active:scale-[0.97]'}
                `}
              >
                <span className="text-xs leading-snug text-center w-full block">
                  {choice}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default memo(TekkenQuestionCard);
