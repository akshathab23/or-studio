import React, { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';

interface PlotlyChartProps {
  data: Record<string, unknown>[];
  layout?: Record<string, unknown>;
  className?: string;
  height?: number;
}

export const PlotlyChart: React.FC<PlotlyChartProps> = ({
  data,
  layout = {},
  className = '',
  height = 340,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

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
        if (el) {
          try {
            plotlyApi.Plots.resize(el);
          } catch {
            // ignore resize errors during unmount
          }
        }
      });
    });

    const observer = new ResizeObserver(() => {
      if (el) {
        try {
          plotlyApi.Plots.resize(el);
        } catch {
          // ignore resize errors during unmount
        }
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
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
