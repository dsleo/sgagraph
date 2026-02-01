import { COLORS, NODE_PALETTE } from './config';
import type { ConstellationEdge, ConstellationGraphData, ConstellationNode } from './types';

export type ProcessedGraph = {
    nodes: ConstellationNode[];
    edges: ConstellationEdge[];
    nodeTypes: string[];
    edgeTypes: string[];
    nodeColors: Record<string, string>;
    edgeColors: Record<string, string>;
    nodeById: Map<string, ConstellationNode>;
    outgoingEdgesBySource: Map<string, Array<{ s: string; t: string; dep: string }>>;
    incomingEdgesByTarget: Map<string, Array<{ s: string; t: string; dep: string }>>;
};

function romanToInt(roman: string): number {
    const s = roman.toUpperCase();
    const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let out = 0;
    for (let i = 0; i < s.length; i++) {
        const cur = map[s[i]] ?? 0;
        const next = map[s[i + 1]] ?? 0;
        if (cur < next) out -= cur;
        else out += cur;
    }
    return out || 0;
}

function labelSortKey(label: string): Array<string | number> {
    // SGA label examples: "I:5-1-5", "VIII:3-2-3".
    // We sort by:
    //   (roman numeral, then numeric segments)
    const m = label.trim().match(/^([IVXLCDM]+)\s*:(.*)$/i);
    if (!m) return [label.trim()];

    const roman = romanToInt(m[1]);
    const rest = m[2];
    const nums = rest
        .split(/[^0-9]+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => Number(x));

    return [roman, ...nums];
}

function compareLex(a: Array<string | number>, b: Array<string | number>): number {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const av = a[i];
        const bv = b[i];
        if (av === undefined && bv === undefined) return 0;
        if (av === undefined) return -1;
        if (bv === undefined) return 1;
        if (typeof av === 'number' && typeof bv === 'number') {
            if (av !== bv) return av - bv;
            continue;
        }
        const as = String(av);
        const bs = String(bv);
        if (as !== bs) return as.localeCompare(bs);
    }
    return 0;
}

function compareFirstOccurrence(a: ConstellationNode, b: ConstellationNode): number {
    const ap = a.position;
    const bp = b.position;

    const aLine = typeof ap?.line_start === 'number' ? ap!.line_start! : null;
    const bLine = typeof bp?.line_start === 'number' ? bp!.line_start! : null;
    if (aLine !== null && bLine !== null && aLine !== bLine) return aLine - bLine;
    if (aLine !== null && bLine === null) return -1;
    if (aLine === null && bLine !== null) return 1;

    const aCol = typeof ap?.col_start === 'number' ? ap!.col_start! : null;
    const bCol = typeof bp?.col_start === 'number' ? bp!.col_start! : null;
    if (aCol !== null && bCol !== null && aCol !== bCol) return aCol - bCol;

    const al = (a.label ?? '').toString().trim();
    const bl = (b.label ?? '').toString().trim();
    if (al && bl) return compareLex(labelSortKey(al), labelSortKey(bl));
    if (al && !bl) return -1;
    if (!al && bl) return 1;

    return String(a.id).localeCompare(String(b.id));
}

// Same semantic normalization as constellations/assets/modules/data.js
export function processGraphData(graphData: ConstellationGraphData): ProcessedGraph {
    const edges = (graphData.edges || [])
        .map((e) => {
            const dep = e.dependency_type || 'internal';
            const ref = (e as any).reference_type || (e as any).referenceType || null;
            const typ = (e as any).type || null;

            // Canonical semantics:
            // We render edges as SVG arrows from `source -> target`.
            // For `used_in`, we want the arrow to mean:
            //   prerequisite -> dependent
            // So `source` should already be the prerequisite and `target` the dependent.
            // (We normalize backend semantics in the API layer, not here.)
            // - For legacy/raw forms like "uses_result" / "uses_definition" /
            //   "is_corollary_of", we flip them into the same prerequisite ->
            //   result orientation and re-label as "used_in".
            if (dep === 'used_in') {
                return { ...e, dependency_type: 'used_in' };
            }
            if (dep === 'uses_result' || dep === 'uses_definition' || dep === 'is_corollary_of') {
                return { ...e, dependency_type: 'used_in', source: (e as any).target, target: (e as any).source };
            }
            if (dep === 'is_generalization_of' || dep === 'generalized_by') {
                return { ...e, dependency_type: 'generalized_by', source: (e as any).target, target: (e as any).source };
            }

            // Internal cross-references (\Cref, \ref, etc.) are also dependencies:
            // a node that references another node depends on it, so we want
            // prerequisite -> result (referenced -> referrer).
            if (dep === 'internal' && (ref === 'internal' || typ === 'internal')) {
                return { ...e, dependency_type: 'internal', source: (e as any).target, target: (e as any).source };
            }
            if (dep === 'provides_remark') {
                return null;
            }
            return e;
        })
        .filter(Boolean) as ConstellationEdge[];

    // Order nodes by first appearance in the source (position if present,
    // otherwise label-based ordering). This gives stable “reading order” indices.
    const nodes = [...(graphData.nodes || [])].sort(compareFirstOccurrence);
    nodes.forEach((n, i) => {
        (n as any).orderIndex = i + 1;
    });

    const nodeTypes = Array.from(new Set(nodes.map((d) => d.type)));
    const edgeTypes = Array.from(new Set(edges.map((d) => d.dependency_type || 'internal')));

    // Match Constellations: stable semantic order so colors are consistent across papers.
    const CANONICAL_NODE_TYPE_ORDER = [
        'theorem',
        'lemma',
        'proposition',
        'corollary',
        'definition',
        'remark',
        'conjecture',
        'assumption',
        'proof',
        'example',
        'claim',
        'fact',
        'observation',
        'external_reference',
        'unknown',
    ];

    const orderedNodeTypes = [
        ...CANONICAL_NODE_TYPE_ORDER.filter((t) => nodeTypes.includes(t)),
        ...nodeTypes.filter((t) => !CANONICAL_NODE_TYPE_ORDER.includes(t)).sort(),
    ];

    const nodeColors = orderedNodeTypes.reduce<Record<string, string>>((acc, type, i) => {
        acc[type] = NODE_PALETTE[i % NODE_PALETTE.length];
        return acc;
    }, {});

    const edgeColors = edgeTypes.reduce<Record<string, string>>((acc, type) => {
        acc[type] = COLORS.edges(type);
        return acc;
    }, {});

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const outgoingEdgesBySource = new Map<string, Array<{ s: string; t: string; dep: string }>>();
    const incomingEdgesByTarget = new Map<string, Array<{ s: string; t: string; dep: string }>>();

    edges.forEach((e) => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        const dep = e.dependency_type || 'internal';

        if (!outgoingEdgesBySource.has(s)) outgoingEdgesBySource.set(s, []);
        outgoingEdgesBySource.get(s)!.push({ s, t, dep });

        if (!incomingEdgesByTarget.has(t)) incomingEdgesByTarget.set(t, []);
        incomingEdgesByTarget.get(t)!.push({ s, t, dep });
    });

    return {
        nodes,
        edges,
        nodeTypes,
        edgeTypes,
        nodeColors,
        edgeColors,
        nodeById,
        outgoingEdgesBySource,
        incomingEdgesByTarget,
    };
}

export function edgeKey(s: string, t: string) {
    return `${s}=>${t}`;
}
