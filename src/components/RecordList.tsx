'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { DATA_SOURCES, GROUP_COLORS, crimeGroup, recordDate, type Incident } from '@/lib/crime';

const rowHeight = 126;
export default function RecordList({ incidents, selectedId, onSelect, message }: {
  incidents: Incident[]; selectedId: string | null; onSelect: (id: string) => void; message?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (container.current) container.current.scrollTop = 0;
    setScrollTop(0);
  }, [incidents[0]?.id]);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const end = Math.min(incidents.length, Math.ceil((scrollTop + height) / rowHeight) + 4);
  return <div className="record-list" ref={container} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    {message && <div className="list-message" role="status">{message}</div>}
    <div className="virtual-records" style={{ height: incidents.length * rowHeight }}>
      {incidents.slice(start, end).map((item, index) => {
        const source = DATA_SOURCES.find((entry) => entry.id === item.source)!;
        return <button className={`record ${selectedId === item.id ? 'active' : ''}`} style={{ top: (start + index) * rowHeight, height: rowHeight }} key={item.id} onClick={() => onSelect(item.id)}>
          <span className="record-accent" style={{ background: GROUP_COLORS[crimeGroup(item.category)] }} />
          <span className="record-body"><span className="record-source" style={{ color: source.color }}>{source.shortLabel}{item.race ? ` / ${item.race}` : ''}</span>
            <strong>{item.description}</strong><span className="record-meta"><MapPin size={11} />{item.neighborhood || item.intersection || 'Location unavailable'}{item.county ? `, ${item.county}` : ''}</span>
            <span className="record-meta">{recordDate(item)}</span></span><ArrowUpRight size={14} className="record-arrow" />
        </button>;
      })}
    </div>
  </div>;
}
