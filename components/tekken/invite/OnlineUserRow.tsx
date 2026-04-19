'use client';

/**
 * 배틀 신청 시트의 1행 — 접속 중인 친구 1명.
 * 토끼 이미지(테두리 X) + 닉네임·반 + Lv·토끼이름 + 우측 상태 아이콘.
 */

import { getRabbitProfileUrl } from '@/lib/utils/rabbitProfile';
import type { OnlineClassmate } from '@/lib/hooks/useOnlineClassmates';

interface Props {
  user: OnlineClassmate;
  isPending: boolean;
  isDisabled: boolean;
  onClick: () => void;
}

export default function OnlineUserRow({ user, isPending, isDisabled, onClick }: Props) {
  const disabled = user.isBusy || isDisabled;

  return (
    <button
      type="button"
      onClick={disabled || isPending ? undefined : onClick}
      disabled={disabled || isPending}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
        disabled ? 'opacity-40' : 'hover:bg-white/5 active:bg-white/10'
      }`}
    >
      <div className="w-14 h-14 flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getRabbitProfileUrl(user.rabbitId)}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>

      <div className="flex-1 text-left min-w-0">
        <p className="text-white font-bold text-sm truncate">
          {user.nickname}
          {user.classType && (
            <span className="text-white/40 font-medium"> · {user.classType}반</span>
          )}
        </p>
        <p className="text-white/50 text-xs truncate">
          Lv.{user.rabbitLevel} {user.rabbitName}
        </p>
      </div>

      <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center">
        {isPending ? (
          <svg className="w-6 h-6 animate-spin text-white" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.5} />
            <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
          </svg>
        ) : user.isBusy ? (
          <span className="text-[10px] font-bold text-white/50 px-2 py-0.5 rounded-full border border-white/20">
            바쁨
          </span>
        ) : (
          <svg className="w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
          </svg>
        )}
      </div>
    </button>
  );
}
