import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Language, RoomPhase } from "./types";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  title?: string | null;
}

export interface RoomSummary {
  id: string;
  slug: string;
  name: string;
  client_name: string;
  language: Language;
  phase: RoomPhase;
  updated_at: string;
}

interface AuthState {
  session: Session | null;
  /** true once the initial session check has finished */
  ready: boolean;
  /** ActiveApps staff (profiles.role internal + is_active) */
  isInternal: boolean;
  profile: Profile | null;
  /** rooms the current user can see (all for internal, own for clients) */
  rooms: RoomSummary[];
  roomsLoading: boolean;
  refreshRooms: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  ready: false,
  isInternal: false,
  profile: null,
  rooms: [],
  roomsLoading: false,
  refreshRooms: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [isInternal, setIsInternal] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadRooms = useCallback(async () => {
    const { data } = await supabase
      .from("rooms")
      .select("id, slug, name, client_name, language, phase, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    setRooms((data as RoomSummary[]) ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!session?.user) {
      setIsInternal(false);
      setProfile(null);
      setRooms([]);
      return;
    }
    setRoomsLoading(true);
    (async () => {
      // 1. staff or client?
      const { data: internal } = await supabase.rpc("is_internal");
      if (cancelled) return;
      const staff = internal === true;
      setIsInternal(staff);

      // 2. staff profile (RLS hides profiles from clients)
      if (staff) {
        const { data: p } = await supabase
          .from("profiles")
          .select("id, email, full_name, role, title")
          .eq("auth_user_id", session.user.id)
          .maybeSingle();
        if (!cancelled) setProfile((p as Profile) ?? null);
      } else {
        // 3. clients: link invited memberships to this auth user (idempotent)
        await supabase.rpc("room_claim_membership");
      }
      await loadRooms();
      if (!cancelled) setRoomsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, loadRooms]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setRooms([]);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ session, ready, isInternal, profile, rooms, roomsLoading, refreshRooms: loadRooms, signOut }),
    [session, ready, isInternal, profile, rooms, roomsLoading, loadRooms, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
