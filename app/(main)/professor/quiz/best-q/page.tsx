'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/common';
import { useCourse } from '@/lib/contexts';
import { calcFeedbackScore } from '@/lib/utils/feedbackScore';
import type { FeedbackType } from '@/components/quiz/InstantFeedbackButton';
import { useProfessorQuiz, type QuizQuestion, type QuestionStats } from '@/lib/hooks/useProfessorQuiz';
import type { MixedExampleItem, BogiData, LabeledItem, ExamplesData } from '@/components/quiz/QuestionCard';
import { useCustomFolders, type CustomFolder } from '@/lib/hooks/useCustomFolders';
import FolderSelectModal from '@/components/common/FolderSelectModal';
import type { QuestionExportData } from '@/lib/utils/questionDocExport';
import ProfessorLibraryTab from '@/components/professor/library/ProfessorLibraryTab';

// ============================================================
// 타입
// ============================================================

interface RichQuestion extends QuizQuestion {
  imageUrl?: string;
  mixedExamples?: MixedExampleItem[];
  passagePrompt?: string;
  bogi?: BogiData | null;
  hasMultipleAnswers?: boolean;
  examples?: ExamplesData;
  passageType?: 'text' | 'korean_abc' | 'mixed';
  passage?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
}

interface FeedbackItem {
  id: string;
  userId: string;
  quizId: string;
  questionId: string;
  questionNumber: number;
  type: FeedbackType;
  content: string;
  createdAt: any;
}

interface BestQuestionData {
  quizId: string;
  quizTitle: string;
  questionId: string;
  questionIndex: number;
  score: number;
  feedbackCount: number;
  question: RichQuestion | null;
  stats: QuestionStats | null;
  feedbacks: FeedbackItem[];
}

// ============================================================
// 피드백 유형 라벨 + 색상
// ============================================================


// ============================================================
// 혼합 제시문 렌더링 헬퍼
// ============================================================

function isValidMixedItem(item: MixedExampleItem): boolean {
  switch (item.type) {
    case 'text':
      return Boolean(item.content?.trim());
    case 'labeled':
    case 'gana':
    case 'bullet':
      return Boolean(item.content?.trim()) || Boolean(item.items?.some(i => i.content.trim()));
    case 'image':
      return Boolean(item.imageUrl);
    case 'grouped':
      return Boolean(item.children?.length && item.children.some(child => isValidMixedItem(child)));
    default:
      return false;
  }
}

function renderMixedChild(child: MixedExampleItem) {
  if (child.type === 'text' && child.content) {
    return <p className="text-[#5C5C5C] text-sm whitespace-pre-wrap">{child.content}</p>;
  }
  if (child.type === 'labeled') {
    return (
      <>
        {child.content && (
          <p className="text-[#1A1A1A] text-sm">
            <span className="font-bold text-[#1A1A1A] mr-1">{child.label}.</span>
            {child.content}
          </p>
        )}
        {child.items?.map((li, idx) => (
          <p key={idx} className="text-[#1A1A1A] text-sm">
            <span className="font-bold text-[#1A1A1A] mr-1">{li.label}.</span>
            {li.content}
          </p>
        ))}
      </>
    );
  }
  if (child.type === 'gana') {
    return (
      <>
        {child.content && (
          <p className="text-[#1A1A1A] text-sm">
            <span className="font-bold text-[#1A1A1A] mr-1">({child.label})</span>
            {child.content}
          </p>
        )}
        {child.items?.map((li, idx) => (
          <p key={idx} className="text-[#1A1A1A] text-sm">
            <span className="font-bold text-[#1A1A1A] mr-1">({li.label})</span>
            {li.content}
          </p>
        ))}
      </>
    );
  }
  if (child.type === 'bullet') {
    return (
      <>
        {child.content && (
          <p className="text-[#1A1A1A] text-sm">
            <span className="font-bold text-[#1A1A1A] mr-1">◦</span>
            {child.content}
          </p>
        )}
        {child.items?.map((li, idx) => (
          <p key={idx} className="text-[#1A1A1A] text-sm">
            <span className="font-bold text-[#1A1A1A] mr-1">◦</span>
            {li.content}
          </p>
        ))}
      </>
    );
  }
  if (child.type === 'image' && child.imageUrl) {
    return (
      <div className="relative w-full max-w-xs overflow-hidden bg-white border border-[#1A1A1A]">
        <img src={child.imageUrl} alt="제시문 이미지" className="w-full h-auto object-contain" />
      </div>
    );
  }
  return null;
}

// ============================================================
// 피드백 목록 모달
// ============================================================

