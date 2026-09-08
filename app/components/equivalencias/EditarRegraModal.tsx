'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { PaAtividade } from './RegrasEquivalenciaView';

export type RegraParaEditar = {
  id: number; // pn_equivalencia_regras id
  acao_pn_id: number;
  ds_acao: string;
  nm_bloco?: string;
  nr_ordem_acao?: number;
  operacao: 'DIRETA' | 'OR' | 'MIN_COUNT' | 'ESPECIALIDADES' | 'SEM_EQUIVALENCIA' | string;
  descricao_origem: string;
  origem_pistas_ueb: string[];
  origem_rumo_ueb: string[];
  origem_especialidades: string[];
  nivel_min_especialidade: number;
  min_count: number;
  fl_requer_validacao_manual?: boolean;
};

type Props = {
  regra: RegraParaEditar | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess: () => void;
  ramoAtual?: string;
};

export default function EditarRegraModal({
  regra,
  isOpen,
  onClose,
  onSaveSuccess,
  ramoAtual = 'Escoteiro',
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [operacao, setOperacao] = useState<'DIRETA' | 'OR' | 'MIN_COUNT' | 'ESPECIALIDADES' | 'SEM_EQUIVALENCIA'>('DIRETA');
  const [descricao, setDescricao] = useState('');
  const [pistas, setPistas] = useState<string[]>([]);
  const [rumo, setRumo] = useState<string[]>([]);
  const [especialidades, setEspecialidades] = useState<string[]>([]);
  const [nivelEsp, setNivelEsp] = useState<number>(1);
  const [minCount, setMinCount] = useState<number>(1);
  const [validacaoManual, setValidacaoManual] = useState<boolean>(false);

  const [paAtividades, setPaAtividades] = useState<PaAtividade[]>([]);
  const [especialidadesCatalogo, setEspecialidadesCatalogo] = useState<Array<{ cd_especialidade: string; ds_especialidade: string }>>([]);
  const [novaEsp, setNovaEsp] = useState('');
  const [novoItemPista, setNovoItemPista] = useState('');
  const [novoItemRumo, setNovoItemRumo] = useState('');

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

  // Carrega catálogo de atividades PA e especialidades oficiais do PA
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

  // Sincroniza dados da regra ao abrir
  useEffect(() => {
    if (regra) {
      setOperacao((regra.operacao as any) || 'DIRETA');
      setDescricao(regra.descricao_origem || '');
      setPistas([...(regra.origem_pistas_ueb || [])]);
      setRumo([...(regra.origem_rumo_ueb || [])]);
      setEspecialidades([...(regra.origem_especialidades || [])]);
      setNivelEsp(regra.nivel_min_especialidade || 1);
      setMinCount(regra.min_count || 1);
      setValidacaoManual(Boolean(regra.fl_requer_validacao_manual));
      setError(null);
      setSuccess(null);
      setNovaEsp('');
      setNovoItemPista('');
      setNovoItemRumo('');
    }
  }, [regra]);

  if (!isOpen || !regra || !mounted) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!regra) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        operacao,
        descricao_origem: descricao,
        origem_pistas_ueb: operacao === 'SEM_EQUIVALENCIA' || operacao === 'ESPECIALIDADES' ? [] : pistas,
        origem_rumo_ueb: operacao === 'SEM_EQUIVALENCIA' || operacao === 'ESPECIALIDADES' ? [] : rumo,
        origem_especialidades: operacao === 'SEM_EQUIVALENCIA' ? [] : especialidades,
        nivel_min_especialidade: nivelEsp,
        min_count: operacao === 'MIN_COUNT' || operacao === 'OR' ? minCount : 1,
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

  function addPista(code: string) {
    const trimmed = code.trim().toUpperCase();
    if (trimmed && !pistas.includes(trimmed)) {
      setPistas([...pistas, trimmed]);
      setNovoItemPista('');
    }
  }

  function removePista(code: string) {
    setPistas(pistas.filter((p) => p !== code));
  }

  function addRumo(code: string) {
    const trimmed = code.trim().toUpperCase();
    if (trimmed && !rumo.includes(trimmed)) {
      setRumo([...rumo, trimmed]);
      setNovoItemRumo('');
    }
  }

  function removeRumo(code: string) {
    setRumo(rumo.filter((r) => r !== code));
  }

  function addEspecialidade(name: string) {
    const trimmed = name.trim();
    if (trimmed && !especialidades.includes(trimmed)) {
      setEspecialidades([...especialidades, trimmed]);
      setNovaEsp('');
    }
  }

  function removeEspecialidade(name: string) {
    setEspecialidades(especialidades.filter((e) => e !== name));
  }

  const showPistasRumo = operacao !== 'SEM_EQUIVALENCIA' && operacao !== 'ESPECIALIDADES';
  const showEspecialidades = operacao !== 'SEM_EQUIVALENCIA';

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
          maxWidth: '740px',
          width: '100%',
          maxHeight: '90vh',
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
          {/* Operação */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', color: '#aaa', marginBottom: '0.4rem', fontWeight: 700 }}>
              Operação de Equivalência
            </label>
            <select
              className="scout-select"
              value={operacao}
              onChange={(e) => setOperacao(e.target.value as any)}
              required
              style={{
                background: 'rgba(0, 0, 0, 0.55)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#fff',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                width: '100%',
                fontSize: '0.9rem',
              }}
            >
              <option value="DIRETA">DIRETA (Equivalência direta 1:1)</option>
              <option value="OR">OR (Qualquer um dos itens listados: Pistas, Rumo ou Especialidades)</option>
              <option value="MIN_COUNT">MIN_COUNT (Quantidade mínima N de itens)</option>
              <option value="ESPECIALIDADES">ESPECIALIDADES (Apenas especialidades em determinado nível)</option>
              <option value="SEM_EQUIVALENCIA">SEM_EQUIVALENCIA (Sem relação com o modelo antigo)</option>
            </select>
          </div>

          {/* Descrição legível */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', color: '#aaa', marginBottom: '0.4rem', fontWeight: 700 }}>
              Descrição da Regra / Fórmula (Texto Explicativo)
            </label>
            <input
              type="text"
              className="scout-select"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex: Pistas 01 ou Rumo 14"
              required
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

          {/* Quantidade Mínima (se MIN_COUNT ou OR) */}
          {(operacao === 'MIN_COUNT' || operacao === 'OR') && (
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', color: '#aaa', marginBottom: '0.4rem', fontWeight: 700 }}>
                Quantidade mínima exigida (min_count)
              </label>
              <input
                type="number"
                min="1"
                max="20"
                className="scout-select"
                value={minCount}
                onChange={(e) => setMinCount(parseInt(e.target.value, 10) || 1)}
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
          )}

          {/* Itens Pistas */}
          {showPistasRumo && (
            <div
              style={{
                background: 'rgba(0, 255, 136, 0.03)',
                border: '1px solid rgba(0, 255, 136, 0.2)',
                borderRadius: '14px',
                padding: '1.15rem',
                marginBottom: '1.25rem',
              }}
            >
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#00ff88', marginBottom: '0.5rem', fontWeight: 800 }}>
                ◆ Itens de Pistas (Programa Antigo)
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <select
                  className="scout-select"
                  value={novoItemPista}
                  onChange={(e) => setNovoItemPista(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'rgba(0, 0, 0, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#fff',
                    borderRadius: '10px',
                    padding: '0.6rem 0.85rem',
                    fontSize: '0.88rem',
                  }}
                >
                  <option value="">Selecionar item de Pistas do catálogo...</option>
                  {paAtividades
                    .filter((a) => a.cd_caminho_paxtu === 'PISTA' || a.cd_caminho_paxtu === '5')
                    .map((a) => (
                      <option key={a.id} value={a.cd_ueb}>
                        {a.identificacao || `PT-${a.cd_ueb}`}: {a.ds_atividade.slice(0, 75)}...
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => addPista(novoItemPista)}
                  disabled={!novoItemPista}
                  style={{
                    padding: '0.6rem 1.15rem',
                    fontSize: '0.88rem',
                    background: 'rgba(0, 255, 136, 0.15)',
                    color: '#00ff88',
                    border: '1px solid rgba(0, 255, 136, 0.4)',
                    borderRadius: '10px',
                    cursor: novoItemPista ? 'pointer' : 'not-allowed',
                    fontWeight: 700,
                  }}
                >
                  Adicionar
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {pistas.length === 0 && (
                  <span style={{ color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>Nenhum item de pista vinculado</span>
                )}
                {pistas.map((p) => {
                  const a = paAtividades.find((x) => (x.cd_caminho_paxtu === '5' || x.cd_caminho_paxtu === 'PISTA') && x.cd_ueb === p);
                  const label = a?.identificacao || `PT-${p}`;
                  return (
                    <span
                      key={p}
                      style={{
                        background: 'rgba(0, 255, 136, 0.18)',
                        color: '#00ff88',
                        fontSize: '0.78rem',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '6px',
                        border: '1px solid rgba(0, 255, 136, 0.4)',
                        fontFamily: 'monospace',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      {label}
                      <button
                        type="button"
                        onClick={() => removePista(p)}
                        style={{
                          background: 'transparent',
                          color: '#00ff88',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          boxShadow: 'none',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Itens Rumo */}
          {showPistasRumo && (
            <div
              style={{
                background: 'rgba(0, 255, 136, 0.03)',
                border: '1px solid rgba(0, 255, 136, 0.2)',
                borderRadius: '14px',
                padding: '1.15rem',
                marginBottom: '1.25rem',
              }}
            >
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#00ff88', marginBottom: '0.5rem', fontWeight: 800 }}>
                ◆ Itens de Rumo (Programa Antigo)
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <select
                  className="scout-select"
                  value={novoItemRumo}
                  onChange={(e) => setNovoItemRumo(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'rgba(0, 0, 0, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#fff',
                    borderRadius: '10px',
                    padding: '0.6rem 0.85rem',
                    fontSize: '0.88rem',
                  }}
                >
                  <option value="">Selecionar item de Rumo do catálogo...</option>
                  {paAtividades
                    .filter((a) => a.cd_caminho_paxtu === 'TRAVESSIA' || a.cd_caminho_paxtu === 'RUMO' || a.cd_caminho_paxtu === '6')
                    .map((a) => (
                      <option key={a.id} value={a.cd_ueb}>
                        {a.identificacao || `RT-${a.cd_ueb}`}: {a.ds_atividade.slice(0, 75)}...
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => addRumo(novoItemRumo)}
                  disabled={!novoItemRumo}
                  style={{
                    padding: '0.6rem 1.15rem',
                    fontSize: '0.88rem',
                    background: 'rgba(0, 255, 136, 0.15)',
                    color: '#00ff88',
                    border: '1px solid rgba(0, 255, 136, 0.4)',
                    borderRadius: '10px',
                    cursor: novoItemRumo ? 'pointer' : 'not-allowed',
                    fontWeight: 700,
                  }}
                >
                  Adicionar
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {rumo.length === 0 && (
                  <span style={{ color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>Nenhum item de rumo vinculado</span>
                )}
                {rumo.map((r) => {
                  const a = paAtividades.find((x) => (x.cd_caminho_paxtu === '6' || x.cd_caminho_paxtu === 'RUMO' || x.cd_caminho_paxtu === 'TRAVESSIA') && x.cd_ueb === r);
                  const label = a?.identificacao || `RT-${r}`;
                  return (
                    <span
                      key={r}
                      style={{
                        background: 'rgba(0, 255, 136, 0.18)',
                        color: '#00ff88',
                        fontSize: '0.78rem',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '6px',
                        border: '1px solid rgba(0, 255, 136, 0.4)',
                        fontFamily: 'monospace',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      {label}
                      <button
                        type="button"
                        onClick={() => removeRumo(r)}
                        style={{
                          background: 'transparent',
                          color: '#00ff88',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          boxShadow: 'none',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Especialidades do Programa Antigo */}
          {showEspecialidades && (
            <div
              style={{
                background: 'rgba(234, 179, 8, 0.03)',
                border: '1px dashed rgba(234, 179, 8, 0.25)',
                borderRadius: '14px',
                padding: '1.15rem',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ width: '130px' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', color: '#eab308', marginBottom: '0.4rem', fontWeight: 800 }}>
                    Nível Mínimo
                  </label>
                  <select
                    className="scout-select"
                    value={nivelEsp}
                    onChange={(e) => setNivelEsp(parseInt(e.target.value, 10) || 1)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#fff',
                      borderRadius: '10px',
                      padding: '0.6rem 0.85rem',
                      width: '100%',
                      fontSize: '0.88rem',
                    }}
                  >
                    <option value={1}>Nível 1</option>
                    <option value={2}>Nível 2</option>
                    <option value={3}>Nível 3</option>
                  </select>
                </div>

                <div style={{ flex: 1, minWidth: '240px' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', color: '#eab308', marginBottom: '0.4rem', fontWeight: 800 }}>
                    ★ Especialidades do Programa Antigo
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <select
                      className="scout-select"
                      value={novaEsp}
                      onChange={(e) => setNovaEsp(e.target.value)}
                      style={{
                        flex: 1,
                        background: 'rgba(0, 0, 0, 0.6)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                        borderRadius: '10px',
                        padding: '0.6rem 0.85rem',
                        fontSize: '0.88rem',
                      }}
                    >
                      <option value="">Selecionar especialidade da tabela do Programa Antigo...</option>
                      {especialidadesCatalogo.map((esp) => (
                        <option key={esp.cd_especialidade} value={esp.ds_especialidade}>
                          {esp.ds_especialidade}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => addEspecialidade(novaEsp)}
                      disabled={!novaEsp}
                      style={{
                        padding: '0.6rem 1.15rem',
                        fontSize: '0.88rem',
                        background: 'rgba(234, 179, 8, 0.15)',
                        color: '#eab308',
                        border: '1px solid rgba(234, 179, 8, 0.4)',
                        borderRadius: '10px',
                        cursor: novaEsp ? 'pointer' : 'not-allowed',
                        fontWeight: 700,
                      }}
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#888', marginBottom: '0.4rem' }}>
                  Especialidades vinculadas ({especialidades.length}):
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {especialidades.length === 0 && (
                    <span style={{ color: '#666', fontSize: '0.8rem', fontStyle: 'italic' }}>Nenhuma especialidade vinculada</span>
                  )}
                  {especialidades.map((esp) => (
                    <span
                      key={esp}
                      style={{
                        background: 'rgba(234, 179, 8, 0.15)',
                        color: '#eab308',
                        fontSize: '0.78rem',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '6px',
                        border: '1px solid rgba(234, 179, 8, 0.3)',
                        fontFamily: 'monospace',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      ★ {esp} (N{nivelEsp}+)
                      <button
                        type="button"
                        onClick={() => removeEspecialidade(esp)}
                        style={{
                          background: 'transparent',
                          color: '#eab308',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          boxShadow: 'none',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

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
