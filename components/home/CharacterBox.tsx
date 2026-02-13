'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useUser, useCourse } from '@/lib/contexts';
import { useTheme } from '@/styles/themes/useTheme';

/**
 * 캐릭터 정보 타입
 */
interface Character {
  id: string;
  index: number; // 0-29
  imageUrl: string; // MP4 URL (placeholder)
  thumbnailUrl: string; // PNG URL (도감용, placeholder)
}

/**
 * 캐릭터 발견 기록
 */
interface CharacterDiscovery {
  id: string;
  characterIndex: number;
  characterName: string;
  discoveredBy: string; // userId
  discovererNickname: string;
  courseId: string;
  discoveredAt: any;
}

/**
 * 사용자의 현재 캐릭터 정보
 */
interface UserCharacter {
  characterIndex: number;
  characterName: string;
}

/**
 * 말풍선 메시지 목록
 */
const GACHA_MESSAGES = [
  '탈피가 시작됐어요!',
  '윽... 몸이 이상해요!',
  '뭔가 변하고 있어요!',
  '두근두근...!',
  '새로운 모습이 될 것 같아요!',
];

/**
 * 캐릭터 박스 컴포넌트
 * - 총 XP, 도감 아이콘
 * - 반별 배경 + 캐릭터 MP4
 * - 뽑기 가능 시 말풍선
 * - EXP 바 (0-50)
 */
