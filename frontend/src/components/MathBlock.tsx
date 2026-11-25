import React, { useMemo } from 'react';
import katex from 'katex';

interface MathBlockProps {
  latex: string;
  displayMode?: boolean;
  className?: string;
}

export const MathBlock: React.FC<MathBlockProps> = ({
  latex,
  displayMode = true,
  className = '',
}) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        strict: false,
      });
    } catch {
      return latex;
    }
  }, [latex, displayMode]);

  return (
    <span
      className={`katex-wrapper ${displayMode ? 'block overflow-x-auto py-1' : 'inline-block'} ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
