'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { PaAtividade } from './RegrasEquivalenciaView';
import {
  validarDetalhesRegra,
  gerarDescricaoOrigem,
  type DetalhesRegra,
} from '@/app/lib/services/transicao-service';

export type RegraParaEditar = {
  id: number; // pn_equivalencia_regras id
  acao_pn_id: number;
  ds_acao: string;
  nm_bloco?: string;
  nr_ordem_acao?: number;
  operacao: 'PROGRESSOES' | 'ESPECIALIDADE' | 'SEMANTICO' | 'TODAS' | 'QNT_MINIMA' | 'SEM_EQUIVALENCIA' | string;
  descricao_origem: string;
  detalhes_regra?: any;
  // Campos legados para inicialização de fallback
  origem_pistas_ueb?: string[];
  origem_rumo_ueb?: string[];
  origem_especialidades?: string[];
  nivel_min_especialidade?: number;
  min_count?: number;
  fl_requer_validacao_manual?: boolean;
};

type Props = {
  regra: RegraParaEditar | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess: () => void;
  ramoAtual?: string;
};

interface SugestaoSemantica {
  pa_atividade_id: number;
  identificacao: string;
  ds_atividade: string;
  caminho?: string;
  competencia?: string;
  score: number;
}

export default function EditarRegraModal({
  regra,
  isOpen,
  onClose,
  onSaveSuccess,
  ramoAtual = 'Escoteiro',
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [operacao, setOperacao] = useState<'PROGRESSOES' | 'ESPECIALIDADE' | 'SEMANTICO' | 'TODAS' | 'QNT_MINIMA' | 'SEM_EQUIVALENCIA'>('PROGRESSOES');
  const [descricao, setDescricao] = useState('');
  const [validacaoManual, setValidacaoManual] = useState<boolean>(false);

  // Catálogos auxiliares
  const [paAtividades, setPaAtividades] = useState<PaAtividade[]>([]);
  const [especialidadesCatalogo, setEspecialidadesCatalogo] = useState<Array<{ cd_especialidade: string; ds_especialidade: string }>>([]);

  // Estado para Item Único (PROGRESSOES)
  const [selectedPaItem, setSelectedPaItem] = useState<{ pa_atividade_id: number; identificacao: string; ds_atividade: string } | null>(null);
  const [buscaPaTexto, setBuscaPaTexto] = useState('');

  // Estado para Especialidade Única (ESPECIALIDADE)
  const [selectedEsp, setSelectedEsp] = useState<string>('');
  const [nivelMinEsp, setNivelMinEsp] = useState<number>(1);

  // Estado para Motor Semântico (SEMANTICO)
  const [semanticoLogica, setSemanticoLogica] = useState<'AND' | 'OR'>('OR');
  const [semanticoItens, setSemanticoItens] = useState<Array<{ pa_atividade_id: number; identificacao: string; ds_atividade?: string; score_capturado: number }>>([]);
  const [sugestoesSemanticas, setSugestoesSemanticas] = useState<SugestaoSemantica[]>([]);
  const [loadingSemantico, setLoadingSemantico] = useState(false);
  const [expandedTop10, setExpandedTop10] = useState(false);

  // Estado para Contêineres (TODAS / QNT_MINIMA)
  const [quantidadeMinima, setQuantidadeMinima] = useState<number>(1);
  const [subRegras, setSubRegras] = useState<any[]>([]);
  const [novoSubTipo, setNovoSubTipo] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fechar no Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Carrega catálogo de atividades PA e especialidades
  useEffect(() => {
    if (isOpen) {
      fetch('/api/regras-equivalencia?ramo=' + ramoAtual)
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            if (data.pa_atividades) setPaAtividades(data.pa_atividades);
            if (data.especialidades_catalogo) setEspecialidadesCatalogo(data.especialidades_catalogo);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, ramoAtual]);

  // Busca sugestões semânticas vetoriais para a ação atual (Top 10)
  useEffect(() => {
    if (isOpen && regra?.acao_pn_id) {
      setLoadingSemantico(true);
      fetch(`/api/progressoes/semantico?acao_pn_id=${regra.acao_pn_id}&ramo=${ramoAtual}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.success && Array.isArray(data.sugestoes)) {
            setSugestoesSemanticas(data.sugestoes);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingSemantico(false));
    }
  }, [isOpen, regra?.acao_pn_id, ramoAtual]);

  // Sincroniza dados da regra ao abrir
  useEffect(() => {
    if (regra) {
      setError(null);
      setSuccess(null);
      setDescricao(regra.descricao_origem || '');
      setValidacaoManual(Boolean(regra.fl_requer_validacao_manual));
      setExpandedTop10(false);

      // Normaliza operação
      let op: any = regra.operacao;
      if (op === 'DIRETA') op = 'PROGRESSOES';
      else if (op === 'OR' || op === 'MIN_COUNT') op = 'QNT_MINIMA';
      else if (op === 'ESPECIALIDADES') op = 'ESPECIALIDADE';
      else if (!['PROGRESSOES', 'ESPECIALIDADE', 'SEMANTICO', 'TODAS', 'QNT_MINIMA', 'SEM_EQUIVALENCIA'].includes(op)) {
        op = 'PROGRESSOES';
      }
      setOperacao(op);

      const d = regra.detalhes_regra;
      if (d && typeof d === 'object' && d.tipo) {
        // Inicializa a partir do schema recursivo DetalhesRegra
        if (d.tipo === 'PROGRESSOES') {
          if (d.item) {
            setSelectedPaItem({
              pa_atividade_id: d.item.pa_atividade_id,
              identificacao: d.item.identificacao || `Ativ. ${d.item.pa_atividade_id}`,
              ds_atividade: d.item.ds_atividade || '',
            });
          }
        } else if (d.tipo === 'ESPECIALIDADE') {
          setSelectedEsp(d.nm_especialidade || '');
          setNivelMinEsp(d.nivel_minimo || 1);
        } else if (d.tipo === 'SEMANTICO') {
          setSemanticoLogica(d.logica === 'AND' ? 'AND' : 'OR');
          setSemanticoItens(
            (d.itens || []).map((i: any) => ({
              pa_atividade_id: i.pa_atividade_id,
              identificacao: i.identificacao || `PT-${i.pa_atividade_id}`,
              ds_atividade: i.ds_atividade || '',
              score_capturado: i.score_capturado || 0,
            }))
          );
        } else if (d.tipo === 'TODAS' || d.tipo === 'QNT_MINIMA') {
          setQuantidadeMinima(d.quantidade_minima || 1);
          setSubRegras(Array.isArray(d.blocos) ? d.blocos : []);
        }
      } else {
        // Fallback para campos legados planos
        if (op === 'ESPECIALIDADE') {
          setSelectedEsp((regra.origem_especialidades && regra.origem_especialidades[0]) || '');
          setNivelMinEsp(regra.nivel_min_especialidade || 1);
        } else {
          // Pistas ou Rumo legados
          const primeiraPista = regra.origem_pistas_ueb?.[0];
          const primeiroRumo = regra.origem_rumo_ueb?.[0];
          if (primeiraPista || primeiroRumo) {
            const ident = primeiraPista ? `PT-${primeiraPista}` : `RT-${primeiroRumo}`;
            setSelectedPaItem({
              pa_atividade_id: 0,
              identificacao: ident,
              ds_atividade: '',
            });
          }
        }
      }
    }
  }, [regra]);

  // Constrói o objeto DetalhesRegra atual com base no formulário
  const detalhesRegraAtual = useMemo<DetalhesRegra | null>(() => {
    switch (operacao) {
      case 'SEM_EQUIVALENCIA':
        return { tipo: 'SEM_EQUIVALENCIA' };
      case 'PROGRESSOES':
        if (!selectedPaItem) return null;
        return {
          tipo: 'PROGRESSOES',
          item: {
            pa_atividade_id: selectedPaItem.pa_atividade_id,
            identificacao: selectedPaItem.identificacao,
            ds_atividade: selectedPaItem.ds_atividade,
          },
        };
      case 'ESPECIALIDADE':
        if (!selectedEsp) return null;
        return {
          tipo: 'ESPECIALIDADE',
          nm_especialidade: selectedEsp,
          nivel_minimo: nivelMinEsp,
        };
      case 'SEMANTICO':
        return {
          tipo: 'SEMANTICO',
          logica: semanticoLogica,
          itens: semanticoItens.map((i) => ({
            pa_atividade_id: i.pa_atividade_id,
            identificacao: i.identificacao,
            score_capturado: i.score_capturado,
          })),
        };
      case 'TODAS':
        return {
          tipo: 'TODAS',
          blocos: subRegras,
        };
      case 'QNT_MINIMA':
        return {
          tipo: 'QNT_MINIMA',
          quantidade_minima: quantidadeMinima,
          blocos: subRegras,
        };
      default:
        return null;
    }
  }, [operacao, selectedPaItem, selectedEsp, nivelMinEsp, semanticoLogica, semanticoItens, subRegras, quantidadeMinima]);

  // Lista filtrada de PA Atividades para busca no autocomplete
  const paAtividadesFiltradas = useMemo(() => {
    if (!buscaPaTexto.trim()) return paAtividades.slice(0, 30);
    const q = buscaPaTexto.toLowerCase();
    return paAtividades
      .filter((a) => a.identificacao?.toLowerCase().includes(q) || a.ds_atividade?.toLowerCase().includes(q))
      .slice(0, 40);
  }, [paAtividades, buscaPaTexto]);

  // Adicionar item semântico homologado
  function handleHomologarSemantico(sugestao: SugestaoSemantica) {
    if (semanticoItens.some((i) => i.pa_atividade_id === sugestao.pa_atividade_id)) {
      return;
    }
    setSemanticoItens([
      ...semanticoItens,
      {
        pa_atividade_id: sugestao.pa_atividade_id,
        identificacao: sugestao.identificacao,
        ds_atividade: sugestao.ds_atividade,
        score_capturado: sugestao.score,
      },
    ]);
  }

  // Remover item semântico
  function handleRemoverSemantico(paAtividadeId: number) {
    setSemanticoItens(semanticoItens.filter((i) => i.pa_atividade_id !== paAtividadeId));
  }

  // Adicionar sub-regra em contêineres (TODAS ou QNT_MINIMA)
  function handleAdicionarSubRegra(tipo: string) {
    if (!tipo) return;

    // Regra anti auto-aninhamento (T025)
    if (operacao === 'TODAS' && tipo === 'TODAS') {
      alert('Auto-aninhamento proibido: uma regra TODAS não pode conter outra regra TODAS.');
      return;
    }
    if (operacao === 'QNT_MINIMA' && tipo === 'QNT_MINIMA') {
      alert('Auto-aninhamento proibido: uma regra QNT_MINIMA não pode conter outra regra QNT_MINIMA.');
      return;
    }

    let novoBloco: any = null;
    if (tipo === 'PROGRESSOES') {
      novoBloco = {
        tipo: 'PROGRESSOES',
        item: { pa_atividade_id: 0, identificacao: 'Nova Atividade PA', ds_atividade: '' },
      };
    } else if (tipo === 'ESPECIALIDADE') {
      novoBloco = {
        tipo: 'ESPECIALIDADE',
        nm_especialidade: especialidadesCatalogo[0]?.ds_especialidade || 'Pioneiria',
        nivel_minimo: 1,
      };
    } else if (tipo === 'SEMANTICO') {
      novoBloco = {
        tipo: 'SEMANTICO',
        logica: 'OR',
        itens: [],
      };
    } else if (tipo === 'QNT_MINIMA') {
      novoBloco = {
        tipo: 'QNT_MINIMA',
        quantidade_minima: 1,
        blocos: [],
      };
    } else if (tipo === 'TODAS') {
      novoBloco = {
        tipo: 'TODAS',
        blocos: [],
      };
    }

    if (novoBloco) {
      setSubRegras([...subRegras, novoBloco]);
      setNovoSubTipo('');
    }
  }

  // Remover sub-regra
  function handleRemoverSubRegra(idx: number) {
    setSubRegras(subRegras.filter((_, i) => i !== idx));
  }

  // Submissão do formulário com validação canônica
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!regra) return;

    if (!detalhesRegraAtual) {
      setError('Por favor, configure todos os campos obrigatórios da regra selecionada.');
      return;
    }

    // Validação estrita contra auto-aninhamento e coerência de nós
    const validacao = validarDetalhesRegra(detalhesRegraAtual);
    if (!validacao.valido) {
      setError(validacao.erro || 'A regra configurada é inválida.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const descricaoFinal = descricao.trim() || gerarDescricaoOrigem(detalhesRegraAtual, operacao);

      const payload = {
        operacao,
        detalhes_regra: detalhesRegraAtual,
        descricao_origem: descricaoFinal,
        fl_requer_validacao_manual: validacaoManual,
      };

      const res = await fetch(`/api/regras-equivalencia/${regra.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Erro ao salvar alterações');
      }

      setSuccess('Regra de equivalência atualizada com sucesso!');
      setTimeout(() => {
        onSaveSuccess();
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar regra');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen || !regra || !mounted) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '1.5rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '820px',
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: '#0a0e11',
          border: '1px solid rgba(0, 255, 136, 0.35)',
          padding: '2rem',
          borderRadius: '18px',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.95), 0 0 40px rgba(0, 255, 136, 0.12)',
          position: 'relative',
          color: '#ededed',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            {regra.nm_bloco && (
              <span
                style={{
                  background: 'rgba(0, 255, 136, 0.12)',
                  color: '#00ff88',
                  border: '1px solid rgba(0, 255, 136, 0.35)',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  padding: '0.25rem 0.65rem',
                  borderRadius: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {regra.nm_bloco} {regra.nr_ordem_acao ? `(Ação #${regra.nr_ordem_acao})` : ''}
              </span>
            )}
            <h3 style={{ fontSize: '1.4rem', marginTop: '0.5rem', color: '#fff', fontWeight: 800, letterSpacing: '-0.02em' }}>
              Editar Regra de Equivalência
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              color: '#888',
              border: 'none',
              fontSize: '1.6rem',
              padding: '0.2rem 0.6rem',
              boxShadow: 'none',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Ação Educativa Card */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '1rem 1.15rem',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ fontSize: '0.72rem', color: '#888', textTransform: 'uppercase', marginBottom: '0.3rem', fontWeight: 700, letterSpacing: '0.05em' }}>
            Ação Educativa (Novo Programa)
          </div>
          <div style={{ fontSize: '0.95rem', color: '#f1f5f9', lineHeight: 1.5, fontWeight: 500 }}>
            {regra.ds_acao}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Seletor de Operação Canônica */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', color: '#aaa', marginBottom: '0.4rem', fontWeight: 700 }}>
              Operação Canônica de Equivalência
            </label>
            <select
              className="scout-select"
              value={operacao}
              onChange={(e) => setOperacao(e.target.value as any)}
              required
              style={{
                background: 'rgba(0, 0, 0, 0.55)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#fff',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                width: '100%',
                fontSize: '0.9rem',
              }}
            >
              <option value="PROGRESSOES">PROGRESSOES (Item único de atividade do Programa Antigo)</option>
              <option value="ESPECIALIDADE">ESPECIALIDADE (Especialidade do PA em nível mínimo)</option>
              <option value="SEMANTICO">SEMANTICO (Busca vetorial BAAI/bge-m3 com correspondências Top 10)</option>
              <option value="TODAS">TODAS (Contêiner E / AND — cumprir todos os blocos)</option>
              <option value="QNT_MINIMA">QNT_MINIMA (Contêiner OU / Mínimo N — cumprir quantidade mínima)</option>
              <option value="SEM_EQUIVALENCIA">SEM_EQUIVALENCIA (Sem equivalência histórica de PA)</option>
            </select>
          </div>

          {/* PAINEL 1: Item Único (PROGRESSOES) com Chips e ✕ */}
          {operacao === 'PROGRESSOES' && (
            <div
              style={{
                background: 'rgba(0, 255, 136, 0.03)',
                border: '1px solid rgba(0, 255, 136, 0.2)',
                borderRadius: '14px',
                padding: '1.25rem',
                marginBottom: '1.25rem',
              }}
            >
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#00ff88', marginBottom: '0.5rem', fontWeight: 800 }}>
                ◆ Atividade do Programa Antigo (Pista / Rumo)
              </label>

              {/* Chip do item selecionado */}
              {selectedPaItem ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span
                    style={{
                      background: 'rgba(0, 255, 136, 0.18)',
                      color: '#00ff88',
                      border: '1px solid rgba(0, 255, 136, 0.4)',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span>{selectedPaItem.identificacao} {selectedPaItem.ds_atividade ? `— ${selectedPaItem.ds_atividade.slice(0, 60)}...` : ''}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedPaItem(null)}
                      title="Remover item"
                      style={{
                        background: 'transparent',
                        color: '#00ff88',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: 800,
                        padding: '0 0.2rem',
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    value={buscaPaTexto}
                    onChange={(e) => setBuscaPaTexto(e.target.value)}
                    placeholder="Filtrar por código (ex: PT-12, RT-05) ou descrição..."
                    style={{
                      background: 'rgba(0, 0, 0, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '0.5rem 0.75rem',
                      width: '100%',
                      fontSize: '0.85rem',
                      marginBottom: '0.5rem',
                    }}
                  />
                  <select
                    className="scout-select"
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const ativ = paAtividades.find((a) => a.id === id);
                      if (ativ) {
                        setSelectedPaItem({
                          pa_atividade_id: ativ.id,
                          identificacao: ativ.identificacao || `PT-${ativ.id}`,
                          ds_atividade: ativ.ds_atividade || '',
                        });
                        setBuscaPaTexto('');
                      }
                    }}
                    value=""
                    style={{
                      width: '100%',
                      background: 'rgba(0, 0, 0, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '0.6rem 0.85rem',
                      fontSize: '0.88rem',
                    }}
                  >
                    <option value="">Selecione uma atividade da lista...</option>
                    {paAtividadesFiltradas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.identificacao}: {a.ds_atividade.slice(0, 80)}...
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* PAINEL 2: Especialidade Única (ESPECIALIDADE) com Chips e ✕ */}
          {operacao === 'ESPECIALIDADE' && (
            <div
              style={{
                background: 'rgba(234, 179, 8, 0.03)',
                border: '1px dashed rgba(234, 179, 8, 0.25)',
                borderRadius: '14px',
                padding: '1.25rem',
                marginBottom: '1.25rem',
              }}
            >
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#eab308', marginBottom: '0.5rem', fontWeight: 800 }}>
                ★ Especialidade do Programa Antigo no Nível Mínimo
              </label>

              {selectedEsp ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span
                    style={{
                      background: 'rgba(234, 179, 8, 0.18)',
                      color: '#eab308',
                      border: '1px solid rgba(234, 179, 8, 0.4)',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span>★ {selectedEsp} (Nível {nivelMinEsp}+)</span>
                    <button
                      type="button"
                      onClick={() => setSelectedEsp('')}
                      title="Remover especialidade"
                      style={{
                        background: 'transparent',
                        color: '#eab308',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: 800,
                        padding: '0 0.2rem',
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ width: '130px' }}>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: '#aaa', marginBottom: '0.3rem' }}>
                      Nível Mínimo
                    </label>
                    <select
                      className="scout-select"
                      value={nivelMinEsp}
                      onChange={(e) => setNivelMinEsp(Number(e.target.value) || 1)}
                      style={{
                        background: 'rgba(0, 0, 0, 0.6)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                        borderRadius: '8px',
                        padding: '0.55rem 0.75rem',
                        width: '100%',
                        fontSize: '0.88rem',
                      }}
                    >
                      <option value={1}>Nível 1+</option>
                      <option value={2}>Nível 2+</option>
                      <option value={3}>Nível 3</option>
                    </select>
                  </div>

                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: '#aaa', marginBottom: '0.3rem' }}>
                      Especialidade PA
                    </label>
                    <select
                      className="scout-select"
                      value={selectedEsp}
                      onChange={(e) => setSelectedEsp(e.target.value)}
                      style={{
                        background: 'rgba(0, 0, 0, 0.6)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                        borderRadius: '8px',
                        padding: '0.55rem 0.75rem',
                        width: '100%',
                        fontSize: '0.88rem',
                      }}
                    >
                      <option value="">Selecione uma especialidade...</option>
                      {especialidadesCatalogo.map((esp) => (
                        <option key={esp.cd_especialidade} value={esp.ds_especialidade}>
                          {esp.ds_especialidade}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PAINEL 3: Busca Semântica Inline (SEMANTICO) com Layout de 2 Painéis (T027) */}
          {operacao === 'SEMANTICO' && (
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.03)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '14px',
                padding: '1.25rem',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ fontSize: '0.85rem', color: '#38bdf8', fontWeight: 800, marginBottom: '0.75rem' }}>
                🧠 Correspondência Semântica Vetorial (BAAI/bge-m3)
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 1.4fr)',
                  gap: '1.25rem',
                }}
              >
                {/* Painel Esquerdo: Item PN, Rádio AND/OR e Chips Homologados */}
                <div style={{ borderRight: '1px solid rgba(255, 255, 255, 0.08)', paddingRight: '1rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#aaa', fontWeight: 700, marginBottom: '0.4rem' }}>
                    Critério de Combinação
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.82rem' }}>
                      <input
                        type="radio"
                        name="semantico_logica"
                        value="OR"
                        checked={semanticoLogica === 'OR'}
                        onChange={() => setSemanticoLogica('OR')}
                        style={{ accentColor: '#38bdf8' }}
                      />
                      Ao menos uma (OR)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.82rem' }}>
                      <input
                        type="radio"
                        name="semantico_logica"
                        value="AND"
                        checked={semanticoLogica === 'AND'}
                        onChange={() => setSemanticoLogica('AND')}
                        style={{ accentColor: '#38bdf8' }}
                      />
                      Todas (AND)
                    </label>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: '#aaa', fontWeight: 700, marginBottom: '0.4rem' }}>
                    Itens Homologados ({semanticoItens.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {semanticoItens.length === 0 && (
                      <span style={{ fontSize: '0.78rem', color: '#666', fontStyle: 'italic' }}>
                        Nenhum item homologado. Selecione no painel ao lado.
                      </span>
                    )}
                    {semanticoItens.map((item) => (
                      <span
                        key={item.pa_atividade_id}
                        style={{
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: '#38bdf8',
                          border: '1px solid rgba(56, 189, 248, 0.35)',
                          padding: '0.25rem 0.55rem',
                          borderRadius: '6px',
                          fontSize: '0.76rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.4rem',
                        }}
                      >
                        <span>
                          <strong>{item.identificacao}</strong>{' '}
                          {item.score_capturado ? `(${Math.round(item.score_capturado * 100)}% match)` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoverSemantico(item.pa_atividade_id)}
                          style={{
                            background: 'transparent',
                            color: '#38bdf8',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 800,
                            padding: 0,
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Painel Direito: Sugestões Semânticas (Top 3 + Expansor Top 10) */}
                <div>
                  <div style={{ fontSize: '0.78rem', color: '#aaa', fontWeight: 700, marginBottom: '0.4rem' }}>
                    Sugestões Mais Próximas (Similaridade de Cosseno)
                  </div>

                  {loadingSemantico && (
                    <div style={{ fontSize: '0.82rem', color: '#888', padding: '1rem 0' }}>
                      Calculando similaridade vetorial...
                    </div>
                  )}

                  {!loadingSemantico && sugestoesSemanticas.length === 0 && (
                    <div style={{ fontSize: '0.82rem', color: '#666', fontStyle: 'italic' }}>
                      Nenhuma correspondência calculada ainda.
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {sugestoesSemanticas
                      .slice(0, expandedTop10 ? 10 : 3)
                      .map((sug, idx) => {
                        const isJaAdicionado = semanticoItens.some((i) => i.pa_atividade_id === sug.pa_atividade_id);
                        const pctMatch = Math.round(sug.score * 100);

                        return (
                          <div
                            key={sug.pa_atividade_id}
                            style={{
                              background: 'rgba(0, 0, 0, 0.4)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              borderRadius: '8px',
                              padding: '0.65rem 0.85rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '0.75rem',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ color: '#00ff88', fontWeight: 800, fontSize: '0.8rem' }}>
                                  #{idx + 1} {sug.identificacao}
                                </span>
                                <span
                                  style={{
                                    fontSize: '0.72rem',
                                    color: pctMatch >= 80 ? '#00ff88' : '#38bdf8',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    padding: '0.1rem 0.35rem',
                                    borderRadius: '4px',
                                    fontWeight: 700,
                                  }}
                                >
                                  {pctMatch}% match
                                </span>
                              </div>
                              <p style={{ fontSize: '0.76rem', color: '#ccc', margin: '0.2rem 0 0', lineHeight: 1.3 }}>
                                {sug.ds_atividade.slice(0, 90)}...
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleHomologarSemantico(sug)}
                              disabled={isJaAdicionado}
                              style={{
                                background: isJaAdicionado ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 255, 136, 0.15)',
                                color: isJaAdicionado ? '#666' : '#00ff88',
                                border: isJaAdicionado ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 255, 136, 0.35)',
                                padding: '0.35rem 0.75rem',
                                borderRadius: '6px',
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                cursor: isJaAdicionado ? 'default' : 'pointer',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                            >
                              {isJaAdicionado ? 'Adicionado' : '+ Homologar'}
                            </button>
                          </div>
                        );
                      })}
                  </div>

                  {sugestoesSemanticas.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setExpandedTop10(!expandedTop10)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#38bdf8',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        padding: '0.5rem 0 0',
                        fontWeight: 700,
                        textAlign: 'left',
                      }}
                    >
                      {expandedTop10 ? '▲ Ver apenas Top 3' : `▼ Ver mais ${sugestoesSemanticas.length - 3} correspondências do catálogo PA (Top 10)`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PAINEL 4: Contêineres Recursivos (TODAS / QNT_MINIMA) com Bloqueio de Auto-Aninhamento (T025) */}
          {(operacao === 'TODAS' || operacao === 'QNT_MINIMA') && (
            <div
              style={{
                background: 'rgba(168, 85, 247, 0.03)',
                border: '1px solid rgba(168, 85, 247, 0.25)',
                borderRadius: '14px',
                padding: '1.25rem',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.88rem', color: '#c084fc', fontWeight: 800 }}>
                  {operacao === 'TODAS' ? 'Contêiner E (AND) — Todas as Condições Abaixo' : 'Contêiner OU (Mínimo N)'}
                </span>

                {operacao === 'QNT_MINIMA' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: '#aaa' }}>Quantidade Mínima:</span>
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, subRegras.length)}
                      value={quantidadeMinima}
                      onChange={(e) => setQuantidadeMinima(Number(e.target.value) || 1)}
                      style={{
                        width: '60px',
                        background: 'rgba(0, 0, 0, 0.6)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#fff',
                        borderRadius: '6px',
                        padding: '0.25rem 0.45rem',
                        fontSize: '0.85rem',
                        textAlign: 'center',
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Sub-regras configuradas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                {subRegras.length === 0 && (
                  <span style={{ fontSize: '0.8rem', color: '#888', fontStyle: 'italic' }}>
                    Nenhum sub-bloco configurado. Adicione sub-regras abaixo.
                  </span>
                )}
                {subRegras.map((sub, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(0, 0, 0, 0.45)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      padding: '0.75rem 1rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          color: '#c084fc',
                          background: 'rgba(168, 85, 247, 0.15)',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontWeight: 700,
                          marginRight: '0.5rem',
                        }}
                      >
                        Sub-Bloco #{idx + 1}: {sub.tipo}
                      </span>
                      <span style={{ fontSize: '0.85rem', color: '#ddd' }}>
                        {gerarDescricaoOrigem(sub)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoverSubRegra(idx)}
                      title="Remover sub-bloco"
                      style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#ef4444',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '6px',
                        padding: '0.25rem 0.55rem',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      Remover ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* Seletor para adicionar nova sub-regra com bloqueio estrito de auto-aninhamento */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select
                  className="scout-select"
                  value={novoSubTipo}
                  onChange={(e) => setNovoSubTipo(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'rgba(0, 0, 0, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#fff',
                    borderRadius: '8px',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="">Adicionar Sub-Regra ao Contêiner...</option>
                  <option value="PROGRESSOES">Atividade PA (PROGRESSOES)</option>
                  <option value="ESPECIALIDADE">Especialidade PA (ESPECIALIDADE)</option>
                  <option value="SEMANTICO">Correspondência Semântica (SEMANTICO)</option>
                  {/* Bloqueio de auto-aninhamento (T025): TODAS não pode conter TODAS; QNT_MINIMA não pode conter QNT_MINIMA */}
                  {operacao !== 'TODAS' && (
                    <option value="TODAS">Sub-Contêiner E (TODAS)</option>
                  )}
                  {operacao !== 'QNT_MINIMA' && (
                    <option value="QNT_MINIMA">Sub-Contêiner OU (QNT_MINIMA)</option>
                  )}
                </select>

                <button
                  type="button"
                  onClick={() => handleAdicionarSubRegra(novoSubTipo)}
                  disabled={!novoSubTipo}
                  style={{
                    background: 'rgba(168, 85, 247, 0.2)',
                    color: '#c084fc',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    borderRadius: '8px',
                    padding: '0.5rem 1rem',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: novoSubTipo ? 'pointer' : 'not-allowed',
                    whiteSpace: 'nowrap',
                  }}
                >
                  + Adicionar Bloco
                </button>
              </div>
            </div>
          )}

          {/* Descrição legível da fórmula */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', color: '#aaa', marginBottom: '0.4rem', fontWeight: 700 }}>
              Descrição da Fórmula (Gerada automaticamente se deixada em branco)
            </label>
            <input
              type="text"
              className="scout-select"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex: Pistas 01 ou Rumo 14"
              style={{
                background: 'rgba(0, 0, 0, 0.55)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#fff',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                width: '100%',
                fontSize: '0.9rem',
              }}
            />
          </div>

          {/* Validação manual */}
          <div style={{ marginBottom: '1.75rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <input
              type="checkbox"
              id="fl_modal_validacao_manual"
              checked={validacaoManual}
              onChange={(e) => setValidacaoManual(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#00ff88' }}
            />
            <label htmlFor="fl_modal_validacao_manual" style={{ fontSize: '0.88rem', color: '#e2e8f0', cursor: 'pointer' }}>
              Requer validação manual do chefe
            </label>
          </div>

          {success && (
            <div style={{ color: '#00ff88', marginBottom: '1rem', fontSize: '0.9rem', fontWeight: 700 }}>
              ✓ {success}
            </div>
          )}
          {error && (
            <div style={{ color: '#ff4d4d', marginBottom: '1rem', fontSize: '0.9rem', fontWeight: 700 }}>
              ✕ {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#aaa',
                padding: '0.65rem 1.35rem',
                borderRadius: '10px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                background: 'linear-gradient(135deg, #00ff88, #10b981)',
                color: '#000',
                border: 'none',
                padding: '0.65rem 1.65rem',
                borderRadius: '10px',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontWeight: 800,
                fontSize: '0.92rem',
                boxShadow: '0 4px 14px rgba(0, 255, 136, 0.3)',
              }}
            >
              {saving ? 'Salvando...' : 'Salvar Regra'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
