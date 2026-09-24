'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import EditarRegraModal, { RegraParaEditar } from './EditarRegraModal';

export type RegraEquivalencia = {
  id: number;
  acao_pn_id: number;
  operacao: 'DIRETA' | 'OR' | 'MIN_COUNT' | 'ESPECIALIDADES' | 'SEM_EQUIVALENCIA' | string;
  descricao_origem: string;
  origem_pistas_ueb: string[];
  origem_rumo_ueb: string[];
  origem_especialidades: string[];
  nivel_min_especialidade: number;
  min_count: number;
  fl_requer_validacao_manual: boolean;
  updated_at: string;
  ds_acao: string;
  tp_acao: string;
  modalidade: string;
  regra_qtd_texto: string | null;
  nr_ordem_acao: number;
  bloco_id: number;
  nm_bloco: string;
  ds_intencionalidade: string;
  nr_ordem_bloco: number;
  eixo_id: number;
  nm_eixo: string;
  ds_ramo: string;
};

export type Eixo = {
  id: number;
  nm_eixo: string;
  nr_ordem: number;
};

export type Bloco = {
  id: number;
  eixo_id: number;
  nm_bloco: string;
  nr_ordem: number;
  ds_intencionalidade: string;
  nm_eixo: string;
};

export type PaAtividade = {
  id: number;
  cd_ueb: string;
  identificacao?: string;
  ds_atividade: string;
  nr_ordenacao: number;
  cd_caminho_paxtu: string;
  nm_caminho: string;
  ds_competencia: string;
};

type RegrasViewProps = {
  ramo?: string;
};

