'use client';

import { useState } from 'react';
import { ChevronDown, CheckCircle2, Circle, Clock, Award, Sparkles } from 'lucide-react';
import type { Escoteiro, EscoteiroEspecialidade } from '@/app/lib/data';

const NOMES_CAMINHOS: Record<string, string> = {
  '4': 'Período Introdutório',
  '5': 'Pista e Trilha',
  '6': 'Rumo e Travessia',
};

const SEM_GRUPO = '__sem_grupo__';

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) {
    return <span style={{ color: '#64748b', fontSize: '0.8rem' }}>-</span>;
  }
  const isConfirmado = status === 'confirmadoEscotista';
  const isConversar = status.toLowerCase().includes('conversar');

  if (isConfirmado) {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '0.15rem 0.5rem',
          borderRadius: '9999px',
          fontSize: '0.72rem',
          fontWeight: 600,
          background: 'rgba(34, 197, 94, 0.15)',
          color: '#4ade80',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          whiteSpace: 'nowrap',
        }}
      >
        Confirmado
      </span>
    );
  }

  if (isConversar) {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '0.15rem 0.5rem',
          borderRadius: '9999px',
          fontSize: '0.72rem',
          fontWeight: 600,
          background: 'rgba(245, 158, 11, 0.15)',
          color: '#fbbf24',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          whiteSpace: 'nowrap',
        }}
      >
        Conversar
      </span>
    );
  }

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.72rem',
        fontWeight: 500,
        background: 'rgba(148, 163, 184, 0.15)',
        color: '#94a3b8',
        border: '1px solid rgba(148, 163, 184, 0.3)',
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

function ConcluidaIcon({ concluida }: { concluida: boolean }) {
  return concluida ? (
    <CheckCircle2 size={16} color="var(--primary, #22c55e)" />
  ) : (
    <Circle size={16} color="#475569" style={{ opacity: 0.35 }} />
  );
}

function agruparAtividades(atividades: Escoteiro['progressao'][number]['data']) {
  const grupos: [string, typeof atividades][] = [];
  const indices = new Map<string, number>();

  for (const atividade of atividades) {
    const grupo = atividade.dsDesenvolvimento || SEM_GRUPO;
    if (!indices.has(grupo)) {
      indices.set(grupo, grupos.length);
      grupos.push([grupo, []]);
    }
    grupos[indices.get(grupo)!][1].push(atividade);
  }

  return grupos;
}

function getNivelBadge(nrNivel: number, dtNivel?: string) {
  switch (nrNivel) {
    case 3:
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.78rem',
            fontWeight: 700,
            background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.25), rgba(202, 138, 4, 0.15))',
            color: '#facc15',
            border: '1px solid rgba(234, 179, 8, 0.4)',
          }}
        >
          🥇 Nível 3 (Ouro) {dtNivel ? `• ${dtNivel}` : ''}
        </span>
      );
    case 2:
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.78rem',
            fontWeight: 700,
            background: 'linear-gradient(135deg, rgba(226, 232, 240, 0.2), rgba(148, 163, 184, 0.1))',
            color: '#e2e8f0',
            border: '1px solid rgba(226, 232, 240, 0.4)',
          }}
        >
          🥈 Nível 2 (Prata) {dtNivel ? `• ${dtNivel}` : ''}
        </span>
      );
    case 1:
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.78rem',
            fontWeight: 700,
            background: 'linear-gradient(135deg, rgba(217, 119, 6, 0.25), rgba(180, 83, 9, 0.15))',
            color: '#fb923c',
            border: '1px solid rgba(217, 119, 6, 0.4)',
          }}
        >
          🥉 Nível 1 (Bronze) {dtNivel ? `• ${dtNivel}` : ''}
        </span>
      );
    default:
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.6rem',
            borderRadius: '6px',
            fontSize: '0.78rem',
            fontWeight: 600,
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#60a5fa',
            border: '1px solid rgba(59, 130, 246, 0.3)',
          }}
        >
          ⏳ Em Andamento
        </span>
      );
  }
}

type ProgressionViewProps = {
  caminhos: Escoteiro['progressao'];
  especialidades?: Escoteiro['especialidades'];
  catalogoDisponivel?: boolean;
};

