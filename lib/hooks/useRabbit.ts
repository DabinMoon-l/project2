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

/** rabbitId 기반 베이스 스탯 (Lv.1) — CF의 getBaseStats와 동일 공식 */
function getBaseStats(rabbitId: number): RabbitStats {
  return {
    hp: 10 + ((rabbitId * 3) % 20),
    atk: 3 + ((rabbitId * 7) % 12),
    def: 2 + ((rabbitId * 5) % 8),
  };
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
