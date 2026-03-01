/**
 * 학번+비밀번호 인증 시스템
 *
 * 교수님이 학생을 사전 등록하고, 학생은 학번+비밀번호로 가입/로그인하는 구조.
 * Firebase Auth의 이메일/비밀번호 인증을 활용하되, 학번을 {학번}@rabbitory.internal로 매핑.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import * as nodemailer from "nodemailer";
import { getBaseStats } from "./utils/rabbitStats";

// 이메일 발송용 시크릿
const GMAIL_ADDRESS = defineSecret("GMAIL_ADDRESS");
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");

// 학번 → Firebase Auth 이메일 변환
const toInternalEmail = (studentId: string) => `${studentId}@rabbitory.internal`;

/**
 * 이메일 전송 유틸리티
 * Gmail SMTP를 사용하여 이메일을 발송합니다.
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const gmailAddress = GMAIL_ADDRESS.value();
  const gmailPassword = GMAIL_APP_PASSWORD.value();

  if (!gmailAddress || !gmailPassword) {
    console.warn("이메일 시크릿이 설정되지 않아 전송을 건너뜁니다.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailAddress,
      pass: gmailPassword,
    },
  });

  await transporter.sendMail({
    from: `RabbiTory <${gmailAddress}>`,
    to,
    subject,
    html,
  });
}

// ============================================================
// 1) bulkEnrollStudents — 교수님 전용: 학생 일괄 등록
// ============================================================

interface EnrollStudent {
  name: string;
  studentId: string;
  classId?: string;
}

export const bulkEnrollStudents = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수님 권한 확인
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 학생을 등록할 수 있습니다.");
    }

    const { courseId, students } = request.data as {
      courseId: string;
      students: EnrollStudent[];
    };

    if (!courseId || !students || !Array.isArray(students) || students.length === 0) {
      throw new HttpsError("invalid-argument", "courseId와 students 배열이 필요합니다.");
    }

    if (students.length > 200) {
      throw new HttpsError("invalid-argument", "한 번에 최대 200명까지 등록 가능합니다.");
    }

    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // 배치 쓰기 (500개 제한 고려)
    const batchSize = 400;
    for (let i = 0; i < students.length; i += batchSize) {
      const chunk = students.slice(i, i + batchSize);
      const batch = db.batch();

      for (const student of chunk) {
        // 유효성 검사 (학번 필수, 이름은 선택)
        if (!student.studentId) {
          errorCount++;
          errors.push(`누락된 필드: 학번 없음`);
          continue;
        }

        if (!/^\d{7,10}$/.test(student.studentId)) {
          errorCount++;
          errors.push(`잘못된 학번 형식: ${student.studentId}`);
          continue;
        }

        if (student.classId && !["A", "B", "C", "D"].includes(student.classId)) {
          errorCount++;
          errors.push(`잘못된 반: ${student.studentId} (${student.classId})`);
          continue;
        }

        const docRef = db
          .collection("enrolledStudents")
          .doc(courseId)
          .collection("students")
          .doc(student.studentId);

        // 중복 체크
        const existing = await docRef.get();
        if (existing.exists) {
          duplicateCount++;
          continue;
        }

        const docData: Record<string, unknown> = {
          name: student.name || "",
          studentId: student.studentId,
          isRegistered: false,
          enrolledAt: FieldValue.serverTimestamp(),
          enrolledBy: request.auth.uid,
        };
        if (student.classId) {
          docData.classId = student.classId;
        }
        batch.set(docRef, docData);

        successCount++;
      }

      await batch.commit();
    }

    console.log(`학생 일괄 등록 완료: ${successCount}명 성공, ${duplicateCount}명 중복, ${errorCount}명 오류`);

    return {
      success: true,
      successCount,
      duplicateCount,
      errorCount,
      errors: errors.slice(0, 10), // 최대 10개까지만 반환
    };
  }
);

// ============================================================
// 2) registerStudent — 학생 회원가입
// ============================================================

export const registerStudent = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    const { studentId, password, courseId, classId, nickname, name } = request.data as {
      studentId: string;
      password: string;
      courseId: string;
      classId: string;
      nickname: string;
      name?: string;
    };

    if (!studentId || !password || !courseId || !classId || !nickname) {
      throw new HttpsError("invalid-argument", "모든 필드를 입력해주세요.");
    }

    // IP 기반 rate limit (학번 열거 공격 방지)
    const db0 = getFirestore();
    const ip = (request.rawRequest as any)?.ip ||
      (request.rawRequest as any)?.headers?.["x-forwarded-for"] || "unknown";
    const ipKey = String(ip).replace(/[./:\\]/g, "_").slice(0, 60);
    const rateLimitRef = db0.collection("rateLimits_v2").doc(`register_${ipKey}`);
    const rateLimitDoc = await rateLimitRef.get();

    if (rateLimitDoc.exists) {
      const rlData = rateLimitDoc.data()!;
      const attempts = rlData.attempts || 0;
      const firstAttempt = rlData.firstAttempt?.toDate?.() || new Date();
      const elapsed = Date.now() - firstAttempt.getTime();

      // 10분 내 5회 초과 시 차단
      if (elapsed < 10 * 60 * 1000 && attempts >= 5) {
        throw new HttpsError("resource-exhausted", "너무 많은 시도입니다. 잠시 후 다시 시도해주세요.");
      }

      if (elapsed >= 10 * 60 * 1000) {
        await rateLimitRef.set({ attempts: 1, firstAttempt: FieldValue.serverTimestamp() });
      } else {
        await rateLimitRef.update({ attempts: FieldValue.increment(1) });
      }
    } else {
      await rateLimitRef.set({ attempts: 1, firstAttempt: FieldValue.serverTimestamp() });
    }

    if (!/^\d{7,10}$/.test(studentId)) {
      throw new HttpsError("invalid-argument", "학번은 7-10자리 숫자입니다.");
    }

    if (password.length < 6) {
      throw new HttpsError("invalid-argument", "비밀번호는 6자 이상이어야 합니다.");
    }

    if (!["A", "B", "C", "D"].includes(classId)) {
      throw new HttpsError("invalid-argument", "올바른 반을 선택해주세요.");
    }

    if (nickname.length < 2 || nickname.length > 10) {
      throw new HttpsError("invalid-argument", "닉네임은 2-10자 사이여야 합니다.");
    }

    const db = getFirestore();
    const adminAuth = getAuth();

    // enrolledStudents에서 학번 확인
    const enrolledRef = db
      .collection("enrolledStudents")
      .doc(courseId)
      .collection("students")
      .doc(studentId);

    const enrolledDoc = await enrolledRef.get();

    if (!enrolledDoc.exists) {
      throw new HttpsError("not-found", "등록되지 않은 학번입니다. 교수님께 문의해주세요.");
    }

    const enrolledData = enrolledDoc.data()!;

    if (enrolledData.isRegistered) {
      throw new HttpsError("already-exists", "이미 가입된 학번입니다.");
    }

    // Firebase Auth 계정 생성
    const email = toInternalEmail(studentId);
    let userRecord;

    try {
      userRecord = await adminAuth.createUser({
        email,
        password,
        displayName: nickname,
        emailVerified: true,
      });
    } catch (error: unknown) {
      const firebaseError = error as { code?: string };
      if (firebaseError.code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "이미 가입된 학번입니다.");
      }
      console.error("Firebase Auth 계정 생성 실패:", error);
      throw new HttpsError("internal", "계정 생성에 실패했습니다.");
    }

    // Firestore users/{uid} 문서 생성 + 기본 토끼 지급 (트랜잭션)
    const uid = userRecord.uid;
    const rabbitId = 0;
    const holdingKey = `${courseId}_${rabbitId}`;
    const userDocRef = db.collection("users").doc(uid);
    const holdingRef = userDocRef.collection("rabbitHoldings").doc(holdingKey);
    const rabbitRef = db.collection("rabbits").doc(holdingKey);
    const displayNickname = nickname || "알 수 없음";

    await db.runTransaction(async (transaction) => {
      // READ: 기본 토끼 문서 확인
      const rabbitDoc = await transaction.get(rabbitRef);

      // WRITE 1: 유저 문서 생성
      transaction.set(userDocRef, {
        email,
        studentId,
        name: name || enrolledData.name || nickname,
        nickname,
        classId,
        courseId,
        role: "student",
        totalExp: 0,
        rank: "견습생",
        onboardingCompleted: true,
        equippedRabbits: [{ rabbitId, courseId }],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // WRITE 2: 기본 토끼 홀딩 생성
      transaction.set(holdingRef, {
        rabbitId,
        courseId,
        discoveryOrder: 1,
        discoveredAt: FieldValue.serverTimestamp(),
        level: 1,
        stats: getBaseStats(rabbitId),
      });

      // WRITE 3: 토끼 문서 생성/업데이트
      if (!rabbitDoc.exists) {
        transaction.set(rabbitRef, {
          rabbitId,
          courseId,
          name: null,
          firstDiscovererUserId: uid,
          firstDiscovererName: displayNickname,
          discovererCount: 1,
          discoverers: [{ userId: uid, nickname: displayNickname, discoveryOrder: 1 }],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        const existingData = rabbitDoc.data()!;
        const nextOrder = (existingData.discovererCount || 1) + 1;
        transaction.update(rabbitRef, {
          discovererCount: nextOrder,
          discoverers: FieldValue.arrayUnion({
            userId: uid,
            nickname: displayNickname,
            discoveryOrder: nextOrder,
          }),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    // enrolledStudents 업데이트
    await enrolledRef.update({
      isRegistered: true,
      registeredUid: uid,
      registeredAt: FieldValue.serverTimestamp(),
    });

    console.log(`학생 가입 완료: ${studentId} → ${uid} (기본 토끼 지급 포함)`);

    return {
      success: true,
      uid,
    };
  }
);

// ============================================================
// 3) resetStudentPassword — 교수님 전용: 비밀번호 초기화
// ============================================================

export const resetStudentPassword = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수님 권한 확인
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 비밀번호를 초기화할 수 있습니다.");
    }

    const { studentId, courseId, newPassword } = request.data as {
      studentId: string;
      courseId: string;
      newPassword: string;
    };

    if (!studentId || !courseId || !newPassword) {
      throw new HttpsError("invalid-argument", "학번, 과목, 새 비밀번호가 필요합니다.");
    }

    if (newPassword.length < 6) {
      throw new HttpsError("invalid-argument", "비밀번호는 6자 이상이어야 합니다.");
    }

    // enrolledStudents에서 uid 확인
    const enrolledRef = db
      .collection("enrolledStudents")
      .doc(courseId)
      .collection("students")
      .doc(studentId);

    const enrolledDoc = await enrolledRef.get();
    if (!enrolledDoc.exists) {
      throw new HttpsError("not-found", "등록되지 않은 학번입니다.");
    }

    const enrolledData = enrolledDoc.data()!;
    if (!enrolledData.isRegistered || !enrolledData.registeredUid) {
      throw new HttpsError("failed-precondition", "아직 가입하지 않은 학생입니다.");
    }

    // Firebase Admin SDK로 비밀번호 변경
    const adminAuth = getAuth();
    try {
      await adminAuth.updateUser(enrolledData.registeredUid, {
        password: newPassword,
      });
    } catch (error) {
      console.error("비밀번호 초기화 실패:", error);
      throw new HttpsError("internal", "비밀번호 초기화에 실패했습니다.");
    }

    console.log(`비밀번호 초기화: ${studentId} by ${request.auth.uid}`);

    return {
      success: true,
      message: `${enrolledData.name}(${studentId})의 비밀번호가 초기화되었습니다.`,
    };
  }
);

// ============================================================
// 4) requestPasswordReset — 비로그인: 학번+이메일로 인증 코드 발송
// ============================================================

export const requestPasswordReset = onCall(
  { region: "asia-northeast3", secrets: [GMAIL_ADDRESS, GMAIL_APP_PASSWORD] },
  async (request) => {
    const { studentId, email, verificationCode, newPassword } = request.data as {
      studentId: string;
      email?: string;
      verificationCode?: string;
      newPassword?: string;
    };

    if (!studentId || !/^\d{7,10}$/.test(studentId)) {
      throw new HttpsError("invalid-argument", "학번은 7-10자리 숫자입니다.");
    }

    const db = getFirestore();
    const adminAuth = getAuth();

    // IP 기반 rate limit (무차별 시도 방지)
    const ip = (request.rawRequest as any)?.ip ||
      (request.rawRequest as any)?.headers?.["x-forwarded-for"] || "unknown";
    const ipKey = String(ip).replace(/[./:\\]/g, "_").slice(0, 60);
    const rateLimitRef = db.collection("rateLimits_v2").doc(`pwreset_${ipKey}`);
    const rateLimitDoc = await rateLimitRef.get();

    if (rateLimitDoc.exists) {
      const rlData = rateLimitDoc.data()!;
      const attempts = rlData.attempts || 0;
      const firstAttempt = rlData.firstAttempt?.toDate?.() || new Date();
      const elapsed = Date.now() - firstAttempt.getTime();

      if (elapsed < 10 * 60 * 1000 && attempts >= 10) {
        throw new HttpsError("resource-exhausted", "너무 많은 시도입니다. 잠시 후 다시 시도해주세요.");
      }

      if (elapsed >= 10 * 60 * 1000) {
        await rateLimitRef.set({ attempts: 1, firstAttempt: FieldValue.serverTimestamp() });
      } else {
        await rateLimitRef.update({ attempts: FieldValue.increment(1) });
      }
    } else {
      await rateLimitRef.set({ attempts: 1, firstAttempt: FieldValue.serverTimestamp() });
    }

    // 학번으로 사용자 조회
    const usersSnapshot = await db.collection("users")
      .where("studentId", "==", studentId)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      throw new HttpsError("not-found", "등록되지 않은 학번입니다.");
    }

    const userDoc = usersSnapshot.docs[0];
    const uid = userDoc.id;
    const userData = userDoc.data();
    const recoveryEmail = userData.recoveryEmail;

    if (!recoveryEmail) {
      return {
        success: false,
        hasRecoveryEmail: false,
        message: "복구 이메일이 등록되어 있지 않습니다.",
      };
    }

    // Phase 2: 인증 코드 확인 + 비밀번호 변경
    if (verificationCode && newPassword) {
      if (newPassword.length < 6) {
        throw new HttpsError("invalid-argument", "비밀번호는 6자 이상이어야 합니다.");
      }

      const codeDocId = `${uid}_reset`;
      const codeDoc = await db.collection("verificationCodes").doc(codeDocId).get();

      if (!codeDoc.exists) {
        throw new HttpsError("not-found", "인증 코드가 만료되었습니다. 다시 시도해주세요.");
      }

      const codeData = codeDoc.data()!;

      if (codeData.expiresAt.toDate() < new Date()) {
        await db.collection("verificationCodes").doc(codeDocId).delete();
        throw new HttpsError("deadline-exceeded", "인증 코드가 만료되었습니다.");
      }

      if (codeData.code !== verificationCode) {
        const attempts = (codeData.attempts || 0) + 1;

        if (attempts >= 5) {
          await db.collection("verificationCodes").doc(codeDocId).delete();
          throw new HttpsError("resource-exhausted", "인증 코드가 무효화되었습니다. 다시 요청해주세요.");
        }

        await db.collection("verificationCodes").doc(codeDocId).update({
          attempts: FieldValue.increment(1),
        });
        throw new HttpsError("invalid-argument", `인증 코드가 올바르지 않습니다. (${5 - attempts}회 남음)`);
      }

      // Admin SDK로 비밀번호 변경
      await adminAuth.updateUser(uid, { password: newPassword });

      // 인증 코드 삭제
      await db.collection("verificationCodes").doc(codeDocId).delete();

      console.log(`비밀번호 재설정 완료: ${studentId}`);

      return {
        success: true,
        message: "비밀번호가 변경되었습니다.",
      };
    }

    // Phase 1: 이메일 확인 + 인증 코드 전송
    if (!email) {
      throw new HttpsError("invalid-argument", "이메일을 입력해주세요.");
    }

    if (email !== recoveryEmail) {
      throw new HttpsError("invalid-argument", "등록된 복구 이메일과 일치하지 않습니다.");
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeDocId = `${uid}_reset`;

    await db.collection("verificationCodes").doc(codeDocId).set({
      code,
      uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    await sendEmail(
      recoveryEmail,
      "RabbiTory 비밀번호 재설정",
      `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1A1A1A; margin-bottom: 16px;">비밀번호 재설정</h2>
        <p style="color: #555; line-height: 1.6;">
          비밀번호 재설정 인증 코드입니다.
        </p>
        <div style="margin: 24px 0; padding: 16px; background: #F5F0E8; border-radius: 12px; text-align: center;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1A1A1A;">
            ${code}
          </span>
        </div>
        <p style="color: #999; font-size: 12px;">
          이 코드는 10분간 유효합니다.
        </p>
      </div>
      `
    );

    console.log(`비밀번호 재설정 코드 전송: ${studentId} → ${maskEmail(recoveryEmail)}`);

    return {
      success: true,
      codeSent: true,
      hasRecoveryEmail: true,
      maskedEmail: maskEmail(recoveryEmail),
      message: `${maskEmail(recoveryEmail)}로 인증 코드를 보냈습니다.`,
    };
  }
);

// ============================================================
// 5) updateRecoveryEmail — 학생 본인: 복구 이메일 등록/변경
// ============================================================

export const updateRecoveryEmail = onCall(
  { region: "asia-northeast3", secrets: [GMAIL_ADDRESS, GMAIL_APP_PASSWORD] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const uid = request.auth.uid;
    const { recoveryEmail, verificationCode } = request.data as {
      recoveryEmail: string;
      verificationCode?: string;
    };

    if (!recoveryEmail) {
      throw new HttpsError("invalid-argument", "복구 이메일이 필요합니다.");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recoveryEmail)) {
      throw new HttpsError("invalid-argument", "유효하지 않은 이메일 형식입니다.");
    }

    const db = getFirestore();

    // Phase 2: 인증 코드 확인 후 저장
    if (verificationCode) {
      const codeDoc = await db.collection("verificationCodes").doc(uid).get();
      if (!codeDoc.exists) {
        throw new HttpsError("not-found", "인증 코드가 만료되었습니다. 다시 시도해주세요.");
      }

      const codeData = codeDoc.data()!;

      // 만료 확인 (10분)
      if (codeData.expiresAt.toDate() < new Date()) {
        await db.collection("verificationCodes").doc(uid).delete();
        throw new HttpsError("deadline-exceeded", "인증 코드가 만료되었습니다. 다시 시도해주세요.");
      }

      // 코드 확인 (시도 횟수 제한 — 무차별 대입 방지)
      if (codeData.code !== verificationCode) {
        const attempts = (codeData.attempts || 0) + 1;

        if (attempts >= 5) {
          await db.collection("verificationCodes").doc(uid).delete();
          throw new HttpsError("resource-exhausted", "인증 코드가 무효화되었습니다. 다시 요청해주세요.");
        }

        await db.collection("verificationCodes").doc(uid).update({
          attempts: FieldValue.increment(1),
        });
        throw new HttpsError("invalid-argument", `인증 코드가 올바르지 않습니다. (${5 - attempts}회 남음)`);
      }

      // 이메일 일치 확인
      if (codeData.email !== recoveryEmail) {
        throw new HttpsError("invalid-argument", "이메일이 일치하지 않습니다.");
      }

      // 사용자 문서 조회
      const userDoc = await db.collection("users").doc(uid).get();
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
      }

      const userData = userDoc.data()!;
      const studentId = userData.studentId;
      const courseId = userData.courseId;

      if (!studentId || !courseId) {
        throw new HttpsError("failed-precondition", "학번 정보가 없습니다.");
      }

      // enrolledStudents 업데이트
      const enrolledRef = db
        .collection("enrolledStudents")
        .doc(courseId)
        .collection("students")
        .doc(studentId);

      await enrolledRef.update({
        recoveryEmail,
        recoveryEmailUpdatedAt: FieldValue.serverTimestamp(),
      });

      // users 문서에도 저장
      await db.collection("users").doc(uid).update({
        recoveryEmail,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 인증 코드 삭제
      await db.collection("verificationCodes").doc(uid).delete();

      console.log(`복구 이메일 인증 완료: ${studentId} → ${maskEmail(recoveryEmail)}`);

      return {
        success: true,
        maskedEmail: maskEmail(recoveryEmail),
      };
    }

    // Phase 1: 인증 코드 생성 및 전송
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Firestore에 인증 코드 저장 (10분 만료)
    await db.collection("verificationCodes").doc(uid).set({
      code,
      email: recoveryEmail,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    // 인증 코드 이메일 발송
    await sendEmail(
      recoveryEmail,
      "RabbiTory 복구 이메일 인증",
      `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1A1A1A; margin-bottom: 16px;">이메일 인증</h2>
        <p style="color: #555; line-height: 1.6;">
          RabbiTory 복구 이메일 인증 코드입니다.
        </p>
        <div style="margin: 24px 0; padding: 16px; background: #F5F0E8; border-radius: 12px; text-align: center;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1A1A1A;">
            ${code}
          </span>
        </div>
        <p style="color: #999; font-size: 12px;">
          이 코드는 10분간 유효합니다.
        </p>
      </div>
      `
    );

    console.log(`복구 이메일 인증 코드 전송: ${uid} → ${maskEmail(recoveryEmail)}`);

    return {
      needsVerification: true,
      maskedEmail: maskEmail(recoveryEmail),
    };
  }
);

// ============================================================
// 6) migrateExistingAccounts — 교수님 전용: 기존 계정 마이그레이션
// ============================================================

/**
 * 기존 이메일 계정을 학번 기반({학번}@rabbitory.internal)으로 마이그레이션.
 *
 * 처리 내용:
 * - Firestore users에서 studentId가 있고, email이 @rabbitory.internal이 아닌 학생 조회
 * - Firebase Auth email을 {학번}@rabbitory.internal로 변경
 * - emailVerified = true 설정
 * - Firestore users 문서의 email 업데이트
 * - enrolledStudents에 자동 등록 (없으면 생성)
 *
 * 기존 비밀번호는 그대로 유지됨.
 */
