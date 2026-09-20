'use client';

import { useState, useEffect, useMemo, useTransition } from 'react';
import {
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  UserCheck,
  Award,
  Filter,
  Sparkles,
  Info,
} from 'lucide-react';

interface RegraPaAprovada {
  pa_item_id: number;
  cd_item_pa: string;
  ds_item_pa: string;
  ds_especialidade_pa: string;
  pa_concluida: boolean;
  pa_data_conclusao: string | null;
}

interface ItemPn {
  id: number;
  cd_item: string;
  nr_item: number | null;
  ds_item: string;
  concluida: boolean;
  origem: string | null;
  data_conclusao: string | null;
  regras_aprovadas: RegraPaAprovada[];
}

interface EspecialidadePn {
  id: number;
  cd_especialidade: string | null;
  ds_especialidade: string;
  slug: string;
  ramo: string | null;
  eixo: { id: number; ds_eixo: string } | null;
  meta_nivel_1: number;
  meta_nivel_2: number;
  total_itens: number;
  conquista: {
    nr_nivel: number;
    qtd_itens_concluidos: number;
    fl_concluido: boolean;
    origem: string;
    dt_conquista: string | null;
  };
  itens: ItemPn[];
}

interface Props {
  cdAssociado: string;
  ramoAtual: string;
}

