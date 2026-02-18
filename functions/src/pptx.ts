/**
 * PPTX 퀴즈 생성 Cloud Functions
 * - Firestore 트리거로 quizJobs 문서 생성 감지
 * - Cloud Run 서비스 호출하여 PPTX 처리
 * - 서비스 계정 인증으로 Cloud Run 호출
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";

// 리전 설정
const REGION = "asia-northeast3";

interface QuizJobData {
  jobId: string;
  storagePath: string;
  userId: string;
  folderName: string;
  difficulty: "easy" | "medium" | "hard";
  questionCount: number;
  tags: string[];
  keywords?: string[]; // 추출된 키워드
  status: string;
  createdAt: FirebaseFirestore.Timestamp;
}

/**
 * quizJobs 문서 생성 시 Cloud Run 서비스 호출
 * PPTX 파일 처리 및 퀴즈 생성 트리거
 */
export const onPptxJobCreated = onDocumentCreated(
  {
    document: "quizJobs/{jobId}",
    region: REGION,
    timeoutSeconds: 540, // 9분 (Cloud Run 처리 시간 고려)
    memory: "256MiB",
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("문서 데이터가 없습니다.");
      return;
    }

    const data = snapshot.data() as QuizJobData;
    const jobId = event.params.jobId;

    // PPTX 파일만 처리 (storagePath에 .pptx 확장자 확인)
    if (!data.storagePath?.toLowerCase().endsWith(".pptx")) {
      console.log(`PPTX 파일이 아닙니다: ${data.storagePath}`);
      return;
    }

    const db = getFirestore();
    const jobRef = db.collection("quizJobs").doc(jobId);

    try {
      // 상태 업데이트: 처리 시작
      await jobRef.update({
        status: "starting",
        progress: 0,
        message: "Cloud Run 서비스 호출 중...",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Cloud Run 서비스 호출
      const cloudRunUrl = process.env.PPTX_CLOUD_RUN_URL;
      if (!cloudRunUrl) {
        throw new Error("PPTX_CLOUD_RUN_URL 환경 변수가 설정되지 않았습니다.");
      }

      // 서비스 계정으로 ID 토큰 발급 (Cloud Run 인증용)
      const auth = new GoogleAuth();
      const client = await auth.getIdTokenClient(cloudRunUrl);
      const idToken = await client.idTokenProvider.fetchIdToken(cloudRunUrl);

      const response = await fetch(`${cloudRunUrl}/process-pptx`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          jobId,
          storagePath: data.storagePath,
          userId: data.userId,
          folderName: data.folderName,
          difficulty: data.difficulty || "medium",
          questionCount: data.questionCount || 10,
          tags: data.tags || [],
          keywords: data.keywords || [], // 추출된 키워드
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cloud Run 오류: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log(`PPTX 처리 완료: ${jobId}`, result);

      // Cloud Run이 직접 상태를 업데이트하므로 여기서는 추가 작업 불필요

    } catch (error) {
      console.error(`PPTX 처리 실패: ${jobId}`, error);

      // 에러 상태 업데이트
      await jobRef.update({
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "알 수 없는 오류",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);

/**
 * 오래된 quizJobs 정리 (24시간 이상 된 완료/실패 작업)
 * 매일 새벽 3시 실행
 */
import { onSchedule } from "firebase-functions/v2/scheduler";

export const cleanupOldQuizJobs = onSchedule(
  {
    schedule: "0 3 * * *", // 매일 새벽 3시
    region: REGION,
    timeZone: "Asia/Seoul",
  },
  async () => {
    const db = getFirestore();
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // 완료되거나 실패한 오래된 작업 조회
    const oldJobsSnapshot = await db
      .collection("quizJobs")
      .where("status", "in", ["completed", "failed"])
      .where("createdAt", "<", oneDayAgo)
      .limit(100)
      .get();

    if (oldJobsSnapshot.empty) {
      console.log("정리할 quizJobs가 없습니다.");
      return;
    }

    const batch = db.batch();
    oldJobsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`${oldJobsSnapshot.size}개의 오래된 quizJobs 삭제 완료`);
  }
);

/**
 * PPT → PDF 직접 변환 (Callable Function)
 * Storage 미경유 — base64로 PPTX 전송, base64 PDF 수신
 */
export const convertPptxToPdf = onCall(
  { region: REGION, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const { pptxBase64 } = request.data as { pptxBase64: string };
    if (!pptxBase64) {
      throw new HttpsError("invalid-argument", "pptxBase64가 필요합니다.");
    }

    // Cloud Run 서비스 호출
    const cloudRunUrl = process.env.PPTX_CLOUD_RUN_URL;
    if (!cloudRunUrl) {
      throw new HttpsError("internal", "PPTX_CLOUD_RUN_URL 환경 변수가 설정되지 않았습니다.");
    }

    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(cloudRunUrl);
    const idToken = await client.idTokenProvider.fetchIdToken(cloudRunUrl);

    const response = await fetch(`${cloudRunUrl}/convert-to-pdf-direct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify({ pptxBase64 }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new HttpsError("internal", `PDF 변환 실패: ${errorText}`);
    }

    const result = await response.json() as { success: boolean; pdfBase64: string };
    if (!result.success || !result.pdfBase64) {
      throw new HttpsError("internal", "PDF 변환 실패");
    }

    return { pdfBase64: result.pdfBase64 };
  }
);
