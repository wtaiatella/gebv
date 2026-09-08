'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import type {
  ProgressoCompletoJovem,
  AcaoProgressoItem,
  ResumoBlocoTransicionado,
} from '@/app/lib/services/transicao-service';
import EditarRegraModal, { RegraParaEditar } from '@/app/components/equivalencias/EditarRegraModal';

type Props = {
  cdAssociado: string;
  ramoAtual?: string;
};

export default function NovoProgramaView({ cdAssociado, ramoAtual = 'Escoteiro' }: Props) {
  const [data, setData] = useState<ProgressoCompletoJovem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transicionando, setTransicionando] = useState(false);

  // Controle de blocos expandidos em modo "Tabela de Validação de Equivalências In-line"
  const [blocosExpandidos, setBlocosExpandidos] = useState<Record<number, boolean>>({});
  const [modoTabelaGeral, setModoTabelaGeral] = useState<boolean>(false);

  // Controle de acordeons independentes: Eixos e Blocos
  const [eixosAbertos, setEixosAbertos] = useState<Record<number, boolean>>({});
  const [blocosAbertos, setBlocosAbertos] = useState<Record<number, boolean>>({});

  // Modal de edição de regra de equivalência
  const [regraParaEditar, setRegraParaEditar] = useState<RegraParaEditar | null>(null);
  const [isModalEditOpen, setIsModalEditOpen] = useState(false);

  // Estado local dos checkboxes editáveis por ação { [acaoId]: boolean }
  const [localAcoesStatus, setLocalAcoesStatus] = useState<Record<number, boolean>>({});
  const [savingAcaoId, setSavingAcaoId] = useState<number | null>(null);
  const [savingBlocoId, setSavingBlocoId] = useState<number | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ id: number | string; text: string } | null>(null);

  // Carrega progressão do jovem
  useEffect(() => {
    if (cdAssociado) {
      fetchProgresso();
    }
  }, [cdAssociado, ramoAtual]);

  async function fetchProgresso() {
    setLoading(true);
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
      setLoading(false);
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

      await fetchProgresso();
      showFeedback('global', 'Transição recalculada com sucesso a partir dos dados do Paxtu!');
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally {
      setTransicionando(false);
    }
  }

  // Alterna expansão de um bloco individual
  function toggleBlocoExpandido(blocoId: number) {
    setBlocosExpandidos((prev) => ({
      ...prev,
      [blocoId]: !prev[blocoId],
    }));
  }

  // Alterna todos os blocos entre modo expandido e compacto
  function toggleModoGeral() {
    const novoModo = !modoTabelaGeral;
    setModoTabelaGeral(novoModo);
    if (data) {
      const map: Record<number, boolean> = {};
      for (const b of data.blocos) {
        map[b.bloco_id] = novoModo;
      }
      setBlocosExpandidos(map);
    }
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

  // Toggle do checkbox de uma ação específica
  function handleCheckboxToggle(acaoId: number) {
    setLocalAcoesStatus((prev) => ({
      ...prev,
      [acaoId]: !prev[acaoId],
    }));
  }

  // Feedback temporário
  function showFeedback(id: number | string, text: string) {
    setFeedbackMsg({ id, text });
    setTimeout(() => {
      setFeedbackMsg(null);
    }, 2800);
  }

  // Salvar uma ação individual (Botão "SAVE" da linha)
  async function handleSaveAcao(acaoId: number, blocoId: number) {
    setSavingAcaoId(acaoId);
    try {
      const isConcluido = Boolean(localAcoesStatus[acaoId]);
      const res = await fetch(`/api/progressoes/novo-modelo/${cdAssociado}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao_id: acaoId,
          fl_concluido: isConcluido,
          ramo: ramoAtual,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao salvar ação');

      showFeedback(acaoId, '✓ Salvo!');
      await fetchProgresso();
    } catch (err: any) {
      alert(`Erro ao salvar: ${err.message}`);
    } finally {
      setSavingAcaoId(null);
    }
  }

  // Salvar todas as ações do bloco (Botão "SAVE All" do bloco)
  async function handleSaveAllBloco(bloco: ResumoBlocoTransicionado) {
    if (!data) return;

    setSavingBlocoId(bloco.bloco_id);
    try {
      const acoesDoBloco = data.acoes_por_bloco[bloco.bloco_id] || [];
      const acoesStatusList = acoesDoBloco.map((a) => ({
        acao_id: a.id,
        fl_concluido: Boolean(localAcoesStatus[a.id]),
      }));

      const res = await fetch(`/api/progressoes/novo-modelo/${cdAssociado}/bloco-save-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bloco_id: bloco.bloco_id,
          acoes_status: acoesStatusList,
          ramo: ramoAtual,
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao salvar ações do bloco');

      showFeedback(`bloco_${bloco.bloco_id}`, '✓ Bloco atualizado com sucesso!');
      await fetchProgresso();
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally {
      setSavingBlocoId(null);
    }
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
      operacao: acao.operacao || 'DIRETA',
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
        <button onClick={fetchProgresso} style={{ margin: '1rem auto 0' }}>
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
                    const variaveis = acoesDoBloco.filter((a) => a.tp_acao !== 'Fixa');
                    const isSavingThisBloco = savingBlocoId === bloco.bloco_id;
                    const blocoFeedback = feedbackMsg?.id === `bloco_${bloco.bloco_id}` ? feedbackMsg.text : null;

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

                          {/* Botão de Alternância de Equivalência (Excalidraw) */}
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
                                  padding: '0.6rem 1.25rem',
                                  borderRadius: '10px',
                                  boxShadow: '0 4px 12px rgba(56, 189, 248, 0.3)',
                                  whiteSpace: 'nowrap',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.4rem',
                                }}
                              >
                                <span>📐</span>
                                {isExpandido ? 'Ocultar Equivalências' : 'Ver Equivalências'}
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
                            {/* Feedback do Bloco */}
                            {blocoFeedback && (
                              <div
                                style={{
                                  background: 'rgba(0, 255, 136, 0.12)',
                                  color: 'var(--primary)',
                                  padding: '0.6rem 1rem',
                                  borderRadius: '8px',
                                  border: '1px solid rgba(0, 255, 136, 0.25)',
                                  fontSize: '0.85rem',
                                  fontWeight: 600,
                                }}
                              >
                                {blocoFeedback}
                              </div>
                            )}

                            {/* SEÇÃO 1: AÇÕES EDUCATIVAS FIXAS (Design Limpo e Transparente) */}
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
                                      fontSize: '1.3rem',
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

                                {/* Linhas Transparentes de Ações Fixas */}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  {fixas.map((acao, idx) => (
                                    <AcaoEquivalenciaRow
                                      key={acao.id}
                                      acao={acao}
                                      nmBloco={bloco.nm_bloco}
                                      isLast={idx === fixas.length - 1}
                                      isExpandido={isExpandido}
                                      isChecked={Boolean(localAcoesStatus[acao.id])}
                                      isSaving={savingAcaoId === acao.id}
                                      feedback={feedbackMsg?.id === acao.id ? feedbackMsg.text : null}
                                      onToggle={() => handleCheckboxToggle(acao.id)}
                                      onSave={() => handleSaveAcao(acao.id, bloco.bloco_id)}
                                      onEditRegra={() => handleOpenEditRegra(acao, bloco.nm_bloco)}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* SEÇÃO 2: AÇÕES EDUCATIVAS VARIADAS (Design Limpo e Transparente) */}
                            {variaveis.length > 0 && (
                              <div
                                style={{
                                  background: 'rgba(234, 179, 8, 0.03)',
                                  border: '1px dashed rgba(234, 179, 8, 0.25)',
                                  borderRadius: '14px',
                                  padding: '1.25rem 1.5rem',
                                }}
                              >
                                {/* Header da Seção Variada */}
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: '0.35rem',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: '1.3rem',
                                      fontWeight: 800,
                                      color: '#eab308',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.05em',
                                    }}
                                  >
                                    Ações Educativas Variadas ({variaveis.filter((v) => localAcoesStatus[v.id]).length}/{bloco.nr_acoes_variaveis_exigidas})
                                  </div>
                                </div>

                                <div style={{ fontSize: '0.82rem', color: '#aaa', marginBottom: '0.75rem', borderBottom: '1px dashed rgba(234, 179, 8, 0.15)', paddingBottom: '0.5rem' }}>
                                  Realizar ao menos <strong style={{ color: '#fff' }}>{bloco.nr_acoes_variaveis_exigidas} ações</strong> dentre as listadas abaixo:
                                </div>

                                {/* Linhas Transparentes de Ações Variadas */}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  {variaveis.map((acao, idx) => (
                                    <AcaoEquivalenciaRow
                                      key={acao.id}
                                      acao={acao}
                                      nmBloco={bloco.nm_bloco}
                                      isLast={idx === variaveis.length - 1}
                                      isExpandido={isExpandido}
                                      isChecked={Boolean(localAcoesStatus[acao.id])}
                                      isSaving={savingAcaoId === acao.id}
                                      feedback={feedbackMsg?.id === acao.id ? feedbackMsg.text : null}
                                      onToggle={() => handleCheckboxToggle(acao.id)}
                                      onSave={() => handleSaveAcao(acao.id, bloco.bloco_id)}
                                      onEditRegra={() => handleOpenEditRegra(acao, bloco.nm_bloco)}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* RODAPÉ DO BLOCO: BOTÃO ATUALIZAR BLOCO */}
                            {isExpandido && (
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: '1.25rem',
                                  background: 'rgba(0, 0, 0, 0.3)',
                                  border: '1px solid var(--glass-border)',
                                  borderRadius: '12px',
                                  padding: '0.85rem 1.25rem',
                                  marginTop: '0.25rem',
                                }}
                              >
                                <div style={{ fontSize: '0.85rem', color: '#aaa', flex: 1, minWidth: 0 }}>
                                  💡 Ao finalizar as alterações deste bloco, clique em <strong style={{ color: 'var(--primary)' }}>Atualizar Bloco</strong> para gravar todas as ações juntas e atualizar a porcentagem de conclusão.
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleSaveAllBloco(bloco)}
                                  disabled={isSavingThisBloco}
                                  style={{
                                    background: 'linear-gradient(135deg, #00ff88, #10b981)',
                                    color: '#000',
                                    fontWeight: 800,
                                    fontSize: '0.92rem',
                                    padding: '0.65rem 1.5rem',
                                    borderRadius: '10px',
                                    cursor: isSavingThisBloco ? 'not-allowed' : 'pointer',
                                    boxShadow: '0 4px 14px rgba(0, 255, 136, 0.3)',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                  }}
                                >
                                  {isSavingThisBloco ? 'Atualizando Bloco...' : 'Atualizar Bloco'}
                                </button>
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
          fetchProgresso();
          showFeedback('global', 'Regra de equivalência atualizada! Progresso recalculado.');
        }}
        ramoAtual={ramoAtual}
      />
    </div>
  );
}

// Componente para a Linha da Ação Educativa (Design Limpo, Fundo Transparente, Losango Maior e Botão de Edição)
function AcaoEquivalenciaRow({
  acao,
  nmBloco,
  isLast,
  isExpandido,
  isChecked,
  isSaving,
  feedback,
  onToggle,
  onSave,
  onEditRegra,
}: {
  acao: AcaoProgressoItem;
  nmBloco?: string;
  isLast: boolean;
  isExpandido: boolean;
  isChecked: boolean;
  isSaving: boolean;
  feedback: string | null;
  onToggle: () => void;
  onSave: () => void;
  onEditRegra: () => void;
}) {
  const hasPaRefs = (acao.itens_origem_detalhados || []).length > 0;
  const hasEsp = (acao.origem_especialidades || []).length > 0;

  return (
    <div
      style={{
        background: 'transparent',
        borderBottom: isLast ? 'none' : '1px solid rgba(255, 255, 255, 0.06)',
        padding: '0.85rem 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}
    >
      {/* LINHA PRINCIPAL: Ação + Losango Maior + Validação + Ações de Salvar/Editar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isExpandido ? '1fr minmax(260px, 1.2fr) auto auto' : '1fr auto auto',
          alignItems: 'center',
          gap: '1.25rem',
        }}
      >
        {/* COLUNA 1: Ação Educativa com Losango Maior Interativo */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
          {/* Losango maior de checked / unchecked */}
          <span
            onClick={onToggle}
            title={isChecked ? 'Concluído (Clique para alterar)' : 'Pendente (Clique para marcar)'}
            style={{
              color: isChecked ? 'var(--primary)' : 'rgba(255, 255, 255, 0.3)',
              fontSize: '1.85rem', // Losango maior bem visível
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

          <div style={{ flex: 1 }}>
            <div style={{ color: isChecked ? '#fff' : '#d4d4d8', fontSize: '0.95rem', lineHeight: 1.45 }}>
              {acao.modalidade && acao.modalidade !== 'Básico' && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    color: acao.modalidade === 'Ar' ? '#38bdf8' : '#22d3ee',
                    background: 'rgba(255, 255, 255, 0.08)',
                    padding: '0.15rem 0.45rem',
                    borderRadius: '4px',
                    fontWeight: 700,
                    marginRight: '0.5rem',
                    display: 'inline-block',
                  }}
                >
                  {acao.modalidade}
                </span>
              )}
              {acao.ds_acao}
            </div>
          </div>
        </div>

        {/* COLUNA 2 (Modo Expandido): Fórmula & Itens de Origem com Badges Vivos (Totalmente Transparente) */}
        {isExpandido && (
          <div
            style={{
              background: 'transparent',
              border: 'none',
              padding: '0.25rem 0',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' }}>
              Fórmula de Equivalência
            </div>
            <div style={{ fontSize: '0.85rem', color: '#bae6fd', lineHeight: 1.35, marginBottom: '0.35rem' }}>
              {acao.descricao_origem || (
                <span style={{ color: '#666', fontStyle: 'italic' }}>Sem equivalência mapeada</span>
              )}
            </div>

            {/* Badges de Itens do PA (Verde = Concluído no Paxtu, Cinza = Não) */}
            {hasPaRefs && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
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
                        gap: '0.25rem',
                        background: item.fl_concluido_paxtu
                          ? 'rgba(0, 255, 136, 0.18)'
                          : 'rgba(255, 255, 255, 0.05)',
                        color: item.fl_concluido_paxtu ? '#00ff88' : '#888',
                        border: item.fl_concluido_paxtu
                          ? '1px solid rgba(0, 255, 136, 0.4)'
                          : '1px solid rgba(255, 255, 255, 0.1)',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '5px',
                        fontSize: '0.75rem',
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

            {/* Tags de Especialidades Requeridas (Verde = Conquistada, Âmbar = Pendente) */}
            {hasEsp && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.35rem',
                  marginTop: hasPaRefs ? '0.35rem' : 0,
                }}
              >
                {(acao.especialidades_origem_detalhadas &&
                acao.especialidades_origem_detalhadas.length > 0
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
                  const tooltipText = isConq
                    ? `Especialidade ${esp.nm_especialidade}: Conquistada no Nível ${
                        esp.nivel_conquistado
                      } (Exigido ${nivelExigidoStr})${
                        esp.dt_nivel ? ` em ${esp.dt_nivel}` : ''
                      }`
                    : `Especialidade ${esp.nm_especialidade}: Não conquistada no Nível ${
                        esp.nivel_exigido
                      }+ (Nível atual: ${esp.nivel_conquistado || 0})`;

                  return (
                    <span
                      key={esp.nm_especialidade}
                      title={tooltipText}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        background: isConq
                          ? 'rgba(0, 255, 136, 0.18)'
                          : 'rgba(255, 255, 255, 0.05)',
                        color: isConq ? '#00ff88' : '#888',
                        border: isConq
                          ? '1px solid rgba(0, 255, 136, 0.4)'
                          : '1px solid rgba(255, 255, 255, 0.1)',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '5px',
                        fontSize: '0.75rem',
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
        )}

        {/* COLUNA 3: Checkbox de Validação (Transparente) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              cursor: 'pointer',
              padding: '0.25rem 0.5rem',
              borderRadius: '6px',
              background: 'transparent',
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
                fontSize: '0.8rem',
                fontWeight: 700,
                color: isChecked ? 'var(--primary)' : '#888',
              }}
            >
              {isChecked ? 'Concluído' : 'Pendente'}
            </span>
          </label>

          <span style={{ fontSize: '0.68rem', color: '#777' }}>
            {acao.regra_id && acao.operacao !== 'SEM_EQUIVALENCIA' && !acao.fl_requer_validacao_manual
              ? 'Auto Paxtu'
              : 'Manual'}
          </span>
        </div>

        {/* COLUNA 4: Botão Salvar Individual + Botão Editar Regra */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          {isExpandido && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              style={{
                background: 'rgba(0, 255, 136, 0.15)',
                color: 'var(--primary)',
                border: '1px solid rgba(0, 255, 136, 0.3)',
                fontSize: '0.78rem',
                fontWeight: 700,
                padding: '0.38rem 0.75rem',
                borderRadius: '6px',
                boxShadow: 'none',
                cursor: isSaving ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                minWidth: '65px',
                textAlign: 'center',
              }}
            >
              {isSaving ? '...' : 'Salvar'}
            </button>
          )}

          <button
            type="button"
            onClick={onEditRegra}
            title="Editar Regra de Equivalência (Matriz) desta ação"
            style={{
              background: 'rgba(0, 255, 136, 0.15)',
              color: 'var(--primary)',
              border: '1px solid rgba(0, 255, 136, 0.3)',
              fontSize: '0.78rem',
              fontWeight: 700,
              padding: '0.38rem 0.75rem',
              borderRadius: '6px',
              boxShadow: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              minWidth: '65px',
              textAlign: 'center',
            }}
          >
            Editar
          </button>

          {feedback && (
            <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 600 }}>
              {feedback}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
