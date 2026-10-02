'use client';

import { useState, useCallback } from 'react';

export type SaveStatus = 'saving' | 'saved' | 'error';

export interface ItemSaveFeedback {
  status: SaveStatus;
  time?: string;
  error?: string;
}

export interface UseAutoSaveToggleOptions<T> {
  onSave: (id: number | string, nextValue: boolean, payload?: any) => Promise<T>;
  onSuccess?: (id: number | string, data: T) => void;
  onError?: (id: number | string, error: Error, prevValue: boolean) => void;
}

/**
 * Hook reutilizável de Auto-Save para toggle de ações e itens com:
 * 1. Atualização otimista imediata
 * 2. Feedback visual por item ('saving' | 'saved' | 'error')
 * 3. Rollback visual automático em caso de erro de rede ou backend
 */
export function useAutoSaveToggle<T = any>({
  onSave,
  onSuccess,
  onError,
}: UseAutoSaveToggleOptions<T>) {
  const [savingStatus, setSavingStatus] = useState<Record<string | number, ItemSaveFeedback>>({});
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  const toggle = useCallback(
    async (
      id: number | string,
      currentValue: boolean,
      optimisticUpdate: (nextValue: boolean) => void,
      rollbackUpdate: (prevValue: boolean) => void,
      payload?: any
    ) => {
      const nextValue = !currentValue;

      // 1. Atualização Otimista imediata
      optimisticUpdate(nextValue);

      // 2. Feedback de gravação em andamento
      setSavingStatus((prev) => ({
        ...prev,
        [id]: { status: 'saving' as const },
      }));

      try {
        // 3. Disparo da requisição sem debounce
        const result = await onSave(id, nextValue, payload);

        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        setSavingStatus((prev) => ({
          ...prev,
          [id]: { status: 'saved' as const, time: timeStr },
        }));
        setLastSavedTime(timeStr);

        if (onSuccess) {
          onSuccess(id, result);
        }

        return result;
      } catch (err: any) {
        // 4. Rollback visual imediato em caso de erro
        rollbackUpdate(currentValue);

        const errorMsg = err?.message || 'Falha ao salvar a alteração. Verifique a conexão com a rede.';
        setSavingStatus((prev) => ({
          ...prev,
          [id]: { status: 'error' as const, error: errorMsg },
        }));

        if (onError) {
          onError(id, err, currentValue);
        } else {
          alert(`Erro ao salvar: ${errorMsg}`);
        }

        throw err;
      }
    },
    [onSave, onSuccess, onError]
  );

  const clearStatus = useCallback((id: number | string) => {
    setSavingStatus((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const getStatus = useCallback(
    (id: number | string): ItemSaveFeedback | undefined => {
      return savingStatus[id];
    },
    [savingStatus]
  );

  return {
    savingStatus,
    getStatus,
    lastSavedTime,
    toggle,
    clearStatus,
    setSavingStatus,
  };
}
