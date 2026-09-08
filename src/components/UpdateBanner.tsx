/**
 * "A new version is ready" — shown only when an update is being held back.
 *
 * Everywhere except Kikapu and Madeni the app just reloads, so this never
 * appears. On those two pages the reload waits for the user to be idle, which
 * could be a while at a busy counter — so they get the choice to take it now,
 * between customers, instead of being surprised mid-sale or waiting.
 *
 * Top of the screen, not the bottom: the bottom belongs to the nav bar and the
 * keypad, and a bar down there competes with the controls someone is using.
 *
 * Deliberately not a modal. Nothing here is urgent enough to interrupt a
 * transaction, which is the entire reason the update was deferred.
 */

import { useEffect, useState } from 'react';
import { RefreshCw, ArrowUpCircle } from 'lucide-react';
import { applyUpdateNow, isUpdatePending, onPendingUpdateChange } from '../utils/autoUpdate';

export default function UpdateBanner() {
  const [pending, setPending] = useState(isUpdatePending());
  const [applying, setApplying] = useState(false);

  useEffect(() => onPendingUpdateChange(setPending), []);

  if (!pending) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[60] flex justify-center px-3 pointer-events-none"
      // The notch, Without this the bar sits under the status bar on an iPhone
      // and the first line of text is unreadable.
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
    >
      <div className="pointer-events-auto flex items-center gap-3 max-w-md w-full bg-[#0A0F2C] text-white rounded-2xl shadow-2xl shadow-[#0A0F2C]/30 border border-[#00D1FF]/20 px-4 py-3 animate-in slide-in-from-top-4 duration-300">
        <div className="bg-[#00D1FF]/15 p-2 rounded-xl shrink-0">
          <ArrowUpCircle className="w-5 h-5 text-[#00D1FF]" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">New version available</p>
          <p className="text-[11px] text-slate-300 leading-snug">
            Auto update will be done later, Click to update now.
          </p>
        </div>

        <button
          type="button"
          disabled={applying}
          onClick={() => { setApplying(true); applyUpdateNow(); }}
          className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black transition-colors ${
            applying
              ? 'bg-[#00D1FF]/30 text-[#0A0F2C]/60'
              : 'bg-[#00D1FF] text-[#0A0F2C] shadow-md shadow-[#00D1FF]/20'
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
