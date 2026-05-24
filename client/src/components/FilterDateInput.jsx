function openDatePicker(e) {
  const el = e.currentTarget;
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker();
    } catch {
      /* already open or unsupported */
    }
  }
}

export default function FilterDateInput({ value, onChange, className = '' }) {
  return (
    <input
      type="date"
      value={value}
      onChange={onChange}
      onClick={openDatePicker}
      className={`filter-input filter-date-input ${className}`.trim()}
    />
  );
}
