'use client';

/**
 * PDF PiP 창 — 화면 위에 둥둥 떠 있는 독립 윈도우.
 *
 * 제스처:
 * - 탭(단일 pointer, 움직임 없음) → 오버레이 토글
 * - 좌우 스와이프(단일 pointer, 수평 > 50px) → 페이지 이동 (오버레이 무관)
 * - 두 손가락 핀치 → 크기 조절 (오버레이 무관)
 * - 오버레이 상태에서 상단 드래그바 포인터 → 창 이동
 * - 오버레이 상태 + PC → 4모서리 핸들 리사이즈 (터치는 핀치로 대체)
 *
 * 렌더링: pdfjs-dist 로 현재 페이지만 canvas에 그림. 페이지 변경 시 재그림.
 * 크기 변경 시: 창 크기에 맞춰 재렌더 (디바운스로 리사이즈 중 과다 렌더 방지).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPdfBlob, type PdfGeom } from '@/lib/repositories/indexedDb/pdfStore';
import { usePdfViewerStore } from '@/lib/stores/pdfViewerStore';
import { getPdfjs } from '@/lib/utils/pdfjs';

interface Props {
  pdfId: string;
  pdfName: string;
  /** PDF 첫 페이지 aspect (w/h) — 창 크기 조절 시 비율 고정용. 검정 여백 방지 */
  aspect: number;
  geom: PdfGeom;
}

const MIN_W = 200;
const MIN_H = 200;
const MAX_W_RATIO = 0.95;
const MAX_H_RATIO = 0.95;
const TAP_THRESHOLD_PX = 8;
const SWIPE_THRESHOLD_PX = 50;

