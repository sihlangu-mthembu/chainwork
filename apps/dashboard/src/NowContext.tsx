/**
 * SPDX-License-Identifier: MIT
 * One 1-second tick for every countdown on the page (challenge windows, session expiry).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const NowContext = createContext<number>(nowSeconds());

export function NowProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState<number>(nowSeconds());
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowSeconds()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export function useNow(): number {
  return useContext(NowContext);
}
