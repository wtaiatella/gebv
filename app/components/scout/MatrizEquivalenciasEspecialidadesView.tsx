'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Trash2, Link as LinkIcon, Loader2, Info, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

interface MatrizEquivalenciasEspecialidadesViewProps {
  ramoInicial?: string;
}

interface PnEspItem {
  id: number;
  nr_item: number;
  cd_item: string;
  ds_item: string;
  tipo_equivalencia: 'TODAS' | 'AO_MENOS_UMA';
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

export default function MatrizEquivalenciasEspecialidadesView({
  ramoInicial = 'Escoteiro',
}: MatrizEquivalenciasEspecialidadesViewProps) {
  const isSeniorOuPioneiroInicial =
    ramoInicial.toLowerCase().includes('senior') || ramoInicial.toLowerCase().includes('sênior') || ramoInicial.toLowerCase().includes('pioneiro');

  const [ramo, setRamo] = useState<'LOBINHO_ESCOTEIRO' | 'SENIOR_PIONEIRO'>(
    isSeniorOuPioneiroInicial ? 'SENIOR_PIONEIRO' : 'LOBINHO_ESCOTEIRO'
  );

  const [listaPn, setListaPn] = useState<any[]>([]);
  const [pnSelecionadaId, setPnSelecionadaId] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<PnEspDetalhe | null>(null);
  const [paCorrelatas, setPaCorrelatas] = useState<{ id: number; cd_especialidade: string; ds_especialidade: string }[]>([]);

  const [carregandoLista, setCarregandoLista] = useState(false);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [itensExpandidos, setItensExpandidos] = useState<Record<number, boolean>>({});

  const toggleExpandir = (itemId: number) => {
    setItensExpandidos((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  // 1. Carrega lista de especialidades PN ao selecionar ramo
  useEffect(() => {
    async function carregarLista() {
      setCarregandoLista(true);
      setErro(null);
      try {
        const res = await fetch(`/api/especialidades-equivalencias?ramo=${ramo}`);
        const data = await res.json();
        if (data.especialidades) {
          setListaPn(data.especialidades);
          if (data.especialidades.length > 0) {
            setPnSelecionadaId(data.especialidades[0].id);
          } else {
            setPnSelecionadaId(null);
            setDetalhe(null);
          }
        }
      } catch (err: any) {
        setErro('Erro ao carregar lista de especialidades PN.');
      } finally {
        setCarregandoLista(false);
      }
    }
    carregarLista();
  }, [ramo]);

  // 2. Carrega detalhe da especialidade PN selecionada
  useEffect(() => {
    if (!pnSelecionadaId) return;
    async function carregarDetalhe() {
      setCarregandoDetalhe(true);
      setErro(null);
      try {
        const res = await fetch(`/api/especialidades-equivalencias?pn_especialidade_id=${pnSelecionadaId}`);
        const data = await res.json();
        if (data.pn_especialidade) {
          setDetalhe(data.pn_especialidade);
          setPaCorrelatas(data.pa_correlatas_vinculadas || []);
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
  }, [pnSelecionadaId]);

  // 3. Alternar Regra de Equivalência (Aprovar / Revogar)
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
        // Atualiza estado local de regras e recomputa PAs correlatas homologadas
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

        // Recarrega dinamicamente as PAs correlatas com base nas regras salvas
        if (pnSelecionadaId) {
          const detailRes = await fetch(`/api/especialidades-equivalencias?pn_especialidade_id=${pnSelecionadaId}`);
          const detailData = await detailRes.json();
          if (detailData.pa_correlatas_vinculadas) {
            setPaCorrelatas(detailData.pa_correlatas_vinculadas);
          }
        }
      }
    } catch (err) {
      setErro('Erro ao persistir regra de equivalência.');
    } finally {
      setSalvando(false);
    }
  }

  // 4. Alternar Tipo de Equivalência ("TODAS" vs "AO_MENOS_UMA")
  async function handleTipoEquivalenciaChange(pnItemId: number, novoTipo: 'TODAS' | 'AO_MENOS_UMA') {
    setSalvando(true);
    try {
      const res = await fetch('/api/especialidades-equivalencias/regra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pn_item_id: pnItemId,
          tipo_equivalencia: novoTipo,
        }),
      });
      if (res.ok) {
        setDetalhe((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            itens: prev.itens.map((it) => (it.id === pnItemId ? { ...it, tipo_equivalencia: novoTipo } : it)),
          };
        });
      }
    } catch (err) {
      setErro('Erro ao atualizar condição lógica da equivalência.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Cabeçalho da Matriz */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          paddingBottom: '1.25rem',
          borderBottom: '1px solid var(--glass-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'rgba(0, 255, 136, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
            }}
          >
            <Sparkles size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              Matriz de Equivalência de Especialidades (PN ↔ PA)
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0, marginTop: '2px' }}>
              Homologação de regras de equivalência curricular com busca semântica em todo o catálogo PA
            </p>
          </div>
        </div>

