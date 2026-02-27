/**
 * 토끼 관련 커스텀 훅
 *
 * - useRabbitHoldings: 사용자의 토끼 보유 목록 구독
 * - useRabbitDoc: 특정 토끼 문서 구독
 * - useRabbitsForCourse: 과목의 전체 토끼 목록 구독 (도감)
 */

'use client';

import { useState, useEffect } from 'react';
import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  orderBy,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ============================================================
// 타입 정의
// ============================================================

/** 토끼 스탯 */
export interface RabbitStats {
  hp: number;
  atk: number;
  def: number;
}

/** 토끼 보유 정보 (서브컬렉션 문서) */
export interface RabbitHolding {
  id: string; // "{courseId}_{rabbitId}"
  rabbitId: number;
  courseId: string;
  discoveryOrder: number; // 1=최초발견, 2+=후속
  discoveredAt: any;
  level?: number;
  stats?: RabbitStats;
}

/** 발견자 정보 */
export interface RabbitDiscoverer {
  userId: string;
  nickname: string;
  discoveryOrder: number;
}

/** 토끼 문서 (rabbits 컬렉션) */
export interface RabbitDoc {
  id: string;
  courseId: string;
  rabbitId: number;
  name: string | null; // 영구 이름 (최초 발견자가 지음)
  firstDiscovererUserId: string;
  firstDiscovererName: string;
  discovererCount: number; // 총 발견자 수
  discoverers: RabbitDiscoverer[]; // 전체 발견자 목록
  createdAt: any;
  updatedAt: any;
}

// ============================================================
// 헬퍼: 홀딩에서 스탯 가져오기 (없으면 베이스 스탯 폴백)
// ============================================================

/**
 * 80마리 고유 베이스 스탯 룩업 테이블 (CF rabbitStats.ts와 동일)
 * 유형: 방어형(16), 공격형(25), 체력형(18), 균형형(21)
 */
const RABBIT_BASE_STATS: RabbitStats[] = [
  { hp: 25, atk: 8,  def: 5  }, // id=0  기본 토끼 (최약)
  { hp: 32, atk: 9,  def: 16 }, // id=1  방어형·일반
  { hp: 36, atk: 12, def: 10 }, // id=2  균형형·일반
  { hp: 27, atk: 17, def: 6  }, // id=3  공격형·일반
  { hp: 29, atk: 16, def: 7  }, // id=4  공격형·일반
  { hp: 52, atk: 10, def: 9  }, // id=5  체력형·일반
  { hp: 34, atk: 8,  def: 15 }, // id=6  방어형·일반
  { hp: 38, atk: 13, def: 9  }, // id=7  균형형·일반
  { hp: 26, atk: 18, def: 5  }, // id=8  공격형·일반
  { hp: 35, atk: 12, def: 11 }, // id=9  균형형·일반
  { hp: 50, atk: 11, def: 10 }, // id=10 체력형·일반
  { hp: 30, atk: 17, def: 7  }, // id=11 공격형·일반
  { hp: 40, atk: 14, def: 10 }, // id=12 균형형·일반
  { hp: 30, atk: 10, def: 14 }, // id=13 방어형·일반
  { hp: 54, atk: 10, def: 8  }, // id=14 체력형·일반
  { hp: 28, atk: 16, def: 8  }, // id=15 공격형·일반
  { hp: 37, atk: 13, def: 11 }, // id=16 균형형·일반
  { hp: 25, atk: 19, def: 6  }, // id=17 공격형·일반
  { hp: 36, atk: 9,  def: 15 }, // id=18 방어형·일반
  { hp: 39, atk: 12, def: 10 }, // id=19 균형형·일반
  { hp: 53, atk: 12, def: 9  }, // id=20 체력형·일반
  { hp: 55, atk: 11, def: 8  }, // id=21 체력형·일반
  { hp: 51, atk: 10, def: 11 }, // id=22 체력형·일반
  { hp: 36, atk: 14, def: 9  }, // id=23 균형형·일반
  { hp: 31, atk: 18, def: 5  }, // id=24 공격형·일반
  { hp: 41, atk: 13, def: 10 }, // id=25 균형형·일반
  { hp: 27, atk: 17, def: 8  }, // id=26 공격형·일반
  { hp: 33, atk: 11, def: 14 }, // id=27 방어형·일반
  { hp: 32, atk: 16, def: 7  }, // id=28 공격형·일반
  { hp: 38, atk: 8,  def: 17 }, // id=29 방어형·일반
  { hp: 56, atk: 11, def: 9  }, // id=30 체력형·일반
  { hp: 29, atk: 18, def: 6  }, // id=31 공격형·일반
  { hp: 26, atk: 19, def: 7  }, // id=32 공격형·일반
  { hp: 35, atk: 10, def: 16 }, // id=33 방어형·일반
  { hp: 33, atk: 17, def: 6  }, // id=34 공격형·일반
  { hp: 38, atk: 12, def: 12 }, // id=35 균형형·일반
  { hp: 35, atk: 14, def: 11 }, // id=36 균형형·일반
  { hp: 31, atk: 9,  def: 17 }, // id=37 방어형·일반
  { hp: 28, atk: 18, def: 7  }, // id=38 공격형·일반
  { hp: 42, atk: 13, def: 9  }, // id=39 균형형·일반
  { hp: 50, atk: 12, def: 10 }, // id=40 체력형·일반
  { hp: 30, atk: 16, def: 9  }, // id=41 공격형·일반
  { hp: 37, atk: 12, def: 13 }, // id=42 균형형·일반
  { hp: 37, atk: 10, def: 15 }, // id=43 방어형·일반
  { hp: 25, atk: 20, def: 5  }, // id=44 공격형·일반
  { hp: 54, atk: 11, def: 10 }, // id=45 체력형·일반
  { hp: 31, atk: 17, def: 8  }, // id=46 공격형·일반
  { hp: 34, atk: 21, def: 8  }, // id=47 공격형·좋음
  { hp: 34, atk: 11, def: 16 }, // id=48 방어형·일반
  { hp: 42, atk: 12, def: 19 }, // id=49 방어형·좋음
  { hp: 40, atk: 13, def: 11 }, // id=50 균형형·일반
  { hp: 45, atk: 16, def: 13 }, // id=51 균형형·좋음
  { hp: 35, atk: 20, def: 9  }, // id=52 공격형·좋음
  { hp: 47, atk: 15, def: 12 }, // id=53 균형형·좋음
  { hp: 52, atk: 12, def: 8  }, // id=54 체력형·일반
  { hp: 44, atk: 16, def: 14 }, // id=55 균형형·좋음
  { hp: 33, atk: 22, def: 7  }, // id=56 공격형·좋음
  { hp: 40, atk: 11, def: 20 }, // id=57 방어형·좋음
  { hp: 53, atk: 10, def: 10 }, // id=58 체력형·일반
  { hp: 60, atk: 13, def: 12 }, // id=59 체력형·좋음
  { hp: 36, atk: 19, def: 10 }, // id=60 공격형·좋음
  { hp: 58, atk: 14, def: 11 }, // id=61 체력형·좋음
  { hp: 32, atk: 21, def: 9  }, // id=62 공격형·좋음
  { hp: 44, atk: 13, def: 18 }, // id=63 방어형·좋음
  { hp: 37, atk: 20, def: 8  }, // id=64 공격형·좋음
  { hp: 41, atk: 12, def: 21 }, // id=65 방어형·좋음
  { hp: 62, atk: 12, def: 13 }, // id=66 체력형·좋음
  { hp: 48, atk: 15, def: 13 }, // id=67 균형형·좋음
  { hp: 46, atk: 16, def: 12 }, // id=68 균형형·좋음
  { hp: 52, atk: 17, def: 15 }, // id=69 균형형·아주좋음
  { hp: 57, atk: 14, def: 12 }, // id=70 체력형·좋음
  { hp: 38, atk: 24, def: 10 }, // id=71 공격형·아주좋음
  { hp: 59, atk: 13, def: 11 }, // id=72 체력형·좋음
  { hp: 65, atk: 15, def: 13 }, // id=73 체력형·아주좋음
  { hp: 46, atk: 14, def: 20 }, // id=74 방어형·아주좋음
  { hp: 35, atk: 25, def: 11 }, // id=75 공격형·아주좋음
  { hp: 40, atk: 23, def: 12 }, // id=76 공격형·아주좋음
  { hp: 48, atk: 13, def: 19 }, // id=77 방어형·아주좋음
  { hp: 53, atk: 18, def: 14 }, // id=78 균형형·아주좋음
  { hp: 66, atk: 16, def: 13 }, // id=79 체력형·아주좋음
];

