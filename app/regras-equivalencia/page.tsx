import { Suspense } from 'react';
import RegrasEquivalenciaView from '@/app/components/equivalencias/RegrasEquivalenciaView';

export const metadata = {
  title: 'Regras de Equivalência | GEBV',
  description: 'Matriz e Regras de Equivalência entre o Programa Antigo e o Novo Programa Educativo',
};

export default function RegrasEquivalenciaPage() {
  return (
    <main style={{ minHeight: 'calc(100vh - 80px)', padding: '2rem 0' }}>
      <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Carregando regras...</div>}>
        <RegrasEquivalenciaView />
      </Suspense>
    </main>
  );
}
