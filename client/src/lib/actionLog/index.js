export {
  recordAction,
  recordActionAfterSuccess,
  enqueueOfflineMutation,
  syncActionLogToServer,
  initActionLogSync,
  subscribeActionLog,
  getActionLogCounts,
  setActionLogUser,
  OFFLINE_QUEUED,
} from './sync.js';
export {
  buildActionFromRequest,
  shouldQueueOfflineMutation,
  shouldRecordAction,
  isNetworkFailure,
} from './buildAction.js';
export { listLocalActions } from './store.js';

export function isOfflineQueuedError(err) {
  return err?.code === OFFLINE_QUEUED;
}
