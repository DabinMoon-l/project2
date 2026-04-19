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
  /** 스택 z-index (뒤쪽 = 앞, openWindows 인덱스 기반) */
  zIndex: number;
  /** 마지막 페이지 — 재오픈 시 복원 */
  initialPage?: number;
}

const MIN_W = 200;
const MIN_H = 200;
const MAX_W_RATIO = 0.95;
const MAX_H_RATIO = 0.95;
const SWIPE_THRESHOLD_PX = 50;

// 모듈 스코프 상수 — 북마크가 없는 PDF에 대해 매번 새 [] 리터럴을 반환하면
// React 19의 useSyncExternalStore가 snapshot 불일치로 판단해
// "Maximum update depth exceeded" (#185) 에러를 던짐. 동일 참조로 고정.
const EMPTY_BOOKMARKS: number[] = [];

export default function PdfPipWindow({ pdfId, pdfName, aspect, geom, zIndex, initialPage }: Props) {
  const closePdf = usePdfViewerStore((s) => s.closePdf);
  const updateWindowGeom = usePdfViewerStore((s) => s.updateWindowGeom);
  const focusWindow = usePdfViewerStore((s) => s.focusWindow);
  const updateLastPage = usePdfViewerStore((s) => s.updateLastPage);
  const toggleBookmark = usePdfViewerStore((s) => s.toggleBookmark);
  // 이 PDF의 북마크를 store에서 직접 구독 (다른 창/사이드바와 동기화).
  // fallback은 고정된 EMPTY_BOOKMARKS 상수 — 매번 새 [] 리터럴이면 무한 루프.
  const bookmarks = usePdfViewerStore(
    (s) => s.savedPdfs.find((p) => p.id === pdfId)?.bookmarks ?? EMPTY_BOOKMARKS,
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<import('pdfjs-dist').RenderTask | null>(null);

  const [currentPage, setCurrentPage] = useState(initialPage ?? 1);
  const [pageCount, setPageCount] = useState(1);
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
        // initialPage를 범위 내에서 복원 (lastPage가 있으면 그 페이지로)
        setCurrentPage(Math.max(1, Math.min(doc.numPages, initialPage ?? 1)));
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
  // 깜빡임 방지: 오프스크린 캔버스에 먼저 그린 뒤 drawImage로 한 번에 교체.
  // 기존 방식은 canvas.width 할당이 canvas를 clear해 페이지 넘김/리사이즈 때
  // 순간 검정 화면이 보였음.
  const renderPage = useCallback(async () => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;

    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await doc.getPage(currentPage);
      const viewport1 = page.getViewport({ scale: 1 });
      const targetW = geomRef.current.w;
      const targetH = geomRef.current.h;
      const scaleX = targetW / viewport1.width;
      const scaleY = targetH / viewport1.height;
      const scale = Math.min(scaleX, scaleY);

      const viewport = page.getViewport({ scale });
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const bw = Math.floor(viewport.width * dpr);
      const bh = Math.floor(viewport.height * dpr);

      // 오프스크린 캔버스에 렌더
      const off = document.createElement('canvas');
      off.width = bw;
      off.height = bh;
      const offCtx = off.getContext('2d');
      if (!offCtx) return;
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = page.render({ canvasContext: offCtx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;

      // 완성된 오프스크린을 가시 canvas에 한 번에 copy.
      // width 변경이 꼭 필요한 경우에만(리사이즈로 크기 달라짐), 아니면 drawImage만으로 교체.
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(off, 0, 0);
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name !== 'RenderingCancelledException') {
        console.error('[PdfPipWindow] render 실패:', err);
      }
    }
  }, [currentPage]);

  // 페이지 또는 창 크기 변경 시 재렌더 (크기 변경은 디바운스) + annotations 업데이트도 재렌더
  useEffect(() => {
    if (isLoading || !pdfDocRef.current) return;
    const t = setTimeout(() => renderPage(), 80);
    return () => clearTimeout(t);
  }, [renderPage, isLoading, geom.w, geom.h]);

  // 현재 페이지를 IDB에 persist (디바운스) — 다음 재오픈 시 동일 페이지로
  useEffect(() => {
    if (isLoading) return;
    const t = setTimeout(() => updateLastPage(pdfId, currentPage), 300);
    return () => clearTimeout(t);
  }, [pdfId, currentPage, isLoading, updateLastPage]);

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

    // 단일 포인터 종료: 스와이프 판정 (탭은 아무 동작 안 함 — 헤더/하단바 상시 표시)
    if (start && pointersRef.current.size === 0) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx > SWIPE_THRESHOLD_PX && absDx > absDy) {
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
      className="fixed bg-[#1A1A1A] shadow-2xl select-none touch-none"
      style={{
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.h,
        zIndex,
        // PDF 영역은 네모. 둥근 모서리는 헤더 상단과 하단바 하단에만 있어 flush 유지.
        borderRadius: 0,
        overflow: 'visible',
      }}
      // 어디를 터치/클릭하든 먼저 포커스(캡처 단계) — 겹친 창 중 선택한 것이 최상단으로
      onPointerDownCapture={() => focusWindow(pdfId)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* PDF 캔버스 — 네모 (모서리 둥글리기 없음). 헤더/하단바가 양끝만 둥글림 */}
      <div
        className="relative w-full h-full flex items-center justify-center bg-[#1A1A1A]"
        style={{ overflow: 'hidden' }}
      >
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
          상단 헤더 + 좌상단 북마크 토글 + 하단 페이지 슬라이더(북마크 표식) + 모서리 리사이즈.
          페이지 이동: 스와이프/키보드/슬라이더. 창 닫기: 사이드바 ✕. */}
      {!isLoading && !loadError && (
        <>
          {/* 상단 헤더 — PDF 영역 "바로 위"에 flush. 뉴스 캐러셀 스타일(세리프 + 대시) */}
          <div
            onPointerDown={handleMoveBarDown}
            className="absolute left-0 right-0 bg-[#1A1A1A] text-[#F5F0E8] px-9 py-1.5 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
            style={{ bottom: '100%', touchAction: 'none', borderTopLeftRadius: 8, borderTopRightRadius: 8 }}
          >
            <div className="text-center w-full min-w-0">
              <p className="text-[6px] tracking-[0.2em] mb-0.5 opacity-60">━━━━━━━━━━━━━━━━</p>
              <h1 className="font-serif text-base font-black tracking-tight truncate">{pdfName}</h1>
            </div>

            {/* 좌측 북마크 */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleBookmark(pdfId, currentPage);
              }}
              className="absolute top-1/2 -translate-y-1/2 left-1 w-7 h-7 flex items-center justify-center"
              aria-label={bookmarks.includes(currentPage) ? '북마크 해제' : '북마크 추가'}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4">
                {bookmarks.includes(currentPage) ? (
                  <path d="M6 3h12v18l-6-4.5L6 21V3z" fill="#E53935" stroke="#F5F0E8" strokeWidth={1} />
                ) : (
                  <path d="M6 3h12v18l-6-4.5L6 21V3z" fill="none" stroke="#F5F0E8" strokeWidth={1.8} />
                )}
              </svg>
            </button>

            {/* 우측 닫기 */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closePdf(pdfId);
              }}
              className="absolute top-1/2 -translate-y-1/2 right-1 w-7 h-7 flex items-center justify-center"
              aria-label="닫기"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4">
                <path d="M6 6l12 12M18 6L6 18" stroke="#F5F0E8" strokeWidth={2} strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* 하단 페이지 슬라이더 — PDF 영역 "바로 아래"에 flush */}
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute left-0 right-0 px-3 py-1.5 bg-[#1A1A1A]"
            style={{ top: '100%', borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }}
          >
            <div className="relative h-4 flex items-center">
              <input
                type="range"
                min={1}
                max={pageCount}
                value={currentPage}
                onChange={(e) => setCurrentPage(Number(e.target.value))}
                className="w-full h-1 rounded-full appearance-none bg-white/20 cursor-pointer"
                style={{ accentColor: '#F5F0E8' }}
              />
              {pageCount > 1 && bookmarks.map((bp) => {
                const pct = ((bp - 1) / (pageCount - 1)) * 100;
                return (
                  <div
                    key={bp}
                    className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ left: `${pct}%`, transform: 'translate(-50%, -50%)' }}
                  >
                    <div className="w-1 h-3 bg-[#E53935] rounded-sm" />
                  </div>
                );
              })}
            </div>
            <div className="text-center text-[10px] text-white/60 font-mono leading-tight">
              {currentPage} / {pageCount}
            </div>
          </div>

          {/* 4 모서리 리사이즈 핸들 (PC — 터치는 핀치로 충분, aspect 고정).
              24px 히트 영역 + hover 시 흰 L자 힌트로 위치 안내. */}
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <div
              key={c}
              onPointerDown={handleResizeDown(c)}
              className={`group absolute w-6 h-6 ${
                c === 'tl' ? 'top-0 left-0 cursor-nwse-resize' :
                c === 'tr' ? 'top-0 right-0 cursor-nesw-resize' :
                c === 'bl' ? 'bottom-0 left-0 cursor-nesw-resize' :
                            'bottom-0 right-0 cursor-nwse-resize'
              }`}
              style={{ touchAction: 'none' }}
            >
              <div
                className={`absolute w-3 h-3 border-white/70 opacity-0 group-hover:opacity-100 transition-opacity ${
                  c === 'tl' ? 'top-1 left-1 border-l-2 border-t-2' :
                  c === 'tr' ? 'top-1 right-1 border-r-2 border-t-2' :
                  c === 'bl' ? 'bottom-1 left-1 border-l-2 border-b-2' :
                              'bottom-1 right-1 border-r-2 border-b-2'
                }`}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
