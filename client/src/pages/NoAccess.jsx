export default function NoAccess({ user, onLogout }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center">
      <p className="text-white text-sm font-medium">Нет доступных разделов</p>
      <p className="text-zinc-500 text-xs max-w-sm">
        У учётной записи {user?.display_name || user?.login || ''} не назначены права. Обратитесь к администратору.
      </p>
      <button type="button" className="btn-secondary" onClick={onLogout}>
        Выйти
      </button>
    </div>
  );
}