export default function EspecialidadesPnView({ cdAssociado, ramoAtual }: Props) {
  const [especialidades, setEspecialidades] = useState<EspecialidadePn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filtroEixo, setFiltroEixo] = useState<string>('TODOS');
  const [filtroStatus, setFiltroStatus] = useState<'TODOS' | 'CONQUISTADAS' | 'EM_ANDAMENTO'>('TODOS');
  const [cardExpandido, setCardExpandido] = useState<Record<number, boolean>>({});

  // Auto-save feedback { [itemId]: { status: 'saving' | 'saved' | 'error', time?: string } }
  const [savingStatus, setSavingStatus] = useState<Record<number, { status: 'saving' | 'saved' | 'error'; time?: string }>>({});
  const [lastGlobalSaveTime, setLastGlobalSaveTime] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isSeniorOuPioneiro =
    ramoAtual.toLowerCase().includes('sênior') ||
    ramoAtual.toLowerCase().includes('senior') ||
    ramoAtual.toLowerCase().includes('pioneiro');

  // Carrega dados da API
  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      if (!cdAssociado) return;
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/especialidades-pn/${cdAssociado}?ramo=${encodeURIComponent(ramoAtual)}`);
        const json = await res.json();

        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Falha ao carregar especialidades do Novo Programa.');
        }

        if (!isCancelled) {
          setEspecialidades(json.data.especialidades || []);
          // Auto-expandir especialidades que já possuem algum item ou conquista
          const initialExpanded: Record<number, boolean> = {};
          for (const esp of json.data.especialidades || []) {
            if (esp.conquista.qtd_itens_concluidos > 0 || esp.conquista.nr_nivel > 0) {
              initialExpanded[esp.id] = true;
            }
          }
          setCardExpandido(initialExpanded);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(err.message || 'Erro inesperado');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isCancelled = true;
    };
  }, [cdAssociado, ramoAtual]);

  // Lista de eixos únicos para o filtro
  const eixosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const esp of especialidades) {
      if (esp.eixo?.ds_eixo) {
        set.add(esp.eixo.ds_eixo);
      }
    }
    return Array.from(set).sort();
  }, [especialidades]);

  // Filtragem combinada
  const especialidadesFiltradas = useMemo(() => {
    return especialidades.filter((esp) => {
      // Busca texto
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const bateNome = esp.ds_especialidade.toLowerCase().includes(query);
        const bateItem = esp.itens.some((it) => it.ds_item.toLowerCase().includes(query));
        if (!bateNome && !bateItem) return false;
      }

      // Filtro de Eixo
      if (filtroEixo !== 'TODOS' && esp.eixo?.ds_eixo !== filtroEixo) {
        return false;
      }

      // Filtro de Conquista
      if (filtroStatus === 'CONQUISTADAS' && esp.conquista.nr_nivel === 0) {
        return false;
      }
      if (filtroStatus === 'EM_ANDAMENTO' && (esp.conquista.qtd_itens_concluidos === 0 || esp.conquista.nr_nivel === 2)) {
        return false;
      }

      return true;
    });
  }, [especialidades, searchQuery, filtroEixo, filtroStatus]);

  // Estatísticas Rápidas
  const stats = useMemo(() => {
    let totalNivel2 = 0;
    let totalNivel1 = 0;
    let totalItensCumpridos = 0;

    for (const esp of especialidades) {
      if (esp.conquista.nr_nivel === 2) totalNivel2++;
      else if (esp.conquista.nr_nivel === 1) totalNivel1++;
      totalItensCumpridos += esp.conquista.qtd_itens_concluidos;
    }

    return { totalNivel2, totalNivel1, totalItensCumpridos, totalEspecialidades: especialidades.length };
  }, [especialidades]);

  // Handler de Auto-Save Online (FR-26, AC-7)
  async function handleToggleItem(espId: number, itemId: number, atualConcluida: boolean) {
    const novoValor = !atualConcluida;

    // 1. Atualização Otimista
    setEspecialidades((prev) =>
      prev.map((esp) => {
        if (esp.id !== espId) return esp;

        const novosItens = esp.itens.map((it) => {
          if (it.id !== itemId) return it;
          return {
            ...it,
            concluida: novoValor,
            origem: 'MANUAL_CHEFE',
          };
        });

        const novoQtd = novosItens.filter((i) => i.concluida).length;
        let novoNivel = 0;
        let flConcluido = false;
        if (novoQtd >= esp.meta_nivel_2) {
          novoNivel = 2;
          flConcluido = true;
        } else if (novoQtd >= esp.meta_nivel_1) {
          novoNivel = 1;
        }

        return {
          ...esp,
          itens: novosItens,
          conquista: {
            ...esp.conquista,
            qtd_itens_concluidos: novoQtd,
            nr_nivel: novoNivel,
            fl_concluido: flConcluido,
            origem: 'MANUAL_CHEFE',
          },
        };
      })
    );

    setSavingStatus((prev) => ({
      ...prev,
      [itemId]: { status: 'saving' },
    }));

    try {
      const res = await fetch('/api/especialidades-pn/item-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cd_associado: cdAssociado,
          especialidade_id: espId,
          especialidade_item_id: itemId,
          concluida: novoValor,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Erro ao persistir status do item.');
      }

      const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      setSavingStatus((prev) => ({
        ...prev,
        [itemId]: { status: 'saved', time: nowStr },
      }));
      setLastGlobalSaveTime(`Salvo às ${nowStr}`);

      // Atualiza com os valores oficiais retornados pelo servidor
      if (json.especialidade) {
        setEspecialidades((prev) =>
          prev.map((esp) => {
            if (esp.id !== espId) return esp;
            return {
              ...esp,
              conquista: {
                ...esp.conquista,
                nr_nivel: json.especialidade.nr_nivel,
                qtd_itens_concluidos: json.especialidade.qtd_itens_concluidos,
                fl_concluido: json.especialidade.fl_concluido,
              },
            };
          })
        );
      }
    } catch (err: any) {
      console.error('[Auto-Save Especialidade Item Error]:', err);
      // Rollback visual em caso de erro
      setEspecialidades((prev) =>
        prev.map((esp) => {
          if (esp.id !== espId) return esp;
          const itensRevertidos = esp.itens.map((it) => {
            if (it.id !== itemId) return it;
            return {
              ...it,
              concluida: atualConcluida,
            };
          });
          const qtdRevertida = itensRevertidos.filter((i) => i.concluida).length;
          let nivelRevertido = 0;
          if (qtdRevertida >= esp.meta_nivel_2) nivelRevertido = 2;
          else if (qtdRevertida >= esp.meta_nivel_1) nivelRevertido = 1;

          return {
            ...esp,
            itens: itensRevertidos,
            conquista: {
              ...esp.conquista,
              qtd_itens_concluidos: qtdRevertida,
              nr_nivel: nivelRevertido,
            },
          };
        })
      );

      setSavingStatus((prev) => ({
        ...prev,
        [itemId]: { status: 'error' },
      }));
      alert(`Falha no salvamento: ${err.message}. A alteração foi revertida.`);
    }
  }

  function toggleCard(id: number) {
    setCardExpandido((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  if (loading) {
    return (
      <div style={{ padding: '3.5rem', textAlign: 'center', color: '#94a3b8' }}>
        <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 1rem', color: 'var(--primary)' }} />
        <p style={{ fontWeight: 600 }}>Carregando catálogo de especialidades do Novo Programa...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: '2rem',
          borderRadius: '16px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#f87171',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <AlertCircle size={28} />
        <div>
          <h4 style={{ margin: 0, fontWeight: 700 }}>Erro ao carregar especialidades</h4>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Banner Informativo para Sênior e Pioneiro (US-7) */}
      {isSeniorOuPioneiro && (
        <div
          style={{
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '16px',
            padding: '1.25rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            color: '#93c5fd',
          }}
        >
          <Info size={24} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
              Ramo {ramoAtual}: Especialidades com Dinâmica Formativa Própria
            </div>
            <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
              No Novo Programa da UEB, os ramos Sênior e Pioneiro não utilizam matriz de equivalência automática a partir do PA. As especialidades abaixo são registradas diretamente conforme as conquistas formativas da etapa.
            </div>
          </div>
        </div>
      )}

      {/* Barra de Resumo e Métricas */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
        }}
      >
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--glass-border)',
            borderRadius: '16px',
            padding: '1rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
          }}
        >
          <Award size={28} style={{ color: '#eab308' }} />
          <div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
              Nível 2 (Concluídas)
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#facc15' }}>
              {stats.totalNivel2}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--glass-border)',
            borderRadius: '16px',
            padding: '1rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
          }}
        >
          <Sparkles size={28} style={{ color: '#38bdf8' }} />
          <div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
              Nível 1 (Intermediário)
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#38bdf8' }}>
              {stats.totalNivel1}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--glass-border)',
            borderRadius: '16px',
            padding: '1rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
          }}
        >
          <ShieldCheck size={28} style={{ color: 'var(--primary)' }} />
          <div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
              Requisitos Cumpridos
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary)' }}>
              {stats.totalItensCumpridos}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--glass-border)',
            borderRadius: '16px',
            padding: '1rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
          }}
        >
          <Clock size={28} style={{ color: '#a78bfa' }} />
          <div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
              Status do Auto-Save
            </div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#e2e8f0', marginTop: '0.25rem' }}>
              {lastGlobalSaveTime || 'Pronto para edição'}
            </div>
          </div>
        </div>
      </div>

      {/* Controles de Busca e Filtros */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--glass-border)',
          padding: '1rem 1.25rem',
          borderRadius: '16px',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem', flex: 1, minWidth: '280px', flexWrap: 'wrap' }}>
          {/* Campo de Busca */}
          <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
            <Search
              size={18}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#64748b',
              }}
            />
            <input
              type="text"
              placeholder="Buscar especialidade ou requisito PN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.65rem 1rem 0.65rem 2.4rem',
                borderRadius: '10px',
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#fff',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
          </div>

          {/* Filtro por Eixo Formativo */}
          <select
            value={filtroEixo}
            onChange={(e) => setFiltroEixo(e.target.value)}
            style={{
              padding: '0.65rem 1rem',
              borderRadius: '10px',
              background: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#fff',
              fontSize: '0.88rem',
              cursor: 'pointer',
            }}
          >
            <option value="TODOS">Todos os Eixos ({eixosDisponiveis.length})</option>
            {eixosDisponiveis.map((eixo) => (
              <option key={eixo} value={eixo}>
                {eixo}
              </option>
            ))}
          </select>

          {/* Filtro por Status */}
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as any)}
            style={{
              padding: '0.65rem 1rem',
              borderRadius: '10px',
              background: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#fff',
              fontSize: '0.88rem',
              cursor: 'pointer',
            }}
          >
            <option value="TODOS">Todas as Situações</option>
            <option value="CONQUISTADAS">Conquistadas (Nível 1 ou 2)</option>
            <option value="EM_ANDAMENTO">Em Andamento (&gt; 0 itens)</option>
          </select>
        </div>

        <div style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600 }}>
          Exibindo {especialidadesFiltradas.length} de {especialidades.length} especialidades
        </div>
      </div>

      {/* Lista de Cards de Especialidades PN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {especialidadesFiltradas.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '3rem',
              color: '#64748b',
              background: 'rgba(255, 255, 255, 0.01)',
              borderRadius: '16px',
              border: '1px dashed rgba(255, 255, 255, 0.08)',
            }}
          >
            Nenhuma especialidade encontrada com os filtros selecionados.
          </div>
        ) : (
          especialidadesFiltradas.map((esp) => {
            const isExpanded = cardExpandido[esp.id] ?? false;
            const nivel = esp.conquista.nr_nivel;
            const itensConcluidos = esp.conquista.qtd_itens_concluidos;
            const meta1 = esp.meta_nivel_1;
            const meta2 = esp.meta_nivel_2;

            // Cores do Badge de Nível
            let badgeBg = 'rgba(255, 255, 255, 0.06)';
            let badgeColor = '#94a3b8';
            let badgeText = 'Sem Nível';
            if (nivel === 2) {
              badgeBg = 'rgba(234, 179, 8, 0.18)';
              badgeColor = '#facc15';
              badgeText = '★ Nível 2 Concluído';
            } else if (nivel === 1) {
              badgeBg = 'rgba(56, 189, 248, 0.18)';
              badgeColor = '#38bdf8';
              badgeText = '◆ Nível 1 Alcançado';
            } else if (itensConcluidos > 0) {
              badgeBg = 'rgba(0, 255, 136, 0.12)';
              badgeColor = 'var(--primary)';
              badgeText = 'Em Progresso';
            }

            return (
              <div
                key={esp.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: `1px solid ${nivel > 0 ? 'rgba(0, 255, 136, 0.25)' : 'var(--glass-border)'}`,
                  borderRadius: '18px',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s ease',
                }}
              >
                {/* Header do Card (Click to Expand) */}
                <div
                  onClick={() => toggleCard(esp.id)}
                  style={{
                    padding: '1.25rem 1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                    background: isExpanded ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
                    borderBottom: isExpanded ? '1px solid var(--glass-border)' : 'none',
                    gap: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: '240px' }}>
                    <button
                      type="button"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        padding: 0,
                      }}
                    >
                      {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </button>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff' }}>
                          {esp.ds_especialidade}
                        </span>

                        {esp.eixo && (
                          <span
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              padding: '0.2rem 0.6rem',
                              borderRadius: '9999px',
                              background: 'rgba(168, 85, 247, 0.15)',
                              color: '#c084fc',
                              border: '1px solid rgba(168, 85, 247, 0.3)',
                            }}
                          >
                            {esp.eixo.ds_eixo}
                          </span>
                        )}

                        {esp.conquista.origem === 'MANUAL_CHEFE' && (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '0.15rem 0.5rem',
                              borderRadius: '6px',
                              background: 'rgba(249, 115, 22, 0.15)',
                              color: '#fb923c',
                              border: '1px solid rgba(249, 115, 22, 0.3)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                            }}
                          >
                            <UserCheck size={12} /> Marcado pelo Chefe
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '0.3rem' }}>
                        Metas curriculares: Nível 1 = {meta1} itens | Nível 2 = {meta2} itens (Total da Especialidade: {esp.total_itens})
                      </div>
                    </div>
                  </div>

                  {/* Badges de Conquista e Progresso */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        background: 'rgba(0, 0, 0, 0.4)',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '10px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Itens:</span>
                      <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--primary)' }}>
                        {itensConcluidos} / {esp.total_itens}
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: '0.85rem',
                        fontWeight: 800,
                        padding: '0.4rem 0.9rem',
                        borderRadius: '10px',
                        background: badgeBg,
                        color: badgeColor,
                        border: `1px solid ${badgeColor}40`,
                      }}
                    >
                      {badgeText}
                    </span>
                  </div>
                </div>

                {/* Conteúdo Expandido com Layout Invertido (FR-25) */}
                {isExpanded && (
                  <div style={{ padding: '1.25rem 1.5rem', background: 'rgba(0, 0, 0, 0.2)' }}>
                    {/* Cabeçalho das Colunas do Layout Invertido */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(280px, 1.4fr) 140px minmax(280px, 1.4fr)',
                        gap: '1.25rem',
                        padding: '0.6rem 1rem',
                        background: 'rgba(255, 255, 255, 0.04)',
                        borderRadius: '10px',
                        marginBottom: '0.75rem',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        color: '#94a3b8',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <div>Requisito do Novo Programa (PN)</div>
                      <div style={{ textAlign: 'center' }}>Conquista</div>
                      <div>Itens Equivalentes no PA (Aprovados na Matriz)</div>
                    </div>

                    {/* Linhas de Itens */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {esp.itens.map((item, idx) => {
                        const statusSave = savingStatus[item.id];
                        const isItemSaving = statusSave?.status === 'saving';

                        return (
                          <div
                            key={item.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(280px, 1.4fr) 140px minmax(280px, 1.4fr)',
                              gap: '1.25rem',
                              alignItems: 'center',
                              padding: '0.85rem 1rem',
                              borderRadius: '12px',
                              background: item.concluida ? 'rgba(0, 255, 136, 0.04)' : 'rgba(255, 255, 255, 0.015)',
                              border: item.concluida ? '1px solid rgba(0, 255, 136, 0.2)' : '1px solid rgba(255, 255, 255, 0.05)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {/* Coluna 1 (Esquerda): Requisito PN */}
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                              <span
                                style={{
                                  fontSize: '0.78rem',
                                  fontWeight: 800,
                                  background: 'rgba(255, 255, 255, 0.08)',
                                  color: '#e2e8f0',
                                  padding: '0.2rem 0.5rem',
                                  borderRadius: '6px',
                                  marginTop: '0.1rem',
                                  flexShrink: 0,
                                }}
                              >
                                #{item.nr_item ?? idx + 1}
                              </span>
                              <div style={{ fontSize: '0.9rem', color: '#f1f5f9', lineHeight: 1.45 }}>
                                {item.ds_item}
                              </div>
                            </div>

                            {/* Coluna 2 (Centro): Checkbox e Auto-Save Online (FR-26) */}
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.35rem',
                              }}
                            >
                              <label
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '8px',
                                  background: item.concluida ? 'var(--primary)' : 'rgba(255, 255, 255, 0.08)',
                                  border: item.concluida ? 'none' : '2px solid rgba(255, 255, 255, 0.25)',
                                  cursor: isItemSaving ? 'wait' : 'pointer',
                                  transition: 'all 0.2s ease',
                                  boxShadow: item.concluida ? '0 0 12px rgba(0, 255, 136, 0.35)' : 'none',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={item.concluida}
                                  disabled={isItemSaving}
                                  onChange={() => handleToggleItem(esp.id, item.id, item.concluida)}
                                  style={{ display: 'none' }}
                                />
                                {isItemSaving ? (
                                  <Loader2 size={16} className="animate-spin" style={{ color: item.concluida ? '#000' : 'var(--primary)' }} />
                                ) : item.concluida ? (
                                  <CheckCircle2 size={20} style={{ color: '#000' }} />
                                ) : null}
                              </label>

                              {/* Indicador de Origem */}
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                  color: item.origem === 'MANUAL_CHEFE' ? '#fb923c' : item.concluida ? '#4ade80' : '#64748b',
                                  textAlign: 'center',
                                }}
                              >
                                {item.origem === 'MANUAL_CHEFE'
                                  ? 'Manual'
                                  : item.concluida
                                  ? 'Equivalente'
                                  : 'Pendente'}
                              </span>

                              {statusSave?.time && (
                                <span style={{ fontSize: '0.62rem', color: '#94a3b8' }}>
                                  {statusSave.time}
                                </span>
                              )}
                            </div>

                            {/* Coluna 3 (Direita): Requisitos PA Equivalentes Aprovados na Matriz */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                              {item.regras_aprovadas.length === 0 ? (
                                <span style={{ fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic' }}>
                                  Nenhum item PA vinculado na matriz (validação manual pelo chefe).
                                </span>
                              ) : (
                                item.regras_aprovadas.map((regra) => (
                                  <div
                                    key={regra.pa_item_id}
                                    style={{
                                      background: regra.pa_concluida ? 'rgba(0, 255, 136, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                                      border: `1px solid ${regra.pa_concluida ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
                                      borderRadius: '8px',
                                      padding: '0.55rem 0.75rem',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '0.2rem',
                                    }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                      <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#e2e8f0' }}>
                                        PA: {regra.ds_especialidade_pa} (Item {regra.cd_item_pa})
                                      </span>
                                      <span
                                        style={{
                                          fontSize: '0.68rem',
                                          fontWeight: 800,
                                          padding: '0.15rem 0.45rem',
                                          borderRadius: '6px',
                                          background: regra.pa_concluida ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                          color: regra.pa_concluida ? 'var(--primary)' : '#94a3b8',
                                        }}
                                      >
                                        {regra.pa_concluida ? '✓ Cumprido no PA' : 'Pendente no PA'}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.35 }}>
                                      {regra.ds_item_pa}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
