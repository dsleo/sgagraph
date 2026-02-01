declare global {
    interface Window {
        MathJax?: any;
        __ARXIGRAPH_PENDING_MATHJAX_MACROS?: Record<string, MathJaxMacroValue>;
        __ARXIGRAPH_MACRO_MERGE_TIMER?: number | null;
    }
}

export type MathJaxMacroValue = string | [string, number];

function normalizeMacroValue(v: MathJaxMacroValue): MathJaxMacroValue {
    if (typeof v === 'string') {
        // Replace *double* backslashes with a single backslash.
        // (In a JS regex literal, /\\\\/ matches two consecutive '\\' chars.)
        return v.replace(/\\\\/g, '\\');
    }
    return [String(v[0]).replace(/\\\\/g, '\\'), v[1]];
}

function shouldSkipTraversalObject(v: any): boolean {
    // Avoid traversing DOM nodes or very large/complex objects.
    if (!v || typeof v !== 'object') return true;
    const t = (v as any).nodeType;
    if (typeof t === 'number') return true;
    return false;
}

/**
 * Best-effort: find any live MathJax TeX parser macro tables and merge into
 * them. MathJax's internal object model varies depending on the bundle.
 */
function mergeIntoLiveMacroTables(mj: any, macros: Record<string, MathJaxMacroValue>) {
    const seen = new Set<any>();
    const queue: any[] = [mj?.startup, mj?.startup?.document, mj];
    let steps = 0;

    while (queue.length && steps < 5000) {
        const cur = queue.shift();
        steps++;
        if (!cur || typeof cur !== 'object') continue;
        if (seen.has(cur)) continue;
        seen.add(cur);

        // Common location: texJax.parseOptions.options.macros
        const macroTable = (cur as any)?.parseOptions?.options?.macros;
        if (macroTable && typeof macroTable === 'object') {
            Object.assign(macroTable, macros);
        }

        // Also handle cur.options.macros (seen in some builds)
        const macroTable2 = (cur as any)?.options?.macros;
        if (macroTable2 && typeof macroTable2 === 'object') {
            Object.assign(macroTable2, macros);
        }

        // Traverse children
        if (Array.isArray(cur)) {
            for (const v of cur) {
                if (v && typeof v === 'object' && !shouldSkipTraversalObject(v)) queue.push(v);
            }
            continue;
        }

        for (const [k, v] of Object.entries(cur)) {
            if (k.startsWith('_')) continue;
            if (!v || typeof v !== 'object') continue;
            if (shouldSkipTraversalObject(v)) continue;
            queue.push(v);
        }
    }
}

/**
 * Merge macros into MathJax at runtime.
 *
 * MathJax v3 has multiple internal macro tables:
 * - `MathJax.config.tex.macros` (startup config)
 * - the TeX input jax `parseOptions.options.macros` (live parser)
 *
 * Updating only the config object is not always enough once MathJax has
 * initialized. This helper updates both (when available).
 */
export function injectMathJaxMacros(macros: Record<string, MathJaxMacroValue>) {
    if (typeof window === 'undefined') return;
    const mj = window.MathJax;
    // Always stash macros for the startup hook (covers the case where we inject
    // before MathJax has fully initialized).
    window.__ARXIGRAPH_PENDING_MATHJAX_MACROS = window.__ARXIGRAPH_PENDING_MATHJAX_MACROS || {};

    // Normalize macro bodies: datasets may contain double-escaped backslashes
    // from JSON/Python pipelines ("\\\\alpha" instead of "\\alpha").
    // MathJax expects single-backslash TeX strings.
    const normalized: Record<string, MathJaxMacroValue> = {};
    for (const [k, v] of Object.entries(macros)) {
        normalized[k] = normalizeMacroValue(v);
    }

    Object.assign(window.__ARXIGRAPH_PENDING_MATHJAX_MACROS, normalized);

    if (!mj) return;

    function mergeIntoCanonicalLiveTable(): boolean {
        const live = mj.startup?.document?.inputJax?.tex?.parseOptions?.options?.macros;
        if (live && typeof live === 'object') {
            Object.assign(live, normalized);
            return true;
        }
        return false;
    }

    // 1) Always update the config object (used for new TeX input instances).
    const texCfg = mj.config?.tex ?? mj.tex;
    if (texCfg) {
        const existing = (texCfg.macros ??= {});
        Object.assign(existing, normalized);
    }

    // 1b) Update the canonical live location used by the v3 startup Document.
    // This is the most important table for "Undefined control sequence" errors.
    // 1b) Ensure macros end up in the canonical live table.
    // This table may not exist yet at the moment we inject, so we retry:
    // - once MathJax startup promise resolves (preferred)
    // - and via a short interval fallback.
    const mergedNow = mergeIntoCanonicalLiveTable();
    if (!mergedNow) {
        const p = mj.startup?.promise;
        if (p && typeof p.then === 'function') {
            p.then(() => {
                mergeIntoCanonicalLiveTable();
            }).catch(() => {
                // ignore
            });
        }

        if (!window.__ARXIGRAPH_MACRO_MERGE_TIMER) {
            window.__ARXIGRAPH_MACRO_MERGE_TIMER = window.setInterval(() => {
                if (mergeIntoCanonicalLiveTable()) {
                    if (window.__ARXIGRAPH_MACRO_MERGE_TIMER) {
                        window.clearInterval(window.__ARXIGRAPH_MACRO_MERGE_TIMER);
                    }
                    window.__ARXIGRAPH_MACRO_MERGE_TIMER = null;
                }
            }, 50);
        }
    }

    // 2) Best-effort: also update any live TeX parser macro tables.
    mergeIntoLiveMacroTables(mj, normalized);

    // Finally, reset parser caches when available.
    try {
        if (typeof mj.texReset === 'function') mj.texReset();
    } catch {
        // ignore
    }
}

export async function typesetMath(elements: Array<Element | null | undefined>) {
    try {
        if (typeof window === 'undefined') return;

        const filtered = elements.filter(Boolean) as Element[];
        if (!filtered.length) return;

        // Wait for MathJax to be ready (v3 exposes startup.promise)
        for (let i = 0; i < 20; i++) {
            const mj = window.MathJax;
            if (mj && typeof mj.typesetPromise === 'function') {
                if (mj.startup?.promise) {
                    await mj.startup.promise;
                }

                // If macros/config were updated after startup, MathJax may keep
                // stale TeX parser state. Reset before typesetting.
                // This is especially important for per-graph/per-paper macro
                // injection.
                if (typeof mj.texReset === 'function') {
                    mj.texReset();
                }
                if (typeof mj.typesetClear === 'function') {
                    mj.typesetClear(filtered);
                }

                await mj.typesetPromise(filtered);
                return;
            }
            await new Promise((r) => setTimeout(r, 50));
        }
    } catch (e) {
        // Best effort only
        console.warn('MathJax typesetting failed', e);
    }
}
