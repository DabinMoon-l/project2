import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFolderCategories } from "./useFolderCategories";

// ============================================================
// localStorage 모킹
// ============================================================
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    /** 테스트에서 직접 store 내용 확인용 */
    _getStore: () => store,
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// alert 모킹 (addCategory 8개 초과 시 호출)
const alertMock = vi.fn();
Object.defineProperty(window, "alert", { value: alertMock });

// Date.now 모킹 — addCategory의 id(`fcat_${Date.now()}`)가 항상 고유하도록 보장
let dateNowCounter = 1000000;
vi.spyOn(Date, "now").mockImplementation(() => ++dateNowCounter);

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  // Date.now 모킹 재설정 (clearAllMocks가 spy를 제거하므로 다시 설정)
  vi.spyOn(Date, "now").mockImplementation(() => ++dateNowCounter);
});

/**
 * 헬퍼: 카테고리 N개를 하나씩 추가
 * useCallback 클로저 갱신을 위해 각 호출을 별도 act()로 분리
 */
function addCategoriesSequentially(
  result: { current: ReturnType<typeof useFolderCategories> },
  names: string[]
) {
  for (const name of names) {
    act(() => {
      result.current.addCategory(name);
    });
  }
}

// ============================================================
// 초기 상태
// ============================================================
describe("초기 상태", () => {
  it("카테고리 배열이 빈 배열", () => {
    const { result } = renderHook(() => useFolderCategories());
    expect(result.current.folderCategories).toEqual([]);
  });

  it("카테고리 맵이 빈 객체", () => {
    const { result } = renderHook(() => useFolderCategories());
    expect(result.current.folderCategoryMap).toEqual({});
  });

  it("순서 맵이 빈 객체", () => {
    const { result } = renderHook(() => useFolderCategories());
    expect(result.current.folderOrderMap).toEqual({});
  });

  it("정렬 모드가 꺼져 있음", () => {
    const { result } = renderHook(() => useFolderCategories());
    expect(result.current.isSortMode).toBe(false);
  });

  it("배정 모드가 꺼져 있음", () => {
    const { result } = renderHook(() => useFolderCategories());
    expect(result.current.isAssignMode).toBe(false);
  });

  it("선택된 폴더가 null", () => {
    const { result } = renderHook(() => useFolderCategories());
    expect(result.current.selectedFolderForAssign).toBeNull();
  });
});

// ============================================================
// addCategory — 카테고리 추가
// ============================================================
describe("addCategory", () => {
  it("카테고리를 추가하면 배열에 반영", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("생물학");
    });

    expect(result.current.folderCategories).toHaveLength(1);
    expect(result.current.folderCategories[0].name).toBe("생물학");
    expect(result.current.folderCategories[0].id).toMatch(/^fcat_/);
  });

  it("이름 앞뒤 공백 제거 (trim)", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("  미생물학  ");
    });

    expect(result.current.folderCategories[0].name).toBe("미생물학");
  });

  it("빈 문자열은 추가되지 않음", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("");
    });

    expect(result.current.folderCategories).toHaveLength(0);
  });

  it("공백만 있는 문자열도 추가되지 않음", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("   ");
    });

    expect(result.current.folderCategories).toHaveLength(0);
  });

  it("여러 카테고리 순차 추가 가능", () => {
    const { result } = renderHook(() => useFolderCategories());

    // useCallback 클로저 갱신을 위해 각각 별도 act()
    addCategoriesSequentially(result, ["A", "B", "C"]);

    expect(result.current.folderCategories).toHaveLength(3);
    expect(result.current.folderCategories.map((c) => c.name)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("최대 8개까지 추가 가능", () => {
    const { result } = renderHook(() => useFolderCategories());

    const names = Array.from({ length: 8 }, (_, i) => `카테고리${i + 1}`);
    addCategoriesSequentially(result, names);

    expect(result.current.folderCategories).toHaveLength(8);
  });

  it("9번째 추가 시 alert 호출 후 무시", () => {
    const { result } = renderHook(() => useFolderCategories());

    // 8개 추가
    const names = Array.from({ length: 8 }, (_, i) => `카테고리${i + 1}`);
    addCategoriesSequentially(result, names);

    expect(result.current.folderCategories).toHaveLength(8);

    // 9번째 시도
    act(() => {
      result.current.addCategory("초과");
    });

    expect(result.current.folderCategories).toHaveLength(8);
    expect(alertMock).toHaveBeenCalledWith(
      "카테고리는 최대 8개까지 추가할 수 있습니다."
    );
  });

  it("추가 시 localStorage에 저장", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("테스트");
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "review_folder_categories",
      expect.any(String)
    );
    const saved = JSON.parse(
      localStorageMock._getStore()["review_folder_categories"]
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("테스트");
  });
});

