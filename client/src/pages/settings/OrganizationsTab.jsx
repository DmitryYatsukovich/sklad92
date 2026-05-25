import { useState, useEffect, useCallback } from 'react';
import { settings as settingsApi } from '../../api';

const EMPTY_FORM = {
  name: '',
  inn: '',
  kpp: '',
  ogrn: '',
  legal_address: '',
  actual_address: '',
  phone: '',
  email: '',
  director_name: '',
  bank_name: '',
  bank_bik: '',
  bank_account: '',
  bank_corr_account: '',
};

function isRowObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArrayOfObjects(value) {
  return Array.isArray(value)
    ? value.filter((row) => isRowObject(row))
    : [];
}

function orgToForm(row) {
  if (!row) return { ...EMPTY_FORM };
  return {
    name: row.name || '',
    inn: row.inn || '',
    kpp: row.kpp || '',
    ogrn: row.ogrn || '',
    legal_address: row.legal_address || '',
    actual_address: row.actual_address || '',
    phone: row.phone || '',
    email: row.email || '',
    director_name: row.director_name || '',
    bank_name: row.bank_name || '',
    bank_bik: row.bank_bik || '',
    bank_account: row.bank_account || '',
    bank_corr_account: row.bank_corr_account || '',
  };
}

export default function OrganizationsTab() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    settingsApi.organizations.list()
      .then((rows) => setList(asArrayOfObjects(rows)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const closeForm = () => {
    setFormOpen(false);
    setForm({ ...EMPTY_FORM });
    setEditing(null);
    setError('');
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setError('');
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm(orgToForm(row));
    setError('');
    setFormOpen(true);
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return setError('Укажите наименование организации');
    setError('');
    try {
      const body = { ...form, name };
      if (editing) await settingsApi.organizations.update(editing.id, body);
      else await settingsApi.organizations.create(body);
      closeForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Удалить организацию «${row.name}»?`)) return;
    setError('');
    try {
      await settingsApi.organizations.delete(row.id);
      if (editing?.id === row.id) closeForm();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-zinc-400 text-sm">
          Справочник юридических лиц. Созданные организации доступны в карточке пользователя в поле «Трудоустройство».
        </p>
        <button type="button" onClick={openCreate} className="btn-primary text-sm shrink-0">
          Добавить
        </button>
      </div>

      {error && !formOpen && <p className="text-rose-400 text-sm">{error}</p>}

      {loading ? (
        <p className="text-zinc-500 text-sm py-4">Загрузка…</p>
      ) : !list.length ? (
        <p className="text-zinc-500 text-sm py-4">Список пуст. Нажмите «Добавить», чтобы создать организацию.</p>
      ) : (
        <div className="table-wrap">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-zinc-300">
                <th className="p-3 font-medium">Наименование</th>
                <th className="p-3 font-medium">ИНН</th>
                <th className="p-3 font-medium">КПП</th>
                <th className="p-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id} className="border-b border-white/5">
                  <td className="p-3 text-white">{row.name}</td>
                  <td className="p-3 text-zinc-300">{row.inn || '—'}</td>
                  <td className="p-3 text-zinc-300">{row.kpp || '—'}</td>
                  <td className="p-3 text-right space-x-2">
                    <button type="button" onClick={() => openEdit(row)} className="text-sky-400 hover:text-sky-300 text-sm font-medium">
                      Изменить
                    </button>
                    <button type="button" onClick={() => handleDelete(row)} className="text-rose-400 hover:text-rose-300 text-sm font-medium">
                      Удал.
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <div
          className="modal-backdrop z-50"
          onClick={closeForm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="org-form-title"
        >
          <div
            className="card p-5 max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="org-form-title" className="text-white font-medium mb-4">
              {editing ? 'Редактирование организации' : 'Новая организация'}
            </h3>

            {error && <p className="text-rose-400 text-sm mb-4">{error}</p>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Наименование *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  className="input"
                  required
                  placeholder="ООО «Пример»"
                  autoFocus
                />
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">ИНН</label>
                  <input type="text" value={form.inn} onChange={(e) => setField('inn', e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">КПП</label>
                  <input type="text" value={form.kpp} onChange={(e) => setField('kpp', e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">ОГРН</label>
                  <input type="text" value={form.ogrn} onChange={(e) => setField('ogrn', e.target.value)} className="input" />
                </div>
              </div>

              <div>
                <label className="label">Юридический адрес</label>
                <textarea value={form.legal_address} onChange={(e) => setField('legal_address', e.target.value)} className="input min-h-[72px]" rows={2} />
              </div>
              <div>
                <label className="label">Фактический адрес</label>
                <textarea value={form.actual_address} onChange={(e) => setField('actual_address', e.target.value)} className="input min-h-[72px]" rows={2} />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Телефон</label>
                  <input type="text" value={form.phone} onChange={(e) => setField('phone', e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} className="input" />
                </div>
              </div>

              <div>
                <label className="label">Руководитель</label>
                <input type="text" value={form.director_name} onChange={(e) => setField('director_name', e.target.value)} className="input" placeholder="ФИО" />
              </div>

              <p className="text-zinc-400 text-xs font-medium pt-2">Банковские реквизиты</p>
              <div>
                <label className="label">Банк</label>
                <input type="text" value={form.bank_name} onChange={(e) => setField('bank_name', e.target.value)} className="input" />
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">БИК</label>
                  <input type="text" value={form.bank_bik} onChange={(e) => setField('bank_bik', e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Расчётный счёт</label>
                  <input type="text" value={form.bank_account} onChange={(e) => setField('bank_account', e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Корр. счёт</label>
                  <input type="text" value={form.bank_corr_account} onChange={(e) => setField('bank_corr_account', e.target.value)} className="input" />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="submit" className="btn-primary text-sm">
                  {editing ? 'Сохранить' : 'Добавить'}
                </button>
                <button type="button" onClick={closeForm} className="btn-secondary text-sm">
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
