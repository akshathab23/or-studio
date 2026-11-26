import React, { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';

interface PlotlyChartProps {
  data: Record<string, unknown>[];
  layout?: Record<string, unknown>;
  className?: string;
  height?: number;
  onPointClick?: (point: {
    x?: string | number;
    y?: number;
    curveNumber?: number;
    pointIndex?: number;
  }) => void;
}

export const PlotlyChart: React.FC<PlotlyChartProps> = ({
  data,
  layout = {},
  className = '',
  height = 340,
  onPointClick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onPointClickRef = useRef(onPointClick);
  onPointClickRef.current = onPointClick;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const plotlyApi =
      (Plotly as unknown as { default?: typeof Plotly }).default ?? Plotly;

    const mergedLayout: Record<string, unknown> = {
      font: { family: 'Inter, sans-serif', color: '#1e293b', size: 12 },
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      margin: { t: 48, r: 24, b: 56, l: 60 },
      hovermode: 'closest',
      legend: { orientation: 'h', y: -0.24 },
      ...layout,
      height,
    };

    const config: Record<string, unknown> = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    };

    void plotlyApi.react(el, data, mergedLayout, config).then(() => {
      requestAnimationFrame(() => {
        if (el && el.offsetParent !== null) {
          void Promise.resolve(plotlyApi.Plots.resize(el)).catch(() => {});
        }
      });
    });

    const handlePlotlyClick = (eventData: {
      points?: {
        x?: string | number;
        y?: number;
        curveNumber?: number;
        pointIndex?: number;
      }[];
    }) => {
      const pt = eventData?.points?.[0];
      if (pt && onPointClickRef.current) {
        onPointClickRef.current({
          x: pt.x,
          y: pt.y,
          curveNumber: pt.curveNumber,
          pointIndex: pt.pointIndex,
        });
      }
    };

    const plotlyEl = el as HTMLDivElement & {
      on?: (event: string, cb: (data: never) => void) => void;
      removeListener?: (event: string, cb: (data: never) => void) => void;
    };
    plotlyEl.on?.('plotly_click', handlePlotlyClick as (data: never) => void);

    const observer = new ResizeObserver(() => {
      if (el && el.offsetParent !== null) {
        void Promise.resolve(plotlyApi.Plots.resize(el)).catch(() => {});
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      plotlyEl.removeListener?.('plotly_click', handlePlotlyClick as (data: never) => void);
      try {
        plotlyApi.purge(el);
      } catch {
        // ignore cleanup errors
      }
    };
  }, [data, layout, height]);

  return (
    <div
      ref={containerRef}
      style={{ minHeight: height }}
      className={`w-full ${className}`}
    />
  );
};
