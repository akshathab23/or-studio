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

    const mergedLayout: Record<string, unknown> = {
      font: { family: 'Inter, sans-serif', color: '#1e293b', size: 12 },
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      margin: { t: 44, r: 24, b: 48, l: 56 },
      hovermode: 'closest',
      legend: { orientation: 'h', y: -0.22 },
      ...layout,
      height,
    };

    const config: Record<string, unknown> = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    };

    void Plotly.react(el, data, mergedLayout, config);

    const observer = new ResizeObserver(() => {
      if (el) {
        Plotly.Plots.resize(el);
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      Plotly.purge(el);
    };
  }, [data, layout, height]);

  return <div ref={containerRef} className={`w-full ${className}`} />;
};