export default function PdfPipWindow({ pdfId, pdfName, aspect, geom }: Props) {
  // closePdf는 오버레이 X 제거 후 미사용 — 사이드바의 ✕로만 닫음
  const updateWindowGeom = usePdfViewerStore((s) => s.updateWindowGeom);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<import('pdfjs-dist').RenderTask | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [overlayOn, setOverlayOn] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 최신 geom을 제스처 핸들러에서 읽기 위해 ref로 미러
  const geomRef = useRef(geom);
  geomRef.current = geom;

  // ── PDF 로드 ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const blob = await getPdfBlob(pdfId);
        if (!blob) throw new Error('파일을 찾을 수 없음');
        const buffer = await blob.arrayBuffer();
        const pdfjs = await getPdfjs();
        const doc = await pdfjs.getDocument({ data: buffer }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        pdfDocRef.current = doc;
        setPageCount(doc.numPages);
        setCurrentPage(1);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [pdfId]);

  // ── 페이지 렌더 (현재 페이지 + 창 크기 기준) ───────────────
  const renderPage = useCallback(async () => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;

    try {
      // 이전 렌더 취소
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await doc.getPage(currentPage);
      const viewport1 = page.getViewport({ scale: 1 });
      // 창 내부 크기에 맞춰 스케일
      const targetW = geomRef.current.w;
      const targetH = geomRef.current.h;
      const scaleX = targetW / viewport1.width;
      const scaleY = targetH / viewport1.height;
      const scale = Math.min(scaleX, scaleY); // 원본 비율 유지

      const viewport = page.getViewport({ scale });
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
    } catch (err) {
      // cancel 에러는 정상
      const name = (err as { name?: string })?.name;
      if (name !== 'RenderingCancelledException') {
        console.error('[PdfPipWindow] render 실패:', err);
      }
    }
  }, [currentPage]);

  // 페이지 또는 창 크기 변경 시 재렌더 (크기 변경은 디바운스)
  useEffect(() => {
    if (isLoading || !pdfDocRef.current) return;
    const t = setTimeout(() => renderPage(), 80);
    return () => clearTimeout(t);
  }, [renderPage, isLoading, geom.w, geom.h]);

  // 페이지 변경 핸들러
  const nextPage = useCallback(() => {
    setCurrentPage((p) => Math.min(p + 1, pageCount));
  }, [pageCount]);
  const prevPage = useCallback(() => {
    setCurrentPage((p) => Math.max(p - 1, 1));
  }, []);

  // 키보드 ←→
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevPage();
      else if (e.key === 'ArrowRight') nextPage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextPage, prevPage]);

  // ── 제스처 (pointer events) ────────────────────────────────
  // 포인터 추적: 동시 여러 개(핀치)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  // 첫 포인터의 다운 지점 (탭/스와이프 판정용)
  const tapStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // 핀치 시작 거리/크기
  const pinchStartRef = useRef<{ dist: number; w: number; h: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (pointersRef.current.size === 1) {
      tapStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      pinchStartRef.current = null;
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchStartRef.current = {
        dist: Math.hypot(dx, dy),
        w: geomRef.current.w,
        h: geomRef.current.h,
      };
      // 핀치 시작 시 탭 판정 무효화
      tapStartRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      if (pinchStartRef.current.dist <= 0) return;
      const scale = dist / pinchStartRef.current.dist;
      // PDF aspect(w/h) 고정 — 두 손가락 거리만 크기 스케일에 사용, 항상 비율 유지
      let newW = Math.max(
        MIN_W,
        Math.min(window.innerWidth * MAX_W_RATIO, pinchStartRef.current.w * scale),
      );
      let newH = newW / aspect;
      // 세로 초과 시 거꾸로 보정
      if (newH > window.innerHeight * MAX_H_RATIO) {
        newH = window.innerHeight * MAX_H_RATIO;
        newW = newH * aspect;
      }
      if (newH < MIN_H) {
        newH = MIN_H;
        newW = newH * aspect;
      }
      updateWindowGeom(pdfId, { w: newW, h: newH });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const start = tapStartRef.current;
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 0 && pinchStartRef.current) {
      pinchStartRef.current = null;
      return;
    }

    // 포인터 하나 남음(=핀치에서 하나 떼기) 재시작
    if (pointersRef.current.size >= 1 && pinchStartRef.current) {
      pinchStartRef.current = null;
      tapStartRef.current = null;
      return;
    }

    // 단일 포인터 종료: 탭 or 스와이프 판정
    if (start && pointersRef.current.size === 0) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < TAP_THRESHOLD_PX && absDy < TAP_THRESHOLD_PX) {
        // 탭 → 오버레이 토글
        setOverlayOn((v) => !v);
      } else if (absDx > SWIPE_THRESHOLD_PX && absDx > absDy) {
        // 좌우 스와이프 → 페이지 이동
        if (dx < 0) nextPage();
        else prevPage();
      }
    }
    tapStartRef.current = null;
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      tapStartRef.current = null;
      pinchStartRef.current = null;
    }
  };

  // ── 오버레이 전용 제스처: 드래그바 이동 + 모서리 리사이즈 ──
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{
    corner: 'tl' | 'tr' | 'bl' | 'br';
    startX: number;
    startY: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const handleMoveBarDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      x: geomRef.current.x,
      y: geomRef.current.y,
    };
    window.addEventListener('pointermove', onWindowDragMove);
    window.addEventListener('pointerup', onWindowDragUp);
  };
  const onWindowDragMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Math.max(0, Math.min(window.innerWidth - geomRef.current.w, d.x + (e.clientX - d.startX)));
    const ny = Math.max(0, Math.min(window.innerHeight - geomRef.current.h, d.y + (e.clientY - d.startY)));
    updateWindowGeom(pdfId, { x: nx, y: ny });
  };
  const onWindowDragUp = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onWindowDragMove);
    window.removeEventListener('pointerup', onWindowDragUp);
  };

  const handleResizeDown = (corner: 'tl' | 'tr' | 'bl' | 'br') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    resizeRef.current = {
      corner,
      startX: e.clientX,
      startY: e.clientY,
      x: geomRef.current.x,
      y: geomRef.current.y,
      w: geomRef.current.w,
      h: geomRef.current.h,
    };
    window.addEventListener('pointermove', onWindowResizeMove);
    window.addEventListener('pointerup', onWindowResizeUp);
  };
  const onWindowResizeMove = (e: PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const dx = e.clientX - r.startX;
    const dy = e.clientY - r.startY;
    // aspect lock — 대각선 거리로 스케일 결정 후 h = w / aspect
    // 각 코너별 w의 증감 방향을 부호로 반영
    const signW = r.corner === 'tr' || r.corner === 'br' ? 1 : -1;
    const signH = r.corner === 'bl' || r.corner === 'br' ? 1 : -1;
    // 사용자가 더 크게 움직인 축을 주 드라이버로 채택
    const wCand = Math.max(MIN_W, r.w + signW * dx);
    const hCand = Math.max(MIN_H, r.h + signH * dy);
    // 둘 중 실제 비율에 맞게 조정 — w 기준 우선
    let w = wCand;
    let h = w / aspect;
    if (Math.abs(h - r.h) < Math.abs(hCand - r.h)) {
      // h 기준 움직임이 더 큼 → h 기준으로 w 재계산
      h = hCand;
      w = h * aspect;
    }
    let x = r.x;
    let y = r.y;
    // 좌측 코너면 x 보정, 상단 코너면 y 보정 (대각선 반대 지점 고정)
    if (r.corner === 'bl' || r.corner === 'tl') x = r.x + (r.w - w);
    if (r.corner === 'tr' || r.corner === 'tl') y = r.y + (r.h - h);
    // 화면 경계 제한
    w = Math.min(w, window.innerWidth * MAX_W_RATIO);
    h = Math.min(h, window.innerHeight * MAX_H_RATIO);
    updateWindowGeom(pdfId, { x, y, w, h });
  };
  const onWindowResizeUp = () => {
    resizeRef.current = null;
    window.removeEventListener('pointermove', onWindowResizeMove);
    window.removeEventListener('pointerup', onWindowResizeUp);
  };

  // 언마운트 정리
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onWindowDragMove);
      window.removeEventListener('pointerup', onWindowDragUp);
      window.removeEventListener('pointermove', onWindowResizeMove);
      window.removeEventListener('pointerup', onWindowResizeUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      className="fixed bg-[#1A1A1A] shadow-2xl overflow-hidden select-none touch-none"
      style={{
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.h,
        zIndex: 200,
        borderRadius: 8,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* PDF 캔버스 — 중앙 정렬 */}
      <div className="w-full h-full flex items-center justify-center bg-[#1A1A1A]">
        {isLoading && (
          <div className="text-white/60 text-xs">로딩…</div>
        )}
        {loadError && (
          <div className="text-red-400 text-xs px-4 text-center">{loadError}</div>
        )}
        {!isLoading && !loadError && <canvas ref={canvasRef} />}
      </div>

      {/* 오버레이 — 탭 토글, 재탭까지 유지.
          독립 뉴스 캐러셀 헤더 스타일(검정+세리프+대시) + 창 이동 드래그 영역 겸용.
          X/좌우 화살표/하단바 없음(사이드바에서 닫기, 스와이프·키보드로 페이지 이동).
          모서리 4개 리사이즈 핸들은 유지(PC 전용 편의). */}
      {overlayOn && !isLoading && !loadError && (
        <>
          {/* 뉴스 헤더 = 파일명 + 드래그 영역 */}
          <div
            onPointerDown={handleMoveBarDown}
            className="absolute top-0 left-0 right-0 bg-[#1A1A1A] text-[#F5F0E8] px-3 py-1.5 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
            style={{ touchAction: 'none' }}
          >
            <div className="text-center w-full">
              <p className="text-[6px] tracking-[0.2em] mb-0.5 opacity-60">━━━━━━━━━━━━━━━━</p>
              <h1 className="font-serif text-base font-black tracking-tight truncate">{pdfName}</h1>
            </div>
          </div>

          {/* 4 모서리 리사이즈 핸들 (PC — 터치는 핀치로 충분, aspect 고정) */}
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <div
              key={c}
              onPointerDown={handleResizeDown(c)}
              className={`absolute w-4 h-4 ${
                c === 'tl' ? 'top-0 left-0 cursor-nwse-resize' :
                c === 'tr' ? 'top-0 right-0 cursor-nesw-resize' :
                c === 'bl' ? 'bottom-0 left-0 cursor-nesw-resize' :
                            'bottom-0 right-0 cursor-nwse-resize'
              }`}
              style={{ touchAction: 'none' }}
            />
          ))}
        </>
      )}
    </div>
  );
}
