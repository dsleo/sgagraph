/**
 * Formatting + sanitization helpers for showing LaTeX-ish content inside HTML
 * containers that are later typeset by MathJax.
 *
 * This app’s datasets (notably SGA exports) contain:
 * - JSON-escaped backslashes ("\\\\alpha" -> "\\alpha")
 * - HTML-ish previews embedded as literal strings ("\\<br>")
 * - Unsupported diagram fragments (Xy-pic-like `\xymatrix`, `\ar@...`),
 *   which can break MathJax parsing if left inside `\[ ... \]`.
 *
 * Goal:
 * - Keep TeX intact for MathJax where possible.
 * - Improve readability (line breaks, enumerations) for previews.
 * - Avoid MathJax hard failures by replacing diagram blocks with a placeholder.
 */

export type FormatMathOptions = {
    /** Replace literal "\\<br>" sequences with `<br>` (used in content_preview). */
    convertEscapedHtmlBreaks?: boolean;
};

const DEFAULT_OPTS: Required<FormatMathOptions> = {
    convertEscapedHtmlBreaks: true,
};

function normalizeBackslashes(s: string): string {
    // Replace *double* backslashes with a single backslash.
    // (In a JS regex literal, /\\\\/ matches two consecutive '\\' chars.)
    return s.replace(/\\\\/g, '\\');
}

function stripLatexLabels(s: string): string {
    return s.replace(/\\label\{[^}]*\}/g, '');
}

function convertEscapedBreaksToHtml(s: string): string {
    // Dataset embeds HTML breaks as literal text like "\<br>".
    // After backslash normalization it becomes "\<br>".
    // Convert to actual HTML line breaks.
    return s.replace(/\\<br\s*\/?\s*>/gi, '<br>');
}

function replaceXyPicBlocks(s: string): string {
    // Best-effort remove classic Xy-pic blocks that otherwise cause MathJax
    // to fail parsing an entire display math block.
    //
    // NOTE: This is not a full brace parser.
    return s.replace(/\\xymatrix\s*\{[\s\S]*?\}/g, '[diagram]');
}

function stripRemainingXyPicArrowCommands(s: string): string {
    // Some SGA exports contain residual Xy-pic arrow commands like
    //   \ar@<-3pt>[r]
    // even when the \xymatrix{...} wrapper was lost.
    // These are not supported by MathJax and can surface as mjx-merror.
    //
    // We replace them with a safe placeholder.
    return s
        .replace(/\\ar@[^\s]*\[[^\]]*\][^\s]*/g, '[diagram]')
        .replace(/\\ar\[[^\]]*\][^\s]*/g, '[diagram]');
}

