import type { Metadata } from 'next';
import { adminDb } from '@/lib/firebaseAdmin';
import SharedPostClient from './SharedPostClient';

// 카톡/SNS 공유 시 미리보기용 OG 메타데이터
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;

  try {
    const postSnap = await adminDb.collection('posts').doc(id).get();
    if (!postSnap.exists) {
      return { title: 'RabbiTory', description: '게시글을 찾을 수 없습니다.' };
    }

    const data = postSnap.data()!;
    const content = (data.content as string || '').slice(0, 120);
    const image = data.imageUrl || data.imageUrls?.[0];

    return {
      title: data.title || 'RabbiTory',
      description: content,
      openGraph: {
        title: data.title || 'RabbiTory',
        description: content,
        siteName: 'RabbiTory',
        ...(image ? { images: [{ url: image }] } : {}),
      },
    };
  } catch {
    return { title: 'RabbiTory', description: '게시글 공유' };
  }
}

export default async function SharedPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SharedPostClient postId={id} />;
}
