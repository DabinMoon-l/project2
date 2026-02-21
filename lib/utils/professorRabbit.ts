/**
 * 교수님 전용 토끼 시스템 — localStorage 기반
 * 학생 시스템과 완전 독립 (Firestore 무관)
 */

const STORAGE_KEY = 'professor_rabbits';

interface ProfessorRabbitData {
  /** 장착된 토끼 rabbitId (최대 2) */
  equipped: number[];
  /** 교수님이 지은 이름 */
  names: Record<number, string>;
  /** 비고 메모 */
  notes: Record<number, string>;
}

function getData(): ProfessorRabbitData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* 무시 */ }
  return { equipped: [], names: {}, notes: {} };
}

function setData(data: ProfessorRabbitData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** 장착된 토끼 목록 */
export function getProfessorEquipped(): number[] {
  return getData().equipped;
}

/** 장착 설정 */
export function setProfessorEquipped(equipped: number[]) {
  const data = getData();
  data.equipped = equipped.slice(0, 2);
  setData(data);
}

/** 토끼 장착 (슬롯에 추가/교체) */
export function equipProfessorRabbit(rabbitId: number, slotIndex?: number) {
  const data = getData();
  // 이미 장착된 경우 무시
  if (data.equipped.includes(rabbitId)) return data.equipped;

  if (data.equipped.length < 2) {
    data.equipped.push(rabbitId);
  } else if (slotIndex !== undefined && slotIndex >= 0 && slotIndex < 2) {
    data.equipped[slotIndex] = rabbitId;
  }
  setData(data);
  return data.equipped;
}

/** 토끼 이름 가져오기 */
export function getProfessorRabbitName(rabbitId: number): string {
  return getData().names[rabbitId] || '';
}

/** 토끼 이름 설정 */
export function setProfessorRabbitName(rabbitId: number, name: string) {
  const data = getData();
  if (name.trim()) {
    data.names[rabbitId] = name.trim();
  } else {
    delete data.names[rabbitId];
  }
  setData(data);
}

/** 토끼 비고 가져오기 */
export function getProfessorRabbitNote(rabbitId: number): string {
  return getData().notes[rabbitId] || '';
}

/** 토끼 비고 설정 */
export function setProfessorRabbitNote(rabbitId: number, note: string) {
  const data = getData();
  if (note.trim()) {
    data.notes[rabbitId] = note.trim();
  } else {
    delete data.notes[rabbitId];
  }
  setData(data);
}

/** 전체 데이터 */
export function getAllProfessorRabbitData(): ProfessorRabbitData {
  return getData();
}
