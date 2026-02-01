'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSearchParams } from 'next/navigation';

import Graph, { type ConstellationsGraphHandle } from '@/components/Graph';
import { loadLocalArxiTexExport } from '@/lib/localData';
import { injectMathJaxMacros } from '@/components/constellations/mathjax';
import { typesetMath } from '@/components/constellations/mathjax';
import { formatMathToHtml } from '@/components/constellations/format';

type ProcessStats = {
    artifacts: number;
    links: number;
};

function prettyTitleFromSlug(slug: string): string {
    // Default: make a readable title for known slugs.
    if (slug === 'sga4-5' || slug === 'sga4.5') return 'S.G.A 4 1/2';
    return slug;
}

export default function GraphPage() {
    const params = useParams<{ slug: string }>();
    const searchParams = useSearchParams();
    const slug = params.slug;

    const auditMode = searchParams?.get('audit') === '1';

    const graphRef = useRef<ConstellationsGraphHandle | null>(null);
    // NOTE: kept for future UI affordances (e.g. loading indicator / error banner)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [error, setError] = useState<string | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [isLoading, setIsLoading] = useState(false);

    const [title, setTitle] = useState<string>('');
    const [latexMacros, setLatexMacros] = useState<Record<string, string | [string, number]>>({});
    const [stats, setStats] = useState<ProcessStats>({ artifacts: 0, links: 0 });

    const [rawNodes, setRawNodes] = useState<any[]>([]);
    const auditRef = useRef<HTMLDivElement | null>(null);
    const [auditErrors, setAuditErrors] = useState<Array<{ id: string; type?: string; label?: string }>>([]);

    const [infoOpen, setInfoOpen] = useState(false);

    const overlayTitle = useMemo(() => {
        // Prefer the dataset-provided title (graph.arxiv_id), but keep a slug-based fallback.
        const base = title || prettyTitleFromSlug(slug);
        // Normalize SGA formatting.
        if (base === 'sga4.5' || base === 'SGA 4 1/2') return 'S.G.A 4 1/2';
        return base;
    }, [slug, title]);

    const sgaPdfUrl = useMemo(() => {
        // For now we only have a curated PDF link for SGA 4 1/2.
        if (slug === 'sga4-5' || slug === 'sga4.5') {
            return 'https://matematicas.unex.es/~navarro/res/sga/SGA%204%20%26%20HALF%20-%20Cohomologie%20Etale.pdf';
        }
        return null;
    }, [slug]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const absUrl = useMemo(() => {
        const maybeId = slug.replace(/_/g, '/');
        if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(maybeId) || /^[a-z-]+\/\d{7}(?:v\d+)?$/i.test(maybeId)) {
            return `https://arxiv.org/abs/${maybeId.replace(/v\d+$/i, '')}`;
        }
        return null;
    }, [slug]);

    useEffect(() => {
        let cancelled = false;

        async function run() {
            setIsLoading(true);
            setError(null);
            setLatexMacros({});

            try {
                const payload = await loadLocalArxiTexExport(slug);
                if (cancelled) return;

                const g = payload?.graph ?? {};
                const nodes: any[] = Array.isArray(g?.nodes) ? g.nodes : [];
                const edges: any[] = Array.isArray(g?.edges) ? g.edges : [];

                setRawNodes(nodes);

                graphRef.current?.reset();

                for (const node of nodes) {
                    graphRef.current?.ingest({ type: 'node', data: node });
                }
                for (const edge of edges) {
                    graphRef.current?.ingest({ type: 'link', data: edge });
                }

                setStats({ artifacts: nodes.length, links: edges.length });

                const m = (payload?.latex_macros ?? {}) as Record<string, string | [string, number]>;
                // We keep the macro map in state so audit/debug overlays can show it if needed.
                // In normal mode it is not rendered.
                setLatexMacros(m);

                injectMathJaxMacros(m);

                setTitle(String(g?.arxiv_id ?? g?.paper_id ?? slug));
            } catch (e: any) {
                if (cancelled) return;
                const msg = e?.message ?? String(e);
                setError(msg);
            } finally {
                if (cancelled) return;
                setIsLoading(false);
            }
        }

        void run();
        return () => {
            cancelled = true;
        };
    }, [slug]);

    // First-visit info modal (persisted per-graph via localStorage).
    useEffect(() => {
        try {
            // Versioned key so we can evolve the modal copy/UX without users
            // getting stuck in a permanently dismissed state.
            const key = `sgagraph-info-dismissed:v2:${slug}`;
            const dismissed = window.localStorage.getItem(key) === '1';
            if (!dismissed) setInfoOpen(true);
        } catch {
            // ignore
        }
    }, [slug]);

    const dismissInfo = () => {
        try {
            window.localStorage.setItem(`sgagraph-info-dismissed:v2:${slug}`, '1');
        } catch {
            // ignore
        }
        setInfoOpen(false);
    };

    // Dev-only audit mode: render all node previews into a hidden container,
    // typeset them once, then report any MathJax parse errors.
    useEffect(() => {
        if (!auditMode) return;
        if (!auditRef.current) return;
        if (!rawNodes.length) return;

        let cancelled = false;

        async function runAudit() {
            // Give the DOM a tick to paint.
            await new Promise((r) => setTimeout(r, 50));
            await typesetMath([auditRef.current]);

            if (cancelled) return;

            const errors: Array<{ id: string; type?: string; label?: string }> = [];
            const merrors = Array.from(auditRef.current!.querySelectorAll('mjx-merror'));
            for (const m of merrors) {
                const row = (m as HTMLElement).closest('[data-node-id]') as HTMLElement | null;
                if (!row) continue;
                const id = row.getAttribute('data-node-id') || '';
                const type = row.getAttribute('data-node-type') || undefined;
                const label = row.getAttribute('data-node-label') || undefined;
                if (!id) continue;
                if (!errors.some((e) => e.id === id)) errors.push({ id, type, label });
            }

            // Also treat leftover Xy-pic commands as an issue (they will likely
            // render as plain text / cause errors depending on context).
            const leftovers = Array.from(auditRef.current!.querySelectorAll('[data-node-id]'))
                .map((el) => {
                    const row = el as HTMLElement;
                    const html = row.innerHTML;
                    if (/\\ar@|\\ar\[|\\xymatrix/.test(html)) {
                        const id = row.getAttribute('data-node-id') || '';
                        const type = row.getAttribute('data-node-type') || undefined;
                        const label = row.getAttribute('data-node-label') || undefined;
                        return id ? { id, type, label } : null;
                    }
                    return null;
                })
                .filter(Boolean) as Array<{ id: string; type?: string; label?: string }>;

            for (const e of leftovers) {
                if (!errors.some((x) => x.id === e.id)) errors.push(e);
            }

            setAuditErrors(errors);
            // Log a concise report for copy/paste.
            console.groupCollapsed(`[Math audit] ${slug}: ${errors.length} problematic nodes`);
            console.table(errors);
            console.groupEnd();
        }

        void runAudit();
        return () => {
            cancelled = true;
        };
    }, [auditMode, rawNodes, slug]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _unusedLatexMacros = latexMacros;

    return (
        <main
            className="relative w-screen h-screen overflow-hidden"
            style={{ background: 'var(--background)', color: 'var(--primary-text)' }}
        >
            {/* Fullscreen graph background */}
            <div className="fixed inset-0 z-0">
                <Graph ref={graphRef} stats={stats} />
            </div>

            {/* Minimal top overlay */}
            <div className="relative z-10 flex flex-col items-center px-4 sm:px-8 md:px-12 pt-4 sm:pt-8 pointer-events-none">
                <div className="w-full max-w-4xl text-center">
                    <h1 className="text-4xl sm:text-5xl font-black tracking-tight" style={{ color: 'var(--accent)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'baseline' }}>
                            {sgaPdfUrl ? (
                                <a
                                    href={sgaPdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="graph-title-link"
                                    style={{ pointerEvents: 'auto', color: 'inherit' }}
                                    title="Open SGA 4 1/2 PDF"
                                >
                                    {overlayTitle}
                                </a>
                            ) : (
                                overlayTitle
                            )}

                            <sup>
                                <button
                                    type="button"
                                    className="graph-info-btn"
                                    style={{ pointerEvents: 'auto' }}
                                    aria-label="Graph info"
                                    title="Graph info"
                                    onClick={() => setInfoOpen(true)}
                                >
                                    i
                                </button>
                            </sup>
                        </span>
                    </h1>
                    {/* Subtitle removed per request */}
                </div>
            </div>

            {infoOpen ? (
                <div className="graph-info-modal" role="dialog" aria-modal="true" aria-label="Graph info">
                    <div className="graph-info-modal__backdrop" onClick={dismissInfo} />
                    <div className="graph-info-modal__card">
                        <div className="graph-info-modal__header">
                            <div className="graph-info-modal__title">About this graph</div>
                            <button
                                type="button"
                                className="graph-info-modal__close"
                                aria-label="Close"
                                title="Close"
                                onClick={dismissInfo}
                            >
                                ×
                            </button>
                        </div>

                        <div className="graph-info-modal__body">
                            <p>
                                This dependency graph was built by parsing{' '}
                                <a href="https://github.com/NomiL/sga4.5" target="_blank" rel="noreferrer">
                                    a LaTeX source
                                </a>{' '}
                                and extracting labeled mathematical statements (definitions/lemmas/propositions/theorems, etc.) and
                                their explicit cross-references.
                            </p>
                            <ul>
                                <li>Nodes are statements in the text, ordered by first appearance.</li>
                                <li>Directed edges indicate “uses / depends on”.</li>
                                <li>
                                    Some edges are <strong>inferred by an LLM</strong> and there is <strong>no guarantee of
                                        correctness</strong>.
                                </li>
                                <li>
                                    Some diagram-heavy fragments (e.g. Xy-pic) are replaced with a <code>[diagram]</code> placeholder
                                    to keep MathJax rendering stable.
                                </li>
                            </ul>
                            <p style={{ marginTop: 10 }}>
                                Tips: click a node to focus, right-click to explore a proof/prerequisite path, and use “Replay” to
                                reveal the graph in reading order.
                            </p>
                        </div>
                    </div>
                </div>
            ) : null}

            {auditMode ? (
                <div
                    className="fixed bottom-4 right-4 z-50"
                    style={{ pointerEvents: 'auto', width: 360, maxWidth: '92vw' }}
                >
                    <div
                        style={{
                            background: 'var(--surface2)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 10,
                            padding: 12,
                            boxShadow: '0 10px 25px rgba(0,0,0,0.35)',
                            fontFamily: 'Inter, system-ui, sans-serif',
                        }}
                    >
                        <div style={{ fontWeight: 800, color: 'var(--accent)' }}>Math audit mode</div>
                        <div style={{ fontSize: 12, color: 'var(--secondary-text)', marginTop: 4 }}>
                            Rendering all previews off-screen and checking for MathJax errors.
                        </div>

                        <div style={{ marginTop: 8, fontSize: 12 }}>
                            {rawNodes.length ? (
                                <>
                                    <div>Nodes: {rawNodes.length}</div>
                                    <div>Problems: {auditErrors.length}</div>
                                </>
                            ) : (
                                <div>Loading nodes…</div>
                            )}
                        </div>

                        {auditErrors.length ? (
                            <div style={{ marginTop: 8, maxHeight: 180, overflow: 'auto', fontSize: 12 }}>
                                {auditErrors.slice(0, 50).map((e) => (
                                    <div key={e.id} style={{ padding: '2px 0' }}>
                                        <code style={{ color: 'var(--primary-text)' }}>{e.label || e.id}</code>{' '}
                                        <span style={{ color: 'var(--secondary-text)' }}>({e.type || 'node'})</span>
                                    </div>
                                ))}
                                {auditErrors.length > 50 ? (
                                    <div style={{ color: 'var(--secondary-text)', marginTop: 6 }}>
                                        (showing first 50)
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    {/* Hidden audit DOM (still typeset by MathJax). */}
                    <div
                        ref={auditRef}
                        style={{
                            position: 'fixed',
                            left: -10000,
                            top: -10000,
                            width: 800,
                            background: 'white',
                            color: 'black',
                            padding: 10,
                        }}
                    >
                        {rawNodes.map((n) => (
                            <div
                                key={n.id}
                                data-node-id={n.id}
                                data-node-type={n.type}
                                data-node-label={n.label}
                                style={{ marginBottom: 14 }}
                            >
                                <div style={{ fontWeight: 700 }}>{n.display_name || n.label || n.id}</div>
                                <div
                                    className="math-content"
                                    dangerouslySetInnerHTML={{
                                        __html: formatMathToHtml(n.content_preview || n.content || ''),
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </main>
    );
}
