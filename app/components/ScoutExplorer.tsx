'use client';

import { useState, useMemo, useEffect, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, Loader2 } from 'lucide-react';
import type { Escoteiro, Ramo } from '@/app/lib/data';
import { PaxtuConnectButton } from './scout/PaxtuLoginModal';
import ProgressionView from './scout/ProgressionView';
import NovoProgramaView from './scout/NovoProgramaView';
import RegrasEquivalenciaView from './equivalencias/RegrasEquivalenciaView';

type Props = {
  escoteiros: Escoteiro[];
  selectedId: string;
  ramoAtual?: Ramo;
  initialView?: 'novo' | 'antigo';
};

const RAMOS: { label: string; value: Ramo }[] = [
  { label: 'Tropa Escoteira', value: 'Escoteiro' },
  { label: 'Alcateia (Lobinhos)', value: 'Lobinho' },
  { label: 'Tropa Sênior', value: 'Sênior' },
  { label: 'Clã Pioneiro', value: 'Pioneiro' },
];

export default function ScoutExplorer({
  escoteiros,
  selectedId,
  ramoAtual = 'Escoteiro',
  initialView = 'novo',
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [viewMode, setViewMode] = useState<'novo' | 'antigo'>(initialView);
  const [exibirMatriz, setExibirMatriz] = useState(false);

  const [syncProgress, setSyncProgress] = useState<{
    active: boolean;
    type: 'section' | 'single';
    percent: number;
    message: string;
    current?: number;
    total?: number;
    nome?: string;
    isError?: boolean;
  } | null>(null);

  useEffect(() => {
    setViewMode(initialView);
  }, [initialView]);

  // Identifica o jovem selecionado
  const escoteiro = useMemo(() => {
    return escoteiros.find((e) => e.associado.cd_associado === selectedId) || escoteiros[0];
  }, [escoteiros, selectedId]);

  const activeId = escoteiro?.associado.cd_associado ?? '';

  function handleRamoChange(novoRamo: Ramo) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('ramo', novoRamo);
    params.delete('jovem');

    startTransition(() => {
      router.push(`/?${params.toString()}`);
    });
  }

  function handleJovemChange(novoId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('jovem', novoId);

    startTransition(() => {
      router.push(`/?${params.toString()}`);
    });
  }

  async function handleSyncSection() {
    if (syncProgress?.active) return;
    setSyncProgress({
      active: true,
      type: 'section',
      percent: 5,
      message: `Iniciando conexão com o Paxtu para ${ramoAtual}...`,
    });

    try {
      const endpoint = ramoAtual === 'Escoteiro' ? '/api/sync/escoteiro' : `/api/sync/ramo/${ramoAtual.toLowerCase()}`;
      const res = await fetch(endpoint, { method: 'POST' });

      if (!res.ok && res.status !== 200) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Falha ao sincronizar seção.');
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Falha ao obter canal de dados do servidor.');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const json = JSON.parse(trimmed);
            if (json.type === 'error') {
              throw new Error(json.message || 'Erro durante a sincronização.');
            }
            setSyncProgress({
              active: json.type !== 'done',
              type: 'section',
              percent: json.percent ?? 50,
              message: json.message,
              current: json.current,
              total: json.total,
              nome: json.nome,
              isError: false,
            });
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }

      if (buffer.trim()) {
        try {
          const json = JSON.parse(buffer.trim());
          if (json.type === 'error') {
            throw new Error(json.message || 'Erro durante a sincronização.');
          }
          setSyncProgress({
            active: json.type !== 'done',
            type: 'section',
            percent: json.percent ?? 100,
            message: json.message,
            current: json.current,
            total: json.total,
            nome: json.nome,
            isError: false,
          });
        } catch (e: any) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }

      startTransition(() => {
        router.refresh();
      });

      setTimeout(() => {
        setSyncProgress((prev) => (prev?.active ? prev : null));
      }, 4500);
    } catch (err: any) {
      let friendlyMsg = err.message || 'Falha na sincronização.';
      if (friendlyMsg.includes('sessaoTerminada') || friendlyMsg.includes('Sessão expirada') || friendlyMsg.includes('PAXTU_COOKIE')) {
        friendlyMsg = 'Sessão do Paxtu expirou. Conecte suas credenciais pelo botão no topo.';
      }
      setSyncProgress({
        active: false,
        type: 'section',
        percent: 100,
        message: `Erro: ${friendlyMsg}`,
        isError: true,
      });
      setTimeout(() => setSyncProgress(null), 6000);
    }
  }

  async function handleSyncSingle() {
    if (!activeId || syncProgress?.active) return;
    const scoutNome = escoteiro?.associado.nm_associado || 'jovem';

    setSyncProgress({
      active: true,
      type: 'single',
      percent: 20,
      nome: scoutNome,
      message: `Conectando ao Paxtu para buscar dados de ${scoutNome}...`,
    });

    const pTimer1 = setTimeout(() => {
      setSyncProgress((prev) =>
        prev?.active
          ? {
              ...prev,
              percent: 60,
              message: `Baixando ficha de progressão e especialidades de ${scoutNome}...`,
            }
          : prev
      );
    }, 1200);

    const pTimer2 = setTimeout(() => {
      setSyncProgress((prev) =>
        prev?.active
          ? {
              ...prev,
              percent: 85,
              message: `Gravando banco de dados local para ${scoutNome}...`,
            }
          : prev
      );
    }, 2500);

    try {
      const res = await fetch(`/api/sync/${activeId}`, { method: 'POST' });
      clearTimeout(pTimer1);
      clearTimeout(pTimer2);

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha ao sincronizar o jovem.');
      }

      setSyncProgress({
        active: false,
        type: 'single',
        percent: 100,
        nome: scoutNome,
        message: `Dados de ${scoutNome} atualizados com sucesso do Paxtu!`,
        isError: false,
      });

      startTransition(() => {
        router.refresh();
      });
      setTimeout(() => setSyncProgress(null), 4000);
    } catch (err: any) {
      clearTimeout(pTimer1);
      clearTimeout(pTimer2);
      let friendlyMsg = err.message || 'Falha ao sincronizar.';
      if (friendlyMsg.includes('sessaoTerminada') || friendlyMsg.includes('Sessão expirada') || friendlyMsg.includes('PAXTU_COOKIE')) {
        friendlyMsg = 'Sessão do Paxtu expirou. Conecte suas credenciais pelo botão no topo.';
      }
      setSyncProgress({
        active: false,
        type: 'single',
        percent: 100,
        message: `Erro: ${friendlyMsg}`,
        isError: true,
      });
      setTimeout(() => setSyncProgress(null), 6000);
    }
  }

  return (
    <main className="container" style={{ maxWidth: '1440px', padding: '1.5rem 2rem 4rem' }}>
      {/* Header Centralizado com Título GEBV e Conectar Paxtu à Direita */}
      <header
        style={{
          position: 'relative',
          marginBottom: '2.5rem',
          textAlign: 'center',
          paddingTop: '0.5rem',
        }}
      >
        <h1
          style={{
            fontSize: '3.2rem',
            fontWeight: 900,
            letterSpacing: '-0.02em',
            color: 'var(--primary)',
            margin: 0,
            lineHeight: 1.1,
            textShadow: '0 0 30px rgba(0, 255, 136, 0.25)',
          }}
        >
          GEBV
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1.05rem', marginTop: '0.4rem', fontWeight: 500 }}>
          Gestão, Equivalência e Acompanhamento de Progressões Escoteiras
        </p>

        {/* Botão Conectar Paxtu (Antigo) no Canto Superior Direito */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '0.5rem',
          }}
        >
          <PaxtuConnectButton />
        </div>
      </header>

      <div className="dashboard" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* CARD 1: Seleção de Seção (Ramos), Seleção de Jovem e Botões de Sincronização */}
        <section
          className="card"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '2rem',
            padding: '1.75rem 2rem',
            borderRadius: '24px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--glass-border)',
          }}
        >
          {/* Coluna Esquerda: Abas de Ramos (Pills) + Select do Jovem */}
          <div style={{ flex: 1, minWidth: '320px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Pills dos Ramos + Checkbox Matriz de Equivalência */}
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {RAMOS.map(({ label, value }) => {
                const isSelected = ramoAtual === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleRamoChange(value)}
                    style={{
                      fontSize: '0.88rem',
                      padding: '0.55rem 1.25rem',
                      borderRadius: '9999px',
                      background: isSelected ? 'var(--primary)' : 'rgba(255, 255, 255, 0.06)',
                      color: isSelected ? '#000' : '#cbd5e1',
                      border: isSelected ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                      fontWeight: isSelected ? 800 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: isSelected ? '0 4px 14px rgba(0, 255, 136, 0.35)' : 'none',
                    }}
                  >
                    {label}
                  </button>
                );
              })}

              {/* Checkbox / Toggle: Matriz de Equivalência */}
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.55rem 1.15rem',
                  borderRadius: '9999px',
                  background: exibirMatriz ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                  border: exibirMatriz ? '1px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: exibirMatriz ? 'var(--primary)' : '#cbd5e1',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'all 0.2s ease',
                  boxShadow: exibirMatriz ? '0 0 16px rgba(0, 255, 136, 0.2)' : 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={exibirMatriz}
                  onChange={(e) => setExibirMatriz(e.target.checked)}
                  style={{
                    width: '16px',
                    height: '16px',
                    cursor: 'pointer',
                    accentColor: 'var(--primary)',
                  }}
                />
                <span>📐 Matriz de Equivalência</span>
              </label>
            </div>

            {/* Dropdown de Jovens */}
            <div>
              <select
                className="scout-select"
                value={activeId}
                disabled={isPending || escoteiros.length === 0}
                onChange={(e) => handleJovemChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.8rem 1.25rem',
                  borderRadius: '12px',
                  background: 'rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#fff',
                  fontSize: '0.98rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  opacity: isPending ? 0.7 : 1,
                }}
              >
                {escoteiros.length === 0 ? (
                  <option value="">Nenhum jovem cadastrado nesta seção</option>
                ) : (
                  escoteiros.map((e) => (
                    <option key={e.associado.cd_associado} value={e.associado.cd_associado}>
                      {e.associado.nm_associado}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Coluna Direita: Dois Botões Empilhados de Sincronização */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: '260px' }}>
            {/* Botão 1: Sincronizar Seção */}
            <button
              type="button"
              onClick={handleSyncSection}
              disabled={syncProgress?.active}
              style={{
                background: 'var(--primary)',
                color: '#000',
                fontWeight: 800,
                fontSize: '0.95rem',
                padding: '0.75rem 1.5rem',
                borderRadius: '12px',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                cursor: syncProgress?.active ? 'not-allowed' : 'pointer',
                opacity: syncProgress?.active ? 0.7 : 1,
                boxShadow: '0 4px 14px rgba(0, 255, 136, 0.35)',
                transition: 'all 0.2s ease',
              }}
            >
              {syncProgress?.active && syncProgress.type === 'section' ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
              <span>
                {syncProgress?.active && syncProgress.type === 'section'
                  ? `Sincronizando ${ramoAtual}...`
                  : 'Sincronizar Seção'}
              </span>
            </button>

            {/* Botão 2: Sincronizar dados deste jovem */}
            <button
              type="button"
              onClick={handleSyncSingle}
              disabled={syncProgress?.active || !activeId}
              style={{
                background: 'transparent',
                color: 'var(--primary)',
                border: '1.5px solid var(--primary)',
                fontWeight: 700,
                fontSize: '0.88rem',
                padding: '0.7rem 1.4rem',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                cursor: syncProgress?.active || !activeId ? 'not-allowed' : 'pointer',
                opacity: syncProgress?.active || !activeId ? 0.6 : 1,
                transition: 'all 0.2s ease',
              }}
            >
              {syncProgress?.active && syncProgress.type === 'single' ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              <span>
                {syncProgress?.active && syncProgress.type === 'single'
                  ? 'Atualizando jovem...'
                  : 'Sincronizar dados deste jovem'}
              </span>
            </button>
          </div>
        </section>

        {/* Feedback Dinâmico de Sincronização */}
        {syncProgress && (
          <div
            style={{
              background: syncProgress.isError ? 'rgba(255, 77, 77, 0.12)' : 'rgba(0, 255, 136, 0.08)',
              border: `1px solid ${syncProgress.isError ? 'rgba(255, 77, 77, 0.35)' : 'rgba(0, 255, 136, 0.35)'}`,
              padding: '1.1rem 1.5rem',
              borderRadius: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              boxShadow: syncProgress.isError
                ? '0 4px 20px rgba(255, 77, 77, 0.15)'
                : '0 4px 20px rgba(0, 255, 136, 0.15)',
              transition: 'all 0.3s ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {syncProgress.active ? (
                  <Loader2 className="animate-spin" size={20} style={{ color: 'var(--primary)' }} />
                ) : syncProgress.isError ? (
                  <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                ) : (
                  <span style={{ fontSize: '1.2rem' }}>✅</span>
                )}
                <span
                  style={{
                    color: syncProgress.isError ? 'var(--error)' : '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.96rem',
                  }}
                >
                  {syncProgress.message}
                </span>
              </div>

              {syncProgress.active && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {syncProgress.total && syncProgress.current ? (
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>
                      {syncProgress.current} de {syncProgress.total} jovens
                    </span>
                  ) : null}
                  <span
                    style={{
                      background: 'rgba(0, 255, 136, 0.2)',
                      color: 'var(--primary)',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      minWidth: '42px',
                      textAlign: 'center',
                    }}
                  >
                    {syncProgress.percent}%
                  </span>
                </div>
              )}
            </div>

            {/* Barra de Progresso Animada */}
            {syncProgress.active && (
              <div
                style={{
                  width: '100%',
                  height: '8px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: '9999px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, syncProgress.percent))}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #00cc6a, #00ff88)',
                    borderRadius: '9999px',
                    boxShadow: '0 0 12px rgba(0, 255, 136, 0.6)',
                    transition: 'width 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* CARD 2: Visualização da Matriz de Equivalência ou da Progressão do Jovem */}
        {exibirMatriz ? (
          <section
            className="card"
            style={{
              padding: '2rem',
              borderRadius: '24px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--glass-border)',
            }}
          >
            <RegrasEquivalenciaView ramo={ramoAtual} />
          </section>
        ) : escoteiro ? (
          <section
            className="card"
            style={{
              padding: '2rem',
              borderRadius: '24px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--glass-border)',
            }}
          >
            {/* Abas de Alternância Novo vs Antigo Alinhadas à Esquerda */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-start',
                alignItems: 'center',
                gap: '0.6rem',
                marginBottom: '1.75rem',
                borderBottom: '1px solid var(--glass-border)',
                paddingBottom: '1.25rem',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={() => setViewMode('novo')}
                style={{
                  background: viewMode === 'novo' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.06)',
                  color: viewMode === 'novo' ? '#000' : '#cbd5e1',
                  border: viewMode === 'novo' ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '0.65rem 1.25rem',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  borderRadius: '10px',
                  boxShadow: viewMode === 'novo' ? '0 4px 12px rgba(0, 255, 136, 0.3)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  transition: 'all 0.2s ease',
                }}
              >
                <span>🧩</span> Programa Atualizado (18 Blocos)
              </button>

              <button
                type="button"
                onClick={() => setViewMode('antigo')}
                style={{
                  background: viewMode === 'antigo' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.06)',
                  color: viewMode === 'antigo' ? '#000' : '#cbd5e1',
                  border: viewMode === 'antigo' ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '0.65rem 1.25rem',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  borderRadius: '10px',
                  boxShadow: viewMode === 'antigo' ? '0 4px 12px rgba(0, 255, 136, 0.3)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  transition: 'all 0.2s ease',
                }}
              >
                <span>📜</span> Programa Antigo (Paxtu)
              </button>
            </div>

            {/* Renderização condicional da visão selecionada */}
            {viewMode === 'novo' ? (
              <NovoProgramaView cdAssociado={activeId} ramoAtual={ramoAtual} />
            ) : (
              <ProgressionView
                caminhos={escoteiro.progressao}
                especialidades={escoteiro.especialidades}
              />
            )}
          </section>
        ) : (
          <section className="card" style={{ textAlign: 'center', color: '#888', padding: '3rem' }}>
            Nenhum escoteiro selecionado ou encontrado nesta seção.
          </section>
        )}
      </div>
    </main>
  );
}

