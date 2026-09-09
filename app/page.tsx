import ScoutExplorer from '@/app/components/ScoutExplorer';
import { getEscoteiros, Ramo } from '@/app/lib/data';
import { ScoutProvider } from '@/app/context/ScoutContext';

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{
    jovem?: string;
    ramo?: string;
    view?: 'novo' | 'antigo';
  }>;
};

export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  const ramoValido: Ramo = (['Escoteiro', 'Lobinho', 'Sênior', 'Pioneiro'].includes(params.ramo as any)
    ? params.ramo
    : 'Escoteiro') as Ramo;

  const escoteiros = await getEscoteiros(ramoValido);
  const selectedId = params.jovem || escoteiros[0]?.associado.cd_associado || '';
  const initialView = params.view === 'antigo' ? 'antigo' : 'novo';

  return (
    <ScoutProvider
      initialEscoteiros={escoteiros}
      initialRamo={ramoValido}
      initialSelectedId={selectedId}
      initialView={initialView}
    >
      <ScoutExplorer />
    </ScoutProvider>
  );
}