// ============================================================
// removeCategory — 카테고리 삭제
// ============================================================
describe("removeCategory", () => {
  it("카테고리를 삭제하면 배열에서 제거", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("삭제대상");
    });

    const categoryId = result.current.folderCategories[0].id;

    act(() => {
      result.current.removeCategory(categoryId);
    });

    expect(result.current.folderCategories).toHaveLength(0);
  });

  it("삭제된 카테고리에 배정된 폴더의 매핑이 해제됨", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("카테고리A");
    });

    const categoryId = result.current.folderCategories[0].id;

    // 폴더를 카테고리에 배정 (각각 별도 act)
    act(() => {
      result.current.assignFolderToCategory("folder1", categoryId);
    });
    act(() => {
      result.current.assignFolderToCategory("folder2", categoryId);
    });

    expect(result.current.folderCategoryMap["folder1"]).toBe(categoryId);
    expect(result.current.folderCategoryMap["folder2"]).toBe(categoryId);

    // 카테고리 삭제
    act(() => {
      result.current.removeCategory(categoryId);
    });

    expect(result.current.folderCategoryMap["folder1"]).toBeUndefined();
    expect(result.current.folderCategoryMap["folder2"]).toBeUndefined();
  });

  it("다른 카테고리에 배정된 폴더는 유지", () => {
    const { result } = renderHook(() => useFolderCategories());

    // 카테고리 2개 순차 추가
    addCategoriesSequentially(result, ["카테고리A", "카테고리B"]);

    const catA = result.current.folderCategories[0].id;
    const catB = result.current.folderCategories[1].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", catA);
    });

    // 중간 확인: folder1이 catA에 배정됨
    expect(result.current.folderCategoryMap["folder1"]).toBe(catA);

    act(() => {
      result.current.assignFolderToCategory("folder2", catB);
    });

    // 중간 확인: 두 폴더 모두 배정됨
    expect(result.current.folderCategoryMap["folder1"]).toBe(catA);
    expect(result.current.folderCategoryMap["folder2"]).toBe(catB);

    // 카테고리A만 삭제
    act(() => {
      result.current.removeCategory(catA);
    });

    expect(result.current.folderCategoryMap["folder1"]).toBeUndefined();
    expect(result.current.folderCategoryMap["folder2"]).toBe(catB);
  });

  it("존재하지 않는 카테고리 삭제 시 에러 없음", () => {
    const { result } = renderHook(() => useFolderCategories());

    expect(() => {
      act(() => {
        result.current.removeCategory("nonexistent_id");
      });
    }).not.toThrow();
  });

  it("삭제 결과가 localStorage에 반영", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("삭제대상");
    });

    const categoryId = result.current.folderCategories[0].id;

    act(() => {
      result.current.removeCategory(categoryId);
    });

    const savedCategories = JSON.parse(
      localStorageMock._getStore()["review_folder_categories"]
    );
    expect(savedCategories).toHaveLength(0);
  });
});

// ============================================================
// assignFolderToCategory — 폴더 카테고리 배정
// ============================================================
describe("assignFolderToCategory", () => {
  it("폴더를 카테고리에 배정", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("카테고리A");
    });

    const categoryId = result.current.folderCategories[0].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", categoryId);
    });

    expect(result.current.folderCategoryMap["folder1"]).toBe(categoryId);
  });

  it("폴더를 다른 카테고리로 재배정", () => {
    const { result } = renderHook(() => useFolderCategories());

    addCategoriesSequentially(result, ["카테고리A", "카테고리B"]);

    const catA = result.current.folderCategories[0].id;
    const catB = result.current.folderCategories[1].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", catA);
    });

    expect(result.current.folderCategoryMap["folder1"]).toBe(catA);

    act(() => {
      result.current.assignFolderToCategory("folder1", catB);
    });

    expect(result.current.folderCategoryMap["folder1"]).toBe(catB);
  });

  it("null로 배정 해제", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("카테고리A");
    });

    const categoryId = result.current.folderCategories[0].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", categoryId);
    });

    expect(result.current.folderCategoryMap["folder1"]).toBe(categoryId);

    act(() => {
      result.current.assignFolderToCategory("folder1", null);
    });

    expect(result.current.folderCategoryMap["folder1"]).toBeUndefined();
  });

  it("배정 후 selectedFolderForAssign이 null로 리셋", () => {
    const { result } = renderHook(() => useFolderCategories());

    // 수동으로 선택 상태 설정
    act(() => {
      result.current.setSelectedFolderForAssign("folder1");
    });

    expect(result.current.selectedFolderForAssign).toBe("folder1");

    act(() => {
      result.current.addCategory("카테고리A");
    });

    const categoryId = result.current.folderCategories[0].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", categoryId);
    });

    expect(result.current.selectedFolderForAssign).toBeNull();
  });

  it("배정 결과가 localStorage에 반영", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("카테고리A");
    });

    const categoryId = result.current.folderCategories[0].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", categoryId);
    });

    const savedMap = JSON.parse(
      localStorageMock._getStore()["review_folder_category_map"]
    );
    expect(savedMap["folder1"]).toBe(categoryId);
  });
});

