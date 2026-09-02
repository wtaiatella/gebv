'use client';

import { useState } from 'react';
import { LogIn, Loader2, KeyRound, User, CheckCircle2, X } from 'lucide-react';

type PaxtuLoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: string) => void;
};

export function PaxtuLoginModal({ isOpen, onClose, onSuccess }: PaxtuLoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/paxtu/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: username, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha no login do Paxtu (Antigo).');
      }

      onSuccess(username);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '2rem',
          position: 'relative',
          border: '1px solid var(--glass-border)',
          backgroundColor: '#121212',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        }}
      >
        <button
          onClick={onClose}
          disabled={loading}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
          }}
        >
          <X size={20} />
        </button>

        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              padding: '0.8rem',
              borderRadius: '50%',
              backgroundColor: 'rgba(0, 230, 153, 0.1)',
              color: 'var(--primary)',
              marginBottom: '0.8rem',
            }}
          >
            <KeyRound size={28} />
          </div>
          <h2 style={{ fontSize: '1.25rem', color: '#fff', margin: 0 }}>
            Conectar ao Paxtu (Antigo)
          </h2>
          <p style={{ color: '#888', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Digite suas credenciais de escotista para autorizar a sincronização. Suas credenciais não são salvas no servidor.
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 68, 68, 0.1)',
              border: '1px solid var(--error)',
              color: 'var(--error)',
              fontSize: '0.85rem',
              marginBottom: '1rem',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#bbb', marginBottom: '0.4rem' }}>
              Usuário / Registro Paxtu (Antigo)
            </label>
            <div style={{ position: 'relative' }}>
              <User
                size={16}
                style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666' }}
              />
              <input
                type="text"
                placeholder="Ex: wagner190"
                value={username}
                disabled={loading}
                onChange={(e) => setUsername(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 0.75rem 0.75rem 2.4rem',
                  borderRadius: '8px',
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  color: '#fff',
                  fontSize: '0.9rem',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#bbb', marginBottom: '0.4rem' }}>
              Senha
            </label>
            <div style={{ position: 'relative' }}>
              <KeyRound
                size={16}
                style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666' }}
              />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                disabled={loading}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 0.75rem 0.75rem 2.4rem',
                  borderRadius: '8px',
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  color: '#fff',
                  fontSize: '0.9rem',
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.5rem',
              padding: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.6rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />}
            {loading ? 'Autenticando no Paxtu (Antigo)...' : 'Conectar e Autenticar'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function PaxtuConnectButton() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loggedUser, setLoggedUser] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        style={{
          fontSize: '0.85rem',
          padding: '0.6rem 1.1rem',
          borderRadius: '8px',
          background: loggedUser ? 'rgba(0, 230, 153, 0.1)' : 'rgba(255, 255, 255, 0.05)',
          color: loggedUser ? 'var(--primary)' : '#ccc',
          border: loggedUser ? '1px solid var(--primary)' : '1px solid var(--glass-border)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          transition: 'all 0.2s ease',
        }}
      >
        {loggedUser ? (
          <>
            <CheckCircle2 size={16} />
            <span>Paxtu (Antigo): <strong>{loggedUser}</strong></span>
          </>
        ) : (
          <>
            <LogIn size={16} />
            <span>Conectar Paxtu (Antigo)</span>
          </>
        )}
      </button>

      <PaxtuLoginModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={(user) => setLoggedUser(user)}
      />
    </>
  );
}
