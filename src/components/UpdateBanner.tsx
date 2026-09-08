/**
 * "A new version is ready" — shown only when an update is being held back.
 *
 * Everywhere except Kikapu and Madeni the app just reloads, so this never
 * appears. On those two pages the reload waits for the user to be idle, which
 * could be a while at a busy counter — so they get the choice to take it now,
 * between customers, instead of being surprised mid-sale or waiting.
 *
 * Deliberately not a modal. Nothing here is urgent enough to interrupt a
 * transaction, which is the entire reason the update was deferred.
 */

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { applyUpdateNow, isUpdatePending, onPendingUpdateChange } from '../utils/autoUpdate';

export default function UpdateBanner() {
  const [pending, setPending] = useState(isUpdatePending());
  const [applying, setApplying] = useState(false);

  useEffect(() => onPendingUpdateChange(setPending), []);

  if (!pending) return null;

  return (
    <div className="fixed bottom-20 left-3 right-3 z-[60] flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 max-w-md w-full bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">New version available</p>
          <p className="text-[11px] text-slate-300 leading-snug">
            Auto update will be done later, You can update now.
          </p>
        </div>
        <button
          type="button"
          disabled={applying}
          onClick={() => { setApplying(true); applyUpdateNow(); }}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
            applying ? 'bg-slate-700 text-slate-400' : 'bg-white text-slate-900'
          }`}
          style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${applying ? 'animate-spin' : ''}`} />
          {applying ? 'Updating...' : 'Update'}
        </button>
      </div>
    </div>
  );
}