function FeedbackListModal({
  feedbacks,
  questionLabel,
  onClose,
}: {
  feedbacks: FeedbackItem[];
  questionLabel: string;
  onClose: () => void;
}) {
  const sorted = [...feedbacks].sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
    const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
    return bTime - aTime;
  });

  const typeLabels: Record<string, string> = {
    praise: '문제가 좋아요!',
    wantmore: '더 풀고 싶어요',
    unclear: '문제가 이해가 안 돼요',
    wrong: '정답이 틀린 것 같아요',
    typo: '오타가 있어요',
    other: '기타 의견',
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#F5F0E8] border-2 border-[#1A1A1A] max-h-[80vh] overflow-visible flex flex-col"
      >
        <div className="p-4 border-b border-[#1A1A1A]">
          <h2 className="text-lg font-bold text-[#1A1A1A]">피드백</h2>
          <p className="text-sm text-[#5C5C5C]">{questionLabel}</p>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          {sorted.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[#5C5C5C]">아직 피드백이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map((fb) => {
                const typeLabel = typeLabels[fb.type] || fb.type || '피드백';
                // questionNumber 추출
                let questionNum = 0;
                if (fb.questionId) {
                  const match = fb.questionId.match(/^q(\d{1,3})$/);
                  if (match) questionNum = parseInt(match[1], 10) + 1;
                }

                return (
                  <div
                    key={fb.id}
                    className="p-4 border border-[#1A1A1A] bg-[#EDEAE4]"
                  >
                    {questionNum > 0 && (
                      <p className="text-sm text-[#5C5C5C] mb-1">
                        문제 {questionNum}.
                      </p>
                    )}
                    <p className="text-base font-bold text-[#8B6914] mb-2">
                      {typeLabel}
                    </p>
                    {fb.content && (
                      <p className="text-base text-[#1A1A1A]">
                        {fb.content}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#1A1A1A]">
          <button
            onClick={onClose}
            className="w-full py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4]"
          >
            닫기
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

// ============================================================
// QuizStatsModal 스타일 문제 뷰
// ============================================================

function StatsQuestionView({
  question,
  stats,
  onFolderSave,
}: {
  question: RichQuestion;
  stats: QuestionStats | null;
  onFolderSave?: () => void;
}) {
  const q = question;
  const correctRate = stats?.correctRate ?? 0;

  const hasValidMixedExamples = q.mixedExamples &&
    q.mixedExamples.length > 0 &&
    q.mixedExamples.some(item => isValidMixedItem(item));

  // OX 분포 계산
  const oxDistribution = q.type === 'ox' && stats?.choiceStats ? {
    o: stats.choiceStats[0]?.count || 0,
    x: stats.choiceStats[1]?.count || 0,
  } : null;

  // 객관식 분포 계산
  const optionDistribution = q.type === 'multiple' && stats?.choiceStats && q.choices ? (() => {
    const correctAnswers = String(q.answer ?? '').split(',').map(a => a.trim());
    return stats.choiceStats.map((cs, idx) => ({
      option: q.choices![idx] || `${idx + 1}번`,
      count: cs.count,
      isCorrect: correctAnswers.includes(String(cs.choice)),
      percentage: cs.percentage,
    }));
  })() : null;

  // 오답 중 최고 선택률
  const maxWrongPct = optionDistribution
    ? Math.max(...optionDistribution.filter(o => !o.isCorrect).map(o => o.percentage), 0)
    : 0;

  return (
    <div className="relative px-4 py-4">
      {/* 폴더 저장 아이콘 (top-right) */}
      {onFolderSave && (
        <button
          onClick={onFolderSave}
          className="absolute top-3 right-3 z-10 w-10 h-10 flex items-center justify-center text-[#8B6914] hover:text-[#6B4F0E] transition-colors"
          title="폴더에 저장"
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
        </button>
      )}

      {/* 정답률 */}
      {stats && stats.totalResponses > 0 && (
        <div className="text-center mb-4">
          <span className="text-xl font-bold text-[#1A1A1A]">정답률 {correctRate}%</span>
        </div>
      )}

      {/* 문제 텍스트 */}
      <p className="text-lg text-[#1A1A1A] whitespace-pre-wrap mb-4">
        {q.text || '(문제 텍스트 없음)'}
      </p>

      {/* 결합형 공통 지문 */}
      {(q.passage || q.passageImage || (q.koreanAbcItems && q.koreanAbcItems.length > 0)) && (
        <div className="space-y-3 mb-4">
          {q.passage && (!q.passageType || q.passageType === 'text') && (
            <div className="p-3 bg-[#F5F0E8] border border-[#1A1A1A]">
              <p className="text-sm text-[#5C5C5C] mb-2 font-bold">공통 제시문</p>
              <p className="text-base text-[#1A1A1A] whitespace-pre-wrap">{q.passage}</p>
            </div>
          )}
          {q.passageType === 'korean_abc' && q.koreanAbcItems && q.koreanAbcItems.length > 0 && (
            <div className="p-3 bg-[#F5F0E8] border border-[#1A1A1A] space-y-1">
              <p className="text-sm text-[#5C5C5C] mb-2 font-bold">제시문</p>
              {q.koreanAbcItems.filter((i: string) => i.trim()).map((item: string, idx: number) => (
                <p key={idx} className="text-base text-[#1A1A1A]">
                  <span className="font-bold mr-1">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ'][idx]}.</span>
                  {item}
                </p>
              ))}
            </div>
          )}
          {q.passageImage && (
            <div className="relative overflow-hidden bg-[#F5F0E8] border border-[#1A1A1A]">
              <p className="absolute top-2 left-2 text-xs text-[#5C5C5C] font-bold bg-[#F5F0E8]/80 px-2 py-0.5 z-10">공통 이미지</p>
              <img src={q.passageImage} alt="공통 이미지" className="w-full h-auto object-contain max-h-40" />
            </div>
          )}
        </div>
      )}

      {/* 혼합 보기 (grouped) */}
      {hasValidMixedExamples && q.mixedExamples!
        .filter(item => item.type === 'grouped' && isValidMixedItem(item))
        .map((item) => (
          <div key={item.id} className="mb-4 p-4 bg-[#F5F0E8] border border-[#1A1A1A] space-y-2">
            {item.children?.filter(child => isValidMixedItem(child)).map((child) => (
              <div key={child.id}>{renderMixedChild(child)}</div>
            ))}
          </div>
        ))}

      {/* 나머지 제시문 (grouped 제외) */}
      {hasValidMixedExamples && q.mixedExamples!
        .filter(item => item.type !== 'grouped' && isValidMixedItem(item))
        .map((item) => {
          if (item.type === 'text') {
            return (
              <div key={item.id} className="mb-4 p-4 bg-[#F5F0E8] border border-[#1A1A1A]">
                <p className="text-base text-[#1A1A1A] whitespace-pre-wrap">{item.content}</p>
              </div>
            );
          }
          if (item.type === 'labeled' || item.type === 'gana' || item.type === 'bullet') {
            return (
              <div key={item.id} className="mb-4 p-4 bg-[#F5F0E8] border border-[#1A1A1A] space-y-1">
                {renderMixedChild(item)}
              </div>
            );
          }
          if (item.type === 'image' && item.imageUrl) {
            return <div key={item.id} className="mb-4">{renderMixedChild(item)}</div>;
          }
          return null;
        })}

      {/* 문제 이미지 */}
      {q.imageUrl && (
        <div className="mb-4 overflow-hidden bg-[#F5F0E8] border border-[#1A1A1A]">
          <img src={q.imageUrl} alt="문제 이미지" className="w-full h-auto object-contain max-h-48" />
        </div>
      )}

      {/* <보기> 박스 */}
      {q.bogi && q.bogi.items && q.bogi.items.some((i: LabeledItem) => i.content?.trim()) && (
        <div className="mb-4 p-4 bg-[#F5F0E8] border-2 border-[#1A1A1A]">
          <p className="text-sm text-center text-[#5C5C5C] mb-3 font-bold">&lt;보 기&gt;</p>
          <div className="space-y-2">
            {q.bogi.items.filter((i: LabeledItem) => i.content?.trim()).map((item: LabeledItem) => (
              <p key={item.label} className="text-base text-[#1A1A1A]">
                <span className="font-bold mr-1">{item.label}.</span>
                {item.content}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 발문 */}
      {(q.passagePrompt || q.bogi?.questionText) && (
        <p className="mb-4 text-base text-[#1A1A1A]">
          {q.passagePrompt && q.bogi?.questionText
            ? `${q.passagePrompt} ${q.bogi.questionText}`
            : q.passagePrompt || q.bogi?.questionText}
        </p>
      )}

      {/* OX 선지 분포 */}
      {q.type === 'ox' && oxDistribution && (() => {
        const total = oxDistribution.o + oxDistribution.x;
        const correctAnswer = String(q.answer) === '0' ? 'O' : 'X';
        const oPct = total > 0 ? Math.round((oxDistribution.o / total) * 100) : 0;
        const xPct = total > 0 ? Math.round((oxDistribution.x / total) * 100) : 0;

        return (
          <div className="flex gap-4 justify-center py-3 mb-4">
            {['O', 'X'].map((opt) => {
              const isCorrect = opt === correctAnswer;
              const percentage = opt === 'O' ? oPct : xPct;

              if (isCorrect) {
                return (
                  <div key={opt} className="relative w-24 h-24 text-4xl font-bold border-2 border-[#1A6B1A] flex flex-col items-center justify-center overflow-hidden bg-[#EDEAE4]">
                    {percentage > 0 && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${percentage}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                        className="absolute left-0 right-0 bottom-0 bg-[#E8F5E9]"
                      />
                    )}
                    <span className="relative z-10 text-[#1A6B1A]">{opt}</span>
                    <span className="relative z-10 text-sm font-normal mt-1 text-[#1A6B1A]">{percentage}%</span>
                  </div>
                );
              }
              return (
                <div key={opt} className="relative w-24 h-24 text-4xl font-bold border-2 border-[#8B1A1A] flex flex-col items-center justify-center overflow-hidden bg-[#EDEAE4]">
                  {percentage > 0 && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${percentage}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
                      className="absolute left-0 right-0 bottom-0 bg-[#FDEAEA]"
                    />
                  )}
                  <span className="relative z-10 text-[#8B1A1A]">{opt}</span>
                  <span className="relative z-10 text-sm font-normal mt-1 text-[#8B1A1A]">{percentage}%</span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* 객관식 선지 분포 */}
      {q.type === 'multiple' && optionDistribution && (
        <div className="space-y-2 mb-4">
          {optionDistribution.map((opt, optIdx) => {
            const isHighestWrong = !opt.isCorrect && opt.percentage === maxWrongPct && maxWrongPct > 0;

            if (opt.isCorrect) {
              return (
                <div key={optIdx} className="relative flex items-center gap-3 p-3 border-2 border-[#1A6B1A] overflow-hidden" style={{ backgroundColor: '#F5F0E8' }}>
                  {opt.percentage > 0 && (
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${opt.percentage}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 + optIdx * 0.05 }}
                      className="absolute left-0 top-0 bottom-0 bg-[#E8F5E9]"
                    />
                  )}
                  <span className="relative z-10 text-lg font-bold min-w-[24px] text-[#1A6B1A]">{optIdx + 1}.</span>
                  <span className="relative z-10 flex-1 text-lg text-[#1A1A1A]">{opt.option}</span>
                  <span className="relative z-10 text-lg font-bold text-[#1A6B1A]">{opt.percentage}%</span>
                </div>
              );
            }

            return (
              <div key={optIdx} className={`relative flex items-center gap-3 p-3 border-2 overflow-hidden ${isHighestWrong ? 'border-[#8B1A1A]' : 'border-[#D4CFC4]'}`} style={{ backgroundColor: '#F5F0E8' }}>
                {opt.percentage > 0 && (
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${opt.percentage}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 + optIdx * 0.05 }}
                    className="absolute left-0 top-0 bottom-0 bg-[#FDEAEA]"
                  />
                )}
                <span className={`relative z-10 text-lg font-bold min-w-[24px] ${isHighestWrong ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'}`}>{optIdx + 1}.</span>
                <span className="relative z-10 flex-1 text-lg text-[#1A1A1A]">{opt.option}</span>
                <span className={`relative z-10 text-lg font-bold ${isHighestWrong ? 'text-[#8B1A1A]' : 'text-[#5C5C5C]'}`}>{opt.percentage}%</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 주관식 정답/오답 */}
      {(q.type === 'short_answer' || q.type === 'subjective' || (q.type as string) === 'short') && (
        <div className="space-y-3 mb-4">
          <div className="p-3 bg-[#E8F5E9] border-2 border-[#1A6B1A]">
            <span className="text-base text-[#1A6B1A] font-bold">정답: </span>
            <span className="text-base text-[#1A6B1A]">
              {String(q.answer ?? '').includes('|||')
                ? String(q.answer).split('|||').map(a => a.trim()).join(', ')
                : String(q.answer ?? '-')}
            </span>
          </div>
          {stats?.wrongAnswers && stats.wrongAnswers.length > 0 && (
            <div className="p-3 bg-[#FDEAEA] border-2 border-[#8B1A1A]">
              <span className="text-base text-[#8B1A1A] font-bold">오답: </span>
              <span className="text-base text-[#8B1A1A]">
                {stats.wrongAnswers.slice(0, 5).join(', ')}
                {stats.wrongAnswers.length > 5 && ` 외 ${stats.wrongAnswers.length - 5}개`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* OX/객관식 선지 분포가 없을 때 (통계 없는 경우) 기본 표시 */}
      {q.type === 'ox' && !oxDistribution && (
        <div className="flex gap-4 justify-center py-3 mb-4">
          {['O', 'X'].map((opt, idx) => {
            const isCorrect = Number(q.answer) === idx;
            return (
              <div key={opt} className={`w-24 h-24 text-4xl font-bold border-2 flex items-center justify-center ${
                isCorrect ? 'bg-[#E8F5E9] border-[#1A6B1A] text-[#1A6B1A]' : 'bg-[#EDEAE4] border-[#D4CFC4] text-[#5C5C5C]'
              }`}>
                {opt}
              </div>
            );
          })}
        </div>
      )}

      {q.type === 'multiple' && !optionDistribution && q.choices && (
        <div className="space-y-2 mb-4">
          {q.choices.map((choice, idx) => {
            const isCorrect = Number(q.answer) === idx;
            return (
              <div key={idx} className={`flex items-center gap-3 p-3 border-2 ${
                isCorrect ? 'bg-[#E8F5E9] border-[#1A6B1A]' : 'border-[#D4CFC4] bg-[#F5F0E8]'
              }`}>
                <span className={`text-base font-bold min-w-[24px] ${isCorrect ? 'text-[#1A6B1A]' : 'text-[#5C5C5C]'}`}>{idx + 1}.</span>
                <span className="flex-1 text-base text-[#1A1A1A]">{choice}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 다운로드 옵션 모달
// ============================================================

function DownloadOptionsModal({
  onClose,
  onDownload,
}: {
  onClose: () => void;
  onDownload: (includeAnswers: boolean, includeExplanations: boolean, format: 'pdf' | 'docx') => void;
}) {
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [includeExplanations, setIncludeExplanations] = useState(true);
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs bg-[#F5F0E8] border-2 border-[#1A1A1A] p-5"
      >
        <h3 className="text-lg font-bold text-[#1A1A1A] mb-4">다운로드 옵션</h3>

        {/* 형식 선택 */}
        <div className="mb-4">
          <p className="text-xs font-bold text-[#5C5C5C] mb-2">형식</p>
          <div className="flex gap-2">
            <button
              onClick={() => setFormat('pdf')}
              className={`flex-1 py-2 text-sm font-bold border transition-colors ${
                format === 'pdf'
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              PDF
              <span className="block text-[10px] font-normal mt-0.5 opacity-70">수능 스타일</span>
            </button>
            <button
              onClick={() => setFormat('docx')}
              className={`flex-1 py-2 text-sm font-bold border transition-colors ${
                format === 'docx'
                  ? 'bg-[#1A1A1A] text-[#F5F0E8] border-[#1A1A1A]'
                  : 'border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4]'
              }`}
            >
              DOCX
              <span className="block text-[10px] font-normal mt-0.5 opacity-70">편집용</span>
            </button>
          </div>
        </div>

        <label className="flex items-center gap-3 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={includeAnswers}
            onChange={(e) => setIncludeAnswers(e.target.checked)}
            className="w-4 h-4 accent-[#1A1A1A]"
          />
          <span className="text-sm text-[#1A1A1A]">정답 포함</span>
        </label>

        <label className="flex items-center gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={includeExplanations}
            onChange={(e) => setIncludeExplanations(e.target.checked)}
            className="w-4 h-4 accent-[#1A1A1A]"
          />
          <span className="text-sm text-[#1A1A1A]">해설 포함</span>
        </label>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-bold border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#EDEAE4] transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => onDownload(includeAnswers, includeExplanations, format)}
            className="flex-1 py-2.5 text-sm font-bold bg-[#1A1A1A] text-[#F5F0E8] hover:bg-[#333] transition-colors"
          >
            다운로드
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

// ============================================================
// 메인 페이지
// ============================================================

export default function BestQPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userCourseId } = useCourse();
  const { fetchQuiz, fetchQuizStatistics } = useProfessorQuiz();

  // 탭 (URL 파라미터로 초기값 결정)
  const [activeTab, setActiveTab] = useState<'library' | 'custom'>(
    searchParams.get('tab') === 'custom' ? 'custom' : 'library'
  );

  // 피드백 탭
  const [bestQuestions, setBestQuestions] = useState<BestQuestionData[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  // 커스텀 탭
  const {
    customFolders,
    createCustomFolder,
    deleteCustomFolder,
    addToCustomFolder,
  } = useCustomFolders();
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [folderQuestions, setFolderQuestions] = useState<BestQuestionData[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderCurrentIndex, setFolderCurrentIndex] = useState(0);
  const [deleteMode, setDeleteMode] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // 폴더 삭제 확인 모달
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteFolderLoading, setDeleteFolderLoading] = useState(false);

  // 다운로드
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadFolderIds, setDownloadFolderIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  // 폴더 저장 모달 (피드백탭에서)
  const [showFolderSaveModal, setShowFolderSaveModal] = useState(false);
  const [folderSaveToast, setFolderSaveToast] = useState<string | null>(null);

  // 스와이프 refs
  const contentRef = useRef<HTMLDivElement>(null);
  const slideEnterFromRef = useRef<'left' | 'right' | null>(null);
  const swipeTransitioning = useRef(false);
  const swipeRef = useRef({
    startX: 0, startY: 0,
    direction: 'none' as 'none' | 'horizontal' | 'vertical',
    offsetX: 0,
  });

  // 마우스 스와이프 refs (PC)
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);

  // 숫자 바 스크롤 ref
  const paginationRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // ============================================================
  // 스와이프 핸들러
  // ============================================================

  const getActiveIndex = () => openFolderId ? folderCurrentIndex : currentIndex;
  const getActiveTotal = () => openFolderId ? folderQuestions.length : bestQuestions.length;
  const setActiveIndex = useCallback((idx: number) => {
    if (openFolderId) setFolderCurrentIndex(idx);
    else setCurrentIndex(idx);
  }, [openFolderId]);

  const handleSwipeStart = useCallback((clientX: number, clientY: number) => {
    if (swipeTransitioning.current) return;
    const s = swipeRef.current;
    s.startX = clientX;
    s.startY = clientY;
    s.direction = 'none';
    s.offsetX = 0;
  }, []);

  const handleSwipeMove = useCallback((clientX: number, clientY: number) => {
    if (swipeTransitioning.current) return;
    const s = swipeRef.current;
    const deltaX = clientX - s.startX;
    const deltaY = clientY - s.startY;

    if (s.direction === 'none') {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return;
      s.direction = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }

    if (s.direction !== 'horizontal' || !contentRef.current) return;

    const total = getActiveTotal();
    const idx = getActiveIndex();
    const isAtStart = idx === 0;
    const isAtEnd = idx >= total - 1;

    if ((isAtStart && deltaX > 0) || (isAtEnd && deltaX < 0)) {
      s.offsetX = deltaX * 0.15;
    } else {
      s.offsetX = deltaX * 0.5;
    }

    contentRef.current.style.transition = 'none';
    contentRef.current.style.transform = `translateX(${s.offsetX}px)`;
  }, [getActiveTotal, getActiveIndex]);

  const handleSwipeEnd = useCallback(() => {
    const s = swipeRef.current;
    if (s.direction !== 'horizontal' || !contentRef.current) {
      s.direction = 'none';
      return;
    }

    const el = contentRef.current;
    const deltaX = s.offsetX;
    s.direction = 'none';

    const SWIPE_THRESHOLD = 60;
    const total = getActiveTotal();
    const idx = getActiveIndex();

    if (deltaX < -SWIPE_THRESHOLD && idx < total - 1) {
      swipeTransitioning.current = true;
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = `translateX(${-el.offsetWidth}px)`;
      setTimeout(() => {
        slideEnterFromRef.current = 'right';
        setActiveIndex(idx + 1);
      }, 200);
      return;
    }

    if (deltaX > SWIPE_THRESHOLD && idx > 0) {
      swipeTransitioning.current = true;
      el.style.transition = 'transform 200ms ease-out';
      el.style.transform = `translateX(${el.offsetWidth}px)`;
      setTimeout(() => {
        slideEnterFromRef.current = 'left';
        setActiveIndex(idx - 1);
      }, 200);
      return;
    }

    el.style.transition = 'transform 250ms cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'translateX(0)';
  }, [getActiveTotal, getActiveIndex, setActiveIndex]);

  // 터치 핸들러
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    handleSwipeStart(e.touches[0].clientX, e.touches[0].clientY);
  }, [handleSwipeStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    handleSwipeMove(e.touches[0].clientX, e.touches[0].clientY);
  }, [handleSwipeMove]);

  // 마우스 핸들러 (PC)
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    mouseStartRef.current = { x: e.clientX, y: e.clientY };
    handleSwipeStart(e.clientX, e.clientY);
  }, [handleSwipeStart]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!mouseStartRef.current) return;
    handleSwipeMove(e.clientX, e.clientY);
  }, [handleSwipeMove]);

  const onMouseUp = useCallback(() => {
    if (!mouseStartRef.current) return;
    mouseStartRef.current = null;
    handleSwipeEnd();
  }, [handleSwipeEnd]);

  const onMouseLeave = useCallback(() => {
    if (!mouseStartRef.current) return;
    mouseStartRef.current = null;
    handleSwipeEnd();
  }, [handleSwipeEnd]);

  // 슬라이드 인 애니메이션
  useEffect(() => {
    const enterFrom = slideEnterFromRef.current;
    if (!enterFrom || !contentRef.current) return;
    slideEnterFromRef.current = null;

    const el = contentRef.current;
    el.style.transition = 'none';
    el.style.transform = enterFrom === 'right' ? 'translateX(100%)' : 'translateX(-100%)';
    // reflow
    el.getBoundingClientRect();
    el.style.transition = 'transform 250ms cubic-bezier(0.25, 0.1, 0.25, 1)';
    el.style.transform = 'translateX(0)';

    const cleanup = () => {
      el.style.transition = '';
      el.style.transform = '';
      swipeTransitioning.current = false;
    };
    el.addEventListener('transitionend', cleanup, { once: true });
    const timer = setTimeout(cleanup, 350);
    return () => clearTimeout(timer);
  }, [currentIndex, folderCurrentIndex]);

  // ============================================================
  // BEST Q 실시간 구독 (피드백탭)
  // ============================================================

  // 퀴즈 캐시 (구독 간 공유)
  const quizCacheRef = useRef<Record<string, { questions: QuizQuestion[] } | null>>({});
  const statsCacheRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (!userCourseId) return;

    const unsubscribes: (() => void)[] = [];
    let isFirstLoad = true;
    // 청크별 피드백 데이터 저장
    const chunkData: Record<number, { id: string; data: any }[]> = {};
    let quizTitleMap: Record<string, string> = {};

    // 피드백 데이터 → BEST Q 계산 + 문제/통계 로드
    const processFeedbacks = async () => {
      try {
        const byQuestion: Record<string, {
          quizId: string;
          questionId: string;
          questionNumber: number;
          feedbacks: { type: FeedbackType }[];
          rawFeedbacks: FeedbackItem[];
        }> = {};

        // 모든 청크 합침
        Object.values(chunkData).flat().forEach(({ id, data }) => {
          const key = `${data.quizId}_${data.questionId}`;
          if (!byQuestion[key]) {
            byQuestion[key] = {
              quizId: data.quizId,
              questionId: data.questionId,
              questionNumber: data.questionNumber || 0,
              feedbacks: [],
              rawFeedbacks: [],
            };
          }
          byQuestion[key].feedbacks.push({ type: data.type as FeedbackType });
          byQuestion[key].rawFeedbacks.push({
            id,
            userId: data.userId,
            quizId: data.quizId,
            questionId: data.questionId,
            questionNumber: data.questionNumber || 0,
            type: (data.type || data.feedbackType) as FeedbackType,
            content: data.content || data.feedback || '',
            createdAt: data.createdAt,
          });
        });

        const ranked = Object.values(byQuestion)
          .map(item => ({
            quizId: item.quizId,
            quizTitle: quizTitleMap[item.quizId] || '퀴즈',
            questionId: item.questionId,
            questionIndex: item.questionNumber,
            score: calcFeedbackScore(item.feedbacks),
            feedbackCount: item.feedbacks.length,
            rawFeedbacks: item.rawFeedbacks,
          }))
          .filter(item => item.feedbackCount >= 1)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);

        const results: BestQuestionData[] = [];
        const cache = quizCacheRef.current;

        for (const item of ranked) {
          if (!(item.quizId in cache)) {
            const quizData = await fetchQuiz(item.quizId);
            cache[item.quizId] = quizData ? { questions: quizData.questions } : null;
          }

          const cached = cache[item.quizId];
          let question: RichQuestion | null = null;

          if (cached) {
            let found: any = cached.questions.find(q => q.id === item.questionId) || null;
            if (!found) {
              for (const parentQ of cached.questions) {
                if ((parentQ as any).type === 'combined' && (parentQ as any).subQuestions) {
                  const sub = (parentQ as any).subQuestions.find((sq: any) => sq.id === item.questionId);
                  if (sub) { found = sub; break; }
                }
              }
            }
            if (!found && cached.questions.length > 0) {
              const idx1 = item.questionIndex - 1;
              const idx0 = item.questionIndex;
              if (idx1 >= 0 && idx1 < cached.questions.length) {
                found = cached.questions[idx1];
              } else if (idx0 >= 0 && idx0 < cached.questions.length) {
                found = cached.questions[idx0];
              } else {
                found = cached.questions[0];
              }
            }
            question = found as RichQuestion | null;
          }

          let stats: QuestionStats | null = null;
          if (cached) {
            // 통계 캐시 활용 (같은 quizId면 재사용)
            if (!statsCacheRef.current[item.quizId]) {
              statsCacheRef.current[item.quizId] = await fetchQuizStatistics(item.quizId, cached.questions);
            }
            const fullStats = statsCacheRef.current[item.quizId];
            if (fullStats) {
              const byId = fullStats.questionStats.find((s: QuestionStats) => s.questionId === item.questionId);
              if (byId) {
                stats = byId;
              } else {
                const idx1 = item.questionIndex - 1;
                const idx0 = item.questionIndex;
                if (idx1 >= 0 && idx1 < fullStats.questionStats.length) {
                  stats = fullStats.questionStats[idx1];
                } else if (idx0 >= 0 && idx0 < fullStats.questionStats.length) {
                  stats = fullStats.questionStats[idx0];
                }
              }
            }
          }

          results.push({
            quizId: item.quizId,
            quizTitle: item.quizTitle,
            questionId: item.questionId,
            questionIndex: item.questionIndex > 0 ? item.questionIndex - 1 : 0,
            score: item.score,
            feedbackCount: item.feedbackCount,
            question,
            stats,
            feedbacks: item.rawFeedbacks,
          });
        }

        setBestQuestions(results);
        if (isFirstLoad) {
          setCurrentIndex(0);
          isFirstLoad = false;
        }
      } catch (err) {
        console.error('BEST Q 로드 실패:', err);
      } finally {
        setFeedbackLoading(false);
      }
    };

    // 초기 설정: 퀴즈 목록 가져오고 피드백 구독
    const setup = async () => {
      setFeedbackLoading(true);
      try {
        const quizQ = query(
          collection(db, 'quizzes'),
          where('courseId', '==', userCourseId)
        );
        const quizSnap = await getDocs(quizQ);
        const quizIds: string[] = [];
        quizTitleMap = {};
        quizSnap.docs.forEach(d => {
          quizIds.push(d.id);
          quizTitleMap[d.id] = d.data().title || '퀴즈';
        });

        if (quizIds.length === 0) {
          setBestQuestions([]);
          setFeedbackLoading(false);
          return;
        }

        // 피드백 실시간 구독 (30개씩 청크)
        for (let i = 0; i < quizIds.length; i += 30) {
          const chunkIdx = Math.floor(i / 30);
          const chunk = quizIds.slice(i, i + 30);
          const fbQ = query(
            collection(db, 'questionFeedbacks'),
            where('quizId', 'in', chunk)
          );

          const unsub = onSnapshot(fbQ, (snapshot) => {
            chunkData[chunkIdx] = snapshot.docs.map(d => ({
              id: d.id,
              data: d.data(),
            }));
            // 통계 캐시 초기화 (피드백 변경 시 다시 계산)
            statsCacheRef.current = {};
            processFeedbacks();
          });

          unsubscribes.push(unsub);
        }

        // quizResults 실시간 구독 (30개씩 청크) — 학생 풀이 시 통계 갱신
        for (let i = 0; i < quizIds.length; i += 30) {
          const chunk = quizIds.slice(i, i + 30);
          const resultsQ = query(
            collection(db, 'quizResults'),
            where('quizId', 'in', chunk)
          );

          let isFirst = true;
          const unsub = onSnapshot(resultsQ, () => {
            // 초기 스냅샷은 스킵 (피드백 구독에서 이미 processFeedbacks 호출)
            if (isFirst) {
              isFirst = false;
              return;
            }
            // 통계 캐시 초기화 후 재계산
            statsCacheRef.current = {};
            processFeedbacks();
          });

          unsubscribes.push(unsub);
        }
      } catch (err) {
        console.error('BEST Q 구독 설정 실패:', err);
        setFeedbackLoading(false);
      }
    };

    setup();

    return () => {
      unsubscribes.forEach(fn => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCourseId]);

  // ============================================================
  // 커스텀 폴더 열기 (문제 로드)
  // ============================================================

  const openFolder = useCallback(async (folder: CustomFolder) => {
    setOpenFolderId(folder.id);
    setFolderLoading(true);
    setFolderCurrentIndex(0);

    try {
      const results: BestQuestionData[] = [];
      const quizCache: Record<string, { questions: QuizQuestion[] } | null> = {};

      for (const q of folder.questions) {
        if (!(q.quizId in quizCache)) {
          const quizData = await fetchQuiz(q.quizId);
          quizCache[q.quizId] = quizData ? { questions: quizData.questions } : null;
        }

        const cached = quizCache[q.quizId];
        let question: RichQuestion | null = null;

        if (cached) {
          // 1) ID 기반 검색 (최상위)
          let found: any = cached.questions.find(qq => qq.id === q.questionId) || null;
          // 2) 결합형 하위 문제에서도 검색
          if (!found) {
            for (const parentQ of cached.questions) {
              if ((parentQ as any).type === 'combined' && (parentQ as any).subQuestions) {
                const sub = (parentQ as any).subQuestions.find((sq: any) => sq.id === q.questionId);
                if (sub) { found = sub; break; }
              }
            }
          }
          // 3) "q0","q1" 형식이면 인덱스 기반 fallback
          if (!found && cached.questions.length > 0) {
            const match = q.questionId.match(/^q(\d+)$/);
            if (match) {
              const idx = parseInt(match[1], 10);
              if (idx >= 0 && idx < cached.questions.length) {
                found = cached.questions[idx];
              }
            }
            // 그래도 못 찾으면 첫 번째 문제
            if (!found) {
              found = cached.questions[0];
            }
          }
          question = found as RichQuestion | null;
        }

        // questionId 기반으로 통계 조회
        let stats: QuestionStats | null = null;
        if (cached) {
          const fullStats = await fetchQuizStatistics(q.quizId, cached.questions);
          if (fullStats) {
            // ID 매칭 우선, 없으면 인덱스 fallback
            stats = fullStats.questionStats.find(s => s.questionId === q.questionId) || null;
            if (!stats) {
              const match = q.questionId.match(/^q(\d+)$/);
              if (match) {
                const idx = parseInt(match[1], 10);
                if (idx >= 0 && idx < fullStats.questionStats.length) {
                  stats = fullStats.questionStats[idx];
                }
              }
            }
          }
        }

        results.push({
          quizId: q.quizId,
          quizTitle: q.quizTitle,
          questionId: q.questionId,
          questionIndex: 0, // 표시용
          score: 0,
          feedbackCount: 0,
          question,
          stats,
          feedbacks: [],
        });
      }

      setFolderQuestions(results);
    } catch (err) {
      console.error('폴더 문제 로드 실패:', err);
    } finally {
      setFolderLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchQuiz, fetchQuizStatistics]);

  // URL ?folder=xxx 파라미터로 진입 시 자동 폴더 열기
  const folderParamHandled = useRef(false);
  useEffect(() => {
    if (folderParamHandled.current) return;
    const folderId = searchParams.get('folder');
    if (!folderId || customFolders.length === 0) return;

    const folder = customFolders.find(f => f.id === folderId);
    if (folder) {
      folderParamHandled.current = true;
      setActiveTab('custom');
      openFolder(folder);
    }
  }, [searchParams, customFolders, openFolder]);

  // 선택된 번호를 스크롤 중앙으로 이동
  useEffect(() => {
    const idx = openFolderId ? folderCurrentIndex : currentIndex;
    const btn = buttonRefs.current[idx];
    if (btn && paginationRef.current) {
      const container = paginationRef.current;
      const scrollLeft = btn.offsetLeft - container.clientWidth / 2 + btn.clientWidth / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  }, [currentIndex, folderCurrentIndex, openFolderId]);

  // ============================================================
  // 피드백탭에서 폴더 저장
  // ============================================================

  const handleFolderSave = async (folderId: string) => {
    const current = bestQuestions[currentIndex];
    if (!current) return;

    // 중복 체크
    const folder = customFolders.find(f => f.id === folderId);
    if (folder?.questions.some(q => q.questionId === current.questionId && q.quizId === current.quizId)) {
      setShowFolderSaveModal(false);
      setFolderSaveToast('이미 추가된 문제입니다');
      setTimeout(() => setFolderSaveToast(null), 2000);
      return;
    }

    try {
      await addToCustomFolder(folderId, [{
        questionId: current.questionId,
        quizId: current.quizId,
        quizTitle: current.quizTitle,
        combinedGroupId: null,
      }]);
      setShowFolderSaveModal(false);
      setFolderSaveToast('폴더에 추가되었습니다');
      setTimeout(() => setFolderSaveToast(null), 2000);
    } catch {
      setFolderSaveToast('추가에 실패했습니다');
      setTimeout(() => setFolderSaveToast(null), 2000);
    }
  };

  // ============================================================
  // 다운로드 핸들러
  // ============================================================

  const handleDownload = async (includeAnswers: boolean, includeExplanations: boolean, format: 'pdf' | 'docx' = 'docx') => {
    setShowDownloadModal(false);

    // 선택된 폴더들의 문제 수집
    const selectedFolders = customFolders.filter(f => downloadFolderIds.has(f.id));
    if (selectedFolders.length === 0) return;

    try {
      const allQuestions: QuestionExportData[] = [];
      const quizCache: Record<string, any> = {};

      for (const folder of selectedFolders) {
        for (const q of folder.questions) {
          if (!(q.quizId in quizCache)) {
            const quizDoc = await getDoc(doc(db, 'quizzes', q.quizId));
            quizCache[q.quizId] = quizDoc.exists() ? quizDoc.data() : null;
          }

          const quizData = quizCache[q.quizId];
          if (!quizData) continue;

          // ID 매칭 → 결합형 하위 → 인덱스 fallback
          let question = quizData.questions?.find((qq: any) => qq.id === q.questionId) || null;
          if (!question) {
            for (const parentQ of (quizData.questions || [])) {
              if (parentQ.type === 'combined' && parentQ.subQuestions) {
                const sub = parentQ.subQuestions.find((sq: any) => sq.id === q.questionId);
                if (sub) { question = sub; break; }
              }
            }
          }
          if (!question) {
            const match = q.questionId.match(/^q(\d+)$/);
            if (match) {
              const idx = parseInt(match[1], 10);
              if (idx >= 0 && idx < (quizData.questions?.length || 0)) {
                question = quizData.questions[idx];
              }
            }
          }
          if (!question) continue;

          allQuestions.push({
            text: question.text || '',
            type: question.type || 'multiple',
            choices: question.choices,
            answer: String(question.answer ?? ''),
            explanation: question.explanation,
            imageUrl: question.imageUrl,
            passage: question.passage,
            passageType: question.passageType,
            koreanAbcItems: question.koreanAbcItems,
            bogi: question.bogi,
            passagePrompt: question.passagePrompt,
            hasMultipleAnswers: question.hasMultipleAnswers,
          });
        }
      }

      if (allQuestions.length === 0) return;

      const folderName = selectedFolders.length === 1
        ? selectedFolders[0].name
        : `${selectedFolders[0].name} 외 ${selectedFolders.length - 1}개`;

      if (format === 'pdf') {
        const { exportQuestionsToPdf } = await import('@/lib/utils/questionPdfExport');
        await exportQuestionsToPdf(allQuestions, {
          includeAnswers,
          includeExplanations,
          folderName,
        });
      } else {
        const { exportQuestionsToDocx } = await import('@/lib/utils/questionDocExport');
        await exportQuestionsToDocx(allQuestions, {
          includeAnswers,
          includeExplanations,
          folderName,
        });
      }
    } catch (err) {
      console.error('다운로드 실패:', err);
    }

    setSelectMode(false);
    setDownloadFolderIds(new Set());
  };

  // ============================================================
  // 렌더링 헬퍼
  // ============================================================

  const activeQuestions = openFolderId ? folderQuestions : bestQuestions;
  const activeIndex = openFolderId ? folderCurrentIndex : currentIndex;
  const total = activeQuestions.length;
  const current = activeQuestions[activeIndex] || null;
  const isLoading = openFolderId ? folderLoading : false;

  // ============================================================
  // JSX
  // ============================================================

  return (
    <div className="min-h-screen bg-[#F5F0E8] flex flex-col">
      {/* 헤더 */}
      <header className="px-4 pt-4 pb-4 flex items-center gap-3">
        <button
          onClick={() => {
            if (openFolderId) {
              setOpenFolderId(null);
              setFolderQuestions([]);
            } else {
              router.back();
            }
          }}
          className="flex items-center gap-2 text-sm text-[#1A1A1A] hover:text-[#5C5C5C] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          뒤로가기
        </button>
        {/* 폴더 열기 상태일 때만 폴더 이름 (중앙 배치) */}
        {openFolderId && (
          <>
            <span className="flex-1 text-center text-lg font-bold text-[#1A1A1A] truncate">
              {customFolders.find(f => f.id === openFolderId)?.name || 'FOLDER'}
            </span>
            {/* 뒤로가기 버튼과 균형을 맞추기 위한 빈 공간 */}
            <div className="w-[72px]" />
          </>
        )}
        {!openFolderId && <div className="flex-1" />}
      </header>

      {/* 탭 필터 + 액션 버튼 (폴더 열려있지 않을 때만) */}
      {!openFolderId && (
        <div className="flex items-center justify-between mx-4 mt-2 mb-2">
          {/* 탭 필터 - 좌측 */}
          <div className="relative border border-[#1A1A1A] flex">
            <div
              className="absolute top-0 bottom-0 w-1/2 bg-[#1A1A1A] transition-transform duration-200"
              style={{
                transform: activeTab === 'custom'
                  ? 'translateX(100%)'
                  : 'translateX(0)',
              }}
            />
            {(['library', 'custom'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2.5 text-sm font-bold relative z-10 transition-colors ${
                  activeTab === tab ? 'text-[#F5F0E8]' : 'text-[#5C5C5C]'
                }`}
              >
                {tab === 'library' ? '서재' : '커스텀'}
              </button>
            ))}
          </div>

          {/* 다운로드/삭제 아이콘 버튼 - 우측 */}
          {activeTab === 'custom' && (
            <div className="flex gap-1 flex-shrink-0">
              {/* 다운로드 버튼 */}
              <button
                onClick={() => {
                  setSelectMode(!selectMode);
                  setDownloadFolderIds(new Set());
                }}
                className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                  selectMode
                    ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                    : 'text-[#5C5C5C] hover:bg-[#EDEAE4]'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              {/* 삭제 버튼 */}
              <button
                onClick={() => setDeleteMode(!deleteMode)}
                className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                  deleteMode
                    ? 'bg-[#1A1A1A] text-[#F5F0E8]'
                    : 'text-[#5C5C5C] hover:bg-[#EDEAE4]'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 서재 탭 */}
      {/* ============================================================ */}
      {activeTab === 'library' && !openFolderId && (
        <ProfessorLibraryTab />
      )}

      {/* ============================================================ */}
      {/* 커스텀 탭 (폴더 목록) */}
      {/* ============================================================ */}
      {activeTab === 'custom' && !openFolderId && (
        <div className="flex-1 overflow-y-auto px-4 pb-8">

          {/* 새 폴더 입력 */}
          {showNewFolderInput && (
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && newFolderName.trim()) {
                    await createCustomFolder(newFolderName.trim());
                    setNewFolderName('');
                    setShowNewFolderInput(false);
                  } else if (e.key === 'Escape') {
                    setNewFolderName('');
                    setShowNewFolderInput(false);
                  }
                }}
                placeholder="폴더 이름"
                className="flex-1 px-3 py-2 border-2 border-[#1A1A1A] bg-[#FDFBF7] text-sm text-[#1A1A1A] placeholder-[#5C5C5C] outline-none"
              />
              <button
                onClick={async () => {
                  if (newFolderName.trim()) {
                    await createCustomFolder(newFolderName.trim());
                    setNewFolderName('');
                    setShowNewFolderInput(false);
                  }
                }}
                className="px-3 py-2 border-2 border-[#1A1A1A] bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold"
              >
                만들기
              </button>
              <button
                onClick={() => { setNewFolderName(''); setShowNewFolderInput(false); }}
                className="px-3 py-2 border-2 border-[#D4CFC4] text-sm text-[#5C5C5C]"
              >
                취소
              </button>
            </div>
          )}

          {/* 폴더 그리드 */}
          <div className="grid grid-cols-3 gap-3 p-1">
            {/* 새 폴더 버튼 */}
            <button
              onClick={() => setShowNewFolderInput(true)}
              className="aspect-square border-2 border-dashed border-[#D4CFC4] flex flex-col items-center justify-center gap-2 hover:border-[#1A1A1A] transition-colors"
            >
              <svg className="w-8 h-8 text-[#5C5C5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-[10px] text-[#5C5C5C] font-bold">새 폴더</span>
            </button>

            {/* 폴더 목록 */}
            {customFolders.map((folder) => (
              <div
                key={folder.id}
                className="relative aspect-square flex flex-col items-center justify-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-transform duration-150"
                onClick={() => {
                  if (deleteMode) return;
                  if (selectMode) {
                    setDownloadFolderIds(prev => {
                      const next = new Set(prev);
                      if (next.has(folder.id)) next.delete(folder.id);
                      else next.add(folder.id);
                      return next;
                    });
                    return;
                  }
                  openFolder(folder);
                }}
              >
                {/* 선택 체크박스 */}
                {selectMode && (
                  <div className={`absolute top-0 right-0 w-5 h-5 border-2 flex items-center justify-center ${
                    downloadFolderIds.has(folder.id) ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'border-[#5C5C5C]'
                  }`}>
                    {downloadFolderIds.has(folder.id) && (
                      <svg className="w-3 h-3 text-[#F5F0E8]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                )}

                {/* 삭제 버튼 */}
                {deleteMode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteFolderTarget({ id: folder.id, name: folder.name });
                    }}
                    className="absolute top-0 right-0 w-6 h-6 flex items-center justify-center bg-[#8B1A1A] text-[#F5F0E8]"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}

                <svg className="w-20 h-20 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="text-sm font-bold text-[#1A1A1A] text-center px-1 truncate w-full">
                  {folder.name}
                </span>
                <span className="text-xs text-[#5C5C5C]">{folder.questions.length}문제</span>
              </div>
            ))}
          </div>

          {/* 선택모드 하단 다운로드 바 */}
          {selectMode && downloadFolderIds.size > 0 && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#F5F0E8] border-t-2 border-[#1A1A1A]">
              <button
                onClick={() => setShowDownloadModal(true)}
                className="w-full py-3 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold hover:bg-[#333] transition-colors"
              >
                {downloadFolderIds.size}개 폴더 다운로드
              </button>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* 폴더 열기 (스와이프 뷰) */}
      {/* ============================================================ */}
      {openFolderId && (
        <>
          {/* 메인 콘텐츠 */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {folderLoading ? (
              <div className="space-y-4 pt-4 px-4">
                <Skeleton className="h-12 rounded-none" />
                <Skeleton className="h-32 rounded-none" />
              </div>
            ) : folderQuestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <p className="text-lg font-bold text-[#1A1A1A] mb-2">폴더가 비어있습니다</p>
                <p className="text-sm text-[#5C5C5C]">문제 통계에서 문제를 추가해 보세요</p>
              </div>
            ) : current && (
              <>
              {/* 슬라이더 — 스와이프 영역 밖 */}
              {folderQuestions.length > 1 && (
                <div className="px-4 pt-3 pb-2 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-[#5C5C5C] flex-shrink-0">Q{folderCurrentIndex + 1}.</span>
                    <input
                      type="range"
                      min={0}
                      max={folderQuestions.length - 1}
                      value={folderCurrentIndex}
                      onChange={(e) => setFolderCurrentIndex(parseInt(e.target.value))}
                      className="w-full h-2 bg-[#D4CFC4] appearance-none cursor-pointer accent-[#1A1A1A]"
                      style={{
                        background: `linear-gradient(to right, #1A1A1A 0%, #1A1A1A ${(folderCurrentIndex / Math.max(folderQuestions.length - 1, 1)) * 100}%, #D4CFC4 ${(folderCurrentIndex / Math.max(folderQuestions.length - 1, 1)) * 100}%, #D4CFC4 100%)`
                      }}
                    />
                  </div>
                </div>
              )}
              {/* 스크롤 + 스와이프 영역 */}
              <div
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col cursor-grab active:cursor-grabbing select-none"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={handleSwipeEnd}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseLeave}
                style={{ touchAction: 'pan-y' }}
              >
                <div ref={contentRef} className="my-auto w-full">
                  {current.question ? (
                    <StatsQuestionView
                      question={current.question}
                      stats={current.stats}
                    />
                  ) : (
                    <div className="flex items-center justify-center p-8">
                      <p className="text-sm text-[#5C5C5C]">문제 내용을 불러올 수 없습니다</p>
                    </div>
                  )}
                </div>
              </div>
              </>
            )}
          </div>

          {/* 하단 페이지네이션 */}
          {folderQuestions.length > 0 && (
            <div
              ref={paginationRef}
              className="flex gap-3 px-4 py-4 overflow-x-auto scrollbar-hide border-t-2 border-[#1A1A1A] bg-[#F5F0E8] flex-shrink-0"
            >
              {folderQuestions.map((_, idx) => (
                <button
                  key={idx}
                  ref={el => { buttonRefs.current[idx] = el; }}
                  onClick={() => setFolderCurrentIndex(idx)}
                  className={`flex-shrink-0 w-11 h-11 flex items-center justify-center text-base font-bold border-2 transition-colors ${
                    idx === folderCurrentIndex
                      ? 'bg-[#1A1A1A] border-[#1A1A1A] text-[#F5F0E8]'
                      : 'bg-[#FDFBF7] border-[#D4CFC4] text-[#5C5C5C] hover:border-[#1A1A1A]'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/* 모달들 */}
      {/* ============================================================ */}

      {/* 폴더 저장 모달 */}
      <FolderSelectModal
        isOpen={showFolderSaveModal}
        onClose={() => setShowFolderSaveModal(false)}
        onSelect={handleFolderSave}
        folders={customFolders}
        onCreateFolder={createCustomFolder}
      />

      {/* 폴더 삭제 확인 모달 */}
      <AnimatePresence>
        {deleteFolderTarget && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* 백드롭 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteFolderTarget(null)}
              className="absolute inset-0 bg-black/50"
            />

            {/* 모달 */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 max-w-sm w-full shadow-xl"
            >
              <div className="text-center">
                {/* 경고 아이콘 */}
                <div className="flex justify-center mb-5">
                  <svg className="w-12 h-12 text-[#8B1A1A]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>

                {/* 메시지 */}
                <h3 className="text-xl font-bold text-[#1A1A1A] mb-2">
                  <span className="text-[#8B1A1A]">&ldquo;{deleteFolderTarget.name}&rdquo;</span>
                  <br />
                  폴더를 삭제하시겠습니까?
                </h3>

                <div className="text-xs text-[#1A1A1A] mb-6 space-y-0.5 text-left">
                  <p>• 삭제된 폴더는 복구할 수 없습니다.</p>
                  <p>• 폴더 안의 문제는 원본 퀴즈에서 다시 추가할 수 있습니다.</p>
                </div>

                {/* 버튼 */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setDeleteFolderTarget(null)}
                    disabled={deleteFolderLoading}
                    className="flex-1 py-3 font-bold text-sm border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        setDeleteFolderLoading(true);
                        await deleteCustomFolder(deleteFolderTarget.id);
                        setDeleteFolderTarget(null);
                        if (customFolders.length <= 1) {
                          setDeleteMode(false);
                        }
                      } catch (err) {
                        alert('폴더 삭제에 실패했습니다.');
                      } finally {
                        setDeleteFolderLoading(false);
                      }
                    }}
                    disabled={deleteFolderLoading}
                    className="flex-1 py-3 font-bold text-sm border-2 border-[#8B1A1A] bg-[#8B1A1A] text-white hover:bg-[#6B1414] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {deleteFolderLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        삭제 중...
                      </>
                    ) : '삭제'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 다운로드 옵션 모달 */}
      {showDownloadModal && (
        <DownloadOptionsModal
          onClose={() => setShowDownloadModal(false)}
          onDownload={handleDownload}
        />
      )}

      {/* 토스트 */}
      <AnimatePresence>
        {folderSaveToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-0 right-0 mx-auto w-fit z-[110] px-4 py-2 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-bold"
          >
            {folderSaveToast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
