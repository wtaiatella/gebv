import ScoutExplorer from '@/app/components/ScoutExplorer';
import { getEscoteiros } from '@/app/lib/data';

export default async function Home() {
  const escoteiros = await getEscoteiros();

  return <ScoutExplorer escoteiros={escoteiros} />;
}
