'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Escoteiro, Ramo } from '@/app/lib/data';

type ScoutSelectorProps = {
  escoteiros: Escoteiro[];
  selectedId: string;
  ramoAtual?: Ramo;
};

const RAMOS: { label: string; value: Ramo }[] = [
  { label: 'Tropa Escoteira', value: 'Escoteiro' },
  { label: 'Alcateia (Lobinhos)', value: 'Lobinho' },
  { label: 'Tropa Sênior', value: 'Sênior' },
  { label: 'Clã Pioneiro', value: 'Pioneiro' },
];

export default function ScoutSelector({
  escoteiros,
  selectedId,
  ramoAtual = 'Escoteiro',
}: ScoutSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleRamoChange(novoRamo: Ramo) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('ramo', novoRamo);
    params.delete('jovem'); // reseta jovem ao trocar de ramo

    startTransition(() => {
      router.push(`/?${params.toString()}`);
    });
  }

  function handleJovemChange(novoId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('jovem', novoId);

    startTransition(() => {
      router.push(`/?${params.toString()}`);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
      {/* Seletor de Ramo / Seção (Preparado para Alcateia, Sênior, Pioneiro) */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {RAMOS.map(({ label, value }) => {
          const isSelected = ramoAtual === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => handleRamoChange(value)}
              style={{
                fontSize: '0.85rem',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                background: isSelected ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                color: isSelected ? '#000' : '#aaa',
                border: isSelected ? 'none' : '1px solid var(--glass-border)',
                fontWeight: isSelected ? 'bold' : 'normal',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Dropdown de Escoteiros / Jovens */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <select
          className="scout-select"
          value={selectedId}
          disabled={isPending || escoteiros.length === 0}
          onChange={(e) => handleJovemChange(e.target.value)}
          style={{ flex: 1, minWidth: '250px', opacity: isPending ? 0.7 : 1 }}
        >
          {escoteiros.length === 0 ? (
            <option value="">Nenhum jovem cadastrado nesta seção</option>
          ) : (
            escoteiros.map((e) => (
              <option key={e.associado.cd_associado} value={e.associado.cd_associado}>
                {e.associado.nm_associado}
              </option>
            ))
          )}
        </select>
      </div>
    </div>
  );
}
