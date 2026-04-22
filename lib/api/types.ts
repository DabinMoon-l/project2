/**
 * Cloud Functions 호출 타입 맵
 *
 * CF 함수명 → { input, output } 매핑
 * Supabase 마이그레이션 시 이 타입만 교체하면 소비자 코드 변경 불필요
 */

// ============================================================
// 공유 타입 (CF 전용 — 소비자에서 import)
// ============================================================

/** 뽑기 결과 */
export interface RollResultData {
  type: 'undiscovered' | 'discovered' | 'owned';
  rabbitId: number;
  rabbitName: string | null;
  nextDiscoveryOrder: number | null;
  myDiscoveryOrder: number | null;
  equippedCount: number;
}

/** 레벨업 결과 */
export interface LevelUpResult {
  newLevel: number;
  oldStats: { hp: number; atk: number; def: number };
  newStats: { hp: number; atk: number; def: number };
  statIncreases: { hp: number; atk: number; def: number };
  totalPoints: number;
}

/** 철권 매칭 결과 */
export interface JoinMatchmakingResult {
  status: 'waiting' | 'matched' | 'already_matched';
  battleId?: string;
}

/** 철권 답변 제출 결과 */
export interface SubmitAnswerResult {
  status: 'scored' | 'waiting';
  isCorrect?: boolean;
  damage?: number;
  isCritical?: boolean;
  damageReceived?: number;
  mashTriggered?: boolean;
  mashId?: string;
}

/** OCR 사용량 */
export interface OcrUsage {
  used: number;
  limit: number;
  remaining: number;
}

/** Vision OCR 결과 */
export interface VisionOcrResult {
  success: boolean;
  text: string;
  processedCount: number;
  usage: OcrUsage;
}

/** CLOVA OCR 결과 */
export interface ClovaOcrResult {
  success: boolean;
  text: string;
  usage: OcrUsage;
}

/** Gemini 사용량 */
export interface GeminiUsage {
  userUsed: number;
  userLimit: number;
  userRemaining: number;
  totalUsed: number;
  totalLimit: number;
  totalRemaining: number;
}

/** AI 생성 문제 */
export interface GeneratedQuestion {
  text: string;
  choices: string[];
  answer: number;
  explanation: string;
}

/** Gemini 큐 결과 */
export interface QueueResult {
  queueId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'none';
  position?: number;
  message?: string;
  result?: GeneratedQuestion[];
  error?: string;
  createdAt?: string;
  completedAt?: string;
}

/** 이미지 영역 분석 */
export interface QuestionImageRegion {
  questionNumber: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  description?: string;
}

/** 학생 등록 행 */
export interface StudentRow {
  name: string;
  studentId: string;
}

/** 등록 결과 */
export interface EnrollResult {
  successCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: string[];
}

/** 스타일 프로필 요약 */
export interface StyleProfileSummary {
  analyzedQuizCount: number;
  analyzedQuestionCount: number;
  topTypes: string[];
  usesNegative: boolean;
  usesMultiSelect: boolean;
  hasClinicalCases: boolean;
}

/** 키워드 요약 */
export interface KeywordsSummary {
  mainConceptsCount: number;
  caseTriggersCount: number;
  topMainConcepts: string[];
  topCaseTriggers: string[];
}

/** 스타일 프로필 */
export interface StyleProfileData {
  exists: boolean;
  courseId: string;
  summary?: StyleProfileSummary;
  keywordsSummary?: KeywordsSummary;
}

/** 시즌 타입 */
export type SeasonType = 'midterm' | 'final';

// ============================================================
// CloudFunctionMap — CF 함수명 → 입출력 타입
// ============================================================

export interface CloudFunctionMap {
  // ── 인증 ──
  registerStudent: {
    input: { studentId: string; password: string; courseId: string; classId: string; nickname: string; name?: string };
    output: { success: boolean; uid: string };
  };
  initProfessorAccount: {
    input: void;
    output: void;
  };
  deleteStudentAccount: {
    input: void;
    output: { success: boolean };
  };

  // ── 비밀번호 ──
  requestPasswordReset: {
    input: { studentId?: string; email?: string; verificationCode?: string; newPassword?: string };
    output: { success: boolean; hasRecoveryEmail?: boolean; codeSent?: boolean; maskedEmail?: string; message?: string };
  };
  updateRecoveryEmail: {
    input: { recoveryEmail: string; verificationCode?: string };
    output: { needsVerification?: boolean; success?: boolean; maskedEmail: string };
  };
  updateStudentClass: {
    input: { classId: 'A' | 'B' | 'C' | 'D' };
    output: { success: boolean };
  };
  resetStudentPassword: {
    input: { studentId: string; courseId: string; newPassword: string };
    output: { success: boolean; message: string };
  };
  submitInquiry: {
    input: { studentId: string; message: string };
    output: { success: boolean };
  };

