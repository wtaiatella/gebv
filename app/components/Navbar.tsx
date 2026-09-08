'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PaxtuConnectButton } from './scout/PaxtuLoginModal';

const SECOES = [
  { id: 'Lobinho', label: '🐺 Alcateia', slug: 'Alcateia' },
  { id: 'Escoteiro', label: '⚜️ Tropa Escoteira', slug: 'Tropa Escoteira' },
  { id: 'Sênior', label: '⛰️ Tropa Sênior', slug: 'Tropa Sênior' },
  { id: 'Pioneiro', label: '🏕️ Clã Pioneiro', slug: 'Pioneiros' },
];

export default function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const currentRamo = searchParams.get('ramo') || 'Escoteiro';
  const currentView = searchParams.get('view') || (pathname === '/regras-equivalencia' ? 'equivalencia' : 'novo');

  return (
    <nav className="navbar">
      <div className="navbar-container">
        {/* Brand */}
        <div className="navbar-brand">
          <Link href={`/?ramo=${currentRamo}&view=novo`} className="brand-logo">
            <span className="brand-badge">GEBV</span>
            <span className="brand-title">Programa Educativo</span>
          </Link>
        </div>

        {/* Menu por Ramo / Seção com Sub-menus conforme Excalidraw */}
        <div className="navbar-links" style={{ gap: '0.75rem' }}>
          {SECOES.map((secao) => {
            const isRamoActive = currentRamo === secao.id;
            const isOpen = openDropdown === secao.id;

            return (
              <div
                key={secao.id}
                style={{ position: 'relative' }}
                onMouseEnter={() => setOpenDropdown(secao.id)}
                onMouseLeave={() => setOpenDropdown(null)}
              >
                <button
                  type="button"
                  style={{
                    background: isRamoActive ? 'rgba(0, 255, 136, 0.12)' : 'transparent',
                    color: isRamoActive ? 'var(--primary)' : '#aaa',
                    border: isRamoActive ? '1px solid rgba(0, 255, 136, 0.3)' : '1px solid transparent',
                    padding: '0.55rem 1rem',
                    borderRadius: '10px',
                    fontSize: '0.92rem',
                    fontWeight: 600,
                    boxShadow: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    cursor: 'pointer',
                  }}
                  onClick={() => setOpenDropdown(isOpen ? null : secao.id)}
                >
                  {secao.label}
                  <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>▾</span>
                </button>

                {/* Dropdown com os 3 itens do Excalidraw */}
                {isOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: '0.35rem',
                      background: '#131d2e',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '12px',
                      padding: '0.5rem',
                      minWidth: '220px',
                      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
                      zIndex: 200,
                      backdropFilter: 'blur(16px)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                    }}
                  >
                    <Link
                      href={`/?ramo=${secao.id}&view=novo`}
                      onClick={() => setOpenDropdown(null)}
                      style={{
                        padding: '0.6rem 0.9rem',
                        borderRadius: '8px',
                        fontSize: '0.88rem',
                        fontWeight: 500,
                        textDecoration: 'none',
                        color: isRamoActive && pathname === '/' && currentView !== 'antigo' ? 'var(--primary)' : '#ededed',
                        background: isRamoActive && pathname === '/' && currentView !== 'antigo' ? 'rgba(0, 255, 136, 0.1)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <span>🧩</span> Programa Atualizado (18 Blocos)
                    </Link>

                    <Link
                      href={`/?ramo=${secao.id}&view=antigo`}
                      onClick={() => setOpenDropdown(null)}
                      style={{
                        padding: '0.6rem 0.9rem',
                        borderRadius: '8px',
                        fontSize: '0.88rem',
                        fontWeight: 500,
                        textDecoration: 'none',
                        color: isRamoActive && pathname === '/' && currentView === 'antigo' ? 'var(--primary)' : '#ededed',
                        background: isRamoActive && pathname === '/' && currentView === 'antigo' ? 'rgba(0, 255, 136, 0.1)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <span>📜</span> Programa Antigo (Paxtu)
                    </Link>

                    <Link
                      href={`/regras-equivalencia?ramo=${secao.id}`}
                      onClick={() => setOpenDropdown(null)}
                      style={{
                        padding: '0.6rem 0.9rem',
                        borderRadius: '8px',
                        fontSize: '0.88rem',
                        fontWeight: 500,
                        textDecoration: 'none',
                        color: isRamoActive && pathname === '/regras-equivalencia' ? 'var(--primary)' : '#ededed',
                        background: isRamoActive && pathname === '/regras-equivalencia' ? 'rgba(0, 255, 136, 0.1)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <span>📐</span> Matriz de Equivalência
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Ações / Paxtu */}
        <div className="navbar-actions">
          <PaxtuConnectButton />
        </div>
      </div>
    </nav>
  );
}
