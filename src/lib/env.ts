import { z } from 'zod';

const EnvSchema = z.object({
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    GRAPH_FEEDBACK_IP_SALT: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(): Env {
    const parsed = EnvSchema.safeParse({
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        GRAPH_FEEDBACK_IP_SALT: process.env.GRAPH_FEEDBACK_IP_SALT,
    });

    if (!parsed.success) {
        // In dev, keep it forgiving; route handlers will decide what to do.
        return {};
    }

    return parsed.data;
}
