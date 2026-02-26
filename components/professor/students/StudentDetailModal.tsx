'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { collection, query, where, getDocs, orderBy, limit, Timestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { StudentDetail, ClassType } from '@/lib/hooks/useProfessorStudents';
import { mean, sd, zScore, percentile } from '@/lib/utils/statistics';
import { calcFeedbackScore, getFeedbackLabel } from '@/lib/utils/feedbackScore';
import StudentRadar from './StudentRadar';

const CLASS_COLORS: Record<ClassType, string> = {
  A: '#8B1A1A', B: '#B8860B', C: '#1D5D4A', D: '#1E3A5F',
};

interface Props {
  student: StudentDetail | null;
  allStudents: { uid: string; classId: ClassType; averageScore: number }[];
  isOpen: boolean;
  onClose: () => void;
}

interface QuizLogEntry {
  quizId: string;
  quizTitle: string;
  creatorName: string;
  score: number;
  completedAt: Date;
}

/** Details 모달에 표시할 퀴즈 정보 */
interface QuizDetailsData {
  id: string;
  title: string;
  description?: string;
  difficulty: string;
  questionCount: number;
  participantCount: number;
  averageScore: number;
  tags?: string[];
  creatorNickname: string;
  creatorRole?: string;        // 'professor' | 'student'
  creatorName?: string;        // 실명
  creatorClassId?: string;
  questions: { type: string }[];
  feedbackLabel?: { label: string; color: string } | null;
  feedbackCount?: number;
}

