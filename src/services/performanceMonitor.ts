/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Monitor leve de Real User Monitoring (RUM) baseado em PerformanceObserver nativo.
 * Coleta apenas métricas técnicas anonimizadas (LCP, INP, CLS, TTFB, tempos de API e falhas JS),
 * sem PII, tokens, emails ou dados de sessão.
 */

export interface PerfMetricSnapshot {
  lcpMs?: number;
  inpMs?: number;
  cls?: number;
  ttfbMs?: number;
  apiTimings: Array<{ route: string; durationMs: number; status: number }>;
  jsErrors: number;
  path: string;
}

class PerformanceMonitor {
  private started = false;
  private flushed = false;
  private snapshot: PerfMetricSnapshot = {
    apiTimings: [],
    jsErrors: 0,
    path: '/',
  };
  private observers: PerformanceObserver[] = [];
  private maxInp = 0;
  private clsScore = 0;

  public start(): void {
    if (this.started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
      return;
    }
    this.started = true;
    this.snapshot.path = window.location?.pathname || '/';

    // TTFB via Navigation Timing
    try {
      const navEntries = performance.getEntriesByType?.('navigation') as PerformanceNavigationTiming[] | undefined;
      const nav = navEntries?.[0];
      if (nav && typeof nav.responseStart === 'number' && nav.responseStart > 0) {
        this.snapshot.ttfbMs = Math.round(nav.responseStart - nav.startTime);
      }
    } catch {}

    // LCP Observer
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1] as PerformanceEntry | undefined;
        if (last) {
          this.snapshot.lcpMs = Math.round(last.startTime);
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true } as any);
      this.observers.push(lcpObserver);
    } catch {}

    // CLS Observer
    try {
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          if (!entry.hadRecentInput) {
            this.clsScore += Number(entry.value || 0);
            this.snapshot.cls = Number(this.clsScore.toFixed(4));
          }
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true } as any);
      this.observers.push(clsObserver);
    } catch {}

    // INP approximation via Event Timing
    try {
      const inpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          const dur = Number(entry.duration || 0);
          if (entry.interactionId && dur > this.maxInp) {
            this.maxInp = dur;
            this.snapshot.inpMs = Math.round(this.maxInp);
          }
        }
      });
      inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 40 } as any);
      this.observers.push(inpObserver);
    } catch {}

    // Contagem sanitizada de erros JS (sem payload sensível)
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onError);

    // Flush ao ocultar página (beacon não bloqueante)
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onError = (): void => {
    this.snapshot.jsErrors += 1;
  };

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.flush();
    }
  };

  public trackApiCall(route: string, durationMs: number, status: number): void {
    const cleanRoute = String(route || '').split('?')[0].slice(0, 80);
    if (!cleanRoute) return;
    if (this.snapshot.apiTimings.length >= 25) {
      this.snapshot.apiTimings.shift();
    }
    this.snapshot.apiTimings.push({
      route: cleanRoute,
      durationMs: Math.round(durationMs),
      status: Number(status || 0),
    });
  }

  public getSnapshot(): PerfMetricSnapshot {
    return {
      ...this.snapshot,
      apiTimings: [...this.snapshot.apiTimings],
    };
  }

  public flush(): void {
    if (this.flushed || typeof window === 'undefined') return;
    if (
      this.snapshot.lcpMs === undefined &&
      this.snapshot.ttfbMs === undefined &&
      this.snapshot.apiTimings.length === 0
    ) {
      return;
    }

    this.flushed = true;
    const payload = JSON.stringify({
      lcpMs: this.snapshot.lcpMs,
      inpMs: this.snapshot.inpMs,
      cls: this.snapshot.cls,
      ttfbMs: this.snapshot.ttfbMs,
      jsErrors: this.snapshot.jsErrors,
      path: this.snapshot.path,
      apiCount: this.snapshot.apiTimings.length,
    });

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/proxy/perf', blob);
        return;
      }
      fetch('/api/proxy/perf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }

  public stop(): void {
    this.observers.forEach((obs) => {
      try {
        obs.disconnect();
      } catch {}
    });
    this.observers = [];
    if (typeof window !== 'undefined') {
      window.removeEventListener('error', this.onError);
      window.removeEventListener('unhandledrejection', this.onError);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }
}

export const performanceMonitor = new PerformanceMonitor();