export default function RegrasEquivalenciaView({ ramo }: RegrasViewProps = {}) {
  const searchParams = useSearchParams();
  const ramoAtual = ramo || searchParams.get('ramo') || 'Escoteiro';

  const [regras, setRegras] = useState<RegraEquivalencia[]>([]);
  const [eixos, setEixos] = useState<Eixo[]>([]);
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [paAtividades, setPaAtividades] = useState<PaAtividade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [filtroEixo, setFiltroEixo] = useState<string>('todos');
  const [filtroBloco, setFiltroBloco] = useState<string>('todos');
  const [filtroOperacao, setFiltroOperacao] = useState<string>('todos');
  const [filtroModalidade, setFiltroModalidade] = useState<string>('todos');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Modal de edição
  const [regraParaEditar, setRegraParaEditar] = useState<RegraParaEditar | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Mapa rápido de atividades PA para tooltip / exibição
  const paAtividadesMap = useMemo(() => {
    const map = new Map<string, PaAtividade>();
    for (const a of paAtividades) {
      map.set(a.cd_ueb, a);
    }
    return map;
  }, [paAtividades]);

  // Carregar dados
  useEffect(() => {
    fetchRegras();
  }, [ramoAtual]);

  async function fetchRegras() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/regras-equivalencia?ramo=${ramoAtual}`);
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Falha ao carregar regras');
      }
      setRegras(data.regras);
      setEixos(data.eixos);
      setBlocos(data.blocos);
      setPaAtividades(data.pa_atividades);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar regras');
    } finally {
      setLoading(false);
    }
  }

  // Filtragem
  const regrasFiltradas = useMemo(() => {
    return regras.filter((r) => {
      if (filtroEixo !== 'todos' && r.eixo_id.toString() !== filtroEixo) return false;
      if (filtroBloco !== 'todos' && r.bloco_id.toString() !== filtroBloco) return false;
      if (filtroOperacao !== 'todos' && r.operacao !== filtroOperacao) return false;
      if (filtroModalidade !== 'todos' && r.modalidade !== filtroModalidade) return false;

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchAcao = r.ds_acao.toLowerCase().includes(term);
        const matchDesc = r.descricao_origem.toLowerCase().includes(term);
        const matchBloco = r.nm_bloco.toLowerCase().includes(term);
        const matchPistas = (r.origem_pistas_ueb || []).some((p) => p.toLowerCase().includes(term));
        const matchRumo = (r.origem_rumo_ueb || []).some((p) => p.toLowerCase().includes(term));
        const matchEsp = (r.origem_especialidades || []).some((p) => p.toLowerCase().includes(term));
        return matchAcao || matchDesc || matchBloco || matchPistas || matchRumo || matchEsp;
      }

      return true;
    });
  }, [regras, filtroEixo, filtroBloco, filtroOperacao, filtroModalidade, searchTerm]);

  // Estatísticas
  const stats = useMemo(() => {
    const total = regras.length;
    const diretas = regras.filter((r) => r.operacao === 'PROGRESSOES' || r.operacao === 'DIRETA').length;
    const alternativas = regras.filter((r) => r.operacao === 'TODAS' || r.operacao === 'QNT_MINIMA' || r.operacao === 'OR' || r.operacao === 'MIN_COUNT').length;
    const especialidades = regras.filter((r) => r.operacao === 'ESPECIALIDADE' || r.operacao === 'ESPECIALIDADES').length;
    const semEquiv = regras.filter((r) => r.operacao === 'SEM_EQUIVALENCIA').length;
    return { total, diretas, alternativas, especialidades, semEquiv, filtradas: regrasFiltradas.length };
  }, [regras, regrasFiltradas]);

  function handleOpenEdit(regra: RegraEquivalencia) {
    setRegraParaEditar({
      id: regra.id,
      acao_pn_id: regra.acao_pn_id,
      ds_acao: regra.ds_acao,
      nm_bloco: regra.nm_bloco,
      nr_ordem_acao: regra.nr_ordem_acao,
      operacao: regra.operacao,
      descricao_origem: regra.descricao_origem,
      origem_pistas_ueb: regra.origem_pistas_ueb || [],
      origem_rumo_ueb: regra.origem_rumo_ueb || [],
      origem_especialidades: regra.origem_especialidades || [],
      nivel_min_especialidade: regra.nivel_min_especialidade || 1,
      min_count: regra.min_count || 1,
      fl_requer_validacao_manual: regra.fl_requer_validacao_manual,
    });
    setIsModalOpen(true);
  }

  // Agrupamento por Bloco
  const regrasPorBloco = useMemo(() => {
    const map = new Map<number, { bloco: Bloco; regras: RegraEquivalencia[] }>();
    for (const r of regrasFiltradas) {
      if (!map.has(r.bloco_id)) {
        const blocoObj = blocos.find((b) => b.id === r.bloco_id) || {
          id: r.bloco_id,
          nm_bloco: r.nm_bloco,
          eixo_id: r.eixo_id,
          nr_ordem: r.nr_ordem_bloco,
          ds_intencionalidade: r.ds_intencionalidade,
          nm_eixo: r.nm_eixo,
        };
        map.set(r.bloco_id, { bloco: blocoObj, regras: [] });
      }
      map.get(r.bloco_id)!.regras.push(r);
    }
    return Array.from(map.values());
  }, [regrasFiltradas, blocos]);

  return (
    <div className="container" style={{ maxWidth: '1440px' }}>
      {/* Header da Página */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.4rem' }}>Matriz de Regras de Equivalência: {ramoAtual}</h1>
        <p className="subtitle">
          Configuração e visualização das regras de conversão do Programa Antigo (Paxtu) para os Blocos do Novo Programa Educativo.
        </p>
      </div>

      {/* Cards de Estatísticas */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.8rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Total de Ações
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--foreground)', marginTop: '0.25rem' }}>
            {stats.total}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', textAlign: 'center', borderColor: 'rgba(0, 255, 136, 0.3)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Regra Direta (1:1)
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary)', marginTop: '0.25rem' }}>
            {stats.diretas}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', textAlign: 'center', borderColor: 'rgba(56, 189, 248, 0.3)' }}>
          <div style={{ fontSize: '0.8rem', color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Alternativas (OR / Qtd)
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#38bdf8', marginTop: '0.25rem' }}>
            {stats.alternativas}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', textAlign: 'center', borderColor: 'rgba(234, 179, 8, 0.3)' }}>
          <div style={{ fontSize: '0.8rem', color: '#eab308', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Especialidades
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#eab308', marginTop: '0.25rem' }}>
            {stats.especialidades}
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', textAlign: 'center', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
          <div style={{ fontSize: '0.8rem', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Sem Equivalência
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#ef4444', marginTop: '0.25rem' }}>
            {stats.semEquiv}
          </div>
        </div>
      </div>

      {/* Painel de Filtros */}
      <section className="card" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
              Buscar ação, regra ou código
            </label>
            <input
              type="text"
              className="scout-select"
              placeholder="Ex: P-01, Arte, Acampar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
              Filtrar por Eixo
            </label>
            <select
              className="scout-select"
              value={filtroEixo}
              onChange={(e) => {
                setFiltroEixo(e.target.value);
                setFiltroBloco('todos');
              }}
            >
              <option value="todos">Todos os Eixos ({eixos.length})</option>
              {eixos.map((eixo) => (
                <option key={eixo.id} value={eixo.id.toString()}>
                  {eixo.nm_eixo}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
              Filtrar por Bloco
            </label>
            <select
              className="scout-select"
              value={filtroBloco}
              onChange={(e) => setFiltroBloco(e.target.value)}
            >
              <option value="todos">Todos os {blocos.length} Blocos</option>
              {blocos
                .filter((b) => filtroEixo === 'todos' || b.eixo_id.toString() === filtroEixo)
                .map((bloco) => (
                  <option key={bloco.id} value={bloco.id.toString()}>
                    {bloco.nr_ordem}. {bloco.nm_bloco}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
              Operação de Equivalência
            </label>
            <select
              className="scout-select"
              value={filtroOperacao}
              onChange={(e) => setFiltroOperacao(e.target.value)}
            >
              <option value="todos">Todas as Operações</option>
              <option value="PROGRESSOES">PROGRESSOES (Direta)</option>
              <option value="ESPECIALIDADE">ESPECIALIDADE</option>
              <option value="SEMANTICO">SEMANTICO</option>
              <option value="TODAS">TODAS</option>
              <option value="QNT_MINIMA">QNT_MINIMA</option>
              <option value="SEM_EQUIVALENCIA">SEM EQUIVALÊNCIA</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
              Modalidade
            </label>
            <select
              className="scout-select"
              value={filtroModalidade}
              onChange={(e) => setFiltroModalidade(e.target.value)}
            >
              <option value="todos">Todas</option>
              <option value="Básico">Básico</option>
              <option value="Ar">Ar</option>
              <option value="Mar">Mar</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
            Exibindo <strong style={{ color: 'var(--foreground)' }}>{regrasFiltradas.length}</strong> de {stats.total} ações
          </div>
          {(filtroEixo !== 'todos' || filtroBloco !== 'todos' || filtroOperacao !== 'todos' || filtroModalidade !== 'todos' || searchTerm) && (
            <button
              onClick={() => {
                setFiltroEixo('todos');
                setFiltroBloco('todos');
                setFiltroOperacao('todos');
                setFiltroModalidade('todos');
                setSearchTerm('');
              }}
              style={{
                background: 'transparent',
                color: '#aaa',
                border: '1px solid var(--glass-border)',
                padding: '0.4rem 1rem',
                fontSize: '0.85rem',
                borderRadius: '8px',
                boxShadow: 'none',
              }}
            >
              Limpar Filtros
            </button>
          )}
        </div>
      </section>

      {/* Conteúdo Principal / Blocos e Ações */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '4rem' }}>
          <div className="status-dot active" style={{ margin: '0 auto 1rem', width: '16px', height: '16px' }} />
          <p style={{ color: '#aaa' }}>Carregando catálogo de regras de equivalência...</p>
        </div>
      ) : error ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', borderColor: 'var(--error)' }}>
          <p style={{ color: 'var(--error)', marginBottom: '1rem' }}>{error}</p>
          <button onClick={fetchRegras} style={{ margin: '0 auto' }}>
            Tentar Novamente
          </button>
        </div>
      ) : regrasFiltradas.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#888' }}>
          Nenhuma regra encontrada para os filtros selecionados no ramo {ramoAtual}.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
          {regrasPorBloco.map(({ bloco, regras: blocoRegras }) => (
            <section
              key={bloco.id}
              className="card"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--glass-border)',
                borderRadius: '16px',
                padding: '1.75rem',
              }}
            >
              {/* Cabeçalho do Bloco */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  marginBottom: '1.5rem',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid var(--glass-border)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                    <span
                      style={{
                        background: 'rgba(56, 189, 248, 0.15)',
                        color: '#38bdf8',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {bloco.nm_eixo}
                    </span>
                    <span
                      style={{
                        background: 'rgba(0, 255, 136, 0.1)',
                        color: 'var(--primary)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                      }}
                    >
                      Bloco {bloco.nr_ordem}
                    </span>
                  </div>
                  <h2 style={{ fontSize: '1.35rem', color: 'var(--foreground)' }}>{bloco.nm_bloco}</h2>
                  {bloco.ds_intencionalidade && (
                    <p style={{ color: '#888', fontSize: '0.85rem', marginTop: '0.25rem', maxWidth: '900px' }}>
                      <strong>Intencionalidade:</strong> {bloco.ds_intencionalidade}
                    </p>
                  )}
                </div>

                <div style={{ textAlign: 'right', fontSize: '0.85rem', color: '#888' }}>
                  {blocoRegras.length} {blocoRegras.length === 1 ? 'ação cadastrada' : 'ações cadastradas'}
                </div>
              </div>

              {/* Tabela de Ações e Regras */}
              <div style={{ overflowX: 'auto' }}>
                <table className="atividades-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '60px' }}>#</th>
                      <th style={{ width: '110px' }}>Tipo / Mod.</th>
                      <th style={{ minWidth: '280px' }}>Ação Educativa (Novo Programa)</th>
                      <th style={{ width: '140px' }}>Operação</th>
                      <th style={{ minWidth: '280px' }}>Fórmula / Regra de Equivalência</th>
                      <th style={{ minWidth: '180px' }}>Itens Origem (PA / Especialidades)</th>
                      <th style={{ width: '100px', textAlign: 'center' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocoRegras.map((regra) => {
                      const operacaoConfig = getOperacaoBadge(regra.operacao);
                      const hasPistas = (regra.origem_pistas_ueb || []).length > 0;
                      const hasRumo = (regra.origem_rumo_ueb || []).length > 0;
                      const hasEsp = (regra.origem_especialidades || []).length > 0;

                      return (
                        <tr key={regra.id}>
                          <td className="col-numero" style={{ fontWeight: 600 }}>
                            {regra.nr_ordem_acao}
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <span
                                style={{
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  color: regra.tp_acao === 'Fixa' ? '#38bdf8' : '#a855f7',
                                }}
                              >
                                {regra.tp_acao}
                              </span>
                              {regra.modalidade && regra.modalidade !== 'Básico' && (
                                <span
                                  style={{
                                    fontSize: '0.7rem',
                                    color: regra.modalidade === 'Ar' ? '#0ea5e9' : '#06b6d4',
                                    background: 'rgba(255,255,255,0.05)',
                                    padding: '0.1rem 0.35rem',
                                    borderRadius: '4px',
                                    display: 'inline-block',
                                    width: 'fit-content',
                                  }}
                                >
                                  {regra.modalidade}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div style={{ color: 'var(--foreground)', fontSize: '0.92rem', lineHeight: 1.4 }}>
                              {regra.ds_acao}
                            </div>
                          </td>
                          <td>
                            <span
                              style={{
                                display: 'inline-block',
                                background: operacaoConfig.bg,
                                color: operacaoConfig.color,
                                border: `1px solid ${operacaoConfig.border}`,
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                padding: '0.25rem 0.6rem',
                                borderRadius: '6px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {operacaoConfig.label || regra.operacao}
                            </span>
                            {regra.fl_requer_validacao_manual && (
                              <div style={{ fontSize: '0.7rem', color: '#eab308', marginTop: '0.25rem' }}>
                                ⚠️ Validação manual
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontSize: '0.88rem', color: '#ddd', lineHeight: 1.4 }}>
                              {regra.descricao_origem || (
                                <span style={{ color: '#666', fontStyle: 'italic' }}>Sem descrição</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                              {/* Chips de Pistas */}
                              {hasPistas &&
                                regra.origem_pistas_ueb.map((p) => {
                                  const paInfo = paAtividades.find(
                                    (a) =>
                                      (a.cd_caminho_paxtu === '5' || a.cd_caminho_paxtu === 'PISTA') &&
                                      a.cd_ueb === p
                                  );
                                  const label = paInfo?.identificacao || `PT-${p}`;
                                  return (
                                    <span
                                      key={p}
                                      title={paInfo ? `${label}: ${paInfo.ds_atividade}` : label}
                                      style={{
                                        background: 'rgba(56, 189, 248, 0.15)',
                                        color: '#38bdf8',
                                        fontSize: '0.75rem',
                                        padding: '0.2rem 0.45rem',
                                        borderRadius: '4px',
                                        fontFamily: 'monospace',
                                        cursor: 'help',
                                      }}
                                    >
                                      {label}
                                    </span>
                                  );
                                })}

                              {/* Chips de Rumo */}
                              {hasRumo &&
                                regra.origem_rumo_ueb.map((r) => {
                                  const paInfo = paAtividades.find(
                                    (a) =>
                                      (a.cd_caminho_paxtu === '6' ||
                                        a.cd_caminho_paxtu === 'RUMO' ||
                                        a.cd_caminho_paxtu === 'TRAVESSIA') &&
                                      a.cd_ueb === r
                                  );
                                  const label = paInfo?.identificacao || `RT-${r}`;
                                  return (
                                    <span
                                      key={r}
                                      title={paInfo ? `${label}: ${paInfo.ds_atividade}` : label}
                                      style={{
                                        background: 'rgba(168, 85, 247, 0.15)',
                                        color: '#a855f7',
                                        fontSize: '0.75rem',
                                        padding: '0.2rem 0.45rem',
                                        borderRadius: '4px',
                                        fontFamily: 'monospace',
                                        cursor: 'help',
                                      }}
                                    >
                                      {label}
                                    </span>
                                  );
                                })}

                              {/* Chips de Especialidades */}
                              {hasEsp &&
                                regra.origem_especialidades.map((esp) => {
                                  const nivelStr = `N${regra.nivel_min_especialidade || 1}+`;
                                  return (
                                    <span
                                      key={esp}
                                      title={`Especialidade: ${esp} (Exigido Nível ${regra.nivel_min_especialidade || 1}+)`}
                                      style={{
                                        background: 'rgba(234, 179, 8, 0.15)',
                                        color: '#eab308',
                                        fontSize: '0.75rem',
                                        padding: '0.2rem 0.45rem',
                                        borderRadius: '4px',
                                        fontFamily: 'monospace',
                                        border: '1px solid rgba(234, 179, 8, 0.3)',
                                        cursor: 'help',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                      }}
                                    >
                                      <span>★</span>
                                      <span>
                                        {esp} ({nivelStr})
                                      </span>
                                    </span>
                                  );
                                })}

                              {!hasPistas && !hasRumo && !hasEsp && (
                                <span style={{ color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>
                                  Nenhum item vinculado
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              onClick={() => handleOpenEdit(regra)}
                              style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                color: 'var(--foreground)',
                                border: '1px solid var(--glass-border)',
                                padding: '0.4rem 0.8rem',
                                fontSize: '0.8rem',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: 'none',
                                margin: '0 auto',
                              }}
                              onMouseOver={(e) => {
                                e.currentTarget.style.background = 'var(--primary)';
                                e.currentTarget.style.color = '#000';
                              }}
                              onMouseOut={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                                e.currentTarget.style.color = 'var(--foreground)';
                              }}
                            >
                              ✏️ Editar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Modal Reutilizável de Edição */}
      <EditarRegraModal
        regra={regraParaEditar}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaveSuccess={fetchRegras}
        ramoAtual={ramoAtual}
      />
    </div>
  );
}

function getOperacaoBadge(operacao: string) {
  switch (operacao) {
    case 'PROGRESSOES':
    case 'DIRETA':
      return {
        label: 'PROGRESSOES',
        bg: 'rgba(0, 255, 136, 0.12)',
        color: '#00ff88',
        border: 'rgba(0, 255, 136, 0.3)',
      };
    case 'ESPECIALIDADE':
    case 'ESPECIALIDADES':
      return {
        label: 'ESPECIALIDADE',
        bg: 'rgba(234, 179, 8, 0.12)',
        color: '#eab308',
        border: 'rgba(234, 179, 8, 0.3)',
      };
    case 'SEMANTICO':
      return {
        label: 'SEMANTICO',
        bg: 'rgba(56, 189, 248, 0.12)',
        color: '#38bdf8',
        border: 'rgba(56, 189, 248, 0.3)',
      };
    case 'TODAS':
      return {
        label: 'TODAS',
        bg: 'rgba(168, 85, 247, 0.15)',
        color: '#c084fc',
        border: 'rgba(168, 85, 247, 0.35)',
      };
    case 'QNT_MINIMA':
    case 'OR':
    case 'MIN_COUNT':
      return {
        label: 'QNT_MINIMA',
        bg: 'rgba(56, 189, 248, 0.12)',
        color: '#38bdf8',
        border: 'rgba(56, 189, 248, 0.3)',
      };
    case 'SEM_EQUIVALENCIA':
    default:
      return {
        label: 'Sem Equivalência',
        bg: 'rgba(255, 255, 255, 0.06)',
        color: '#a1a1aa',
        border: 'rgba(255, 255, 255, 0.15)',
      };
  }
}
