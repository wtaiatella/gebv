'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import type { Escoteiro, Ramo } from '@/app/lib/data';

type ScoutContextType = {
  ramoAtual: Ramo;
  setRamoAtual: (ramo: Ramo) => Promise<void>;
  escoteiros: Escoteiro[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  selectedScout: Escoteiro | null;
  viewMode: 'novo' | 'antigo';
  setViewMode: (mode: 'novo' | 'antigo') => void;
  exibirMatriz: boolean;
  setExibirMatriz: (show: boolean) => void;
  isLoading: boolean;
  refreshEscoteiros: (targetRamo?: Ramo) => Promise<Escoteiro[]>;
};

const ScoutContext = createContext<ScoutContextType | null>(null);

type ScoutProviderProps = {
  children: React.ReactNode;
  initialEscoteiros: Escoteiro[];
  initialRamo?: Ramo;
  initialSelectedId?: string;
  initialView?: 'novo' | 'antigo';
};

export function ScoutProvider({
  children,
  initialEscoteiros,
  initialRamo = 'Escoteiro',
  initialSelectedId = '',
  initialView = 'novo',
}: ScoutProviderProps) {
  const [ramoAtual, setRamoState] = useState<Ramo>(initialRamo);
  const [escoteiros, setEscoteiros] = useState<Escoteiro[]>(initialEscoteiros);
  const [selectedId, setSelectedIdState] = useState<string>(() => {
    if (initialSelectedId) return initialSelectedId;
    return initialEscoteiros[0]?.associado.cd_associado || '';
  });
  const [viewMode, setViewModeState] = useState<'novo' | 'antigo'>(initialView);
  const [exibirMatriz, setExibirMatriz] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Sincroniza a URL suavemente sem reload
  const syncUrl = useCallback((ramo: Ramo, jovemId: string, view: 'novo' | 'antigo') => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('ramo', ramo);
    if (jovemId) {
      url.searchParams.set('jovem', jovemId);
    } else {
      url.searchParams.delete('jovem');
    }
    url.searchParams.set('view', view);
    window.history.replaceState(null, '', url.pathname + url.search);
  }, []);

  const setSelectedId = useCallback((id: string) => {
    setSelectedIdState(id);
    syncUrl(ramoAtual, id, viewMode);
  }, [ramoAtual, viewMode, syncUrl]);

  const setViewMode = useCallback((mode: 'novo' | 'antigo') => {
    setViewModeState(mode);
    syncUrl(ramoAtual, selectedId, mode);
  }, [ramoAtual, selectedId, syncUrl]);

  // Função para buscar a lista viva de escoteiros via API
  const refreshEscoteiros = useCallback(
    async (targetRamo?: Ramo): Promise<Escoteiro[]> => {
      const ramo = targetRamo || ramoAtual;
      setIsLoading(true);
      try {
        const res = await fetch(`/api/escoteiros?ramo=${encodeURIComponent(ramo)}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.escoteiros)) {
          const newList: Escoteiro[] = data.escoteiros;
          setEscoteiros(newList);

          // Se o jovem selecionado anteriormente ainda estiver na lista nova, mantém ele; caso contrário, seleciona o primeiro
          setSelectedIdState((currentId) => {
            const exists = newList.some((e) => e.associado.cd_associado === currentId);
            const nextId = exists ? currentId : newList[0]?.associado.cd_associado || '';
            syncUrl(ramo, nextId, viewMode);
            return nextId;
          });

          return newList;
        }
        return [];
      } catch (err) {
        console.error('[ScoutContext] Falha ao atualizar escoteiros:', err);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [ramoAtual, viewMode, syncUrl]
  );

  // Troca de ramo no cliente
  const setRamoAtual = useCallback(
    async (novoRamo: Ramo) => {
      setRamoState(novoRamo);
      await refreshEscoteiros(novoRamo);
    },
    [refreshEscoteiros]
  );

  // Identifica o jovem selecionado
  const selectedScout = useMemo(() => {
    if (!escoteiros || escoteiros.length === 0) return null;
    return escoteiros.find((e) => e.associado.cd_associado === selectedId) || escoteiros[0] || null;
  }, [escoteiros, selectedId]);

  const value = useMemo(
    () => ({
      ramoAtual,
      setRamoAtual,
      escoteiros,
      selectedId,
      setSelectedId,
      selectedScout,
      viewMode,
      setViewMode,
      exibirMatriz,
      setExibirMatriz,
      isLoading,
      refreshEscoteiros,
    }),
    [
      ramoAtual,
      setRamoAtual,
      escoteiros,
      selectedId,
      setSelectedId,
      selectedScout,
      viewMode,
      setViewMode,
      exibirMatriz,
      setExibirMatriz,
      isLoading,
      refreshEscoteiros,
    ]
  );

  return <ScoutContext.Provider value={value}>{children}</ScoutContext.Provider>;
}

export function useScoutContext() {
  const context = useContext(ScoutContext);
  if (!context) {
    throw new Error('useScoutContext deve ser utilizado dentro de um <ScoutProvider>');
  }
  return context;
}