export default function ProgressionView({
  caminhos,
  especialidades = [],
  catalogoDisponivel = true,
}: ProgressionViewProps) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(['4', '5', 'especialidades']));
  const [espsAbertas, setEspsAbertas] = useState<Set<string>>(() => new Set());

  // Filtra registros inválidos caso existam
  const espsValidas = especialidades.filter(
    (e) => e && e.cd_especialidade && e.cd_especialidade !== 'undefined'
  );

  const totalConquistadas = espsValidas.filter((e) => e.nr_nivel > 0).length;
  const totalEmAndamento = espsValidas.filter((e) => e.nr_nivel === 0).length;
  const totalItensConcluidos = espsValidas.reduce(
    (acc, e) => acc + (e.qtd_itens_concluidos || (e.itens ? e.itens.filter((it) => it.fl_conquistado).length : 0)),
    0
  );

  function toggle(codigo: string) {
    setAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) {
        next.delete(codigo);
      } else {
        next.add(codigo);
      }
      return next;
    });
  }

  function toggleEsp(cdEsp: string) {
    setEspsAbertas((prev) => {
      const next = new Set(prev);
      if (next.has(cdEsp)) {
        next.delete(cdEsp);
      } else {
        next.add(cdEsp);
      }
      return next;
    });
  }

  if (catalogoDisponivel === false) {
    return (
      <p style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>
        Catálogo de progressão do Programa Antigo em desenvolvimento para este ramo.
      </p>
    );
  }

  if ((!caminhos || caminhos.length === 0) && (!espsValidas || espsValidas.length === 0)) {
    return (
      <p style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>
        Sem dados de progressão registrados para este jovem.
      </p>
    );
  }

  return (
    <div className="caminhos">
      {/* Blocos 1, 2, 3: Caminhos do Programa Antigo */}
      {caminhos.map((caminho, i) => {
        const codigo = caminho.data[0]?.cdCaminho ?? String(i + 1);
        const nome = NOMES_CAMINHOS[codigo] ?? `Caminho ${codigo}`;
        const feitos = caminho.data.filter((a) => a.checkEscotista === 'confirmadoEscotista').length;
        const pct = caminho.totalCount ? Math.round((feitos / caminho.totalCount) * 100) : 0;
        const aberto = abertos.has(codigo);
        const prefixo = codigo === '4' ? 'P-' : codigo === '5' ? 'PT-' : codigo === '6' ? 'RT-' : '';
        const grupos = agruparAtividades(caminho.data);

        return (
          <div className="caminho" key={codigo}>
            <button
              type="button"
              className="caminho-header caminho-header-toggle"
              onClick={() => toggle(codigo)}
              aria-expanded={aberto}
            >
              <span className="caminho-header-titulo">
                <ChevronDown
                  size={18}
                  className={`caminho-chevron ${aberto ? 'aberto' : ''}`}
                />
                <h3>{nome}</h3>
              </span>
              <span className="caminho-pct">
                {feitos}/{caminho.totalCount} ({pct}%)
              </span>
            </button>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>

            {aberto &&
              grupos.map(([grupo, atividades]) => (
                <div className="desenvolvimento-grupo" key={grupo}>
                  {grupo !== SEM_GRUPO && <h4 className="desenvolvimento-titulo">{grupo}</h4>}
                  <table className="atividades-table">
                    <thead>
                      <tr>
                        <th className="col-numero">#</th>
                        <th>Atividade</th>
                        <th style={{ width: '105px', textAlign: 'center' }}>STATUS</th>
                        <th style={{ width: '90px', textAlign: 'center' }}>CONCLUÍDA</th>
                        <th className="col-data">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {atividades.map((atividade, idx) => {
                        const isConcluida = Boolean(atividade.concluida ?? (atividade.checkEscotista === 'confirmadoEscotista'));
                        const statusEscotista = atividade.status_escotista || atividade.statusEscotista || (isConcluida ? 'confirmadoEscotista' : null);
                        const dataFormatada = isConcluida
                          ? (atividade.data_conclusao || atividade.dataConclusao || atividade.dtCheckEscotista || atividade.dtAtividade || null)
                          : null;

                        return (
                          <tr key={`${atividade.cdAtividade ?? idx}`}>
                            <td className="col-numero">
                              {atividade.identificacao || `${prefixo}${atividade.cdOrdenacao ?? idx + 1}`}
                            </td>
                            <td style={{ color: isConcluida ? '#f1f5f9' : '#94a3b8' }}>
                              {atividade.dsAtividade}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <StatusBadge status={statusEscotista} />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <ConcluidaIcon concluida={isConcluida} />
                            </td>
                            <td className="col-data">
                              {dataFormatada ? (
                                <span className="atividade-data">
                                  <Clock size={12} style={{ flexShrink: 0 }} />
                                  <span>{dataFormatada}</span>
                                </span>
                              ) : (
                                <span style={{ color: '#555' }}>-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        );
      })}

      {/* Bloco 4 (Última Posição): Especialidades Conquistadas e em Andamento */}
      <div className="caminho" key="especialidades-bloco">
        <button
          type="button"
          className="caminho-header caminho-header-toggle"
          onClick={() => toggle('especialidades')}
          aria-expanded={abertos.has('especialidades')}
          style={{
            borderColor: abertos.has('especialidades') ? 'rgba(234, 179, 8, 0.4)' : undefined,
          }}
        >
          <span className="caminho-header-titulo">
            <ChevronDown
              size={18}
              className={`caminho-chevron ${abertos.has('especialidades') ? 'aberto' : ''}`}
              style={{ color: abertos.has('especialidades') ? '#facc15' : undefined }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Award size={18} color="#facc15" />
              <h3>Especialidades (Conquistadas e em Andamento)</h3>
            </div>
          </span>
          <span className="caminho-pct" style={{ color: '#facc15', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {totalConquistadas > 0 && <span>{totalConquistadas} conquistada{totalConquistadas > 1 ? 's' : ''}</span>}
            {totalEmAndamento > 0 && (
              <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                • {totalEmAndamento} em andamento
              </span>
            )}
            <span style={{ color: '#64748b', fontSize: '0.78rem' }}>({totalItensConcluidos} itens)</span>
          </span>
        </button>

        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{
              width: totalConquistadas > 0 ? '100%' : totalItensConcluidos > 0 ? '40%' : '0%',
              background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
            }}
          />
        </div>

        {abertos.has('especialidades') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            {espsValidas.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: '1.5rem', fontSize: '0.9rem' }}>
                Nenhuma especialidade registrada no Paxtu para este jovem.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {espsValidas.map((esp) => {
                  // Abre por padrão se houver apenas 1 especialidade, ou se clicada
                  const isEspOpen = espsAbertas.has(esp.cd_especialidade) || (espsValidas.length === 1 && !espsAbertas.has(`closed_${esp.cd_especialidade}`));
                  const itens = esp.itens || [];
                  const concluidosCount = itens.filter((it) => it.fl_conquistado).length || esp.qtd_itens_concluidos;
                  const totalItensCount = esp.total_itens || itens.length;

                  return (
                    <div
                      key={esp.cd_especialidade}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        transition: 'border-color 0.2s ease',
                      }}
                    >
                      <div
                        onClick={() => {
                          if (espsValidas.length === 1) {
                            if (isEspOpen) {
                              setEspsAbertas((prev) => new Set([...prev, `closed_${esp.cd_especialidade}`]));
                            } else {
                              setEspsAbertas((prev) => {
                                const next = new Set(prev);
                                next.delete(`closed_${esp.cd_especialidade}`);
                                return next;
                              });
                            }
                          } else {
                            toggleEsp(esp.cd_especialidade);
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.85rem 1rem',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <ChevronDown
                            size={16}
                            style={{
                              transform: isEspOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                              transition: 'transform 0.2s ease',
                              color: '#94a3b8',
                            }}
                          />
                          <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#f1f5f9' }}>
                            {esp.ds_especialidade}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                            {concluidosCount} de {totalItensCount} itens concluídos
                          </span>
                          {getNivelBadge(esp.nr_nivel, esp.dt_nivel)}
                        </div>
                      </div>

                      {isEspOpen && (
                        <div style={{ padding: '0.5rem 1rem 1rem 1rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          {itens.length === 0 ? (
                            <p style={{ color: '#888', fontSize: '0.85rem', fontStyle: 'italic', padding: '0.5rem 0' }}>
                              Itens detalhados não sincronizados individualmente.
                            </p>
                          ) : (
                            <table className="atividades-table" style={{ fontSize: '0.85rem' }}>
                              <thead>
                                <tr>
                                  <th className="col-numero" style={{ width: '45px' }}>#</th>
                                  <th>Requisito / Atividade</th>
                                  <th style={{ width: '105px', textAlign: 'center' }}>STATUS</th>
                                  <th style={{ width: '90px', textAlign: 'center' }}>CONCLUÍDA</th>
                                  <th className="col-data">Data</th>
                                </tr>
                              </thead>
                              <tbody>
                                {itens.map((it, idx) => {
                                  const isConcluido = Boolean(it.concluida ?? it.fl_conquistado ?? Boolean(it.dt_item));
                                  const statusEscotista = isConcluido ? 'confirmadoEscotista' : null;
                                  const dataConclusao = isConcluido ? (it.data_conclusao || it.dt_item || null) : null;

                                  return (
                                    <tr key={it.cd_item || idx}>
                                      <td className="col-numero">
                                        #{it.cd_item || idx + 1}
                                      </td>
                                      <td style={{ color: isConcluido ? '#f1f5f9' : '#94a3b8' }}>
                                        {it.ds_item || `Requisito ${it.cd_item || idx + 1}`}
                                      </td>
                                      <td style={{ textAlign: 'center' }}>
                                        <StatusBadge status={statusEscotista} />
                                      </td>
                                      <td style={{ textAlign: 'center' }}>
                                        <ConcluidaIcon concluida={isConcluido} />
                                      </td>
                                      <td className="col-data">
                                        {dataConclusao ? (
                                          <span className="atividade-data">
                                            <Clock size={12} style={{ flexShrink: 0 }} />
                                            <span>{dataConclusao}</span>
                                          </span>
                                        ) : (
                                          <span style={{ color: '#555' }}>-</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

