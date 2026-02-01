import { z } from 'zod';

// === Core artifact & graph types used by the frontend ===

// Defines the types of artifacts we can extract.
// This is a superset of the Python ArtifactType enum so we can safely
// consume data coming from the arxitex pipeline.
export const ArtifactTypeSchema = z.enum([
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
  'unknown',
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

// Represents a single extracted artifact, like a theorem or definition.
export const ArtifactSchema = z.object({
  id: z
    .string()
    .describe(
      'A unique identifier for the artifact, e.g., "theorem-1" or "definition-a"',
    ),
  type: ArtifactTypeSchema,
  label: z
    .string()
    .describe(
      'The designated label of the artifact, e.g., "Theorem 1", "Lemma A.1"',
    ),
  content: z.string().describe('The full text content of the artifact.'),
  dependencies: z
    .array(z.string())
    .describe('A list of labels of other artifacts this artifact depends on.'),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

// Represents the full set of artifacts extracted from a document.
export const ExtractedArtifactsSchema = z.object({
  artifacts: z
    .array(ArtifactSchema)
    .describe('A list of all artifacts found in the document.'),
});
export type ExtractedArtifacts = z.infer<typeof ExtractedArtifactsSchema>;

// Represents a node in our final graph visualization.
export const GraphNodeSchema = ArtifactSchema.extend({
  x: z.number().optional(),
  y: z.number().optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

// Represents a link (or edge) in our final graph visualization.
// We keep it simple for now but allow optional metadata coming from
// the Python DocumentGraph edges.
export const GraphLinkSchema = z.object({
  source: z.string().describe('The ID of the source artifact node.'),
  target: z.string().describe('The ID of the target artifact node.'),
  dependencyType: z
    .string()
    .optional()
    .describe('Optional logical dependency type (e.g., uses_result).'),
  referenceType: z
    .string()
    .optional()
    .describe('Optional reference type (internal/external).'),
  dependency: z
    .string()
    .optional()
    .describe('Optional free-text justification/explanation.'),
  context: z.string().optional().describe('Optional local context of the edge.'),
  edgeType: z
    .string()
    .optional()
    .describe('Edge discriminator as provided by the Python pipeline.'),
});
export type GraphLink = z.infer<typeof GraphLinkSchema>;

// === Schemas for consuming the Python graph JSON ===

// These mirror (a subset of) the structure returned by
// arxitex.extractor.models.DocumentGraph.to_dict and our
// arxitex.tools.graph_json_cli wrapper.

export const PythonNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string().nullable().optional(),
  content: z.string().default(''),
  content_preview: z.string().optional(),
  prerequisites_preview: z.string().optional(),
  display_name: z.string().optional(),
  prerequisite_defs: z.record(z.string(), z.string()).optional(),
  position: z
    .object({
      line_start: z.number().optional(),
      line_end: z.number().optional(),
      col_start: z.number().optional(),
      col_end: z.number().optional(),
    })
    .optional(),
  references: z.array(z.any()).optional(),
  proof: z.string().nullable().optional(),
});
export type PythonNode = z.infer<typeof PythonNodeSchema>;

export const PythonEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  context: z.string().nullable().optional(),
  reference_type: z.string().nullable().optional(),
  dependency_type: z.string().nullable().optional(),
  dependency: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
});
export type PythonEdge = z.infer<typeof PythonEdgeSchema>;

export const PythonGraphSchema = z.object({
  arxiv_id: z.string(),
  extractor_mode: z.string().optional(),
  stats: z.object({
    node_count: z.number(),
    edge_count: z.number(),
  }),
  nodes: z.array(PythonNodeSchema),
  edges: z.array(PythonEdgeSchema),
});
export type PythonGraph = z.infer<typeof PythonGraphSchema>;

export const PythonGraphResponseSchema = z.object({
  graph: PythonGraphSchema,
  definition_bank: z.any().nullable().optional(),
  artifact_to_terms_map: z
    .record(z.string(), z.array(z.string()))
    .nullable()
    .optional(),
});
export type PythonGraphResponse = z.infer<typeof PythonGraphResponseSchema>;
