/**
 * Shop 아이템 데이터
 * 카테고리별 아이템 목록, 가격, 이미지 경로 정의
 *
 * 참고: 갑옷은 계급으로만 획득 가능 (Shop 구매 불가)
 */

// Shop 아이템 카테고리 타입
export type ShopCategory =
  | 'weapon'      // 무기
  | 'hat'         // 모자
  | 'mask'        // 마스크
  | 'glasses'     // 안경
  | 'cape'        // 망토
  | 'pet'         // 펫
  | 'effect'      // 이펙트
  | 'accessory';  // 악세서리

// Shop 아이템 타입
export interface ShopItem {
  // 아이템 고유 ID
  id: string;
  // 아이템 이름
  name: string;
  // 카테고리
  category: ShopCategory;
  // 가격 (골드)
  price: number;
  // 이미지 경로
  imagePath: string;
  // 아이템 설명
  description?: string;
  // 희귀도 (common, rare, epic, legendary)
  rarity?: 'common' | 'rare' | 'epic' | 'legendary';
}

// 카테고리 정보 타입
export interface CategoryInfo {
  id: ShopCategory;
  name: string;
  icon: string;
}

// 카테고리 목록
export const SHOP_CATEGORIES: CategoryInfo[] = [
  { id: 'weapon', name: '무기', icon: '⚔️' },
  { id: 'hat', name: '모자', icon: '🎩' },
  { id: 'mask', name: '마스크', icon: '🎭' },
  { id: 'glasses', name: '안경', icon: '👓' },
  { id: 'cape', name: '망토', icon: '🧥' },
  { id: 'pet', name: '펫', icon: '🐾' },
  { id: 'effect', name: '이펙트', icon: '✨' },
  { id: 'accessory', name: '악세서리', icon: '💍' },
];

// 희귀도별 색상
export const RARITY_COLORS = {
  common: '#9CA3AF',     // 회색
  rare: '#3B82F6',       // 파란색
  epic: '#A855F7',       // 보라색
  legendary: '#F59E0B',  // 황금색
};

// 희귀도별 이름
export const RARITY_NAMES = {
  common: '일반',
  rare: '희귀',
  epic: '영웅',
  legendary: '전설',
};