  // ── 퀴즈 ──
  recordAttempt: {
    input: { quizId: string; answers: { questionId: string; answer: unknown }[]; attemptNo?: number };
    output: { alreadySubmitted?: boolean; resultId: string; score: number; correctCount: number; totalCount: number };
  };
  recordReviewPractice: {
    input: { quizId: string; correctCount: number; totalCount: number; score: number };
    output: void;
  };
  initCreatorStats: {
    input: { quizId: string };
    output: void;
  };
  regradeQuestions: {
    input: { quizId: string; questionIds: string[] };
    output: void;
  };
  updatePracticeAnsweredAt: {
    input: {
      quizId: string;
      questionUpdates: Array<{
        questionId: string;
        isCorrect: boolean;
        userAnswer: string;
        isNew: boolean;
      }>;
    };
    output: void;
  };

  // ── AI 문제 생성 ──
  enqueueGenerationJob: {
    input: {
      text?: string;
      images?: string[];
      difficulty: string;
      questionCount: number;
      courseId: string;
      courseName?: string;
      courseCustomized?: boolean;
      tags?: string[];
      selectedDetails?: string[];
    };
    output: { jobId: string; status: string; deduplicated: boolean };
  };
  checkJobStatus: {
    input: { jobId: string };
    output: { jobId: string; status: string; result?: { questions: GeneratedQuestion[]; meta?: { title?: string } }; error?: string };
  };
  getGeminiUsage: {
    input: void;
    output: GeminiUsage;
  };

  // ── 자체제작 퀴즈 자동 해설 ──
  generateCustomExplanations: {
    input: {
      courseId: string;
      questions: Array<{
        id: string;
        text: string;
        type: string;
        choices?: string[];
        answerIndex?: number;
        answerIndices?: number[];
        answerText?: string;
        answerTexts?: string[];
        passageText?: string;
        bogiText?: string;
        imageBase64?: string;
        chapterId?: string;
        subQuestions?: Array<{
          id: string;
          text: string;
          type: string;
          choices?: string[];
          answerIndex?: number;
          answerIndices?: number[];
          answerText?: string;
          answerTexts?: string[];
          passageText?: string;
          bogiText?: string;
          chapterId?: string;
        }>;
      }>;
    };
    output: {
      success: boolean;
      explanations: Array<{
        id: string;
        explanation: string;
        choiceExplanations?: string[];
        subExplanations?: Array<{
          id: string;
          explanation: string;
          choiceExplanations?: string[];
        }>;
      }>;
      usage: {
        userUsed: number;
        userLimit: number;
        userRemaining: number;
      };
    };
  };
  addToGeminiQueue: {
    input: { image: string; difficulty: string };
    output: QueueResult;
  };
  checkGeminiQueueStatus: {
    input: { queueId: string };
    output: QueueResult;
  };
  claimGeminiQueueResult: {
    input: { queueId: string };
    output: { success: boolean; questions: GeneratedQuestion[] };
  };
  convertPptxToPdf: {
    input: { pptxBase64: string };
    output: { pdfBase64: string };
  };

  // ── OCR ──
  getVisionOcrUsage: {
    input: void;
    output: OcrUsage;
  };
  runVisionOcr: {
    input: { images: string[] };
    output: VisionOcrResult;
  };
  getOcrUsage: {
    input: void;
    output: OcrUsage;
  };
  runClovaOcr: {
    input: { image: string };
    output: ClovaOcrResult;
  };
  analyzeImageRegionsCall: {
    input: { imageBase64: string };
    output: { success: boolean; regions: QuestionImageRegion[] };
  };

  // ── 토끼 ──
  spinRabbitGacha: {
    input: { courseId: string };
    output: RollResultData;
  };
  claimGachaRabbit: {
    input: { courseId: string; rabbitId: number; action: 'pass' | 'discover' | 'claim'; name?: string; equipSlot?: number };
    output: void;
  };
  levelUpRabbit: {
    input: { courseId: string; rabbitId: number };
    output: LevelUpResult;
  };
  equipRabbit: {
    input: { courseId: string; rabbitId: number; slotIndex: number };
    output: void;
  };

