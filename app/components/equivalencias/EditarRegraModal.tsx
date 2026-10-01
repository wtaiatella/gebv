'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { PaAtividade } from './RegrasEquivalenciaView';
import {
  validarDetalhesRegra,
  gerarDescricaoOrigem,
  MAX_PROFUNDIDADE_REGRA,
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

type NoRegra = any;

type CtxEditor = {
  paAtividades: PaAtividade[];
  especialidadesCatalogo: Array<{ cd_especialidade: string; ds_especialidade: string }>;
  sugestoes: SugestaoSemantica[];
  loadingSemantico: boolean;
  avisoSemantico: string | null;
};

type TipoNo = 'PROGRESSOES' | 'ESPECIALIDADE' | 'SEMANTICO' | 'TODAS' | 'QNT_MINIMA' | 'SEM_EQUIVALENCIA';

function novoNo(tipo: string): NoRegra {
  switch (tipo) {
    case 'PROGRESSOES':
      return { tipo, item: { pa_atividade_id: 0, identificacao: '', ds_atividade: '' } };
    case 'ESPECIALIDADE':
      return { tipo, nm_especialidade: '', nivel_minimo: 1 };
    case 'SEMANTICO':
      return { tipo, logica: 'OR', itens: [] };
    case 'TODAS':
      return { tipo, blocos: [] };
    case 'QNT_MINIMA':
      return { tipo, quantidade_minima: 1, blocos: [] };
    default:
      return { tipo: 'SEM_EQUIVALENCIA' };
  }
}

// Converte o formato legado achatado (colunas antigas) em árvore recursiva editável.
function converterLegado(regra: RegraParaEditar): NoRegra | null {
  const pistas = regra.origem_pistas_ueb || [];
  const rumos = regra.origem_rumo_ueb || [];
  const esps = regra.origem_especialidades || [];
  const nivel = regra.nivel_min_especialidade || 1;
  const folhas: NoRegra[] = [
    ...pistas.map((p) => ({ tipo: 'PROGRESSOES', item: { pa_atividade_id: 0, identificacao: `PT-${p}`, ds_atividade: '' } })),
    ...rumos.map((r) => ({ tipo: 'PROGRESSOES', item: { pa_atividade_id: 0, identificacao: `RT-${r}`, ds_atividade: '' } })),
    ...esps.map((e) => ({ tipo: 'ESPECIALIDADE', nm_especialidade: e, nivel_minimo: nivel })),
  ];
  if (folhas.length === 0) return null;
  if (folhas.length === 1) return folhas[0];
  return { tipo: 'QNT_MINIMA', quantidade_minima: regra.min_count || 1, blocos: folhas };
}

// Verificações de completude do editor (além da validação estrutural canônica).
function validarCompletude(no: NoRegra, caminho = 'Regra'): string | null {
  if (!no) return `${caminho}: regra vazia.`;
  switch (no.tipo) {
    case 'PROGRESSOES':
      return no.item?.pa_atividade_id > 0 ? null : `${caminho}: selecione a atividade do Programa Antigo.`;
    case 'ESPECIALIDADE':
      return no.nm_especialidade ? null : `${caminho}: selecione a especialidade.`;
    case 'SEMANTICO':
      return Array.isArray(no.itens) && no.itens.length > 0 ? null : `${caminho}: homologue ao menos um item semântico.`;
    case 'TODAS':
    case 'QNT_MINIMA': {
      if (!Array.isArray(no.blocos) || no.blocos.length === 0) return `${caminho}: adicione ao menos um sub-bloco.`;
      for (let i = 0; i < no.blocos.length; i++) {
        const err = validarCompletude(no.blocos[i], `Sub-bloco #${i + 1}`);
        if (err) return err;
      }
      return null;
    }
    default:
      return null;
  }
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.6)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  color: '#fff',
  borderRadius: '8px',
  padding: '0.5rem 0.75rem',
  fontSize: '0.85rem',
};

