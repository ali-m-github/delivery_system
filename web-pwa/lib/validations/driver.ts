import { z } from "zod";

/**
 * Schema for updating a driver's seller-specific rates.
 * Each entry maps a seller (merchant) to a custom rate override.
 */
export const driverUpdateSchema = z.object({
  sellerRates: z
    .array(
      z.object({
        sellerId: z.string().min(1, "Seller is required"),
        rate: z.coerce.number().min(0, "Rate must be 0 or greater"),
      }),
    )
    .optional(),
});

export type DriverUpdateInput = z.infer<typeof driverUpdateSchema>;
