'use client';

import { useState } from 'react';
import { ChevronDown, CheckCircle2, Circle, Clock } from 'lucide-react';
import type { Escoteiro } from '@/app/lib/data';

const NOMES_CAMINHOS: Record<string, string> = {
  '4': 'Período Introdutório',
  '5': 'Pista e Trilha',
  '6': 'Rumo e Travessia',
};

const SEM_GRUPO = '__sem_grupo__';

function StatusIcon({ checked }: { checked: boolean }) {
  return checked ? (
    <CheckCircle2 size={16} color="var(--primary)" />
  ) : (
    <Circle size={16} color="#555" />
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

type ProgressionViewProps = {
  caminhos: Escoteiro['progressao'];
};

export default function ProgressionView({ caminhos }: ProgressionViewProps) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());

  if (!caminhos || caminhos.length === 0) {
    return (
      <p style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>
        Sem dados de progressão registrados para este jovem.
      </p>
    );
  }

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

  return (
    <div className="caminhos">
      {caminhos.map((caminho, i) => {
        const codigo = caminho.data[0]?.cdCaminho ?? String(i + 1);
        const nome = NOMES_CAMINHOS[codigo] ?? `Caminho ${codigo}`;
        const feitos = caminho.data.filter((a) => a.checkEscotista === 'confirmadoEscotista').length;
        const pct = caminho.totalCount ? Math.round((feitos / caminho.totalCount) * 100) : 0;
        const aberto = abertos.has(codigo);
        const prefixo = codigo === '4' ? 'P' : '';
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
                        <th>Jovem</th>
                        <th>Escotista</th>
                        <th>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {atividades.map((atividade, idx) => (
                        <tr key={`${atividade.cdAtividade ?? idx}`}>
                          <td className="col-numero">
                            {prefixo}
                            {atividade.cdOrdenacao ?? idx + 1}
                          </td>
                          <td>{atividade.dsAtividade}</td>
                          <td>
                            <StatusIcon checked={atividade.checkJovem === 'feitoJovem'} />
                          </td>
                          <td>
                            <StatusIcon checked={atividade.checkEscotista === 'confirmadoEscotista'} />
                          </td>
                          <td className="atividade-data">
                            {atividade.dtCheckJovem ? (
                              <>
                                <Clock size={12} /> {atividade.dtCheckJovem}
                              </>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
