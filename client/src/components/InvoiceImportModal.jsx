import { useMemo, useRef, useState } from 'react';
import { materials as materialsApi } from '../api';
import MaterialLocationFields from './MaterialLocationFields';

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toItemsWithIds(items = []) {
  return items.map((row) => ({
    _id: uid(),
    name: String(row?.name || '').trim(),
    unit: String(row?.unit || 'шт').trim() || 'шт',
    quantity: Number(row?.quantity) || 0,
    price: Number(row?.price) || 0,
    description: String(row?.description || '').trim(),
    source_page: row?.source_page || null,
    is_estimated: !!row?.is_estimated,
  }));
}

function summarizePages(files) {
  return files.map((file, index) => ({
    id: uid(),
    file,
    name: file.name || `Лист ${index + 1}`,
    type: file.type || '',
    size: file.size || 0,
    previewUrl: file.type?.startsWith('image/') ? URL.createObjectURL(file) : '',
  }));
}

export default function InvoiceImportModal({
  catalog,
  onClose,
  onImported,
}) {
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const [pages, setPages] = useState([]);
  const [recognizing, setRecognizing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [recognizedItems, setRecognizedItems] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [recognizedOnce, setRecognizedOnce] = useState(false);
  const [locationForm, setLocationForm] = useState({
    object_id: '',
    warehouse_id: '',
    rack_id: '',
    category_id: '',
    system_id: '',
    organization_id: '',
  });

  const validItems = useMemo(
    () => recognizedItems.filter((item) => String(item.name || '').trim() && Number(item.quantity) > 0),
    [recognizedItems],
  );
  const estimatedCount = useMemo(
    () => recognizedItems.filter((item) => item.is_estimated).length,
    [recognizedItems],
  );

  const releasePreviews = (rows) => {
    for (const row of rows) {
      if (row.previewUrl) URL.revokeObjectURL(row.previewUrl);
    }
  };

  const closeModal = () => {
    releasePreviews(pages);
    onClose();
  };

  const appendFiles = (list) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setError('');
    setRecognizedOnce(false);
    setRecognizedItems([]);
    setWarnings([]);
    setPages((prev) => [...prev, ...summarizePages(files)]);
  };

  const removePage = (id) => {
    setPages((prev) => {
      const target = prev.find((row) => row.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((row) => row.id !== id);
    });
  };

  const recognize = async () => {
    if (!pages.length) {
      setError('Добавьте хотя бы один лист накладной.');
      return;
    }
    setRecognizing(true);
    setError('');
    try {
      const files = pages.map((row) => row.file);
      const result = await materialsApi.recognizeInvoice(files);
      setRecognizedItems(toItemsWithIds(result?.items || []));
      setWarnings(Array.isArray(result?.warnings) ? result.warnings : []);
      setRecognizedOnce(true);
      if (!Array.isArray(result?.items) || result.items.length === 0) {
        setError('Не удалось распознать позиции. Проверьте качество фото или добавьте данные вручную.');
      }
    } catch (recognizeError) {
      setError(recognizeError.message || 'Ошибка распознавания накладной');
    } finally {
      setRecognizing(false);
    }
  };

  const addEmptyItem = () => {
    setRecognizedItems((prev) => ([...prev, {
      _id: uid(),
      name: '',
      unit: 'шт',
      quantity: 1,
      price: 0,
      description: '',
      source_page: null,
      is_estimated: false,
    }]));
  };

  const updateItem = (id, key, value) => {
    setRecognizedItems((prev) => prev.map((item) => {
      if (item._id !== id) return item;
      if (key === 'quantity' || key === 'price') {
        return {
          ...item,
          [key]: Number.parseFloat(value) || 0,
          is_estimated: key === 'quantity' ? false : item.is_estimated,
        };
      }
      return {
        ...item,
        [key]: value,
        is_estimated: key === 'name' || key === 'unit' ? false : item.is_estimated,
      };
    }));
  };

  const deleteItem = (id) => {
    setRecognizedItems((prev) => prev.filter((item) => item._id !== id));
  };

  const importItems = async () => {
    if (!validItems.length) {
      setError('Нет корректных позиций для добавления на склад.');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const payload = {
        items: validItems.map((item) => ({
          name: String(item.name || '').trim(),
          unit: String(item.unit || 'шт').trim() || 'шт',
          quantity: Number(item.quantity) || 0,
          price: Number(item.price) || 0,
          description: String(item.description || '').trim(),
        })),
        ...locationForm,
      };
      const result = await materialsApi.importInvoice(payload);
      onImported(result);
      closeModal();
    } catch (importError) {
      setError(importError.message || 'Не удалось добавить материалы на склад');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-backdrop z-50" onClick={closeModal}>
      <div
        className="card p-5 max-w-5xl w-full max-h-[92vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-white text-lg font-semibold">Добавить по накладной</h3>
            <p className="text-zinc-500 text-xs">
              Сканируйте листы с телефона или загрузите фото/PDF, затем нажмите «Распознать».
            </p>
          </div>
          <button type="button" className="btn-ghost text-sm" onClick={closeModal}>
            Закрыть
          </button>
        </div>

        {error && <p className="alert-error mb-3">{error}</p>}

        <div className="rounded-xl border border-white/10 p-3 bg-white/[0.02] mb-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => cameraInputRef.current?.click()}
              disabled={recognizing || importing}
            >
              Сканировать лист
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={recognizing || importing}
            >
              Загрузить фото / PDF
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={recognize}
              disabled={recognizing || importing || !pages.length}
            >
              {recognizing ? 'Распознавание…' : 'Распознать'}
            </button>
          </div>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              appendFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(event) => {
              appendFiles(event.target.files);
              event.target.value = '';
            }}
          />
          {pages.length > 0 && (
            <p className="text-2xs text-emerald-300 mt-2">
              Добавлено листов: {pages.length}. Можно сканировать ещё или перейти к распознаванию.
            </p>
          )}
        </div>

        {pages.length > 0 && (
          <div className="mb-4">
            <p className="text-zinc-400 text-xs mb-2">Листы накладной</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {pages.map((row, idx) => (
                <div key={row.id} className="rounded-lg border border-white/10 p-2 bg-black/20">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-zinc-200 text-xs truncate">{row.name}</p>
                      <p className="text-zinc-500 text-2xs">
                        Лист {idx + 1}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-zinc-500 hover:text-red-300 text-xs"
                      onClick={() => removePage(row.id)}
                    >
                      Удалить
                    </button>
                  </div>
                  {row.previewUrl && (
                    <img
                      src={row.previewUrl}
                      alt={`Лист ${idx + 1}`}
                      className="mt-2 w-full h-28 object-cover rounded border border-white/10"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-amber-300 text-sm mb-1">Замечания распознавания</p>
            <ul className="space-y-1 text-2xs text-amber-200/90">
              {warnings.map((warning, index) => (
                <li key={`${warning.file_name || warning.page_number}-${index}`}>
                  {warning.file_name || `Лист ${warning.page_number}`}: {warning.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {recognizedOnce && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-zinc-300 text-sm">
                Распознанные позиции: {recognizedItems.length}
              </p>
              <button type="button" className="btn-ghost text-sm" onClick={addEmptyItem}>
                + Позиция вручную
              </button>
            </div>
            {estimatedCount > 0 && (
              <p className="text-amber-300 text-2xs">
                {estimatedCount} поз. распознаны частично (единица/кол-во могли быть не считаны). Проверьте перед добавлением.
              </p>
            )}
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-xs">
                <thead className="bg-zinc-900/70 text-zinc-400">
                  <tr>
                    <th className="p-2 text-left">Наименование</th>
                    <th className="p-2 text-left w-24">Ед.</th>
                    <th className="p-2 text-left w-28">Кол-во</th>
                    <th className="p-2 text-left w-32">Цена</th>
                    <th className="p-2 text-left">Описание</th>
                    <th className="p-2 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {recognizedItems.map((item) => (
                    <tr key={item._id} className="border-t border-white/5">
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(event) => updateItem(item._id, 'name', event.target.value)}
                          className="input h-9 text-xs"
                        />
                        {item.is_estimated && (
                          <p className="text-[10px] text-amber-300 mt-1">Проверьте строку</p>
                        )}
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(event) => updateItem(item._id, 'unit', event.target.value)}
                          className="input h-9 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={item.quantity}
                          onChange={(event) => updateItem(item._id, 'quantity', event.target.value)}
                          className="input h-9 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={item.price}
                          onChange={(event) => updateItem(item._id, 'price', event.target.value)}
                          className="input h-9 text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(event) => updateItem(item._id, 'description', event.target.value)}
                          className="input h-9 text-xs"
                          placeholder={item.source_page ? `Распознано с листа ${item.source_page}` : ''}
                        />
                      </td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          className="text-red-300 hover:text-red-200"
                          onClick={() => deleteItem(item._id)}
                          title="Удалить позицию"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                  {recognizedItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-zinc-500">
                        Позиции не найдены. Добавьте их вручную.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-white/10 p-3 bg-white/[0.02]">
              <p className="text-zinc-300 text-sm mb-2">Куда добавить позиции</p>
              <MaterialLocationFields
                catalog={catalog}
                form={locationForm}
                setForm={setLocationForm}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost" onClick={closeModal} disabled={recognizing || importing}>
            Отмена
          </button>
          {recognizedOnce && (
            <button
              type="button"
              className="btn-primary"
              onClick={importItems}
              disabled={importing || recognizing || validItems.length === 0}
            >
              {importing ? 'Добавление…' : 'Добавить на склад'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