const TIPO_COR: Record<string, { fg: string; bg: string; border: string }> = {
  PROGRESSOES: { fg: '#00ff88', bg: 'rgba(0, 255, 136, 0.03)', border: 'rgba(0, 255, 136, 0.2)' },
  ESPECIALIDADE: { fg: '#eab308', bg: 'rgba(234, 179, 8, 0.03)', border: 'rgba(234, 179, 8, 0.25)' },
  SEMANTICO: { fg: '#38bdf8', bg: 'rgba(56, 189, 248, 0.03)', border: 'rgba(56, 189, 248, 0.25)' },
  TODAS: { fg: '#c084fc', bg: 'rgba(168, 85, 247, 0.03)', border: 'rgba(168, 85, 247, 0.25)' },
  QNT_MINIMA: { fg: '#c084fc', bg: 'rgba(168, 85, 247, 0.03)', border: 'rgba(168, 85, 247, 0.25)' },
};

function SeletorAtividadePa({
  paAtividades,
  onSelect,
}: {
  paAtividades: PaAtividade[];
  onSelect: (a: PaAtividade) => void;
}) {
  const [busca, setBusca] = useState('');
  const filtradas = useMemo(() => {
    if (!busca.trim()) return paAtividades.slice(0, 30);
    const q = busca.toLowerCase();
    return paAtividades
      .filter((a) => a.identificacao?.toLowerCase().includes(q) || a.ds_atividade?.toLowerCase().includes(q))
      .slice(0, 40);
  }, [paAtividades, busca]);

  return (
    <div>
      <input
        type="text"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Filtrar por código (ex: PT-12, RT-05) ou descrição..."
        style={{ ...inputStyle, width: '100%', marginBottom: '0.5rem' }}
      />
      <select
        className="scout-select"
        value=""
        onChange={(e) => {
          const ativ = paAtividades.find((a) => a.id === Number(e.target.value));
          if (ativ) {
            onSelect(ativ);
            setBusca('');
          }
        }}
        style={{ ...inputStyle, width: '100%' }}
      >
        <option value="">Selecione uma atividade da lista...</option>
        {filtradas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.identificacao}: {a.ds_atividade.slice(0, 80)}...
          </option>
        ))}
      </select>
    </div>
  );
}