function replaceBadMathBlocks(s: string): string {
    // Replace display math blocks that contain diagram-ish content with a
    // plain placeholder.
    //
    // This targets patterns like:
    //   \[[diagram] \ar@... \]
    // where MathJax cannot parse the Xy-pic commands.
    const BAD_RE = /(\[diagram\]|\\ar@|\\ar\[|\\xymatrix)/;
    return s.replace(/\\\[[\s\S]*?\\\]/g, (m) => {
        if (BAD_RE.test(m)) return '<span class="diagram-placeholder">[diagram]</span>';
        return m;
    });
}

function convertEnumerateToHtmlLists(s: string): string {
    // Best-effort conversion of very common LaTeX list environments.
    // Keeps content intact so MathJax can still typeset math inside <li>.

    // enumerate
    for (let i = 0; i < 20; i++) {
        const next = s.replace(
            /\\begin\{enumerate\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{enumerate\}/g,
            (_m, inner) => {
                const parts = String(inner)
                    .split(/\\item\s+/)
                    .map((p) => p.trim())
                    .filter(Boolean);
                if (!parts.length) return '';
                return `<ol class="latex-enum">${parts.map((p) => `<li>${p}</li>`).join('')}</ol>`;
            },
        );
        if (next === s) break;
        s = next;
    }

    // itemize
    for (let i = 0; i < 20; i++) {
        const next = s.replace(
            /\\begin\{itemize\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{itemize\}/g,
            (_m, inner) => {
                const parts = String(inner)
                    .split(/\\item\s+/)
                    .map((p) => p.trim())
                    .filter(Boolean);
                if (!parts.length) return '';
                return `<ul class="latex-itemize">${parts.map((p) => `<li>${p}</li>`).join('')}</ul>`;
            },
        );
        if (next === s) break;
        s = next;
    }

    return s;
}

function convertNewlinesOutsideMathToBr(s: string): string {
    // Preserve explicit newlines as <br> *only outside math mode*.
    //
    // Converting newlines inside TeX math (e.g. align environments) into <br>
    // will break MathJax parsing.
    const normalized = s.replace(/\r\n/g, '\n');

    const mathEnvs = new Set([
        'align',
        'align*',
        'equation',
        'equation*',
        'gather',
        'gather*',
        'multline',
        'multline*',
        'split',
        'cases',
        'array',
    ]);

    let out = '';
    let i = 0;
    let inInlineMath = false;
    let inDisplayMath = false;
    const envStack: string[] = [];

    const inMath = () => inInlineMath || inDisplayMath || envStack.length > 0;

    while (i < normalized.length) {
        const ch = normalized[i];

        // \[ ... \]
        if (normalized.startsWith('\\[', i)) {
            inDisplayMath = true;
            out += '\\[';
            i += 2;
            continue;
        }
        if (normalized.startsWith('\\]', i)) {
            inDisplayMath = false;
            out += '\\]';
            i += 2;
            continue;
        }

        // \( ... \)
        if (normalized.startsWith('\\(', i)) {
            inInlineMath = true;
            out += '\\(';
            i += 2;
            continue;
        }
        if (normalized.startsWith('\\)', i)) {
            inInlineMath = false;
            out += '\\)';
            i += 2;
            continue;
        }

        // $$ ... $$
        if (normalized.startsWith('$$', i)) {
            inDisplayMath = !inDisplayMath;
            out += '$$';
            i += 2;
            continue;
        }

        // $ ... $ (ignore escaped \$)
        if (ch === '$' && normalized[i - 1] !== '\\') {
            // If we are already in display math, treat as literal $.
            if (!inDisplayMath) {
                inInlineMath = !inInlineMath;
            }
            out += '$';
            i += 1;
            continue;
        }

        // \begin{...} / \end{...}
        if (normalized.startsWith('\\begin{', i)) {
            const end = normalized.indexOf('}', i + 7);
            if (end !== -1) {
                const name = normalized.slice(i + 7, end);
                if (mathEnvs.has(name)) {
                    envStack.push(name);
                }
                out += normalized.slice(i, end + 1);
                i = end + 1;
                continue;
            }
        }
        if (normalized.startsWith('\\end{', i)) {
            const end = normalized.indexOf('}', i + 5);
            if (end !== -1) {
                const name = normalized.slice(i + 5, end);
                if (envStack.length && envStack[envStack.length - 1] === name) {
                    envStack.pop();
                }
                out += normalized.slice(i, end + 1);
                i = end + 1;
                continue;
            }
        }

        if (ch === '\n') {
            out += inMath() ? '\n' : '<br>';
            i += 1;
            continue;
        }

        out += ch;
        i += 1;
    }

    return out;
}

/**
 * Convert a raw dataset string into HTML suitable for inserting into
 * `.innerHTML`, followed by a MathJax `typeset()` call.
 */
export function formatMathToHtml(raw?: string | null, opts?: FormatMathOptions): string {
    if (!raw) return '';

    const o: Required<FormatMathOptions> = { ...DEFAULT_OPTS, ...(opts ?? {}) };
    let s = String(raw);

    s = normalizeBackslashes(s);
    s = stripLatexLabels(s);
    s = replaceXyPicBlocks(s);
    s = stripRemainingXyPicArrowCommands(s);
    if (o.convertEscapedHtmlBreaks) {
        s = convertEscapedBreaksToHtml(s);
    }

    // Convert lists before scanning for bad math blocks so that \item sequences
    // become HTML (and do not confuse the math-block heuristic).
    s = convertEnumerateToHtmlLists(s);

    // Convert remaining newlines to <br> for nicer paragraphs, but only
    // outside math blocks.
    s = convertNewlinesOutsideMathToBr(s);

    // Finally, replace any display-math diagram blocks that would crash MathJax.
    s = replaceBadMathBlocks(s);

    return s.trim();
}
