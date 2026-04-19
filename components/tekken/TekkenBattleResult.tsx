'use client';

/**
 * 배틀 결과 화면
 *
 * 승/패/무승부 + XP 표시
 * 부모 컨테이너 내부에서 전체 영역 차지
 * "문제 확인하기" → 라운드별 해설 바텀시트 (배틀 오버레이 영역 내부, 가로모드=3쪽)
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BattleResult, RoundState } from '@/lib/types/tekken';
import { calcBattleXp } from '@/lib/utils/tekkenDamage';

interface TekkenBattleResultProps {
  result: BattleResult;
  userId: string;
  opponentNickname: string;
  rounds?: Record<number, RoundState>;
  onClose: () => void;
}

export default function TekkenBattleResult({
  result,
  userId,
  opponentNickname,
  rounds,
  onClose,
}: TekkenBattleResultProps) {
  const isWinner = result.winnerId === userId;
  const isDraw = result.isDraw;
  // 서버에서 실제 지급한 XP가 있으면 사용, 없으면 기본값 (연승 미반영)
  const xpByPlayer = (result as unknown as { xpByPlayer?: Record<string, number> }).xpByPlayer;
  const xp = xpByPlayer?.[userId] ?? calcBattleXp(isWinner, 0);

  const [showExplanation, setShowExplanation] = useState(false);

  // 라운드 데이터 정렬 (진행된 라운드만, questionData 보유 필수)
  const sortedRounds = useMemo(() => {
    if (!rounds) return [];
    return Object.entries(rounds)
      .map(([idx, state]) => ({ idx: Number(idx), state }))
      .filter(({ state }) => !!state?.questionData)
      .sort((a, b) => a.idx - b.idx);
  }, [rounds]);

  const hasExplanation = sortedRounds.length > 0;

  const endReasonText = {
    ko: 'K.O!',
    allRounds: '',
    timeout: '',
    disconnect: '연결 끊김',
  }[result.endReason] || '';

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      {/* 결과 텍스트 */}
      <motion.div
        className="text-center mb-8"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 10, delay: 0.3 }}
      >
        {isDraw ? (
          <h1 className="text-6xl font-black text-white mb-2">DRAW</h1>
        ) : isWinner ? (
          <h1 className="text-6xl font-black text-yellow-400 mb-2">WIN!</h1>
        ) : (
          <h1 className="text-6xl font-black text-red-400 mb-2">LOSE</h1>
        )}
        <p className="text-lg text-white/60">{endReasonText}</p>
      </motion.div>

      {/* 대전 상대 */}
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <p className="text-sm text-white/50">vs</p>
        <p className="text-xl font-bold text-white">{opponentNickname}</p>
      </motion.div>

      {/* XP 획득 */}
      <motion.div
        className="flex items-center gap-3 px-8 py-4 bg-black/50 border border-white/15 rounded-2xl mb-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9 }}
      >
        <span className="text-2xl">⭐</span>
        <div>
          <p className="text-sm text-white/50">획득 XP</p>
          <p className="text-3xl font-black text-yellow-400">+{xp}</p>
        </div>
      </motion.div>

      {/* 닫기 버튼 */}
      <motion.button
        onClick={onClose}
        className="px-10 py-3 bg-white/10 border border-white/20 rounded-full text-white font-bold text-lg active:scale-95 transition-transform"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
      >
        돌아가기
      </motion.button>

      {/* 해설 확인 링크 (밑줄) */}
      {hasExplanation && (
        <motion.button
          onClick={() => setShowExplanation(true)}
          className="mt-6 text-sm text-white/60 underline underline-offset-4 decoration-white/40 active:text-white transition-colors"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
        >
          문제 확인하기
        </motion.button>
      )}

      {/* 해설 바텀시트 — 배틀 오버레이 영역(가로모드=3쪽) 내부 */}
      <AnimatePresence>
        {showExplanation && (
          <>
            {/* 투명 오버레이 */}
            <motion.div
              key="explain-overlay"
              className="absolute inset-0 z-20"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExplanation(false)}
            />
            {/* 바텀시트 */}
            <motion.div
              key="explain-sheet"
              className="absolute left-0 right-0 bottom-0 z-30 bg-[#1A1612] border-t-2 border-white/20 rounded-t-2xl shadow-[0_-8px_32px_rgba(0,0,0,0.5)] flex flex-col"
              style={{ maxHeight: '82%' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 그립 핸들 */}
              <div className="flex justify-center pt-2 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-white/30" />
              </div>
              {/* 헤더 */}
              <div className="flex items-center justify-between px-5 pb-3 border-b border-white/10 shrink-0">
                <h2 className="text-base font-black text-white">라운드별 해설</h2>
                <button
                  onClick={() => setShowExplanation(false)}
                  className="text-xs text-white/60 active:text-white/90 px-2 py-1"
                >
                  닫기
                </button>
              </div>
              {/* 라운드 리스트 */}
              <div className="overflow-y-auto px-4 py-4 space-y-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {sortedRounds.map(({ idx, state }) => (
                  <RoundExplanationCard
                    key={idx}
                    idx={idx}
                    state={state}
                    userId={userId}
                  />
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 라운드별 문제 카드 — 선지 아코디언으로 선지별 해설 표시 */
function RoundExplanationCard({
  idx,
  state,
  userId,
}: {
  idx: number;
  state: RoundState;
  userId: string;
}) {
  const userAnswer = state.answers?.[userId]?.answer;
  const resultData = state.result?.[userId];
  const isCorrect = resultData?.isCorrect ?? false;
  const correctText = resultData?.correctChoiceText;
  const correctIdx = correctText
    ? state.questionData.choices.findIndex((c) => c === correctText)
    : -1;
  const noAnswer = userAnswer === undefined || userAnswer === null;
  const statusLabel = isCorrect ? '정답' : noAnswer ? '시간초과' : '오답';
  const statusColor = isCorrect ? 'bg-green-500' : 'bg-red-500';
  const statusTextColor = isCorrect ? 'text-green-400' : 'text-red-400';
  const choiceExplanations = state.questionData.choiceExplanations;

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-4">
      {/* 라운드 헤더 */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center justify-center px-2 h-6 rounded-full text-[11px] font-black text-white ${statusColor}`}
        >
          R{idx + 1}
        </span>
        <span className={`text-xs font-bold ${statusTextColor}`}>
          {statusLabel}
        </span>
      </div>
      {/* 문제 */}
      <p className="text-white text-sm font-semibold leading-relaxed mb-3 whitespace-pre-wrap">
        {state.questionData.text}
      </p>
      {/* 선지 */}
      <div className="space-y-1.5">
        {state.questionData.choices.map((choice, i) => (
          <ChoiceAccordion
            key={i}
            choice={choice}
            index={i}
            isUserAnswer={userAnswer === i}
            isCorrectChoice={i === correctIdx}
            explanation={choiceExplanations?.[i]}
          />
        ))}
      </div>
    </div>
  );
}

/** 선지 1개 — 탭하면 선지별 해설 아코디언 열림 */
function ChoiceAccordion({
  choice,
  index,
  isUserAnswer,
  isCorrectChoice,
  explanation,
}: {
  choice: string;
  index: number;
  isUserAnswer: boolean;
  isCorrectChoice: boolean;
  explanation?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasExplanation = !!explanation && explanation.trim().length > 0;

  let cls = 'border-white/10 bg-white/5 text-white/70';
  let marker: string = String.fromCharCode(65 + index); // A, B, C, ...
  if (isCorrectChoice) {
    cls = 'border-green-500/60 bg-green-500/15 text-green-100';
    marker = '✓';
  } else if (isUserAnswer && !isCorrectChoice) {
    cls = 'border-red-500/60 bg-red-500/15 text-red-100';
    marker = '✗';
  }

  return (
    <div className={`rounded-lg border text-sm ${cls}`}>
      <button
        type="button"
        onClick={hasExplanation ? () => setOpen((o) => !o) : undefined}
        className="w-full flex items-start gap-2 px-3 py-2 text-left"
        disabled={!hasExplanation}
      >
        <span className="font-black text-xs mt-0.5 w-3 text-center shrink-0">
          {marker}
        </span>
        <span className="flex-1 leading-snug whitespace-pre-wrap">{choice}</span>
        {isUserAnswer && (
          <span className="text-[10px] font-bold text-white/60 mt-0.5 shrink-0">
            내 선택
          </span>
        )}
        {hasExplanation && (
          <motion.svg
            className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </motion.svg>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && hasExplanation && (
          <motion.div
            key="exp"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 text-[12px] leading-relaxed text-white/75 whitespace-pre-wrap border-t border-white/10">
              {explanation}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
