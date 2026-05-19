import Link from 'next/link';

export const metadata = {
  title: 'Cumulus Create - Intent Console',
  description:
    'Turn a user build intent into an authenticated, bootstrapped, knowledge-indexed Cumulus project.',
};

const shell = {
  minHeight: '100vh',
  background: 'var(--color-paper)',
  color: 'var(--color-ink)',
} as const;

const wrap = {
  maxWidth: 1180,
  margin: '0 auto',
  padding: '28px 24px 56px',
} as const;

const nav = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 20,
  flexWrap: 'wrap' as const,
  marginBottom: 42,
} as const;

const brand = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.22em',
  textTransform: 'uppercase' as const,
  fontWeight: 600,
} as const;

const navLinks = {
  display: 'flex',
  gap: 22,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-ink-2)',
} as const;

const grid = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
  gap: 18,
  alignItems: 'start',
} as const;

const card = {
  border: '1px solid var(--color-hair)',
  borderRadius: 5.5,
  background: 'var(--color-paper)',
} as const;

const panel = {
  ...card,
  padding: 28,
} as const;

const kicker = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-ink-3)',
} as const;

const h1 = {
  fontFamily: 'var(--font-display)',
  fontSize: 56,
  lineHeight: 1.02,
  fontWeight: 500,
  margin: '18px 0 18px',
} as const;

const lead = {
  fontSize: 18,
  lineHeight: 1.55,
  color: 'var(--color-ink-2)',
  maxWidth: 680,
  margin: '0 0 28px',
} as const;

const input = {
  width: '100%',
  minHeight: 132,
  resize: 'vertical' as const,
  border: '1px solid var(--color-hair)',
  borderRadius: 5.5,
  background: 'transparent',
  color: 'var(--color-ink)',
  font: 'inherit',
  fontSize: 18,
  lineHeight: 1.5,
  padding: 18,
  outline: 'none',
} as const;

const button = {
  border: '1px solid var(--color-terracotta)',
  borderRadius: 5.5,
  background: 'var(--color-terracotta)',
  color: 'var(--color-paper)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  padding: '12px 16px',
} as const;

const mono = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.04em',
  color: 'var(--color-ink-3)',
} as const;

const sectionTitle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-ink-3)',
  margin: '0 0 14px',
} as const;

const row = {
  display: 'grid',
  gridTemplateColumns: '86px minmax(0, 1fr)',
  gap: 14,
  padding: '14px 0',
  borderTop: '1px solid var(--color-hair-soft)',
} as const;

const dot = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: 'var(--color-terracotta)',
  display: 'inline-block',
  marginRight: 8,
  verticalAlign: 1,
} as const;

const command = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.6,
  color: 'var(--color-ink)',
  background: 'var(--color-wash)',
  borderTop: '1px solid var(--color-hair-soft)',
  padding: 18,
  overflowX: 'auto' as const,
} as const;

export default function Home() {
  return (
    <main style={shell}>
      <div style={wrap}>
        <nav aria-label="Primary" style={nav}>
          <Link href="/" style={brand}>
            <span className="brand-dot" aria-hidden="true" />
            Cumulus Create
          </Link>
          <div style={navLinks}>
            <Link href="/docs/developer">Docs</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/login">Sign in</Link>
          </div>
        </nav>

        <section style={grid}>
          <div style={panel}>
            <div style={kicker}>Intent Console</div>
            <h1 style={h1}>Tell the agent what to build. Cumulus creates the working project.</h1>
            <p style={lead}>
              The agent signs up, registers the intent, runs `npm create @cls`, wires Auth, DB,
              Knowledge, SDKs, APIs, MCP, CLI, and TUI, then keeps progress in the cloud database.
            </p>

            <form>
              <label htmlFor="intent" style={sectionTitle}>
                User intent
              </label>
              <textarea
                id="intent"
                name="intent"
                placeholder="I want to build a project management app for AI agents..."
                style={input}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  marginTop: 16,
                  flexWrap: 'wrap',
                }}
              >
                <button type="button" style={button}>
                  Register intent
                </button>
                <span style={mono}>Creates .cumulus/intent.json and registers with Agent Auth.</span>
              </div>
            </form>
          </div>

          <aside style={panel}>
            <h2 style={sectionTitle}>Live systems</h2>
            {[
              ['Auth', 'Agent identity and project intent registration'],
              ['Create', 'Bootstrap templates, SDKs, APIs, runtimes'],
              ['Knowledge', 'Second brain reachable through MCP'],
              ['Database', 'Core project data, progress, runs, artifacts'],
            ].map(([name, text]) => (
              <div key={name} style={row}>
                <div style={mono}>
                  <span style={dot} />
                  {name}
                </div>
                <div style={{ color: 'var(--color-ink-2)', lineHeight: 1.45 }}>{text}</div>
              </div>
            ))}
          </aside>
        </section>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 18,
            marginTop: 18,
          }}
        >
          {[
            ['01', 'Agent signs up', 'Agent Auth links the user, agent, tenant, and project intent.'],
            ['02', 'Project bootstraps', '@cls/create installs npm, Rust, and Python runtime wiring.'],
            ['03', 'Progress persists', 'SDK/API calls update Cumulus DB while Knowledge serves context.'],
          ].map(([index, title, text]) => (
            <article key={index} style={panel}>
              <div style={mono}>{index}</div>
              <h2 style={{ fontSize: 22, fontWeight: 500, margin: '10px 0 10px' }}>{title}</h2>
              <p style={{ color: 'var(--color-ink-2)', lineHeight: 1.55, margin: 0 }}>{text}</p>
            </article>
          ))}
        </section>

        <section style={{ ...card, marginTop: 18, overflow: 'hidden' }}>
          <div style={{ padding: 24 }}>
            <h2 style={sectionTitle}>One command</h2>
            <p style={{ ...lead, fontSize: 16, marginBottom: 0 }}>
              The npm package owns the bootstrap path. The generated project is ready for Auth,
              DB, Knowledge, SDK, API, MCP, CLI, and TUI usage from the first run.
            </p>
          </div>
          <pre style={command}>
            npm create @cls@latest my-project -- --with auth,db,knowledge --install-runtimes
          </pre>
        </section>
      </div>
    </main>
  );
}
