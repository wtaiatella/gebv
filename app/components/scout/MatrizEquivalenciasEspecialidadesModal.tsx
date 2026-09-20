'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, CheckCircle2, Sparkles, AlertCircle, RefreshCw, Link as LinkIcon } from 'lucide-react';

interface MatrizEquivalenciasEspecialidadesModalProps {
  isOpen: boolean;
  onClose: () => void;
  ramoInicial?: string;
}

interface PnEspItem {
  id: number;
  nr_item: number;
  cd_item: string;
  ds_item: string;
  regras_aprovadas: {
    id: number;
    pa_item_id: number;
    cd_item_pa: string;
    ds_item_pa: string;
    ds_especialidade_pa: string;
    score: number | null;
  }[];
  sugestoes: {
    pa_item_id: number;
    pa_especialidade: string;
    cd_item: string;
    ds_item: string;
    score: number;
  }[];
}

interface PnEspDetalhe {
  id: number;
  slug: string;
  ds_especialidade: string;
  ramo: string;
  meta_nivel_1: number;
  meta_nivel_2: number;
  itens: PnEspItem[];
}

export default function MatrizEquivalenciasEspecialidadesModal({
  isOpen,
  onClose,
  ramoInicial = 'LOBINHO_ESCOTEIRO',
}: MatrizEquivalenciasEspecialidadesModalProps) {
  const [ramo, setRamo] = useState<'LOBINHO_ESCOTEIRO' | 'SENIOR_PIONEIRO'>(
    ramoInicial.toLowerCase().includes('senior') || ramoInicial.toLowerCase().includes('pioneiro')
      ? 'SENIOR_PIONEIRO'
      : 'LOBINHO_ESCOTEIRO'
  );

  const [listaPn, setListaPn] = useState<any[]>([]);
  const [pnSelecionadaId, setPnSelecionadaId] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<PnEspDetalhe | null>(null);
  const [paCorrelatas, setPaCorrelatas] = useState<{ id: number; ds_especialidade: string }[]>([]);
  const [todasPa, setTodasPa] = useState<{ id: number; ds_especialidade: string }[]>([]);
  const [paParaVincular, setPaParaVincular] = useState<string>('');

  const [carregandoLista, setCarregandoLista] = useState(false);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // 1. Carrega lista de especialidades PN ao abrir ou trocar ramo
  useEffect(() => {
    if (!isOpen) return;
    async function carregarLista() {
      setCarregandoLista(true);
      setErro(null);
      try {
        const res = await fetch(`/api/especialidades-equivalencias?ramo=${ramo}`);
        const data = await res.json();
        if (data.especialidades) {
          setListaPn(data.especialidades);
          if (data.especialidades.length > 0 && !pnSelecionadaId) {
            setPnSelecionadaId(data.especialidades[0].id);
          }
        }
      } catch (err: any) {
        setErro('Erro ao carregar lista de especialidades PN.');
      } finally {
        setCarregandoLista(false);
      }
    }
    carregarLista();
  }, [isOpen, ramo]);

  // 2. Carrega detalhe da especialidade PN selecionada
  useEffect(() => {
    if (!isOpen || !pnSelecionadaId) return;
    async function carregarDetalhe() {
      setCarregandoDetalhe(true);
      setErro(null);
      try {
        const res = await fetch(`/api/especialidades-equivalencias?pn_especialidade_id=${pnSelecionadaId}`);
        const data = await res.json();
        if (data.pn_especialidade) {
          setDetalhe(data.pn_especialidade);
          setPaCorrelatas(data.pa_correlatas_vinculadas || []);
          setTodasPa(data.todas_pa_candidatas || []);
        } else if (data.error) {
          setErro(data.error);
        }
      } catch (err: any) {
        setErro('Erro ao carregar matriz da especialidade selecionada.');
      } finally {
        setCarregandoDetalhe(false);
      }
    }
    carregarDetalhe();
  }, [isOpen, pnSelecionadaId]);

  // 3. Vincular ou Desvincular Especialidade PA Correlata
  async function handleVincularPa(paId: number, acao: 'VINCULAR' | 'DESVINCULAR') {
    if (!pnSelecionadaId) return;
    setSalvando(true);
    try {
      const res = await fetch('/api/especialidades-equivalencias/vincular-pa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pn_especialidade_id: pnSelecionadaId,
          pa_especialidade_id: paId,
          acao,
        }),
      });
      if (res.ok) {
        // Recarrega os dados para recalcular as similaridades em memória
        const detailRes = await fetch(`/api/especialidades-equivalencias?pn_especialidade_id=${pnSelecionadaId}`);
        const data = await detailRes.json();
        if (data.pn_especialidade) {
          setDetalhe(data.pn_especialidade);
          setPaCorrelatas(data.pa_correlatas_vinculadas || []);
        }
      }
    } catch (err) {
      setErro('Erro ao atualizar vínculo com especialidade PA.');
    } finally {
      setSalvando(false);
      setPaParaVincular('');
    }
  }

  // 4. Aprovar ou Revogar Regra de Equivalência entre Itens
  async function handleToggleRegra(pnItemId: number, paItemId: number, aprovar: boolean, score?: number) {
    setSalvando(true);
    try {
      const res = await fetch('/api/especialidades-equivalencias/regra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pn_item_id: pnItemId,
          pa_item_id: paItemId,
          fl_aprovado: aprovar,
          score_similaridade: score,
        }),
      });
      if (res.ok) {
        // Atualiza estado local imediatamente
        setDetalhe((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            itens: prev.itens.map((it) => {
              if (it.id !== pnItemId) return it;
              if (aprovar) {
                const sugestao = it.sugestoes.find((s) => s.pa_item_id === paItemId);
                return {
                  ...it,
                  regras_aprovadas: [
                    ...it.regras_aprovadas.filter((r) => r.pa_item_id !== paItemId),
                    {
                      id: Date.now(),
                      pa_item_id: paItemId,
                      cd_item_pa: sugestao?.cd_item || '',
                      ds_item_pa: sugestao?.ds_item || '',
                      ds_especialidade_pa: sugestao?.pa_especialidade || '',
                      score: score ?? null,
                    },
                  ],
                };
              } else {
                return {
                  ...it,
                  regras_aprovadas: it.regras_aprovadas.filter((r) => r.pa_item_id !== paItemId),
                };
              }
            }),
          };
        });
      }
    } catch (err) {
      setErro('Erro ao persistir regra de equivalência.');
    } finally {
      setSalvando(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1280px',
          maxHeight: '92vh',
          backgroundColor: '#0b1120',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '20px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
        }}
      >
        {/* Cabeçalho do Modal */}
        <div
          style={{
            padding: '1.25rem 1.75rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'linear-gradient(90deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.7))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#10b981',
              }}
            >
              <Sparkles size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                Matriz de Equivalência de Especialidades (PN ↔ PA)
              </h2>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0, marginTop: '2px' }}>
                Recomendações semânticas baseadas em BAAI/bge-m3 e homologação de regras OR
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Barra de Filtros e Seletores */}
        <div
          style={{
            padding: '1rem 1.75rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.25rem',
            alignItems: 'center',
          }}
        >
          {/* Seletor de Ramo */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
              RAMO CURRICULAR
            </label>
            <select
              value={ramo}
              onChange={(e) => {
                setRamo(e.target.value as any);
                setPnSelecionadaId(null);
                setDetalhe(null);
              }}
              style={{
                backgroundColor: 'rgba(30, 41, 59, 0.8)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                padding: '0.45rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              <option value="LOBINHO_ESCOTEIRO">Lobinho e Escoteiro</option>
              <option value="SENIOR_PIONEIRO">Sênior e Pioneiro</option>
            </select>
          </div>

          {/* Seletor de Especialidade PN */}
          <div style={{ flex: 1, minWidth: '280px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
              ESPECIALIDADE DO NOVO PROGRAMA (PN)
            </label>
            <select
              value={pnSelecionadaId || ''}
              onChange={(e) => setPnSelecionadaId(Number(e.target.value))}
              disabled={carregandoLista}
              style={{
                width: '100%',
                backgroundColor: 'rgba(30, 41, 59, 0.8)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                padding: '0.45rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: 500,
              }}
            >
              {listaPn.map((esp) => (
                <option key={esp.id} value={esp.id}>
                  {esp.ds_especialidade} ({esp.eixo?.nm_eixo || 'Geral'} • {esp.total_itens} itens)
                </option>
              ))}
            </select>
          </div>

          {/* Metas de Nível PN */}
          {detalhe && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
              <div
                style={{
                  padding: '0.4rem 0.75rem',
                  borderRadius: '8px',
                  background: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  fontSize: '0.78rem',
                  color: '#4ade80',
                  fontWeight: 600,
                }}
              >
                Nível 1: {detalhe.meta_nivel_1} itens
              </div>
              <div
                style={{
                  padding: '0.4rem 0.75rem',
                  borderRadius: '8px',
                  background: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  fontSize: '0.78rem',
                  color: '#facc15',
                  fontWeight: 600,
                }}
              >
                Nível 2: {detalhe.meta_nivel_2} itens
              </div>
            </div>
          )}
        </div>

        {/* Gerenciamento de Especialidades PA Correlatas Vinculadas */}
        <div
          style={{
            padding: '0.85rem 1.75rem',
            background: 'rgba(15, 23, 42, 0.4)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', flex: 1 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <LinkIcon size={14} /> PAs Correlatas:
            </span>
            {paCorrelatas.length === 0 ? (
              <span style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic' }}>
                Nenhuma PA correlata vinculada ainda. Vincule ao lado para calcular similaridades.
              </span>
            ) : (
              paCorrelatas.map((pa) => (
                <span
                  key={pa.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    color: '#93c5fd',
                    fontSize: '0.78rem',
                    fontWeight: 500,
                  }}
                >
                  {pa.ds_especialidade}
                  <button
                    onClick={() => handleVincularPa(pa.id, 'DESVINCULAR')}
                    title="Desvincular PA"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Adicionar PA Correlata */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              value={paParaVincular}
              onChange={(e) => setPaParaVincular(e.target.value)}
              style={{
                backgroundColor: 'rgba(30, 41, 59, 0.8)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                padding: '0.35rem 0.6rem',
                fontSize: '0.8rem',
                maxWidth: '220px',
              }}
            >
              <option value="">+ Selecionar PA Correlata</option>
              {todasPa
                .filter((p) => !paCorrelatas.some((c) => c.id === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ds_especialidade}
                  </option>
                ))}
            </select>
            <button
              onClick={() => paParaVincular && handleVincularPa(Number(paParaVincular), 'VINCULAR')}
              disabled={!paParaVincular || salvando}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                backgroundColor: paParaVincular ? '#3b82f6' : 'rgba(255, 255, 255, 0.05)',
                color: paParaVincular ? '#fff' : '#64748b',
                border: 'none',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: paParaVincular ? 'pointer' : 'default',
              }}
            >
              Vincular
            </button>
          </div>
        </div>

        {/* Mensagens de Alerta ou Erro */}
        {erro && (
          <div
            style={{
              padding: '0.75rem 1.75rem',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <AlertCircle size={16} /> {erro}
          </div>
        )}

        {/* Conteúdo Principal: Layout Invertido (PN à esquerda, Sugestões PA à direita) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem' }}>
          {carregandoDetalhe ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
              <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.75rem' }} />
              Calculando similaridades semânticas em memória...
            </div>
          ) : !detalhe ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              Selecione uma especialidade do Novo Programa acima.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {detalhe.itens.map((item) => {
                const possuiRegra = item.regras_aprovadas.length > 0;

                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1.25fr',
                      gap: '1.25rem',
                      padding: '1.25rem',
                      borderRadius: '12px',
                      backgroundColor: possuiRegra ? 'rgba(34, 197, 94, 0.03)' : 'rgba(255, 255, 255, 0.02)',
                      border: possuiRegra ? '1px solid rgba(34, 197, 94, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    {/* Coluna Esquerda: Item PN */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <span
                          style={{
                            padding: '0.15rem 0.5rem',
                            borderRadius: '6px',
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#10b981',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                          }}
                        >
                          Item #{item.cd_item}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Novo Programa</span>
                      </div>
                      <p style={{ fontSize: '0.9rem', color: '#f1f5f9', lineHeight: 1.5, margin: 0 }}>
                        {item.ds_item}
                      </p>

                      {/* Regras Homologadas para este item */}
                      {possuiRegra && (
                        <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(34, 197, 94, 0.15)', paddingTop: '0.75rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#4ade80', display: 'block', marginBottom: '6px' }}>
                            ✓ Regra(s) de Equivalência Homologada(s):
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {item.regras_aprovadas.map((r) => (
                              <div
                                key={r.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '0.4rem 0.6rem',
                                  borderRadius: '6px',
                                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                                  fontSize: '0.78rem',
                                  color: '#86efac',
                                }}
                              >
                                <span>
                                  <strong>{r.ds_especialidade_pa} (#{r.cd_item_pa}):</strong> {r.ds_item_pa}
                                </span>
                                <button
                                  onClick={() => handleToggleRegra(item.id, r.pa_item_id, false)}
                                  title="Revogar equivalência"
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    padding: '2px',
                                    marginLeft: '8px',
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Coluna Direita: Sugestões Semânticas de PAs Correlatas */}
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>
                        SUGESTÕES SEMÂNTICAS DAS PAs CORRELATAS ({item.sugestoes.length})
                      </span>

                      {item.sugestoes.length === 0 ? (
                        <p style={{ fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic', margin: 0 }}>
                          Vincule uma PA correlata acima para calcular similaridades semânticas.
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {item.sugestoes.slice(0, 3).map((sug) => {
                            const jaAprovado = item.regras_aprovadas.some((r) => r.pa_item_id === sug.pa_item_id);
                            const scorePct = Math.round(sug.score * 100);
                            const scoreColor = scorePct >= 80 ? '#4ade80' : scorePct >= 70 ? '#facc15' : '#94a3b8';

                            return (
                              <div
                                key={sug.pa_item_id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  justifyContent: 'space-between',
                                  padding: '0.5rem 0.75rem',
                                  borderRadius: '8px',
                                  backgroundColor: jaAprovado ? 'rgba(34, 197, 94, 0.08)' : 'rgba(30, 41, 59, 0.6)',
                                  border: jaAprovado ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                                  gap: '0.75rem',
                                }}
                              >
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                                    <span
                                      style={{
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                        padding: '0.1rem 0.4rem',
                                        borderRadius: '4px',
                                        background: 'rgba(255, 255, 255, 0.08)',
                                        color: scoreColor,
                                      }}
                                    >
                                      {scorePct}% similar
                                    </span>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8' }}>
                                      {sug.pa_especialidade} (#{sug.cd_item})
                                    </span>
                                  </div>
                                  <p style={{ fontSize: '0.8rem', color: '#cbd5e1', margin: 0, lineHeight: 1.4 }}>
                                    {sug.ds_item}
                                  </p>
                                </div>

                                <button
                                  onClick={() => handleToggleRegra(item.id, sug.pa_item_id, !jaAprovado, sug.score)}
                                  disabled={salvando}
                                  style={{
                                    padding: '0.3rem 0.65rem',
                                    borderRadius: '6px',
                                    backgroundColor: jaAprovado ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                                    color: jaAprovado ? '#f87171' : '#4ade80',
                                    border: jaAprovado ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(34, 197, 94, 0.3)',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                  }}
                                >
                                  {jaAprovado ? 'Revogar' : '+ Homologar'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div
          style={{
            padding: '1rem 1.75rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 23, 42, 0.8)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Regras homologadas tornam-se imediatamente ativas no motor de transição de especialidades.
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