        {salvando && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--primary)', fontSize: '0.82rem', fontWeight: 600 }}>
            <Loader2 className="animate-spin" size={16} />
            <span>Salvando regra...</span>
          </div>
        )}
      </div>

      {erro && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '12px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
            fontSize: '0.88rem',
            fontWeight: 600,
          }}
        >
          {erro}
        </div>
      )}

      {/* Barra de Filtros e Seletores */}
      <div
        style={{
          padding: '1.25rem 1.5rem',
          borderRadius: '16px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--glass-border)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1.5rem',
          alignItems: 'center',
        }}
      >
        {/* Seletor de Ramo */}
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase' }}>
            Ramo Curricular
          </label>
          <select
            value={ramo}
            onChange={(e) => {
              setRamo(e.target.value as any);
              setPnSelecionadaId(null);
              setDetalhe(null);
            }}
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.45)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              padding: '0.6rem 1rem',
              fontSize: '0.88rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <option value="LOBINHO_ESCOTEIRO">Lobinho e Escoteiro</option>
            <option value="SENIOR_PIONEIRO">Sênior e Pioneiro</option>
          </select>
        </div>

        {/* Seletor de Especialidade PN */}
        <div style={{ flex: 1, minWidth: '300px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase' }}>
            Especialidade do Novo Programa (PN)
          </label>
          <select
            value={pnSelecionadaId || ''}
            onChange={(e) => setPnSelecionadaId(Number(e.target.value))}
            disabled={carregandoLista || listaPn.length === 0}
            style={{
              width: '100%',
              backgroundColor: 'rgba(0, 0, 0, 0.45)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              padding: '0.6rem 1rem',
              fontSize: '0.88rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {listaPn.length === 0 ? (
              <option value="">Nenhuma especialidade cadastrada neste ramo</option>
            ) : (
              listaPn.map((esp) => (
                <option key={esp.id} value={esp.id}>
                  {esp.ds_especialidade} ({esp.eixo?.nm_eixo || 'Geral'} • {esp.total_itens} itens)
                </option>
              ))
            )}
          </select>
        </div>

        {/* Metas de Nível PN */}
        {detalhe && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
            <div
              style={{
                padding: '0.55rem 0.9rem',
                borderRadius: '10px',
                background: 'rgba(0, 255, 136, 0.1)',
                border: '1px solid rgba(0, 255, 136, 0.25)',
                fontSize: '0.82rem',
                color: 'var(--primary)',
                fontWeight: 700,
              }}
            >
              Nível 1: {detalhe.meta_nivel_1} itens
            </div>
            <div
              style={{
                padding: '0.55rem 0.9rem',
                borderRadius: '10px',
                background: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                fontSize: '0.82rem',
                color: '#facc15',
                fontWeight: 700,
              }}
            >
              Nível 2: {detalhe.meta_nivel_2} itens
            </div>
          </div>
        )}
      </div>

      {/* Aviso Sênior/Pioneiro (quando selecionado) */}
      {ramo === 'SENIOR_PIONEIRO' ? (
        <div
          style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            background: 'rgba(59, 130, 246, 0.08)',
            borderRadius: '18px',
            border: '1px solid rgba(59, 130, 246, 0.25)',
          }}
        >
          <Info size={36} style={{ color: '#60a5fa', margin: '0 auto 1rem' }} />
          <h3 style={{ color: '#fff', fontWeight: 800, fontSize: '1.25rem' }}>
            Sem Matriz de Transição para Sênior e Pioneiro
          </h3>
          <p style={{ color: '#cbd5e1', maxWidth: '640px', margin: '0.65rem auto 0', lineHeight: 1.55 }}>
            No Novo Programa da UEB, os ramos Sênior e Pioneiro não possuem tabela de equivalência direta com especialidades do Programa Antigo. O desenvolvimento formativo é avaliado diretamente dentro do ciclo curricular próprio de cada seção.
          </p>
        </div>
      ) : (
        <>
          {/* Barra de PAs Correlatas Dinâmicas (Item 1.4) */}
          <div
            style={{
              padding: '1rem 1.5rem',
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '14px',
              border: '1px solid var(--glass-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', flex: 1 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <LinkIcon size={15} /> PAs com Itens Homologados:
              </span>
              {paCorrelatas.length === 0 ? (
                <span style={{ fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic' }}>
                  Nenhuma especialidade PA homologada ainda. As especialidades com regras ativas aparecerão aqui automaticamente.
                </span>
              ) : (
                paCorrelatas.map((pa) => (
                  <span
                    key={pa.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.3rem 0.75rem',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(56, 189, 248, 0.12)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      color: '#7dd3fc',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  >
                    {pa.ds_especialidade}
                  </span>
                ))
              )}
            </div>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Busca semântica ativa em todos os 2.785 itens PA
            </span>
          </div>

          {/* Área Principal de Itens */}
          {carregandoDetalhe ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: '#94a3b8' }}>
              <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 1rem', color: 'var(--primary)' }} />
              <p style={{ fontWeight: 600 }}>Calculando correspondências semânticas e carregando matriz...</p>
            </div>
          ) : !detalhe ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
              Selecione uma especialidade PN acima para visualizar seus requisitos e sugestões de equivalência.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {detalhe.itens.map((item) => {
                const possuiRegra = item.regras_aprovadas.length > 0;
                const multiplasRegras = item.regras_aprovadas.length >= 2;
                const expandido = !!itensExpandidos[item.id];
                const sugestoesExibidas = expandido ? item.sugestoes : item.sugestoes.slice(0, 3);

                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1.25fr',
                      gap: '1.5rem',
                      padding: '1.5rem',
                      borderRadius: '16px',
                      backgroundColor: possuiRegra ? 'rgba(0, 255, 136, 0.02)' : 'rgba(255, 255, 255, 0.02)',
                      border: possuiRegra ? '1px solid rgba(0, 255, 136, 0.25)' : '1px solid var(--glass-border)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {/* Coluna Esquerda: Requisito PN */}
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                          <span
                            style={{
                              padding: '0.2rem 0.6rem',
                              borderRadius: '6px',
                              background: 'rgba(0, 255, 136, 0.15)',
                              color: 'var(--primary)',
                              fontSize: '0.78rem',
                              fontWeight: 800,
                            }}
                          >
                            Item #{item.cd_item}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                            Novo Programa (PN)
                          </span>
                        </div>
                        <p style={{ fontSize: '0.94rem', color: '#f1f5f9', lineHeight: 1.55, margin: 0 }}>
                          {item.ds_item}
                        </p>

                        {/* Regras Homologadas */}
                        {possuiRegra && (
                          <div style={{ marginTop: '1.25rem', borderTop: '1px solid rgba(0, 255, 136, 0.2)', paddingTop: '0.85rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <CheckCircle2 size={14} /> Regra(s) Homologada(s):
                              </span>

                              {/* Seletor Lógico Item 1.6: "Todas" (AND) vs "Ao menos uma" (OR) */}
                              {multiplasRegras && (
                                <div
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.6rem',
                                    padding: '0.25rem 0.6rem',
                                    borderRadius: '8px',
                                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                  }}
                                >
                                  <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>Exigir:</span>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', color: item.tipo_equivalencia === 'TODAS' ? 'var(--primary)' : '#cbd5e1', cursor: 'pointer', fontWeight: 700 }}>
                                    <input
                                      type="radio"
                                      name={`tipo_eq_${item.id}`}
                                      value="TODAS"
                                      checked={item.tipo_equivalencia === 'TODAS'}
                                      onChange={() => handleTipoEquivalenciaChange(item.id, 'TODAS')}
                                      style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                                    />
                                    Todas (AND)
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', color: item.tipo_equivalencia === 'AO_MENOS_UMA' ? 'var(--primary)' : '#cbd5e1', cursor: 'pointer', fontWeight: 700 }}>
                                    <input
                                      type="radio"
                                      name={`tipo_eq_${item.id}`}
                                      value="AO_MENOS_UMA"
                                      checked={item.tipo_equivalencia === 'AO_MENOS_UMA'}
                                      onChange={() => handleTipoEquivalenciaChange(item.id, 'AO_MENOS_UMA')}
                                      style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                                    />
                                    Ao menos uma (OR)
                                  </label>
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {item.regras_aprovadas.map((r) => (
                                <div
                                  key={r.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '0.45rem 0.75rem',
                                    borderRadius: '8px',
                                    backgroundColor: 'rgba(0, 255, 136, 0.08)',
                                    border: '1px solid rgba(0, 255, 136, 0.2)',
                                    fontSize: '0.8rem',
                                    color: '#d1fae5',
                                  }}
                                >
                                  <span style={{ lineHeight: 1.4 }}>
                                    <strong style={{ color: '#38bdf8' }}>{r.ds_especialidade_pa} (#{r.cd_item_pa}):</strong> {r.ds_item_pa}
                                  </span>
                                  <button
                                    onClick={() => handleToggleRegra(item.id, r.pa_item_id, false)}
                                    title="Revogar equivalência"
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: '#f87171',
                                      cursor: 'pointer',
                                      padding: '4px',
                                      marginLeft: '8px',
                                      borderRadius: '4px',
                                      display: 'flex',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Coluna Direita: Sugestões Semânticas do Catálogo PA */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                          Sugestões Semânticas (Catálogo PA)
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {item.sugestoes.length} correspondências
                        </span>
                      </div>

                      {item.sugestoes.length === 0 ? (
                        <p style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic', margin: 0 }}>
                          Nenhuma correspondência encontrada no catálogo PA.
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {sugestoesExibidas.map((sug) => {
                            const jaAprovado = item.regras_aprovadas.some((r) => r.pa_item_id === sug.pa_item_id);
                            const scorePct = Math.round(sug.score * 100);
                            const scoreColor = scorePct >= 80 ? 'var(--primary)' : scorePct >= 70 ? '#facc15' : '#94a3b8';

                            return (
                              <div
                                key={sug.pa_item_id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  justifyContent: 'space-between',
                                  padding: '0.6rem 0.85rem',
                                  borderRadius: '10px',
                                  backgroundColor: jaAprovado ? 'rgba(0, 255, 136, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                                  border: jaAprovado ? '1px solid rgba(0, 255, 136, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                                  gap: '0.85rem',
                                }}
                              >
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                    <span
                                      style={{
                                        fontSize: '0.74rem',
                                        fontWeight: 800,
                                        padding: '0.12rem 0.45rem',
                                        borderRadius: '4px',
                                        background: 'rgba(255, 255, 255, 0.06)',
                                        color: scoreColor,
                                      }}
                                    >
                                      {scorePct}% similar
                                    </span>
                                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8' }}>
                                      {sug.pa_especialidade} (#{sug.cd_item})
                                    </span>
                                  </div>
                                  <p style={{ fontSize: '0.84rem', color: '#cbd5e1', margin: 0, lineHeight: 1.45 }}>
                                    {sug.ds_item}
                                  </p>
                                </div>

                                <button
                                  onClick={() => handleToggleRegra(item.id, sug.pa_item_id, !jaAprovado, sug.score)}
                                  disabled={salvando}
                                  style={{
                                    padding: '0.35rem 0.75rem',
                                    borderRadius: '8px',
                                    backgroundColor: jaAprovado ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0, 255, 136, 0.15)',
                                    color: jaAprovado ? '#f87171' : 'var(--primary)',
                                    border: jaAprovado ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(0, 255, 136, 0.3)',
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  {jaAprovado ? 'Revogar' : '+ Homologar'}
                                </button>
                              </div>
                            );
                          })}

                          {item.sugestoes.length > 3 && (
                            <button
                              onClick={() => toggleExpandir(item.id)}
                              style={{
                                marginTop: '4px',
                                width: '100%',
                                padding: '0.45rem 0.75rem',
                                borderRadius: '8px',
                                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                border: '1px dashed rgba(255, 255, 255, 0.15)',
                                color: '#94a3b8',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {expandido ? (
                                <>
                                  <ChevronUp size={14} /> Mostrar menos (top 3)
                                </>
                              ) : (
                                <>
                                  <ChevronDown size={14} /> Ver mais {item.sugestoes.length - 3} correspondências do catálogo PA
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
