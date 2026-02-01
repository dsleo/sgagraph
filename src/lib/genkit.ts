import 'server-only';

import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'zod';
import { ArtifactSchema } from './schemas';

// Initialize Genkit with the Google GenAI plugin
const ai = genkit({
  plugins: [
    googleAI({
      // The GOOGLE_API_KEY environment variable will be read automatically.
    }),
  ],
});

// Zod schema for the expected output from the LLM
export const DependencyResponseSchema = z.object({
  has_dependency: z
    .boolean()
    .describe('Whether a direct logical dependency exists.'),
  dependency_type: z
    .string()
    .optional()
    .describe('The type of dependency, if one exists.'),
  justification: z
    .string()
    .optional()
    .describe('A concise explanation of the dependency.'),
});
export type DependencyResponse = z.infer<typeof DependencyResponseSchema>;

const FlowInputSchema = z.object({
  sourceArtifact: ArtifactSchema,
  targetArtifact: ArtifactSchema,
});
type FlowInput = z.infer<typeof FlowInputSchema>;

// The prompt text is adapted directly from the arxitex Python project.
const dependencySystemPrompt = `
You are an expert mathematician and logician acting as a high-precision proof-checker. Your task is to determine if a direct logical or conceptual dependency exists between two provided mathematical artifacts.

**CONTEXT:** You have been given this specific pair because a preliminary analysis found that they share significant, specialized terminology. This strongly suggests a potential relationship, and your job is to perform the final expert verification.

**YOUR GOAL:** Determine if the 'Source Artifact' logically relies on a definition, result, or concept presented in the 'Target Artifact'.

**INSTRUCTIONS & RESPONSE REQUIREMENTS:**
1.  **THE PRINCIPLE OF FOCUSED INQUIRY:** This is your most important rule. The shared terminology is your primary clue. Your task is to **actively investigate the logical connection implied by this clue.** Your default assumption should be that the shared terminology is meaningful, not coincidental. Prioritize finding how the Source uses the Target's concepts.
2.  **DEFINITION OF DEPENDENCY:** A dependency exists if the Source Artifact does any of the following:
    - **uses-result:** Directly applies or references a theorem, lemma, proposition, or result proven in the Target.
    - **uses-definition:** Employs a term, notation, or concept that was formally defined or introduced in the Target.
    - **proves:** Is the formal proof of a claim or theorem statement made in the Target.
    - **is-corollary-of:** Is a direct and immediate consequence of the Target's main result.
    - **is-special-case-of:** Is a more specific version of a general result in the Target.

3.  **MANDATORY RESPONSE FIELDS:**
    - If you find a dependency, you MUST set \n      has_dependency\n       to \n      true\n    - You MUST then choose the single most fitting relationship type for \n      dependency_type\n    - You MUST provide a concise \n      justification\n       that explains **how** the Source depends on the Target. Quote the specific words from the Source that provide the evidence.
    - If, after careful analysis, you conclude the shared terms are used coincidentally and there is no logical dependency, you MUST set \n      has_dependency\n       to \n      false\n`;

/**
 * A Genkit flow to infer the dependency between two artifacts.
 */
export const dependencyFlow = ai.defineFlow(
  {
    name: 'dependencyFlow',
    inputSchema: FlowInputSchema as unknown as any,
    outputSchema: DependencyResponseSchema as unknown as any,
  },
  async ({ sourceArtifact, targetArtifact }: FlowInput) => {
    // Using string concatenation to avoid backtick escaping issues.
    const userPrompt = `Please analyze the following pair for a logical dependency, based on all the rules provided.

**Target Artifact (The potential prerequisite):**
- Type: ${targetArtifact.type}
- Label: ${targetArtifact.label}
- Statement:
\`\`\`latex
${targetArtifact.content}
\`\`\`
---

**Source Artifact (The potential dependent):**
- Type: ${sourceArtifact.type}
- Label: ${sourceArtifact.label}
- Statement:
\`\`\`latex
${sourceArtifact.content}
\`\`\`
---`;

    const combinedPrompt = `${dependencySystemPrompt}\n\n${userPrompt}`;

    const llmResponse = await ai.generate({
      model: 'gemini-1.5-flash',
      prompt: combinedPrompt,
      output: {
        schema: DependencyResponseSchema as unknown as any,
      },
      config: {
        temperature: 0.1, // Lower temperature for more deterministic output
      },
    });

    return llmResponse.output();
  }
);
