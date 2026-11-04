import React from 'react';
import { Lock } from 'lucide-react';

export const PrivateProfileNotice: React.FC = () => (
  <div
    data-testid="private-profile-locked-notice"
    className="mx-auto my-12 flex max-w-xl flex-col items-center rounded-2xl border border-purple-900/40 bg-[#130E24]/90 p-8 text-center shadow-2xl backdrop-blur-md sm:p-12"
    role="status"
    aria-live="polite"
  >
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-purple-700/40 bg-purple-950/80 text-purple-400 shadow-inner">
      <Lock className="h-8 w-8" />
    </div>
    <h2 className="mt-4 text-xl font-bold text-white">Esta conta é privada</h2>
  </div>
);