export const migrateExistingAccounts = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();
    const adminAuth = getAuth();

    // 교수님 권한 확인
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 마이그레이션할 수 있습니다.");
    }

    // 학생 문서 중 studentId가 있고, email이 @rabbitory.internal이 아닌 것
    const usersSnapshot = await db.collection("users")
      .where("role", "==", "student")
      .get();

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const userDoc of usersSnapshot.docs) {
      const data = userDoc.data();
      const uid = userDoc.id;
      const studentId = data.studentId;
      const currentEmail = data.email;
      const courseId = data.courseId;

      // studentId 없으면 스킵
      if (!studentId) {
        skippedCount++;
        continue;
      }

      // 이미 마이그레이션 완료된 계정 스킵
      if (currentEmail && currentEmail.endsWith("@rabbitory.internal")) {
        skippedCount++;
        continue;
      }

      const newEmail = toInternalEmail(studentId);

      try {
        // Firebase Auth email 변경 + emailVerified 설정
        await adminAuth.updateUser(uid, {
          email: newEmail,
          emailVerified: true,
        });

        // Firestore users 문서 업데이트
        await db.collection("users").doc(uid).update({
          email: newEmail,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // enrolledStudents에 자동 등록 (없으면 생성)
        if (courseId) {
          const enrolledRef = db
            .collection("enrolledStudents")
            .doc(courseId)
            .collection("students")
            .doc(studentId);

          const enrolledDoc = await enrolledRef.get();
          if (!enrolledDoc.exists) {
            await enrolledRef.set({
              name: data.name || data.nickname || "",
              studentId,
              classId: data.classId || "A",
              isRegistered: true,
              registeredUid: uid,
              registeredAt: FieldValue.serverTimestamp(),
              enrolledAt: FieldValue.serverTimestamp(),
              enrolledBy: request.auth.uid,
            });
          } else {
            // 이미 등록된 경우 가입 정보만 업데이트
            await enrolledRef.update({
              isRegistered: true,
              registeredUid: uid,
              registeredAt: FieldValue.serverTimestamp(),
            });
          }
        }

        migratedCount++;
        console.log(`마이그레이션 완료: ${studentId} (${currentEmail} → ${newEmail})`);
      } catch (error: unknown) {
        errorCount++;
        const errMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${studentId}: ${errMsg}`);
        console.error(`마이그레이션 실패: ${studentId}`, error);
      }
    }

    console.log(`마이그레이션 결과: ${migratedCount}명 완료, ${skippedCount}명 스킵, ${errorCount}건 오류`);

    return {
      success: true,
      migratedCount,
      skippedCount,
      errorCount,
      errors: errors.slice(0, 10),
    };
  }
);

// ============================================================
// 공용 헬퍼: 학생 데이터 정리 (서브컬렉션 + 최상위 컬렉션)
// ============================================================

async function cleanupStudentData(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<void> {
  // 1. 서브컬렉션 삭제: rabbitHoldings, quizHistory, expHistory
  const subcollections = ["rabbitHoldings", "quizHistory", "expHistory"];
  for (const subcol of subcollections) {
    const snapshot = await db
      .collection("users")
      .doc(uid)
      .collection(subcol)
      .get();

    const batch = db.batch();
    let count = 0;
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
      count++;
      if (count >= 450) {
        await batch.commit();
        count = 0;
      }
    }
    if (count > 0) {
      await batch.commit();
    }
  }

  // 2. 최상위 컬렉션에서 사용자 관련 데이터 삭제
  const userIdCollections = [
    "quizResults",
    "reviews",
    "quiz_completions",
    "quizProgress",
    "questionFeedbacks",
    "quizBookmarks",
    "customFolders",
    "deletedReviewItems",
    "submissions",
    "likes",
  ];

  for (const col of userIdCollections) {
    const snapshot = await db.collection(col)
      .where("userId", "==", uid)
      .limit(500)
      .get();

    if (!snapshot.empty) {
      const b = db.batch();
      snapshot.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }

  // posts (authorId 필드)
  const postsSnap = await db.collection("posts")
    .where("authorId", "==", uid)
    .limit(500)
    .get();
  if (!postsSnap.empty) {
    const b = db.batch();
    postsSnap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }

  // comments (authorId 필드)
  const commentsSnap = await db.collection("comments")
    .where("authorId", "==", uid)
    .limit(500)
    .get();
  if (!commentsSnap.empty) {
    const b = db.batch();
    commentsSnap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }

  // 3. users/{uid} 문서 삭제
  await db.collection("users").doc(uid).delete();
}

// ============================================================
// 7) deleteStudentAccount — 학생 본인: 계정 삭제 (재가입 가능)
// ============================================================

export const deleteStudentAccount = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const uid = request.auth.uid;
    const db = getFirestore();
    const adminAuth = getAuth();

    // 사용자 문서 조회
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "사용자를 찾을 수 없습니다.");
    }

    const userData = userDoc.data()!;

    // 학생만 삭제 가능
    if (userData.role !== "student") {
      throw new HttpsError("permission-denied", "학생 계정만 삭제할 수 있습니다.");
    }

    const studentId = userData.studentId;
    const courseId = userData.courseId;

    try {
      // enrolledStudents 초기화 → 재가입 가능
      if (courseId && studentId) {
        const enrolledRef = db
          .collection("enrolledStudents")
          .doc(courseId)
          .collection("students")
          .doc(studentId);

        const enrolledDoc = await enrolledRef.get();
        if (enrolledDoc.exists) {
          await enrolledRef.update({
            isRegistered: false,
            registeredUid: FieldValue.delete(),
            registeredAt: FieldValue.delete(),
            recoveryEmail: FieldValue.delete(),
            recoveryEmailUpdatedAt: FieldValue.delete(),
          });
        }
      }

      // 학생 데이터 정리 + users 문서 삭제
      await cleanupStudentData(db, uid);

      // Firebase Auth 계정 삭제
      await adminAuth.deleteUser(uid);

      console.log(`계정 삭제 완료: ${studentId} (${uid})`);

      return { success: true };
    } catch (error) {
      console.error("계정 삭제 실패:", error);
      throw new HttpsError("internal", "계정 삭제에 실패했습니다.");
    }
  }
);

// ============================================================
// 8) removeEnrolledStudent — 교수님 전용: 등록 학생 삭제
// ============================================================

export const removeEnrolledStudent = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const db = getFirestore();

    // 교수님 권한 확인
    const userDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "professor") {
      throw new HttpsError("permission-denied", "교수님만 학생을 삭제할 수 있습니다.");
    }

    const { courseId, studentId } = request.data as {
      courseId: string;
      studentId: string;
    };

    if (!courseId || !studentId) {
      throw new HttpsError("invalid-argument", "courseId와 studentId가 필요합니다.");
    }

    const enrolledRef = db
      .collection("enrolledStudents")
      .doc(courseId)
      .collection("students")
      .doc(studentId);

    const enrolledDoc = await enrolledRef.get();
    if (!enrolledDoc.exists) {
      throw new HttpsError("not-found", "등록되지 않은 학번입니다.");
    }

    const enrolledData = enrolledDoc.data()!;
    const wasRegistered = !!enrolledData.isRegistered;

    try {
      // 가입된 학생인 경우 Auth + 데이터 정리
      if (wasRegistered && enrolledData.registeredUid) {
        const uid = enrolledData.registeredUid;
        const adminAuth = getAuth();

        // 학생 데이터 정리 + users 문서 삭제
        await cleanupStudentData(db, uid);

        // Firebase Auth 계정 삭제
        try {
          await adminAuth.deleteUser(uid);
        } catch (authErr) {
          console.warn(`Auth 계정 삭제 실패 (이미 삭제됨?): ${uid}`, authErr);
        }
      }

      // enrolledStudents 문서 삭제
      await enrolledRef.delete();

      console.log(`등록 학생 삭제: ${studentId} (courseId: ${courseId}, wasRegistered: ${wasRegistered})`);

      return { success: true, wasRegistered };
    } catch (error) {
      console.error("등록 학생 삭제 실패:", error);
      throw new HttpsError("internal", "학생 삭제에 실패했습니다.");
    }
  }
);

// ============================================================
// 유틸: 이메일 마스킹
// ============================================================

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}***@${domain}`;
}
