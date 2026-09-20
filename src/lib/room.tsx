import { createContext, useContext } from "react";
import type { RoomHomePayload, RoomMember } from "./types";

export interface RoomContextValue {
  home: RoomHomePayload;
  me: RoomMember | null;
  isInternal: boolean;
  /** internal staff can preview the room exactly as a client would see it */
  previewAsClient: boolean;
  setPreviewAsClient: (v: boolean) => void;
  /** effective "acts as staff" flag (internal and not previewing) */
  staffMode: boolean;
  presence: { member_id: string; name: string }[];
  /** re-fetch room_home */
  refresh: () => Promise<void>;
  /** "what changed" captured at first load (before last_seen was touched) */
  changes: RoomHomePayload["changes_since_visit"];
  dismissChanges: () => void;
  memberById: (id: string | null | undefined) => RoomMember | undefined;
}

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const v = useContext(RoomContext);
  if (!v) throw new Error("useRoom must be used inside RoomShell");
  return v;
}

export function canApprove(me: RoomMember | null): boolean {
  return !!me && me.side === "client" && (me.role === "owner" || me.role === "approver");
}
export function canComment(me: RoomMember | null, staffMode: boolean): boolean {
  return staffMode || (!!me && me.role !== "viewer");
}
export function canInvite(me: RoomMember | null, staffMode: boolean): boolean {
  return staffMode || (!!me && me.role === "owner");
}