function EditorSemantico({
  no,
  onChange,
  ctx,
  idUnico,
}: {
  no: NoRegra;
  onChange: (n: NoRegra) => void;
  ctx: CtxEditor;
  idUnico: string;
}) {
  const [expandido, setExpandido] = useState(false);
  const itens: any[] = no.itens || [];

  function homologar(sug: SugestaoSemantica) {
    if (itens.some((i) => i.pa_atividade_id === sug.pa_atividade_id)) return;
    onChange({
      ...no,
      itens: [
        ...itens,
        {
          pa_atividade_id: sug.pa_atividade_id,
          identificacao: sug.identificacao,
          ds_atividade: sug.ds_atividade,
          score_capturado: sug.score,
        },
      ],
    });
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 1.4fr)',
        gap: '1rem',
      }}
    >
      <div style={{ borderRight: '1px solid rgba(255, 255, 255, 0.08)', paddingRight: '1rem' }}>
        <div style={{ fontSize: '0.78rem', color: '#aaa', fontWeight: 700, marginBottom: '0.4rem' }}>
          Critério de Combinação
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {(['OR', 'AND'] as const).map((l) => (
            <label key={l} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.82rem' }}>
              <input
                type="radio"
                name={`semantico_logica_${idUnico}`}
                checked={(no.logica === 'AND' ? 'AND' : 'OR') === l}
                onChange={() => onChange({ ...no, logica: l })}
                style={{ accentColor: '#38bdf8' }}
              />
              {l === 'OR' ? 'Ao menos uma (OR)' : 'Todas (AND)'}
            </label>
          ))}
        </div>

        <div style={{ fontSize: '0.78rem', color: '#aaa', fontWeight: 700, marginBottom: '0.4rem' }}>
          Itens Homologados ({itens.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {itens.length === 0 && (
            <span style={{ fontSize: '0.78rem', color: '#666', fontStyle: 'italic' }}>
              Nenhum item homologado. Selecione no painel ao lado.
            </span>
          )}
          {itens.map((item) => (
            <div
              key={item.pa_atividade_id}
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                padding: '0.3rem 0.55rem',
                borderRadius: '6px',
                fontSize: '0.76rem',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '0.4rem',
              }}
            >
              <span>
                <strong>{item.identificacao}</strong>{' '}
                {item.score_capturado ? `(${Math.round(item.score_capturado * 100)}% match)` : ''}
                {item.ds_atividade && (
                  <span style={{ display: 'block', color: '#cbd5e1', marginTop: '0.15rem', lineHeight: 1.3 }}>
                    {item.ds_atividade}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onChange({ ...no, itens: itens.filter((i) => i.pa_atividade_id !== item.pa_atividade_id) })}
                style={{ background: 'transparent', color: '#38bdf8', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 800, padding: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: '0.78rem', color: '#aaa', fontWeight: 700, marginBottom: '0.4rem' }}>
          Sugestões Mais Próximas (Similaridade de Cosseno)
        </div>

        {ctx.loadingSemantico && (
          <div style={{ fontSize: '0.82rem', color: '#888', padding: '1rem 0' }}>Calculando similaridade vetorial...</div>
        )}
        {!ctx.loadingSemantico && ctx.sugestoes.length === 0 && (
          <div style={{ fontSize: '0.82rem', color: ctx.avisoSemantico ? '#eab308' : '#666', fontStyle: 'italic' }}>
            {ctx.avisoSemantico || 'Nenhuma correspondência encontrada.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {ctx.sugestoes.slice(0, expandido ? 10 : 3).map((sug, idx) => {
            const jaAdicionado = itens.some((i) => i.pa_atividade_id === sug.pa_atividade_id);
            const pct = Math.round(sug.score * 100);
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
                        color: pct >= 80 ? '#00ff88' : '#38bdf8',
                        background: 'rgba(255, 255, 255, 0.05)',
                        padding: '0.1rem 0.35rem',
                        borderRadius: '4px',
                        fontWeight: 700,
                      }}
                    >
                      {pct}% match
                    </span>
                  </div>
                  <p style={{ fontSize: '0.76rem', color: '#ccc', margin: '0.2rem 0 0', lineHeight: 1.3 }}>{sug.ds_atividade}</p>
                </div>
                <button
                  type="button"
                  onClick={() => homologar(sug)}
                  disabled={jaAdicionado}
                  style={{
                    background: jaAdicionado ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 255, 136, 0.15)',
                    color: jaAdicionado ? '#666' : '#00ff88',
                    border: jaAdicionado ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 255, 136, 0.35)',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    cursor: jaAdicionado ? 'default' : 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {jaAdicionado ? 'Adicionado' : '+ Homologar'}
                </button>
              </div>
            );
          })}
        </div>

        {ctx.sugestoes.length > 3 && (
          <button
            type="button"
            onClick={() => setExpandido(!expandido)}
            style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.78rem', cursor: 'pointer', padding: '0.5rem 0 0', fontWeight: 700, textAlign: 'left' }}
          >
            {expandido ? '▲ Ver apenas Top 3' : `▼ Ver mais ${ctx.sugestoes.length - 3} correspondências do catálogo PA (Top 10)`}
          </button>
        )}
      </div>
    </div>
  );
}

