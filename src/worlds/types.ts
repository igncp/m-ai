import { z } from "zod";

const point3DSchema = z.tuple([z.number(), z.number(), z.number()]);

const worldSchema = z.object({
  diggingChests: z.array(point3DSchema),
  farms: z.array(
    z.object({
      chest: point3DSchema,
      trees: z.array(
        z.object({
          trees: z.array(z.tuple([z.number(), z.number()])),
          y: z.number(),
        }),
      ),
      wheat: z.array(
        z.object({
          x: z.tuple([z.number(), z.number()]),
          y: z.number(),
          z: z.tuple([z.number(), z.number()]),
        }),
      ),
    }),
  ),
  mainPlayer: z.string().optional(),
});

type World = z.infer<typeof worldSchema>;

export { type World, worldSchema };