// Shop 아이템 데이터
export const SHOP_ITEMS: ShopItem[] = [
  // === 무기 (Weapon) ===
  {
    id: 'weapon_axe',
    name: '도끼',
    category: 'weapon',
    price: 500,
    imagePath: '/items/weapons/axe.png',
    description: '묵직한 전투용 도끼',
    rarity: 'common',
  },
  {
    id: 'weapon_spear',
    name: '창',
    category: 'weapon',
    price: 600,
    imagePath: '/items/weapons/spear.png',
    description: '날카로운 전투용 창',
    rarity: 'common',
  },
  {
    id: 'weapon_bow',
    name: '활',
    category: 'weapon',
    price: 700,
    imagePath: '/items/weapons/bow.png',
    description: '정확한 명중률의 활',
    rarity: 'rare',
  },
  {
    id: 'weapon_staff',
    name: '지팡이',
    category: 'weapon',
    price: 800,
    imagePath: '/items/weapons/staff.png',
    description: '마법이 깃든 지팡이',
    rarity: 'rare',
  },
  {
    id: 'weapon_hammer',
    name: '망치',
    category: 'weapon',
    price: 900,
    imagePath: '/items/weapons/hammer.png',
    description: '강력한 타격의 망치',
    rarity: 'epic',
  },
  {
    id: 'weapon_trident',
    name: '삼지창',
    category: 'weapon',
    price: 1000,
    imagePath: '/items/weapons/trident.png',
    description: '바다의 힘을 담은 삼지창',
    rarity: 'epic',
  },
  {
    id: 'weapon_scythe',
    name: '낫',
    category: 'weapon',
    price: 1500,
    imagePath: '/items/weapons/scythe.png',
    description: '죽음을 상징하는 낫',
    rarity: 'legendary',
  },

  // === 모자 (Hat) ===
  {
    id: 'hat_helmet',
    name: '투구',
    category: 'hat',
    price: 400,
    imagePath: '/items/hats/helmet.png',
    description: '단단한 전투용 투구',
    rarity: 'common',
  },
  {
    id: 'hat_crown',
    name: '왕관',
    category: 'hat',
    price: 1200,
    imagePath: '/items/hats/crown.png',
    description: '왕의 위엄이 담긴 왕관',
    rarity: 'legendary',
  },
  {
    id: 'hat_wizard',
    name: '마법사모자',
    category: 'hat',
    price: 600,
    imagePath: '/items/hats/wizard.png',
    description: '신비로운 마법사의 모자',
    rarity: 'rare',
  },
  {
    id: 'hat_beret',
    name: '베레모',
    category: 'hat',
    price: 300,
    imagePath: '/items/hats/beret.png',
    description: '세련된 베레모',
    rarity: 'common',
  },
  {
    id: 'hat_bandana',
    name: '두건',
    category: 'hat',
    price: 250,
    imagePath: '/items/hats/bandana.png',
    description: '모험가의 두건',
    rarity: 'common',
  },
  {
    id: 'hat_cone',
    name: '고깔',
    category: 'hat',
    price: 200,
    imagePath: '/items/hats/cone.png',
    description: '파티용 고깔모자',
    rarity: 'common',
  },

  // === 마스크 (Mask) ===
  {
    id: 'mask_basic',
    name: '가면',
    category: 'mask',
    price: 350,
    imagePath: '/items/masks/basic.png',
    description: '신비로운 가면',
    rarity: 'common',
  },
  {
    id: 'mask_eyepatch',
    name: '안대',
    category: 'mask',
    price: 250,
    imagePath: '/items/masks/eyepatch.png',
    description: '해적 스타일 안대',
    rarity: 'common',
  },
  {
    id: 'mask_skull',
    name: '해골마스크',
    category: 'mask',
    price: 800,
    imagePath: '/items/masks/skull.png',
    description: '무시무시한 해골마스크',
    rarity: 'epic',
  },
  {
    id: 'mask_fox',
    name: '여우가면',
    category: 'mask',
    price: 600,
    imagePath: '/items/masks/fox.png',
    description: '교활한 여우가면',
    rarity: 'rare',
  },

  // === 안경 (Glasses) ===
  {
    id: 'glasses_round',
    name: '둥근안경',
    category: 'glasses',
    price: 200,
    imagePath: '/items/glasses/round.png',
    description: '지적인 느낌의 둥근안경',
    rarity: 'common',
  },
  {
    id: 'glasses_sunglasses',
    name: '선글라스',
    category: 'glasses',
    price: 400,
    imagePath: '/items/glasses/sunglasses.png',
    description: '멋진 선글라스',
    rarity: 'rare',
  },
  {
    id: 'glasses_horn',
    name: '뿔테',
    category: 'glasses',
    price: 300,
    imagePath: '/items/glasses/horn.png',
    description: '클래식한 뿔테안경',
    rarity: 'common',
  },
  {
    id: 'glasses_monocle',
    name: '외알안경',
    category: 'glasses',
    price: 500,
    imagePath: '/items/glasses/monocle.png',
    description: '우아한 외알안경',
    rarity: 'rare',
  },
  {
    id: 'glasses_vr',
    name: 'VR고글',
    category: 'glasses',
    price: 1000,
    imagePath: '/items/glasses/vr.png',
    description: '미래에서 온 VR고글',
    rarity: 'epic',
  },

  // === 망토 (Cape) ===
  {
    id: 'cape_red',
    name: '빨강망토',
    category: 'cape',
    price: 500,
    imagePath: '/items/capes/red.png',
    description: '용감한 용사의 빨강망토',
    rarity: 'common',
  },
  {
    id: 'cape_blue',
    name: '파랑망토',
    category: 'cape',
    price: 500,
    imagePath: '/items/capes/blue.png',
    description: '차분한 마법사의 파랑망토',
    rarity: 'common',
  },
  {
    id: 'cape_black',
    name: '검정망토',
    category: 'cape',
    price: 600,
    imagePath: '/items/capes/black.png',
    description: '신비로운 검정망토',
    rarity: 'rare',
  },
  {
    id: 'cape_gold',
    name: '황금망토',
    category: 'cape',
    price: 1500,
    imagePath: '/items/capes/gold.png',
    description: '왕실의 황금망토',
    rarity: 'legendary',
  },
  {
    id: 'cape_invisible',
    name: '투명망토',
    category: 'cape',
    price: 2000,
    imagePath: '/items/capes/invisible.png',
    description: '전설의 투명망토',
    rarity: 'legendary',
  },

  // === 펫 (Pet) ===
  {
    id: 'pet_dog',
    name: '강아지',
    category: 'pet',
    price: 800,
    imagePath: '/items/pets/dog.png',
    description: '충성스러운 강아지 펫',
    rarity: 'rare',
  },
  {
    id: 'pet_cat',
    name: '고양이',
    category: 'pet',
    price: 800,
    imagePath: '/items/pets/cat.png',
    description: '귀여운 고양이 펫',
    rarity: 'rare',
  },
  {
    id: 'pet_eagle',
    name: '독수리',
    category: 'pet',
    price: 1000,
    imagePath: '/items/pets/eagle.png',
    description: '하늘의 왕 독수리 펫',
    rarity: 'epic',
  },
  {
    id: 'pet_dragon',
    name: '드래곤',
    category: 'pet',
    price: 3000,
    imagePath: '/items/pets/dragon.png',
    description: '전설의 드래곤 펫',
    rarity: 'legendary',
  },
  {
    id: 'pet_slime',
    name: '슬라임',
    category: 'pet',
    price: 500,
    imagePath: '/items/pets/slime.png',
    description: '귀여운 슬라임 펫',
    rarity: 'common',
  },

  // === 이펙트 (Effect) ===
  {
    id: 'effect_fire',
    name: '불꽃',
    category: 'effect',
    price: 1000,
    imagePath: '/items/effects/fire.png',
    description: '타오르는 불꽃 이펙트',
    rarity: 'epic',
  },
  {
    id: 'effect_lightning',
    name: '번개',
    category: 'effect',
    price: 1200,
    imagePath: '/items/effects/lightning.png',
    description: '번쩍이는 번개 이펙트',
    rarity: 'epic',
  },
  {
    id: 'effect_aura',
    name: '오라',
    category: 'effect',
    price: 800,
    imagePath: '/items/effects/aura.png',
    description: '신비로운 오라 이펙트',
    rarity: 'rare',
  },
  {
    id: 'effect_sparkle',
    name: '반짝이',
    category: 'effect',
    price: 600,
    imagePath: '/items/effects/sparkle.png',
    description: '반짝반짝 빛나는 이펙트',
    rarity: 'rare',
  },

  // === 악세서리 (Accessory) ===
  {
    id: 'accessory_earring',
    name: '귀걸이',
    category: 'accessory',
    price: 300,
    imagePath: '/items/accessories/earring.png',
    description: '세련된 귀걸이',
    rarity: 'common',
  },
  {
    id: 'accessory_necklace',
    name: '목걸이',
    category: 'accessory',
    price: 400,
    imagePath: '/items/accessories/necklace.png',
    description: '우아한 목걸이',
    rarity: 'rare',
  },
  {
    id: 'accessory_tattoo',
    name: '문신',
    category: 'accessory',
    price: 700,
    imagePath: '/items/accessories/tattoo.png',
    description: '멋진 문신 스티커',
    rarity: 'epic',
  },
  {
    id: 'accessory_wings',
    name: '날개',
    category: 'accessory',
    price: 2500,
    imagePath: '/items/accessories/wings.png',
    description: '천사의 날개',
    rarity: 'legendary',
  },
];

// 카테고리별 아이템 가져오기
export function getItemsByCategory(category: ShopCategory): ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.category === category);
}

// 아이템 ID로 아이템 가져오기
export function getItemById(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === id);
}

// 희귀도별 아이템 가져오기
export function getItemsByRarity(
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
): ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.rarity === rarity);
}

// 가격 범위로 아이템 가져오기
export function getItemsByPriceRange(
  minPrice: number,
  maxPrice: number
): ShopItem[] {
  return SHOP_ITEMS.filter(
    (item) => item.price >= minPrice && item.price <= maxPrice
  );
}

// 골드 포맷팅 (1000 -> 1,000)
export function formatGold(gold: number): string {
  return gold.toLocaleString('ko-KR');
}
