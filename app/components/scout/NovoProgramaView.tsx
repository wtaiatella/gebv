'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import type {
  ProgressoCompletoJovem,
  AcaoProgressoItem,
  ResumoBlocoTransicionado,
} from '@/app/lib/services/transicao-service';
import EditarRegraModal, { RegraParaEditar } from '@/app/components/equivalencias/EditarRegraModal';
import { useAutoSaveToggle, type ItemSaveFeedback } from '@/app/lib/hooks/useAutoSaveToggle';

type Props = {
  cdAssociado: string;
  ramoAtual?: string;
};

export default function NovoProgramaView({ cdAssociado, ramoAtual = 'Escoteiro' }: Props) {
  const [data, setData] = useState<ProgressoCompletoJovem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transicionando, setTransicionando] = useState(false);

  // Controle de blocos expandidos em modo detalhado
  const [blocosExpandidos, setBlocosExpandidos] = useState<Record<number, boolean>>({});
  const [modoTabelaGeral, setModoTabelaGeral] = useState<boolean>(true);

  // Controle de acordeons independentes: Eixos e Blocos
  const [eixosAbertos, setEixosAbertos] = useState<Record<number, boolean>>({});
  const [blocosAbertos, setBlocosAbertos] = useState<Record<number, boolean>>({});

  // Modal de edição de regra de equivalência
  const [regraParaEditar, setRegraParaEditar] = useState<RegraParaEditar | null>(null);
  const [isModalEditOpen, setIsModalEditOpen] = useState(false);

  // Estado local dos checkboxes editáveis por ação { [acaoId]: boolean }
  const [localAcoesStatus, setLocalAcoesStatus] = useState<Record<number, boolean>>({});
  const [feedbackMsg, setFeedbackMsg] = useState<{ id: number | string; text: string } | null>(null);

  // Hook genérico de Auto-Save com atualização otimista, tracking e rollback
  const { toggle: autoSaveToggle, getStatus: getAcaoSaveStatus } = useAutoSaveToggle<{
    acao: any;
    bloco: any;
  }>({
    onSave: async (id, nextValue) => {
      const res = await fetch(`/api/progressoes/novo-modelo/${cdAssociado}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao_id: Number(id),
          fl_concluido: nextValue,
          ramo: ramoAtual,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao salvar ação');
      return json.data;
    },
    onSuccess: (id, payload) => {
      if (!payload?.acao || !payload?.bloco) return;
      const { acao, bloco } = payload;
      setData((prevData) => {
        if (!prevData) return prevData;
        const updatedAcoesPorBloco = { ...prevData.acoes_por_bloco };
        const blocoAcoes = updatedAcoesPorBloco[bloco.bloco_id];
        if (blocoAcoes) {
          updatedAcoesPorBloco[bloco.bloco_id] = blocoAcoes.map((a) =>
            a.id === acao.id
              ? {
                  ...a,
                  fl_concluido: acao.fl_concluido,
                  origem: acao.origem,
                  dt_conclusao: acao.dt_conclusao,
                }
              : a
          );
        }
        const updatedBlocos = prevData.blocos.map((b) =>
          b.bloco_id === bloco.bloco_id
            ? {
                ...b,
                fl_concluido: bloco.fl_concluido,
                nr_fixas_concluidas: bloco.nr_fixas_concluidas,
                nr_variaveis_concluidas: bloco.nr_variaveis_concluidas,
                pct_conclusao: bloco.pct_conclusao,
              }
            : b
        );
        const totalConcluidas = Object.values(updatedAcoesPorBloco)
          .flat()
          .filter((a) => a.fl_concluido).length;
        const blocosConcluidos = updatedBlocos.filter((b) => b.fl_concluido).length;
        const pctGlobal =
          prevData.estatisticas.total_acoes > 0
            ? Math.round((totalConcluidas / prevData.estatisticas.total_acoes) * 10000) / 100
            : 0;

        return {
          ...prevData,
          acoes_por_bloco: updatedAcoesPorBloco,
          blocos: updatedBlocos,
          estatisticas: {
            ...prevData.estatisticas,
            total_concluidas: totalConcluidas,
            blocos_concluidos: blocosConcluidos,
            pct_global: pctGlobal,
          },
        };
      });
    },
    onError: (id, err) => {
      alert(`Erro ao salvar ação: ${err.message}. O status anterior foi restaurado.`);
    },
  });

  // Carrega progressão do jovem
  useEffect(() => {
    if (cdAssociado) {
      fetchProgresso();
    }
  }, [cdAssociado, ramoAtual]);

  async function fetchProgresso(isBackground: boolean = false) {
    if (!isBackground) {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await fetch(`/api/progressoes/novo-modelo/${cdAssociado}?ramo=${ramoAtual}`);
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Erro ao carregar dados do jovem');
      }
      setData(json.data);

      // Sincroniza estado dos checkboxes locais
      const statusMap: Record<number, boolean> = {};
      for (const blocoId in json.data.acoes_por_bloco) {
        for (const acao of json.data.acoes_por_bloco[blocoId]) {
          statusMap[acao.id] = acao.fl_concluido;
        }
      }
      setLocalAcoesStatus(statusMap);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar progressão');
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
    }
  }

  // Disparar Motor de Transição PA -> Novo Programa
  async function handleCalcularTransicao() {
    setTransicionando(true);
    try {
      const res = await fetch(`/api/transicao/${cdAssociado}?ramo=${ramoAtual}`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Erro no processamento da transição');
      }

      await fetchProgresso(true);
      showFeedback('global', 'Transição recalculada com sucesso a partir dos dados do Paxtu!');
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally {
      setTransicionando(false);
    }
  }

  // Alterna expansão de detalhes de um bloco individual
  function toggleBlocoExpandido(blocoId: number) {
    setBlocosExpandidos((prev) => ({
      ...prev,
      [blocoId]: prev[blocoId] === undefined ? !modoTabelaGeral : !prev[blocoId],
    }));
  }

  // Alterna acordeon do Eixo
  function toggleEixoAberto(eixoId: number) {
    setEixosAbertos((prev) => ({
      ...prev,
      [eixoId]: prev[eixoId] === undefined ? false : !prev[eixoId],
    }));
  }

  // Alterna acordeon do Bloco
  function toggleBlocoAberto(blocoId: number) {
    setBlocosAbertos((prev) => ({
      ...prev,
      [blocoId]: prev[blocoId] === undefined ? false : !prev[blocoId],
    }));
  }

  // Toggle otimista do checkbox de uma ação específica via useAutoSaveToggle
  function handleCheckboxToggle(acaoId: number) {
    const currentVal = Boolean(localAcoesStatus[acaoId]);
    autoSaveToggle(
      acaoId,
      currentVal,
      (next) => setLocalAcoesStatus((prev) => ({ ...prev, [acaoId]: next })),
      (prev) => setLocalAcoesStatus((old) => ({ ...old, [acaoId]: prev }))
    );
  }

  // Resetar status manual via menu de contexto (botão direito)
  async function handleResetAcao(e: React.MouseEvent, acao: AcaoProgressoItem) {
    e.preventDefault();
    if (acao.origem !== 'MANUAL_CHEFE') {
      return;
    }

    const confirmReset = window.confirm(
      `Deseja realmente resetar o status manual da ação "${acao.ds_acao.slice(0, 60)}..." para a avaliação de equivalência do sistema?`
    );
    if (!confirmReset) return;

    try {
      const res = await fetch(
        `/api/progressoes/novo-modelo/${cdAssociado}/acao?acao_id=${acao.id}&ramo=${ramoAtual}`,
        { method: 'DELETE' }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao resetar status da ação');

      if (json.data?.acao && json.data?.bloco) {
        const { acao: updatedAcao, bloco: updatedBloco } = json.data;
        setLocalAcoesStatus((prev) => ({ ...prev, [updatedAcao.id]: updatedAcao.fl_concluido }));
        setData((prevData) => {
          if (!prevData) return prevData;
          const updatedAcoesPorBloco = { ...prevData.acoes_por_bloco };
          const blocoAcoes = updatedAcoesPorBloco[updatedBloco.bloco_id];
          if (blocoAcoes) {
            updatedAcoesPorBloco[updatedBloco.bloco_id] = blocoAcoes.map((a) =>
              a.id === updatedAcao.id
                ? {
                    ...a,
                    fl_concluido: updatedAcao.fl_concluido,
                    origem: updatedAcao.origem,
                    dt_conclusao: updatedAcao.dt_conclusao,
                  }
                : a
            );
          }
          const updatedBlocos = prevData.blocos.map((b) =>
            b.bloco_id === updatedBloco.bloco_id
              ? {
                  ...b,
                  fl_concluido: updatedBloco.fl_concluido,
                  nr_fixas_concluidas: updatedBloco.nr_fixas_concluidas,
                  nr_variaveis_concluidas: updatedBloco.nr_variaveis_concluidas,
                  pct_conclusao: updatedBloco.pct_conclusao,
                }
              : b
          );
          const totalConcluidas = Object.values(updatedAcoesPorBloco)
            .flat()
            .filter((a) => a.fl_concluido).length;
          const blocosConcluidos = updatedBlocos.filter((b) => b.fl_concluido).length;
          const pctGlobal =
            prevData.estatisticas.total_acoes > 0
              ? Math.round((totalConcluidas / prevData.estatisticas.total_acoes) * 10000) / 100
              : 0;

          return {
            ...prevData,
            acoes_por_bloco: updatedAcoesPorBloco,
            blocos: updatedBlocos,
            estatisticas: {
              ...prevData.estatisticas,
              total_concluidas: totalConcluidas,
              blocos_concluidos: blocosConcluidos,
              pct_global: pctGlobal,
            },
          };
        });
      } else {
        await fetchProgresso(true);
      }
      showFeedback(acao.id, 'Status manual resetado!');
    } catch (err: any) {
      alert(`Erro ao resetar ação: ${err.message}`);
    }
  }

  // Feedback temporário
  function showFeedback(id: number | string, text: string) {
    setFeedbackMsg({ id, text });
    setTimeout(() => {
      setFeedbackMsg(null);
    }, 2800);
  }

  // Abrir modal de edição de regra para uma ação
  function handleOpenEditRegra(acao: AcaoProgressoItem, nmBloco?: string) {
    if (!acao.regra_id) {
      alert('Esta ação ainda não possui uma regra de equivalência associada no catálogo.');
      return;
    }
    setRegraParaEditar({
      id: acao.regra_id,
      acao_pn_id: acao.id,
      ds_acao: acao.ds_acao,
      nm_bloco: nmBloco,
      nr_ordem_acao: acao.nr_ordem,
      operacao: acao.operacao || 'PROGRESSOES',
      descricao_origem: acao.descricao_origem || '',
      origem_pistas_ueb: acao.origem_pistas_ueb || [],
      origem_rumo_ueb: acao.origem_rumo_ueb || [],
      origem_especialidades: acao.origem_especialidades || [],
      nivel_min_especialidade: acao.nivel_min_especialidade || 1,
      min_count: acao.min_count || 1,
    });
    setIsModalEditOpen(true);
  }

  // Agrupamento dos blocos por Eixo
  const blocosPorEixo = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, { nm_eixo: string; blocos: ResumoBlocoTransicionado[] }>();
    for (const eixo of data.eixos) {
      map.set(eixo.id, { nm_eixo: eixo.nm_eixo, blocos: [] });
    }
    for (const b of data.blocos) {
      if (!map.has(b.eixo_id)) {
        map.set(b.eixo_id, { nm_eixo: b.nm_eixo, blocos: [] });
      }
      map.get(b.eixo_id)!.blocos.push(b);
    }
    return Array.from(map.entries()).map(([eixoId, val]) => ({
      eixoId,
      nm_eixo: val.nm_eixo,
      blocos: val.blocos,
    }));
  }, [data]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem' }}>
        <div className="status-dot active" style={{ margin: '0 auto 1rem', width: '16px', height: '16px' }} />
        <p style={{ color: '#aaa' }}>Carregando 18 Blocos de Progressão...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--error)' }}>
        <p>{error || 'Não foi possível carregar o novo modelo.'}</p>
        <button onClick={() => fetchProgresso()} style={{ margin: '1rem auto 0' }}>
          Tentar Novamente
        </button>
      </div>
    );
  }

  const { estatisticas, associado } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Barra de Progresso Geral do Jovem */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1.5rem',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--glass-border)',
          borderRadius: '16px',
          padding: '1.25rem 1.75rem',
        }}
      >
        <div>
          <div style={{ fontSize: '0.78rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            PROGRESSO GERAL: <strong>{associado.nm_associado.toUpperCase()}</strong> ({associado.nr_registro_formatado || '-'})
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--primary)' }}>
              {estatisticas.blocos_concluidos} de {estatisticas.total_blocos} Blocos Concluídos
            </span>
            <span style={{ color: '#666' }}>•</span>
            <span style={{ fontSize: '1.05rem', color: '#ededed' }}>
              {estatisticas.total_concluidas} de {estatisticas.total_acoes} Ações Conquistadas ({estatisticas.pct_global}%)
            </span>
          </div>
        </div>

        <div>
          <button
            onClick={handleCalcularTransicao}
            disabled={transicionando}
            style={{
              background: 'linear-gradient(135deg, #00ff88, #00b4d8)',
              color: '#000',
              fontWeight: 800,
              padding: '0.75rem 1.6rem',
              borderRadius: '10px',
              fontSize: '0.92rem',
              cursor: 'pointer',
              border: 'none',
              boxShadow: '0 4px 14px rgba(0, 255, 136, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              transition: 'all 0.2s ease',
            }}
          >
            <span>⚡</span>
            {transicionando ? 'Calculando Transição...' : 'Recalcular Transição do Paxtu'}
          </button>
        </div>
      </div>

      {/* Feedback Toast Global */}
      {feedbackMsg?.id === 'global' && (
        <div
          style={{
            background: 'rgba(0, 255, 136, 0.15)',
            color: 'var(--primary)',
            padding: '0.75rem 1.25rem',
            borderRadius: '10px',
            border: '1px solid rgba(0, 255, 136, 0.3)',
            fontWeight: 600,
            fontSize: '0.9rem',
          }}
        >
          {feedbackMsg.text}
        </div>
      )}

      {/* Grid de Eixos e Blocos de Progressão (Acordeons Independentes) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
        {blocosPorEixo.map(({ eixoId, nm_eixo, blocos }) => {
          const isEixoAberto = eixosAbertos[eixoId] !== false;
          const concluidosCount = blocos.filter((b) => b.fl_concluido).length;

          return (
            <div key={eixoId}>
              {/* Header do Eixo (Acordeon Independente) */}
              <div
                onClick={() => toggleEixoAberto(eixoId)}
                style={{
                  borderBottom: '2px solid rgba(0, 255, 136, 0.3)',
                  paddingBottom: '0.65rem',
                  marginBottom: isEixoAberto ? '1.75rem' : '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <ChevronDown
                    size={22}
                    style={{
                      color: 'var(--primary)',
                      transform: isEixoAberto ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 0.2s ease',
                      flexShrink: 0,
                    }}
                  />
                  <h2 style={{ fontSize: '1.5rem', color: 'var(--foreground)', margin: 0 }}>
                    Eixo: {nm_eixo}
                  </h2>
                  <span style={{ fontSize: '0.85rem', color: '#888' }}>
                    ({blocos.length} {blocos.length === 1 ? 'Bloco' : 'Blocos'})
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.85rem', color: '#aaa' }}>
                    {concluidosCount}/{blocos.length} concluídos
                  </span>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--primary)',
                      background: 'rgba(0, 255, 136, 0.12)',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(0, 255, 136, 0.25)',
                      fontWeight: 700,
                    }}
                  >
                    {isEixoAberto ? 'Recolher' : 'Expandir'}
                  </span>
                </div>
              </div>

              {/* Lista dos Blocos no Eixo */}
              {isEixoAberto && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  {blocos.map((bloco) => {
                    const isBlocoAberto = blocosAbertos[bloco.bloco_id] !== false;
                    const isExpandido = blocosExpandidos[bloco.bloco_id] ?? modoTabelaGeral;
                    const acoesDoBloco = data.acoes_por_bloco[bloco.bloco_id] || [];
                    const fixas = acoesDoBloco.filter((a) => a.tp_acao === 'Fixa');
                    
                    // US5: Filtro estrito de ações variadas e complementares PA
                    const variaveisPadrao = acoesDoBloco.filter(
                      (a) => (a.tp_acao === 'Variável' || a.tp_acao === 'Variavel') && a.modalidade !== 'PA'
                    );
                    const variaveisPA = acoesDoBloco.filter(
                      (a) => a.tp_acao === 'PA' || a.modalidade === 'PA'
                    );
                    const substitutivas = acoesDoBloco.filter(
                      (a) =>
                        a.tp_acao === 'Substitutiva' ||
                        a.tp_acao === 'Substitui Variável' ||
                        a.modalidade === 'Substitutiva'
                    );
                    const variaveis = [...variaveisPadrao, ...variaveisPA];

                    const padraoDone = variaveisPadrao.filter((v) => localAcoesStatus[v.id]).length;
                    const paDone = variaveisPA.filter((p) => localAcoesStatus[p.id]).length;
                    const subDone = substitutivas.filter((s) => localAcoesStatus[s.id]).length;

                    return (
                      <div
                        key={bloco.bloco_id}
                        className="card"
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: bloco.fl_concluido
                            ? '2px solid rgba(0, 255, 136, 0.6)'
                            : '1px solid var(--glass-border)',
                          borderRadius: '20px',
                          padding: isBlocoAberto ? '2rem' : '1.35rem 2rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: isBlocoAberto ? '1.5rem' : '1rem',
                          boxShadow: bloco.fl_concluido ? '0 0 32px rgba(0, 255, 136, 0.12)' : 'none',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {/* Cabeçalho do Bloco (Acordeon Independente) */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            flexWrap: 'wrap',
                            gap: '1.25rem',
                            borderBottom: isBlocoAberto ? '1px solid var(--glass-border)' : 'none',
                            paddingBottom: isBlocoAberto ? '1.25rem' : 0,
                          }}
                        >
                          <div
                            onClick={() => toggleBlocoAberto(bloco.bloco_id)}
                            style={{
                              flex: 1,
                              minWidth: '300px',
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                          >
                            {bloco.fl_concluido && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                                <span
                                  style={{
                                    background: 'rgba(0, 255, 136, 0.2)',
                                    color: 'var(--primary)',
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    padding: '0.25rem 0.6rem',
                                    borderRadius: '6px',
                                  }}
                                >
                                  🏆 Concluído ({bloco.pct_conclusao}%)
                                </span>
                              </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <ChevronDown
                                size={20}
                                style={{
                                  color: 'var(--primary)',
                                  transform: isBlocoAberto ? 'rotate(0deg)' : 'rotate(-90deg)',
                                  transition: 'transform 0.2s ease',
                                  flexShrink: 0,
                                }}
                              />
                              <h3 style={{ fontSize: '1.4rem', color: 'var(--foreground)', margin: 0 }}>
                                {bloco.nm_bloco}
                              </h3>
                            </div>
                            {bloco.ds_intencionalidade && (
                              <p style={{ color: '#aaa', fontSize: '0.9rem', marginTop: '0.5rem', lineHeight: 1.45, paddingLeft: '1.75rem' }}>
                                <strong style={{ color: '#ededed' }}>Intencionalidade Educativa:</strong> {bloco.ds_intencionalidade}
                              </p>
                            )}
                          </div>

                          {/* Botão de Alternância de Detalhes da Equivalência */}
                          {isBlocoAberto && (
                            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => toggleBlocoExpandido(bloco.bloco_id)}
                                style={{
                                  background: isExpandido
                                    ? 'linear-gradient(135deg, #0284c7, #0369a1)'
                                    : 'linear-gradient(135deg, #38bdf8, #0284c7)',
                                  color: '#fff',
                                  fontWeight: 700,
                                  fontSize: '0.88rem',
                                  padding: '0.55rem 1.15rem',
                                  borderRadius: '10px',
                                  boxShadow: '0 4px 12px rgba(56, 189, 248, 0.3)',
                                  whiteSpace: 'nowrap',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.4rem',
                                  border: 'none',
                                }}
                              >
                                <span>📐</span>
                                {isExpandido ? 'Ocultar Detalhes PA' : 'Ver Detalhes PA'}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Barra de Progresso do Bloco (Sempre Visível) */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#888', marginBottom: '0.4rem' }}>
                            <span>
                              Fixas Obrigatórias: <strong style={{ color: '#ededed' }}>{bloco.nr_fixas_concluidas}/{bloco.nr_acoes_fixas_obrigatorias}</strong> •
                              Variáveis Exigidas: <strong style={{ color: '#ededed' }}>{bloco.nr_variaveis_concluidas}/{bloco.nr_acoes_variaveis_exigidas}</strong>
                            </span>
                            <span style={{ fontWeight: 700, color: bloco.fl_concluido ? 'var(--primary)' : '#ededed' }}>
                              {bloco.pct_conclusao}%
                            </span>
                          </div>
                          <div className="progress-bar" style={{ height: '7px', margin: 0 }}>
                            <div className="progress-bar-fill" style={{ width: `${bloco.pct_conclusao}%` }} />
                          </div>
                        </div>

                        {/* Conteúdo Expansível do Bloco */}
                        {isBlocoAberto && (
                          <>
                            {/* Cabeçalho da Grade de 3 Colunas (1.4fr / 140px / 1.4fr) */}
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '1.4fr 140px 1.4fr',
                                gap: '1rem',
                                padding: '0.5rem 0.5rem',
                                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                color: '#888',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                              }}
                            >
                              <div>AÇÃO EDUCATIVA (PN)</div>
                              <div style={{ textAlign: 'center' }}>STATUS & SALVAMENTO</div>
                              <div>FÓRMULA DE EQUIVALÊNCIA & MATRIZ</div>
                            </div>

                            {/* SEÇÃO 1: AÇÕES EDUCATIVAS FIXAS */}
                            {fixas.length > 0 && (
                              <div
                                style={{
                                  background: 'rgba(0, 255, 136, 0.03)',
                                  border: '1px solid rgba(0, 255, 136, 0.2)',
                                  borderRadius: '14px',
                                  padding: '1.25rem 1.5rem',
                                }}
                              >
                                {/* Header da Seção Fixa */}
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: '0.75rem',
                                    borderBottom: '1px solid rgba(0, 255, 136, 0.15)',
                                    paddingBottom: '0.6rem',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: '1.2rem',
                                      fontWeight: 800,
                                      color: 'var(--primary)',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.05em',
                                    }}
                                  >
                                    Ações Educativas Fixas ({fixas.filter((f) => localAcoesStatus[f.id]).length}/{bloco.nr_acoes_fixas_obrigatorias})
                                  </div>
                                  <span style={{ fontSize: '0.78rem', color: '#888' }}>Obrigatórias</span>
                                </div>

                                {/* Linhas de Ações Fixas em 3 Colunas */}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  {fixas.map((acao, idx) => (
                                    <AcaoEquivalenciaRow
                                      key={acao.id}
                                      acao={acao}
                                      nmBloco={bloco.nm_bloco}
                                      isLast={idx === fixas.length - 1}
                                      isExpandido={isExpandido}
                                      isChecked={Boolean(localAcoesStatus[acao.id])}
                                      saveStatus={getAcaoSaveStatus(acao.id)}
                                      onToggle={() => handleCheckboxToggle(acao.id)}
                                      onContextMenu={(e) => handleResetAcao(e, acao)}
                                      onEditRegra={() => handleOpenEditRegra(acao, bloco.nm_bloco)}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* SEÇÃO 2: AÇÕES EDUCATIVAS VARIADAS (Padrão + 216 PA + Substitutivas) */}
                            {(variaveis.length > 0 || substitutivas.length > 0) && (
                              <div
                                style={{
                                  background: 'rgba(234, 179, 8, 0.03)',
                                  border: '1px dashed rgba(234, 179, 8, 0.25)',
                                  borderRadius: '14px',
                                  padding: '1.25rem 1.5rem',
                                }}
                              >
                                {/* Header da Seção Variada com Contadores Restaurados (US5) */}
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: '0.5rem',
                                    marginBottom: '0.35rem',
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      flexWrap: 'wrap',
                                      gap: '0.6rem',
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: '1.2rem',
                                        fontWeight: 800,
                                        color: '#eab308',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                      }}
                                    >
                                      Ações Educativas Variadas ({padraoDone}/{bloco.nr_acoes_variaveis_exigidas})
                                    </span>
                                    {variaveisPA.length > 0 && (
                                      <span
                                        style={{
                                          fontSize: '0.82rem',
                                          fontWeight: 700,
                                          color: '#c084fc',
                                          background: 'rgba(168, 85, 247, 0.15)',
                                          border: '1px solid rgba(168, 85, 247, 0.35)',
                                          padding: '0.15rem 0.55rem',
                                          borderRadius: '6px',
                                        }}
                                      >
                                        (PA {paDone})
                                      </span>
                                    )}
                                    {substitutivas.length > 0 && (
                                      <span
                                        style={{
                                          fontSize: '0.82rem',
                                          fontWeight: 700,
                                          color: '#fbbf24',
                                          background: 'rgba(251, 191, 36, 0.15)',
                                          border: '1px solid rgba(251, 191, 36, 0.35)',
                                          padding: '0.15rem 0.55rem',
                                          borderRadius: '6px',
                                        }}
                                      >
                                        (Substitutivas {subDone})
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div style={{ fontSize: '0.82rem', color: '#aaa', marginBottom: '0.75rem', borderBottom: '1px dashed rgba(234, 179, 8, 0.15)', paddingBottom: '0.5rem' }}>
                                  Realizar ao menos <strong style={{ color: '#fff' }}>{bloco.nr_acoes_variaveis_exigidas} ações</strong> dentre as listadas abaixo:
                                </div>

                                {/* Linhas de Ações Variadas em 3 Colunas */}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  {variaveis.map((acao, idx) => (
                                    <AcaoEquivalenciaRow
                                      key={acao.id}
                                      acao={acao}
                                      nmBloco={bloco.nm_bloco}
                                      isLast={idx === variaveis.length - 1 && substitutivas.length === 0}
                                      isExpandido={isExpandido}
                                      isChecked={Boolean(localAcoesStatus[acao.id])}
                                      saveStatus={getAcaoSaveStatus(acao.id)}
                                      onToggle={() => handleCheckboxToggle(acao.id)}
                                      onContextMenu={(e) => handleResetAcao(e, acao)}
                                      onEditRegra={() => handleOpenEditRegra(acao, bloco.nm_bloco)}
                                    />
                                  ))}
                                </div>

                                {/* Seção Destacada: Atividades Substitutivas */}
                                {substitutivas.length > 0 && (
                                  <div style={{ marginTop: '1.25rem' }}>
                                    <div
                                      style={{
                                        paddingTop: '0.9rem',
                                        borderTop: '2px dashed rgba(251, 191, 36, 0.35)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.65rem',
                                        marginBottom: '0.5rem',
                                      }}
                                    >
                                      <span
                                        style={{
                                          background: 'linear-gradient(135deg, #d97706, #b45309)',
                                          color: '#fff',
                                          fontWeight: 800,
                                          fontSize: '0.75rem',
                                          padding: '0.2rem 0.55rem',
                                          borderRadius: '6px',
                                          letterSpacing: '0.05em',
                                          textTransform: 'uppercase',
                                        }}
                                      >
                                        OU
                                      </span>
                                      <span
                                        style={{
                                          fontSize: '0.95rem',
                                          fontWeight: 700,
                                          color: '#fde68a',
                                          letterSpacing: '0.02em',
                                        }}
                                      >
                                        Conquistar as seguintes insígnias/especialidades:
                                      </span>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      {substitutivas.map((acao, idx) => (
                                        <AcaoEquivalenciaRow
                                          key={acao.id}
                                          acao={acao}
                                          nmBloco={bloco.nm_bloco}
                                          isLast={idx === substitutivas.length - 1}
                                          isExpandido={isExpandido}
                                          isChecked={Boolean(localAcoesStatus[acao.id])}
                                          saveStatus={getAcaoSaveStatus(acao.id)}
                                          onToggle={() => handleCheckboxToggle(acao.id)}
                                          onContextMenu={(e) => handleResetAcao(e, acao)}
                                          onEditRegra={() => handleOpenEditRegra(acao, bloco.nm_bloco)}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal Reutilizável de Edição de Regra de Equivalência */}
      <EditarRegraModal
        regra={regraParaEditar}
        isOpen={isModalEditOpen}
        onClose={() => setIsModalEditOpen(false)}
        onSaveSuccess={() => {
          fetchProgresso(true);
          showFeedback('global', 'Regra de equivalência atualizada! Progresso recalculado.');
        }}
        ramoAtual={ramoAtual}
      />
    </div>
  );
}

// Componente para a Linha da Ação Educativa na Grade de 3 Colunas (1.4fr / 140px / 1.4fr)
function AcaoEquivalenciaRow({
  acao,
  nmBloco,
  isLast,
  isExpandido,
  isChecked,
  saveStatus,
  onToggle,
  onContextMenu,
  onEditRegra,
}: {
  acao: AcaoProgressoItem;
  nmBloco?: string;
  isLast: boolean;
  isExpandido: boolean;
  isChecked: boolean;
  saveStatus?: ItemSaveFeedback;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEditRegra: () => void;
}) {
  const hasPaRefs = (acao.itens_origem_detalhados || []).length > 0;
  const hasEsp = (acao.origem_especialidades || []).length > 0;
  const isManual = acao.origem === 'MANUAL_CHEFE';

  return (
    <div
      style={{
        background: isManual ? 'rgba(245, 158, 11, 0.02)' : 'transparent',
        borderBottom: isLast ? 'none' : '1px solid rgba(255, 255, 255, 0.06)',
        padding: '0.85rem 0.5rem',
        borderRadius: '8px',
        transition: 'background 0.15s ease',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 140px 1.4fr',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        {/* COLUNA 1: Ação Educativa (PN) + Losango Maior + Tags PN */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
          {/* Losango maior de checked / unchecked */}
          <span
            onClick={onToggle}
            title={isChecked ? 'Concluído (Clique para alterar)' : 'Pendente (Clique para marcar)'}
            style={{
              color: isChecked ? 'var(--primary)' : 'rgba(255, 255, 255, 0.3)',
              fontSize: '1.75rem',
              lineHeight: 1,
              flexShrink: 0,
              cursor: 'pointer',
              userSelect: 'none',
              filter: isChecked ? 'drop-shadow(0 0 8px rgba(0, 255, 136, 0.6))' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            {isChecked ? '◆' : '◇'}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: isChecked ? '#fff' : '#d4d4d8', fontSize: '0.95rem', lineHeight: 1.45 }}>
              {acao.modalidade && acao.modalidade !== 'Básico' && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    color:
                      acao.modalidade === 'Ar'
                        ? '#38bdf8'
                        : acao.modalidade === 'Mar'
                        ? '#22d3ee'
                        : acao.modalidade === 'PA' || acao.tp_acao === 'PA'
                        ? '#c084fc'
                        : acao.modalidade === 'Substitutiva' || acao.tp_acao === 'Substitutiva'
                        ? '#fbbf24'
                        : '#a1a1aa',
                    background:
                      acao.modalidade === 'PA' || acao.tp_acao === 'PA'
                        ? 'rgba(168, 85, 247, 0.18)'
                        : acao.modalidade === 'Substitutiva' || acao.tp_acao === 'Substitutiva'
                        ? 'rgba(251, 191, 36, 0.18)'
                        : 'rgba(255, 255, 255, 0.08)',
                    border:
                      acao.modalidade === 'PA' || acao.tp_acao === 'PA'
                        ? '1px solid rgba(168, 85, 247, 0.4)'
                        : acao.modalidade === 'Substitutiva' || acao.tp_acao === 'Substitutiva'
                        ? '1px solid rgba(251, 191, 36, 0.4)'
                        : 'none',
                    padding: '0.15rem 0.45rem',
                    borderRadius: '4px',
                    fontWeight: 700,
                    marginRight: '0.5rem',
                    display: 'inline-block',
                  }}
                >
                  {acao.tp_acao === 'PA' ? 'PA' : acao.modalidade}
                </span>
              )}
              {acao.ds_acao}
            </div>

            {/* US4: Tags visuais destacadas para as 15 ações de Especialidades PN */}
            {acao.especialidades_pn_tags && acao.especialidades_pn_tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.45rem' }}>
                {acao.especialidades_pn_tags.map((esp) => {
                  const isConq = esp.fl_conquistada;
                  return (
                    <span
                      key={esp.nome}
                      title={
                        isConq
                          ? `Especialidade ${esp.nome}: Conquistada no Nível ${esp.nivel_conquistado} (Exigido N${esp.nivel_exigido}+)`
                          : `Especialidade ${esp.nome}: Não conquistada no Nível ${esp.nivel_exigido}+ (Nível atual: ${esp.nivel_conquistado || 0})`
                      }
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        background: isConq ? 'rgba(0, 255, 136, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                        color: isConq ? '#00ff88' : '#888',
                        border: isConq ? '1px solid rgba(0, 255, 136, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '5px',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                      }}
                    >
                      <span>{isConq ? '✓' : '•'}</span>
                      <span>{esp.nome} (N{esp.nivel_exigido}+)</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* COLUNA 2: Status & Interação (140px Centralizado) com onContextMenu para Reset Status */}
        <div
          onContextMenu={onContextMenu}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.25rem',
            width: '140px',
            margin: '0 auto',
            padding: '0.4rem 0.5rem',
            borderRadius: '8px',
            background: isManual ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
            border: isManual ? '1px dashed rgba(245, 158, 11, 0.35)' : '1px solid transparent',
            cursor: isManual ? 'context-menu' : 'default',
            userSelect: 'none',
          }}
          title={
            isManual
              ? 'Clique com o botão direito para resetar status manual'
              : undefined
          }
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={onToggle}
              style={{
                width: '18px',
                height: '18px',
                cursor: 'pointer',
                accentColor: 'var(--primary)',
              }}
            />
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: isChecked ? 'var(--primary)' : '#888',
              }}
            >
              {isChecked ? 'Concluído' : 'Pendente'}
            </span>
          </label>

          {/* Rótulo de Origem e Indicador de Auto-Save */}
          <div style={{ fontSize: '0.68rem', textAlign: 'center', minHeight: '16px' }}>
            {saveStatus?.status === 'saving' ? (
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>Salvando...</span>
            ) : saveStatus?.status === 'saved' ? (
              <span style={{ color: '#00ff88', fontWeight: 600 }}>✓ Salvo</span>
            ) : saveStatus?.status === 'error' ? (
              <span style={{ color: '#ef4444', fontWeight: 600 }}>✗ Erro</span>
            ) : isManual ? (
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>
                Manual (Chefe)
              </span>
            ) : acao.origem === 'EQUIVALENCIA_AUTOMATICA' ? (
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>Auto (Paxtu)</span>
            ) : acao.regra_id && acao.operacao !== 'SEM_EQUIVALENCIA' ? (
              <span style={{ color: '#888' }}>Auto (Paxtu)</span>
            ) : (
              <span style={{ color: '#777' }}>Manual</span>
            )}
          </div>
        </div>

        {/* COLUNA 3: Fórmula & Validação (1.4fr) + Botão Editar Regra */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '0.75rem',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.83rem', color: '#bae6fd', lineHeight: 1.35, marginBottom: '0.35rem' }}>
              {acao.operacao === 'SEM_EQUIVALENCIA' || !acao.descricao_origem ? (
                <span
                  style={{
                    display: 'inline-block',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#a1a1aa',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '5px',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                  }}
                >
                  Sem Equivalência
                </span>
              ) : (
                <span>{acao.descricao_origem}</span>
              )}
            </div>

            {/* Badges de Itens do PA */}
            {hasPaRefs && isExpandido && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {acao.itens_origem_detalhados.map((item) => {
                  const labelIdent =
                    item.identificacao ||
                    (item.tipo === 'Pista'
                      ? `PT-${item.cd_ueb}`
                      : item.tipo === 'Rumo'
                      ? `RT-${item.cd_ueb}`
                      : item.cd_ueb);
                  return (
                    <span
                      key={`${item.tipo}_${item.cd_ueb}`}
                      title={`${labelIdent}: ${item.ds_atividade} (${
                        item.fl_concluido_paxtu
                          ? 'Concluído pelo jovem no Paxtu'
                          : 'Não realizado no Paxtu'
                      })`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                        background: item.fl_concluido_paxtu
                          ? 'rgba(0, 255, 136, 0.18)'
                          : 'rgba(255, 255, 255, 0.05)',
                        color: item.fl_concluido_paxtu ? '#00ff88' : '#888',
                        border: item.fl_concluido_paxtu
                          ? '1px solid rgba(0, 255, 136, 0.4)'
                          : '1px solid rgba(255, 255, 255, 0.1)',
                        padding: '0.12rem 0.4rem',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        fontFamily: 'monospace',
                        cursor: 'help',
                      }}
                    >
                      <span>{item.fl_concluido_paxtu ? '✓' : '✗'}</span>
                      <span>{labelIdent}</span>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Tags de Especialidades PA */}
            {hasEsp && isExpandido && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: hasPaRefs ? '0.3rem' : 0 }}>
                {(acao.especialidades_origem_detalhadas && acao.especialidades_origem_detalhadas.length > 0
                  ? acao.especialidades_origem_detalhadas
                  : (acao.origem_especialidades || []).map((espNome) => ({
                      nm_especialidade: espNome,
                      nivel_exigido: acao.nivel_min_especialidade || 1,
                      fl_conquistada: false,
                      nivel_conquistado: 0,
                      dt_nivel: null,
                    }))
                ).map((esp) => {
                  const isConq = esp.fl_conquistada;
                  const nivelExigidoStr = `N${esp.nivel_exigido}+`;
                  const labelBadge = `${esp.nm_especialidade} (${nivelExigidoStr})`;
                  return (
                    <span
                      key={esp.nm_especialidade}
                      title={
                        isConq
                          ? `Especialidade ${esp.nm_especialidade}: Conquistada no Nível ${esp.nivel_conquistado} (Exigido ${nivelExigidoStr})`
                          : `Especialidade ${esp.nm_especialidade}: Não conquistada no Nível ${esp.nivel_exigido}+`
                      }
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                        background: isConq ? 'rgba(0, 255, 136, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                        color: isConq ? '#00ff88' : '#888',
                        border: isConq ? '1px solid rgba(0, 255, 136, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                        padding: '0.12rem 0.4rem',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        fontFamily: 'monospace',
                        cursor: 'help',
                      }}
                    >
                      <span>{isConq ? '✓' : '✗'}</span>
                      <span>{labelBadge}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Botão Editar Regra */}
          <button
            type="button"
            onClick={onEditRegra}
            title="Editar Regra de Equivalência (Matriz) desta ação"
            style={{
              background: 'rgba(0, 255, 136, 0.12)',
              color: 'var(--primary)',
              border: '1px solid rgba(0, 255, 136, 0.25)',
              fontSize: '0.76rem',
              fontWeight: 700,
              padding: '0.35rem 0.7rem',
              borderRadius: '6px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'all 0.15s ease',
            }}
          >
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}
