'use client';

/**
 * 배틀 문제 카드
 *
 * OX / 객관식 선택 UI
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BattleQuestion } from '@/lib/types/tekken';

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

  const timePercent = Math.max(0, (questionTimeLeft / 20000) * 100);
  const timeSeconds = Math.ceil(questionTimeLeft / 1000);

  return (
    <div className="w-full px-4 flex-1 flex flex-col justify-center">
      {/* 문제 타이머 바 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1 h-2 bg-black/40 rounded-full overflow-hidden border border-white/10">
          <motion.div
            className={`h-full rounded-full ${timePercent > 30 ? 'bg-blue-400' : 'bg-red-400'}`}
            initial={false}
            animate={{ width: `${timePercent}%` }}
            transition={{ duration: 0.1 }}
          />
        </div>
        <span className={`text-sm font-bold min-w-[32px] text-right ${timeSeconds <= 5 ? 'text-red-400' : 'text-white/70'}`}>
          {timeSeconds}초
        </span>
      </div>

      {/* 문제 텍스트 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={roundIndex}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="bg-black/30 border border-white/10 rounded-2xl p-5 mb-4 backdrop-blur-sm"
        >
          <p className="text-base font-bold text-white leading-relaxed">
            {question.text}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* 선택지 */}
      <div className={`grid gap-2 ${question.type === 'ox' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {question.choices.map((choice, idx) => {
          const isSelected = selectedAnswer === idx;

          return (
            <motion.button
              key={`${roundIndex}-${idx}`}
              onClick={() => handleSelect(idx)}
              disabled={disabled || selectedAnswer !== null}
              className={`
                relative px-5 py-3.5 rounded-xl border-2 font-bold text-left transition-all
                ${isSelected
                  ? 'border-yellow-400 bg-yellow-400/20 text-yellow-300'
                  : 'border-white/20 bg-white/5 text-white hover:border-white/40 hover:bg-white/10'
                }
                ${disabled || selectedAnswer !== null ? 'opacity-60 cursor-default' : 'active:scale-[0.97]'}
              `}
              whileTap={disabled || selectedAnswer !== null ? {} : { scale: 0.97 }}
            >
              {question.type === 'ox' ? (
                <span className="text-2xl font-black text-center block">
                  {choice}
                </span>
              ) : (
                <span className="text-sm">
                  <span className="text-white/50 mr-2">{idx + 1}.</span>
                  {choice}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
