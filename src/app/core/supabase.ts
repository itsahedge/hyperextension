import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

import { Storage } from "@plasmohq/storage";

const storage = new Storage({
  area: "local",
});

const supabaseStorage = {
  getItem: async (key: string) => {
    const value = await storage.getItem(key);
    return value === undefined ? null : value;
  },
  setItem: (key: string, value: string) => storage.setItem(key, value),
  removeItem: (key: string) => storage.removeItem(key),
};

export const supabase = createClient(
  process.env.PLASMO_PUBLIC_SUPABASE_URL!,
  process.env.PLASMO_PUBLIC_SUPABASE_KEY!,
  {
    auth: {
      storage: supabaseStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);
