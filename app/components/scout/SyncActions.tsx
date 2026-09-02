'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Loader2 } from 'lucide-react';
import type { Ramo } from '@/app/lib/data';

type SyncActionsProps = {
  selectedId: string;
  ramoAtual?: Ramo;
};

export default function SyncActions({ selectedId, ramoAtual = 'Escoteiro' }: SyncActionsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingSingle, setSyncingSingle] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  async function handleSyncAll() {
    if (syncingAll) return;
    setSyncingAll(true);
    setFeedback({ message: `Sincronizando ${ramoAtual.toLowerCase()}s com o Paxtu...`, isError: false });

    try {
      // No futuro, aceita /api/sync/alcateia, /api/sync/senior etc.
      const endpoint = ramoAtual === 'Escoteiro' ? '/api/sync/escoteiro' : `/api/sync/${ramoAtual.toLowerCase()}`;
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha na sincronização da tropa.');
      }

      setFeedback({
        message: `Sincronização concluída: ${data.sucessos} jovem(ns) atualizados.`,
        isError: false,
      });

      // Revalida os dados do servidor Next.js sem reload de página
      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      let friendlyMsg = err.message || 'Falha na sincronização.';
      if (friendlyMsg.includes('sessaoTerminada') || friendlyMsg.includes('Sessão expirada') || friendlyMsg.includes('PAXTU_COOKIE')) {
        friendlyMsg = 'Sessão do Paxtu expirou. Execute "npm run paxtu:login" no terminal para renovar.';
      }
      setFeedback({ message: `Erro: ${friendlyMsg}`, isError: true });
    } finally {
      setSyncingAll(false);
    }
  }

  async function handleSyncSingle() {
    if (!selectedId || syncingSingle) return;
    setSyncingSingle(true);
    setFeedback({ message: 'Sincronizando dados deste jovem...', isError: false });

    try {
      const res = await fetch(`/api/sync/${selectedId}`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha ao sincronizar o jovem.');
      }

      setFeedback({ message: 'Dados atualizados com sucesso.', isError: false });

      // Revalida os dados mantendo exatamente o jovem na tela
      startTransition(() => {
        router.refresh();
      });
    } catch (err: any) {
      setFeedback({ message: `Erro: ${err.message}`, isError: true });
    } finally {
      setSyncingSingle(false);
    }
  }

  return (
    <div>
      {/* Botão de Sincronização em Massa (para o Cabeçalho) */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', alignItems: 'center' }}>
        <button
          onClick={handleSyncAll}
          disabled={syncingAll}
          style={{
            opacity: syncingAll ? 0.7 : 1,
            cursor: syncingAll ? 'not-allowed' : 'pointer',
          }}
        >
          {syncingAll ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
          {syncingAll ? `Sincronizando ${ramoAtual}...` : `Sincronizar ${ramoAtual}s`}
        </button>
      </div>

      {feedback && (
        <p
          style={{
            textAlign: 'center',
            marginTop: '0.8rem',
            color: feedback.isError ? 'var(--error)' : 'var(--primary)',
            fontSize: '0.9rem',
          }}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

export function SyncSingleButton({
  selectedId,
  onSyncComplete,
}: {
  selectedId: string;
  onSyncComplete?: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSync() {
    if (!selectedId || syncing) return;
    setSyncing(true);
    setMsg(null);

    try {
      const res = await fetch(`/api/sync/${selectedId}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha ao sincronizar jovem.');
      }
      setMsg('Atualizado com sucesso!');
      startTransition(() => {
        router.refresh();
        onSyncComplete?.();
      });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      let friendlyMsg = err.message || 'Falha ao sincronizar.';
      if (friendlyMsg.includes('sessaoTerminada') || friendlyMsg.includes('Sessão expirada') || friendlyMsg.includes('PAXTU_COOKIE')) {
        friendlyMsg = 'Sessão do Paxtu expirou. Execute "npm run paxtu:login" no terminal para renovar.';
      }
      setMsg(`Erro: ${friendlyMsg}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
      {msg && (
        <span
          style={{
            fontSize: '0.85rem',
            color: msg.startsWith('Erro') ? 'var(--error)' : 'var(--primary)',
          }}
        >
          {msg}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={syncing}
        style={{
          fontSize: '0.9rem',
          padding: '0.8rem 1.5rem',
          background: 'transparent',
          border: '1px solid var(--primary)',
          color: 'var(--primary)',
          opacity: syncing ? 0.6 : 1,
        }}
      >
        {syncing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
        {syncing ? 'Atualizando...' : 'Sincronizar dados deste jovem'}
      </button>
    </div>
  );
}
