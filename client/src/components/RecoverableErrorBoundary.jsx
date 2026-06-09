import React from 'react';

const CHUNK_ERROR_MARKERS = [
  'ChunkLoadError',
  'Loading chunk',
  'dynamically imported module',
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
];

function isChunkLoadError(error) {
  const message = String(error?.message || '');
  const name = String(error?.name || '');
  const stack = String(error?.stack || '');
  const haystack = `${name}\n${message}\n${stack}`;
  return CHUNK_ERROR_MARKERS.some((marker) => haystack.includes(marker));
}

const APP_INDEXED_DB_NAMES = [
  'warehouse-app-offline',
  'warehouse-app-actions',
];

function deleteIndexedDb(name) {
  return new Promise((resolve) => {
    if (!name || typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = finish;
      req.onerror = finish;
      req.onblocked = finish;
      // Не зависаем, если вкладки держат открытое соединение.
      setTimeout(finish, 1200);
    } catch {
      finish();
    }
  });
}

async function hardResetApplicationCaches() {
  if (typeof window === 'undefined') return;

  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.allSettled((regs || []).map((reg) => reg.unregister()));
  }

  if ('caches' in window) {
    const names = await caches.keys().catch(() => []);
    await Promise.allSettled((names || []).map((name) => caches.delete(name)));
  }

  if (typeof indexedDB !== 'undefined') {
    await Promise.allSettled(APP_INDEXED_DB_NAMES.map((name) => deleteIndexedDb(name)));
  }
}

export default class RecoverableErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      nonce: 0,
      isChunkError: false,
      recovering: false,
    };
    this.pendingRecovery = null;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    const chunkError = isChunkLoadError(error);
    this.setState({ isChunkError: chunkError });

    if (typeof this.props.onError === 'function') {
      try {
        this.pendingRecovery = Promise.resolve(this.props.onError(error)).catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  handleRetry = async () => {
    this.setState({ recovering: true });
    try {
      if (this.pendingRecovery) {
        await this.pendingRecovery;
      }
    } catch {
      /* ignore */
    } finally {
      this.pendingRecovery = null;
    }
    this.setState((s) => ({
      hasError: false,
      nonce: s.nonce + 1,
      isChunkError: false,
      recovering: false,
    }));
  };

  handleAppReload = async () => {
    this.setState({ recovering: true });
    try {
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
        await registration?.update?.().catch(() => {});
      }
    } finally {
      this.setState({ recovering: false });
      window.location.reload();
    }
  };

  handleHardReset = async () => {
    this.setState({ recovering: true });
    try {
      await hardResetApplicationCaches();
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      const actionDisabled = this.state.recovering;
      return (
        <div className="card p-4 border border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-amber-300">
            {this.state.isChunkError
              ? 'Приложение было обновлено, а вкладка открыта в старой версии. Обновите приложение, чтобы загрузить актуальные файлы.'
              : 'Данные вкладки были повреждены в оффлайн-кэше. Кэш этой вкладки очищен, попробуйте открыть снова.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={this.handleRetry} className="btn-primary text-2xs" disabled={actionDisabled}>
              {actionDisabled ? 'Восстановление…' : 'Повторить'}
            </button>
            {this.state.isChunkError && (
              <button
                type="button"
                onClick={this.handleAppReload}
                className="btn-secondary text-2xs"
                disabled={actionDisabled}
              >
                Обновить приложение
              </button>
            )}
            <button
              type="button"
              onClick={this.handleHardReset}
              className="btn-ghost text-2xs"
              disabled={actionDisabled}
            >
              Полный сброс кэша
            </button>
          </div>
        </div>
      );
    }
    return (
      <React.Fragment key={this.state.nonce}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
