'use client';

/**
 * 배틀 문제 카드
 *
 * OX / 객관식 선택 UI
 * 타이머 게이지: 처음 4초(20%) 구간 = 금색 크리티컬, 나머지 = 파란색
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BattleQuestion } from '@/lib/types/tekken';

// BATTLE_CONFIG.QUESTION_TIMEOUT = 20000ms, CRITICAL_TIME = 4000ms
const QUESTION_TIMEOUT = 20000;
const CRITICAL_WINDOW = 4000;
const CRITICAL_PERCENT = (CRITICAL_WINDOW / QUESTION_TIMEOUT) * 100; // 20%

interface TekkenQuestionCardProps {
  question: BattleQuestion | null;
  questionTimeLeft: number;
  onAnswer: (answer: number) => void;
  disabled: boolean;
  roundIndex: number;
}

export default function TekkenQuestionCard({
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
    <div className="w-full px-4 flex-1 flex flex-col justify-center">
      {/* 문제 타이머 바 — 크리티컬 구간 시각화 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1 h-2.5 bg-black/40 rounded-full overflow-hidden border border-white/10 relative">
          {/* 크리티컬 구간 배경 마킹 (좌측 20%) */}
          <div
            className="absolute left-0 top-0 h-full bg-yellow-500/15 rounded-l-full"
            style={{ width: `${CRITICAL_PERCENT}%` }}
          />
          {/* 크리티컬/일반 구간 경계선 */}
          <div
            className="absolute top-0 h-full w-px bg-yellow-500/40"
            style={{ left: `${CRITICAL_PERCENT}%` }}
          />

          {/* 게이지 바 (오른쪽→왼쪽으로 줄어듦) */}
          <motion.div
            className={`h-full rounded-full relative z-10 ${
              isInCritical
                ? 'bg-gradient-to-r from-yellow-400 to-amber-500'
                : timePercent > 30
                  ? 'bg-gradient-to-r from-blue-400 to-cyan-400'
                  : 'bg-gradient-to-r from-red-400 to-orange-400'
            }`}
            initial={false}
            animate={{ width: `${timePercent}%` }}
            transition={{ duration: 0.1 }}
          />
        </div>
        <span className={`text-sm font-bold min-w-[32px] text-right ${
          isInCritical ? 'text-yellow-400' : timeSeconds <= 5 ? 'text-red-400' : 'text-white/70'
        }`}>
          {timeSeconds}초
        </span>
      </div>

      {/* 크리티컬 구간 안내 텍스트 */}
      {isInCritical && (
        <motion.p
          className="text-center text-xs font-bold text-yellow-400/80 mb-1"
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        >
          CRITICAL CHANCE!
        </motion.p>
      )}

      {/* 문제 텍스트 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={roundIndex}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="bg-black/30 border border-white/10 rounded-2xl p-4 mb-3 backdrop-blur-sm"
        >
          <p className="text-base font-bold text-white leading-relaxed">
            {question.text}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* 선택지 (5지선다) */}
      <div className="grid gap-2 grid-cols-1">
        {question.choices.map((choice, idx) => {
          const isSelected = selectedAnswer === idx;

          return (
            <motion.button
              key={`${roundIndex}-${idx}`}
              onClick={() => handleSelect(idx)}
              disabled={disabled || selectedAnswer !== null}
              className={`
                relative px-4 py-2.5 rounded-xl border-2 font-bold text-left transition-all
                ${isSelected
                  ? 'border-yellow-400 bg-yellow-400/20 text-yellow-300'
                  : 'border-white/20 bg-white/5 text-white hover:border-white/40 hover:bg-white/10'
                }
                ${disabled || selectedAnswer !== null ? 'opacity-60 cursor-default' : 'active:scale-[0.97]'}
              `}
              whileTap={disabled || selectedAnswer !== null ? {} : { scale: 0.97 }}
            >
              <span className="text-sm">
                <span className="text-white/50 mr-2">{idx + 1}.</span>
                {choice}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
