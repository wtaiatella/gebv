import ScoutExplorer from '@/app/components/ScoutExplorer';
import { getEscoteiros, Ramo } from '@/app/lib/data';

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
    <ScoutExplorer
      escoteiros={escoteiros}
      selectedId={selectedId}
      ramoAtual={ramoValido}
      initialView={initialView}
    />
  );
}
