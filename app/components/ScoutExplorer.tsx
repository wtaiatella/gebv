'use client';

import { useMemo, useState } from 'react';
import { User, MapPin, Phone, Mail, GraduationCap, CheckCircle2, Circle, Clock, ChevronDown } from 'lucide-react';
import type { Escoteiro } from '@/app/lib/data';

type Props = {
  escoteiros: Escoteiro[];
};

const CAMPOS_BASICOS: { label: string; key: string; icon?: React.ReactNode }[] = [
  { label: 'Nome completo', key: 'nm_associado', icon: <User size={16} /> },
  { label: 'Matrícula', key: 'nr_registro_formatado' },
  { label: 'Data de nascimento', key: 'dt_nascimento' },
  { label: 'Ramo', key: 'dsRamo' },
  { label: 'Grupo', key: 'nr_grupo_regiao' },
  { label: 'Status', key: 'flStatus' },
  { label: 'Validade', key: 'dt_validade' },
  { label: 'Ano de ingresso', key: 'ds_ano_ingresso' },
  { label: 'Cidade', key: 'ds_cidade', icon: <MapPin size={16} /> },
  { label: 'Bairro', key: 'ds_bairro' },
  { label: 'Endereço', key: 'ds_endereco' },
  { label: 'CEP', key: 'ds_cep' },
  { label: 'Telefone celular', key: 'ds_telefone_cel', icon: <Phone size={16} /> },
  { label: 'Telefone residencial', key: 'ds_telefone_res' },
  { label: 'E-mail', key: 'ds_email', icon: <Mail size={16} /> },
  { label: 'Escolaridade', key: 'ds_escolaridade', icon: <GraduationCap size={16} /> },
  { label: 'Profissão', key: 'ds_profissao' },
];

function StatusIcon({ checked }: { checked: boolean }) {
  return checked ? (
    <CheckCircle2 size={16} color="var(--primary)" />
  ) : (
    <Circle size={16} color="#555" />
  );
}

export default function ScoutExplorer({ escoteiros }: Props) {
  const [selectedId, setSelectedId] = useState(escoteiros[0]?.associado.cd_associado ?? '');
  const [tab, setTab] = useState<'basicos' | 'progressao'>('basicos');

  const escoteiro = useMemo(
    () => escoteiros.find((e) => e.associado.cd_associado === selectedId),
    [escoteiros, selectedId]
  );

  return (
    <main className="container">
      <header>
        <h1>GEBV</h1>
        <p className="subtitle">Dados e progressão dos escoteiros</p>
      </header>

      <div className="dashboard">
        <section className="card">
          <select
            className="scout-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {escoteiros.map((e) => (
              <option key={e.associado.cd_associado} value={e.associado.cd_associado}>
                {e.associado.nm_associado}
              </option>
            ))}
          </select>
        </section>

        {escoteiro && (
          <section className="card">
            <div className="tabs">
              <button
                className={`tab ${tab === 'basicos' ? 'active' : ''}`}
                onClick={() => setTab('basicos')}
              >
                Dados Básicos
              </button>
              <button
                className={`tab ${tab === 'progressao' ? 'active' : ''}`}
                onClick={() => setTab('progressao')}
              >
                Progressão
              </button>
            </div>

            {tab === 'basicos' ? (
              <DadosBasicos associado={escoteiro.associado} />
            ) : (
              <Progressao caminhos={escoteiro.progressao} />
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function DadosBasicos({ associado }: { associado: Escoteiro['associado'] }) {
  const campos = CAMPOS_BASICOS.filter(({ key }) => associado[key]);

  return (
    <div className="info-grid">
      {campos.map(({ label, key, icon }) => (
        <div className="info-item" key={key}>
          <span className="info-label">
            {icon}
            {label}
          </span>
          <span className="info-value">{associado[key]}</span>
        </div>
      ))}
    </div>
  );
}

const NOMES_CAMINHOS: Record<string, string> = {
  '4': 'Período Introdutório',
  '5': 'Pista e Trilha',
  '6': 'Rumo e Travessia',
};

function Progressao({ caminhos }: { caminhos: Escoteiro['progressao'] }) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());

  if (caminhos.length === 0) {
    return <p style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>Sem dados de progressão.</p>;
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

const SEM_GRUPO = '__sem_grupo__';

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
