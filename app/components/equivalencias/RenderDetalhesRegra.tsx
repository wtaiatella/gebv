'use client';

import React from 'react';

export type RenderDetalhesRegraProps = {
  detalhes: any;
  conquistados?: string[];
  depth?: number;
};

const MAX_PROFUNDIDADE_RENDER_REGRA = 8;

/**
 * Item folha da árvore de detalhes_regra:
 * - Em modo jovem (conquistados definido): badge com status de conquista (✓ verde / ✗ cinza) e descrição ao lado.
 * - Em modo matriz geral (conquistados undefined): badge temático limpo (• ou ★) com cores de categoria e descrição ao lado.
 */
export function BadgeItemRegra({
  label,
  conquistado,
  title,
  descricao,
}: {
  label: string;
  conquistado?: boolean;
  title?: string;
  descricao?: string;
}) {
  const isMatrix = conquistado === undefined;

  const isPista = label.startsWith('PT-') || label.startsWith('PIL-') || label.startsWith('PTS-');
  const isRumo = label.startsWith('RT-') || label.startsWith('RC-');
  const isEca = label.startsWith('ECA-');
  const isEsp = title?.toLowerCase().includes('especialidade') || label.includes('N1+') || label.includes('N2+');

  let bg = 'rgba(255, 255, 255, 0.05)';
  let color = '#a1a1aa';
  let border = 'rgba(255, 255, 255, 0.12)';
  let symbol: string = '•';

  if (!isMatrix) {
    if (conquistado) {
      bg = 'rgba(0, 255, 136, 0.18)';
      color = '#00ff88';
      border = 'rgba(0, 255, 136, 0.4)';
      symbol = '✓';
    } else {
      bg = 'rgba(255, 255, 255, 0.05)';
      color = '#888';
      border = 'rgba(255, 255, 255, 0.1)';
      symbol = '✗';
    }
  } else {
    // Modo Matriz Geral de Equivalência
    if (isEsp) {
      bg = 'rgba(234, 179, 8, 0.15)';
      color = '#eab308';
      border = 'rgba(234, 179, 8, 0.35)';
      symbol = '★';
    } else if (isPista || isEca) {
      bg = 'rgba(56, 189, 248, 0.15)';
      color = '#38bdf8';
      border = 'rgba(56, 189, 248, 0.35)';
      symbol = '•';
    } else if (isRumo) {
      bg = 'rgba(168, 85, 247, 0.15)';
      color = '#c084fc';
      border = 'rgba(168, 85, 247, 0.35)';
      symbol = '•';
    } else {
      bg = 'rgba(255, 255, 255, 0.08)';
      color = '#d4d4d8';
      border = 'rgba(255, 255, 255, 0.15)';
      symbol = '•';
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', maxWidth: '100%' }}>
      <span
        title={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          flexShrink: 0,
          background: bg,
          color: color,
          border: `1px solid ${border}`,
          padding: '0.12rem 0.45rem',
          borderRadius: '4px',
          fontSize: '0.73rem',
          fontWeight: 600,
          fontFamily: 'monospace',
          cursor: title ? 'help' : 'default',
        }}
      >
        <span>{symbol}</span>
        <span>{label}</span>
      </span>
      {descricao && (
        <span
          style={{
            fontSize: '0.78rem',
            lineHeight: 1.35,
            color: !isMatrix && conquistado ? '#d4d4d8' : '#a1a1aa',
            minWidth: 0,
          }}
        >
          {descricao}
        </span>
      )}
    </div>
  );
}

/**
 * Renderiza recursivamente a árvore de `detalhes_regra`:
 * - Cartões com cabeçalhos estruturados ("Exige TODAS abaixo:" / "Exige X de:")
 * - Badges com itens de evidência e texto explicativo ao lado
 * - Compatível tanto com a visão de jovem (NovoProgramaView) quanto com a Matriz de Equivalência (RegrasEquivalenciaView).
 */