// ============================================================
// swapFolderCategories — 폴더 위치/카테고리 교환
// ============================================================
describe("swapFolderCategories", () => {
  it("다른 카테고리에 있는 두 폴더의 카테고리를 교환", () => {
    const { result } = renderHook(() => useFolderCategories());

    addCategoriesSequentially(result, ["카테고리A", "카테고리B"]);

    const catA = result.current.folderCategories[0].id;
    const catB = result.current.folderCategories[1].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", catA);
    });
    act(() => {
      result.current.assignFolderToCategory("folder2", catB);
    });

    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    act(() => {
      result.current.swapFolderCategories("folder1", "folder2", customFolders);
    });

    // 카테고리가 교환됨
    expect(result.current.folderCategoryMap["folder1"]).toBe(catB);
    expect(result.current.folderCategoryMap["folder2"]).toBe(catA);
  });

  it("같은 카테고리 내의 두 폴더는 순서만 교환", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("카테고리A");
    });

    const catA = result.current.folderCategories[0].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", catA);
    });
    act(() => {
      result.current.assignFolderToCategory("folder2", catA);
    });

    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    act(() => {
      result.current.swapFolderCategories("folder1", "folder2", customFolders);
    });

    // 카테고리는 변하지 않음
    expect(result.current.folderCategoryMap["folder1"]).toBe(catA);
    expect(result.current.folderCategoryMap["folder2"]).toBe(catA);

    // 순서가 교환됨
    expect(result.current.folderOrderMap["folder1"]).toBe(1);
    expect(result.current.folderOrderMap["folder2"]).toBe(0);
  });

  it("미배정 폴더끼리도 순서 교환 (같은 그룹 취급)", () => {
    const { result } = renderHook(() => useFolderCategories());

    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    act(() => {
      result.current.swapFolderCategories("folder1", "folder2", customFolders);
    });

    // 둘 다 카테고리 없이 순서만 교환
    expect(result.current.folderOrderMap["folder1"]).toBe(1);
    expect(result.current.folderOrderMap["folder2"]).toBe(0);
  });

  it("카테고리 배정 폴더 ↔ 미배정 폴더 교환", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.addCategory("카테고리A");
    });

    const catA = result.current.folderCategories[0].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", catA);
    });

    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    act(() => {
      result.current.swapFolderCategories("folder1", "folder2", customFolders);
    });

    // folder1은 미배정, folder2는 카테고리A
    expect(result.current.folderCategoryMap["folder1"]).toBeUndefined();
    expect(result.current.folderCategoryMap["folder2"]).toBe(catA);
  });

  it("교환 후 selectedFolderForAssign이 null로 리셋", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.setSelectedFolderForAssign("folder1");
    });

    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    act(() => {
      result.current.swapFolderCategories("folder1", "folder2", customFolders);
    });

    expect(result.current.selectedFolderForAssign).toBeNull();
  });

  it("교환 결과가 localStorage에 반영", () => {
    const { result } = renderHook(() => useFolderCategories());

    addCategoriesSequentially(result, ["카테고리A", "카테고리B"]);

    const catA = result.current.folderCategories[0].id;
    const catB = result.current.folderCategories[1].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", catA);
    });
    act(() => {
      result.current.assignFolderToCategory("folder2", catB);
    });

    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    act(() => {
      result.current.swapFolderCategories("folder1", "folder2", customFolders);
    });

    const savedMap = JSON.parse(
      localStorageMock._getStore()["review_folder_category_map"]
    );
    expect(savedMap["folder1"]).toBe(catB);
    expect(savedMap["folder2"]).toBe(catA);
  });
});

