'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCourse } from '@/lib/contexts';
import { formatChapterLabel } from '@/lib/courseIndex';

// ============================================================
// 타입
// ============================================================

interface PreviewQuestion {
  id: string;
  number: number;
  question: string;
  type: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  /** 결합형 그룹 ID */
  combinedGroupId?: string;
  combinedIndex?: number;
  combinedTotal?: number;
  /** 결합형 공통 지문 (첫 번째 문제에만) */
  passage?: string;
  passageType?: string;
  passageImage?: string;
  koreanAbcItems?: string[];
  passageMixedExamples?: any[];
  commonQuestion?: string;
  /** 문제 이미지 */
  image?: string;
  subQuestionOptions?: string[];
  subQuestionOptionsType?: 'text' | 'labeled' | 'mixed';
  mixedExamples?: any[];
  subQuestionImage?: string;
  chapterId?: string;
  chapterDetailId?: string;
  passagePrompt?: string;
  bogiQuestionText?: string;
  bogi?: {
    questionText?: string;
    items: Array<{ label: string; content: string }>;
  } | null;
  choiceExplanations?: string[];
  rubric?: Array<{ criteria: string; percentage: number; description?: string }>;
}

interface DisplayItem {
  type: 'single' | 'combined_group';
  result?: PreviewQuestion;
  results?: PreviewQuestion[];
  combinedGroupId?: string;
  displayNumber: number;
}

// ============================================================
// 미리보기 페이지
// ============================================================

