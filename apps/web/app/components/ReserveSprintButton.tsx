'use client';

import { useState } from 'react';

const button = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '14px 24px',
  background: 'var(--color-ink)',
  color: 'var(--color-paper)',
  border: '1px solid var(--color-ink)',
  borderRadius: 6,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
  cursor: 'pointer',
} as const;

const inputStyle = {
  display: 'block',
  width: '100%',
  padding: '12px 14px',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  border: '1px solid var(--color-rule)',
  borderRadius: 5,
  marginBottom: 12,
  background: 'var(--color-paper)',
  color: 'var(--color-ink)',
} as const;

export function ReserveSprintButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent('Cumulus sprint request');
    const body = encodeURIComponent(
      [
        `Email: ${email}`,
        `Name: ${name || '(not provided)'}`,
        `Tenant: ${tenantSlug || '(not provided)'}`,
      ].join('\n'),
    );
    window.location.href = `mailto:hello@cumulush.com?subject=${subject}&body=${body}`;
  }

  if (!open) {
    return (
      <button type="button" style={button} onClick={() => setOpen(true)}>
        Request a sprint
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        maxWidth: 480,
        marginTop: 8,
        padding: 24,
        border: '1px solid var(--color-rule)',
        borderRadius: 8,
        background: 'var(--color-paper)',
      }}
    >
      <input
        type="email"
        placeholder="you@yourcompany.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        style={inputStyle}
      />
      <input
        type="text"
        placeholder="Your name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={inputStyle}
      />
      <input
        type="text"
        placeholder="Tenant slug, if you already have one (optional)"
        value={tenantSlug}
        onChange={(e) => setTenantSlug(e.target.value)}
        style={inputStyle}
      />
      <button type="submit" style={button}>
        Open email draft
      </button>
    </form>
  );
}