// ============================================================
// handleFolderClickInAssignMode — 배정 모드 클릭 동작
// ============================================================
describe("handleFolderClickInAssignMode", () => {
  it("아무것도 선택 안 된 상태에서 클릭 → 선택", () => {
    const { result } = renderHook(() => useFolderCategories());
    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    act(() => {
      result.current.handleFolderClickInAssignMode("folder1", customFolders);
    });

    expect(result.current.selectedFolderForAssign).toBe("folder1");
  });

  it("같은 폴더 다시 클릭 → 선택 해제", () => {
    const { result } = renderHook(() => useFolderCategories());
    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    act(() => {
      result.current.handleFolderClickInAssignMode("folder1", customFolders);
    });

    act(() => {
      result.current.handleFolderClickInAssignMode("folder1", customFolders);
    });

    expect(result.current.selectedFolderForAssign).toBeNull();
  });

  it("다른 폴더 클릭 → 교환 실행", () => {
    const { result } = renderHook(() => useFolderCategories());

    addCategoriesSequentially(result, ["카테고리A", "카테고리B"]);

    const catA = result.current.folderCategories[0].id;
    const catB = result.current.folderCategories[1].id;

    act(() => {
      result.current.assignFolderToCategory("folder1", catA);
    });
    act(() => {
      result.current.assignFolderToCategory("folder2", catB);
    });

    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    // 첫 번째 클릭 — 선택
    act(() => {
      result.current.handleFolderClickInAssignMode("folder1", customFolders);
    });

    // 두 번째 클릭 — 교환
    act(() => {
      result.current.handleFolderClickInAssignMode("folder2", customFolders);
    });

    // 카테고리 교환 실행됨
    expect(result.current.folderCategoryMap["folder1"]).toBe(catB);
    expect(result.current.folderCategoryMap["folder2"]).toBe(catA);
    // 선택 해제됨
    expect(result.current.selectedFolderForAssign).toBeNull();
  });
});

// ============================================================
// localStorage 영속성 — 저장 및 복원
// ============================================================
describe("localStorage 영속성", () => {
  it("카테고리를 추가하면 localStorage에 저장되고, 새 훅에서 복원", () => {
    // 첫 번째 훅: 카테고리 추가
    const { result: result1 } = renderHook(() => useFolderCategories());

    addCategoriesSequentially(result1, ["생물학", "미생물학"]);

    // 두 번째 훅: localStorage에서 복원
    const { result: result2 } = renderHook(() => useFolderCategories());

    expect(result2.current.folderCategories).toHaveLength(2);
    expect(result2.current.folderCategories[0].name).toBe("생물학");
    expect(result2.current.folderCategories[1].name).toBe("미생물학");
  });

  it("폴더-카테고리 매핑이 localStorage에서 복원", () => {
    const { result: result1 } = renderHook(() => useFolderCategories());

    act(() => {
      result1.current.addCategory("카테고리A");
    });

    const categoryId = result1.current.folderCategories[0].id;

    act(() => {
      result1.current.assignFolderToCategory("folder1", categoryId);
    });

    // 새 훅에서 복원
    const { result: result2 } = renderHook(() => useFolderCategories());

    expect(result2.current.folderCategoryMap["folder1"]).toBe(categoryId);
  });

  it("순서 맵이 localStorage에서 복원", () => {
    const { result: result1 } = renderHook(() => useFolderCategories());

    const customFolders = [{ id: "folder1" }, { id: "folder2" }];

    // 미배정 폴더끼리 순서 교환 → folderOrderMap 변경
    act(() => {
      result1.current.swapFolderCategories(
        "folder1",
        "folder2",
        customFolders
      );
    });

    // 새 훅에서 복원
    const { result: result2 } = renderHook(() => useFolderCategories());

    expect(result2.current.folderOrderMap["folder1"]).toBe(1);
    expect(result2.current.folderOrderMap["folder2"]).toBe(0);
  });

  it("잘못된 JSON이 저장되어 있으면 무시하고 빈 상태로 시작", () => {
    // 직접 잘못된 JSON 설정
    localStorageMock.setItem("review_folder_categories", "{ 잘못된 JSON ]]");
    localStorageMock.setItem("review_folder_category_map", "not-json");
    localStorageMock.setItem("review_folder_order_map", "{{{");

    const { result } = renderHook(() => useFolderCategories());

    // 에러 없이 빈 상태
    expect(result.current.folderCategories).toEqual([]);
    expect(result.current.folderCategoryMap).toEqual({});
    expect(result.current.folderOrderMap).toEqual({});
  });

  it("localStorage가 비어있으면 빈 상태로 시작", () => {
    // 이미 beforeEach에서 clear 호출됨
    const { result } = renderHook(() => useFolderCategories());

    expect(result.current.folderCategories).toEqual([]);
    expect(result.current.folderCategoryMap).toEqual({});
    expect(result.current.folderOrderMap).toEqual({});
  });
});

// ============================================================
// 모드 토글 — isSortMode, isAssignMode
// ============================================================
describe("모드 토글", () => {
  it("정렬 모드 켜기/끄기", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.setIsSortMode(true);
    });
    expect(result.current.isSortMode).toBe(true);

    act(() => {
      result.current.setIsSortMode(false);
    });
    expect(result.current.isSortMode).toBe(false);
  });

  it("배정 모드 켜기/끄기", () => {
    const { result } = renderHook(() => useFolderCategories());

    act(() => {
      result.current.setIsAssignMode(true);
    });
    expect(result.current.isAssignMode).toBe(true);

    act(() => {
      result.current.setIsAssignMode(false);
    });
    expect(result.current.isAssignMode).toBe(false);
  });
});