export default function QuizPreviewPage() {
  const router = useRouter();
  const params = useParams();
  const { userCourseId } = useCourse();
  const quizId = params.id as string;

  const [quizTitle, setQuizTitle] = useState('');
  const [averageScore, setAverageScore] = useState(0);
  const [participantCount, setParticipantCount] = useState(0);
  const [questions, setQuestions] = useState<PreviewQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [expandedChoices, setExpandedChoices] = useState<Set<string>>(new Set());

  // 선지별 해설 접두사 제거
  const stripChoicePrefix = (text: string) =>
    text.replace(/^선지\s*\d+\s*해설\s*[:：]\s*/i, '');

  // 퀴즈 문서 로드
  useEffect(() => {
    if (!quizId) return;

    const loadQuiz = async () => {
      try {
        setIsLoading(true);
        const quizDoc = await getDoc(doc(db, 'quizzes', quizId));
        if (!quizDoc.exists()) {
          setError('퀴즈를 찾을 수 없습니다.');
          return;
        }

        const data = quizDoc.data();
        setQuizTitle(data.title || '퀴즈');
        setAverageScore(data.averageScore || 0);
        setParticipantCount(data.participantCount || 0);

        const rawQuestions = data.questions || [];
        const parsed: PreviewQuestion[] = rawQuestions.map((q: any, index: number) => {
          // 정답 변환
          let correctAnswer: string = '';
          if (q.correctAnswer !== undefined && q.correctAnswer !== null) {
            correctAnswer = String(q.correctAnswer);
          } else if (q.answer !== undefined && q.answer !== null) {
            if (q.type === 'multiple') {
              if (Array.isArray(q.answer)) {
                correctAnswer = q.answer.map((a: number) => String(a + 1)).join(',');
              } else if (typeof q.answer === 'number') {
                correctAnswer = String(q.answer + 1);
              } else {
                correctAnswer = String(q.answer);
              }
            } else if (q.type === 'ox') {
              correctAnswer = q.answer === 0 ? 'O' : 'X';
            } else if (q.type === 'essay') {
              correctAnswer = '';
            } else {
              correctAnswer = String(q.answer);
            }
          }

          const result: PreviewQuestion = {
            id: q.id || `q${index}`,
            number: index + 1,
            question: q.text || q.question || '',
            type: q.type,
            options: (q.choices || q.options || []).filter((opt: any) => opt != null),
            correctAnswer,
            explanation: q.explanation || '',
            rubric: q.rubric || undefined,
            image: q.image || q.imageUrl || null,
            subQuestionOptions: (() => {
              if (q.mixedExamples && Array.isArray(q.mixedExamples) && q.mixedExamples.length > 0) return null;
              if (Array.isArray(q.examples)) return q.examples.filter((item: any) => item != null);
              if (q.examples && typeof q.examples === 'object' && Array.isArray(q.examples.items)) {
                return q.examples.items.filter((item: any) => item != null);
              }
              if (q.koreanAbcExamples && Array.isArray(q.koreanAbcExamples)) {
                return q.koreanAbcExamples.map((e: { text: string }) => e.text).filter((text: any) => text != null);
              }
              return q.subQuestionOptions || null;
            })(),
            subQuestionOptionsType: (() => {
              if (q.mixedExamples && Array.isArray(q.mixedExamples) && q.mixedExamples.length > 0) return 'mixed';
              if (Array.isArray(q.examples)) return 'text';
              if (q.examples && typeof q.examples === 'object' && q.examples.type) return q.examples.type;
              if (q.koreanAbcExamples && Array.isArray(q.koreanAbcExamples)) return 'labeled';
              return null;
            })(),
            mixedExamples: q.mixedExamples || null,
            subQuestionImage: q.subQuestionImage || null,
            chapterId: q.chapterId || null,
            chapterDetailId: q.chapterDetailId || null,
            passagePrompt: q.passagePrompt || null,
            bogiQuestionText: q.bogi?.questionText || null,
            bogi: q.bogi ? {
              questionText: q.bogi.questionText,
              items: (q.bogi.items || []).map((item: any) => ({
                label: item.label,
                content: item.content,
              })),
            } : null,
            choiceExplanations: q.choiceExplanations || null,
          };

          // 결합형 필드
          if (q.combinedGroupId) {
            result.combinedGroupId = q.combinedGroupId;
            result.combinedIndex = q.combinedIndex;
            result.combinedTotal = q.combinedTotal;
            if (q.combinedIndex === 0) {
              result.passageType = q.passageType;
              result.passage = q.passage;
              result.passageImage = q.passageImage;
              result.koreanAbcItems = q.koreanAbcItems;
              result.commonQuestion = q.commonQuestion;
              result.passageMixedExamples = q.passageMixedExamples;
            }
          }

          return result;
        });

        setQuestions(parsed);
      } catch (err) {
        console.error('퀴즈 로드 오류:', err);
        setError('퀴즈를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    loadQuiz();
  }, [quizId]);

  // displayItems: 결합형 그룹 처리
  const displayItems = useMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = [];
    const processedGroupIds = new Set<string>();
    let displayNumber = 0;

    questions.forEach((q) => {
      if (q.combinedGroupId) {
        if (processedGroupIds.has(q.combinedGroupId)) return;
        processedGroupIds.add(q.combinedGroupId);
        const groupResults = questions.filter((r) => r.combinedGroupId === q.combinedGroupId);
        displayNumber++;
        items.push({
          type: 'combined_group',
          results: groupResults,
          combinedGroupId: q.combinedGroupId,
          displayNumber,
        });
      } else {
        displayNumber++;
        items.push({ type: 'single', result: q, displayNumber });
      }
    });

    return items;
  }, [questions]);

  const totalCount = questions.length;

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroupExpand = (groupId: string) => {
    setExpandedGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  // 문제 상세 렌더링
  const renderQuestionDetail = (q: PreviewQuestion) => {
    const groupedBlocks = q.mixedExamples?.filter(b => b.type === 'grouped') || [];
    const nonGroupedBlocks = q.mixedExamples?.filter(b => b.type !== 'grouped') || [];
    const hasMixedExamples = q.mixedExamples && q.mixedExamples.length > 0;

    return (
      <>
        {/* 묶은 보기 (grouped) */}
        {groupedBlocks.map((block: any) => (
          <div key={block.id} className="mb-3 p-3 border-2 border-[#1A1A1A] bg-[#FFF8E1]">
            <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
            <div className="space-y-1">
              {block.children?.map((child: any) => (
                <div key={child.id}>
                  {child.type === 'text' && child.content?.trim() && (
                    <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>
                  )}
                  {child.type === 'labeled' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                    <p key={item.id} className="text-sm text-[#1A1A1A]">
                      <span className="font-bold">{item.label}.</span> {item.content}
                    </p>
                  ))}
                  {child.type === 'gana' && (child.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                    <p key={item.id} className="text-sm text-[#1A1A1A]">
                      <span className="font-bold">({item.label})</span> {item.content}
                    </p>
                  ))}
                  {child.type === 'image' && child.imageUrl && (
                    <img src={child.imageUrl} alt="보기 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 나머지 제시문 */}
        {nonGroupedBlocks.map((block: any) => {
          if (block.type === 'text' && block.content?.trim()) {
            return (
              <div key={block.id} className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
                <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>
              </div>
            );
          }
          if (block.type === 'labeled') {
            return (
              <div key={block.id} className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
                <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                <div className="space-y-1">
                  {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                    <p key={item.id} className="text-sm text-[#1A1A1A]">
                      <span className="font-bold">{item.label}.</span> {item.content}
                    </p>
                  ))}
                </div>
              </div>
            );
          }
          if (block.type === 'gana') {
            return (
              <div key={block.id} className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
                <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
                <div className="space-y-1">
                  {(block.items || []).filter((i: any) => i.content?.trim()).map((item: any) => (
                    <p key={item.id} className="text-sm text-[#1A1A1A]">
                      <span className="font-bold">({item.label})</span> {item.content}
                    </p>
                  ))}
                </div>
              </div>
            );
          }
          return null;
        })}

        {/* 레거시 보기 - 텍스트 */}
        {!hasMixedExamples && q.subQuestionOptions && q.subQuestionOptions.length > 0 && q.subQuestionOptionsType === 'text' && (
          <div className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
            <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
            <p className="text-sm text-[#1A1A1A]">{q.subQuestionOptions.join(', ')}</p>
          </div>
        )}

        {/* 레거시 보기 - ㄱㄴㄷ */}
        {!hasMixedExamples && q.subQuestionOptions && q.subQuestionOptions.length > 0 && q.subQuestionOptionsType === 'labeled' && (
          <div className="mb-3 p-3 border border-[#8B6914] bg-[#FFF8E1]">
            <p className="text-xs font-bold text-[#8B6914] mb-2">지문</p>
            <div className="space-y-1">
              {q.subQuestionOptions.map((itm, idx) => (
                <p key={idx} className="text-sm text-[#1A1A1A]">
                  <span className="font-bold">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ'][idx]}.</span> {itm}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* 문제 이미지 */}
        {q.image && (
          <div className="mb-3">
            <p className="text-xs font-bold text-[#5C5C5C] mb-2">문제 이미지</p>
            <img src={q.image} alt="문제 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
          </div>
        )}

        {/* 하위 문제 이미지 */}
        {q.subQuestionImage && (
          <div className="mb-3">
            <p className="text-xs font-bold text-[#5C5C5C] mb-2">이미지</p>
            <img src={q.subQuestionImage} alt="하위 문제 이미지" className="max-w-full h-auto border border-[#1A1A1A]" />
          </div>
        )}

        {/* 보기 (<보기> 박스) */}
        {q.bogi && q.bogi.items && q.bogi.items.some(i => i.content?.trim()) && (
          <div className="mb-3 p-3 bg-[#EDEAE4] border-2 border-[#1A1A1A]">
            <p className="text-xs text-center text-[#5C5C5C] mb-2 font-bold">&lt;보 기&gt;</p>
            <div className="space-y-1">
              {q.bogi.items.filter(i => i.content?.trim()).map((item, idx) => (
                <p key={idx} className="text-sm text-[#1A1A1A]">
                  <span className="font-bold mr-1">{item.label}.</span>
                  {item.content}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* 발문 */}
        {(q.passagePrompt || q.bogiQuestionText) && (
          <div className="mb-3 p-3 border border-[#1A1A1A] bg-[#F5F0E8]">
            <p className="text-sm text-[#1A1A1A]">
              {q.passagePrompt && q.bogiQuestionText
                ? `${q.passagePrompt} ${q.bogiQuestionText}`
                : q.passagePrompt || q.bogiQuestionText}
            </p>
          </div>
        )}

        {/* 선지 (객관식) — 정답만 강조 */}
        {q.options && q.options.length > 0 && (
          <div>
            {(() => {
              const correctAnswerStr = q.correctAnswer?.toString() || '';
              const correctAnswers = correctAnswerStr.includes(',')
                ? correctAnswerStr.split(',').map(a => a.trim())
                : [correctAnswerStr];
              const isMultipleAnswer = correctAnswers.length > 1;
              return isMultipleAnswer && (
                <p className="text-xs text-[#8B6914] font-bold mb-2 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  복수 정답 문제 ({correctAnswers.length}개)
                </p>
              );
            })()}
            <div className="space-y-1">
              {q.options.map((opt, idx) => {
                const optionNum = (idx + 1).toString();
                const correctAnswerStr = q.correctAnswer?.toString() || '';
                const correctAnswers = correctAnswerStr.includes(',')
                  ? correctAnswerStr.split(',').map(a => a.trim())
                  : [correctAnswerStr];
                const isCorrectOption = correctAnswers.includes(optionNum);
                const isMultipleAnswer = correctAnswers.length > 1;
                const choiceExp = q.choiceExplanations?.[idx];
                const choiceKey = `${q.id}-${idx}`;
                const isChoiceExpanded = expandedChoices.has(choiceKey);

                return (
                  <div key={idx}>
                    <div
                      className={`text-sm p-2 border ${
                        isCorrectOption
                          ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]'
                          : 'border-[#EDEAE4] text-[#1A1A1A]'
                      } flex items-center justify-between ${choiceExp ? 'cursor-pointer' : ''}`}
                      onClick={choiceExp ? () => {
                        setExpandedChoices(prev => {
                          const next = new Set(prev);
                          if (next.has(choiceKey)) next.delete(choiceKey); else next.add(choiceKey);
                          return next;
                        });
                      } : undefined}
                    >
                      <span>
                        {idx + 1}. {opt}
                        {isMultipleAnswer && isCorrectOption && ' (정답)'}
                      </span>
                      {choiceExp && (
                        <svg
                          className={`w-4 h-4 flex-shrink-0 ml-2 text-[#5C5C5C] transition-transform ${isChoiceExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </div>
                    <AnimatePresence>
                      {choiceExp && isChoiceExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 py-2">
                            <p className="text-sm text-[#5C5C5C] bg-[#EDEAE4] p-2 border-l-2 border-[#8B6914]">
                              {stripChoicePrefix(choiceExp)}
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* OX 문제 — 정답만 강조 */}
        {q.type === 'ox' && (!q.options || q.options.length === 0) && (
          <div className="space-y-2">
            {(() => {
              const correctRaw = q.correctAnswer?.toString().toUpperCase() || '';
              const correctOX = correctRaw === '0' || correctRaw === 'O' ? 'O' : 'X';

              return (
                <div className="flex gap-3 justify-center py-2">
                  <div className={`w-20 h-20 flex items-center justify-center font-bold text-2xl border-2 ${
                    correctOX === 'O' ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]' : 'border-[#EDEAE4] bg-white text-[#5C5C5C]'
                  }`}>
                    O
                  </div>
                  <div className={`w-20 h-20 flex items-center justify-center font-bold text-2xl border-2 ${
                    correctOX === 'X' ? 'border-[#1A6B1A] bg-[#E8F5E9] text-[#1A6B1A]' : 'border-[#EDEAE4] bg-white text-[#5C5C5C]'
                  }`}>
                    X
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* 주관식 — 정답 표시 (서술형 제외) */}
        {q.type !== 'ox' && q.type !== 'essay' && (!q.options || q.options.length === 0) && (
          <div className="space-y-2">
            {q.correctAnswer?.toString().includes('|||') ? (
              <p className="text-sm">
                <span className="text-[#5C5C5C]">정답: </span>
                <span className="font-bold text-[#1A6B1A]">
                  {q.correctAnswer.split('|||').map((a: string) => a.trim()).join(', ')}
                </span>
              </p>
            ) : (
              <p className="text-sm">
                <span className="text-[#5C5C5C]">정답: </span>
                <span className="font-bold text-[#1A6B1A]">{q.correctAnswer}</span>
              </p>
            )}
          </div>
        )}

        {/* 서술형: 루브릭 → 해설 (있는 것만) */}
        {q.type === 'essay' ? (
          <>
            {q.rubric && q.rubric.length > 0 && q.rubric.some(r => r.criteria.trim()) && (
              <div>
                <p className="text-xs font-bold text-[#5C5C5C] mb-1">평가 기준</p>
                <div className="bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
                  <ul className="space-y-1 text-sm">
                    {q.rubric.filter(r => r.criteria.trim()).map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-[#1A1A1A] font-bold shrink-0">·</span>
                        <span>
                          {item.criteria}
                          {item.percentage > 0 && <span className="text-[#5C5C5C] font-bold"> ({item.percentage}%)</span>}
                          {item.description && <span className="text-[#5C5C5C]"> — {item.description}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {q.explanation && (
              <div>
                <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
                <p className="text-sm text-[#1A1A1A] bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
                  {q.explanation}
                </p>
              </div>
            )}
          </>
        ) : (
          /* 비서술형: 해설 항상 표시 */
          q.explanation ? (
            <div>
              <p className="text-xs font-bold text-[#5C5C5C] mb-1">해설</p>
              <p className="text-sm text-[#1A1A1A] bg-[#EDEAE4] p-3 border border-[#1A1A1A]">
                {q.explanation}
              </p>
            </div>
          ) : null
        )}
      </>
    );
  };

  // 로딩
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}>
        <motion.div className="flex flex-col items-center gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <motion.div
            className="w-12 h-12 border-4 border-[#1A1A1A] border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <p className="text-[#5C5C5C] font-bold">문제 로딩 중...</p>
        </motion.div>
      </div>
    );
  }

  // 에러
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F0E8' }}>
        <h2 className="text-xl font-bold text-[#1A1A1A] mb-2">오류 발생</h2>
        <p className="text-[#5C5C5C] text-center mb-6">{error}</p>
        <button
          onClick={() => router.back()}
          className="px-6 py-3 bg-[#1A1A1A] text-[#F5F0E8] font-bold border-2 border-[#1A1A1A] hover:bg-[#333] transition-colors"
        >
          돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-8" style={{ backgroundColor: '#F5F0E8' }}>
      {/* 헤더 */}
      <header className="sticky top-0 z-50 w-full border-b-2 border-[#1A1A1A]" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="flex items-center h-14 px-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 text-sm font-bold text-[#1A1A1A] hover:text-[#5C5C5C] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            이전
          </button>
          <h1 className="flex-1 text-center text-base font-bold text-[#1A1A1A] truncate px-4">
            문제 미리보기
          </h1>
          <div className="w-12" />
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="px-4 pt-6 space-y-6"
      >
        {/* 퀴즈 정보 */}
        <div className="bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6 text-center">
          <p className="text-sm text-[#5C5C5C] mb-2">{quizTitle}</p>
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-xs text-[#5C5C5C]">평균</span>
            <span className="text-5xl font-bold text-[#1A1A1A]">
              {participantCount > 0 ? averageScore.toFixed(0) : '-'}
            </span>
            {participantCount > 0 && <span className="text-lg font-bold text-[#1A1A1A]">점</span>}
          </div>
          <p className="text-sm text-[#5C5C5C]">
            총 {totalCount}문제 · {participantCount}명 참여
          </p>
        </div>

        {/* 문제 리스트 */}
        <div className="space-y-3">
          <h3 className="font-bold text-[#1A1A1A]">문제 목록</h3>
          {displayItems.map((item) => {
            // 단일 문제
            if (item.type === 'single' && item.result) {
              const q = item.result;
              return (
                <div key={q.id}>
                  <button
                    onClick={() => toggleExpand(q.id)}
                    className="w-full border-2 border-[#1A1A1A] p-4 text-left bg-[#F5F0E8]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[#1A1A1A]">
                          Q{item.displayNumber}
                        </span>
                        {/* 챕터 */}
                        {userCourseId && q.chapterId && (
                          <span className="px-1.5 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-xs font-medium">
                            {formatChapterLabel(userCourseId, q.chapterId, q.chapterDetailId)}
                          </span>
                        )}
                      </div>
                      <svg
                        className={`w-5 h-5 text-[#5C5C5C] transition-transform ${expandedIds.has(q.id) ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    <p className="text-sm text-[#1A1A1A] mt-2 line-clamp-2">
                      {q.question}
                      {(q.passagePrompt || q.bogiQuestionText) && (
                        <span className="ml-1 text-[#5C5C5C]">
                          {q.passagePrompt || q.bogiQuestionText}
                        </span>
                      )}
                    </p>
                  </button>

                  <AnimatePresence>
                    {expandedIds.has(q.id) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border-2 border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-3">
                          {renderQuestionDetail(q)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }

            // 결합형 그룹
            if (item.type === 'combined_group' && item.results && item.combinedGroupId) {
              const groupId = item.combinedGroupId;
              const groupResults = item.results;
              const firstResult = groupResults[0];
              const isGroupExpanded = expandedGroupIds.has(groupId);

              return (
                <div key={groupId}>
                  <button
                    onClick={() => toggleGroupExpand(groupId)}
                    className="w-full border border-[#1A1A1A] bg-[#F5F0E8] p-4 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#1A1A1A]">
                          Q{item.displayNumber}. 결합형 문제
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-[#1A1A1A] text-[#F5F0E8]">
                          {groupResults.length}문제
                        </span>
                      </div>
                      <svg
                        className={`w-5 h-5 text-[#5C5C5C] transition-transform ${isGroupExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    {(firstResult.commonQuestion || firstResult.passagePrompt) && (
                      <p className="text-sm text-[#1A1A1A] mt-2 line-clamp-2">
                        {firstResult.commonQuestion || ''}
                        {firstResult.passagePrompt && (
                          <span className={firstResult.commonQuestion ? 'ml-1 text-[#5C5C5C]' : ''}>
                            {firstResult.passagePrompt}
                          </span>
                        )}
                      </p>
                    )}
                  </button>

                  <AnimatePresence>
                    {isGroupExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="border border-t-0 border-[#1A1A1A] bg-[#F5F0E8] p-4 space-y-4">
                          {/* 공통 지문 */}
                          {(firstResult.passage || firstResult.passageImage || firstResult.koreanAbcItems || (firstResult.passageMixedExamples && firstResult.passageMixedExamples.length > 0)) && (
                            <div className="p-3 border border-[#8B6914] bg-[#FFF8E1]">
                              <p className="text-xs font-bold text-[#8B6914] mb-2">
                                {firstResult.passageType === 'korean_abc' ? '보기' : '공통 지문'}
                              </p>
                              {firstResult.passage && firstResult.passageType !== 'korean_abc' && firstResult.passageType !== 'mixed' && (
                                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{firstResult.passage}</p>
                              )}
                              {firstResult.passageType === 'korean_abc' && firstResult.koreanAbcItems && firstResult.koreanAbcItems.length > 0 && (
                                <div className="space-y-1">
                                  {firstResult.koreanAbcItems.map((itm, idx) => (
                                    <p key={idx} className="text-sm text-[#1A1A1A]">
                                      <span className="font-bold">{['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ'][idx]}.</span> {itm}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {firstResult.passageMixedExamples && firstResult.passageMixedExamples.length > 0 && (
                                <div className="space-y-2">
                                  {firstResult.passageMixedExamples.map((block: any) => (
                                    <div key={block.id}>
                                      {block.type === 'grouped' && (
                                        <div className="space-y-1">
                                          {(block.children || []).map((child: any) => (
                                            <div key={child.id}>
                                              {child.type === 'text' && <p className="text-sm text-[#5C5C5C] whitespace-pre-wrap">{child.content}</p>}
                                              {child.type === 'labeled' && (child.items || []).map((i: any) => (
                                                <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                              ))}
                                              {child.type === 'gana' && (child.items || []).map((i: any) => (
                                                <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                              ))}
                                              {child.type === 'image' && child.imageUrl && <img src={child.imageUrl} alt="" className="max-w-full h-auto" />}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {block.type === 'text' && <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">{block.content}</p>}
                                      {block.type === 'labeled' && (
                                        <div className="space-y-1">
                                          {(block.items || []).map((i: any) => (
                                            <p key={i.id} className="text-sm"><span className="font-bold">{i.label}.</span> {i.content}</p>
                                          ))}
                                        </div>
                                      )}
                                      {block.type === 'gana' && (
                                        <div className="space-y-1">
                                          {(block.items || []).map((i: any) => (
                                            <p key={i.id} className="text-sm"><span className="font-bold">({i.label})</span> {i.content}</p>
                                          ))}
                                        </div>
                                      )}
                                      {block.type === 'image' && block.imageUrl && <img src={block.imageUrl} alt="" className="max-w-full h-auto" />}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {firstResult.passageImage && (
                                <img src={firstResult.passageImage} alt="공통 이미지" className="mt-2 max-w-full h-auto border border-[#1A1A1A]" />
                              )}
                            </div>
                          )}

                          {/* 하위 문제들 */}
                          <div className="space-y-3 p-3 bg-[#EDEAE4] border border-[#D4CFC4]">
                            {groupResults.map((subQ, subIdx) => (
                              <div key={subQ.id}>
                                <button
                                  onClick={() => toggleExpand(subQ.id)}
                                  className="w-full border border-[#1A1A1A] p-3 text-left bg-[#F5F0E8]"
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-bold text-[#1A1A1A]">
                                        Q{item.displayNumber}-{subIdx + 1}
                                      </span>
                                      {userCourseId && subQ.chapterId && (
                                        <span className="px-1.5 py-0.5 bg-[#E8F0FE] border border-[#4A6DA7] text-[#4A6DA7] text-[10px] font-medium">
                                          {formatChapterLabel(userCourseId, subQ.chapterId, subQ.chapterDetailId)}
                                        </span>
                                      )}
                                    </div>
                                    <svg
                                      className={`w-4 h-4 text-[#5C5C5C] transition-transform ${expandedIds.has(subQ.id) ? 'rotate-180' : ''}`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                  <p className="text-sm text-[#1A1A1A] mt-1 line-clamp-2">
                                    {subQ.question}
                                    {(subQ.passagePrompt || subQ.bogiQuestionText) && (
                                      <span className="ml-1 text-[#5C5C5C]">
                                        {subQ.passagePrompt || subQ.bogiQuestionText}
                                      </span>
                                    )}
                                  </p>
                                </button>

                                <AnimatePresence>
                                  {expandedIds.has(subQ.id) && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="border-2 border-t-0 border-[#1A1A1A] bg-white p-3 space-y-2">
                                        {renderQuestionDetail(subQ)}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }

            return null;
          })}
        </div>
      </motion.main>
    </div>
  );
}
