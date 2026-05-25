/** Лёгкий индикатор при ленивой подгрузке вкладки. */
export default function TabLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white animate-spin" aria-hidden />
    </div>
  );
}
