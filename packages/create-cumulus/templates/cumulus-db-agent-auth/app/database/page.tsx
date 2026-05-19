import Link from 'next/link';
import { CumulusDatabasePanel } from '@/app/components/CumulusDatabasePanel';
import { H1 } from '@/app/components/H1';
import { Kicker } from '@/app/components/Kicker';

export default function AgentAuthDatabasePage() {
  return (
    <main className="main">
      <header className="head">
        <div>
          <Kicker>Database</Kicker>
          <H1>
            Cumulus
            <br />
            DB.
          </H1>
        </div>
        <div className="headmeta">
          <b>__CUMULUS_DB_MODE__</b>
          <br />
          <Link href="/">Back</Link>
        </div>
      </header>
      <CumulusDatabasePanel />
    </main>
  );
}
