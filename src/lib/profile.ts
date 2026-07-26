import { supabase } from "./supabase";
import { Profile } from "./types";

/**
 * Get the signed-in user's profile, creating it as a STUDENT if it doesn't
 * exist yet. New accounts are always students; elevated roles are granted by
 * an administrator afterwards. Works whether or not email confirmation is on.
 */
export async function ensureProfile(): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) return existing as Profile;

  const meta = (user.user_metadata ?? {}) as { full_name?: string };
  const { data: created, error } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      full_name: meta.full_name || user.email?.split("@")[0] || "User",
      email: user.email,
      role: "student",
    })
    .select()
    .single();
  if (error) {
    console.error("ensureProfile:", error.message);
    return null;
  }
  return created as Profile;
}