// Editor recursivo de um nó da árvore de regra: todo sub-bloco (PROGRESSOES, ESPECIALIDADE,
// SEMANTICO, TODAS, QNT_MINIMA) é configurável in-place, em qualquer profundidade.
function NoEditor({
  no,
  onChange,
  onRemove,
  ctx,
  depth,
  caminho,
  rotulo,
}: {
  no: NoRegra;
  onChange: (n: NoRegra) => void;
  onRemove?: () => void;
  ctx: CtxEditor;
  depth: number;
  caminho: string;
  rotulo?: string;
}) {
  const [novoSubTipo, setNovoSubTipo] = useState('');
  const cor = TIPO_COR[no.tipo] || TIPO_COR.PROGRESSOES;
  const ehContainer = no.tipo === 'TODAS' || no.tipo === 'QNT_MINIMA';
  const blocos: NoRegra[] = ehContainer ? no.blocos || [] : [];
  const podeAninharContainer = depth + 1 < MAX_PROFUNDIDADE_REGRA - 1;

  function adicionarSub() {
    if (!novoSubTipo) return;
    if (no.tipo === novoSubTipo) {
      alert(`Auto-aninhamento proibido: uma regra ${no.tipo} não pode conter outra regra ${no.tipo}.`);
      return;
    }
    onChange({ ...no, blocos: [...blocos, novoNo(novoSubTipo)] });
    setNovoSubTipo('');
  }

  const titulo =
    no.tipo === 'TODAS'
      ? 'Contêiner E (AND) — Todas as Condições Abaixo'
      : no.tipo === 'QNT_MINIMA'
      ? 'Contêiner OU (Mínimo N)'
      : no.tipo === 'PROGRESSOES'
      ? '◆ Atividade do Programa Antigo (Pista / Rumo)'
      : no.tipo === 'ESPECIALIDADE'
      ? '★ Especialidade do Programa Antigo no Nível Mínimo'
      : '🧠 Correspondência Semântica Vetorial (BAAI/bge-m3)';

  return (
    <div
      style={{
        background: cor.bg,
        border: `1px solid ${cor.border}`,
        borderRadius: '12px',
        padding: '1rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.85rem', color: cor.fg, fontWeight: 800 }}>
          {rotulo && (
            <span style={{ fontSize: '0.72rem', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', padding: '0.15rem 0.45rem', borderRadius: '4px', marginRight: '0.5rem' }}>
              {rotulo}
            </span>
          )}
          {titulo}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {no.tipo === 'QNT_MINIMA' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#aaa' }}>Quantidade Mínima:</span>
              <input
                type="number"
                min="1"
                max={Math.max(1, blocos.length)}
                value={no.quantidade_minima ?? 1}
                onChange={(e) => onChange({ ...no, quantidade_minima: Number(e.target.value) || 1 })}
                style={{ ...inputStyle, width: '60px', padding: '0.25rem 0.45rem', textAlign: 'center' }}
              />
            </div>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              title="Remover sub-bloco"
              style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              Remover ✕
            </button>
          )}
        </div>
      </div>

      {no.tipo === 'PROGRESSOES' &&
        (no.item?.pa_atividade_id > 0 ? (
          <div
            style={{
              background: 'rgba(0, 255, 136, 0.12)',
              color: '#00ff88',
              border: '1px solid rgba(0, 255, 136, 0.4)',
              padding: '0.4rem 0.75rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.5rem',
            }}
          >
            <span>
              <strong>{no.item.identificacao}</strong>
              {no.item.ds_atividade ? ` — ${no.item.ds_atividade}` : ''}
            </span>
            <button
              type="button"
              onClick={() => onChange({ ...no, item: { pa_atividade_id: 0, identificacao: '', ds_atividade: '' } })}
              title="Trocar atividade"
              style={{ background: 'transparent', color: '#00ff88', border: 'none', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 800 }}
            >
              ✕
            </button>
          </div>
        ) : (
          <SeletorAtividadePa
            paAtividades={ctx.paAtividades}
            onSelect={(a) =>
              onChange({
                ...no,
                item: { pa_atividade_id: a.id, identificacao: a.identificacao || `PT-${a.id}`, ds_atividade: a.ds_atividade || '' },
              })
            }
          />
        ))}

      {no.tipo === 'ESPECIALIDADE' && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ width: '130px' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#aaa', marginBottom: '0.3rem' }}>Nível Mínimo</label>
            <select
              className="scout-select"
              value={no.nivel_minimo || 1}
              onChange={(e) => onChange({ ...no, nivel_minimo: Number(e.target.value) || 1 })}
              style={{ ...inputStyle, width: '100%' }}
            >
              <option value={1}>Nível 1+</option>
              <option value={2}>Nível 2+</option>
              <option value={3}>Nível 3</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#aaa', marginBottom: '0.3rem' }}>Especialidade PA</label>
            <select
              className="scout-select"
              value={no.nm_especialidade || ''}
              onChange={(e) => onChange({ ...no, nm_especialidade: e.target.value })}
              style={{ ...inputStyle, width: '100%' }}
            >
              <option value="">Selecione uma especialidade...</option>
              {no.nm_especialidade && !ctx.especialidadesCatalogo.some((e) => e.ds_especialidade === no.nm_especialidade) && (
                <option value={no.nm_especialidade}>{no.nm_especialidade}</option>
              )}
              {ctx.especialidadesCatalogo.map((esp) => (
                <option key={esp.cd_especialidade} value={esp.ds_especialidade}>
                  {esp.ds_especialidade}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {no.tipo === 'SEMANTICO' && <EditorSemantico no={no} onChange={onChange} ctx={ctx} idUnico={caminho} />}

      {ehContainer && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            {blocos.length === 0 && (
              <span style={{ fontSize: '0.8rem', color: '#888', fontStyle: 'italic' }}>
                Nenhum sub-bloco configurado. Adicione sub-regras abaixo.
              </span>
            )}
            {blocos.map((sub, idx) => (
              <NoEditor
                key={idx}
                no={sub}
                depth={depth + 1}
                caminho={`${caminho}_${idx}`}
                rotulo={`Sub-Bloco #${idx + 1}: ${sub.tipo}`}
                ctx={ctx}
                onChange={(n) => onChange({ ...no, blocos: blocos.map((b, i) => (i === idx ? n : b)) })}
                onRemove={() => onChange({ ...no, blocos: blocos.filter((_, i) => i !== idx) })}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select
              className="scout-select"
              value={novoSubTipo}
              onChange={(e) => setNovoSubTipo(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            >
              <option value="">Adicionar Sub-Regra ao Contêiner...</option>
              <option value="PROGRESSOES">Atividade PA (PROGRESSOES)</option>
              <option value="ESPECIALIDADE">Especialidade PA (ESPECIALIDADE)</option>
              <option value="SEMANTICO">Correspondência Semântica (SEMANTICO)</option>
              {/* Bloqueio de auto-aninhamento: TODAS não contém TODAS; QNT_MINIMA não contém QNT_MINIMA */}
              {podeAninharContainer && no.tipo !== 'TODAS' && <option value="TODAS">Sub-Contêiner E (TODAS)</option>}
              {podeAninharContainer && no.tipo !== 'QNT_MINIMA' && <option value="QNT_MINIMA">Sub-Contêiner OU (QNT_MINIMA)</option>}
            </select>
            <button
              type="button"
              onClick={adicionarSub}
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
        </>
      )}
    </div>
  );
}

export default function EditarRegraModal({
  regra,
  isOpen,
  onClose,
  onSaveSuccess,
  ramoAtual = 'Escoteiro',
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [arvore, setArvore] = useState<NoRegra>({ tipo: 'SEM_EQUIVALENCIA' });
  const [descricao, setDescricao] = useState('');
  const [descricaoEditada, setDescricaoEditada] = useState(false);
  const [validacaoManual, setValidacaoManual] = useState<boolean>(false);

  // Catálogos auxiliares
  const [paAtividades, setPaAtividades] = useState<PaAtividade[]>([]);
  const [especialidadesCatalogo, setEspecialidadesCatalogo] = useState<Array<{ cd_especialidade: string; ds_especialidade: string }>>([]);

  // Sugestões do motor semântico (compartilhadas por todos os nós SEMANTICO da regra)
  const [sugestoesSemanticas, setSugestoesSemanticas] = useState<SugestaoSemantica[]>([]);
  const [loadingSemantico, setLoadingSemantico] = useState(false);
  const [avisoSemantico, setAvisoSemantico] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const operacao: TipoNo = arvore?.tipo || 'SEM_EQUIVALENCIA';

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
    if (!(isOpen && regra?.acao_pn_id)) return;
    let cancelado = false;
    setSugestoesSemanticas([]);
    setAvisoSemantico(null);
    setLoadingSemantico(true);
    fetch(`/api/progressoes/semantico?acao_pn_id=${regra.acao_pn_id}&ramo=${ramoAtual}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelado) return;
        if (data.success && Array.isArray(data.sugestoes)) {
          setSugestoesSemanticas(data.sugestoes);
          setAvisoSemantico(data.aviso || null);
        } else {
          setAvisoSemantico(data.error || 'Não foi possível calcular as correspondências semânticas.');
        }
      })
      .catch(() => {
        if (!cancelado) setAvisoSemantico('Falha de rede ao buscar correspondências semânticas.');
      })
      .finally(() => {
        if (!cancelado) setLoadingSemantico(false);
      });
    return () => {
      cancelado = true;
    };
  }, [isOpen, regra?.acao_pn_id, ramoAtual]);

  // Sincroniza dados da regra ao abrir — substitui TODO o estado do editor (sem resíduo de regra anterior)
  useEffect(() => {
    if (!regra) return;
    setError(null);
    setSuccess(null);
    setDescricao(regra.descricao_origem || '');
    setDescricaoEditada(false);
    setValidacaoManual(Boolean(regra.fl_requer_validacao_manual));

    const d = regra.detalhes_regra;
    let tree: NoRegra;
    if (d && typeof d === 'object' && d.tipo) {
      tree = JSON.parse(JSON.stringify(d));
    } else {
      tree = converterLegado(regra) || { tipo: 'SEM_EQUIVALENCIA' };
    }
    setArvore(tree);
  }, [regra]);

  function trocarOperacao(op: TipoNo) {
    if (op === arvore.tipo) return;
    const atualEhContainer = arvore.tipo === 'TODAS' || arvore.tipo === 'QNT_MINIMA';
    const novoEhContainer = op === 'TODAS' || op === 'QNT_MINIMA';
    if (atualEhContainer && novoEhContainer) {
      // TODAS <-> QNT_MINIMA preserva os sub-blocos
      setArvore(op === 'QNT_MINIMA' ? { tipo: op, quantidade_minima: 1, blocos: arvore.blocos || [] } : { tipo: op, blocos: arvore.blocos || [] });
    } else {
      setArvore(novoNo(op));
    }
  }

  const ctx: CtxEditor = { paAtividades, especialidadesCatalogo, sugestoes: sugestoesSemanticas, loadingSemantico, avisoSemantico };
  const descricaoGerada = useMemo(() => gerarDescricaoOrigem(arvore, arvore?.tipo), [arvore]);

  // Submissão do formulário com validação canônica
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!regra) return;

    const incompleto = validarCompletude(arvore);
    if (incompleto) {
      setError(incompleto);
      return;
    }

    // Validação estrita contra auto-aninhamento e coerência de nós
    const validacao = validarDetalhesRegra(arvore);
    if (!validacao.valido) {
      setError(validacao.erro || 'A regra configurada é inválida.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Descrição não editada manualmente é sempre regenerada a partir da fórmula atual
      const descricaoFinal = descricaoEditada && descricao.trim() ? descricao.trim() : descricaoGerada;

      const payload = {
        operacao,
        detalhes_regra: arvore,
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
          maxWidth: '900px',
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
            style={{ background: 'transparent', color: '#888', border: 'none', fontSize: '1.6rem', padding: '0.2rem 0.6rem', boxShadow: 'none', cursor: 'pointer', lineHeight: 1 }}
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
          <div style={{ fontSize: '0.95rem', color: '#f1f5f9', lineHeight: 1.5, fontWeight: 500 }}>{regra.ds_acao}</div>
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
              onChange={(e) => trocarOperacao(e.target.value as TipoNo)}
              required
              style={{ ...inputStyle, background: 'rgba(0, 0, 0, 0.55)', borderRadius: '10px', padding: '0.65rem 0.85rem', width: '100%', fontSize: '0.9rem' }}
            >
              <option value="PROGRESSOES">PROGRESSOES (Item único de atividade do Programa Antigo)</option>
              <option value="ESPECIALIDADE">ESPECIALIDADE (Especialidade do PA em nível mínimo)</option>
              <option value="SEMANTICO">SEMANTICO (Busca vetorial BAAI/bge-m3 com correspondências Top 10)</option>
              <option value="TODAS">TODAS (Contêiner E / AND — cumprir todos os blocos)</option>
              <option value="QNT_MINIMA">QNT_MINIMA (Contêiner OU / Mínimo N — cumprir quantidade mínima)</option>
              <option value="SEM_EQUIVALENCIA">SEM_EQUIVALENCIA (Sem equivalência histórica de PA)</option>
            </select>
          </div>

          {operacao !== 'SEM_EQUIVALENCIA' && (
            <div style={{ marginBottom: '1.25rem' }}>
              <NoEditor no={arvore} onChange={setArvore} ctx={ctx} depth={0} caminho="raiz" />
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
              value={descricaoEditada ? descricao : descricaoGerada}
              onChange={(e) => {
                setDescricao(e.target.value);
                setDescricaoEditada(true);
              }}
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
