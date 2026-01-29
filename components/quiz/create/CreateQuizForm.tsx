'use client';

/**
 * CreateQuizForm 컴포넌트
 *
 * 최종 퀴즈 정보 입력 폼입니다.
 * QuizMetaForm의 래퍼 컴포넌트로, 동일한 기능을 제공합니다.
 */

import QuizMetaForm from './QuizMetaForm';

// QuizMetaForm을 CreateQuizForm으로 re-export
export default QuizMetaForm;

// 타입도 함께 export
export type { QuizMeta as CreateQuizFormData } from './QuizMetaForm';
