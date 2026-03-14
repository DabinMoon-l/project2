import { useState, useEffect, useCallback } from 'react';

interface FolderCategory {
  id: string;
  name: string;
}

/**
 * 폴더 카테고리 관리 훅
 *
 * 폴더 정렬/분류 상태를 localStorage에 저장하여 세션 간 유지.
 * review/page.tsx에서 분리된 자체 완결형 로직.
 */
export function useFolderCategories() {
  const [folderCategories, setFolderCategories] = useState<FolderCategory[]>([]);
  const [folderCategoryMap, setFolderCategoryMap] = useState<Record<string, string>>({});
  const [folderOrderMap, setFolderOrderMap] = useState<Record<string, number>>({});
  const [isSortMode, setIsSortMode] = useState(false);
  const [isAssignMode, setIsAssignMode] = useState(false);
  const [selectedFolderForAssign, setSelectedFolderForAssign] = useState<string | null>(null);

  // 로컬 스토리지에서 카테고리 정보 로드
  useEffect(() => {
    const savedCategories = localStorage.getItem('review_folder_categories');
    const savedMap = localStorage.getItem('review_folder_category_map');
    const savedOrder = localStorage.getItem('review_folder_order_map');
    if (savedCategories) {
      try { setFolderCategories(JSON.parse(savedCategories)); } catch { /* 무시 */ }
    }
    if (savedMap) {
      try { setFolderCategoryMap(JSON.parse(savedMap)); } catch { /* 무시 */ }
    }
    if (savedOrder) {
      try { setFolderOrderMap(JSON.parse(savedOrder)); } catch { /* 무시 */ }
    }
  }, []);

  // 로컬 스토리지에 저장
  const saveFolderCategories = useCallback((
    categories: FolderCategory[],
    map: Record<string, string>,
    order?: Record<string, number>
  ) => {
    localStorage.setItem('review_folder_categories', JSON.stringify(categories));
    localStorage.setItem('review_folder_category_map', JSON.stringify(map));
    if (order) {
      localStorage.setItem('review_folder_order_map', JSON.stringify(order));
    }
  }, []);

  // 카테고리 추가 (최대 8개)
  const addCategory = useCallback((name: string) => {
    if (!name.trim()) return;
    if (folderCategories.length >= 8) {
      alert('카테고리는 최대 8개까지 추가할 수 있습니다.');
      return;
    }
    const newCategory: FolderCategory = {
      id: `fcat_${Date.now()}`,
      name: name.trim(),
    };
    const newCategories = [...folderCategories, newCategory];
    setFolderCategories(newCategories);
    saveFolderCategories(newCategories, folderCategoryMap, folderOrderMap);
  }, [folderCategories, folderCategoryMap, folderOrderMap, saveFolderCategories]);

  // 카테고리 삭제
  const removeCategory = useCallback((categoryId: string) => {
    const newCategories = folderCategories.filter(c => c.id !== categoryId);
    const newMap = { ...folderCategoryMap };
    Object.keys(newMap).forEach(folderId => {
      if (newMap[folderId] === categoryId) delete newMap[folderId];
    });
    setFolderCategories(newCategories);
    setFolderCategoryMap(newMap);
    saveFolderCategories(newCategories, newMap, folderOrderMap);
  }, [folderCategories, folderCategoryMap, folderOrderMap, saveFolderCategories]);

  // 폴더를 카테고리에 배정
  const assignFolderToCategory = useCallback((folderId: string, categoryId: string | null) => {
    const newMap = { ...folderCategoryMap };
    if (categoryId) {
      newMap[folderId] = categoryId;
    } else {
      delete newMap[folderId];
    }
    setFolderCategoryMap(newMap);
    saveFolderCategories(folderCategories, newMap, folderOrderMap);
    setSelectedFolderForAssign(null);
  }, [folderCategories, folderCategoryMap, folderOrderMap, saveFolderCategories]);

  // 두 폴더의 카테고리 또는 위치 교환
  const swapFolderCategories = useCallback((folderId1: string, folderId2: string, customFolders: { id: string }[]) => {
    const cat1 = folderCategoryMap[folderId1];
    const cat2 = folderCategoryMap[folderId2];

    // 같은 카테고리 내에 있으면 순서만 교환
    if (cat1 === cat2 || (!cat1 && !cat2)) {
      const newOrderMap = { ...folderOrderMap };
      const sameCategoryFolders = customFolders
        .filter(f => (cat1 ? folderCategoryMap[f.id] === cat1 : !folderCategoryMap[f.id]))
        .sort((a, b) => (folderOrderMap[a.id] ?? 999) - (folderOrderMap[b.id] ?? 999));

      const idx1 = sameCategoryFolders.findIndex(f => f.id === folderId1);
      const idx2 = sameCategoryFolders.findIndex(f => f.id === folderId2);

      if (idx1 !== -1 && idx2 !== -1) {
        newOrderMap[folderId1] = idx2;
        newOrderMap[folderId2] = idx1;
        setFolderOrderMap(newOrderMap);
        saveFolderCategories(folderCategories, folderCategoryMap, newOrderMap);
      }
      setSelectedFolderForAssign(null);
      return;
    }

    // 다른 카테고리면 카테고리 교환
    const newMap = { ...folderCategoryMap };
    if (cat2) { newMap[folderId1] = cat2; } else { delete newMap[folderId1]; }
    if (cat1) { newMap[folderId2] = cat1; } else { delete newMap[folderId2]; }

    setFolderCategoryMap(newMap);
    saveFolderCategories(folderCategories, newMap, folderOrderMap);
    setSelectedFolderForAssign(null);
  }, [folderCategories, folderCategoryMap, folderOrderMap, saveFolderCategories]);

  // 분류 모드에서 폴더 클릭
  const handleFolderClickInAssignMode = useCallback((folderId: string, customFolders: { id: string }[]) => {
    if (!selectedFolderForAssign) {
      setSelectedFolderForAssign(folderId);
    } else if (selectedFolderForAssign === folderId) {
      setSelectedFolderForAssign(null);
    } else {
      swapFolderCategories(selectedFolderForAssign, folderId, customFolders);
    }
  }, [selectedFolderForAssign, swapFolderCategories]);

  return {
    folderCategories,
    folderCategoryMap,
    folderOrderMap,
    isSortMode,
    setIsSortMode,
    isAssignMode,
    setIsAssignMode,
    selectedFolderForAssign,
    setSelectedFolderForAssign,
    addCategory,
    removeCategory,
    assignFolderToCategory,
    swapFolderCategories,
    handleFolderClickInAssignMode,
  };
}

export type { FolderCategory };