export function RenderDetalhesRegra({
  detalhes,
  conquistados,
  depth = 0,
}: RenderDetalhesRegraProps): React.ReactElement | null {
  if (!detalhes || depth > MAX_PROFUNDIDADE_RENDER_REGRA) return null;

  // Compatibilidade com formato legado achatado
  if (!detalhes.tipo && (detalhes.origem_pistas_ueb || detalhes.origem_rumo_ueb || detalhes.origem_especialidades)) {
    const pistas: string[] = detalhes.origem_pistas_ueb || [];
    const rumos: string[] = detalhes.origem_rumo_ueb || [];
    const esps: string[] = detalhes.origem_especialidades || [];
    const nivelMin = detalhes.nivel_min_especialidade || 1;
    if (pistas.length === 0 && rumos.length === 0 && esps.length === 0) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-start' }}>
        {pistas.map((p) => (
          <BadgeItemRegra
            key={`pt_${p}`}
            label={`PT-${p}`}
            conquistado={conquistados ? (conquistados.includes(`PT-${p}`) || conquistados.includes(`Pista ${p}`)) : undefined}
          />
        ))}
        {rumos.map((r) => (
          <BadgeItemRegra
            key={`rt_${r}`}
            label={`RT-${r}`}
            conquistado={conquistados ? (conquistados.includes(`RT-${r}`) || conquistados.includes(`Rumo ${r}`)) : undefined}
          />
        ))}
        {esps.map((e) => (
          <BadgeItemRegra
            key={`esp_${e}`}
            label={`${e} (N${nivelMin}+)`}
            conquistado={conquistados ? conquistados.some((c) => c.startsWith(`Esp. ${e}`)) : undefined}
          />
        ))}
      </div>
    );
  }

  if (!detalhes.tipo) return null;

  switch (detalhes.tipo) {
    case 'SEM_EQUIVALENCIA': {
      return (
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
      );
    }
    case 'PROGRESSOES': {
      const item = detalhes.item;
      if (!item) return null;
      const ident = item.identificacao || `Atividade ${item.pa_atividade_id}`;
      const isConq = conquistados ? conquistados.includes(ident) : undefined;
      return (
        <BadgeItemRegra
          label={ident}
          conquistado={isConq}
          title={
            conquistados
              ? `${ident}: ${isConq ? 'Concluído pelo jovem no PA' : 'Não realizado no PA'}`
              : `${ident}: Atividade do Programa Antigo`
          }
          descricao={item.ds_atividade || undefined}
        />
      );
    }
    case 'ESPECIALIDADE': {
      const nome = detalhes.nm_especialidade || `Especialidade ID ${detalhes.pa_especialidade_id}`;
      const isConq = conquistados ? conquistados.some((c) => c.startsWith(`Esp. ${nome}`)) : undefined;
      return (
        <BadgeItemRegra
          label={`${nome} (N${detalhes.nivel_minimo}+)`}
          conquistado={isConq}
          title={`Especialidade PA ${nome}, nível mínimo N${detalhes.nivel_minimo}+`}
        />
      );
    }
    case 'SEMANTICO': {
      const itens = detalhes.itens || [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 700 }}>
            Semântico ({detalhes.logica === 'AND' ? 'Todas' : 'Ao menos uma'}):
          </span>
          {itens.map((it: any, i: number) => {
            const ident = it.identificacao || `Atividade ${it.pa_atividade_id}`;
            const isConq = conquistados ? conquistados.includes(ident) : undefined;
            return (
              <BadgeItemRegra
                key={`${ident}_${i}`}
                label={ident}
                conquistado={isConq}
                title={`${ident} (busca semântica)`}
                descricao={it.ds_atividade || undefined}
              />
            );
          })}
        </div>
      );
    }
    case 'TODAS':
    case 'QNT_MINIMA': {
      const blocos = Array.isArray(detalhes.blocos) ? detalhes.blocos : [];
      const header =
        detalhes.tipo === 'TODAS' ? 'Exige TODAS abaixo:' : `Exige ${detalhes.quantidade_minima ?? 1} de:`;
      return (
        <div
          style={{
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '6px',
            padding: '0.45rem 0.55rem',
            background: 'rgba(255, 255, 255, 0.02)',
            width: '100%',
          }}
        >
          <div style={{ fontSize: '0.72rem', color: '#93c5fd', fontWeight: 700, marginBottom: '0.35rem' }}>
            {header}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-start' }}>
            {blocos.map((sub: any, i: number) => (
              <RenderDetalhesRegra key={i} detalhes={sub} conquistados={conquistados} depth={depth + 1} />
            ))}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
