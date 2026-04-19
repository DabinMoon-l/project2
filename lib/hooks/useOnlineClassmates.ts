'use client';

/**
 * 같은 과목의 접속 학생 목록 구독
 *
 * 데이터 소스:
 *  - Firestore users (courseId 일치, role != professor) — 닉네임/반/첫장착토끼 1회 로드
 *  - Firestore rabbitHoldings + rabbits — 첫 장착 토끼의 레벨·이름 1회 로드
 *  - RTDB presence/{courseId} — online/currentActivity 실시간 구독
 *
 * 배틀 신청 바텀시트 외에도 재사용 가능한 형태로 분리.
 * 반환 시 바쁨(퀴즈 풀이·배틀·연타) 판정을 포함해 클라이언트가 즉시 UI에 사용.
 */

import { useEffect, useMemo, useState } from 'react';
import { ref as rtdbRef, onValue } from 'firebase/database';
import {
  collection, query, where, getDocs, doc, getDoc, db,
} from '@/lib/repositories';
import { getRtdb } from '@/lib/firebase';
import { computeRabbitDisplayName } from '@/lib/utils/rabbitDisplayName';

const BUSY_ACTIVITIES = new Set(['퀴즈 풀이', '배틀', '연타 미니게임', '집중 학습']);
/** 5분 이내 활동 신호가 없으면 오프라인 간주. onDisconnect(60~90s)로 못 잡히는 잔존 정리 */
const ONLINE_FRESHNESS_MS = 5 * 60 * 1000;

export interface OnlineClassmate {
  uid: string;
  nickname: string;
  classType: string | null;
  rabbitId: number;
  rabbitName: string;
  rabbitLevel: number;
  currentActivity: string | null;
  isBusy: boolean;
}

interface BaseInfo {
  nickname: string;
  classType: string | null;
  rabbitId: number;
}

interface RabbitMeta {
  level: number;
  displayName: string;
}

async function loadStudents(courseId: string, myUid: string): Promise<Record<string, BaseInfo>> {
  const snap = await getDocs(
    query(collection(db, 'users'), where('courseId', '==', courseId)),
  );
  const map: Record<string, BaseInfo> = {};
  snap.forEach((d) => {
    if (d.id === myUid) return;
    const data = d.data();
    if (data.role === 'professor') return;
    const equipped: Array<{ rabbitId: number; courseId: string }> = data.equippedRabbits || [];
    map[d.id] = {
      nickname: data.nickname || '플레이어',
      classType: data.classType || null,
      rabbitId: equipped[0]?.rabbitId ?? 0,
    };
  });
  return map;
}

async function loadRabbitMeta(uid: string, courseId: string, rabbitId: number): Promise<RabbitMeta> {
  const holdingId = `${courseId}_${rabbitId}`;
  const [holdingSnap, rabbitSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid, 'rabbitHoldings', holdingId)),
    getDoc(doc(db, 'rabbits', holdingId)),
  ]);
  const holding = holdingSnap.exists() ? holdingSnap.data() : null;
  const rabbit = rabbitSnap.exists() ? rabbitSnap.data() : null;
  return {
    level: holding?.level || 1,
    displayName: computeRabbitDisplayName(rabbit?.name, holding?.discoveryOrder || 1, rabbitId),
  };
}

/**
 * 같은 과목의 접속 학생 목록을 실시간으로 반환.
 * enabled=false면 구독 안 함 (시트가 닫혀있을 때 부하 줄이기).
 */
export function useOnlineClassmates(
  courseId: string | undefined,
  myUid: string | undefined,
  enabled: boolean,
): { users: OnlineClassmate[]; loading: boolean } {
  const [baseMap, setBaseMap] = useState<Record<string, BaseInfo>>({});
  const [rabbitMetaMap, setRabbitMetaMap] = useState<Record<string, RabbitMeta>>({});
  const [presenceMap, setPresenceMap] = useState<
    Record<string, { online: boolean; currentActivity: string | null }>
  >({});
  const [loading, setLoading] = useState(false);

  // 학생 기본 정보 1회 로드
  useEffect(() => {
    if (!enabled || !courseId || !myUid) return;
    setLoading(true);
    let cancelled = false;
    loadStudents(courseId, myUid)
      .then((map) => { if (!cancelled) setBaseMap(map); })
      .catch((err) => console.error('[useOnlineClassmates] 학생 로드 실패:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, courseId, myUid]);

  // 토끼 메타 병렬 로드 (baseMap 변동 시)
  useEffect(() => {
    if (!enabled || !courseId) return;
    const uids = Object.keys(baseMap);
    if (uids.length === 0) return;
    let cancelled = false;
    Promise.all(
      uids.map(async (uid) => {
        if (rabbitMetaMap[uid]) return [uid, rabbitMetaMap[uid]] as const;
        const meta = await loadRabbitMeta(uid, courseId, baseMap[uid].rabbitId)
          .catch(() => ({ level: 1, displayName: '토끼' }));
        return [uid, meta] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setRabbitMetaMap((prev) => {
        const next = { ...prev };
        entries.forEach(([uid, meta]) => { next[uid] = meta; });
        return next;
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMap, enabled, courseId]);

  // presence 실시간 구독 — online 플래그 + lastActiveAt freshness 둘 다 봐야
  // 비정상 종료로 stale된 유저 걸러짐
  useEffect(() => {
    if (!enabled || !courseId) return;
    const unsub = onValue(rtdbRef(getRtdb(), `presence/${courseId}`), (snap) => {
      const raw = (snap.val() || {}) as Record<
        string,
        { online?: boolean; lastActiveAt?: number; currentActivity?: string }
      >;
      const now = Date.now();
      const map: Record<string, { online: boolean; currentActivity: string | null }> = {};
      Object.entries(raw).forEach(([uid, v]) => {
        const fresh = typeof v?.lastActiveAt === 'number'
          && now - v.lastActiveAt < ONLINE_FRESHNESS_MS;
        map[uid] = {
          online: !!v?.online && fresh,
          currentActivity: v?.currentActivity || null,
        };
      });
      setPresenceMap(map);
    });
    return () => unsub();
  }, [enabled, courseId]);

  const users = useMemo<OnlineClassmate[]>(() => {
    const list: OnlineClassmate[] = [];
    Object.entries(baseMap).forEach(([uid, base]) => {
      const pres = presenceMap[uid];
      if (!pres?.online) return;
      const meta = rabbitMetaMap[uid];
      list.push({
        uid,
        nickname: base.nickname,
        classType: base.classType,
        rabbitId: base.rabbitId,
        rabbitName: meta?.displayName || '토끼',
        rabbitLevel: meta?.level || 1,
        currentActivity: pres.currentActivity,
        isBusy: !!pres.currentActivity && BUSY_ACTIVITIES.has(pres.currentActivity),
      });
    });
    list.sort((a, b) => Number(a.isBusy) - Number(b.isBusy) || a.nickname.localeCompare(b.nickname));
    return list;
  }, [baseMap, presenceMap, rabbitMetaMap]);

  return { users, loading };
}
