export type User = {
  id: number;
  name: string;
  email?: string;
  role: "admin" | "user";
  status: "active" | "pending" | "suspended";
  online: boolean;
  last_seen_at: string | null;
  avatar_url: string | null;
};
export type Attachment = {
  id: number;
  name: string;
  mime: string;
  size: number;
  previewable: boolean;
  url: string;
  download_url: string;
  thumbnail_url: string | null;
};
export type Message = {
  id: number;
  conversation_id: number;
  sender_id: number;
  client_id: string;
  body: string | null;
  attachments: Attachment[];
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  state?: "sending" | "failed";
};
export type Conversation = {
  id: number;
  peer: User;
  unread_count: number;
  read_id: number;
  peer_read_id: number;
  latest_message: Message | null;
  updated_at: string;
};
export type Call = {
  id: number;
  conversation_id: number;
  caller_id: number;
  callee_id: number;
  kind: "audio" | "video";
  status: string;
  ended_at: string | null;
  connected_at: string | null;
  expires_at: string;
  updated_at: string;
};
export type Notice = {
  id: number;
  kind: string;
  data: { conversation_id: number; sender_name?: string };
  read_at: string | null;
  created_at: string;
};
export type Page<T> = {
  data: T[];
  links?: { next: string | null };
  meta?: { next_cursor?: string | null };
  next_cursor?: string | null;
  next_page_url?: string | null;
};
export type PickedFile = {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
};