/** rabbitId 기반 베이스 스탯 (Lv.1) — CF의 getBaseStats와 동일 룩업 테이블 */
function getBaseStats(rabbitId: number): RabbitStats {
  if (rabbitId < 0 || rabbitId >= RABBIT_BASE_STATS.length) {
    return { hp: 25, atk: 8, def: 5 }; // 폴백 = 기본 토끼
  }
  return { ...RABBIT_BASE_STATS[rabbitId] };
}

/** 홀딩에서 실제 스탯 반환 (level/stats 없으면 Lv.1 베이스 폴백) */
export function getRabbitStats(holding: RabbitHolding): { level: number; stats: RabbitStats } {
  return {
    level: holding.level ?? 1,
    stats: holding.stats ?? getBaseStats(holding.rabbitId),
  };
}

// ============================================================
// useRabbitHoldings — 내 토끼 목록 구독
// ============================================================

export function useRabbitHoldings(userId: string | undefined) {
  const [holdings, setHoldings] = useState<RabbitHolding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setHoldings([]);
      setLoading(false);
      return;
    }

    const holdingsRef = collection(db, 'users', userId, 'rabbitHoldings');

    const unsubscribe = onSnapshot(
      holdingsRef,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as RabbitHolding[];
        setHoldings(data);
        setLoading(false);
      },
      (err) => {
        console.error('토끼 보유 목록 구독 에러:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return { holdings, loading };
}

// ============================================================
// useRabbitDoc — 특정 토끼 문서 구독
// ============================================================

export function useRabbitDoc(courseId: string | undefined | null, rabbitId: number | undefined | null) {
  const [rabbit, setRabbit] = useState<RabbitDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId || rabbitId === undefined || rabbitId === null) {
      setRabbit(null);
      setLoading(false);
      return;
    }

    const docId = `${courseId}_${rabbitId}`;
    const rabbitRef = doc(db, 'rabbits', docId);

    const unsubscribe = onSnapshot(
      rabbitRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setRabbit({ id: docSnap.id, ...docSnap.data() } as RabbitDoc);
        } else {
          setRabbit(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('토끼 문서 구독 에러:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [courseId, rabbitId]);

  return { rabbit, loading };
}

// ============================================================
// useRabbitsForCourse — 과목의 전체 토끼 목록 (도감)
// ============================================================

export function useRabbitsForCourse(courseId: string | undefined) {
  const [rabbits, setRabbits] = useState<RabbitDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) {
      setRabbits([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'rabbits'),
      where('courseId', '==', courseId),
      orderBy('rabbitId', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as RabbitDoc[];
        setRabbits(data);
        setLoading(false);
      },
      (err) => {
        console.error('도감 구독 에러:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [courseId]);

  return { rabbits, loading };
}
