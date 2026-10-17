'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { DATA_SOURCES, recordDate, type Incident } from '@/lib/crime';
import { offenseColor } from '@/lib/offense-taxonomy.mjs';
import LoadingSpinner from './LoadingSpinner';

const rowHeight = 126;
export default function RecordList({ incidents, selectedId, onSelect, message, loading = false }: {
  incidents: Incident[]; selectedId: string | null; onSelect: (id: string) => void; message?: string; loading?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [compact, setCompact] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (container.current) container.current.scrollTop = 0;
    setScrollTop(0);
    setPage(0);
  }, [incidents[0]?.id]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(incidents.length / 10) - 1));
  const start = compact ? currentPage * 10 : Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const end = Math.min(incidents.length, compact ? start + 10 : Math.ceil((scrollTop + height) / rowHeight) + 4);
  function changePage(next: number) {
    setPage(next);
    container.current?.scrollIntoView({ block: 'start' });
  }
  return <div className="record-list" ref={container} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    {message && <div className={`list-message${loading ? ' loading-message' : ''}`} role="status">{loading && <LoadingSpinner />}<span>{message}</span></div>}
    <div className={compact ? 'paged-records' : 'virtual-records'} style={compact ? undefined : { height: incidents.length * rowHeight }}>
      {incidents.slice(start, end).map((item, index) => {
        const source = DATA_SOURCES.find((entry) => entry.id === item.source)!;
        const categoryColor = offenseColor(item.category, item.description, item.standardOffense);
        return <button className={`record ${selectedId === item.id ? 'active' : ''}`} style={compact ? undefined : { top: (start + index) * rowHeight, height: rowHeight }} key={item.id} onClick={() => onSelect(item.id)}>
          <span className="record-accent" style={{ background: categoryColor, color: categoryColor }} />
          <span className="record-body"><span className="record-source" style={{ color: categoryColor }}>{source.shortLabel}{item.recordKind === 'publisher-rss-article' ? ' · ARTICLE' : item.recordKind === 'reviewed-news-incident' ? ' · REVIEWED' : ''}{item.standardOffense ? ` · ${item.standardOffense.toUpperCase()}` : ''}{item.relatedIncidentIds?.length ? ` · ${item.relatedIncidentIds.length} LINKED` : ''}{item.race ? ` / ${item.race}` : ''}</span>
            <strong>{item.description}</strong><span className="record-meta"><MapPin size={11} /><span className="record-location">{(item.source === 'news' ? item.intersection : item.neighborhood || item.intersection) || 'Location not available'}{item.county ? `, ${item.county}` : ''}</span></span>
            <span className="record-meta">{recordDate(item)}</span></span><ArrowUpRight size={14} className="record-arrow" />
        </button>;
      })}
    </div>
    {compact && incidents.length > 0 && <nav className="record-pagination" aria-label="Record pages"><span role="status">{start + 1}–{end} of {incidents.length.toLocaleString()} loaded</span><div><button type="button" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>Previous</button><button type="button" disabled={end >= incidents.length} onClick={() => changePage(currentPage + 1)}>Next</button></div></nav>}
  </div>;
}
