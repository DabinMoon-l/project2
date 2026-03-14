/**
 * Storage Repository — Firebase Storage 구현체
 *
 * 파일 업로드/다운로드 접근을 추상화
 */

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  type StorageReference,
} from 'firebase/storage';
import { storage } from '@/lib/firebase';

/** 파일 업로드 */
export async function upload(
  path: string,
  data: Blob | Uint8Array | ArrayBuffer,
  metadata?: Record<string, string>,
): Promise<string> {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, data, metadata ? { customMetadata: metadata } : undefined);
  return getDownloadURL(storageRef);
}

/** 다운로드 URL 가져오기 */
export async function getUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}

/** 파일 삭제 */
export async function remove(path: string): Promise<void> {
  await deleteObject(ref(storage, path));
}
