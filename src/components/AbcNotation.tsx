'use client';

import { useEffect, useRef } from 'react';
import abcjs from 'abcjs';

interface AbcNotationProps {
  abcString: string;
  onRenderComplete?: () => void;
}

export default function AbcNotation({ abcString, onRenderComplete }: AbcNotationProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !abcString) return;

    try {
      // Clear previous render
      containerRef.current.innerHTML = '';

      // Calculate number of measures from ABC string
      // Count the bar lines (|) to estimate measures
      const barCount = (abcString.match(/\|/g) || []).length;
      const estimatedMeasures = Math.max(barCount, 4); // Minimum 4 measures

      // Calculate width: ~150 pixels per measure for comfortable spacing
      const pixelsPerMeasure = 150;
      const calculatedWidth = estimatedMeasures * pixelsPerMeasure;
      const staffWidth = Math.max(calculatedWidth, 600); // Minimum 600px

      // Render ABC notation with fixed width per measure
      abcjs.renderAbc(containerRef.current, abcString, {
        responsive: 'resize',
        staffwidth: staffWidth,
        scale: 1.0,
        paddingtop: 10,
        paddingbottom: 10,
        paddingleft: 10,
        paddingright: 10,
      });

      onRenderComplete?.();
    } catch (error) {
      console.error('Error rendering ABC notation:', error);
    }
  }, [abcString, onRenderComplete]);

  return (
    <div
      ref={containerRef}
      className="abc-notation-container"
      style={{ minHeight: '150px', width: '100%' }}
    />
  );
}
