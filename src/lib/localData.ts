export type ArxiTexExportPayload = {
    graph: any;
    definition_bank?: any | null;
    artifact_to_terms_map?: Record<string, string[]> | null;
    // MathJax v3 `tex.macros` values can be:
    // - a string replacement: "\\RR": "\\mathbb{R}"
    // - an array [body, nArgs]: "\\an": ["{#1^{\\mathrm{an}}}", 1]
    // We allow either form.
    latex_macros?: Record<string, string | [string, number]> | null;
};

export async function loadLocalArxiTexExport(slug: string): Promise<ArxiTexExportPayload> {
    const url = `/data/${encodeURIComponent(slug)}.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
        throw new Error(`Failed to load local export: ${url} (status ${res.status})`);
    }
    return (await res.json()) as ArxiTexExportPayload;
}
