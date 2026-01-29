'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/styles/themes/useTheme';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  ShopItem,
  ShopCategory,
  SHOP_CATEGORIES,
} from '@/lib/data/shopItems';
import {
  ShopHeader,
  CategoryTabs,
  ItemGrid,
  PurchaseModal,
} from '@/components/shop';
import { DEFAULT_CHARACTER_OPTIONS, CharacterOptions } from '@/components/onboarding/CharacterPreview';

/**
 * Shop 메인 페이지
 *
 * 기능:
 * - 카테고리별 아이템 목록 표시
 * - 아이템 구매 (Cloud Function 호출)
 * - 보유 골드 및 아이템 실시간 동기화
 */
export default function ShopPage() {
  const router = useRouter();
  const colors = useThemeColors();
  const { user, loading: authLoading } = useAuth();

  // 상태 관리
  const [selectedCategory, setSelectedCategory] = useState<ShopCategory>('weapon');
  const [selectedItem, setSelectedItem] = useState<ShopItem | null>(null);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);

  // 사용자 데이터 상태
  const [userGold, setUserGold] = useState(0);
  const [ownedItemIds, setOwnedItemIds] = useState<string[]>([]);
  const [characterOptions, setCharacterOptions] = useState<CharacterOptions>(
    DEFAULT_CHARACTER_OPTIONS
  );
  const [isLoading, setIsLoading] = useState(true);

  // 사용자 데이터 실시간 구독
  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    // Firestore에서 사용자 데이터 실시간 구독
    const unsubscribe = onSnapshot(
      doc(db, 'users', user.uid),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          setUserGold(data.gold || 0);
          setOwnedItemIds(data.ownedItems || []);
          if (data.character) {
            setCharacterOptions(data.character);
          }
        }
        setIsLoading(false);
      },
      (error) => {
        console.error('사용자 데이터 로드 오류:', error);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // 카테고리 선택 핸들러
  const handleCategorySelect = useCallback((category: ShopCategory) => {
    setSelectedCategory(category);
  }, []);

  // 아이템 클릭 핸들러
  const handleItemClick = useCallback((item: ShopItem) => {
    setSelectedItem(item);
    setIsPurchaseModalOpen(true);
  }, []);

  // 모달 닫기 핸들러
  const handleCloseModal = useCallback(() => {
    setIsPurchaseModalOpen(false);
    setSelectedItem(null);
    setPurchaseSuccess(false);
  }, []);

  // 아이템 구매 핸들러
  const handlePurchase = useCallback(
    async (item: ShopItem) => {
      if (!user) {
        alert('로그인이 필요합니다.');
        return;
      }

      // 이미 보유한 아이템인지 확인
      if (ownedItemIds.includes(item.id)) {
        alert('이미 보유한 아이템입니다.');
        return;
      }

      // 골드 부족 확인
      if (userGold < item.price) {
        alert('골드가 부족합니다.');
        return;
      }

      setIsPurchasing(true);

      try {
        // Cloud Function 호출하여 아이템 구매
        const purchaseItem = httpsCallable(functions, 'purchaseShopItem');
        const result = await purchaseItem({
          itemId: item.id,
          itemPrice: item.price,
        });

        const response = result.data as { success: boolean; message?: string };

        if (response.success) {
          setPurchaseSuccess(true);
          // 잠시 후 모달 닫기
          setTimeout(() => {
            handleCloseModal();
          }, 1500);
        } else {
          alert(response.message || '구매에 실패했습니다.');
        }
      } catch (error: any) {
        console.error('구매 오류:', error);
        // Cloud Function이 아직 구현되지 않은 경우 로컬에서 처리 (개발용)
        if (error.code === 'functions/not-found') {
          // 개발 모드: 로컬에서 테스트
          setOwnedItemIds((prev) => [...prev, item.id]);
          setUserGold((prev) => prev - item.price);
          setPurchaseSuccess(true);
          setTimeout(() => {
            handleCloseModal();
          }, 1500);
        } else {
          alert('구매 중 오류가 발생했습니다. 다시 시도해주세요.');
        }
      } finally {
        setIsPurchasing(false);
      }
    },
    [user, ownedItemIds, userGold, handleCloseModal]
  );

  // 로딩 중 표시
  if (authLoading || isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: colors.background }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 rounded-full"
          style={{
            borderColor: `${colors.accent}30`,
            borderTopColor: colors.accent,
          }}
        />
      </div>
    );
  }

  // 비로그인 시 로그인 페이지로 리다이렉트
  if (!user) {
    router.push('/login');
    return null;
  }

  return (
    <div
      className="min-h-screen pb-20"
      style={{ backgroundColor: colors.background }}
    >
      {/* Shop 헤더 */}
      <ShopHeader gold={userGold} />

      {/* 카테고리 탭 */}
      <CategoryTabs
        selectedCategory={selectedCategory}
        onSelectCategory={handleCategorySelect}
      />

      {/* 아이템 그리드 */}
      <div className="pt-4">
        <ItemGrid
          category={selectedCategory}
          userGold={userGold}
          ownedItemIds={ownedItemIds}
          onItemClick={handleItemClick}
        />
      </div>

      {/* 구매 확인 모달 */}
      <PurchaseModal
        isOpen={isPurchaseModalOpen}
        onClose={handleCloseModal}
        item={selectedItem}
        userGold={userGold}
        characterOptions={characterOptions}
        onConfirmPurchase={handlePurchase}
        isPurchasing={isPurchasing}
      />

      {/* 구매 성공 토스트 */}
      {purchaseSuccess && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full bg-green-500 text-white font-medium shadow-lg"
        >
          🎉 구매 완료!
        </motion.div>
      )}
    </div>
  );
}