  // ── 철권퀴즈 ──
  joinMatchmaking: {
    input: { courseId: string; chapters: string[] };
    output: JoinMatchmakingResult;
  };
  matchWithBot: {
    input: { courseId: string; chapters: string[]; aiOnly?: boolean };
    output: JoinMatchmakingResult;
  };
  cancelMatchmaking: {
    input: { courseId: string };
    output: void;
  };
  startBattleRound: {
    input: { battleId: string; roundIndex: number };
    output: void;
  };
  submitAnswer: {
    input: { battleId: string; roundIndex: number; answer: number };
    output: SubmitAnswerResult;
  };
  swapRabbit: {
    input: { battleId: string };
    output: void;
  };
  submitMashResult: {
    input: { battleId: string; taps: number; botTaps?: number };
    output: void;
  };
  submitTimeout: {
    input: { battleId: string; roundIndex: number };
    output: void;
  };
  tekkenPoolRefill: {
    input: { courseId: string };
    output: void;
  };
  sendBattleInvite: {
    input: { receiverUid: string; chapters: string[] };
    output: { inviteId: string; expiresAt: number };
  };
  respondBattleInvite: {
    input: { inviteId: string; action: 'accept' | 'decline' };
    output:
      | { status: 'accepted'; battleId: string }
      | { status: 'declined' };
  };

  // ── 랭킹 ──
  refreshRankings: {
    input: { courseId: string };
    output: void;
  };

  // ── 공지 ──
  markAnnouncementsRead: {
    input: { announcementIds: string[] };
    output: void;
  };
  reactToAnnouncement: {
    input: { announcementId: string; emoji: string };
    output: void;
  };
  voteOnPoll: {
    input: { announcementId: string; pollIdx: number; optIndices: number[] };
    output: { success: boolean };
  };
  submitPollTextResponse: {
    input: { announcementId: string; pollIdx: number; text: string };
    output: { success: boolean };
  };
  submitPollSurvey: {
    input: {
      announcementId: string;
      choices?: Record<string, number[]>;
      texts?: Record<string, string>;
    };
    output: { success: boolean };
  };
  getPollResponses: {
    input: { announcementId: string; pollIdx: number };
    output:
      | {
          type: 'choice';
          totalVoters: number;
          options: Array<{
            optIdx: number;
            option: string;
            voters: Array<{ uid: string; name: string; studentNumber: string; nickname?: string }>;
          }>;
        }
      | {
          type: 'text';
          responseCount: number;
          responses: Array<{
            uid: string;
            name: string;
            studentNumber: string;
            nickname?: string;
            text: string;
            createdAt: number | null;
            updatedAt: number | null;
          }>;
        };
  };
  getPollResponsesBatch: {
    input: { announcementId: string };
    output: {
      items: Array<
        | {
            pollIdx: number;
            type: 'choice';
            totalVoters: number;
            options: Array<{
              optIdx: number;
              option: string;
              voters: Array<{ uid: string; name: string; studentNumber: string; nickname?: string }>;
            }>;
          }
        | {
            pollIdx: number;
            type: 'text';
            responseCount: number;
            responses: Array<{
              uid: string;
              name: string;
              studentNumber: string;
              nickname?: string;
              text: string;
              createdAt: number | null;
              updatedAt: number | null;
            }>;
          }
      >;
    };
  };

  // ── 게시판 ──
  deletePost: {
    input: { postId: string };
    output: void;
  };
  deleteThread: {
    input: { rootCommentId: string; postId: string };
    output: { success: boolean; deletedCount: number };
  };
  acceptComment: {
    input: { postId: string; commentId: string };
    output: void;
  };

  // ── 교수 ──
  bulkEnrollStudents: {
    input: { courseId: string; students: StudentRow[] };
    output: EnrollResult;
  };
  removeEnrolledStudent: {
    input: { courseId: string; studentId: string };
    output: { success: boolean; wasRegistered: boolean };
  };
  getStyleProfile: {
    input: { courseId: string };
    output: StyleProfileData;
  };
  generateMonthlyReport: {
    input: { courseId: string; year: number; month: number };
    output: { insight: string; weeklyStatsUsed: string[] };
  };
  resetSeason: {
    input: { classId: string; newSeason: SeasonType };
    output: { success: boolean; message: string; resetCount: number };
  };

  // ── 마이그레이션 (일회성) ──
  migrateQuizAnswersTo0Indexed: {
    input: void;
    output: { migrated: number; skipped: number; errors: number };
  };
}
