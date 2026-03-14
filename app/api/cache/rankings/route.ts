import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

/**
 * GET /api/cache/rankings?courseId=biology
 *
 * 랭킹 데이터를 CDN 캐시 경유로 제공 (Vercel edge s-maxage=300)
 * Firestore 직접 읽기 대비 대량 동시접속 시 읽기 비용 절감
 */
export async function GET(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get('courseId');
  if (!courseId) {
    return NextResponse.json({ error: 'courseId required' }, { status: 400 });
  }

  try {
    const doc = await adminDb.doc(`rankings/${courseId}`).get();
    if (!doc.exists) {
      return NextResponse.json({ data: null }, {
        status: 200,
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
      });
    }

    return NextResponse.json({ data: doc.data() }, {
      status: 200,
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    console.error('랭킹 캐시 API 오류:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
