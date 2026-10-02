import ScoutExplorer from '@/app/components/ScoutExplorer';
import { getEscoteiros, Ramo } from '@/app/lib/data';
import { ScoutProvider } from '@/app/context/ScoutContext';
import { normalizeRamoOrNull, ramoToDisplayName } from '@/app/lib/ramo';

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
  const normalizedRamo = normalizeRamoOrNull(params.ramo);
  const ramoValido: Ramo = normalizedRamo
    ? (ramoToDisplayName(normalizedRamo) as Ramo)
    : 'Escoteiro';

  const { escoteiros, catalogoDisponivel } = await getEscoteiros(ramoValido);
  const isJovemValido = params.jovem && escoteiros.some((e) => e.associado.cd_associado === params.jovem);
  const selectedId = isJovemValido ? params.jovem! : (escoteiros[0]?.associado.cd_associado || '');
  const initialView = params.view === 'antigo' ? 'antigo' : 'novo';

  return (
    <ScoutProvider
      key={ramoValido}
      initialEscoteiros={escoteiros}
      initialCatalogoDisponivel={catalogoDisponivel}
      initialRamo={ramoValido}
      initialSelectedId={selectedId}
      initialView={initialView}
    >
      <ScoutExplorer />
    </ScoutProvider>
  );
}