export default function CharacterBox() {
  const router = useRouter();
  const { profile } = useUser();
  const { userCourseId } = useCourse();
  const { theme, classType } = useTheme();

  const [userCharacter, setUserCharacter] = useState<UserCharacter | null>(null);
  const [canGacha, setCanGacha] = useState(false);
  const [showGachaModal, setShowGachaModal] = useState(false);
  const [showGachaBubble, setShowGachaBubble] = useState(false);
  const [bubbleMessage, setBubbleMessage] = useState('');
  const [showDogam, setShowDogam] = useState(false);
  const [discoveries, setDiscoveries] = useState<CharacterDiscovery[]>([]);
  const [gachaResult, setGachaResult] = useState<{
    characterIndex: number;
    isNew: boolean;
    name: string;
  } | null>(null);
  const [isGachaAnimating, setIsGachaAnimating] = useState(false);
  const [newCharacterName, setNewCharacterName] = useState('');

  // 현재 EXP (50 단위로 순환)
  const currentExp = profile ? profile.totalExp % 50 : 0;
  const totalExp = profile?.totalExp || 0;

  // 뽑기 가능 여부 체크 (50의 배수 도달 시)
  useEffect(() => {
    if (!profile) return;

    // 마지막 뽑기 EXP 체크
    const lastGachaExp = profile.lastGachaExp || 0;
    const currentMilestone = Math.floor(profile.totalExp / 50) * 50;

    // 새로운 50 단위 도달했고, 아직 뽑지 않은 경우
    if (currentMilestone > lastGachaExp && profile.totalExp >= 50) {
      setCanGacha(true);
      setShowGachaBubble(true);
      setBubbleMessage(GACHA_MESSAGES[Math.floor(Math.random() * GACHA_MESSAGES.length)]);
    } else {
      setCanGacha(false);
      setShowGachaBubble(false);
    }
  }, [profile?.totalExp, profile?.lastGachaExp]);

  // 사용자 캐릭터 정보 구독
  useEffect(() => {
    if (!profile) return;

    if (profile.currentCharacterIndex !== undefined && profile.currentCharacterName) {
      setUserCharacter({
        characterIndex: profile.currentCharacterIndex,
        characterName: profile.currentCharacterName,
      });
    } else {
      // 기본 캐릭터 (처음 시작)
      setUserCharacter({
        characterIndex: 0,
        characterName: '기본토끼',
      });
    }
  }, [profile?.currentCharacterIndex, profile?.currentCharacterName]);

  // 도감 데이터 구독
  useEffect(() => {
    if (!userCourseId) return;

    const q = query(
      collection(db, 'characterDiscoveries'),
      where('courseId', '==', userCourseId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as CharacterDiscovery[];
      setDiscoveries(data);
    });

    return () => unsubscribe();
  }, [userCourseId]);

  // 뽑기 실행
  const handleGacha = async () => {
    if (!profile || !userCourseId || !canGacha) return;

    setIsGachaAnimating(true);

    // 랜덤 캐릭터 선택 (0-29)
    const randomIndex = Math.floor(Math.random() * 30);

    // 이미 발견된 캐릭터인지 확인
    const existingDiscovery = discoveries.find(d => d.characterIndex === randomIndex);
    const isNew = !existingDiscovery;

    // 약간의 딜레이 후 결과 표시
    await new Promise(resolve => setTimeout(resolve, 2000));

    setGachaResult({
      characterIndex: randomIndex,
      isNew,
      name: existingDiscovery?.characterName || '',
    });
    setIsGachaAnimating(false);
  };

  // 새 캐릭터 이름 지정 및 저장
  const handleNameCharacter = async () => {
    if (!profile || !userCourseId || !gachaResult || !newCharacterName.trim()) return;

    const characterName = newCharacterName.trim();

    try {
      // 1. 도감에 새 캐릭터 등록
      if (gachaResult.isNew) {
        await addDoc(collection(db, 'characterDiscoveries'), {
          characterIndex: gachaResult.characterIndex,
          characterName,
          discoveredBy: profile.uid,
          discovererNickname: profile.nickname,
          courseId: userCourseId,
          discoveredAt: serverTimestamp(),
        });
      }

      // 2. 사용자 프로필 업데이트
      await updateDoc(doc(db, 'users', profile.uid), {
        currentCharacterIndex: gachaResult.characterIndex,
        currentCharacterName: gachaResult.isNew ? characterName : gachaResult.name,
        lastGachaExp: Math.floor(profile.totalExp / 50) * 50,
      });

      // 3. 상태 초기화
      setGachaResult(null);
      setNewCharacterName('');
      setShowGachaModal(false);
      setCanGacha(false);
      setShowGachaBubble(false);
    } catch (error) {
      console.error('캐릭터 저장 실패:', error);
    }
  };

  // 기존 캐릭터 선택 (이미 발견된 캐릭터 뽑은 경우)
  const handleSelectExistingCharacter = async () => {
    if (!profile || !gachaResult) return;

    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        currentCharacterIndex: gachaResult.characterIndex,
        currentCharacterName: gachaResult.name,
        lastGachaExp: Math.floor(profile.totalExp / 50) * 50,
      });

      setGachaResult(null);
      setShowGachaModal(false);
      setCanGacha(false);
      setShowGachaBubble(false);
    } catch (error) {
      console.error('캐릭터 선택 실패:', error);
    }
  };

  // 반별 배경색 (placeholder)
  const classBackgrounds: Record<string, string> = {
    A: '#FEE2E2', // 연한 빨강
    B: '#FEF9C3', // 연한 노랑
    C: '#DCFCE7', // 연한 초록
    D: '#DBEAFE', // 연한 파랑
  };

  return (
    <>
      {/* 캐릭터 박스 */}
      <div
        className="relative border-2 border-[#1A1A1A] overflow-hidden"
        style={{ backgroundColor: theme.colors.backgroundCard }}
      >
        {/* 상단: 총 XP + 도감 아이콘 */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#D4CFC4]">
          <div className="flex items-center gap-1">
            <span className="text-xs text-[#5C5C5C]">총</span>
            <span className="font-bold text-[#1A1A1A]">{totalExp.toLocaleString()}</span>
            <span className="text-xs text-[#5C5C5C]">XP</span>
          </div>
          <button
            onClick={() => setShowDogam(true)}
            className="p-2 hover:bg-[#EDEAE4] transition-colors"
            title="도감"
          >
            <svg className="w-6 h-6 text-[#1A1A1A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </button>
        </div>

        {/* 캐릭터 영역 */}
        <div
          className="relative h-64 flex items-center justify-center"
          style={{ backgroundColor: classBackgrounds[classType] || '#F5F0E8' }}
        >
          {/* 배경 이미지 placeholder */}
          <div className="absolute inset-0 flex items-center justify-center opacity-20">
            <span className="text-6xl">🌿</span>
          </div>

          {/* 캐릭터 (MP4 placeholder → 이모지) */}
          <div className="relative z-10">
            <div className="text-9xl grayscale-[10%]">🐰</div>

            {/* 뽑기 말풍선 */}
            <AnimatePresence>
              {showGachaBubble && (
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  onClick={() => setShowGachaModal(true)}
                  className="absolute -top-16 left-1/2 -translate-x-1/2 px-4 py-2 bg-white border-2 border-[#1A1A1A] whitespace-nowrap"
                  style={{
                    boxShadow: '3px 3px 0 #1A1A1A',
                  }}
                >
                  <span className="text-sm font-bold">{bubbleMessage}</span>
                  {/* 말풍선 꼬리 */}
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-r-2 border-b-2 border-[#1A1A1A] rotate-45" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 하단: 캐릭터 이름 + EXP 바 */}
        <div className="px-4 py-3">
          <div className="flex justify-between mb-1">
            <span className="text-sm font-bold text-[#1A1A1A]">
              {userCharacter?.characterName || '기본토끼'}
            </span>
            <span className="text-sm text-[#5C5C5C]">
              {currentExp}/50 XP
            </span>
          </div>
          <div
            className="h-3 overflow-hidden"
            style={{
              backgroundColor: '#D4CFC4',
              border: '1px solid #1A1A1A',
            }}
          >
            <motion.div
              className="h-full"
              style={{ backgroundColor: theme.colors.accent }}
              initial={{ width: 0 }}
              animate={{ width: `${(currentExp / 50) * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>

      {/* 뽑기 모달 */}
      <AnimatePresence>
        {showGachaModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          >
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.8 }}
              className="w-full max-w-sm mx-4 bg-[#F5F0E8] border-2 border-[#1A1A1A] p-6"
            >
              {isGachaAnimating ? (
                // 뽑기 애니메이션
                <div className="text-center py-12">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="text-8xl inline-block"
                  >
                    🎰
                  </motion.div>
                  <p className="mt-4 font-bold">뽑는 중...</p>
                </div>
              ) : gachaResult ? (
                // 결과 표시
                <div className="text-center">
                  <div className="text-8xl mb-4">🐰</div>

                  {gachaResult.isNew ? (
                    // 새 캐릭터 발견
                    <>
                      <div className="mb-4">
                        <span className="px-3 py-1 bg-[#D4AF37] text-white text-sm font-bold">
                          NEW!
                        </span>
                      </div>
                      <p className="text-lg font-bold mb-4">새로운 캐릭터 발견!</p>
                      <p className="text-sm text-[#5C5C5C] mb-4">이름을 지어주세요</p>
                      <input
                        type="text"
                        value={newCharacterName}
                        onChange={(e) => setNewCharacterName(e.target.value)}
                        placeholder="캐릭터 이름"
                        maxLength={10}
                        className="w-full p-3 border-2 border-[#1A1A1A] text-center text-lg font-bold mb-4"
                      />
                      <button
                        onClick={handleNameCharacter}
                        disabled={!newCharacterName.trim()}
                        className="w-full py-3 bg-[#1A1A1A] text-white font-bold disabled:opacity-50"
                      >
                        확정하기
                      </button>
                    </>
                  ) : (
                    // 기존 캐릭터
                    <>
                      <p className="text-lg font-bold mb-2">{gachaResult.name}</p>
                      <p className="text-sm text-[#5C5C5C] mb-4">
                        이미 발견된 캐릭터예요!
                      </p>
                      <button
                        onClick={handleSelectExistingCharacter}
                        className="w-full py-3 bg-[#1A1A1A] text-white font-bold"
                      >
                        이 캐릭터로 변경하기
                      </button>
                    </>
                  )}
                </div>
              ) : (
                // 뽑기 시작 화면
                <div className="text-center">
                  <div className="text-8xl mb-4">🎁</div>
                  <p className="text-lg font-bold mb-2">뽑기 준비 완료!</p>
                  <p className="text-sm text-[#5C5C5C] mb-6">
                    50 XP를 달성했어요!<br />
                    새로운 캐릭터를 만나보세요
                  </p>
                  <button
                    onClick={handleGacha}
                    className="w-full py-3 bg-[#1A1A1A] text-white font-bold"
                  >
                    뽑기!
                  </button>
                  <button
                    onClick={() => setShowGachaModal(false)}
                    className="w-full py-2 mt-2 text-[#5C5C5C]"
                  >
                    나중에 하기
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 도감 모달 */}
      <AnimatePresence>
        {showDogam && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setShowDogam(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[80vh] bg-[#F5F0E8] border-2 border-[#1A1A1A] flex flex-col"
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between p-4 border-b-2 border-[#1A1A1A]">
                <span className="font-bold text-lg">📚 캐릭터 도감</span>
                <span className="text-sm text-[#5C5C5C]">
                  {discoveries.length}/30 발견
                </span>
              </div>

              {/* 도감 그리드 */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-5 gap-2">
                  {Array.from({ length: 30 }).map((_, index) => {
                    const discovery = discoveries.find(d => d.characterIndex === index);

                    return (
                      <div
                        key={index}
                        className={`aspect-square border-2 flex flex-col items-center justify-center p-1 ${
                          discovery ? 'border-[#1A1A1A] bg-[#EDEAE4]' : 'border-[#D4CFC4] bg-[#E5E0D8]'
                        }`}
                      >
                        {discovery ? (
                          <>
                            <span className="text-2xl">🐰</span>
                            <span className="text-[8px] truncate w-full text-center mt-1">
                              {discovery.characterName}
                            </span>
                            <span className="text-[6px] text-[#5C5C5C]">
                              {discovery.discovererNickname}
                            </span>
                          </>
                        ) : (
                          <span className="text-2xl text-[#D4CFC4]">?</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 닫기 버튼 */}
              <div className="p-4 border-t border-[#D4CFC4]">
                <button
                  onClick={() => setShowDogam(false)}
                  className="w-full py-2 border-2 border-[#1A1A1A] font-bold"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
