// Row types for the room_* tables (mirror supabase/migrations/*_room_schema.sql)

export type Language = "he" | "en";
export type RoomPhase = "prospect" | "active" | "retainer" | "dormant" | "closed";
export type MemberSide = "activeapps" | "client";
export type MemberRole = "admin" | "member" | "owner" | "approver" | "commenter" | "viewer";
export type MemberStatus = "invited" | "active" | "revoked";
export type EngagementType = "foundation" | "transformation_90d" | "retainer" | "custom";
export type EngagementStatus = "draft" | "shared" | "agreed" | "signed" | "active" | "completed" | "cancelled";
export type DocumentKind = "sow" | "offer" | "msa" | "dpa" | "nda" | "discovery" | "plan" | "file";
export type DocumentStatus = "draft" | "published" | "archived";
export type BlockType =
  | "heading" | "text" | "deliverable" | "assumption" | "milestone"
  | "pricing_option" | "pricing_line" | "callout" | "file" | "image" | "table" | "divider";
export type BlockStatus = "draft" | "in_review" | "agreed" | "changed";
export type QuestionStatus = "open" | "answered" | "closed";

export interface Room {
  id: string;
  org_id: string;
  account_id: string | null;
  slug: string;
  name: string;
  client_name: string;
  client_logo_path: string | null;
  language: Language;
  phase: RoomPhase;
  status_note: string | null;
  next_milestone_label: string | null;
  next_milestone_date: string | null;
  welcome_message: string | null;
  welcome_video_url: string | null;
  nda_required: boolean;
  response_sla_hours: number;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomMember {
  id: string;
  room_id: string;
  user_id: string | null;
  email: string;
  full_name: string;
  title: string | null;
  side: MemberSide;
  role: MemberRole;
  status: MemberStatus;
  invited_by: string | null;
  joined_at: string | null;
  last_seen_at: string | null;
  expires_at: string | null;
  nda_accepted_at: string | null;
  notification_prefs?: Record<string, "immediate" | "digest" | "off">;
  created_at: string;
  updated_at: string;
}

export interface Engagement {
  id: string;
  room_id: string;
  opportunity_id: string | null;
  project_id: string | null;
  type: EngagementType;
  name: string;
  status: EngagementStatus;
  currency: string;
  offer_valid_until: string | null;
  selected_pricing_option_block_id: string | null;
  agreed_at: string | null;
  agreed_by_member_id: string | null;
  agreed_version_id: string | null;
  agreement_record: Record<string, unknown> | null;
  signed_at: string | null;
  kickoff_date: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RoomDocument {
  id: string;
  room_id: string;
  engagement_id: string | null;
  kind: DocumentKind;
  title: string;
  status: DocumentStatus;
  current_version: number;
  confidential: boolean;
  storage_path: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  locked?: boolean;
}

// ---- Block content schemas (spec §4.3) ----
export interface DeliverableContent {
  title: string; description?: string; acceptance_criteria?: string[]; phase?: string; owner_side?: MemberSide;
}
export interface AssumptionContent { text: string; impact_if_false?: string }
export interface MilestoneContent {
  title: string; target_date?: string | null; depends_on?: string[]; status?: "planned" | "in_progress" | "done";
}
export interface PricingOptionContent {
  name: string; description?: string; price: number; currency: string;
  billing: "one_time" | "monthly" | "hourly"; includes?: string[]; recommended?: boolean;
}
export interface PricingLineContent { label: string; quantity: number; unit_price: number; total?: number; currency?: string }
export interface TextContent { markdown: string }
export interface HeadingContent { text: string; level: 1 | 2 | 3 }
export interface CalloutContent { tone: "info" | "warning" | "success"; markdown: string }
export interface FileContent { storage_path: string; caption?: string; file_name?: string }
export interface ImageContent { storage_path: string; caption?: string; alt?: string }
export interface TableContent { columns: string[]; rows: string[][] }
export type BlockContent =
  | DeliverableContent | AssumptionContent | MilestoneContent | PricingOptionContent | PricingLineContent
  | TextContent | HeadingContent | CalloutContent | FileContent | ImageContent | TableContent | Record<string, never>;

export interface Block {
  id: string;
  room_id: string;
  document_id: string;
  parent_block_id: string | null;
  sort_order: number;
  type: BlockType;
  content: Record<string, unknown>;
  status: BlockStatus;
  content_hash: string | null;
  approved_by_member_id: string | null;
  approved_at: string | null;
  approved_version: number | null;
  published_version: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A block as returned by room_document_view(): snapshot + live status. */
export interface ViewBlock {
  id: string;
  type: BlockType;
  content: Record<string, unknown>;
  sort_order: number;
  parent_block_id: string | null;
  content_hash: string | null;
  status: BlockStatus;
  live_status: BlockStatus;
  display_status: BlockStatus;
  approved_at: string | null;
  approved_by_member_id: string | null;
  approved_version: number | null;
  comment_count: number;
  open_question_count: number;
  diff: "added" | "changed" | null;
  is_new_since_visit: boolean;
}

export interface DocumentVersionSummary {
  id: string; version: number; change_summary: string | null; published_at: string; published_by: string | null;
}

export interface DocumentView {
  document: Pick<RoomDocument, "id" | "room_id" | "engagement_id" | "kind" | "title" | "status" | "current_version" | "confidential">;
  version: number;
  blocks: ViewBlock[];
  removed_since_previous: ViewBlock[];
  versions: DocumentVersionSummary[];
  viewer: { member_id: string | null; is_internal: boolean; role: MemberRole | null };
}

export interface Comment {
  id: string;
  room_id: string;
  document_id: string | null;
  block_id: string | null;
  version: number | null;
  parent_id: string | null;
  author_member_id: string;
  body: string;
  mentions: string[];
  internal_only: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  room_id: string;
  document_id: string | null;
  block_id: string | null;
  title: string;
  body: string | null;
  asked_by_member_id: string;
  owner_member_id: string | null;
  due_date: string | null;
  status: QuestionStatus;
  answer: string | null;
  answered_by_member_id: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Decision {
  id: string; room_id: string; question_id: string | null; block_id: string | null;
  text: string; decided_by_member_id: string | null; decided_at: string; created_at: string;
}

export interface RoomEvent {
  id: string;
  room_id: string;
  actor_member_id: string | null;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown>;
  client_visible: boolean;
  created_at: string;
}

export interface SowReadiness {
  sow_document_id: string | null; version: number | null; total: number; agreed: number; pending: number;
  ready: boolean; pending_block_ids: string[];
}

export interface RoomHomePayload {
  room: Room;
  me: RoomMember | null;
  is_internal: boolean;
  current_engagement: Engagement | null;
  sow: { id: string; title: string; current_version: number; status: DocumentStatus } | null;
  readiness: SowReadiness | null;
  open_questions: number;
  my_questions: { id: string; title: string; due_date: string | null; block_id: string | null; document_id: string | null }[];
  my_pending_blocks: { id: string; document_id: string; type: BlockType; title: string | null }[];
  my_mentions: { id: string; block_id: string | null; document_id: string | null; body: string; created_at: string }[];
  changes_since_visit: RoomEvent[];
  engagements: Engagement[];
  documents: RoomDocument[];
  members: RoomMember[];
  milestones: { id: string; document_id: string; content: MilestoneContent; status: BlockStatus }[];
  recent_events: RoomEvent[];
}

export interface RoomTemplate {
  id: string; name: string; engagement_type: EngagementType; language: Language; blueprint: unknown;
}
