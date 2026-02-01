'use client';

import * as d3 from 'd3';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { getMaxPrereqDepth, recomputeProofSubgraph } from './constellations/proof';
import { edgeKey } from './constellations/data';
import { buildDistillModel, renderDistilledWindow } from './constellations/distiller';
import { ZOOM_EXTENT } from './constellations/config';

import {
    hideInfoPanel,
    hideTooltip,
    renderNodeTooltip,
    updateInfoPanel,
} from './constellations/ui';

import {
    addEdge,
    applyMutations,
    initIncrementalGraph,
    upsertNode,
    type IncrementalGraphState,
} from './constellations/incremental';

import type { ConstellationEdge, ConstellationNode } from './constellations/types';

type Props = {
    nodes?: ConstellationNode[];
    links?: ConstellationEdge[];
    onReportNode?: (node: { id: string; label: string; type?: string }) => void;
    stats?: { artifacts: number; links: number };
    onReportGraph?: () => void;
};

export type GraphIngestEvent = { type: string; data?: any };

export type ConstellationsGraphHandle = {
    ingest: (ev: GraphIngestEvent) => void;
    reset: () => void;
};

const ConstellationsGraph = forwardRef<ConstellationsGraphHandle, Props>(function ConstellationsGraph(
    { nodes = [], links = [], onReportNode, stats, onReportGraph },
    ref,
) {
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const tooltipRef = useRef<HTMLDivElement>(null);
    const infoPanelRef = useRef<HTMLDivElement>(null);
    const infoTitleRef = useRef<HTMLDivElement>(null);
    const infoBodyRef = useRef<HTMLDivElement>(null);

    const [legendOpen, setLegendOpen] = useState(false);
    const [liveReplayRunning, setLiveReplayRunning] = useState(false);
    // Default to the middle of the slider range.
    // Slider range is 100..2000; middle is ~1050ms.
    const [liveReplayIntervalMs, setLiveReplayIntervalMs] = useState(1050);
    const liveReplayTimerRef = useRef<number | null>(null);
    const liveReplayStateRef = useRef<{
        ordered: any[];
        edges: any[];
        graphData: any;
        visibleNodes: Set<string>;
        visibleEdges: Set<string>;
        reveal: () => void;
        refs: any;
    } | null>(null);

    // Ensure we only perform an automatic initial zoom-to-fit once per
    // component lifecycle, after the first graph is laid out.
    const [didInitialZoom, setDidInitialZoom] = useState(false);

    const [state] = useState(() => ({
        pinned: false,
        pinnedNode: null as any,
        hiddenTypes: new Set<string>(),
        // Default: hide the below-node type labels to keep the graph clean.
        showNodeTypeLabels: false,
        proofMode: false,
        proofTargetId: null as string | null,
        proofDepth: 1,
        proofVisibleNodes: new Set<string>(),
        proofVisibleEdges: new Set<string>(),
        graphData: null as any,
        refs: null as any,
    }));

    const igRef = useRef<IncrementalGraphState | null>(null);

    // Initial load (non-streaming): ingest given arrays once, then perform
    // an automatic zoom-to-fit so the user immediately sees the whole graph.
    useEffect(() => {
        if (!nodes.length && !links.length) return;
        if (!igRef.current) return;

        for (const n of nodes) upsertNode(igRef.current, n);
        for (const e of links) addEdge(igRef.current, e);

        applyMutations(igRef.current, state, actions);

        if (!didInitialZoom) {
            // Allow a short delay so the simulation takes a few steps and
            // nodes have reasonable positions before we fit the view.
            setTimeout(() => {
                actions.zoomToFit();
                setDidInitialZoom(true);
            }, 250);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Actions used by interaction/ui
    const actions = useMemo(() => {
        function computeGraphBBox(targetNodes?: any[]) {
            const refs = state.refs || {};
            const width = refs.width ?? svgRef.current?.getBoundingClientRect().width ?? 1;
            const height = refs.height ?? svgRef.current?.getBoundingClientRect().height ?? 1;

            const values: any[] =
                targetNodes && targetNodes.length
                    ? targetNodes
                    : Array.from((refs.nodeById as Map<string, any> | undefined)?.values?.() ?? []);

            const pts = values.filter((d) => typeof d?.x === 'number' && typeof d?.y === 'number');
            if (!pts.length) return null;

            let minX = pts[0].x;
            let maxX = pts[0].x;
            let minY = pts[0].y;
            let maxY = pts[0].y;
            for (const p of pts) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }

            return { minX, maxX, minY, maxY, width, height };
        }

        function zoomToBounds(bounds: { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number }) {
            const refs = state.refs || {};
            const svg = refs.svg as d3.Selection<SVGSVGElement, unknown, null, undefined> | undefined;
            const zoom = refs.zoom as d3.ZoomBehavior<SVGSVGElement, unknown> | undefined;
            if (!svg || !zoom) return;

            const { minX, maxX, minY, maxY, width, height } = bounds;
            const graphWidth = Math.max(1, maxX - minX);
            const graphHeight = Math.max(1, maxY - minY);
            const padding = 40;

            let scale = Math.min(
                width / (graphWidth + padding * 2),
                height / (graphHeight + padding * 2),
            );

            scale = Math.min(ZOOM_EXTENT[1], Math.max(ZOOM_EXTENT[0], scale * 0.9));

            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;

            const tx = width / 2 - scale * cx;
            const ty = height / 2 - scale * cy;

            const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
            svg.transition().duration(300).call(zoom.transform as any, transform);
        }

        return {
            // Kept for compatibility with the original Constellations interaction module.
            // We moved the proof controls into the right-side info panel.
            updateFloatingControls: () => { },

            updateVisibility: () => {
                const { node, label, index, link, simulation, graphData } = state.refs;
                node.style('display', (d: any) => (state.hiddenTypes.has(d.type) ? 'none' : null));
                // index labels follow nodes
                index?.style('display', (d: any) => (state.hiddenTypes.has(d.type) ? 'none' : null));
                // type labels are optional
                label.style('display', (d: any) => {
                    if (state.hiddenTypes.has(d.type)) return 'none';
                    return state.showNodeTypeLabels ? null : 'none';
                });
                link.style('display', (d: any) => {
                    const sType = typeof d.source === 'object'
                        ? d.source.type
                        : graphData.nodes.find((n: any) => n.id === d.source)?.type;
                    const tType = typeof d.target === 'object'
                        ? d.target.type
                        : graphData.nodes.find((n: any) => n.id === d.target)?.type;

                    const sourceVisible = !state.hiddenTypes.has(sType);
                    const targetVisible = !state.hiddenTypes.has(tType);
                    return sourceVisible && targetVisible ? null : 'none';
                });
                if (!state.pinned) simulation.alpha(0.3).restart();
            },

            toggleNodeTypeLabels: () => {
                state.showNodeTypeLabels = !state.showNodeTypeLabels;
                actions.updateVisibility();
            },

            startLiveReplay: () => {
                const refs = state.refs || {};
                const graphData = state.graphData || refs.graphData;
                const nodes: any[] = (graphData?.nodes ?? []) as any[];
                const edges: any[] = (graphData?.edges ?? []) as any[];
                if (!nodes.length) return;

                // Stop any prior run
                if (liveReplayTimerRef.current) {
                    window.clearInterval(liveReplayTimerRef.current);
                    liveReplayTimerRef.current = null;
                }

                setLiveReplayRunning(true);

                // Ensure normal mode interaction doesn’t “pin”/hide stuff.
                state.pinned = false;
                state.pinnedNode = null;
                state.proofMode = false;

                // Sort by computed reading order.
                const ordered = [...nodes].sort((a, b) => {
                    const ai = Number(a.orderIndex ?? 1e9);
                    const bi = Number(b.orderIndex ?? 1e9);
                    return ai - bi;
                });

                const visibleNodes = new Set<string>();
                const visibleEdges = new Set<string>();

                const reveal = () => {
                    const st = liveReplayStateRef.current;
                    if (!st) return;

                    const next = st.ordered[st.visibleNodes.size];
                    if (!next) {
                        actions.stopLiveReplay();
                        return;
                    }
                    st.visibleNodes.add(next.id);

                    // Any edge whose endpoints are visible should be shown.
                    for (const e of st.edges) {
                        const sId = typeof e.source === 'object' ? e.source.id : e.source;
                        const tId = typeof e.target === 'object' ? e.target.id : e.target;
                        if (st.visibleNodes.has(String(sId)) && st.visibleNodes.has(String(tId))) {
                            st.visibleEdges.add(edgeKey(String(sId), String(tId)));
                        }
                    }

                    // Apply visibility
                    st.refs.node.style('display', (d: any) => (st.visibleNodes.has(d.id) && !state.hiddenTypes.has(d.type) ? null : 'none'));
                    st.refs.index?.style('display', (d: any) => (st.visibleNodes.has(d.id) && !state.hiddenTypes.has(d.type) ? null : 'none'));
                    st.refs.label.style('display', (d: any) => {
                        if (!st.visibleNodes.has(d.id)) return 'none';
                        if (state.hiddenTypes.has(d.type)) return 'none';
                        return state.showNodeTypeLabels ? null : 'none';
                    });
                    st.refs.link.style('display', (l: any) => {
                        const sId = typeof l.source === 'object' ? l.source.id : l.source;
                        const tId = typeof l.target === 'object' ? l.target.id : l.target;
                        const sType = typeof l.source === 'object' ? l.source.type : (st.graphData.nodes.find((n: any) => n.id === sId)?.type);
                        const tType = typeof l.target === 'object' ? l.target.type : (st.graphData.nodes.find((n: any) => n.id === tId)?.type);
                        if (state.hiddenTypes.has(sType) || state.hiddenTypes.has(tType)) return 'none';
                        return st.visibleEdges.has(edgeKey(String(sId), String(tId))) ? null : 'none';
                    });

                    // Keep the force layout gently alive.
                    st.refs.simulation.alpha(0.15).restart();
                };

                // Store replay state so we can update interval live.
                liveReplayStateRef.current = {
                    ordered,
                    edges,
                    graphData,
                    visibleNodes,
                    visibleEdges,
                    reveal,
                    refs,
                };

                // Start from empty.
                refs.node.style('display', 'none');
                refs.index?.style('display', 'none');
                refs.label.style('display', 'none');
                refs.link.style('display', 'none');

                // Reveal first immediately, then tick.
                reveal();
                liveReplayTimerRef.current = window.setInterval(reveal, liveReplayIntervalMs);
            },

            stopLiveReplay: () => {
                if (liveReplayTimerRef.current) {
                    window.clearInterval(liveReplayTimerRef.current);
                    liveReplayTimerRef.current = null;
                }
                liveReplayStateRef.current = null;
                setLiveReplayRunning(false);
                actions.updateVisibility();
            },

            renderNodeTooltip: (event: any, d: any) => {
                if (tooltipRef.current) renderNodeTooltip(tooltipRef.current, event, d);
            },
            hideTooltip: () => {
                if (tooltipRef.current) hideTooltip(tooltipRef.current);
            },

            updateInfoPanel: (d: any) => {
                if (infoPanelRef.current && infoTitleRef.current && infoBodyRef.current) {
                    updateInfoPanel(infoPanelRef.current, infoTitleRef.current, infoBodyRef.current, d, state, actions);
                }
            },
            hideInfoPanel: () => {
                if (infoPanelRef.current) hideInfoPanel(infoPanelRef.current);
            },

            // Camera helpers -------------------------------------------------
            zoomToFit: () => {
                const bounds = computeGraphBBox();
                if (!bounds) return;
                zoomToBounds(bounds);
            },

            focusOnNode: (d: any) => {
                if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') return;
                const refs = state.refs || {};
                const svg = refs.svg as d3.Selection<SVGSVGElement, unknown, null, undefined> | undefined;
                const zoom = refs.zoom as d3.ZoomBehavior<SVGSVGElement, unknown> | undefined;
                const width = refs.width ?? svgRef.current?.getBoundingClientRect().width ?? 1;
                const height = refs.height ?? svgRef.current?.getBoundingClientRect().height ?? 1;
                if (!svg || !zoom) return;

                let scale = 2; // comfortable zoom on a single node
                scale = Math.min(ZOOM_EXTENT[1], Math.max(ZOOM_EXTENT[0], scale));

                const tx = width / 2 - scale * d.x;
                const ty = height / 2 - scale * d.y;
                const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
                svg.transition().duration(250).call(zoom.transform as any, transform);
            },

            enterProofMode: (targetId: string) => {
                state.proofMode = true;
                state.proofTargetId = targetId;
                state.proofDepth = 1;
                state.pinned = true;
                state.pinnedNode = state.refs.nodeById.get(targetId) || null;

                actions.hideTooltip();
                state.refs.node.classed('selected', (n: any) => n.id === targetId);

                actions.recomputeProofSubgraph();
                if (state.refs.nodeById.has(targetId)) actions.updateInfoPanel(state.refs.nodeById.get(targetId));

                const targetNode = state.refs.nodeById.get(targetId);
                if (targetNode) actions.focusOnNode(targetNode);
            },

            exitProofMode: () => {
                state.proofMode = false;
                state.proofTargetId = null;
                state.proofVisibleNodes = new Set();
                state.proofVisibleEdges = new Set();

                state.pinned = false;
                state.pinnedNode = null;
                state.refs.node.classed('selected', false);
                actions.hideInfoPanel();
                actions.updateVisibility();
            },

            recomputeProofSubgraph: () => {
                recomputeProofSubgraph(state, state.refs.incomingEdgesByTarget);
                const { node, label, index, link, simulation } = state.refs;
                node.style('display', (d: any) => (state.proofVisibleNodes.has(d.id) ? null : 'none'));
                index?.style('display', (d: any) => (state.proofVisibleNodes.has(d.id) ? null : 'none'));
                label.style('display', (d: any) => {
                    if (!state.proofVisibleNodes.has(d.id)) return 'none';
                    return state.showNodeTypeLabels ? null : 'none';
                });
                link.style('display', (l: any) => {
                    const sId = typeof l.source === 'object' ? l.source.id : l.source;
                    const tId = typeof l.target === 'object' ? l.target.id : l.target;
                    return state.proofVisibleEdges.has(edgeKey(sId, tId)) ? null : 'none';
                });
                simulation.alpha(0.3).restart();
            },

            unfoldLess: () => {
                if (!state.proofMode) return;
                state.proofDepth = Math.max(1, state.proofDepth - 1);
                actions.recomputeProofSubgraph();
                if (state.proofTargetId) actions.updateInfoPanel(state.refs.nodeById.get(state.proofTargetId));
            },

            unfoldMore: () => {
                if (!state.proofMode) return;
                // Use incomingEdgesByTarget so the depth calculation matches the
                // actual proof-subgraph traversal direction.
                const maxDepth = getMaxPrereqDepth(state.proofTargetId!, state.refs.incomingEdgesByTarget);

                // If there are no additional prerequisite layers, don't let
                // "Unfold More" accidentally *reduce* the visible depth.
                // Previously, when maxDepth was 0, the call to Math.min(0, depth+1)
                // would set proofDepth to 0, hiding all prerequisites and
                // making the control feel broken. Instead, we simply no-op
                // when there is nothing more to unfold.
                if (maxDepth <= state.proofDepth) return;

                state.proofDepth = Math.min(maxDepth, state.proofDepth + 1);
                actions.recomputeProofSubgraph();
                if (state.proofTargetId) actions.updateInfoPanel(state.refs.nodeById.get(state.proofTargetId));
            },

            generateDistilledProof: () => {
                if (!state.proofMode || !state.proofTargetId) return;

                // Ensure proof subgraph is up to date before building the model.
                actions.recomputeProofSubgraph();

                const graphData = state.graphData || { nodes: [], edges: [] };
                const model = buildDistillModel(
                    state,
                    state.refs.nodeById,
                    state.refs.incomingEdgesByTarget,
                    graphData,
                );

                renderDistilledWindow(model);
            },

            reportNodeIssue: (d: any) => {
                if (!onReportNode) return;
                const label = String(d?.display_name ?? d?.label ?? d?.id ?? '');
                const id = String(d?.id ?? '');
                const type = d?.type ? String(d.type) : undefined;
                if (!id) return;
                onReportNode({ id, label, type });
            },
        };
    }, [state, onReportNode, liveReplayIntervalMs]);

    // Cleanup timer on unmount.
    useEffect(() => {
        return () => {
            if (liveReplayTimerRef.current) {
                window.clearInterval(liveReplayTimerRef.current);
                liveReplayTimerRef.current = null;
            }
            liveReplayStateRef.current = null;
        };
    }, []);

    // If the user changes the replay speed while replay is running, apply it immediately.
    useEffect(() => {
        if (!liveReplayRunning) return;
        const st = liveReplayStateRef.current;
        if (!st) return;

        if (liveReplayTimerRef.current) {
            window.clearInterval(liveReplayTimerRef.current);
            liveReplayTimerRef.current = null;
        }

        liveReplayTimerRef.current = window.setInterval(st.reveal, liveReplayIntervalMs);
    }, [liveReplayIntervalMs, liveReplayRunning]);

    useEffect(() => {
        const svgEl = svgRef.current;
        if (!svgEl) return;

        const rect = svgEl.getBoundingClientRect();
        igRef.current = initIncrementalGraph({
            svgEl,
            width: rect.width,
            height: rect.height,
            state,
            actions,
        });

        // Close panel button
        const closeBtn = document.getElementById('close-info-panel');
        if (closeBtn)
            closeBtn.onclick = () => {
                if (state.proofMode) {
                    actions.exitProofMode();
                    return;
                }
                if (state.pinned) {
                    state.pinned = false;
                    state.pinnedNode = null;
                    state.refs.node.classed('selected', false);
                    actions.hideInfoPanel();
                    actions.updateVisibility();
                }
            };

        return () => {
            igRef.current?.simulation.stop();
            d3.select(svgEl).selectAll('*').remove();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
        ingest: (ev: GraphIngestEvent) => {
            if (!igRef.current) return;
            if (!ev || !ev.type) return;

            if (ev.type === 'node' && ev.data) {
                upsertNode(igRef.current, ev.data as any);
                applyMutations(igRef.current, state, actions);

                // If a node is pinned, refresh info panel so prerequisites update live.
                if (state.pinned && state.pinnedNode && state.pinnedNode.id === ev.data.id) {
                    actions.updateInfoPanel(state.pinnedNode);
                }
                return;
            }

            if (ev.type === 'link' && ev.data) {
                const { added } = addEdge(igRef.current, ev.data as any);
                if (added) {
                    applyMutations(igRef.current, state, actions);
                }
                return;
            }

            if (ev.type === 'reset') {
                igRef.current.nodeById.clear();
                igRef.current.edgeByKey.clear();
                applyMutations(igRef.current, state, actions);
            }
        },
        reset: () => {
            if (!igRef.current) return;
            igRef.current.nodeById.clear();
            igRef.current.edgeByKey.clear();
            applyMutations(igRef.current, state, actions);
        },
    }));

    return (
        <div className="graph-shell" ref={containerRef}>
            <div className="graph-container">
                <svg ref={svgRef} id="graph" className="w-full h-full" />

                <div id="tooltip" ref={tooltipRef} />

                <div id="info-panel" ref={infoPanelRef}>
                    <div id="info-header" className="info-header">
                        <div id="info-title" ref={infoTitleRef} />
                        <button id="close-info-panel" className="close-btn" aria-label="Close">×</button>
                    </div>
                    <div id="info-body" className="info-content" ref={infoBodyRef} />
                </div>

                <div className={legendOpen ? 'legend' : 'legend legend--collapsed'}>
                    <div className="legend-header">
                        {!legendOpen ? (
                            <>
                                <h3 className="legend-title">Legend</h3>
                                <button
                                    type="button"
                                    className="legend-toggle"
                                    aria-label="Expand legend"
                                    onClick={() => setLegendOpen(true)}
                                >
                                    ▸
                                </button>
                            </>
                        ) : null}
                    </div>

                    <div className="legend-body">
                        <div className="legend-section-header">
                            <div className="flex items-center gap-2">
                                <h3 style={{ margin: 0 }}>
                                    {typeof stats?.artifacts === 'number' && typeof stats?.links === 'number'
                                        ? `${stats.artifacts} artifacts · ${stats.links} links`
                                        : 'Legend'}
                                </h3>

                                <button
                                    type="button"
                                    className="inline-flex items-center justify-center px-1 py-0.5 text-xs rounded hover:bg-transparent"
                                    style={{ color: 'var(--secondary-text)' }}
                                    aria-label="Reset graph view"
                                    title="Reset view"
                                    onClick={actions.zoomToFit}
                                >
                                    Reset view
                                </button>

                                {onReportGraph ? (
                                    <button
                                        type="button"
                                        className="inline-flex items-center justify-center p-0.5 rounded hover:bg-transparent"
                                        style={{ color: 'var(--secondary-text)' }}
                                        aria-label="Suggest a correction"
                                        title="Suggest a correction"
                                        onClick={onReportGraph}
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <path d="M4 22V4" />
                                            <path d="M4 4h12l-1.5 4L20 12H4" />
                                        </svg>
                                    </button>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                className="legend-toggle"
                                aria-label="Collapse legend"
                                onClick={() => setLegendOpen(false)}
                            >
                                ▾
                            </button>
                        </div>
                        <div id="node-legend-container" className="legend-grid" />
                        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--secondary-text)' }}>
                            Click a node to focus. Right-click a node to explore proof path.
                        </p>
                    </div>
                </div>

                {/* Floating Live Replay control (bottom-right) */}
                <div className="graph-live-replay" role="group" aria-label="Live Replay controls">
                    <button
                        type="button"
                        className={liveReplayRunning ? 'graph-live-replay__btn graph-live-replay__btn--active' : 'graph-live-replay__btn'}
                        onClick={() => (liveReplayRunning ? actions.stopLiveReplay() : actions.startLiveReplay())}
                        title="Play/Pause Live Replay"
                        aria-label={liveReplayRunning ? 'Stop Live Replay' : 'Start Live Replay'}
                    >
                        {liveReplayRunning ? 'Stop' : 'Replay'}
                    </button>

                    <div className="graph-live-replay__speed" title="Left = slower, right = faster">
                        <span className="graph-live-replay__speed-end">Slow</span>
                        {/* Inverted slider: left = slower, right = faster */}
                        <input
                            type="range"
                            min={100}
                            max={2000}
                            step={100}
                            value={2100 - liveReplayIntervalMs}
                            onChange={(e) => setLiveReplayIntervalMs(2100 - Number(e.target.value))}
                            aria-label="Replay speed"
                        />
                        <span className="graph-live-replay__speed-end">Fast</span>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default ConstellationsGraph;
