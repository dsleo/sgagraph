import { z } from 'zod';
import { Artifact, ArtifactSchema, ArtifactTypeSchema } from './schemas';
import { v4 as uuidv4 } from 'uuid';

// These are the environments we are interested in extracting.
const ARTIFACT_TYPES: z.infer<typeof ArtifactTypeSchema>[] = [
  'theorem',
  'lemma',
  'proposition',
  'corollary',
  'definition',
  'remark',
  'conjecture',
];

const PROOF_ENV_TYPE = 'proof';

/**
 * A TypeScript port of the regex-based LaTeX artifact extraction logic
 * from the arxitex Python project.
 */

/**
 * Finds the matching \end{...} tag for a given environment, correctly handling nesting.
 * @param content The full LaTeX content.
 * @param envType The name of the environment (e.g., "theorem").
 * @param startPos The position to start searching from (i.e., after the initial \begin{...}).
 * @returns The position of the matching \end tag, or -1 if not found.
 */
function findMatchingEnd(
  content: string,
  envType: string,
  startPos: number
): number {
  const beginTag = `\\begin{${envType}}`;
  const endTag = `\\end{${envType}}`;
  let nestingLevel = 1;
  let cursor = startPos;

  while (nestingLevel > 0) {
    const nextEnd = content.indexOf(endTag, cursor);
    // We don't look for `nextBegin` inside displayed math environments
    const mathBlockRegex = /\\begin\{(?:equation|align|gather|split)\*?}[\s\S]*?\\end\{(?:equation|align|gather|split)\*?}/g;
    const nonMathContent = content.substring(cursor, nextEnd === -1 ? undefined : nextEnd);
    let tempCursor = 0;
    let nextBegin = -1;
    let result;

    while ((result = mathBlockRegex.exec(nonMathContent)) !== null) {
      const plainText = nonMathContent.substring(tempCursor, result.index);
      const beginIndexInPlainText = plainText.indexOf(beginTag);
      if (beginIndexInPlainText !== -1) {
        nextBegin = tempCursor + beginIndexInPlainText;
        break;
      }
      tempCursor = result.index + result[0].length;
    }
    if (nextBegin === -1) {
      const finalSearch = nonMathContent.substring(tempCursor);
      const beginIndexInFinalSearch = finalSearch.indexOf(beginTag);
      if (beginIndexInFinalSearch !== -1) {
        nextBegin = tempCursor + beginIndexInFinalSearch;
      }
    }

    if (nextBegin !== -1) {
      nextBegin += cursor;
    }

    if (nextEnd === -1) {
      console.warn(
        `Could not find matching ${endTag} for environment starting near position ${startPos}.`
      );
      return -1;
    }

    if (nextBegin !== -1 && nextBegin < nextEnd) {
      nestingLevel++;
      cursor = nextBegin + beginTag.length;
    } else {
      nestingLevel--;
      if (nestingLevel === 0) {
        return nextEnd;
      }
      cursor = nextEnd + endTag.length;
    }
  }
  return -1;
}

/**
 * Extracts the first \label{...} from a content string.
 * @param content The content of a LaTeX environment.
 * @returns The label string, or null if not found.
 */
function extractLabel(content: string): string | null {
  const labelMatch = content.match(/\\label\s*\{([^}]+)\}/);
  return labelMatch ? labelMatch[1].trim() : null;
}

/**
 * Parses a string of LaTeX content and extracts all artifacts.
 * @param latexContent The full, combined LaTeX source code.
 * @returns An array of Artifact objects.
 */
export function extractArtifacts(latexContent: string): Artifact[] {
  const nodes: Artifact[] = [];

  // Pre-process: remove comments
  const content = latexContent.replace(/(?<!\\)%.*/g, '');

  const allEnvTypes = [...ARTIFACT_TYPES, PROOF_ENV_TYPE].join('|');
  const pattern = new RegExp(`\\begin{(${allEnvTypes})(\*?)}`, 'g');

  let match;
  while ((match = pattern.exec(content)) !== null) {
    const envType = match[1].toLowerCase();
    const star = match[2] || ''; // Not used yet, but good to have.
    const blockStart = match.index + match[0].length;

    const endTagPos = findMatchingEnd(content, envType + star, blockStart);

    if (endTagPos === -1) {
      continue;
    }

    const rawContent = content.substring(blockStart, endTagPos).trim();

    // We are only interested in artifacts, not proofs, for the node list.
    if (envType !== PROOF_ENV_TYPE) {
      const label = extractLabel(rawContent);

      const artifact: Artifact = {
        // The label is the most reliable unique ID for dependencies.
        // If no label, we create a fallback ID.
        id: label || `${envType}-${uuidv4()}`,
        type: envType as any, // Cast because we know it's a valid type
        label: label || `Unlabeled ${envType}`,
        content: rawContent,
        dependencies: [], // This will be populated by the LLM step.
      };

      const parsed = ArtifactSchema.safeParse(artifact);
      if (parsed.success) {
        nodes.push(parsed.data);
      } else {
        console.warn("Failed to parse artifact:", parsed.error);
      }
    }

    // Move the cursor to the end of the environment to continue searching.
    pattern.lastIndex = endTagPos + `\\end{${envType}${star}}`.length;
  }

  return nodes;
}
