/**
 * SPDX-License-Identifier: MIT
 * Loads the dashboard configuration once: Vite env first, then /deployment.json if the host has one.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  fetchDeployment,
  mergeDeployment,
  readConfig,
  type DashboardConfig,
  type DeploymentFile,
} from "./config";

export interface ConfigState {
  config: DashboardConfig;
  warnings: string[];
  /** True until the deployment.json lookup has finished (the env config is usable immediately). */
  loading: boolean;
  deploymentFound: boolean;
}

const ConfigContext = createContext<ConfigState | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const base = useMemo(
    () => readConfig(import.meta.env as unknown as Record<string, string | undefined>),
    [],
  );
  const [state, setState] = useState<ConfigState>({
    config: base,
    warnings: [],
    loading: true,
    deploymentFound: false,
  });

  useEffect(() => {
    let cancelled = false;
    void fetchDeployment()
      .then((file: DeploymentFile | null) => {
        if (cancelled) return;
        const merged = mergeDeployment(base, file);
        setState({
          config: merged.config,
          warnings: merged.warnings,
          loading: false,
          deploymentFound: file !== null,
        });
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  return <ConfigContext.Provider value={state}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigState {
  const value = useContext(ConfigContext);
  if (!value) throw new Error("useConfig must be used inside ConfigProvider");
  return value;
}
