export default function ReviewLoading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#F5F0E8' }}
    >
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[#1A1A1A] border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-sm text-[#5C5C5C]">로딩 중...</p>
      </div>
    </div>
  );
}
