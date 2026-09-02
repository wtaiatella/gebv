'use client';

import { useMemo } from 'react';
import type { Escoteiro, Ramo } from '@/app/lib/data';
import ScoutSelector from './scout/ScoutSelector';
import SyncActions, { SyncSingleButton } from './scout/SyncActions';
import ProgressionView from './scout/ProgressionView';
import { PaxtuConnectButton } from './scout/PaxtuLoginModal';

type Props = {
  escoteiros: Escoteiro[];
  selectedId: string;
  ramoAtual?: Ramo;
};

export default function ScoutExplorer({ escoteiros, selectedId, ramoAtual = 'Escoteiro' }: Props) {
  // Identifica o jovem selecionado
  const escoteiro = useMemo(() => {
    return escoteiros.find((e) => e.associado.cd_associado === selectedId) || escoteiros[0];
  }, [escoteiros, selectedId]);

  const activeId = escoteiro?.associado.cd_associado ?? '';

  return (
    <main className="container">
      <header>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
          <PaxtuConnectButton />
        </div>

        <h1>GEBV</h1>
        <p className="subtitle">Gestão e Backup de Progressões Escoteiras</p>

        {/* Ação de Sincronização em Massa (no Topo) */}
        <div style={{ marginTop: '1.5rem' }}>
          <SyncActions selectedId={activeId} ramoAtual={ramoAtual} />
        </div>
      </header>

      <div className="dashboard">
        {/* Barra de Seleção com Seções/Ramos e Lista de Jovens */}
        <section
          className="card"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1.5rem',
          }}
        >
          <div style={{ flex: 1, minWidth: '280px' }}>
            <ScoutSelector
              escoteiros={escoteiros}
              selectedId={activeId}
              ramoAtual={ramoAtual}
            />
          </div>

          {escoteiro && (
            <div>
              <SyncSingleButton selectedId={activeId} />
            </div>
          )}
        </section>

        {/* Visualização da Progressão do Jovem Selecionado */}
        {escoteiro ? (
          <section className="card">
            <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.4rem', color: 'var(--foreground)' }}>
                {escoteiro.associado.nm_associado}
              </h2>
              <p style={{ color: '#888', fontSize: '0.9rem' }}>
                Registro: {escoteiro.associado.nr_registro_formatado || escoteiro.associado.nr_registro || '-'} | Ramo: {escoteiro.associado.dsRamo || ramoAtual}
              </p>
            </div>

            <ProgressionView caminhos={escoteiro.progressao} />
          </section>
        ) : (
          <section className="card" style={{ textAlign: 'center', color: '#888', padding: '3rem' }}>
            Nenhum escoteiro selecionado ou encontrado nesta seção.
          </section>
        )}
      </div>
    </main>
  );
}