export default function StudentDetailModal({ student, allStudents, isOpen, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'radar' | 'academic' | 'activity' | 'log'>('radar');
  const [quizLog, setQuizLog] = useState<QuizLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [detailsData, setDetailsData] = useState<QuizDetailsData | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // 퀴즈 로그 로드 — quizCreatorId로 사용자 역할/이름 조회
  const loadQuizLog = useCallback(async (uid: string) => {
    setLogLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'quizResults'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(30))
      );

      // 모든 고유 creatorId 수집
      const creatorUids = new Set<string>();
      const rawEntries = snap.docs.map(d => {
        const data = d.data();
        const creatorId = data.quizCreatorId || '';
        if (creatorId) creatorUids.add(creatorId);
        return {
          quizId: data.quizId,
          quizTitle: data.quizTitle || '퀴즈',
          creatorId,
          score: data.score ?? 0,
          completedAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
        };
      });

      // creator 정보 일괄 조회 (역할 + 실명 + 닉네임 + 반)
      const creatorMap = new Map<string, { role: string; name: string; nickname: string; classId: string }>();
      if (creatorUids.size > 0) {
        await Promise.all(
          [...creatorUids].map(cid =>
            getDoc(doc(db, 'users', cid))
              .then(snap => {
                if (snap.exists()) {
                  const d = snap.data();
                  creatorMap.set(cid, {
                    role: d.role || 'student',
                    name: d.name || '',
                    nickname: d.nickname || '',
                    classId: d.classId || '',
                  });
                }
              })
              .catch(() => {})
          )
        );
      }

      const entries: QuizLogEntry[] = rawEntries.map(e => {
        const creator = creatorMap.get(e.creatorId);
        // 교수: 교수, 학생: 닉네임
        const creatorName = !creator ? '교수'
          : creator.role === 'professor' ? '교수'
          : creator.nickname || creator.name || '학생';
        return {
          quizId: e.quizId,
          quizTitle: e.quizTitle,
          creatorName,
          score: e.score,
          completedAt: e.completedAt,
        };
      });

      setQuizLog(entries);
    } catch {
      setQuizLog([]);
    } finally {
      setLogLoading(false);
    }
  }, []);

  // 퀴즈 Details 모달 열기 — quizId로 Firestore 문서 조회
  const openQuizDetails = useCallback(async (quizId: string) => {
    if (!quizId || detailsLoading) return;
    setDetailsLoading(true);
    try {
      const quizSnap = await getDoc(doc(db, 'quizzes', quizId));
      if (!quizSnap.exists()) { setDetailsLoading(false); return; }
      const d = quizSnap.data();

      // 제작자 정보 조회
      let creatorRole: string | undefined;
      let creatorName: string | undefined;
      let creatorClassId: string | undefined;
      if (d.creatorUid) {
        const cSnap = await getDoc(doc(db, 'users', d.creatorUid)).catch(() => null);
        if (cSnap?.exists()) {
          const cd = cSnap.data();
          creatorRole = cd.role || 'student';
          creatorName = cd.name;
          creatorClassId = cd.classId;
        }
      }

      // 피드백 점수
      let feedbackLabel: { label: string; color: string } | null = null;
      let feedbackCount = 0;
      const fbSnap = await getDocs(
        query(collection(db, 'questionFeedbacks'), where('quizId', '==', quizId))
      ).catch(() => null);
      if (fbSnap && fbSnap.size > 0) {
        feedbackCount = fbSnap.size;
        const fbs = fbSnap.docs.map(fd => ({ type: fd.data().type as string })).filter(f => f.type);
        const score = calcFeedbackScore(fbs as { type: 'praise' | 'wantmore' | 'other' | 'typo' | 'unclear' | 'wrong' }[]);
        feedbackLabel = getFeedbackLabel(score);
      }

      setDetailsData({
        id: quizId,
        title: d.title || '퀴즈',
        description: d.description,
        difficulty: d.difficulty || 'normal',
        questionCount: d.questions?.length ?? d.questionCount ?? 0,
        participantCount: d.participantCount ?? 0,
        averageScore: d.averageScore ?? 0,
        tags: d.tags,
        creatorNickname: d.creatorNickname || '',
        creatorRole,
        creatorName,
        creatorClassId,
        questions: (d.questions || []).map((q: { type?: string }) => ({ type: q.type || '' })),
        feedbackLabel,
        feedbackCount,
      });
    } catch {
      // 조회 실패 시 무시
    } finally {
      setDetailsLoading(false);
    }
  }, [detailsLoading]);

  useEffect(() => {
    if (student && isOpen) {
      loadQuizLog(student.uid);
    }
  }, [student?.uid, isOpen, loadQuizLog]);

  // PullToHome 차단 + 네비게이션 숨김
  useEffect(() => {
    if (isOpen) {
      document.body.setAttribute('data-hide-nav', '');
    }
    return () => {
      document.body.removeAttribute('data-hide-nav');
    };
  }, [isOpen]);

  // 드래그로 닫기
  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 300) {
      onClose();
    }
  }, [onClose]);

  if (!student || !isOpen) return null;

  // 학업 성취도 — quizLog에서 직접 평균 계산 (Firestore averageScore가 갱신되지 않으므로)
  const studentAvg = quizLog.length > 0
    ? quizLog.reduce((sum, q) => sum + q.score, 0) / quizLog.length
    : 0;
  const classMates = allStudents.filter(s => s.classId === student.classId);
  const classScores = classMates.map(s => s.averageScore);
  const classMean = mean(classScores);
  const classSd = sd(classScores);
  const studentZ = zScore(studentAvg, classMean, classSd);
  const studentPercentile = percentile(studentZ);

  // 표시 이름
  const displayName = student.name || student.nickname;

  // 경고
  const warnings: string[] = [];
  if (studentZ < -2.0) warnings.push('Z-score < -2.0 — 위험');
  else if (studentZ < -1.5) warnings.push('Z-score < -1.5 — 주의');

  const TABS = [
    { key: 'radar' as const, label: '종합 역량' },
    { key: 'academic' as const, label: '학업 성취' },
    { key: 'activity' as const, label: '게시판·댓글' },
    { key: 'log' as const, label: '퀴즈 로그' },
  ];

  // 최근 퀴즈 5개 (서재 비공개 제외)
  const recentFive = quizLog.slice(0, 5).reverse();

  return (
    <AnimatePresence>
      <motion.div
        key="student-detail-overlay"
        className="fixed inset-0 z-[100] bg-black/30 flex items-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full bg-[#F5F0E8] rounded-t-2xl shadow-[0_-8px_32px_rgba(0,0,0,0.12)] border border-[#D4CFC4]/60 border-b-0 overflow-hidden flex flex-col"
          style={{ height: '60vh' }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
          onClick={e => e.stopPropagation()}
        >
          {/* 핸들 */}
          <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1 bg-[#D4CFC4]/80 rounded-full" />
          </div>

          {/* 헤더 — 이름 / 반 · 닉네임 / 학번 */}
          <div className="px-5 pb-3 border-b border-[#D4CFC4]">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-[#1A1A1A]">{displayName}</h2>
                <p className="text-base text-[#5C5C5C]">{student.classId}반 · {student.nickname}</p>
                {student.studentId && (
                  <p className="text-base text-[#5C5C5C]">{student.studentId}</p>
                )}
              </div>
              <button onClick={onClose} className="p-1 text-[#5C5C5C] flex-shrink-0">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 경고 */}
            {warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="text-xs px-2 py-1 bg-red-50 border border-[#8B1A1A] text-[#8B1A1A] font-bold">
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 탭 */}
          <div className="flex border-b border-[#D4CFC4]">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2.5 text-sm font-bold text-center transition-colors ${
                  activeTab === tab.key
                    ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
                    : 'text-[#5C5C5C]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 탭 콘텐츠 — 스크롤 가능 */}
          <div className="flex-1 overflow-y-auto p-5">
            {/* 0) 종합 역량 레이더 */}
            {activeTab === 'radar' && (
              <div>
                {student.radarMetrics ? (
                  <StudentRadar
                    data={student.radarMetrics}
                    classColor={CLASS_COLORS[student.classId]}
                  />
                ) : (
                  <div className="text-center py-8">
                    <p className="text-base text-[#5C5C5C]">레이더 데이터를 불러오는 중...</p>
                  </div>
                )}
              </div>
            )}

            {/* A) 학업 성취도 — 박스 없이 */}
            {activeTab === 'academic' && (
              <div className="space-y-6">
                {/* 핵심 지표 — 그리드, 박스 없이 */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <div>
                    <p className="text-sm text-[#5C5C5C]">평균 점수</p>
                    <p className="text-xl font-bold text-[#1A1A1A]">{studentAvg.toFixed(1)}점</p>
                  </div>
                  <div>
                    <p className="text-sm text-[#5C5C5C]">반 평균</p>
                    <p className="text-xl font-bold text-[#1A1A1A]">{classMean.toFixed(1)}점</p>
                  </div>
                  <div>
                    <p className="text-sm text-[#5C5C5C]">Z-score</p>
                    <p className={`text-xl font-bold ${studentZ < -1.5 ? 'text-[#8B1A1A]' : 'text-[#1A1A1A]'}`}>
                      {studentZ.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-[#5C5C5C]">반 내 백분위</p>
                    <p className="text-xl font-bold text-[#1A1A1A]">상위 {100 - studentPercentile}%</p>
                  </div>
                </div>

                {/* 구분선 */}
                <div className="border-t border-[#D4CFC4]" />

                {/* 최근 퀴즈 5개 차트 */}
                {recentFive.length > 0 && (
                  <div>
                    <p className="text-base font-bold text-[#1A1A1A] mb-3">최근 퀴즈 성적</p>
                    <svg viewBox="0 0 300 140" className="w-full">
                      <line x1={20} y1={80} x2={280} y2={80} stroke="#D4CFC4" strokeWidth={0.5} />
                      {recentFive.map((q, i, arr) => {
                        const x = arr.length === 1 ? 150 : 30 + (i / (arr.length - 1)) * 240;
                        const y = 75 - (q.score / 100) * 65;
                        const prevX = i > 0 ? (30 + ((i - 1) / (arr.length - 1)) * 240) : x;
                        const prevY = i > 0 ? (75 - (arr[i - 1].score / 100) * 65) : y;
                        return (
                          <g key={i}>
                            {i > 0 && (
                              <line x1={prevX} y1={prevY} x2={x} y2={y}
                                stroke="#1A1A1A" strokeWidth={1.5} />
                            )}
                            <circle cx={x} cy={y} r={4} fill="#1A1A1A" />
                            <text x={x} y={y - 8} textAnchor="middle" fontSize={9}
                              fontWeight="bold" fill="#1A1A1A">
                              {q.score}
                            </text>
                          </g>
                        );
                      })}
                      {recentFive.map((q, i, arr) => {
                        const x = arr.length === 1 ? 150 : 30 + (i / (arr.length - 1)) * 240;
                        const name = q.quizTitle.length > 6 ? q.quizTitle.slice(0, 6) + '..' : q.quizTitle;
                        return (
                          <g key={`label-${i}`}>
                            <text x={x} y={95} textAnchor="middle" fontSize={8}
                              fill="#1A1A1A" fontWeight="600">
                              {name}
                            </text>
                            <text x={x} y={107} textAnchor="middle" fontSize={7}
                              fill="#5C5C5C">
                              {q.creatorName}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                )}
              </div>
            )}

            {/* B) 활동 분포 — 박스 없이, 게시글 제목 + 댓글 내용 목록 */}
            {activeTab === 'activity' && (
              <div className="space-y-6">
                {/* 게시글 */}
                <div>
                  <p className="text-base font-bold text-[#1A1A1A] mb-2">
                    게시글 ({student.boardPostCount ?? 0})
                  </p>
                  {(student.boardPosts ?? []).length === 0 ? (
                    <p className="text-sm text-[#5C5C5C]">게시글이 없습니다</p>
                  ) : (
                    <div className="space-y-0">
                      {student.boardPosts.map((post, i) => (
                        <div key={i} className="py-2 border-b border-[#D4CFC4]">
                          <p className="text-base text-[#1A1A1A]">{post.title}</p>
                          <p className="text-xs text-[#5C5C5C] mt-0.5">
                            {post.createdAt.toLocaleDateString('ko', { month: '2-digit', day: '2-digit' })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 구분선 */}
                <div className="border-t border-[#D4CFC4]" />

                {/* 댓글 */}
                <div>
                  <p className="text-base font-bold text-[#1A1A1A] mb-2">
                    댓글 ({student.boardCommentCount ?? 0})
                  </p>
                  {(student.boardCommentsList ?? []).length === 0 ? (
                    <p className="text-sm text-[#5C5C5C]">댓글이 없습니다</p>
                  ) : (
                    <div className="space-y-0">
                      {student.boardCommentsList.map((c, i) => (
                        <div key={i} className="py-2 border-b border-[#D4CFC4]">
                          <p className="text-base text-[#1A1A1A] whitespace-pre-wrap">{c.content}</p>
                          <p className="text-xs text-[#5C5C5C] mt-0.5">
                            {c.createdAt.toLocaleDateString('ko', { month: '2-digit', day: '2-digit' })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 구분선 */}
                <div className="border-t border-[#D4CFC4]" />

                {/* 최근 피드백 */}
                {student.recentFeedbacks.length > 0 && (
                  <div>
                    <p className="text-base font-bold text-[#1A1A1A] mb-2">피드백 ({student.feedbackCount}건)</p>
                    {student.recentFeedbacks.map(fb => (
                      <div key={fb.feedbackId} className="py-2 border-b border-[#D4CFC4]">
                        <p className="text-xs text-[#5C5C5C]">{fb.quizTitle}</p>
                        <p className="text-base text-[#1A1A1A]">{fb.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* C) 퀴즈 로그 — 한 줄: 날짜 | 퀴즈 | 출제자 | 점수점 */}
            {activeTab === 'log' && (
              <div>
                {logLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 border-2 border-[#1A1A1A] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : quizLog.length === 0 ? (
                  <p className="text-base text-[#5C5C5C] text-center py-8">퀴즈 기록이 없습니다</p>
                ) : (
                  <div>
                    {/* 테이블 헤더 */}
                    <div className="flex items-center py-2 border-b-2 border-[#1A1A1A] text-sm font-bold text-[#5C5C5C]">
                      <span className="w-14 flex-shrink-0">날짜</span>
                      <span className="flex-1 min-w-0 ml-2">퀴즈</span>
                      <span className="w-12 flex-shrink-0 text-right mr-4">출제자</span>
                      <span className="w-14 flex-shrink-0 text-right">점수</span>
                    </div>
                    {quizLog.map((entry, i) => (
                      <div key={i} className="flex items-center py-3 border-b border-[#D4CFC4]">
                        <span className="w-14 flex-shrink-0 text-sm text-[#5C5C5C]">
                          {entry.completedAt.toLocaleDateString('ko', { month: '2-digit', day: '2-digit' })}
                        </span>
                        <button
                          className="flex-1 min-w-0 ml-2 text-left text-base font-bold text-[#1A1A1A] truncate active:text-[#5C5C5C] transition-colors"
                          onClick={() => openQuizDetails(entry.quizId)}
                        >
                          {entry.quizTitle}
                        </button>
                        <span className="w-12 flex-shrink-0 text-sm text-[#5C5C5C] text-right mr-4 truncate">
                          {entry.creatorName}
                        </span>
                        <span className="w-14 flex-shrink-0 text-xl font-bold text-[#1A1A1A] text-right whitespace-nowrap">
                          {entry.score}점
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* 퀴즈 Details 모달 — 퀴즈 로그 위에 오버레이 */}
      <AnimatePresence>
        {(detailsData || detailsLoading) && (
          <motion.div
            key="quiz-details-overlay"
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDetailsData(null)}
          >
            {detailsLoading ? (
              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : detailsData && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={e => e.stopPropagation()}
              className="w-full max-w-sm bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
            >
              <h2 className="text-lg font-bold text-[#1A1A1A] mb-2">{detailsData.title}</h2>
              {detailsData.description ? (
                <p className="text-sm text-[#5C5C5C] mb-4 line-clamp-3">&ldquo;{detailsData.description}&rdquo;</p>
              ) : <div className="mb-2" />}

              {/* 평균 점수 */}
              <div className="text-center py-4 mb-4 border-2 border-dashed border-[#1A1A1A] bg-[#EDEAE4]">
                <p className="text-xs text-[#5C5C5C] mb-1">평균 점수</p>
                <p className="text-4xl font-black text-[#1A1A1A]">
                  {detailsData.participantCount > 0 || detailsData.averageScore > 0
                    ? <>{(detailsData.averageScore ?? 0).toFixed(0)}<span className="text-lg font-bold">점</span></>
                    : '-'}
                </p>
              </div>

              <div className="space-y-2 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C5C5C]">문제 수</span>
                  <span className="font-bold text-[#1A1A1A]">{detailsData.questionCount}문제</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C5C5C]">참여자</span>
                  <span className="font-bold text-[#1A1A1A]">{detailsData.participantCount}명</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C5C5C]">난이도</span>
                  <span className="font-bold text-[#1A1A1A]">
                    {detailsData.difficulty === 'easy' ? '쉬움' : detailsData.difficulty === 'hard' ? '어려움' : '보통'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C5C5C]">문제 유형</span>
                  <span className="font-bold text-[#1A1A1A]">
                    {(() => {
                      let ox = 0, mc = 0, sa = 0;
                      detailsData.questions.forEach(q => {
                        if (q.type === 'ox') ox++;
                        else if (q.type === 'multiple') mc++;
                        else if (['short_answer', 'subjective', 'essay'].includes(q.type)) sa++;
                      });
                      const parts: string[] = [];
                      if (ox > 0) parts.push(`OX ${ox}`);
                      if (mc > 0) parts.push(`객관식 ${mc}`);
                      if (sa > 0) parts.push(`주관식 ${sa}`);
                      return parts.length > 0 ? parts.join(' · ') : '-';
                    })()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#5C5C5C]">제작자</span>
                  <span className="font-bold text-[#1A1A1A]">
                    {detailsData.creatorRole === 'professor'
                      ? `${detailsData.creatorName || '교수'} ${detailsData.creatorNickname}`
                      : `${detailsData.creatorNickname} ${detailsData.creatorClassId ? detailsData.creatorClassId + '반' : ''}`
                    }
                  </span>
                </div>
                {detailsData.feedbackLabel && (detailsData.feedbackCount ?? 0) > 0 && (
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-[#5C5C5C]">피드백</span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-bold px-1.5 py-0.5 border"
                        style={{ color: detailsData.feedbackLabel.color, borderColor: detailsData.feedbackLabel.color }}
                      >
                        {detailsData.feedbackLabel.label}
                      </span>
                      <span className="text-xs text-[#5C5C5C]">{detailsData.feedbackCount}건</span>
                    </div>
                  </div>
                )}
                {detailsData.tags && detailsData.tags.length > 0 && (
                  <div className="pt-2 border-t border-[#A0A0A0]">
                    <div className="flex flex-wrap gap-1.5">
                      {detailsData.tags.map((tag, ti) => (
                        <span key={`${ti}-${tag}`} className="px-2 py-1 bg-[#1A1A1A] text-[#F5F0E8] text-sm font-medium">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setDetailsData(null)}
                className="w-full py-3 font-bold border-2 border-[#1A1A1A] text-[#1A1A1A] bg-[#F5F0E8] hover:bg-[#EDEAE4] transition-colors"
              >
                닫기
              </button>
            </motion.div>
          )}
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}
