import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  apikey,
  image,
  imageDerivative,
  imageFile,
  settings,
  user,
} from "./schema";

export const insertUserSchema = createInsertSchema(user);
export const selectUserSchema = createSelectSchema(user);

export const insertApikeySchema = createInsertSchema(apikey);
export const selectApikeySchema = createSelectSchema(apikey);

export const insertImageSchema = createInsertSchema(image);
export const selectImageSchema = createSelectSchema(image);

export const insertImageFileSchema = createInsertSchema(imageFile);
export const selectImageFileSchema = createSelectSchema(imageFile);

export const insertImageDerivativeSchema = createInsertSchema(imageDerivative);
export const selectImageDerivativeSchema = createSelectSchema(imageDerivative);

export const insertSettingsSchema = createInsertSchema(settings);
export const selectSettingsSchema = createSelectSchema(settings);
